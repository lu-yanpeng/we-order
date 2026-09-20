// 微信凭证校验（code2Session）：把小程序的一次性凭证换成 openid（FR-P2-1）。
// 微信错误码 → 类别的映射只存在于本文件；类别取值来自数据库类型 login_error_code（AD-12）。
// session_key 本阶段用不到且属敏感凭据：不返回、不落库。

import type { Database } from "../../types/database.types.ts";

export type LoginErrorCode = Database["public"]["Enums"]["login_error_code"];

/** 成功只带回 openid；失败带回稳定类别。 */
export type Code2SessionResult =
  | { ok: true; openid: string }
  | { ok: false; code: LoginErrorCode };

const WECHAT_CODE2SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";

const wechatErrcodeMap: Record<number, LoginErrorCode> = {
  40013: "invalid_app_id",
  40125: "invalid_app_secret",
  40029: "invalid_code",
  40163: "code_expired_or_used",
  42003: "code_expired_or_used",
  40226: "risky_user_blocked",
  45011: "rate_limited",
  45009: "rate_limited",
  "-1": "wechat_unavailable",
};

function classifyWechatErrcode(errcode: number): LoginErrorCode {
  return wechatErrcodeMap[errcode] ?? "unknown";
}

/**
 * 调微信官方接口换取 openid。
 * fetchFn 由调用方注入：生产传全局 fetch，测试传假实现（离线、可控）。
 * 注意：URL 上带着 appSecret，任何日志都不许打印它。
 */
export async function code2Session(input: {
  appId: string;
  appSecret: string;
  code: string;
  fetchFn: typeof fetch;
}): Promise<Code2SessionResult> {
  const url = new URL(WECHAT_CODE2SESSION_URL);
  url.searchParams.set("appid", input.appId);
  url.searchParams.set("secret", input.appSecret);
  url.searchParams.set("js_code", input.code);
  url.searchParams.set("grant_type", "authorization_code");

  let payload: unknown;
  try {
    const response = await input.fetchFn(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { ok: false, code: "wechat_unavailable" };
    }
    payload = await response.json();
  } catch {
    // 连不上、超时、响应不是 JSON，对调用方都是同一件事：没有拿到微信的有效应答
    return { ok: false, code: "wechat_unavailable" };
  }

  if (typeof payload !== "object" || payload === null) {
    return { ok: false, code: "wechat_unavailable" };
  }

  const { openid, errcode } = payload as {
    openid?: unknown;
    errcode?: unknown;
  };

  if (typeof openid === "string" && openid !== "") {
    return { ok: true, openid };
  }
  if (typeof errcode === "number") {
    return { ok: false, code: classifyWechatErrcode(errcode) };
  }
  return { ok: false, code: "wechat_unavailable" };
}
