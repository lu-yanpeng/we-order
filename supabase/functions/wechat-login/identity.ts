// 身份解析：openid ↔ 平台用户（Story 2.2；FR-P2-2、AD-24）。
//
// 平台用户由官方 admin API 创建（createUser，id 由平台生成），映射由数据库函数
// record_wechat_login 登记；不直插 auth.users、不手写 uuid。收敛与自愈依赖三处唯一性：
//   1. wechat_identities.openid 主键 —— 并发首登在 record_wechat_login 里收敛；
//   2. wechat_identities.user_id 唯一约束 —— 同一平台用户不被第二个 openid 复用；
//   3. auth.users.email 唯一索引 —— 同一 openid 派生的合成 email 最多对应一个平台用户。
// 崩溃自愈：createUser 成功但映射未写入时，下次登录会得到 email_exists，
// 再用 generateLink 取回同一个 user.id 并补写映射，不会产生第二个用户。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "../../types/database.types.ts";

type Client = SupabaseClient<Database>;

/** 身份解析结果：会话签发（Story 2.3）用 email 生成一次性令牌。 */
export type WechatIdentity = {
  userId: string;
  email: string;
};

/** 身份解析失败：handler 依此返回 identity_failed，内部细节不出函数。 */
export class IdentityResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityResolutionError";
  }
}

/**
 * openid 的合成 email。登录链路唯一用它标识平台用户；
 * 平台用户即微信用户，不再存昵称、头像、手机号等信息（AD-24）。
 *
 * 已知极端情况：GoTrue 会把 email 整体小写，仅大小写不同的两个 openid 会派生出同一个 email，
 * 第二个 openid 写映射时会被 user_id 唯一约束拒绝。概率可忽略，本阶段不处理。
 */
export function wechatEmail(openid: string): string {
  return `wx-${openid}@wechat.local`;
}

/** 服务端密钥客户端：auth admin 与 rpc 都用它；密钥由平台注入运行环境，不入仓（AR-5）。 */
export function createServiceClient(
  supabaseUrl: string,
  serviceRoleKey: string,
): Client {
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * 找到或创建 openid 对应的平台用户，并保证映射存在（FR-P2-2）。
 * 并发首登：平台唯一约束决定赢家；输家可能拿到可重试错误，
 * 重试时命中映射快路径，仍然回到同一个用户。
 */
export async function resolveWechatIdentity(
  openid: string,
  client: Client,
): Promise<WechatIdentity> {
  const email = wechatEmail(openid);

  // 快路径：老用户直接命中映射，避免每次登录都让 createUser 报一次 email_exists。
  // 这是一次优化而不是正确性依赖——判断过期也没关系，未命中分支里的 email_exists
  // 会把同一个用户找回来，最后由 record_wechat_login 收敛。
  const mapped = await findMappedUserId(client, openid);
  const userId = mapped ?? await ensurePlatformUser(client, email);

  // 映射写入与 last_login_at 刷新都在 record_wechat_login 内原子完成；
  // 返回值是最终生效的 user_id（并发时也一定是同一个用户）。
  const recorded = await recordLogin(client, openid, userId);
  return { userId: recorded, email };
}

async function findMappedUserId(
  client: Client,
  openid: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("wechat_identities")
    .select("user_id")
    .eq("openid", openid)
    .maybeSingle();
  if (error) {
    throw new IdentityResolutionError(`find mapping failed: ${error.message}`);
  }
  return data?.user_id ?? null;
}

async function recordLogin(
  client: Client,
  openid: string,
  userId: string,
): Promise<string> {
  const { data, error } = await client.rpc("record_wechat_login", {
    p_openid: openid,
    p_user_id: userId,
  });
  if (error) {
    throw new IdentityResolutionError(`record login failed: ${error.message}`);
  }
  if (typeof data !== "string" || data === "") {
    throw new IdentityResolutionError("record login returned no user id");
  }
  return data;
}

type CreateUserOutcome =
  | { ok: true; userId: string }
  | { ok: false; code: string | null; status: number | null };

async function ensurePlatformUser(
  client: Client,
  email: string,
): Promise<string> {
  const created = await createUser(client, email);
  if (created.ok) return created.userId;
  if (created.code === "email_exists") {
    // 用户已存在但映射缺失（快路径判断过期）：半登录残留，或并发对手刚建好。
    // 用 generateLink 取回同一个 user.id，再由 record_wechat_login 补写映射。
    return lookupExistingUserId(client, email);
  }
  // 并发首登输家（平台把 email 唯一冲突包成 500）等：返回可重试错误。
  // 客户端重试即走映射快路径，不会产生第二个用户。
  throw new IdentityResolutionError(
    `create user failed (status=${created.status ?? "none"}, code=${
      created.code ?? "none"
    })`,
  );
}

async function createUser(
  client: Client,
  email: string,
): Promise<CreateUserOutcome> {
  const { data, error } = await client.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) {
    return {
      ok: false,
      code: error.code ?? null,
      status: error.status ?? null,
    };
  }
  return { ok: true, userId: data.user.id };
}

/** 只在确认用户已存在后调用——generateLink 对不存在的 email 会自动创建未确认用户。 */
async function lookupExistingUserId(
  client: Client,
  email: string,
): Promise<string> {
  const { data, error } = await client.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) {
    throw new IdentityResolutionError(`user lookup failed: ${error.message}`);
  }
  const userId = data.user?.id;
  if (userId === undefined) {
    throw new IdentityResolutionError("user lookup returned no user");
  }
  return userId;
}
