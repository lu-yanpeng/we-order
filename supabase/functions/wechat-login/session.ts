import { request, type PlatformConfig } from "./platform.ts";

export type IssueLoginTokenResult = { ok: true; tokenHash: string } | { ok: false };

/**
 * generate_link 的响应形状是平台漂移点：新版本嵌在 properties 下、旧版本平铺，两种都容忍。
 */
type GenerateLinkPayload = {
  hashed_token?: unknown;
  properties?: { hashed_token?: unknown };
};

/**
 * 让平台为这个邮箱生成一张一次性登录令牌（Story 2.3；addendum §A 已定路线）。
 *
 * 走 Admin API 的 generate_link（type=magiclink）：只生成令牌、不发邮件；令牌「只能用一次、
 * 有过期时间」由平台机制保证。客户端拿它去 /auth/v1/verify 换取平台签发的会话，
 * 本函数不接触会话材料，也不自签任何 JWT（AD-16）。
 */
export async function issueLoginToken(email: string, config: PlatformConfig): Promise<IssueLoginTokenResult> {
  try {
    const response = await request(config, `${config.supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      body: JSON.stringify({ type: "magiclink", email }),
    });
    if (!response.ok) {
      return { ok: false };
    }

    const payload = (await response.json().catch(() => null)) as GenerateLinkPayload | null;
    const tokenHash = payload?.properties?.hashed_token ?? payload?.hashed_token;
    return typeof tokenHash === "string" && tokenHash !== "" ? { ok: true, tokenHash } : { ok: false };
  } catch {
    // 平台不可达等异常：只回失败，不透传原文、不向上抛
    return { ok: false };
  }
}
