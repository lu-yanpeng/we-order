// Story 5.3 订阅隔离双身份验证：A 订阅、B 产生订单变化 → A 收不到任何事件（FR-P3-17；AR-P3-14 / AD-13）
//
// 覆盖（验证矩阵 #6 的现场证据；真实 WebSocket + 真实 RLS，不经过小程序）：
//   ① 列表 filter（user_id=eq.A）：B 经 pay-order 建单（INSERT）并催单（UPDATE）→ A 收到 0 个事件；
//   ② 详情 filter（id=eq.B 的订单）：B 对目标行催单（UPDATE）→ A 收到 0 个事件
//      （filter 精确命中也不放行——filter 不构成归属判定，RLS 是唯一裁决）；
//   ③ 正向对照（关键）：A 自己建单并催单 → A 在同一个连接上收到自己的 INSERT 与 UPDATE 事件，
//      证明「没收到」不是「订阅坏了」（没有正向对照的负向断言是假阴性）；
//   ④ 每个负向窗口都先断言 B 的变化真实发生（催单成功且 ready_at 被提前），窗口不是空测。
//
// 方法：两个合成身份（verify- 前缀 openid，经登录接线拿真实平台会话）＋ realtime-js 直连本地栈
//       （小程序侧走 uni.connectSocket 适配器，不在本脚本范围；协议、凭证与 RLS 判定与线上同源）。
// 前置：本地栈在跑（supabase start）；迁移已应用且 publication 已生效——应用迁移 / db reset 后
//       **必须重启 realtime 容器**（Story 5.1 实测：运行中的容器不拾取 publication 变化）；
//       pay-order 需要边缘函数在跑（supabase functions serve）。
// 清理：临时用户与订单（随用户级联）在脚本结束（含失败）时删除。
//
// 运行：cd supabase && deno task verify:realtime-isolation
// 负向观察窗口可用 REALTIME_ISOLATION_WINDOW_MS 覆盖（默认 5000，比本地事件延迟高一个量级）。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { RealtimeClient } from "npm:@supabase/realtime-js@2.116.0";
import type { Database, Json } from "../types/database.types.ts";
import {
  handleRequest,
  type WechatLoginDeps,
} from "../functions/wechat-login/handler.ts";
import {
  createServiceClient,
  resolveWechatIdentity,
  wechatEmail,
} from "../functions/wechat-login/identity.ts";
import {
  createSessionIssuer,
  createVerifyClient,
  type LoginSession,
} from "../functions/wechat-login/session.ts";

type Client = SupabaseClient<Database>;

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
const verifyClient = createVerifyClient(url, anonKey);
const anonClient = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const checks: string[] = [];
function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
}

// ── 登录：与 verify-rebuild 相同的接线，微信那一跳注入为受控响应（不联网） ────────

function wechatFetch(openid: string): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify({ openid }), { status: 200 }),
    )) as typeof fetch;
}

const loginDeps: Omit<WechatLoginDeps, "fetchFn"> = {
  appId: "verify-app-id",
  appSecret: "verify-app-secret",
  resolveIdentity: (openid) => resolveWechatIdentity(openid, serviceClient),
  issueSession: createSessionIssuer(serviceClient, verifyClient),
};

async function login(openid: string): Promise<LoginSession> {
  const response = await handleRequest(
    new Request("http://verify.local/functions/v1/wechat-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: `verify-code-${openid}` }),
    }),
    { ...loginDeps, fetchFn: wechatFetch(openid) },
  );
  const body = await response.json() as Json;
  if (response.status !== 200 || body === null || typeof body !== "object" ||
    Array.isArray(body)) {
    throw new Error(`FAIL: 登录未返回会话（HTTP ${response.status}）`);
  }
  return body as unknown as LoginSession;
}

/** 只带访问凭证的 REST 客户端：请求头构造与单元验证脚本一致（发布密钥 + Authorization）。 */
function sessionClient(session: LoginSession): Client {
  return createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  });
}

// ── 菜单：匿名读取后按种子里可下单的商品构造请求（不写死种子 id） ────────────────

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

type MenuRow = { id: string; name: string; products: Json };

function asMenuProducts(products: Json | null): MenuProduct[] {
  return Array.isArray(products) ? products as unknown as MenuProduct[] : [];
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

// ── 下单：POST /functions/v1/pay-order（客户端创建订单的唯一入口，Story 3.3） ─────

type OrderJson = { id: string; order_number: string; status: string };

async function postPayOrder(
  product: MenuProduct,
  diningMode: "takeout",
  notes: string,
  idempotencyKey: string,
  accessToken: string,
): Promise<Record<string, Json>> {
  const response = await fetch(`${url}/functions/v1/pay-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      items: [{
        product_id: product.id,
        quantity: 1,
        selections: selectionsFor(product),
      }],
      dining_mode: diningMode,
      notes,
      idempotency_key: idempotencyKey,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `FAIL: pay-order 未成功（HTTP ${response.status}）：${text.slice(0, 300)}`,
    );
  }
  const body = text === "" ? null : (JSON.parse(text) as Json);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("FAIL: pay-order 成功响应不是对象");
  }
  return body as unknown as Record<string, Json>;
}

// ── Realtime：直连本地栈（与小程序同一库；REST 走 supabase-js，Socket 走 realtime-js） ──

const realtimeEndpoint = `${url.replace(/^http/, "ws")}/realtime/v1`;

function createRealtimeConnection(token: string): RealtimeClient {
  return new RealtimeClient(realtimeEndpoint, {
    params: { apikey: anonKey },
    accessToken: async () => token,
  });
}

type Probe = {
  events: string[];
  status: string;
  subscribed: Promise<void>;
  close: () => Promise<void>;
};

/**
 * 建立一个「计数探针」channel：订阅 orders 的 INSERT / UPDATE（带 filter），
 * 把到达的事件记进 events（只记类型；行数据不进入任何状态）。
 * subscribed 在 SUBSCRIBED 时 resolve，CHANNEL_ERROR / TIMED_OUT 时 reject。
 */
function openProbe(
  realtime: RealtimeClient,
  topic: string,
  filter: string,
  eventLog: string[],
): Probe {
  let resolveSubscribed: () => void = () => {};
  let rejectSubscribed: (error: Error) => void = () => {};
  const probe: Probe = {
    events: [],
    status: "connecting",
    subscribed: new Promise<void>((resolve, reject) => {
      resolveSubscribed = resolve;
      rejectSubscribed = reject;
    }),
    close: async () => {},
  };

  const record = (eventType: string): void => {
    probe.events.push(eventType);
    eventLog.push(`${topic}:${eventType}`);
  };

  const channel = realtime
    .channel(topic)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "orders", filter },
      () => record("INSERT"),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "orders", filter },
      () => record("UPDATE"),
    );

  channel.subscribe((status, error?: Error) => {
    probe.status = status;
    if (status === "SUBSCRIBED") resolveSubscribed();
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      rejectSubscribed(
        new Error(
          `订阅未达成（${topic}）：${status}${
            error === undefined ? "" : `：${error.message}`
          }`,
        ),
      );
    }
  });

  probe.close = async () => {
    await realtime.removeChannel(channel);
  };
  return probe;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean,
  timeoutMs: number,
  failureLabel: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(200);
  }
  throw new Error(`FAIL: ${failureLabel}`);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  failureLabel: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`FAIL: ${failureLabel}`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ── 现场数据 ────────────────────────────────────────────────────────────────

const windowMs = Number(
  Deno.env.get("REALTIME_ISOLATION_WINDOW_MS") ?? "5000",
);

const openids: string[] = [];
const userIds: string[] = [];
const idempotencyKeys: string[] = [];
const eventLog: string[] = [];

function nextIdempotencyKey(label: string): string {
  const key = `verify-isolation-${label}-${crypto.randomUUID()}`;
  idempotencyKeys.push(key);
  return key;
}

async function countMappings(openid: string): Promise<number> {
  const { count, error } = await serviceClient
    .from("wechat_identities")
    .select("openid", { count: "exact", head: true })
    .eq("openid", openid);
  if (error !== null) throw error;
  return count ?? 0;
}

/** 服务端读取（service_role 直读，绕过 RLS）：验证 B 的写变化确实落库。 */
async function readOrderState(
  orderId: string,
): Promise<{ status: string; readyAt: string }> {
  const { data, error } = await serviceClient
    .from("orders")
    .select("status, ready_at")
    .eq("id", orderId)
    .single();
  if (error !== null) {
    throw new Error(`FAIL: 读取订单 ${orderId} 状态失败：${error.message}`);
  }
  if (data === null || data.ready_at === null) {
    throw new Error(`FAIL: 订单 ${orderId} 的 ready_at 为空`);
  }
  return { status: data.status, readyAt: data.ready_at };
}

let realtimeA: RealtimeClient | undefined;

try {
  // 1) 匿名读菜单，取一个可下单商品（规格齐全、非下架；与 verify:rebuild 同一挑选规则）
  const { data: menuRows, error: menuError } = await anonClient
    .from("menu")
    .select("id, name, products");
  check(menuError === null, "未登录可以读取菜单（负向窗口的商品来源）");
  const products = ((menuRows ?? []) as MenuRow[])
    .flatMap((row) => asMenuProducts(row.products));
  const product = products.find((candidate) =>
    candidate.availability === "on_sale" &&
    candidate.spec_groups.length > 0 &&
    candidate.spec_groups.every((group) => group.options.length > 0)
  );
  if (product === undefined) {
    throw new Error(
      "FAIL: 菜单里找不到可下单的商品（规格齐全且非下架）：请先 `supabase db reset` 应用种子数据",
    );
  }

  // 2) 两个合成身份（verify- 前缀，结束清理）
  const openidA = `verify-isolation-a-${
    crypto.randomUUID().replaceAll("-", "")
  }`;
  const openidB = `verify-isolation-b-${
    crypto.randomUUID().replaceAll("-", "")
  }`;
  openids.push(openidA, openidB);
  const sessionA = await login(openidA);
  const sessionB = await login(openidB);
  userIds.push(sessionA.user.id, sessionB.user.id);
  check(
    sessionA.user.id !== sessionB.user.id,
    "两个 openid 登录得到两个不同的用户（身份 A / 身份 B）",
  );

  const clientB = sessionClient(sessionB);
  realtimeA = createRealtimeConnection(sessionA.access_token);

  // 3) 负向一：列表 filter（user_id=eq.A）——B 的 INSERT 与 UPDATE 都必须被 RLS 拦下
  const probeList = openProbe(
    realtimeA,
    "verify-isolation-list",
    `user_id=eq.${sessionA.user.id}`,
    eventLog,
  );
  await withTimeout(probeList.subscribed, 15000, "列表订阅未在 15 秒内达成");
  check(
    probeList.status === "SUBSCRIBED",
    "A 的列表订阅（user_id=eq.A）达成 SUBSCRIBED",
  );

  const orderB1 = await postPayOrder(
    product,
    "takeout",
    "订阅隔离验证 B1",
    nextIdempotencyKey("b1"),
    sessionB.access_token,
  ) as unknown as OrderJson;
  const b1Before = await readOrderState(orderB1.id);
  check(b1Before.status === "cooking", "B 经 pay-order 建单成功（INSERT 已发生）");

  const urgencyB1 = await clientB.rpc("urge_order", {
    p_order_id: orderB1.id,
  });
  check(urgencyB1.error === null, "B 对本人订单催单成功（UPDATE 已发生）");
  const b1After = await readOrderState(orderB1.id);
  check(
    new Date(b1After.readyAt).getTime() < new Date(b1Before.readyAt).getTime(),
    "B 的催单真实提前了 ready_at（负向窗口不是空测）",
  );

  await wait(windowMs);
  check(
    probeList.events.length === 0,
    `列表 filter 下 A 收到 0 个事件（含列级数据；窗口 ${windowMs} ms）`,
  );
  await probeList.close();

  // 4) 负向二：详情 filter（id=eq.B 的订单）——filter 精确命中目标行，RLS 仍然拒绝
  const orderB2 = await postPayOrder(
    product,
    "takeout",
    "订阅隔离验证 B2",
    nextIdempotencyKey("b2"),
    sessionB.access_token,
  ) as unknown as OrderJson;
  const probeDetail = openProbe(
    realtimeA,
    "verify-isolation-detail",
    `id=eq.${orderB2.id}`,
    eventLog,
  );
  await withTimeout(probeDetail.subscribed, 15000, "详情订阅未在 15 秒内达成");
  check(
    probeDetail.status === "SUBSCRIBED",
    "A 的详情订阅（filter 精确命中 B 的订单 id）达成 SUBSCRIBED",
  );

  const b2Before = await readOrderState(orderB2.id);
  const urgencyB2 = await clientB.rpc("urge_order", {
    p_order_id: orderB2.id,
  });
  check(urgencyB2.error === null, "B 对第二单催单成功（目标行 UPDATE 已发生）");
  const b2After = await readOrderState(orderB2.id);
  check(
    new Date(b2After.readyAt).getTime() < new Date(b2Before.readyAt).getTime(),
    "第二单的 ready_at 被真实提前（负向窗口不是空测）",
  );

  await wait(windowMs);
  check(
    probeDetail.events.length === 0,
    `详情 filter 下 A 收到 0 个事件（含列级数据；窗口 ${windowMs} ms）`,
  );
  await probeDetail.close();

  // 5) 正向对照：同一连接、同一个 A 身份，自己的变化必须收到（证明订阅是活的）
  const probeOwn = openProbe(
    realtimeA,
    "verify-isolation-own",
    `user_id=eq.${sessionA.user.id}`,
    eventLog,
  );
  await withTimeout(probeOwn.subscribed, 15000, "正向对照订阅未在 15 秒内达成");
  check(
    probeOwn.status === "SUBSCRIBED",
    "正向对照订阅（user_id=eq.A）达成 SUBSCRIBED",
  );

  const clientA = sessionClient(sessionA);
  const orderA = await postPayOrder(
    product,
    "takeout",
    "订阅隔离验证 A",
    nextIdempotencyKey("a1"),
    sessionA.access_token,
  ) as unknown as OrderJson;
  const urgencyA = await clientA.rpc("urge_order", { p_order_id: orderA.id });
  check(urgencyA.error === null, "A 对自己的订单催单成功（自己的 UPDATE 已发生）");
  await waitUntil(
    () =>
      probeOwn.events.includes("INSERT") && probeOwn.events.includes("UPDATE"),
    15000,
    "正向对照超时：A 未在 15 秒内收到自己的 INSERT + UPDATE 事件",
  );
  check(
    probeOwn.events.includes("INSERT") && probeOwn.events.includes("UPDATE"),
    "A 收到自己的 INSERT 与 UPDATE 事件（订阅是活的，负向结论不是假阴性）",
  );
  check(probeOwn.status === "SUBSCRIBED", "正向对照结束时连接仍是 SUBSCRIBED");
  await probeOwn.close();

  console.log(
    `PASS：${checks.length} 项断言全部通过（A 订阅 / B 变更：列表与详情两条链路均 0 事件；同一连接上 A 自己的变化正常到达）`,
  );
  for (const label of checks) console.log(`  ✓ ${label}`);
  console.log(
    `事件记录：${eventLog.length === 0 ? "（无）" : eventLog.join("，")}`,
  );
} finally {
  if (realtimeA !== undefined) {
    try {
      await realtimeA.disconnect();
    } catch (error) {
      console.error(`WARN: 关闭 realtime 连接失败：${String(error)}`);
    }
  }

  let deleted = 0;
  for (const userId of userIds) {
    const { error } = await serviceClient.auth.admin.deleteUser(userId);
    if (error !== null) {
      console.error(`WARN: 删除测试用户失败（${userId}）：${error.message}`);
    } else {
      deleted += 1;
    }
  }

  if (idempotencyKeys.length > 0) {
    const { count: leftover, error: leftoverError } = await serviceClient
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("idempotency_key", idempotencyKeys);
    if (leftoverError !== null) {
      console.error(`WARN: 清理后核对失败：${leftoverError.message}`);
    } else if ((leftover ?? 0) > 0) {
      console.error(`WARN: 清理后仍残留 ${leftover} 张测试订单`);
    } else if (deleted > 0) {
      console.log(`清理：删除 ${deleted} 个测试用户，订单随用户级联删除（无残留）`);
    }
  }

  const leftoverMappings: string[] = [];
  for (const openid of openids) {
    if ((await countMappings(openid)) !== 0) leftoverMappings.push(openid);
  }
  if (leftoverMappings.length > 0) {
    console.error(`WARN: 清理后仍残留映射：${leftoverMappings.join(", ")}`);
  }
}
