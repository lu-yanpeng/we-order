// 会话签发（Story 2.3；FR-P2-3、AD-16）。
//
// 平台标准机制、禁止自签 JWT：用官方 admin API 生成一次性登录令牌（magiclink），
// 同一请求内用官方 verifyOtp 立即兑换为平台会话（访问凭证 + 刷新凭证）。
// 令牌不落库、不返回客户端；单次消费与有效期由平台保证（expiry 见 config.toml
// 的 auth.email.otp_expiry，本地默认 1 小时）。
// 客户端凭该会话即可访问受数据访问策略保护的数据，无需额外凭证。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "../../types/database.types.ts";
import type { WechatIdentity } from "./identity.ts";

type Client = SupabaseClient<Database>;

/** 会话签发失败：handler 依此返回 session_failed，内部细节不出函数（NFR3）。 */
export class SessionIssueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionIssueError";
  }
}

/**
 * 返回给客户端的会话，与平台 token 端点（登录 / 续期）同构，只保留客户端需要的字段：
 * 两个凭证、过期判断所需的 expires_in / expires_at、会话主体 id。
 * 完整的平台 user 对象不外传——其中的 synthetic email 由 openid 派生，等于泄露 openid。
 */
export type LoginSession = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
  user: { id: string };
};

/**
 * 专用于一次性令牌兑换的公开客户端（发布密钥）。
 *
 * verifyOtp 成功时会把会话写回所用客户端实例；服务端密钥客户端必须保持「未登录」，
 * 否则它后续的 REST 请求会改用该用户的 access token 发出，丢掉服务端权限
 * （边缘函数 worker 内的客户端跨请求共享，这个坑会被下一次请求踩到）。
 * 发布密钥随边缘函数运行环境注入（SUPABASE_ANON_KEY），不是秘密。
 */
export function createVerifyClient(
  supabaseUrl: string,
  anonKey: string,
): Client {
  return createClient<Database>(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * 会话签发器：generateLink 生成一次性登录令牌 → verifyOtp 立即兑换为平台会话。
 * admin 需要服务端密钥（generateLink 是 admin API）；verify 必须是独立的公开客户端，
 * 理由见 createVerifyClient。
 * 任一步失败都抛 SessionIssueError：用户与身份映射不受影响，客户端重试即可，
 * 不会留下半登录状态（FR-P2-3、FR-P2-5）。
 *
 * 已知并发行为（实测）：同一 email 生成新的一次性令牌会让之前未消费的令牌作废，
 * 因此同一身份的两个并发登录会有一个在 verifyOtp 处得到 403 → session_failed。
 * 这是平台的有意设计，这里不做重试：失败重试是登录链路的常态，客户端重试一次即可。
 */
export function createSessionIssuer(admin: Client, verify: Client) {
  return async function issueSession(
    identity: WechatIdentity,
  ): Promise<LoginSession> {
    const { data: link, error: linkError } = await admin.auth.admin
      .generateLink({
        type: "magiclink",
        email: identity.email,
      });
    if (linkError) {
      throw new SessionIssueError(
        `generate login token failed: ${linkError.message}`,
      );
    }

    const { data: verified, error: verifyError } = await verify.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.properties.hashed_token,
    });
    if (verifyError) {
      throw new SessionIssueError(
        `verify login token failed: ${verifyError.message}`,
      );
    }
    const session = verified.session;
    if (session === null) {
      throw new SessionIssueError("verify login token returned no session");
    }
    // 会话主体必须与 openid 映射到的用户一致；不一致宁可失败，也不签发错误的会话。
    if (session.user.id !== identity.userId) {
      throw new SessionIssueError("session subject does not match the mapping");
    }

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: session.token_type,
      expires_in: session.expires_in,
      // 平台总会带上 expires_at；缺失时按服务端时钟补一个，保证契约字段齐备。
      expires_at: session.expires_at ??
        Math.floor(Date.now() / 1000) + session.expires_in,
      user: { id: session.user.id },
    };
  };
}
