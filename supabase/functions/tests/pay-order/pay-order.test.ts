// Story 3.2 边缘函数测试：离线、注入假建单器与假 fetch，不需要本地栈、网络或真实会话。
// 运行：cd supabase && deno task test（等价于 deno test supabase/functions/tests/）
// 类别断言以数据库类型 order_error_code 为准；文案不是契约，只断言类别与状态码。

import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../../../types/database.types.ts";
import { callerUserId } from "../../pay-order/caller.ts";
import {
  type OrderErrorCode,
  parsePayOrderRequest,
  type PayOrderRequest,
} from "../../pay-order/contract.ts";
import {
  handleRequest,
  type PayOrderDeps,
  type PayOrderFailureLog,
} from "../../pay-order/handler.ts";
import {
  createOrderCreator,
  type CreateOrderOutcome,
} from "../../pay-order/order.ts";

const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/pay-order";
const SERVICE_ROLE_KEY = "unit-test-service-role-key";
const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000203";

/** 订单对外形状（order_result_json）：成功响应必须与它逐字段一致。 */
const ORDER: Json = {
  id: "11111111-1111-4111-8111-111111111111",
  order_number: "202609281200001234",
  status: "cooking",
  dining_mode: "takeout",
  packaging_fee: 2,
  total_amount: 30,
  notes: "无备注要求",
  pickup_code: "A-0001",
  created_at: "2026-09-28 12:00:00",
};

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 构造一张「形状正确」的 JWT：单测不验签（平台负责），只测声明读取。 */
function fakeJwt(payload: Record<string, unknown>): string {
  return `${base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${
    base64Url(JSON.stringify(payload))
  }.unit-test-signature`;
}

const userJwt = fakeJwt({ sub: USER_ID, role: "authenticated" });

/** 一份合法请求体：类型即契约（编译期与 schema 对齐）；没有规格组的商品传空 selections。 */
function validBody(): PayOrderRequest {
  return {
    items: [{ product_id: PRODUCT_ID, quantity: 1, selections: {} }],
    dining_mode: "takeout",
    notes: "",
    idempotency_key: "intent-1",
  };
}

type FakeCreateOrderPlan = {
  outcome?: CreateOrderOutcome;
  throws?: boolean;
};

function fakeCreateOrder(plan: FakeCreateOrderPlan = {}) {
  const calls: Array<{ userId: string; request: PayOrderRequest }> = [];
  const createOrder = (userId: string, request: PayOrderRequest) => {
    calls.push({ userId, request });
    if (plan.throws) {
      return Promise.reject(new Error("internal-db-detail"));
    }
    return Promise.resolve(
      plan.outcome ?? { ok: true, order: ORDER } as CreateOrderOutcome,
    );
  };
  return { createOrder, calls };
}

type CallInput = {
  method?: string;
  body?: unknown;
  authorization?: string;
  plan?: FakeCreateOrderPlan;
};

async function callPayOrder(input: CallInput) {
  const fake = fakeCreateOrder(input.plan);
  const logs: PayOrderFailureLog[] = [];
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (input.authorization !== undefined) {
    headers.Authorization = input.authorization;
  }
  const deps: PayOrderDeps = {
    createOrder: fake.createOrder,
    log: (record) => logs.push(record),
  };
  const request = new Request(FUNCTION_URL, {
    method: input.method ?? "POST",
    headers,
    body: input.body === undefined
      ? undefined
      : (typeof input.body === "string"
        ? input.body
        : JSON.stringify(input.body)),
  });
  const response = await handleRequest(request, deps);
  const payload = await response.json();
  return {
    status: response.status,
    payload,
    requestId: response.headers.get("x-request-id"),
    logs,
    calls: fake.calls,
  };
}

/** 断言恰好一条失败日志：类别、状态、阶段、请求标识齐备，且与服务端密钥无关 */
function assertFailureLog(
  logs: PayOrderFailureLog[],
  expected: { code: OrderErrorCode; status: number; stage: string },
  requestId: string | null,
): void {
  assert.equal(logs.length, 1, "失败应恰好记一条日志");
  const [record] = logs;
  assert.equal(record.event, "pay_order_failed");
  assert.equal(record.code, expected.code);
  assert.equal(record.status, expected.status);
  assert.equal(record.stage, expected.stage);
  assert.ok(record.requestId !== "", "日志应带请求标识");
  assert.equal(record.requestId, requestId, "日志请求标识与响应头一致");
  assert.ok(
    !JSON.stringify(record).includes(SERVICE_ROLE_KEY),
    "日志不得出现服务端密钥",
  );
}

// ── 成功路径 ───────────────────────────────────────────────────────────────

Deno.test("成功：200 + 订单对外形状原样（不加信封），带 x-request-id", async () => {
  const { status, payload, requestId, logs, calls } = await callPayOrder({
    authorization: `Bearer ${userJwt}`,
    body: validBody(),
  });
  assert.equal(status, 200);
  assert.deepEqual(
    payload,
    ORDER,
    "成功响应必须与 order_result_json 逐字段一致",
  );
  assert.ok(
    typeof requestId === "string" && requestId !== "",
    "成功响应也带请求标识",
  );
  assert.equal(logs.length, 0, "成功不记失败日志");
  assert.deepEqual(calls, [{
    userId: USER_ID,
    request: {
      items: [{ product_id: PRODUCT_ID, quantity: 1, selections: {} }],
      dining_mode: "takeout",
      notes: "",
      idempotency_key: "intent-1",
    },
  }]);
  assert.ok(
    !JSON.stringify(payload).includes(SERVICE_ROLE_KEY),
    "响应体不得出现服务端密钥",
  );
});

Deno.test("多余字段被忽略且不转发：金额 / 用户标识 / camelCase / 展示字段都不能改变结果", async () => {
  const { status, payload, calls } = await callPayOrder({
    authorization: `Bearer ${userJwt}`,
    body: {
      items: [{
        product_id: PRODUCT_ID,
        quantity: 2,
        selections: {},
        unit_price: 0.01,
        product_name: "假名字",
        total_amount: 0.01,
      }],
      dining_mode: "takeout",
      diningMode: "dinein",
      notes: "少冰",
      idempotency_key: "intent-extra",
      user_id: "forged-user",
      total_amount: 0.01,
      store_id: "forged-store",
    },
  });
  assert.equal(status, 200);
  assert.equal(
    payload.total_amount,
    ORDER.total_amount,
    "金额以服务端返回为准",
  );
  assert.deepEqual(calls, [{
    userId: USER_ID,
    request: {
      items: [{ product_id: PRODUCT_ID, quantity: 2, selections: {} }],
      dining_mode: "takeout",
      notes: "少冰",
      idempotency_key: "intent-extra",
    },
  }]);
  const sent = JSON.stringify(calls[0].request);
  for (const ignored of ["0.01", "forged", "假名字", "dinein"]) {
    assert.ok(!sent.includes(ignored), `多余字段 ${ignored} 不应转发给数据库`);
  }
});

// ── 请求形状 ───────────────────────────────────────────────────────────────

Deno.test("必填缺失或类型非法 → 400 invalid_request，且不触碰数据库", async () => {
  const bodies: unknown[] = [
    "not-json",
    "[]",
    "null",
    "{}",
    { items: [], dining_mode: "takeout", idempotency_key: "k" },
    { items: {}, dining_mode: "takeout", idempotency_key: "k" },
    { items: [1], dining_mode: "takeout", idempotency_key: "k" },
    { items: [{ quantity: 1 }], dining_mode: "takeout", idempotency_key: "k" },
    {
      items: [{ product_id: "", quantity: 1 }],
      dining_mode: "takeout",
      idempotency_key: "k",
    },
    {
      items: [{ product_id: 1, quantity: 1 }],
      dining_mode: "takeout",
      idempotency_key: "k",
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1, selections: [] }],
      dining_mode: "takeout",
      idempotency_key: "k",
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1, selections: "x" }],
      dining_mode: "takeout",
      idempotency_key: "k",
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
      dining_mode: "eatin",
      idempotency_key: "k",
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
      dining_mode: "takeout",
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
      dining_mode: "takeout",
      idempotency_key: "",
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
      dining_mode: "takeout",
      idempotency_key: "   ",
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
      dining_mode: "takeout",
      idempotency_key: 1,
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
      dining_mode: "takeout",
      idempotency_key: "k",
      notes: 1,
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
      dining_mode: "takeout",
      idempotency_key: "k",
      notes: {},
    },
  ];
  for (const body of bodies) {
    const { status, payload, requestId, logs, calls } = await callPayOrder({
      authorization: `Bearer ${userJwt}`,
      body,
    });
    const label = `body=${JSON.stringify(body)}`;
    assert.equal(status, 400, label);
    assert.equal(payload.code, "invalid_request", label);
    assertFailureLog(
      logs,
      { code: "invalid_request", status: 400, stage: "request" },
      requestId,
    );
    assert.equal(calls.length, 0, `${label}：形状不合法时不应触碰数据库`);
  }
});

Deno.test("数量非法 → 400 invalid_quantity（缺 / 0 / 负数 / 小数 / 字符串 / 布尔），且不触碰数据库", async () => {
  const quantities: unknown[] = [undefined, 0, -1, 1.5, "2", true, null];
  for (const quantity of quantities) {
    const { status, payload, calls } = await callPayOrder({
      authorization: `Bearer ${userJwt}`,
      body: {
        items: [{ product_id: PRODUCT_ID, quantity, selections: {} }],
        dining_mode: "takeout",
        idempotency_key: "k",
      },
    });
    const label = `quantity=${JSON.stringify(quantity)}`;
    assert.equal(status, 400, label);
    assert.equal(payload.code, "invalid_quantity", label);
    assert.equal(calls.length, 0, `${label}：形状不合法时不应触碰数据库`);
  }
});

Deno.test("camelCase 必填字段读不到值 → 400 invalid_request（不接受 camelCase）", async () => {
  const { status, payload, calls } = await callPayOrder({
    authorization: `Bearer ${userJwt}`,
    body: {
      items: [{ product_id: PRODUCT_ID, quantity: 1 }],
      diningMode: "takeout",
      notes: "",
      idempotencyKey: "intent-1",
    },
  });
  assert.equal(status, 400);
  assert.equal(payload.code, "invalid_request");
  assert.equal(calls.length, 0);
});

Deno.test("契约（parsePayOrderRequest）：未知字段剥离、产物只含契约字段、可选字段可省略", () => {
  const parsed = parsePayOrderRequest({
    items: [{ product_id: PRODUCT_ID, quantity: 2 }],
    dining_mode: "dinein",
    idempotency_key: "k",
    user_id: "forged",
    total_amount: 0.01,
  });
  if (!parsed.ok) throw new Error(`应解析成功：${parsed.code}`);
  assert.deepEqual(parsed.request, {
    items: [{ product_id: PRODUCT_ID, quantity: 2 }],
    dining_mode: "dinein",
    idempotency_key: "k",
  });

  const withNotes = parsePayOrderRequest({ ...validBody(), notes: null });
  if (!withNotes.ok) throw new Error(`应解析成功：${withNotes.code}`);
  assert.equal(withNotes.request.notes, null);
});

Deno.test("契约（parsePayOrderRequest）：selections 值必须是字符串或字符串数组；数量失败归 invalid_quantity", () => {
  const badSelections: unknown[] = [
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1, selections: { g: 1 } }],
      dining_mode: "takeout",
      idempotency_key: "k",
    },
    {
      items: [{ product_id: PRODUCT_ID, quantity: 1, selections: [] }],
      dining_mode: "takeout",
      idempotency_key: "k",
    },
  ];
  for (const body of badSelections) {
    const parsed = parsePayOrderRequest(body);
    if (parsed.ok) throw new Error("selections 形状非法应解析失败");
    assert.equal(parsed.code, "invalid_request");
  }

  const badQuantity = parsePayOrderRequest({
    items: [{ product_id: PRODUCT_ID, quantity: 1.5 }],
    dining_mode: "takeout",
    idempotency_key: "k",
  });
  if (badQuantity.ok) throw new Error("数量非法应解析失败");
  assert.equal(badQuantity.code, "invalid_quantity");
});

Deno.test("非 POST → 405 invalid_request", async () => {
  const { status, payload, requestId, logs, calls } = await callPayOrder({
    method: "GET",
    authorization: `Bearer ${userJwt}`,
  });
  assert.equal(status, 405);
  assert.equal(payload.code, "invalid_request");
  assertFailureLog(
    logs,
    { code: "invalid_request", status: 405, stage: "request" },
    requestId,
  );
  assert.equal(calls.length, 0);
});

// ── 身份 ───────────────────────────────────────────────────────────────────

Deno.test("身份缺失或非法 → 401 not_authenticated，且不触碰数据库", async () => {
  const cases: Array<{ label: string; authorization?: string }> = [
    { label: "无 Authorization 头" },
    { label: "空串", authorization: "" },
    { label: "非 Bearer", authorization: "Basic abc" },
    { label: "Bearer 后为空", authorization: "Bearer" },
    { label: "不是 JWT", authorization: "Bearer not-a-jwt" },
    { label: "只有两段", authorization: "Bearer a.b" },
    { label: "payload 不是 JSON", authorization: "Bearer a.@@@.b" },
    {
      label: "角色是 anon",
      authorization: `Bearer ${fakeJwt({ role: "anon" })}`,
    },
    {
      label: "匿名 key 形状（无 sub 的 authenticated）",
      authorization: `Bearer ${fakeJwt({ role: "authenticated" })}`,
    },
    {
      label: "sub 不是 UUID",
      authorization: `Bearer ${
        fakeJwt({ sub: "user-1", role: "authenticated" })
      }`,
    },
    {
      label: "角色是 service_role",
      authorization: `Bearer ${
        fakeJwt({ sub: USER_ID, role: "service_role" })
      }`,
    },
  ];
  for (const { label, authorization } of cases) {
    const { status, payload, requestId, logs, calls } = await callPayOrder({
      authorization,
      body: validBody(),
    });
    assert.equal(status, 401, label);
    assert.equal(payload.code, "not_authenticated", label);
    assertFailureLog(
      logs,
      { code: "not_authenticated", status: 401, stage: "auth" },
      requestId,
    );
    assert.equal(calls.length, 0, `${label}：身份不合法时不应触碰数据库`);
  }
});

Deno.test("callerUserId：合法用户 JWT 取 sub；Bearer 大小写不敏感", () => {
  assert.equal(callerUserId(`Bearer ${userJwt}`), USER_ID);
  assert.equal(callerUserId(`bearer ${userJwt}`), USER_ID);
  assert.equal(callerUserId(null), null);
  assert.equal(callerUserId(""), null);
  assert.equal(callerUserId("Bearer "), null);
});

// ── 错误归一 ───────────────────────────────────────────────────────────────

Deno.test("数据库拒绝：每个 order_error_code → 状态码映射 + 类别 + 请求标识 + 日志", async () => {
  const cases: Array<{ code: OrderErrorCode; status: number }> = [
    { code: "invalid_request", status: 400 },
    { code: "invalid_quantity", status: 400 },
    { code: "invalid_selection", status: 409 },
    { code: "product_unavailable", status: 409 },
    { code: "not_authenticated", status: 401 },
    { code: "store_unavailable", status: 503 },
    { code: "invalid_transition", status: 409 },
    { code: "order_not_found", status: 404 },
    { code: "invalid_status", status: 409 },
    { code: "unknown", status: 500 },
  ];
  for (const { code, status: expectedStatus } of cases) {
    const { status, payload, requestId, logs, calls } = await callPayOrder({
      authorization: `Bearer ${userJwt}`,
      body: validBody(),
      plan: { outcome: { ok: false, code } },
    });
    assert.equal(status, expectedStatus, code);
    assert.deepEqual(
      Object.keys(payload).sort(),
      ["code", "message"],
      `${code}：失败体只有 code 与 message`,
    );
    assert.equal(payload.code, code);
    assert.equal(typeof payload.message, "string");
    assertFailureLog(
      logs,
      { code, status: expectedStatus, stage: "order" },
      requestId,
    );
    assert.equal(calls.length, 1, `${code}：越靠近数据库的失败只调用一次`);
  }
});

Deno.test("建单器抛错 → 500 unknown（internal），不泄露内部细节", async () => {
  const { status, payload, requestId, logs } = await callPayOrder({
    authorization: `Bearer ${userJwt}`,
    body: validBody(),
    plan: { throws: true },
  });
  assert.equal(status, 500);
  assert.equal(payload.code, "unknown");
  assertFailureLog(
    logs,
    { code: "unknown", status: 500, stage: "internal" },
    requestId,
  );
  assert.ok(
    !JSON.stringify(payload).includes("internal-db-detail"),
    "响应体不得出现内部错误细节",
  );
});

// ── 真实调用链：服务端密钥、客户端 JWT 不转发、参数原样 ─────────────────────────

type CapturedRequest = {
  url: string;
  method: string;
  headers: Headers;
  body: string;
};

/** 假 fetch：记录出站请求，按计划返回 PostgREST 风格响应。 */
function fakeRpcFetch(
  plan: {
    payload?: unknown;
    status?: number;
    body?: string;
    throws?: boolean;
  } = {},
) {
  const captured: CapturedRequest[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request
      ? input
      : new Request(String(input), init);
    captured.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: await request.clone().text(),
    });
    if (plan.throws) throw new TypeError("network down");
    if (plan.body !== undefined) {
      return new Response(plan.body, { status: plan.status ?? 200 });
    }
    return new Response(JSON.stringify(plan.payload ?? ORDER), {
      status: plan.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchFn, captured };
}

function serviceClientWithFakeFetch(fetchFn: typeof fetch) {
  return createClient<Database>("http://127.0.0.1:54321", SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchFn },
  });
}

async function callWithRealClient(input: {
  fetchFn: typeof fetch;
  body?: unknown;
  authorization?: string;
}) {
  const logs: PayOrderFailureLog[] = [];
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (input.authorization !== undefined) {
    headers.Authorization = input.authorization;
  }
  const request = new Request(FUNCTION_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(input.body ?? validBody()),
  });
  const response = await handleRequest(request, {
    createOrder: createOrderCreator(serviceClientWithFakeFetch(input.fetchFn)),
    log: (record) => logs.push(record),
  });
  return {
    status: response.status,
    payload: await response.json(),
    requestId: response.headers.get("x-request-id"),
    logs,
  };
}

Deno.test("RPC 调用：具名参数与契约一致；apikey / Authorization 均为服务端密钥，客户端 JWT 不转发", async () => {
  const { fetchFn, captured } = fakeRpcFetch({ payload: ORDER });
  const { status, payload } = await callWithRealClient({
    fetchFn,
    authorization: `Bearer ${userJwt}`,
  });
  assert.equal(status, 200);
  assert.deepEqual(payload, ORDER);
  assert.equal(captured.length, 1);

  const sent = captured[0];
  assert.equal(sent.method, "POST");
  assert.ok(
    sent.url.endsWith("/rest/v1/rpc/create_order_for_user"),
    `应调包装函数：${sent.url}`,
  );
  assert.equal(sent.headers.get("apikey"), SERVICE_ROLE_KEY);
  assert.equal(
    sent.headers.get("Authorization"),
    `Bearer ${SERVICE_ROLE_KEY}`,
  );
  assert.deepEqual(JSON.parse(sent.body), {
    p_user_id: USER_ID,
    p_items: [{ product_id: PRODUCT_ID, quantity: 1, selections: {} }],
    p_dining_mode: "takeout",
    p_notes: "",
    p_idempotency_key: "intent-1",
  });
  assert.ok(
    !sent.body.includes(userJwt),
    "客户端 JWT 绝不转发给包装函数调用",
  );
  assert.ok(
    !sent.url.includes(userJwt),
    "客户端 JWT 不得出现在出站 URL",
  );
});

Deno.test("RPC 返回 P0001 + 已知类别 → 该类别；未知 SQLSTATE / 网络失败 → 500 unknown", async () => {
  const known = await callWithRealClient({
    fetchFn: fakeRpcFetch({
      status: 400,
      payload: { code: "P0001", message: "product_unavailable" },
    }).fetchFn,
    authorization: `Bearer ${userJwt}`,
  });
  assert.equal(known.status, 409);
  assert.equal(known.payload.code, "product_unavailable");

  const unknownSqlstate = await callWithRealClient({
    fetchFn: fakeRpcFetch({
      status: 400,
      payload: { code: "22P02", message: "invalid input value for enum" },
    }).fetchFn,
    authorization: `Bearer ${userJwt}`,
  });
  assert.equal(unknownSqlstate.status, 500);
  assert.equal(unknownSqlstate.payload.code, "unknown");
  assertFailureLog(
    unknownSqlstate.logs,
    { code: "unknown", status: 500, stage: "internal" },
    unknownSqlstate.requestId,
  );

  const unknownMessage = await callWithRealClient({
    fetchFn: fakeRpcFetch({
      status: 400,
      payload: { code: "P0001", message: "some_new_category" },
    }).fetchFn,
    authorization: `Bearer ${userJwt}`,
  });
  assert.equal(unknownMessage.status, 500);
  assert.equal(unknownMessage.payload.code, "unknown");

  const network = await callWithRealClient({
    fetchFn: fakeRpcFetch({ throws: true }).fetchFn,
    authorization: `Bearer ${userJwt}`,
  });
  assert.equal(network.status, 500);
  assert.equal(network.payload.code, "unknown");
  assertFailureLog(
    network.logs,
    { code: "unknown", status: 500, stage: "internal" },
    network.requestId,
  );
});
