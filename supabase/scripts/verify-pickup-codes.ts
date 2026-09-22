// Story 4.4 本地链路验证：下单即发取杯号、并发不重号（FR-P2-11；AD-7）
//
// 为什么需要脚本：发号是「计数器原子递增 + 唯一约束兜底」，真并发在单连接的 pgTAP 里测不了，
// 按 FR-P2-19 以「实现方式说明 + 人工验证记录」作证据。数据库测试覆盖结构与规则
// （tests/database/80_create_order.test.sql 的发号与日期、90_advance.test.sql 的唯一域）。
//
// 实现方式说明（并发为什么不重号）：
//   1. 发号是「insert ... on conflict do update ... returning」的一次原子操作——并发请求
//      在计数器行上排队，每个调用拿到不同的序号；不是「查最大值再加一」（那样会读到同一个值）；
//   2. 取号与建单在同一条 INSERT 内完成（Story 4.4），不存在「有单无号」的中间态；
//   3. orders 上的唯一约束 (store_id, pickup_code_date, pickup_code) 是兜底：
//      即使程序写错，同店同日也不可能落两个相同的号（允许跳号、不允许重号）。
// 本脚本的并发轮：每个请求各自建立一条独立 TCP 连接、同时发出（连接池会把请求排队，
// 制造不出真并发）；断言 N 个号互不相同、发号日期都是门店本地自然日、计数器恰好 +N。
//
// 需要本地栈在跑（supabase start），且已应用迁移与种子（supabase db reset）。
// 运行：cd supabase && deno task verify:pickup-codes
// 会话走平台标准机制（service role 建用户 + 密码登录）；结束（含失败）时删除测试用户，
// 订单随用户级联删除。不清理 pickup_code_counters：它是「下一个取杯号」的唯一来源，
// 手工删除会让新号撞上已存在订单的号，使后续每一次发号都失败。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../types/database.types.ts";
import { createServiceClient } from "../functions/wechat-login/identity.ts";

type Client = SupabaseClient<Database>;

/** 并发请求数：足以暴露「读到同一个计数器值」的竞态。 */
const CONCURRENCY = 8;

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

/** 门店本地自然日（AD-10：门店时区是唯一时区来源）。 */
function localDateIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ── 测试用户：service role 建用户，再走平台标准会话登录 ─────────────────────────

type VerifyUser = { id: string; email: string; client: Client };

async function createVerifyUser(): Promise<VerifyUser> {
  const email = `verify-pickup-codes-${crypto.randomUUID()}@wechat.local`;
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

type ConcurrentCall = { status: number; json: Json | null };

async function postCreateOrderOnOwnConnection(
  items: Array<{ product_id: string; quantity: number; selections: Json }>,
  accessToken: string,
  idempotencyKey: string,
): Promise<ConcurrentCall> {
  if (apiUrl.protocol !== "http:") {
    throw new Error("并发验证只支持本地 http 栈（本脚本的定位是本地链路验证）");
  }

  const payload = new TextEncoder().encode(JSON.stringify({
    p_items: items,
    p_dining_mode: "takeout",
    p_notes: "取杯号并发验证",
    p_idempotency_key: idempotencyKey,
  }));

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
    return { status, json: body === "" ? null : JSON.parse(body) as Json };
  } finally {
    connection.close();
  }
}

type OrderResult = { id: string; order_number: string; status: string; pickup_code: string };

function asOrderResult(data: Json | null): OrderResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("下单 RPC 的返回形状不是对象");
  }
  return data as unknown as OrderResult;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

const anonClient = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const user = await createVerifyUser();

try {
  const { data: store, error: storeError } = await user.client
    .from("stores")
    .select("id, timezone")
    .single();
  if (storeError !== null) throw storeError;
  const localDate = localDateIn(store.timezone);

  const product = await pickOnSaleProduct(anonClient);
  console.log(
    `门店时区 ${store.timezone}（发号日期 ${localDate}），下单商品：${product.name}，并发轮 ${CONCURRENCY} 单`,
  );

  const counterBefore = await readCounter(store.id, localDate);

  const { data: { session }, error: sessionError } = await user.client.auth.getSession();
  if (sessionError !== null || session === null) {
    throw new Error("拿不到访问凭证（会话签发失败）");
  }

  // 1) N 个请求各自独立连接、同时发出：不同幂等键 → 应该产生 N 张订单、N 个不同的取杯号
  const batch = await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, index) =>
      postCreateOrderOnOwnConnection(
        [{
          product_id: product.id,
          quantity: 1,
          selections: selectionsFor(product),
        }],
        session.access_token,
        `verify-pickup-codes-${crypto.randomUUID()}-${index}`,
      )
    ),
  );

  const failures = batch.filter((call) => call.status !== 200);
  if (failures.length > 0) {
    throw new Error(
      `FAIL: ${CONCURRENCY} 个并发下单应全部成功，实际失败 ${failures.length} 个：` +
        failures.map((call) => JSON.stringify(call.json).slice(0, 200)).join("; "),
    );
  }
  check(true, `${CONCURRENCY} 个并发下单全部成功（各自独立连接）`);

  const results = batch.map((call) => asOrderResult(call.json));
  const codes = results.map((order) => order.pickup_code);
  check(
    codes.every((code) => /^[A-Z]-[0-9]{4}$/.test(code)),
    `${CONCURRENCY} 个取杯号外形都是字母前缀 + 四位数字（如 ${codes[0]}）`,
  );
  check(
    new Set(codes).size === CONCURRENCY,
    `${CONCURRENCY} 个并发下单拿到 ${new Set(codes).size} 个互不相同的取杯号`,
  );

  // 2) 落库核对：RPC 返回值与库中行一致、全部是「制作中」
  const { data: rows, error: rowsError } = await user.client
    .from("orders")
    .select("id, pickup_code, pickup_code_date, status")
    .in("id", results.map((order) => order.id));
  if (rowsError !== null) throw rowsError;
  const rowById = new Map((rows ?? []).map((row) => [row.id, row]));
  check(
    results.every((order) => {
      const row = rowById.get(order.id);
      return row !== undefined && row.pickup_code === order.pickup_code &&
        row.status === "cooking";
    }),
    "库中每张订单都是「制作中」且取杯号与 RPC 返回一致",
  );
  check(
    (rows ?? []).every((row) => row.pickup_code_date === localDate),
    `发号日期都是门店本地自然日（${localDate}）`,
  );

  // 3) 计数器核对：原子递增恰好走 N 次（允许跳号、不允许重号）
  const counterAfter = await readCounter(store.id, localDate);
  check(
    counterAfter - counterBefore === CONCURRENCY,
    `计数器恰好 +${CONCURRENCY}（${counterBefore} → ${counterAfter}）`,
  );

  console.log(
    `PASS：${checks.length} 项断言全部通过（取杯号 ${codes.join("、")}）`,
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

/** 读「门店 + 本地自然日」的计数器；没有行 = 0（尚未发过号）。 */
async function readCounter(storeId: string, localDate: string): Promise<number> {
  const { data, error } = await serviceClient
    .from("pickup_code_counters")
    .select("counter")
    .eq("store_id", storeId)
    .eq("local_date", localDate)
    .maybeSingle();
  if (error !== null) throw error;
  return data?.counter ?? 0;
}
