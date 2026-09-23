// Story 4.5 本地链路验证：确认取杯与超时自动完成（FR-P2-13；AD-5、AD-6、AD-13、AR-13）
//
// 为什么需要脚本：pgTAP 在单个事务里跑，而 now() 在事务内是固定的——「并发两次确认只写一次完成时间、
// 没人点确认时订单真的会自己完成、时间到了才完成」这类跨事务的行为测不了（数据库测试覆盖函数行为、
// 拒绝语义与落库时刻公式，见 tests/database/93_complete.test.sql）。本脚本用真实 HTTP + 真实会话走
// 完整链路：
//   1. 下单后立刻确认取杯 → 明确的 invalid_status（还没到待取餐）；不存在 / 他人的单 → 同一结果；
//   2. 两张单在无人操作下被周期扫描推进为「待取餐」，自动完成时刻 = 进入时刻 + 门店配置；
//   3. 第一张并发两次确认 → 都成功、完成时间只写一次；重复确认不改写它；
//   4. 第二张不点确认 → 由周期扫描超时自动完成；期间只做裸表读轮询（不调任何订单 RPC），
//      且把门店配置改成 600 秒证明「改配置不影响已出的单、时刻是落库数据」；
//   5. 确认一张已自动完成的订单 → 成功且不改写完成时间。
//
// 演示参数：默认（推进 15 秒 + 自动完成 30 秒）下脚本要等一分钟以上才能观察到自动完成；
// 脚本开始时临时把门店的 ready_delay_seconds / auto_complete_seconds 调小（结束恢复，含失败时），
// 顺带用它证明自动完成时刻确实按门店配置计算而不是写死。
//
// 需要本地栈在跑（supabase start），且已应用迁移与种子（supabase db reset）。
// 运行：cd supabase && deno task verify:complete
// 会话走平台标准机制（service role 建用户 + 密码登录）；结束（含失败）时删除测试用户，订单随用户
// 级联删除。不清理 pickup_code_counters：它是「下一个取杯号」的唯一来源，手工删除会让新号撞上
// 已存在订单的号，使后续每一次扫描都失败。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../types/database.types.ts";
import { createServiceClient } from "../functions/wechat-login/identity.ts";

type Client = SupabaseClient<Database>;

/** 轮询间隔：秒级即可分辨「进入待取餐后第几个扫描周期完成」。 */
const POLL_INTERVAL_MS = 1_000;
/** 轮询上限：推进时长 + 自动完成时长 + 两个扫描周期 + 容错。 */
const TIMEOUT_MS = 60_000;
/** 脚本临时使用的门店演示参数（结束恢复）。 */
const FAST_READY_DELAY_SECONDS = 3;
const FAST_AUTO_COMPLETE_SECONDS = 5;

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
    .select("status, pickup_code, auto_complete_at, completed_at")
    .eq("id", orderId)
    .single();
  if (error !== null) throw error;
  return data as OrderRow;
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
    p_idempotency_key: `verify-complete-${crypto.randomUUID()}`,
  });
  if (error !== null) throw error;
  return asOrderResult(data);
}

const users: VerifyUser[] = [];
let storeRestore:
  | { id: string; ready_delay_seconds: number; auto_complete_seconds: number }
  | null = null;

try {
  const userA = await createVerifyUser("verify-complete-a");
  const userB = await createVerifyUser("verify-complete-b");
  users.push(userA, userB);

  // 门店配置（公开读）：演示参数从这里取；临时调小以便按秒观察，结束恢复。
  const { data: store, error: storeError } = await userA.client
    .from("stores")
    .select("id, timezone, ready_delay_seconds, auto_complete_seconds")
    .single();
  if (storeError !== null) throw storeError;
  storeRestore = {
    id: store.id,
    ready_delay_seconds: store.ready_delay_seconds,
    auto_complete_seconds: store.auto_complete_seconds,
  };

  const { error: fastError } = await serviceClient.from("stores")
    .update({
      ready_delay_seconds: FAST_READY_DELAY_SECONDS,
      auto_complete_seconds: FAST_AUTO_COMPLETE_SECONDS,
    })
    .eq("id", store.id);
  if (fastError !== null) throw fastError;
  console.log(
    `门店演示参数临时调小：推进 ${store.ready_delay_seconds} → ${FAST_READY_DELAY_SECONDS} 秒、` +
      `自动完成 ${store.auto_complete_seconds} → ${FAST_AUTO_COMPLETE_SECONDS} 秒（结束恢复）`,
  );

  // ── 下单辅助：真实 HTTP + 真实会话 ─────────────────────────────────────────

  const product = await pickOnSaleProduct(userA.client);

  // ── 1) 还没到待取餐：确认取杯得到明确结果（FR-P2-13）──────────────────────

  const o1 = await placeOrder(userA, product, "确认取杯验证");
  const { error: earlyError } = await userA.client.rpc("complete_order", {
    p_order_id: o1.id,
  });
  check(
    earlyError !== null && earlyError.message === "invalid_status",
    "制作中的订单确认取杯返回明确的 invalid_status（不是笼统的失败）",
  );
  const o1Placed = await readOrderRow(userA.client, o1.id);
  check(
    o1Placed.status === "cooking" && o1Placed.pickup_code === o1.pickup_code &&
      o1Placed.auto_complete_at === null,
    `下单瞬间：制作中、已带取杯号（${o1.pickup_code}）、还没有自动完成时刻`,
  );

  // ── 2) 拒绝语义：不存在与他人的单返回同一结果（AD-13）──────────────────────

  const { error: notFoundError } = await userA.client.rpc("complete_order", {
    p_order_id: crypto.randomUUID(),
  });
  check(
    notFoundError !== null && notFoundError.message === "order_not_found",
    "不存在的订单返回明确的 order_not_found",
  );

  const o2 = await placeOrder(userB, product, "他人订单验证");
  const { error: otherError } = await userA.client.rpc("complete_order", {
    p_order_id: o2.id,
  });
  check(
    otherError !== null && otherError.message === notFoundError?.message,
    "确认他人的订单与「不存在」返回完全相同的结果，不泄露存在性",
  );

  // ── 3) 无人操作时进入待取餐：自动完成时刻 = 进入时刻 + 门店配置（AD-6）──────

  const o3 = await placeOrder(userA, product, "自动完成验证");
  const o1Pickup = await waitForStatus(userA.client, o1.id, "pickup", "等待周期扫描推进");
  if (o1Pickup.auto_complete_at === null) {
    throw new Error("FAIL: 进入待取餐时没有落库自动完成时刻");
  }
  const o1DeadlineMs = Date.parse(o1Pickup.auto_complete_at);
  const remainingMs = o1DeadlineMs - Date.now();
  check(
    remainingMs > 2_500 && remainingMs < 6_000,
    `自动完成时刻 = 进入待取餐时刻 + 门店配置的 ${FAST_AUTO_COMPLETE_SECONDS} 秒` +
      `（检测到「待取餐」时还剩 ${(remainingMs / 1_000).toFixed(1)} 秒，不是默认的 30 秒）`,
  );

  // ── 4) 并发两次确认：都成功、完成时间只写一次（AD-13、AD-6）────────────────

  const [confirmA, confirmB] = await Promise.all([
    userA.client.rpc("complete_order", { p_order_id: o1.id }),
    userA.client.rpc("complete_order", { p_order_id: o1.id }),
  ]);
  check(
    confirmA.error === null && confirmB.error === null,
    "并发两次确认取杯都成功（一个真的完成、另一个按「目标状态已达成」返回）",
  );
  const o1Confirmed = await readOrderRow(userA.client, o1.id);
  if (o1Confirmed.completed_at === null) {
    throw new Error("FAIL: 确认后没有记录完成时间");
  }
  check(
    o1Confirmed.status === "completed",
    "确认后订单变为已完成、完成时间由服务端记录",
  );
  check(
    o1Confirmed.pickup_code === o1.pickup_code,
    `确认不改写取杯号（仍是 ${o1Confirmed.pickup_code}）`,
  );
  check(
    o1Confirmed.auto_complete_at === o1Pickup.auto_complete_at,
    "确认不改写进入待取餐时落库的自动完成时刻",
  );

  const { error: repeatError } = await userA.client.rpc("complete_order", {
    p_order_id: o1.id,
  });
  const o1Repeat = await readOrderRow(userA.client, o1.id);
  check(
    repeatError === null,
    "重复确认返回成功（目标状态已达成，不报错）",
  );
  check(
    o1Repeat.completed_at === o1Confirmed.completed_at,
    "重复确认不修改完成时间（仍是最早写入的那一次）",
  );

  // ── 5) 不点确认：进入待取餐后改配置，仍按落库时刻自动完成（FR-P2-13）────────

  const o3Pickup = await waitForStatus(userA.client, o3.id, "pickup", "等待第二张单进入待取餐");
  if (o3Pickup.auto_complete_at === null) {
    throw new Error("FAIL: 第二张单进入待取餐时没有落库自动完成时刻");
  }
  const o3DeadlineMs = Date.parse(o3Pickup.auto_complete_at);

  const { error: slowError } = await serviceClient.from("stores")
    .update({ auto_complete_seconds: 600 })
    .eq("id", store.id);
  if (slowError !== null) throw slowError;
  console.log("把门店的自动完成时长改成 600 秒：已进入待取餐的订单不应受影响");

  // 之后只做裸表读轮询：改状态的只可能是周期扫描（读时完成还没接线，属 Epic 5）
  const o3Completed = await waitForStatus(userA.client, o3.id, "completed", "等待超时兜底完成");
  if (o3Completed.completed_at === null) {
    throw new Error("FAIL: 自动完成后没有记录完成时间");
  }
  const o3CompletedMs = Date.parse(o3Completed.completed_at);
  check(
    o3CompletedMs >= o3DeadlineMs - 1_000,
    "自动完成发生在落库时刻之后：配置改成 600 秒后仍按 5 秒的落库时刻完成（时刻是数据、不是派生值）",
  );
  check(
    o3CompletedMs <= o3DeadlineMs + 21_000,
    `自动完成发生在「落库时刻 + 一个扫描周期」内（${((o3CompletedMs - o3DeadlineMs) / 1_000).toFixed(1)} 秒）`,
  );
  check(
    o3Completed.pickup_code === o3.pickup_code,
    `超时自动完成不改写取杯号：仍是下单时的 ${o3Completed.pickup_code}`,
  );

  const { error: afterAutoError } = await userA.client.rpc("complete_order", {
    p_order_id: o3.id,
  });
  const o3AfterConfirm = await readOrderRow(userA.client, o3.id);
  check(
    afterAutoError === null,
    "确认一张已由超时自动完成的订单：返回成功",
  );
  check(
    o3AfterConfirm.completed_at === o3Completed.completed_at,
    "自动完成的订单：确认不改写完成时间",
  );

  console.log(
    `PASS：${checks.length} 项断言全部通过（订单 ${o1.order_number} 并发确认后完成；` +
      `订单 ${o3.order_number} 在无人操作下按落库时刻自动完成，取杯号 ${o3Completed.pickup_code}）`,
  );
  for (const label of checks) console.log(`  ✓ ${label}`);
} finally {
  if (storeRestore !== null) {
    const { error: restoreError } = await serviceClient.from("stores")
      .update({
        ready_delay_seconds: storeRestore.ready_delay_seconds,
        auto_complete_seconds: storeRestore.auto_complete_seconds,
      })
      .eq("id", storeRestore.id);
    if (restoreError !== null) {
      console.error(`WARN: 恢复门店演示参数失败：${restoreError.message}`);
    } else {
      console.log(
        `清理：门店演示参数已恢复（推进 ${storeRestore.ready_delay_seconds} 秒、` +
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
