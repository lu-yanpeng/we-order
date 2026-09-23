// Story 5.4 重建后端到端验证：干净重建后立即可以完成登录、下单与订单查询（FR-P2-16；AR-3、AR-6）
//
// 覆盖：未登录读目录与门店 → 登录（驱动真实 handler，微信那一跳注入为受控响应）→
//      携带真实会话下单（真实 HTTP + 真实会话）→ 我的订单列表与详情 → 第二个身份读不到 →
//      与「不存在」同一拒绝结果 → 清理测试用户。
// 不覆盖：并发与时间行为（各有专门脚本）；图片对象入仓不在本阶段交付（见 Story 5.4 验收记录）。
//
// 需要本地栈在跑（supabase start），且数据库已应用迁移与种子（supabase db reset）。
// 密钥不落仓库：优先读环境变量，否则执行 `supabase status -o env` 取本地配置。
// 脚本只创建带 verify- 前缀的测试 openid，结束（含失败）时清理对应的平台用户与映射、订单随用户级联删除。
//
// 运行：cd supabase && deno task verify:rebuild

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
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

// ── 登录：与 index.ts / verify-login.ts 相同的接线，微信那一跳注入为受控响应（不联网） ──

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

/** 只带访问凭证的客户端：请求头构造与单元验证脚本一致（发布密钥 + Authorization）。 */
function sessionClient(session: LoginSession): Client {
  return createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  });
}

// ── 菜单：匿名读取后按种子里可下单的商品构造请求（不写死种子 id） ─────────────────

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

// ── 对外形状（与 order_result_json / 列表项 / 详情对应，AD-22） ───────────────────

type OrderJson = {
  id: string;
  order_number: string;
  status: string;
  dining_mode: string;
  packaging_fee: number;
  total_amount: number;
  notes: string;
  pickup_code: string;
  created_at: string;
};

type ListItem = OrderJson & { item_summary: string };

type Detail = OrderJson & {
  store_name: string;
  store_address: string;
  store_phone: string;
  items: Array<{
    product_id: string;
    product_name: string;
    spec_summary: string;
    selections: Json;
    unit_price: number;
    quantity: number;
  }>;
};

function asObject(value: Json | null, what: string): Record<string, Json> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`FAIL: ${what} 的返回形状不是对象`);
  }
  return value as unknown as Record<string, Json>;
}

const ORDER_NUMBER_RE = /^\d{18}$/;
const PICKUP_CODE_RE = /^[A-Z]-\d{4}$/;
const STORE_TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const openids: string[] = [];
const emails = new Set<string>();
const userIds: string[] = [];
const idempotencyKey = `verify-rebuild-${crypto.randomUUID()}`;

async function countMappings(openid: string): Promise<number> {
  const { count, error } = await serviceClient
    .from("wechat_identities")
    .select("openid", { count: "exact", head: true })
    .eq("openid", openid);
  if (error !== null) throw error;
  return count ?? 0;
}

try {
  // 1) 未登录读目录：形状非空、下架商品被过滤、售罄商品保留（FR-P2-6 的重建后现场）
  const { data: menuRows, error: menuError } = await anonClient
    .from("menu")
    .select("id, name, products");
  check(menuError === null, "未登录可以读取菜单（不被拒绝）");
  const categories = (menuRows ?? []) as MenuRow[];
  check(categories.length > 0, "菜单返回了分类");
  const products = categories.flatMap((row) => asMenuProducts(row.products));
  check(products.length > 0, `菜单展开后包含 ${products.length} 个商品`);
  check(
    products.every((product) => product.availability !== "delisted"),
    "下架商品不出现在菜单里",
  );
  check(
    products.some((product) => product.availability === "sold_out"),
    "售罄商品保留在菜单里并返回 availability",
  );

  const { data: storeRows, error: storeError } = await anonClient
    .from("stores")
    .select("name, address, phone");
  const store = (storeRows ?? [])[0];
  check(
    storeError === null && (storeRows ?? []).length === 1 &&
      store?.name !== "" && store?.address !== "" && store?.phone !== "",
    "未登录可以一次读到门店名称、地址、电话",
  );

  // 2) 登录：两个不同 openid 各拿到一套真实平台会话（身份不同）
  const openidA = `verify-rebuild-a-${crypto.randomUUID().replaceAll("-", "")}`;
  const openidB = `verify-rebuild-b-${crypto.randomUUID().replaceAll("-", "")}`;
  openids.push(openidA, openidB);
  emails.add(wechatEmail(openidA));
  emails.add(wechatEmail(openidB));

  const sessionA = await login(openidA);
  const sessionB = await login(openidB);
  userIds.push(sessionA.user.id, sessionB.user.id);
  check(
    sessionA.user.id !== sessionB.user.id,
    "两个 openid 登录得到两个不同的用户（身份映射生效）",
  );

  const clientA = sessionClient(sessionA);
  const clientB = sessionClient(sessionB);

  // 3) 下单：真实 HTTP + 真实会话，商品从公开菜单动态挑选
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

  const orderNotes = "重建验证";
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
  check(orderError === null, "携带真实会话经真实 HTTP 下单成功");
  const order = asObject(orderData, "下单") as unknown as OrderJson;
  check(ORDER_NUMBER_RE.test(order.order_number), "订单号是 18 位纯数字（服务端生成）");
  check(order.status === "cooking", "新订单初始状态为「制作中」");
  check(
    typeof order.pickup_code === "string" && PICKUP_CODE_RE.test(order.pickup_code),
    "下单即拿到取杯号（字母前缀 + 四位数字）",
  );

  // 4) 订单列表：本人的列表里能读到这张单，形状与格式符合契约
  const { data: listData, error: listError } = await clientA.rpc("get_my_orders", {});
  check(listError === null, "已登录身份可以读取我的订单列表");
  const envelope = asObject(listData, "订单列表");
  const listItems = Array.isArray(envelope.items)
    ? envelope.items as unknown as ListItem[]
    : [];
  const listed = listItems.find((item) => item.id === order.id);
  check(listed !== undefined, "刚下的订单出现在本人列表里");
  if (listed === undefined) throw new Error("FAIL: 列表里找不到刚下的订单");
  check(
    listed.item_summary.includes(product.name) &&
      listed.item_summary.includes("×1"),
    `列表项包含商品摘要（${listed.item_summary}）`,
  );
  check(
    STORE_TIME_RE.test(listed.created_at),
    `创建时间按门店时区输出为 YYYY-MM-DD HH:mm:ss（${listed.created_at}）`,
  );

  // 5) 订单详情：门店快照、备注、明细都读得到，且与列表订单字段一致（AD-22）
  const { data: detailData, error: detailError } = await clientA.rpc(
    "get_my_order_detail",
    { p_order_id: order.id },
  );
  check(detailError === null, "已登录身份可以读取本人订单详情");
  const detail = asObject(detailData, "订单详情") as unknown as Detail;
  check(
    detail.store_name === store?.name && detail.store_address === store?.address &&
      detail.store_phone === store?.phone,
    "详情带门店快照（名称、地址、电话与门店数据一致）",
  );
  check(detail.notes === orderNotes, "详情保留了下单时填写的备注");
  check(
    detail.items.length === 1 &&
      detail.items[0].product_id === product.id &&
      detail.items[0].product_name === product.name &&
      detail.items[0].spec_summary !== "" &&
      detail.items[0].quantity === 1,
    "详情带商品明细快照（引用、商品名、规格摘要、数量）",
  );
  const sameFields = (["order_number", "status", "pickup_code", "created_at", "total_amount"] as const)
    .every((field) => listed[field] === detail[field]);
  check(sameFields, "同一张单的订单字段在列表与详情中逐字段一致（同一映射）");

  // 6) 归属隔离：B 看不到 A 的订单；读详情与「不存在」得到同一结果（不泄露存在性）
  const { data: bListData, error: bListError } = await clientB.rpc("get_my_orders", {});
  check(bListError === null, "第二个身份可以读取自己的订单列表");
  const bItems = Array.isArray(asObject(bListData, "订单列表").items)
    ? asObject(bListData, "订单列表").items as unknown as ListItem[]
    : [];
  check(
    !bItems.some((item) => item.id === order.id),
    "第二个身份的列表里没有 A 的订单",
  );

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
    "第二个身份读 A 的订单详情被拒（order_not_found）",
  );
  check(
    missingDetailMessage !== "" && missingDetailMessage === bDetailMessage,
    "他人订单与不存在的订单返回同一结果（不泄露存在性）",
  );

  console.log(
    `PASS：${checks.length} 项断言全部通过（干净重建后：匿名读目录与门店 → 登录 → 下单 ${order.order_number} → 列表与详情 → 他人不可见）`,
  );
  for (const label of checks) console.log(`  ✓ ${label}`);
} finally {
  let deleted = 0;
  for (const userId of userIds) {
    const { error } = await serviceClient.auth.admin.deleteUser(userId);
    if (error !== null) {
      console.error(`WARN: 删除测试用户失败（${userId}）：${error.message}`);
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

  const leftoverMappings: string[] = [];
  for (const openid of openids) {
    if ((await countMappings(openid)) !== 0) leftoverMappings.push(openid);
  }
  if (leftoverMappings.length > 0) {
    console.error(`WARN: 清理后仍残留映射：${leftoverMappings.join(", ")}`);
  }
}
