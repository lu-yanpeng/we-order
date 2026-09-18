import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import type { Database } from "../../types/database.types.ts";

export type IssueLoginTokenResult = { ok: true; tokenHash: string } | { ok: false };

/**
 * 让平台为这个邮箱生成一张一次性登录令牌（Story 2.3；addendum §A 已定路线）。
 *
 * 走官方 Admin API 的 generateLink（type=magiclink）：只生成令牌、不发邮件；令牌「只能用一次、
 * 有过期时间」由平台机制保证。客户端拿它去 /auth/v1/verify 换取平台签发的会话，
 * 本函数不接触会话材料，也不自签任何 JWT（AD-16）。
 */
export async function issueLoginToken(email: string, client: SupabaseClient<Database>): Promise<IssueLoginTokenResult> {
  try {
    const { data, error } = await client.auth.admin.generateLink({ type: "magiclink", email });
    if (error) {
      return { ok: false };
    }

    const tokenHash = data.properties.hashed_token;
    return typeof tokenHash === "string" && tokenHash !== "" ? { ok: true, tokenHash } : { ok: false };
  } catch {
    // 平台不可达等异常：只回失败，不向上抛
    return { ok: false };
  }
}
