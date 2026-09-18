import type { ServerLoginErrorCode } from "./errors.ts";

const WECHAT_API_BASE = "https://api.weixin.qq.com";

/**
 * 微信错误码 → 错误类别（码表见 docs/phase-2/addendum.md §H）。
 * 映射只存在于此；未列出的错误码一律落到 unknown，绝不把微信原文透传给客户端。
 */
const WECHAT_ERROR_CODES: Record<string, ServerLoginErrorCode> = {
  "40013": "invalid_app_id",
  "40125": "invalid_app_secret",
  "40029": "invalid_code",
  "40163": "code_expired_or_used",
  "42003": "code_expired_or_used",
  "40226": "risky_user_blocked",
  "45011": "rate_limited",
  "45009": "rate_limited",
  "-1": "wechat_unavailable",
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ExchangeResult =
  | { ok: true; openid: string }
  | { ok: false; code: ServerLoginErrorCode };

export type ExchangeOptions = {
  appId: string;
  appSecret: string;
  apiBase?: string;
  fetchFn?: FetchLike;
};

/** 用一次性凭证向微信换取 OpenID；本函数不创建任何用户（属 Story 2.2）。 */
export async function exchangeCode(code: string, options: ExchangeOptions): Promise<ExchangeResult> {
  const { appId, appSecret, apiBase = WECHAT_API_BASE, fetchFn = fetch } = options;

  const url = new URL("/sns/jscode2session", apiBase);
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  let response: Response;
  try {
    response = await fetchFn(url);
  } catch {
    // 微信不可达（DNS、超时、连接被拒）：不是客户端凭证的问题，归为微信侧不可用
    return { ok: false, code: "wechat_unavailable" };
  }

  let payload: { errcode?: number; openid?: string };
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: "unknown" };
  }

  if (typeof payload.errcode === "number" && payload.errcode !== 0) {
    return { ok: false, code: WECHAT_ERROR_CODES[String(payload.errcode)] ?? "unknown" };
  }
  if (typeof payload.openid === "string" && payload.openid !== "") {
    return { ok: true, openid: payload.openid };
  }
  return { ok: false, code: "unknown" };
}
