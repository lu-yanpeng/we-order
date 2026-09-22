// Story 4.2 本地链路验证：周期兜底扫描（FR-P2-11；AR-6、AR-13、AR-19）
//
// 任务声明本身由数据库测试覆盖（tests/database/91_cron_sweep.test.sql）；「时间到了任务真的会跑、
// 无人读取时订单也会被推进」需要一个扫描周期，pgTAP 在事务里等不到（定时器在另一个会话，看不见
// 未提交数据），按 FR-P2-19 用本脚本做人工验证。
//
// 实现方式说明（为什么这就是「无人读取也会推进」的证据）：
//   1. 通过真实 HTTP + 真实会话调 create_order 下一单，随后本脚本不做任何写操作；
//   2. 轮询用的是「裸表读」（PostgREST 直接 SELECT public.orders），不是订单读取函数——
//      Phase 2 的读时推进只存在于服务端读取函数里（Story 5.1），裸表读不会触发推进；
//   3. 订单在「到点 + 一个扫描周期」内自己变成「待取餐」，只可能来自 cron 兜底扫描
//      （本地栈的 pg_cron 任务，见迁移 20260922130629_advance_due_orders_cron.sql）；
//      取杯号在下单时已拿到，推进只改状态、不改写它（Story 4.4）。
//
// 需要本地栈在跑（supabase start），且已应用迁移与种子（supabase db reset）。
// 运行：cd supabase && deno task verify:sweep
// 会话走平台标准机制（service role 建用户 + 密码登录）；结束（含失败）时删除测试用户，订单随用户
// 级联删除。不清理 pickup_code_counters：它是「下一个取杯号」的唯一来源，手工删除会让新号撞上
// 已存在订单的号，使后续每一次扫描都失败、订单永久卡在「制作中」。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../types/database.types.ts";
import { createServiceClient } from "../functions/wechat-login/identity.ts";

type Client = SupabaseClient<Database>;

/** 轮询间隔：秒级即可分辨「到点后第几个扫描周期被推进」。 */
const POLL_INTERVAL_MS = 1_000;
/** 轮询上限：超过它仍然没被推进，说明兜底扫描没在跑（或迁移未应用）。 */
const TIMEOUT_MS = 75_000;

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
  const email = `verify-sweep-${crypto.randomUUID()}@wechat.local`;
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

// ── 订单行：裸表读的形状（postgrest SELECT public.orders） ─────────────────────

type OrderRow = {
  status: string;
  pickup_code: string | null;
  pickup_code_date: string | null;
  created_at: string;
  ready_at: string;
  store_id: string;
};

type OrderResult = {
  id: string;
  order_number: string;
  status: string;
  pickup_code: string | null;
};

function asOrderResult(data: Json | null): OrderResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("下单 RPC 的返回形状不是对象");
  }
  return data as unknown as OrderResult;
}

/** 门店本地自然日（AD-10：门店时区是唯一时区来源）。 */
function localDateIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const user = await createVerifyUser();

try {
  // 门店配置（公开读）：推进时长与门店时区都从这里取，不写死演示值
  const { data: store, error: storeError } = await user.client
    .from("stores")
    .select("id, timezone, ready_delay_seconds")
    .single();
  if (storeError !== null) throw storeError;
  console.log(
    `门店时区 ${store.timezone}，推进时长 ${store.ready_delay_seconds} 秒；扫描周期 15 秒（见迁移声明）`,
  );

  // 1) 真实 HTTP + 真实会话下一单
  const product = await pickOnSaleProduct(user.client);
  const idempotencyKey = `verify-sweep-${crypto.randomUUID()}`;
  const { data: created, error: createError } = await user.client.rpc("create_order", {
    p_items: [{
      product_id: product.id,
      quantity: 1,
      selections: selectionsFor(product),
    }],
    p_dining_mode: "takeout",
    p_notes: "兜底扫描验证",
    p_idempotency_key: idempotencyKey,
  });
  if (createError !== null) throw createError;
  const order = asOrderResult(created);
  check(
    order.status === "cooking" && order.pickup_code !== null &&
      /^[A-Z]-[0-9]{4}$/.test(order.pickup_code),
    `下单瞬间是「制作中」且已带取杯号（${order.pickup_code}，订单号 ${order.order_number}）`,
  );

  // 2) 只做裸表读轮询：不是订单读取函数，不会触发读时推进
  const startedAt = performance.now();
  let firstRow: OrderRow | null = null;
  let lastCookingElapsedMs = 0;
  let finalRow: OrderRow | null = null;

  while (performance.now() - startedAt < TIMEOUT_MS) {
    const { data: row, error: pollError } = await user.client
      .from("orders")
      .select("status, pickup_code, pickup_code_date, created_at, ready_at, store_id")
      .eq("id", order.id)
      .single();
    if (pollError !== null) throw pollError;

    const elapsedMs = performance.now() - startedAt;
    if (firstRow === null) firstRow = row as OrderRow;
    finalRow = row as OrderRow;
    if (row.status === "cooking") {
      lastCookingElapsedMs = elapsedMs;
    } else {
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (firstRow === null || finalRow === null) {
    throw new Error("FAIL: 轮询没有拿到订单行");
  }
  const elapsedMs = Math.round(performance.now() - startedAt);

  if (finalRow.status === "cooking") {
    throw new Error(
      `FAIL: 订单在 ${TIMEOUT_MS / 1000} 秒内没有被推进——请确认已应用迁移（supabase migration up / db reset），` +
        "并用 `select * from cron.job_run_details order by runid desc limit 5` 检查本地 pg_cron 是否在跑",
    );
  }

  // 3) 断言：推进时刻之前不动，推进后状态变化、取杯号原样
  check(
    firstRow.status === "cooking" && firstRow.pickup_code === order.pickup_code,
    "轮询起点仍是「制作中」且取杯号不变（改状态的不是读取，裸表读不触发推进）",
  );

  const delaySeconds = Math.abs(
    (Date.parse(firstRow.ready_at) - Date.parse(firstRow.created_at)) / 1000,
  );
  check(
    Math.abs(delaySeconds - store.ready_delay_seconds) < 0.05,
    `到点时刻 = 下单时刻 + 门店配置的 ${store.ready_delay_seconds} 秒（推进时长没有被绕过）`,
  );

  const earliestFlipMs = (store.ready_delay_seconds - 1) * 1000;
  check(
    lastCookingElapsedMs >= earliestFlipMs,
    `到点前一直保持「制作中」（最后一次观察到制作中在 ${(lastCookingElapsedMs / 1000).toFixed(1)} 秒，` +
      `不早于 ${(earliestFlipMs / 1000).toFixed(0)} 秒）`,
  );

  check(
    finalRow.status === "pickup",
    `订单被周期扫描推进为「待取餐」（观察用时 ${(elapsedMs / 1000).toFixed(1)} 秒）`,
  );

  // 上界：到点(15s) + 一个扫描周期(15s) + 轮询间隔(1s) + 调度抖动余量
  const latestFlipMs = (store.ready_delay_seconds + 15) * 1000 + 6_000;
  check(
    elapsedMs <= latestFlipMs,
    `推进发生在「到点 + 一个扫描周期」内（${(elapsedMs / 1000).toFixed(1)} 秒 ≤ ${(latestFlipMs / 1000).toFixed(0)} 秒）`,
  );

  check(
    finalRow.pickup_code === order.pickup_code,
    `推进不改写取杯号：仍是下单时的 ${finalRow.pickup_code}`,
  );
  check(
    finalRow.pickup_code_date === localDateIn(store.timezone),
    `发号日期是门店本地自然日（${finalRow.pickup_code_date}）`,
  );

  console.log(
    `PASS：${checks.length} 项断言全部通过（订单 ${order.order_number} 在 ${(elapsedMs / 1000).toFixed(1)} 秒` +
      `后被兜底扫描推进，取杯号 ${finalRow.pickup_code}）`,
  );
  for (const label of checks) console.log(`  ✓ ${label}`);
  console.log(
    "如需运行历史：docker exec supabase_db_we-order psql -U postgres -d postgres -c " +
      '"select jobid, runid, status, return_message, start_time from cron.job_run_details order by runid desc limit 5;"',
  );
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
