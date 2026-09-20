// HTTP 层：校验入参、调微信换取、按平台标准错误载荷形状返回（AD-12 / AD-22）。
// 形状为 { code, message }：code 是稳定契约（login_error_code 类别），message 只是给人看的文案。
// message 中不得出现 AppSecret、服务端密钥、堆栈或数据库细节。

import { code2Session, type LoginErrorCode } from "./wechat.ts";

export type WechatLoginDeps = {
  appId: string;
  appSecret: string;
  fetchFn: typeof fetch;
};

const errorStatus: Record<LoginErrorCode, number> = {
  invalid_app_id: 500, // 服务端配置错误：调用方无法自行解决
  invalid_app_secret: 500,
  invalid_code: 400,
  code_expired_or_used: 400,
  invalid_request: 400,
  risky_user_blocked: 403,
  rate_limited: 429,
  wechat_unavailable: 503,
  unknown: 502,
  network_unreachable: 500, // 不由本函数产生；仅为类型完备保留
};

const errorMessages: Record<LoginErrorCode, string> = {
  invalid_app_id: "WeChat rejected the configured app id",
  invalid_app_secret: "WeChat rejected the configured app secret",
  invalid_code: "WeChat rejected the login code",
  code_expired_or_used: "The login code has expired or already been used",
  invalid_request: "Request body must be JSON with a non-empty string code",
  risky_user_blocked: "WeChat blocked this login",
  rate_limited: "WeChat rate limit exceeded, retry later",
  wechat_unavailable: "Could not get a valid response from WeChat",
  unknown: "WeChat returned an unrecognized error",
  network_unreachable: "Network unreachable",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(
  code: LoginErrorCode,
  status: number = errorStatus[code],
): Response {
  return jsonResponse({ code, message: errorMessages[code] }, status);
}

export async function handleRequest(
  req: Request,
  deps: WechatLoginDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("invalid_request", 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_request");
  }

  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || code.trim() === "") {
    return errorResponse("invalid_request");
  }

  if (deps.appId === "" || deps.appSecret === "") {
    // 缺配置时快速失败，不拿 undefined 去打微信；只报变量名，不报变量值
    return jsonResponse(
      {
        code: "unknown",
        message: "Server is missing WECHAT_APP_ID or WECHAT_APP_SECRET",
      },
      500,
    );
  }

  const result = await code2Session({ ...deps, code });
  if (!result.ok) {
    return errorResponse(result.code);
  }
  return jsonResponse({ openid: result.openid }, 200);
}
