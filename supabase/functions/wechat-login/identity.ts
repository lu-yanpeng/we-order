// 身份解析：openid ↔ 平台用户（Story 2.2；FR-P2-2、AD-24）。
//
// 平台用户由官方 admin API 创建（createUser，id 由平台生成），映射由数据库函数
// record_wechat_login 登记；不直插 auth.users、不手写 uuid。收敛与自愈依赖三处唯一性：
//   1. wechat_identities.openid 主键 —— 并发首登在 record_wechat_login 里收敛；
//   2. wechat_identities.user_id 唯一约束 —— 同一平台用户不被第二个 openid 复用；
//   3. auth.users.email 唯一索引 —— 同一 openid 派生的合成 email 最多对应一个平台用户。
//
// 按 email 找回既有用户只经只读 RPC find_user_by_email；不用 admin.generateLink 当反查——
// 后者对不存在的 email 会顺手创建未确认用户（见该迁移的注释）。
// 自愈：createUser 成功但映射未写入时，下次登录先查映射、再按 email 找回同一用户并补写映射。
// 并发首登输家：createUser 报错后重查一次 email，查到赢家刚建好的用户就继续，
// 查不到才返回可重试错误；正确性由上述唯一约束兜底，查询只做路径选择。

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
 * 并发首登：平台唯一约束决定赢家；输家重查一次 email 后大概率也能继续，
 * 最坏情况拿到可重试错误，重试时命中映射快路径，仍然回到同一个用户。
 */
export async function resolveWechatIdentity(
  openid: string,
  client: Client,
): Promise<WechatIdentity> {
  const email = wechatEmail(openid);

  // 快路径：老用户直接命中映射，不触发用户查询与创建。
  const mapped = await findMappedUserId(client, openid);
  const userId = mapped ?? await findOrCreatePlatformUser(client, email);

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

/**
 * 按 email 找回或创建平台用户。查询只做路径选择，并发正确性由
 * auth.users.email 唯一索引兜底：同一 email 最多存在一个平台用户。
 */
async function findOrCreatePlatformUser(
  client: Client,
  email: string,
): Promise<string> {
  // 自愈：平台用户还在、映射丢了的残留（createUser 成功后崩溃，或并发对手刚建好）
  const existing = await findUserIdByEmail(client, email);
  if (existing !== null) return existing;

  const created = await createUser(client, email);
  if (created.ok) return created.userId;

  // 并发首登输家：平台可能把 email 唯一冲突包成 email_exists，也可能包成 500，
  // 两者都重查一次 email——查到就是赢家刚建好的那个用户；查不到才是真失败。
  const raced = await findUserIdByEmail(client, email);
  if (raced !== null) return raced;

  throw new IdentityResolutionError(
    `create user failed (status=${created.status ?? "none"}, code=${
      created.code ?? "none"
    })`,
  );
}

/** 只读查询：经 RPC find_user_by_email（security definer 查 auth.users），不暴露 auth schema。 */
async function findUserIdByEmail(
  client: Client,
  email: string,
): Promise<string | null> {
  const { data, error } = await client.rpc("find_user_by_email", {
    p_email: email,
  });
  if (error) {
    throw new IdentityResolutionError(
      `find user by email failed: ${error.message}`,
    );
  }
  return data ?? null;
}

type CreateUserOutcome =
  | { ok: true; userId: string }
  | { ok: false; code: string | null; status: number | null };

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
