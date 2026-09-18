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
 * 生成令牌 + 兑换会话的重发上限。
 *
 * 为什么一个本来「跑一次就完事」的请求会被逼着重来：
 * 令牌不是「印一张交给你」就归你了——它被写在平台的 auth.one_time_tokens 表里，而这张表上有一条
 * 唯一约束 (user_id, token_type)：**同一个用户、同一种令牌同时只能有一份**（不同类型的令牌可以
 * 共存；我们用的 magiclink 落在 recovery_token 这一种，实测确认）。所以同一个账号同时只有一张
 * 有效的登录令牌：生成新的一张，旧的那张当场作废（实测：旧令牌再去兑换得到 403 otp_expired）。
 *
 * 于是同一个 openid 只要有两个登录请求重叠，就会互相顶掉（前端可以理解成：两个异步流程往同一个
 * 变量里写值，谁最后写谁的值算数——但先写的那个手里还攥着已经被覆盖的旧值）：
 *
 *   请求 A：生成 T_A（表里 = T_A）→ …… 一次网络往返 …… → 兑换 T_A → 被拒（表里已经是 T_B）
 *   请求 B：　　　生成 T_B（表里 = T_B）→ 兑换 T_B → 成功
 *
 * A 没做错任何事，只是它手里的令牌在兑换之前被别人换掉了；作废的令牌换不回来，
 * 唯一的补救是回开头重新生成一张再去兑换——这就是 issueSession 里那个循环。
 *
 * 为什么是 3 次：每一轮至少有一个请求能成功（全局最后生成令牌的那个一定换得到），失败的那些进
 * 下一轮，所以正常节奏下同一账号的 N 个并发登录最多 N 轮都能成功；e2e 实测 3 个并发全部拿到会话。
 * 3 覆盖的是现实里会出现的量级（同一账号 2～3 个请求重叠）。再大的极端交错仍可能失败——那种情况
 * 直接报错，由客户端重试整条登录链路（循环必须有终点，不能无限重发）。
 *
 * 注意：「一种类型只有一份」是实测出来的平台实现细节，官方文档没有承诺。哪天平台改了行为，
 * 这段重试最多是永远不触发，不会出错。
 */
const SESSION_ISSUE_ATTEMPTS = 3;

/**
 * 让平台为这个邮箱生成一张一次性登录令牌（Story 2.3）。
 *
 * 走官方 Admin API 的 generateLink（type=magiclink）：只生成令牌、不发邮件；令牌「只能用一次、
 * 有过期时间」由平台机制保证。令牌不离开服务端，兑换由 exchangeLoginToken 在函数内完成；
 * 本函数不自签任何 JWT（AD-16）。
 *
 * 副作用要留意：生成的令牌写进平台的 auth.one_time_tokens 表（同一用户、同一类型只能有一份），
 * 上一次生成的同类令牌就此作废——这是 issueSession 需要重发的根因，详见 SESSION_ISSUE_ATTEMPTS。
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
 * rejected 用来区分两种失败，只有第一种值得重发：
 *   - true：平台明确拒绝了这张令牌（HTTP 4xx / 5xx）。最常见的是 403 otp_expired，也就是这张令牌
 *     已经被并发的另一次登录顶掉了（原理见 SESSION_ISSUE_ATTEMPTS）。补救办法是重新生成一张。
 *   - false：请求压根没送到，或平台的响应不完整（缺字段、字段类型不对）。重发只是让用户多等一遍，
 *     所以调用方应该直接失败。
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

/**
 * 签发会话 = 生成一张令牌 + 立刻拿它兑换。
 *
 * 兑换被平台明确拒绝时回开头重来（多半是这张令牌被并发的另一次登录顶掉了），最多
 * SESSION_ISSUE_ATTEMPTS 轮；其余失败直接返回。为什么需要重发、为什么是 3 次，都写在
 * SESSION_ISSUE_ATTEMPTS 上面。
 */
export async function issueSession(
  email: string,
  clients: { admin: SupabaseClient<Database>; anon: SupabaseClient<Database> },
): Promise<IssueSessionResult> {
  for (let attempt = 0; attempt < SESSION_ISSUE_ATTEMPTS; attempt += 1) {
    const token = await issueLoginToken(email, clients.admin);
    if (!token.ok) {
      // 连令牌都没生成出来，重发没有意义
      return { ok: false };
    }

    const exchanged = await exchangeLoginToken(token.tokenHash, clients.anon);
    if (exchanged.ok) {
      return { ok: true, session: exchanged.session };
    }
    if (!exchanged.rejected) {
      // 平台没明确拒绝（不可达 / 响应不可用）：重发只是让用户多等一遍
      return { ok: false };
    }
    // 走到这里 = 手里这张令牌被顶掉了，下一轮重新生成一张
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
