import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import type { Database } from "../../types/database.types.ts";

/**
 * 由 openid 派生用户 id 的固定命名空间（uuid v5）。
 * 同一个 openid 永远算出同一个用户 id —— 并发首登时，第二个请求即使建用户撞车，
 * 也已经知道既有用户的 id，不需要再查一次。
 *
 * 不可改动：namespace 与 name 的编码属于持久化格式的一部分，改掉等于给同一个 openid 换一个
 * 新用户 id，与既有用户对不上（claim 撞外键、登录以 unknown 失败），要改必须先迁移数据。
 */
const USER_ID_NAMESPACE = "6f1a5b3c-9d2e-4a7b-8c1f-2e5d8a4b7c30";

/** 平台要求用户必须有邮箱或手机号；我们不收集个人信息，用 openid 派生一个占位邮箱 */
export function syntheticEmail(openid: string): string {
  return `wx-${openid}@wechat.local`;
}

/** uuid v5（SHA-1）：确定性，同输入同输出 */
export async function deriveUserId(openid: string): Promise<string> {
  const namespace = hexToBytes(USER_ID_NAMESPACE);
  const name = new TextEncoder().encode(openid);
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace, 0);
  input.set(name, namespace.length);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // 版本 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 变体
  return formatUuid(bytes);
}

export type EnsureIdentityResult = { ok: true; userId: string } | { ok: false };

/**
 * 确保 openid 对应一个平台用户：已有映射直接复用（顺带推进最近登录时间），
 * 没有就建平台用户再落映射。并发首登由 openid 主键与邮箱唯一约束收敛。
 */
export async function ensureIdentity(openid: string, client: SupabaseClient<Database>): Promise<EnsureIdentityResult> {
  try {
    const { data: existing, error: resolveError } = await client.rpc("resolve_wechat_identity", { p_openid: openid });
    if (resolveError) {
      return { ok: false };
    }
    if (isUserId(existing)) {
      return { ok: true, userId: existing };
    }

    // 并发首登时两个请求算出同一个 userId，输家建用户必然撞「已存在」，这不影响结果：
    // 它不需要查询赢家，直接进 claim，由 openid 主键收敛到同一个 user_id。
    const userId = await deriveUserId(openid);
    if (!(await createPlatformUser(userId, syntheticEmail(openid), client))) {
      // 真正的失败：此时用户建没建成都不知道，绝不能写映射，只能整体失败；
      // 客户端重试时会先命中上面那次 resolve（若赢家已写完映射）。
      return { ok: false };
    }

    const { data: claimed, error: claimError } = await client.rpc("claim_wechat_identity", {
      p_openid: openid,
      p_user_id: userId,
    });
    if (claimError) {
      return { ok: false };
    }
    return isUserId(claimed) ? { ok: true, userId: claimed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * 建平台用户（走官方 Admin API，不直插 auth.users）。
 * 「已存在」不是失败，而是「另一个请求刚建好了同一个用户」的信号：
 *   - 422 email_exists：顺序重试撞邮箱唯一约束（SDK 能拿到 code，实测）；
 *   - 500：并发首登撞主键——这个错误被 SDK 归为 AuthRetryableFetchError、拿不到具体 code，
 *     只能按状态码判断。
 * 真正的兜底是数据库：用户若最终不存在，下一步 claim 会撞外键约束，不会悄悄建立错误身份。
 */
async function createPlatformUser(userId: string, email: string, client: SupabaseClient<Database>): Promise<boolean> {
  const { error } = await client.auth.admin.createUser({ id: userId, email, email_confirm: true });
  if (!error) {
    return true;
  }

  const status = error.status ?? 0;
  return status === 422 || status >= 500;
}

function isUserId(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
