// Story 4.6 本地链路验证：状态机与并发行为（FR-P2-19；AD-6、AD-7）
//
// 为什么需要脚本：pgTAP 在单个事务里跑、now() 在事务内固定——「催单与推进同时到达、
// 确认取杯与超时兜底在同一时刻竞争、多个兜底调用并发跑」这类跨事务的真并发测不了
// （数据库测试覆盖迁移矩阵、终态吸收、完整生命周期与整表快照重跑，见
// tests/database/94_state_machine.test.sql）。按 FR-P2-19，并发行为以「实现方式说明 +
// 人工验证记录」作证据，本脚本就是那份现场记录。四轮竞态：
//   1) 催单 vs 推进：到点瞬间重复催单与并发推进，结果由提交顺序收敛，不产生中间态；
//   2) 确认取杯 vs 推进：确认要么基于已推进的状态完成、要么得到明确的 invalid_status；
//   3) 确认取杯 vs 超时兜底：完成时间只写一次，之后重复确认与重跑都不改动它；
//   4) 并发兜底重跑：多个推进/超时调用同时打，一条订单至多迁移一次；重跑 (0,0)、整表快照不变。
//
// 并发通道：推进与超时兜底不向客户端暴露（pgTAP 已断言 anon/authenticated 不可执行），
// 脚本用 service_role 调用它们——服务端钥匙不是客户端边界的一部分，它模拟的是
// 「周期扫描正在跑」。用户操作（催单、确认取杯）仍走真实会话与真实 HTTP。
//
// 演示参数：脚本开始时临时把门店的推进时长/催单提前量/自动完成时长调小（结束恢复，含失败时），
// 顺带证明这些配置确实被服务端读取而不是写死。
//
// 需要本地栈在跑（supabase start），且已应用迁移与种子（supabase db reset）。
// 运行：cd supabase && deno task verify:state-machine
// 会话走平台标准机制（service role 建用户 + 密码登录）；结束（含失败）时删除测试用户，订单随用户
// 级联删除。不清理 pickup_code_counters：它是「下一个取杯号」的唯一来源，手工删除会让新号撞上
// 已存在订单的号，使后续每一次扫描都失败。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../types/database.types.ts";
import { createServiceClient } from "../functions/wechat-login/identity.ts";

type Client = SupabaseClient<Database>;

/** 轮询间隔：秒级即可分辨状态是否已收敛。 */
const POLL_INTERVAL_MS = 500;
/** 轮询上限：到点 + 一个扫描周期 + 容错。 */
const TIMEOUT_MS = 60_000;
/** 脚本临时使用的门店演示参数（结束恢复）。 */
const FAST_READY_DELAY_SECONDS = 4;
const FAST_URGE_LEAD_SECONDS = 2;
const FAST_AUTO_COMPLETE_SECONDS = 4;
const SLOW_AUTO_COMPLETE_SECONDS = 600;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 睡到目标时刻（已过则不睡）。 */
async function sleepUntil(targetMs: number): Promise<void> {
  await sleep(targetMs - Date.now());
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

// ── 测试用户：service role 建用户，再走平台标准会话登录 ─────────────────────────

type VerifyUser = { id: string; email: string; client: Client };

async function createVerifyUser(prefix: string): Promise<VerifyUser> {
  const email = `${prefix}-${crypto.randomUUID()}@wechat.local`;
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

// ── 订单行：裸表读的形状（PostgREST 直接 SELECT public.orders） ─────────────────

type OrderRow = {
  status: string;
  pickup_code: string;
  ready_at: string;
  auto_complete_at: string | null;
  completed_at: string | null;
};

type OrderResult = {
  id: string;
  order_number: string;
  status: string;
  pickup_code: string;
};

function asOrderResult(data: Json | null): OrderResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("订单 RPC 的返回形状不是对象");
  }
  return data as unknown as OrderResult;
}

async function readOrderRow(client: Client, orderId: string): Promise<OrderRow> {
  const { data, error } = await client
    .from("orders")
    .select("status, pickup_code, ready_at, auto_complete_at, completed_at")
    .eq("id", orderId)
    .single();
  if (error !== null) throw error;
  return data as OrderRow;
}

/** 以 service role 读全表快照：用于「重跑不破坏已有数据」的逐行比对。 */
async function readAllRows(): Promise<string> {
  const { data, error } = await serviceClient
    .from("orders")
    .select(
      "id, order_number, status, pickup_code, pickup_code_date, ready_at, auto_complete_at, completed_at, created_at",
    )
    .order("id");
  if (error !== null) throw error;
  return JSON.stringify(data);
}

/** 只做裸表读轮询：不是订单读取函数，不会触发任何服务端函数。 */
async function waitForStatus(
  client: Client,
  orderId: string,
  target: string,
  label: string,
): Promise<OrderRow> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < TIMEOUT_MS) {
    const row = await readOrderRow(client, orderId);
    if (row.status === target) return row;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `FAIL: ${label}——订单在 ${TIMEOUT_MS / 1000} 秒内没有变成「${target}」。` +
      "请确认本地栈在跑、迁移已应用（supabase db reset），并用 " +
      "`select * from cron.job_run_details order by runid desc limit 5` 检查本地 pg_cron 是否在跑",
  );
}

/** 下单辅助：真实 HTTP + 真实会话。 */
async function placeOrder(
  user: VerifyUser,
  product: MenuProduct,
  notes: string,
): Promise<OrderResult> {
  const { data, error } = await user.client.rpc("create_order", {
    p_items: [{
      product_id: product.id,
      quantity: 1,
      selections: selectionsFor(product),
    }],
    p_dining_mode: "takeout",
    p_notes: notes,
    p_idempotency_key: `verify-state-machine-${crypto.randomUUID()}`,
  });
  if (error !== null) throw error;
  return asOrderResult(data);
}

/** 推进机制（service role）：脚本里代表「周期扫描正在跑」。 */
async function sweepAdvance(): Promise<number> {
  const { data, error } = await serviceClient.rpc("advance_due_orders", {});
  if (error !== null) throw error;
  return data;
}

/** 超时兜底（service role）：与推进同一个扫描任务里的另一个机制。 */
async function sweepComplete(): Promise<number> {
  const { data, error } = await serviceClient.rpc("complete_due_orders", {});
  if (error !== null) throw error;
  return data;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

const users: VerifyUser[] = [];
let storeRestore:
  | {
    id: string;
    ready_delay_seconds: number;
    urge_lead_seconds: number;
    auto_complete_seconds: number;
  }
  | null = null;

try {
  const userA = await createVerifyUser("verify-state-machine-a");
  users.push(userA);

  // 门店配置（公开读）：演示参数从这里取；临时调小以便按秒观察，结束恢复。
  const { data: store, error: storeError } = await userA.client
    .from("stores")
    .select("id, timezone, ready_delay_seconds, urge_lead_seconds, auto_complete_seconds")
    .single();
  if (storeError !== null) throw storeError;
  storeRestore = {
    id: store.id,
    ready_delay_seconds: store.ready_delay_seconds,
    urge_lead_seconds: store.urge_lead_seconds,
    auto_complete_seconds: store.auto_complete_seconds,
  };

  async function updateStore(patch: Record<string, number>): Promise<void> {
    const { error } = await serviceClient.from("stores").update(patch).eq("id", store.id);
    if (error !== null) throw error;
  }

  // 第一、二轮不参与超时完成：自动完成时长先放到 600 秒；第三轮再调小。
  await updateStore({
    ready_delay_seconds: FAST_READY_DELAY_SECONDS,
    urge_lead_seconds: FAST_URGE_LEAD_SECONDS,
    auto_complete_seconds: SLOW_AUTO_COMPLETE_SECONDS,
  });
  console.log(
    `门店演示参数临时调小：推进 ${store.ready_delay_seconds} → ${FAST_READY_DELAY_SECONDS} 秒、` +
      `催单提前量 ${store.urge_lead_seconds} → ${FAST_URGE_LEAD_SECONDS} 秒、` +
      `自动完成 ${store.auto_complete_seconds} → ${SLOW_AUTO_COMPLETE_SECONDS} 秒（第三轮再调整为 ` +
      `${FAST_AUTO_COMPLETE_SECONDS} 秒；结束全部恢复）`,
  );

  const product = await pickOnSaleProduct(userA.client);

  // ── 1) 催单 vs 推进：到点瞬间的重复催单与并发推进 ─────────────────────────

  const o1 = await placeOrder(userA, product, "竞态：催单 vs 推进");
  const placed1 = await readOrderRow(userA.client, o1.id);
  check(
    placed1.status === "cooking" && placed1.pickup_code === o1.pickup_code &&
      placed1.completed_at === null,
    `下单瞬间：制作中、已带取杯号（${o1.pickup_code}）`,
  );

  const firstUrge = await userA.client.rpc("urge_order", { p_order_id: o1.id });
  check(firstUrge.error === null, "第一次催单成功（制作中、尚未到点）");
  const afterFirstUrge = await readOrderRow(userA.client, o1.id);
  const originalReadyAtMs = Date.parse(placed1.ready_at);
  const urgedReadyAtMs = Date.parse(afterFirstUrge.ready_at);
  check(
    urgedReadyAtMs <= originalReadyAtMs && originalReadyAtMs - urgedReadyAtMs >= 500,
    "催单把推进时刻提前到「催单时刻 + 门店提前量」：不晚于原定时刻，且确实提前了",
  );

  // 等到催单后的到点时刻，把重复催单与推进同时发出
  await sleepUntil(urgedReadyAtMs + 80);
  const [u11, u12, adv11, adv12, adv13] = await Promise.all([
    userA.client.rpc("urge_order", { p_order_id: o1.id }),
    userA.client.rpc("urge_order", { p_order_id: o1.id }),
    sweepAdvance(),
    sweepAdvance(),
    sweepAdvance(),
  ]);
  const urgeResults1 = [u11, u12];
  check(
    urgeResults1.every((r) => r.error === null || r.error.message === "invalid_status"),
    "与推进并发：重复催单要么成功、要么得到明确的 invalid_status（没有笼统失败）",
  );
  check(
    adv11 + adv12 + adv13 <= 1,
    `并发推进合计 ${adv11 + adv12 + adv13} ≤ 1：同一条订单至多被一个调用推进一次`,
  );

  const settled1 = await waitForStatus(userA.client, o1.id, "pickup", "竞态后进入待取餐");
  check(
    settled1.pickup_code === o1.pickup_code,
    `竞态后取杯号不变：仍是 ${settled1.pickup_code}`,
  );
  check(settled1.completed_at === null, "竞态后没有跳级：completed_at 仍为空");
  check(
    Date.parse(settled1.ready_at) === urgedReadyAtMs,
    "重复催单既不更早也不更晚：ready_at 与第一次催单后完全一致",
  );

  // ── 2) 确认取杯 vs 推进：待取餐边界上的竞态 ───────────────────────────────

  const o2 = await placeOrder(userA, product, "竞态：确认 vs 推进");
  const placed2 = await readOrderRow(userA.client, o2.id);
  await sleepUntil(Date.parse(placed2.ready_at) + 80);

  const [c21, c22, adv21, adv22] = await Promise.all([
    userA.client.rpc("complete_order", { p_order_id: o2.id }),
    userA.client.rpc("complete_order", { p_order_id: o2.id }),
    sweepAdvance(),
    sweepAdvance(),
  ]);
  const confirmResults2 = [c21, c22];
  check(
    confirmResults2.every((r) => r.error === null || r.error.message === "invalid_status"),
    "与推进并发：确认取杯要么基于已推进的状态完成、要么得到明确的 invalid_status",
  );
  check(
    adv21 + adv22 <= 1,
    `并发推进合计 ${adv21 + adv22} ≤ 1：确认与推进同场时，订单至多被迁移一次`,
  );

  const settled2 = await readOrderRow(userA.client, o2.id);
  check(
    settled2.status === "pickup" || settled2.status === "completed",
    `竞态收敛为一个确定的状态：${settled2.status}（不存在中间态）`,
  );
  check(
    settled2.pickup_code === o2.pickup_code,
    `竞态后取杯号不变：仍是 ${settled2.pickup_code}`,
  );
  check(
    !confirmResults2.some((r) => r.error === null) || settled2.status === "completed",
    "确认成功的调用确实把订单置为已完成（成功语义与最终状态一致）",
  );
  check(
    settled2.status !== "completed" || settled2.completed_at !== null,
    "已完成状态下完成时间有值（由服务端写入）",
  );

  // ── 3) 确认取杯 vs 超时兜底：完成时间只写一次 ─────────────────────────────

  // 新订单进入待取餐时按门店配置算自动完成时刻：先把自动完成时长调到 4 秒
  await updateStore({ auto_complete_seconds: FAST_AUTO_COMPLETE_SECONDS });

  const o3 = await placeOrder(userA, product, "竞态：确认 vs 超时兜底");
  const o3Pickup = await waitForStatus(userA.client, o3.id, "pickup", "等待第三张单进入待取餐");
  if (o3Pickup.auto_complete_at === null) {
    throw new Error("FAIL: 进入待取餐却没有落库自动完成时刻");
  }

  // 在自动完成时刻上把确认与兜底同时发出
  await sleepUntil(Date.parse(o3Pickup.auto_complete_at));
  const [c31, c32, comp31, comp32] = await Promise.all([
    userA.client.rpc("complete_order", { p_order_id: o3.id }),
    userA.client.rpc("complete_order", { p_order_id: o3.id }),
    sweepComplete(),
    sweepComplete(),
  ]);
  const confirmResults3 = [c31, c32];
  check(
    confirmResults3.every((r) => r.error === null || r.error.message === "invalid_status"),
    "与超时兜底并发：确认取杯要么成功、要么得到明确的 invalid_status",
  );

  const settled3 = await readOrderRow(userA.client, o3.id);
  check(
    settled3.status === "completed" && settled3.completed_at !== null,
    "竞态收敛：订单已完成、完成时间由服务端写入（确认与兜底两条路径只写一次）",
  );
  check(
    settled3.pickup_code === o3.pickup_code,
    `超时完成/确认不改写取杯号：仍是 ${settled3.pickup_code}`,
  );

  const completedAt3 = settled3.completed_at;
  const [c33, comp33, comp34] = await Promise.all([
    userA.client.rpc("complete_order", { p_order_id: o3.id }),
    sweepComplete(),
    sweepComplete(),
  ]);
  check(c33.error === null, "确认一张已完成（已被兜底完成）的订单：返回成功");
  const afterRerun3 = await readOrderRow(userA.client, o3.id);
  check(
    afterRerun3.completed_at === completedAt3,
    "完成时间一经写入不再改动：重复确认与重跑兜底都不改写它",
  );

  // ── 4) 并发兜底重跑：至多迁移一次、重跑 (0,0)、整表快照不变 ────────────────

  await updateStore({
    ready_delay_seconds: FAST_READY_DELAY_SECONDS,
    auto_complete_seconds: SLOW_AUTO_COMPLETE_SECONDS,
  });

  const o4 = await placeOrder(userA, product, "并发兜底：甲");
  const o5 = await placeOrder(userA, product, "并发兜底：乙");
  const placed4 = await readOrderRow(userA.client, o4.id);
  await sleepUntil(Date.parse(placed4.ready_at) + 60);

  const [row4, row5] = await Promise.all([
    readOrderRow(userA.client, o4.id),
    readOrderRow(userA.client, o5.id),
  ]);
  const cookingBefore = [row4, row5].filter((row) => row.status === "cooking").length;

  const [a41, a42, a43, m41, m42, m43] = await Promise.all([
    sweepAdvance(),
    sweepAdvance(),
    sweepAdvance(),
    sweepComplete(),
    sweepComplete(),
    sweepComplete(),
  ]);
  check(
    a41 + a42 + a43 <= cookingBefore,
    `并发推进合计 ${a41 + a42 + a43} ≤ 并发前仍制作中的 ${cookingBefore} 条：每条订单至多迁移一次`,
  );
  check(
    m41 + m42 + m43 === 0,
    "并发超时兜底没有可完成的订单：未到点的不被提前完成",
  );

  const final4 = await readOrderRow(userA.client, o4.id);
  const final5 = await readOrderRow(userA.client, o5.id);
  check(
    final4.status === "pickup" && final5.status === "pickup",
    "并发推进后两张单都进入待取餐（不跳状态）",
  );
  check(
    final4.completed_at === null && final5.completed_at === null,
    "没有跳级：两张单的完成时间仍为空",
  );
  check(
    final4.pickup_code === o4.pickup_code && final5.pickup_code === o5.pickup_code &&
      final4.pickup_code !== final5.pickup_code,
    `并发推进不改写取杯号，且两号互不相同（${final4.pickup_code} / ${final5.pickup_code}）`,
  );

  const ordersAfterRace = await readAllRows();
  const [ra1, ra2, ra3, rm1, rm2, rm3] = await Promise.all([
    sweepAdvance(),
    sweepAdvance(),
    sweepAdvance(),
    sweepComplete(),
    sweepComplete(),
    sweepComplete(),
  ]);
  check(
    [ra1, ra2, ra3, rm1, rm2, rm3].every((count) => count === 0),
    "重跑 (0,0)：没有可推进、可完成的订单（幂等、可重跑）",
  );
  check(
    (await readAllRows()) === ordersAfterRace,
    "重跑不破坏已有数据：整表快照一字不变（完成时间、取杯号、时刻都不被改写）",
  );

  console.log(`PASS：${checks.length} 项断言全部通过`);
  for (const label of checks) console.log(`  ✓ ${label}`);
} finally {
  if (storeRestore !== null) {
    const { error: restoreError } = await serviceClient.from("stores")
      .update({
        ready_delay_seconds: storeRestore.ready_delay_seconds,
        urge_lead_seconds: storeRestore.urge_lead_seconds,
        auto_complete_seconds: storeRestore.auto_complete_seconds,
      })
      .eq("id", storeRestore.id);
    if (restoreError !== null) {
      console.error(`WARN: 恢复门店演示参数失败：${restoreError.message}`);
    } else {
      console.log(
        `清理：门店演示参数已恢复（推进 ${storeRestore.ready_delay_seconds} 秒、` +
          `催单提前量 ${storeRestore.urge_lead_seconds} 秒、` +
          `自动完成 ${storeRestore.auto_complete_seconds} 秒）`,
      );
    }
  }

  for (const user of users) {
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(user.id);
    if (deleteError !== null) {
      console.error(`WARN: 删除测试用户失败（${user.email}）：${deleteError.message}`);
    } else {
      console.log(`清理：删除测试用户 ${user.email}，订单随用户级联删除`);
    }
  }
  console.log("清理：取杯号计数器保留（手工删除会让新号撞上已有订单）");
}
