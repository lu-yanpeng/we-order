// Story 5.5 两身份真机验证：真机登录出来的两个真实身份互相读不到对方的订单
//（FR-P2-14 / FR-P2-15 / FR-P2-18、UJ-P2-1；证据形式：实现方式说明 + 人工验证记录）。
//
// 与 verify-rebuild.ts 的区别：那里的身份是脚本伪造的 openid；这里的两套身份来自真机
//（两台设备，或同一设备上的两个微信号）的真实微信登录。脚本按真机验证页显示的用户 id
// 从 wechat_identities 读回 openid（只在内存里用于派生合成 email），用与登录边缘函数
// 相同的平台标准机制（admin.generateLink → auth.verifyOtp）为这两个真实用户签发会话，
// 再走真实 HTTP 完成：
//   身份 A 下单 → 身份 B 查订单列表（看不到 A 的单）→ 身份 B 读 A 的订单详情
//   （order_not_found，与「不存在」同一结果）→ 身份 A 查订单列表（看得到）；
// 同时断言库中订单的归属 = A 的 openid 所映射的用户。
//
// 隐私：openid 不写文件、不进文档；输出里的 openid 一律是 SHA-256 指纹（前 12 位十六进制），
//       脚本末尾的手动复核 SQL 也只输出指纹。不要把含原始库查询结果的输出贴进仓库。
// 清理：不删除真实用户（它们是真的微信号，不是测试用户），也不删除本次订单（按裁定保留为
//       现场证据）；脚本可重复运行，每次产生一张新订单。
//
// 前置：本地栈在跑（supabase start），且两个微信号已在真机上完成登录（验证页显示用户 id）。
// 运行：cd supabase && deno task verify:two-identities --user-a <用户idA> --user-b <用户idB>
//       （也可以设置环境变量 VERIFY_USER_A / VERIFY_USER_B）

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../types/database.types.ts";
import {
  createServiceClient,
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

// ── 参数：真机验证页显示的两个用户 id ────────────────────────────────────────────

const USAGE = `用法：cd supabase && deno task verify:two-identities --user-a <用户idA> --user-b <用户idB>

两个用户 id 来自真机验证页（pages/auth-check）：在真机上打开小程序、点【验证身份链路】，
页面会显示当前用户 id。也可以改用环境变量 VERIFY_USER_A / VERIFY_USER_B。`;

function readArg(name: string): string {
  const index = Deno.args.indexOf(`--${name}`);
  if (index !== -1) {
    const value = Deno.args[index + 1] ?? "";
    if (value !== "" && !value.startsWith("--")) return value;
  }
  return Deno.env.get(`VERIFY_${name.toUpperCase().replaceAll("-", "_")}`) ?? "";
}

if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
  console.log(USAGE);
  Deno.exit(0);
}

const userA = readArg("user-a");
const userB = readArg("user-b");
if (userA === "" || userB === "") throw new Error(USAGE);
if (userA === userB) {
  throw new Error("FAIL: 两个身份必须是两个不同的用户（同一 user id 不能证明隔离）");
}

const { url, serviceRoleKey, anonKey } = await loadLocalConfig();
const serviceClient = createServiceClient(url, serviceRoleKey);
const verifyClient = createVerifyClient(url, anonKey);
const anonClient = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const issueSession = createSessionIssuer(serviceClient, verifyClient);

const checks: string[] = [];
function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
}

/** user_id 前缀：输出与文档只留前 8 位，避免把可定位到人的标识贴进仓库 */
function userPrefix(userId: string): string {
  return `${userId.slice(0, 8)}…`;
}

// ── 身份：从库中读回真机登录写入的映射（openid 只在内存中使用） ───────────────────

type IdentityRow = {
  openid: string;
  user_id: string;
  created_at: string;
  last_login_at: string;
};

/** openid 指纹：SHA-256 前 12 位十六进制；输出与文档用它，原文不出现。 */
async function openidFingerprint(openid: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(openid),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

async function loadIdentity(
  userId: string,
  label: string,
): Promise<IdentityRow & { fingerprint: string }> {
  const { data, error } = await serviceClient
    .from("wechat_identities")
    .select("openid, user_id, created_at, last_login_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error !== null) throw error;
  if (data === null) {
    throw new Error(
      `FAIL: ${label}（${userId}）没有身份映射：请先在真机上打开小程序完成登录` +
        `（验证页显示用户 id），再把该 id 传进来`,
    );
  }
  return { ...data, fingerprint: await openidFingerprint(data.openid) };
}

const identityA = await loadIdentity(userA, "身份 A");
const identityB = await loadIdentity(userB, "身份 B");
check(
  identityA.openid !== identityB.openid,
  "两个用户对应两个不同的 openid（是两套真实身份）",
);

// ── 会话：用与 wechat-login 相同的平台标准机制为真实用户签发（非自签、非伪造身份） ──

async function sessionFor(
  identity: IdentityRow,
  label: string,
): Promise<LoginSession> {
  let session: LoginSession;
  try {
    session = await issueSession({
      userId: identity.user_id,
      email: wechatEmail(identity.openid),
    });
  } catch (error) {
    throw new Error(
      `FAIL: ${label} 的会话签发失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  check(
    session.user.id === identity.user_id,
    `${label}：平台签发会话的主体与真机登录出来的用户一致`,
  );
  return session;
}

const sessionA = await sessionFor(identityA, "身份 A");
const sessionB = await sessionFor(identityB, "身份 B");

/** 只带访问凭证的客户端：请求头构造与各验证脚本一致（发布密钥 + Authorization）。 */
function sessionClient(session: LoginSession): Client {
  return createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  });
}

const clientA = sessionClient(sessionA);
const clientB = sessionClient(sessionB);

// ── 目录：匿名读菜单后动态挑一个可下单的商品（不写死种子 id） ─────────────────────

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
    candidate.spec_groups.length > 0 &&
    candidate.spec_groups.every((group) => group.options.length > 0)
  );
  if (product === undefined) {
    throw new Error(
      "FAIL: 菜单里找不到可下单的商品（规格齐全且非下架）：请先确认本地栈已应用种子数据",
    );
  }
  return product;
}

/** 规格选择：单选组给选项 id、多选组给选项 id 数组（取每组第一个选项）。 */
function selectionsFor(product: MenuProduct): Json {
  const selections: Record<string, Json> = {};
  for (const group of product.spec_groups) {
    const option = group.options[0];
    if (option === undefined) continue;
    selections[group.id] = group.multi ? [option.id] : option.id;
  }
  return selections;
}

// ── 对外形状（order_result_json 的字段子集，AD-22） ──────────────────────────────

type OrderJson = {
  id: string;
  order_number: string;
  status: string;
  pickup_code: string;
  total_amount: number;
  created_at: string;
};

type ListItem = OrderJson & { item_summary: string };

function asObject(value: Json | null, what: string): Record<string, Json> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`FAIL: ${what} 的返回形状不是对象`);
  }
  return value as unknown as Record<string, Json>;
}

const ORDER_NUMBER_RE = /^\d{18}$/;
const PICKUP_CODE_RE = /^[A-Z]-\d{4}$/;

// ── 两身份流程：A 下单 → B 查不到 → A 看得到 ─────────────────────────────────────

const product = await pickOnSaleProduct(anonClient);
const idempotencyKey = `verify-two-identities-${crypto.randomUUID()}`;
const orderNotes = "两身份真机验证";

const { data: orderData, error: orderError } = await clientA.rpc("create_order", {
  p_items: [{
    product_id: product.id,
    quantity: 1,
    selections: selectionsFor(product),
  }],
  p_dining_mode: "takeout",
  p_notes: orderNotes,
  p_idempotency_key: idempotencyKey,
});
check(orderError === null, "身份 A 携带会话经真实 HTTP 下单成功");
const order = asObject(orderData, "下单") as unknown as OrderJson;
check(ORDER_NUMBER_RE.test(order.order_number), "订单号是 18 位纯数字（服务端生成）");
check(
  typeof order.pickup_code === "string" && PICKUP_CODE_RE.test(order.pickup_code),
  "下单即拿到取杯号（字母前缀 + 四位数字）",
);

// B 查列表：拿得到自己的列表（不是被拒绝），但里面没有 A 的单
const { data: bListData, error: bListError } = await clientB.rpc("get_my_orders", {});
check(bListError === null, "身份 B 可以读取自己的订单列表（未出现错误）");
const bEnvelope = asObject(bListData, "身份 B 的订单列表");
const bItems = Array.isArray(bEnvelope.items)
  ? bEnvelope.items as unknown as ListItem[]
  : [];
check(
  !bItems.some((item) =>
    item.id === order.id || item.order_number === order.order_number
  ),
  "身份 B 的列表里没有身份 A 的订单（订单 id 与订单号都查不到）",
);

// B 读 A 的订单详情：与「不存在」返回同一结果（不泄露存在性）
const { error: bDetailError } = await clientB.rpc("get_my_order_detail", {
  p_order_id: order.id,
});
const { error: missingDetailError } = await clientB.rpc("get_my_order_detail", {
  p_order_id: crypto.randomUUID(),
});
const bDetailMessage = bDetailError?.message ?? "";
const missingDetailMessage = missingDetailError?.message ?? "";
check(
  bDetailMessage.includes("order_not_found"),
  "身份 B 读身份 A 的订单详情被拒（order_not_found）",
);
check(
  missingDetailMessage !== "" && missingDetailMessage === bDetailMessage,
  "他人订单与不存在的订单返回同一结果（不泄露存在性）",
);

// A 查列表：单在那儿
const { data: aListData, error: aListError } = await clientA.rpc("get_my_orders", {});
check(aListError === null, "身份 A 可以读取自己的订单列表");
const aEnvelope = asObject(aListData, "身份 A 的订单列表");
const aItems = Array.isArray(aEnvelope.items)
  ? aEnvelope.items as unknown as ListItem[]
  : [];
check(
  aItems.some((item) =>
    item.id === order.id && item.order_number === order.order_number
  ),
  "身份 A 的列表里有这张订单",
);

// 库中归属：订单挂在 A 的 openid 所映射的用户下
const { data: orderRow, error: orderRowError } = await serviceClient
  .from("orders")
  .select("user_id, order_number")
  .eq("id", order.id)
  .single();
check(
  orderRowError === null && orderRow.user_id === identityA.user_id &&
    orderRow.order_number === order.order_number,
  "库中该订单的 user_id = 身份 A 的 openid 所映射的用户",
);

// 重登/重试不产生第二个身份：两个 openid 各自仍然只有一条映射（openid 唯一约束的表达）
for (const [label, identity] of [["A", identityA], ["B", identityB]] as const) {
  const { count, error } = await serviceClient
    .from("wechat_identities")
    .select("openid", { count: "exact", head: true })
    .eq("openid", identity.openid);
  check(
    error === null && count === 1,
    `身份 ${label} 的 openid 仍只有一条身份映射（重登不产生第二个身份）`,
  );
}

// ── 输出：留档信息与手动复核 SQL（openid 只以指纹出现） ──────────────────────────

const manualSql = [
  "select o.order_number, left(o.user_id::text, 8) as user_prefix, o.status,",
  "       o.pickup_code, o.total_amount,",
  "       left(encode(sha256(w.openid::bytea), 'hex'), 12) as openid_fingerprint",
  "from public.orders o",
  "join public.wechat_identities w on w.user_id = o.user_id",
  `where o.id = '${order.id}';`,
].join("\n");

// 重启小程序后用它复核「还是原来的身份、没有重新登录」：last_login_at 不变 = 会话恢复而非重新登录
const restartSql = [
  "select left(user_id::text, 8) as user_prefix,",
  "       left(encode(sha256(openid::bytea), 'hex'), 12) as openid_fingerprint,",
  "       last_login_at",
  "from public.wechat_identities",
  "where left(encode(sha256(openid::bytea), 'hex'), 12) in " +
  `('${identityA.fingerprint}', '${identityB.fingerprint}');`,
].join("\n");

console.log(
  `PASS：${checks.length} 项断言全部通过（真机两身份：A 下单 → B 查不到 → A 看得到）`,
);
for (const label of checks) console.log(`  ✓ ${label}`);
console.log(`
留档信息（openid 只有指纹，user_id 只留前缀；可安全抄进验收记录）：
  身份 A：user_id=${userPrefix(identityA.user_id)}  openid 指纹=${identityA.fingerprint}  last_login_at=${identityA.last_login_at}
  身份 B：user_id=${userPrefix(identityB.user_id)}  openid 指纹=${identityB.fingerprint}  last_login_at=${identityB.last_login_at}
  订单号：${order.order_number}  订单 id：${order.id}  取杯号：${order.pickup_code}  幂等标识：${idempotencyKey}

手动复核 SQL（Studio → SQL Editor 或 psql，输出同样不含完整 user_id 与 openid）：
${manualSql}

重启小程序后复核身份（last_login_at 不变 = 会话恢复、没有重新登录）：
${restartSql}

本次订单按裁定保留为现场证据（不清理）；脚本可重复运行，每次产生一张新订单。`);
