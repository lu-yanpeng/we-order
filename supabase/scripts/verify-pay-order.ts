// Story 3.2 现场验证：pay-order 边缘函数的 HTTP 契约与凭证边界（FR-P3-8；AD-11、AD-12）。
//
// 覆盖：无会话被平台拒绝（401，不落数据）→ 只有发布密钥（函数 401 not_authenticated）→
//      camelCase 不生效（400）→ 真会话合法请求（200；金额服务端重算、取杯号齐备、归属 = 会话）→
//      金额陷阱字段被忽略 → 同一幂等键重放返回同一张订单（库里仍一张）→
//      不存在 / 不可售商品（409 product_unavailable）→ 数量非法（400 invalid_quantity）→ 清理测试用户。
//
// 走真实 HTTP：请求穿过本地边缘运行时（含平台 verify_jwt 校验）、真实会话与真实数据库，
// 全程不注入假实现。这组证据与离线单元测试互补（后者覆盖形状 / 归一表的穷尽分支）。
//
// 需要本地栈在跑（supabase start，边缘函数由本地栈统一服务），数据库已应用迁移与种子。
// 运行：cd supabase && deno task verify:pay-order
// 密钥不落仓库：优先读环境变量，否则执行 `supabase status -o env` 取本地配置。
// 只创建带 verify- 前缀的测试用户，结束（含失败）时删除；订单随用户级联删除。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../types/database.types.ts";
import { createServiceClient } from "../functions/wechat-login/identity.ts";

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
const anonClient = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const checks: string[] = [];
function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
}

// ── 菜单与期望金额：从公开菜单动态挑一个可下单商品（不写死种子 id，重建后直接能跑） ─────

type MenuSpecOption = { id: string; label: string; price_extra: number };
type MenuSpecGroup = {
  id: string;
  title: string;
  multi: boolean;
  options: MenuSpecOption[];
};
type MenuProduct = {
  id: string;
  name: string;
  price: number;
  availability: string;
  spec_groups: MenuSpecGroup[];
};

function asMenuProducts(products: Json | null): MenuProduct[] {
  return Array.isArray(products) ? products as unknown as MenuProduct[] : [];
}

async function pickOnSaleProduct(): Promise<MenuProduct> {
  const { data, error } = await anonClient.from("menu").select("products");
  if (error !== null) throw error;
  const products = (data ?? []).flatMap((row) => asMenuProducts(row.products));
  const candidates = products.filter((candidate) =>
    candidate.availability === "on_sale" &&
    candidate.spec_groups.every((group) => group.options.length > 0)
  );
  // 优先带规格组的商品：合法请求会带回规格快照，规格不一致的失败分支也可现场验证
  const product =
    candidates.find((candidate) => candidate.spec_groups.length > 0) ??
      candidates[0];
  if (product === undefined) {
    throw new Error(
      "菜单里找不到可下单的商品：请先 `supabase db reset` 应用种子数据",
    );
  }
  return product;
}

async function storePackagingFee(): Promise<number> {
  const { data, error } = await anonClient
    .from("stores")
    .select("takeout_packaging_fee")
    .limit(1)
    .single();
  if (error !== null) throw error;
  return Number(data.takeout_packaging_fee);
}

type PayOrderDraft = {
  items: Array<{
    product_id: string;
    quantity: number;
    selections: Record<string, string | string[]>;
  }>;
  dining_mode: "dinein" | "takeout";
  notes: string;
  idempotency_key: string;
};

/** 规格选择：单选组给选项 id、多选组给选项 id 数组（AD-22 的形状，取每组第一个选项）。 */
function draftFor(
  product: MenuProduct,
  diningMode: "dinein" | "takeout",
  key: string,
): { draft: PayOrderDraft; unitPrice: number } {
  const selections: Record<string, string | string[]> = {};
  let unitPrice = product.price;
  for (const group of product.spec_groups) {
    const option = group.options[0];
    if (option === undefined) continue;
    selections[group.id] = group.multi ? [option.id] : option.id;
    unitPrice += option.price_extra;
  }
  return {
    draft: {
      items: [{ product_id: product.id, quantity: 1, selections }],
      dining_mode: diningMode,
      notes: "verify pay-order",
      idempotency_key: key,
    },
    unitPrice: Math.round(unitPrice * 100) / 100,
  };
}

// ── HTTP：直接打本地边缘函数（穿过平台 verify_jwt 校验） ───────────────────────

type HttpCall = { status: number; body: Json; requestId: string | null };

async function postPayOrder(
  body: unknown,
  options: { authorization?: string; apikey?: boolean } = {},
): Promise<HttpCall> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.apikey ?? true) {
    headers.apikey = anonKey;
  }
  if (options.authorization !== undefined) {
    headers.Authorization = options.authorization;
  }
  const response = await fetch(`${url}/functions/v1/pay-order`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? null : (JSON.parse(text) as Json),
    requestId: response.headers.get("x-request-id"),
  };
}

function asObject(body: Json, what: string): Record<string, Json> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`FAIL: ${what} 的响应形状不是对象`);
  }
  return body as unknown as Record<string, Json>;
}

// ── 测试用户：service role 建用户 + 密码登录（真实平台会话） ─────────────────────

type VerifyUser = { id: string; email: string; accessToken: string };

async function createVerifyUser(): Promise<VerifyUser> {
  const email = `verify-pay-order-${crypto.randomUUID()}@wechat.local`;
  const password = crypto.randomUUID();
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error !== null) throw error;

  const client: Client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signed, error: signInError } = await client.auth
    .signInWithPassword({ email, password });
  if (signInError !== null) throw signInError;
  const accessToken = signed.session?.access_token ?? "";
  if (accessToken === "") throw new Error("FAIL: 拿不到测试用户的访问凭证");
  return { id: data.user.id, email, accessToken };
}

async function countOrdersFor(userId: string): Promise<number> {
  const { count, error } = await serviceClient
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error !== null) throw error;
  return count ?? 0;
}

async function countAllOrders(): Promise<number> {
  const { count, error } = await serviceClient
    .from("orders")
    .select("id", { count: "exact", head: true });
  if (error !== null) throw error;
  return count ?? 0;
}

let user: VerifyUser | null = null;
let draft: PayOrderDraft | null = null;

try {
  const product = await pickOnSaleProduct();
  const packagingFee = await storePackagingFee();
  const diningMode = "takeout" as const;
  const key = `verify-pay-order-${crypto.randomUUID()}`;
  const built = draftFor(product, diningMode, key);
  draft = built.draft;
  const expectedTotal = Math.round(
    (built.unitPrice * 1 + packagingFee) * 100,
  ) / 100;
  const body = draft;

  console.log(
    `下单商品：${product.name}（单价 ${built.unitPrice}，外带包装费 ${packagingFee}，期望总额 ${expectedTotal}）`,
  );

  const ordersBefore = await countAllOrders();

  // 1) 无任何凭证 → 平台 401，函数不执行，不落数据
  const noCredential = await postPayOrder(body, { apikey: false });
  check(
    noCredential.status === 401,
    `无任何凭证被平台拒绝（HTTP ${noCredential.status}）`,
  );
  check(
    noCredential.requestId === null,
    "平台层拒绝不经过函数（没有 x-request-id）",
  );
  check(
    await countAllOrders() === ordersBefore,
    "无凭证请求不产生订单（函数未执行）",
  );

  // 2) 只有发布密钥（客户端忘带会话）：实测平台以 apikey 为 JWT 放行到函数，
  //    由函数 fail-closed（发布密钥不是用户会话）
  const apikeyOnly = await postPayOrder(body);
  check(
    apikeyOnly.status === 401,
    `只有发布密钥被拒（HTTP ${apikeyOnly.status}）`,
  );
  check(
    asObject(apikeyOnly.body, "仅发布密钥失败").code === "not_authenticated",
    "类别为 not_authenticated（发布密钥不是用户会话）",
  );
  check(apikeyOnly.requestId !== null, "函数层拒绝带 x-request-id");
  check(
    await countAllOrders() === ordersBefore,
    "只有发布密钥不产生订单（未触碰数据库写路径）",
  );

  // 3) 发布密钥当 Bearer（平台验真、函数 fail-closed）
  const anonAuth = await postPayOrder(body, {
    authorization: `Bearer ${anonKey}`,
  });
  check(
    anonAuth.status === 401,
    `匿名密钥不是用户会话（HTTP ${anonAuth.status}）`,
  );
  check(
    asObject(anonAuth.body, "匿名密钥失败").code === "not_authenticated",
    "类别为 not_authenticated",
  );
  check(anonAuth.requestId !== null, "函数层拒绝带 x-request-id");
  check(
    await countAllOrders() === ordersBefore,
    "匿名密钥请求不产生订单（未触碰数据库写路径）",
  );

  user = await createVerifyUser();

  // 3) camelCase 必填字段读不到值 → 400 invalid_request
  const camel = await postPayOrder(
    {
      items: body.items,
      diningMode: "takeout",
      notes: "",
      idempotencyKey: body.idempotency_key,
    },
    { authorization: `Bearer ${user.accessToken}` },
  );
  check(
    camel.status === 400 &&
      asObject(camel.body, "camelCase").code === "invalid_request",
    "camelCase 不生效（400 invalid_request）",
  );

  // 4) 合法请求 + 金额陷阱字段 → 200，金额由服务端重算
  const tricked = {
    ...body,
    total_amount: 0.01,
    items: [{
      ...body.items[0],
      unit_price: 0.01,
      product_name: "假名字",
    }],
  };
  const ok = await postPayOrder(tricked, {
    authorization: `Bearer ${user.accessToken}`,
  });
  check(ok.status === 200, `真会话合法请求成功（HTTP ${ok.status}）`);
  const order = asObject(ok.body, "成功响应");
  check(order.status === "cooking", "新订单为制作中");
  check(
    Number(order.total_amount) === expectedTotal,
    `金额为服务端重算：${order.total_amount}（陷阱值 0.01 / 假名字被忽略）`,
  );
  check(
    Number(order.packaging_fee) === packagingFee,
    "包装费按门店配置（外带收取）",
  );
  check(
    typeof order.pickup_code === "string" && order.pickup_code !== "",
    `取杯号下单即分配（${order.pickup_code}）`,
  );
  check(ok.requestId !== null, "成功响应带 x-request-id");

  // 5) 落库、归属与快照
  const { data: row, error: rowError } = await serviceClient
    .from("orders")
    .select("id, user_id, total_amount, pickup_code, idempotency_key, status")
    .eq("id", order.id as string)
    .single();
  check(rowError === null && row !== null, "订单已落库");
  check(
    row?.user_id === user.id,
    "归属 = 会话身份（请求体没有用户标识入口）",
  );
  check(
    Number(row?.total_amount) === expectedTotal,
    "库里金额与服务端重算一致",
  );
  check(row?.pickup_code === order.pickup_code, "库里取杯号与响应一致");
  check(await countOrdersFor(user.id) === 1, "该用户当前只有一张订单");

  // 6) 同一幂等键重放（内容不同）→ 同一张订单，库里仍只有一张
  const replay = await postPayOrder(
    {
      ...tricked,
      items: [{ ...body.items[0], quantity: 3, unit_price: 999 }],
      idempotency_key: key,
    },
    { authorization: `Bearer ${user.accessToken}` },
  );
  check(
    replay.status === 200 &&
      asObject(replay.body, "重放响应").id === order.id,
    "同一幂等键重放返回同一张订单（键原样转发）",
  );
  check(
    await countOrdersFor(user.id) === 1,
    "重放后该用户仍只有一张订单（没有第二张）",
  );

  // 7) 商品不存在 / 不可售 → 409 product_unavailable
  const missing = await postPayOrder(
    {
      items: [{ product_id: crypto.randomUUID(), quantity: 1, selections: {} }],
      dining_mode: "takeout",
      notes: "",
      idempotency_key: `${key}-missing`,
    },
    { authorization: `Bearer ${user.accessToken}` },
  );
  check(
    missing.status === 409 &&
      asObject(missing.body, "不可售商品").code === "product_unavailable",
    `不存在 / 不可售商品被拒（HTTP ${missing.status} product_unavailable）`,
  );
  check(missing.requestId !== null, "业务拒绝带 x-request-id");

  // 8) 数量非法 → 400 invalid_quantity
  const badQuantity = await postPayOrder(
    {
      items: [{ product_id: product.id, quantity: 0, selections: {} }],
      dining_mode: "takeout",
      notes: "",
      idempotency_key: `${key}-quantity`,
    },
    { authorization: `Bearer ${user.accessToken}` },
  );
  check(
    badQuantity.status === 400 &&
      asObject(badQuantity.body, "数量非法").code === "invalid_quantity",
    "数量非法被拒（400 invalid_quantity）",
  );

  // 9) 规格选择与目录不一致（漏传规格组）→ 409 invalid_selection
  if (product.spec_groups.length > 0) {
    const badSelection = await postPayOrder(
      {
        items: [{ product_id: product.id, quantity: 1, selections: {} }],
        dining_mode: "takeout",
        notes: "",
        idempotency_key: `${key}-selection`,
      },
      { authorization: `Bearer ${user.accessToken}` },
    );
    check(
      badSelection.status === 409 &&
        asObject(badSelection.body, "规格失效").code === "invalid_selection",
      "规格选择与目录不一致被拒（409 invalid_selection）",
    );
  } else {
    console.log("跳过：该商品没有规格组，invalid_selection 分支由离线单测覆盖");
  }

  check(await countOrdersFor(user.id) === 1, "失败路径不落任何订单");

  console.log(`PASS：${checks.length} 项断言全部通过`);
  for (const label of checks) console.log(`  ✓ ${label}`);
} finally {
  if (user !== null) {
    const { error } = await serviceClient.auth.admin.deleteUser(user.id);
    if (error !== null) {
      console.error(
        `WARN: 删除测试用户失败（${user.email}）：${error.message}`,
      );
    } else {
      console.log("清理：删除测试用户，订单随用户级联删除");
    }
  }
  if (draft !== null) {
    const { count, error } = await serviceClient
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("idempotency_key", draft.idempotency_key);
    if (error !== null) {
      console.error(`WARN: 清理后核对失败：${error.message}`);
    } else if ((count ?? 0) > 0) {
      console.error(
        `WARN: 清理后仍残留 ${count} 张测试订单（幂等键 ${draft.idempotency_key}）`,
      );
    }
  }
}
