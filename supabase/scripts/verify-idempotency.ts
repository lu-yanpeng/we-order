// Story 3.4 本地链路验证：重复提交防护（FR-P2-10；AD-11）
//
// 顺序重放与「标识与用户绑定」由数据库测试覆盖（tests/database/85_idempotency.test.sql）；
// 「并发下同一标识只落一张订单」单连接测不了，按 FR-P2-19 用本脚本做人工验证。
//
// 实现方式说明（并发为什么只落一张）：create_order 里「先查有没有」只是快速通道（覆盖顺序重试），
// 它不承担并发正确性——两个请求可以同时查不到；真正的保证是 orders 上 (user_id, idempotency_key)
// 唯一约束：并发插入里只有一个能成功，其余撞唯一约束后在捕获分支里把已落库的那张单原样返回。
//
// 并发轮怎么保证「真的同时到达」：
//   1. 每个请求各自建立一条 TCP 连接（HTTP 客户端连接池会把请求排队，那样就先查后插地"错开"了）；
//   2. 赢家的请求带 500 行明细，写入事务被拉长到数百毫秒，其余请求必然在它提交前到达并撞上唯一约束。
//   断言里还检查「耗时最短的请求也等了同一个事务」——快速通道的响应只要几毫秒，混进来会立刻暴露。
//
// 需要本地栈在跑（supabase start），且数据库已应用迁移与种子（supabase db reset）。
// 运行：cd supabase && deno task verify:idempotency
// 会话走平台标准机制（service role 建用户 + 密码登录）；结束（含失败）时删除测试用户，
// 订单随用户级联删除；目录与门店数据不被改动。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../types/database.types.ts";
import { createServiceClient } from "../functions/wechat-login/identity.ts";

type Client = SupabaseClient<Database>;

const CONCURRENCY = 5;
/** 赢家请求的明细行数：把它的写入事务拉长，给并发请求留出确定的到达窗口。 */
const CONCURRENT_LINES = 500;

async function loadLocalConfig(): Promise<
  { url: string; serviceRoleKey: string; anonKey: string }
> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (url !== "" && serviceRoleKey !== "" && anonKey !== "") {
    return { url, serviceRoleKey, anonKey };
  }

  const output = await new Deno.Command("supabase", {
    args: ["status", "-o", "env"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!output.success) {
    throw new Error(
      "拿不到本地配置：请先 `supabase start`，或手动设置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY",
    );
  }

  const env: Record<string, string> = {};
  for (const line of new TextDecoder().decode(output.stdout).split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match !== null) env[match[1]] = match[2];
  }
  const apiUrl = env.API_URL ?? "";
  const serviceKey = env.SERVICE_ROLE_KEY ?? "";
  const anon = env.ANON_KEY ?? "";
  if (apiUrl === "" || serviceKey === "" || anon === "") {
    throw new Error(
      "`supabase status -o env` 中缺少 API_URL / SERVICE_ROLE_KEY / ANON_KEY",
    );
  }
  return { url: apiUrl, serviceRoleKey: serviceKey, anonKey: anon };
}

const { url, serviceRoleKey, anonKey } = await loadLocalConfig();
const serviceClient = createServiceClient(url, serviceRoleKey);

const checks: string[] = [];
function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
}

// ── 目录：从公开菜单动态挑一个可下单的商品（不写死种子 id，重建后直接能跑） ────────

type MenuProduct = {
  id: string;
  name: string;
  availability: string;
  spec_groups: Array<{
    id: string;
    title: string;
    multi: boolean;
    options: Array<{ id: string; label: string }>;
  }>;
};

function asMenuProducts(products: Json | null): MenuProduct[] {
  return Array.isArray(products) ? products as unknown as MenuProduct[] : [];
}

async function pickOnSaleProduct(client: Client): Promise<MenuProduct> {
  const { data, error } = await client.from("menu").select("products");
  if (error !== null) throw error;
  const products = (data ?? []).flatMap((row) => asMenuProducts(row.products));
  const product = products.find((candidate) =>
    candidate.availability === "on_sale" &&
    candidate.spec_groups.every((group) => group.options.length > 0)
  );
  if (product === undefined) {
    throw new Error("菜单里找不到可下单的商品：请先 `supabase db reset` 应用种子数据");
  }
  return product;
}

/** 规格选择：单选组给选项 id、多选组给选项 id 数组（AD-22 的形状，取每组第一个选项）。 */
function selectionsFor(product: MenuProduct): Json {
  const selections: Record<string, Json> = {};
  for (const group of product.spec_groups) {
    const option = group.options[0];
    if (option === undefined) continue;
    selections[group.id] = group.multi ? [option.id] : option.id;
  }
  return selections;
}

type OrderItemInput = { product_id: string; quantity: number; selections: Json };

function linesFor(product: MenuProduct, lineCount: number): OrderItemInput[] {
  return Array.from({ length: lineCount }, () => ({
    product_id: product.id,
    quantity: 1,
    selections: selectionsFor(product),
  }));
}

// ── 下单结果的形状（与 order_result_json 对应，用于读取断言所需字段） ─────────────

type OrderResult = {
  id: string;
  order_number: string;
  status: string;
  total_amount: string;
  notes: string;
};

function asOrderResult(data: Json | null): OrderResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("下单 RPC 的返回形状不是对象");
  }
  return data as unknown as OrderResult;
}

// ── 测试用户：service role 建用户，再走平台标准会话登录（每个用户一个客户端） ─────

type VerifyUser = { id: string; email: string; client: Client };

async function createVerifyUser(tag: string): Promise<VerifyUser> {
  const email = `verify-idempotency-${tag}-${crypto.randomUUID()}@wechat.local`;
  const password = crypto.randomUUID();
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error !== null) throw error;

  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError !== null) throw signInError;
  return { id: data.user.id, email, client };
}

// ── 并发请求：一个请求一条独立 TCP 连接（连接池会排队，制造不出真并发） ───────────

const apiUrl = new URL(url);

type ConcurrentCall = {
  status: number;
  durationMs: number;
  json: Json | null;
};

async function postCreateOrderOnOwnConnection(
  items: OrderItemInput[],
  accessToken: string,
): Promise<ConcurrentCall> {
  if (apiUrl.protocol !== "http:") {
    throw new Error("并发验证只支持本地 http 栈（本脚本的定位是本地链路验证）");
  }

  const payload = new TextEncoder().encode(JSON.stringify({
    p_items: items,
    p_dining_mode: "takeout",
    p_notes: "并发验证",
    p_idempotency_key: idempotencyKey,
  }));

  const startedAt = performance.now();
  const connection = await Deno.connect({
    hostname: apiUrl.hostname,
    port: Number(apiUrl.port),
  });
  try {
    await connection.write(new TextEncoder().encode([
      "POST /rest/v1/rpc/create_order HTTP/1.1",
      `Host: ${apiUrl.host}`,
      `apikey: ${anonKey}`,
      `Authorization: Bearer ${accessToken}`,
      "Content-Type: application/json",
      `Content-Length: ${payload.length}`,
      "Connection: close",
      "", "",
    ].join("\r\n")));
    await connection.write(payload);

    const decoder = new TextDecoder();
    let response = "";
    const buffer = new Uint8Array(16 * 1024);
    while (true) {
      const read = await connection.read(buffer);
      if (read === null) break;
      response += decoder.decode(buffer.subarray(0, read), { stream: true });
    }
    response += decoder.decode();

    const separator = response.indexOf("\r\n\r\n");
    if (separator < 0) throw new Error("HTTP 响应缺少报文头与包体的分隔");
    const status = Number(response.slice(0, response.indexOf("\r\n")).split(" ")[1] ?? 0);
    const body = response.slice(separator + 4);
    return {
      status,
      durationMs: Math.round(performance.now() - startedAt),
      json: body === "" ? null : JSON.parse(body) as Json,
    };
  } finally {
    connection.close();
  }
}

const anonClient = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users: VerifyUser[] = [];
const idempotencyKey = `verify-idempotency-${crypto.randomUUID()}`;

try {
  const product = await pickOnSaleProduct(anonClient);
  const concurrentItems = linesFor(product, CONCURRENT_LINES);
  console.log(
    `下单商品：${product.name}（${product.id}，规格组 ${product.spec_groups.length} 个），并发轮每单 ${CONCURRENT_LINES} 行明细`,
  );

  const userA = await createVerifyUser("a");
  users.push(userA);
  const userB = await createVerifyUser("b");
  users.push(userB);

  const createOrder = (
    user: VerifyUser,
    payload: { items: OrderItemInput[]; diningMode: "dinein" | "takeout"; notes: string },
  ) =>
    user.client.rpc("create_order", {
      p_items: payload.items,
      p_dining_mode: payload.diningMode,
      p_notes: payload.notes,
      p_idempotency_key: idempotencyKey,
    });

  const { data: { session }, error: sessionError } = await userA.client.auth.getSession();
  if (sessionError !== null || session === null) {
    throw new Error("拿不到 A 的访问凭证（会话签发失败）");
  }

  // 1) 同一标识的并发请求：独立连接同时发出，赢家插入、其余撞唯一约束后取回赢家的订单
  const startedAt = performance.now();
  const batch = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      postCreateOrderOnOwnConnection(concurrentItems, session.access_token)
    ),
  );
  const elapsedMs = Math.round(performance.now() - startedAt);
  const durations = batch.map((call) => call.durationMs);

  const failures = batch.filter((call) => call.status !== 200);
  if (failures.length > 0) {
    throw new Error(
      `FAIL: ${CONCURRENCY} 个并发请求应全部成功，实际失败 ${failures.length} 个：` +
        failures.map((call) => JSON.stringify(call.json).slice(0, 200)).join("; "),
    );
  }
  checks.push(`${CONCURRENCY} 个并发请求全部成功（各自独立连接，没有一个拿到唯一约束错误）`);

  const results = batch.map((call) => asOrderResult(call.json));
  check(
    new Set(results.map((order) => order.id)).size === 1,
    `${CONCURRENCY} 个并发请求返回同一个订单标识`,
  );
  check(
    new Set(results.map((order) => order.order_number)).size === 1,
    "并发请求返回的订单号完全一致",
  );

  // 赢家的事务要跑数百毫秒；走了快速通道的请求只要几毫秒就返回。耗时最短的也等到了同一个事务，
  // 才能证明这些请求是真的同时到达，而不是被连接池或调度错开。
  check(
    Math.min(...durations) * 3 >= Math.max(...durations),
    `并发请求都等到了赢家的写入事务（耗时 ${Math.min(...durations)}–${Math.max(...durations)}ms，快速通道只要几毫秒）`,
  );

  const orderId = results[0].id;
  const orderNumber = results[0].order_number;

  const { count: orderCount, error: orderCountError } = await serviceClient
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userA.id)
    .eq("idempotency_key", idempotencyKey);
  check(
    orderCountError === null && orderCount === 1,
    `库里该标识只有一张订单（实际 ${orderCount ?? "null"} 张）`,
  );

  const { count: itemCount, error: itemCountError } = await serviceClient
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  check(
    itemCountError === null && itemCount === concurrentItems.length,
    `明细不重复：与请求行数一致（${concurrentItems.length} 行）`,
  );

  // 2) 顺序重放：请求内容不同也返回同一张订单，且不写入新明细
  const replay = await createOrder(userA, {
    items: linesFor(product, 3),
    diningMode: "dinein",
    notes: "换了内容",
  });
  check(replay.error === null, "顺序重放成功");
  const replayOrder = asOrderResult(replay.data);
  check(
    replayOrder.id === orderId,
    "顺序重放（行数、就餐方式与备注都不同）返回同一张订单",
  );
  check(replayOrder.order_number === orderNumber, "顺序重放的订单号与首次一致");

  const { count: itemsAfterReplay, error: itemsAfterReplayError } =
    await serviceClient
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);
  check(
    itemsAfterReplayError === null && itemsAfterReplay === concurrentItems.length,
    "重放没有写入新明细",
  );

  // 3) 标识与用户绑定：B 用 A 的标识只会得到属于自己的新订单
  const bResult = await createOrder(userB, {
    items: linesFor(product, 1),
    diningMode: "takeout",
    notes: "",
  });
  check(bResult.error === null, "B 用 A 的标识下单成功");
  const bOrder = asOrderResult(bResult.data);
  check(bOrder.id !== orderId, "B 拿到的是属于自己的新订单，而不是 A 的订单");

  const { data: bRow, error: bRowError } = await serviceClient
    .from("orders")
    .select("user_id")
    .eq("id", bOrder.id)
    .single();
  check(
    bRowError === null && bRow?.user_id === userB.id,
    "B 的订单在库里归属 B（标识与用户绑定）",
  );

  const { data: leaked, error: leakError } = await userB.client
    .from("orders")
    .select("id")
    .eq("id", orderId);
  check(
    leakError === null && (leaked ?? []).length === 0,
    "B 拿着 A 的订单标识查裸表也读不到那张单",
  );

  const aReplay = await createOrder(userA, {
    items: linesFor(product, 2),
    diningMode: "takeout",
    notes: "",
  });
  check(aReplay.error === null, "A 在 B 插入之后重放成功");
  check(
    asOrderResult(aReplay.data).id === orderId,
    "A 仍拿回 A 自己那张单",
  );

  console.log(
    `PASS：${checks.length} 项断言全部通过（${CONCURRENCY} 个并发请求各自独立连接、${elapsedMs}ms 内全部返回同一张订单 ${orderNumber}）`,
  );
  for (const label of checks) console.log(`  ✓ ${label}`);
} finally {
  let deleted = 0;
  for (const user of users) {
    const { error } = await serviceClient.auth.admin.deleteUser(user.id);
    if (error !== null) {
      console.error(`WARN: 删除测试用户失败（${user.email}）：${error.message}`);
    } else {
      deleted += 1;
    }
  }

  const { count: leftover, error: leftoverError } = await serviceClient
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("idempotency_key", idempotencyKey);
  if (leftoverError !== null) {
    console.error(`WARN: 清理后核对失败：${leftoverError.message}`);
  } else if ((leftover ?? 0) > 0) {
    console.error(`WARN: 清理后仍残留 ${leftover} 张测试订单（标识 ${idempotencyKey}）`);
  } else {
    console.log(`清理：删除 ${deleted} 个测试用户，订单随用户级联删除（无残留）`);
  }
}
