import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import type { Database } from "../../types/database.types.ts";

export type IssueLoginTokenResult = { ok: true; tokenHash: string } | { ok: false };

/** 下发给客户端的会话材料：只含鉴权与续期必需的三个字段 */
export type LoginSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export type ExchangeLoginTokenResult =
  | { ok: true; session: LoginSession }
  | { ok: false; rejected: boolean };

export type IssueSessionResult = { ok: true; session: LoginSession } | { ok: false };

/**
 * verify 的校验类型取值是平台漂移点（当前文档推荐 email，magiclink / signup 已标记废弃）。
 * 它只存在于服务端：平台改口径时重新部署函数即可，不必发小程序。
 */
const VERIFY_TYPE = "email";

/**
 * 生成 + 兑换的重发上限。
 *
 * 平台的「一次性登录令牌」是每用户一个槽位：再生成一张会让前一张作废（实测：连发三张只有最后
 * 一张能兑换，其余 403 otp_expired）。同一 openid 的并发登录会互相顶掉，所以兑换被明确拒绝时重发。
 * 每轮至少有一个请求胜出，重发到与并发数相当即可收敛；超出上限的极端并发仍会失败，
 * 由客户端重试整条登录链路（不在此处无限重发）。
 */
const SESSION_ISSUE_ATTEMPTS = 3;

/**
 * 让平台为这个邮箱生成一张一次性登录令牌（Story 2.3）。
 *
 * 走官方 Admin API 的 generateLink（type=magiclink）：只生成令牌、不发邮件；令牌「只能用一次、
 * 有过期时间」由平台机制保证。令牌不离开服务端，兑换由 exchangeLoginToken 在函数内完成；
 * 本函数不自签任何 JWT（AD-16）。
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

/**
 * 在服务端完成兑换：拿一次性令牌换平台签发的会话，客户端只见一个接口。
 * 请求带发布密钥——它就是客户端本来会用的那个身份，不是服务端密钥。
 * 会话仍由平台签发，不存在任何自签 JWT（AD-16）。
 *
 * 返回的 rejected 区分两种失败：平台明确拒绝这张令牌（有 HTTP 状态码，例如并发登录把它顶掉后的
 * 403 otp_expired）值得重发；平台不可达或响应不可用则重发没有意义。
 */
export async function exchangeLoginToken(
  tokenHash: string,
  client: SupabaseClient<Database>,
): Promise<ExchangeLoginTokenResult> {
  try {
    const { data, error } = await client.auth.verifyOtp({ type: VERIFY_TYPE, token_hash: tokenHash });
    if (error) {
      const status = error.status;
      return { ok: false, rejected: typeof status === "number" && status >= 400 };
    }
    return toLoginSession(data.session);
  } catch {
    // 平台不可达等异常：只回失败，不向上抛
    return { ok: false, rejected: false };
  }
}

/** 签发会话：生成令牌并立刻兑换；被并发登录顶掉时重发（见 SESSION_ISSUE_ATTEMPTS） */
export async function issueSession(
  email: string,
  clients: { admin: SupabaseClient<Database>; anon: SupabaseClient<Database> },
): Promise<IssueSessionResult> {
  for (let attempt = 0; attempt < SESSION_ISSUE_ATTEMPTS; attempt += 1) {
    const token = await issueLoginToken(email, clients.admin);
    if (!token.ok) {
      return { ok: false };
    }

    const exchanged = await exchangeLoginToken(token.tokenHash, clients.anon);
    if (exchanged.ok) {
      return { ok: true, session: exchanged.session };
    }
    if (!exchanged.rejected) {
      return { ok: false };
    }
  }

  return { ok: false };
}

/** 平台响应 → 对外契约：只取三个字段，平台多给的（user 等）不下发 */
function toLoginSession(value: unknown): ExchangeLoginTokenResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, rejected: false };
  }

  const { access_token, refresh_token, expires_in } = value as Record<string, unknown>;
  if (!isNonEmptyString(access_token) || !isNonEmptyString(refresh_token) || typeof expires_in !== "number") {
    return { ok: false, rejected: false };
  }

  return { ok: true, session: { access_token, refresh_token, expires_in } };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
