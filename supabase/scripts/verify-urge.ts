// Story 4.3 本地链路验证：催单加速（FR-P2-12；AD-6、AD-13）
//
// 为什么需要脚本：pgTAP 在单个事务里跑，而 now() 在事务内是固定的——「催单真的把出餐提前了、
// 提前后的订单真的更早被推进」这类跨事务的时间行为测不了（数据库测试覆盖函数行为与拒绝语义，
// 见 tests/database/92_urge.test.sql）。本脚本用真实 HTTP + 真实会话走完整链路：
//   1. 下单（原定 ready_delay_seconds 秒后）；
//   2. 催单 → 裸表读确认 ready_at 被提前到「催单时刻 + urge_lead_seconds」、状态仍制作中；
//   3. 并发再催两次 → 请求都成功、ready_at 完全不变（min 语义：不更早也不更晚）；
//   4. 之后只做裸表读轮询（不触发读时推进）：订单在「新的到点时刻 + 一个扫描周期」内被兜底扫描
//      推进——改状态的只可能是周期任务（见迁移 20260922130629_advance_due_orders_cron.sql）；
//   5. 推进后再次催单 → 明确的 invalid_status。
//
// 需要本地栈在跑（supabase start），且已应用迁移与种子（supabase db reset）。
// 运行：cd supabase && deno task verify:urge
// 会话走平台标准机制（service role 建用户 + 密码登录）；结束（含失败）时删除测试用户，订单随用户
// 级联删除。不清理 pickup_code_counters：它是「下一个取杯号」的唯一来源，手工删除会让新号撞上
// 已存在订单的号，使后续每一次扫描都失败、订单永久卡在「制作中」。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../types/database.types.ts";
import { createServiceClient } from "../functions/wechat-login/identity.ts";

type Client = SupabaseClient<Database>;

/** 轮询间隔：秒级即可分辨「到点后第几个扫描周期被推进」。 */
const POLL_INTERVAL_MS = 1_000;
/** 轮询上限：扫描周期 15 秒 + 轮询间隔 + 容错。 */
const TIMEOUT_MS = 45_000;

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

async function createVerifyUser(): Promise<VerifyUser> {
  const email = `verify-urge-${crypto.randomUUID()}@wechat.local`;
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
  pickup_code: string | null;
  created_at: string;
  ready_at: string;
};

type OrderResult = {
  id: string;
  order_number: string;
  status: string;
  pickup_code: string | null;
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
    .select("status, pickup_code, created_at, ready_at")
    .eq("id", orderId)
    .single();
  if (error !== null) throw error;
  return data as OrderRow;
}

/** 秒数差（毫秒精度），用于打印证据。 */
function secondsBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 1000;
}

const user = await createVerifyUser();

try {
  // 门店配置（公开读）：推进时长与催单提前量都从这里取，不写死演示值
  const { data: store, error: storeError } = await user.client
    .from("stores")
    .select("id, timezone, ready_delay_seconds, urge_lead_seconds")
    .single();
  if (storeError !== null) throw storeError;
  console.log(
    `门店时区 ${store.timezone}，推进时长 ${store.ready_delay_seconds} 秒，催单提前量 ${store.urge_lead_seconds} 秒`,
  );

  // 1) 真实 HTTP + 真实会话下一单
  const product = await pickOnSaleProduct(user.client);
  const { data: created, error: createError } = await user.client.rpc("create_order", {
    p_items: [{
      product_id: product.id,
      quantity: 1,
      selections: selectionsFor(product),
    }],
    p_dining_mode: "takeout",
    p_notes: "催单验证",
    p_idempotency_key: `verify-urge-${crypto.randomUUID()}`,
  });
  if (createError !== null) throw createError;
  const order = asOrderResult(created);

  const placedRow = await readOrderRow(user.client, order.id);
  check(
    order.status === "cooking" && order.pickup_code !== null &&
      /^[A-Z]-[0-9]{4}$/.test(order.pickup_code),
    `下单瞬间是「制作中」且已带取杯号（${order.pickup_code}，订单号 ${order.order_number}）`,
  );
  check(
    Math.abs(
      secondsBetween(placedRow.created_at, placedRow.ready_at) -
        store.ready_delay_seconds,
    ) < 0.05,
    `催单前到点时刻 = 下单时刻 + 门店配置的 ${store.ready_delay_seconds} 秒`,
  );

  // 2) 催单：真实 HTTP 调用，随后裸表读确认
  const urgeStartedAt = Date.now();
  const { data: urged, error: urgeError } = await user.client.rpc("urge_order", {
    p_order_id: order.id,
  });
  const urgeFinishedAt = Date.now();
  if (urgeError !== null) throw urgeError;
  const urgedOrder = asOrderResult(urged);
  check(
    urgedOrder.id === order.id && urgedOrder.status === "cooking" &&
      urgedOrder.pickup_code === order.pickup_code,
    "催单返回与下单共用的订单形状：同一张单、状态仍制作中、取杯号不变",
  );

  const urgedRow = await readOrderRow(user.client, order.id);
  check(
    Date.parse(urgedRow.ready_at) < Date.parse(placedRow.ready_at),
    `催单把推进时刻提前（${placedRow.ready_at} → ${urgedRow.ready_at}）`,
  );
  const urgedDelayMs = Date.parse(urgedRow.ready_at) - urgeFinishedAt;
  check(
    urgedDelayMs >= store.urge_lead_seconds * 1_000 - 1_500 &&
      urgedDelayMs <= store.urge_lead_seconds * 1_000 + 1_500,
    `提前到「催单时刻 + 门店配置的 ${store.urge_lead_seconds} 秒」（催单请求往返占用 ${urgeFinishedAt - urgeStartedAt} 毫秒）`,
  );
  check(
    urgedRow.status === "cooking" && urgedRow.pickup_code === order.pickup_code,
    "催单不改状态、也不改写取杯号：订单没有直接变成待取餐",
  );

  // 3) 并发再催两次：都成功，且推进时刻完全不变
  const [concurrentA, concurrentB] = await Promise.all([
    user.client.rpc("urge_order", { p_order_id: order.id }),
    user.client.rpc("urge_order", { p_order_id: order.id }),
  ]);
  check(
    concurrentA.error === null && concurrentB.error === null,
    "并发重复催单都成功（不报错）",
  );
  const afterConcurrentRow = await readOrderRow(user.client, order.id);
  check(
    afterConcurrentRow.ready_at === urgedRow.ready_at,
    "并发重复催单后推进时刻完全不变（min 语义：既不更早也不更晚）",
  );

  // 4) 只做裸表读轮询：订单应在「新的到点时刻 + 一个扫描周期」内被周期任务自己推进
  let finalRow: OrderRow | null = null;
  while (Date.now() - urgeFinishedAt < TIMEOUT_MS) {
    finalRow = await readOrderRow(user.client, order.id);
    if (finalRow.status !== "cooking") break;
    await sleep(POLL_INTERVAL_MS);
  }
  if (finalRow === null || finalRow.status === "cooking") {
    throw new Error(
      `FAIL: 订单在 ${TIMEOUT_MS / 1000} 秒内没有被推进——请确认已应用迁移（supabase migration up / db reset），` +
        "并用 `select * from cron.job_run_details order by runid desc limit 5` 检查本地 pg_cron 是否在跑",
    );
  }
  const flipElapsedMs = Date.now() - urgeFinishedAt;
  check(
    flipElapsedMs >= store.urge_lead_seconds * 1_000,
    `推进发生在新的到点时刻之后（催单后 ${(flipElapsedMs / 1_000).toFixed(1)} 秒 ≥ ${store.urge_lead_seconds} 秒）`,
  );
  check(
    flipElapsedMs <= (store.urge_lead_seconds + 15) * 1_000 + 6_000,
    `推进发生在「到点 + 一个扫描周期」内（${(flipElapsedMs / 1_000).toFixed(1)} 秒 ≤ ${store.urge_lead_seconds + 15 + 6} 秒）`,
  );
  check(
    finalRow.pickup_code === order.pickup_code,
    `推进不改写取杯号：仍是下单时的 ${finalRow.pickup_code}`,
  );

  // 5) 推进之后催单：本人但状态不可催 → 明确的 invalid_status
  const { error: afterError } = await user.client.rpc("urge_order", {
    p_order_id: order.id,
  });
  check(
    afterError !== null && afterError.message === "invalid_status",
    "推进后再次催单返回明确的 invalid_status（不是笼统的失败）",
  );

  console.log(
    `PASS：${checks.length} 项断言全部通过（订单 ${order.order_number} 催单后 ` +
      `${(flipElapsedMs / 1_000).toFixed(1)} 秒被兜底扫描推进为「待取餐」，取杯号 ${finalRow.pickup_code}）`,
  );
  for (const label of checks) console.log(`  ✓ ${label}`);
} finally {
  const { error: deleteError } = await serviceClient.auth.admin.deleteUser(user.id);
  if (deleteError !== null) {
    console.error(`WARN: 删除测试用户失败（${user.email}）：${deleteError.message}`);
  } else {
    console.log(
      "清理：删除测试用户，订单随用户级联删除；取杯号计数器保留（手工删除会让新号撞上已有订单）",
    );
  }
}
