// HTTP 层：校验入参、调微信换取、解析身份、签发会话（AD-12 / AD-22）。
// 成功返回平台会话本体（2xx）；失败返回 { code, message }：code 是稳定契约
// （login_error_code 类别），message 只是给人看的文案。
// message 与日志中不得出现 AppSecret、服务端密钥、堆栈或数据库细节。
// 关键失败（非 2xx）输出结构化日志：错误类别 + 请求标识（NFR3、Story 2.6）。

import type { WechatIdentity } from "./identity.ts";
import type { LoginSession } from "./session.ts";
import { code2Session, type LoginErrorCode } from "./wechat.ts";

/** 失败发生在哪一步（日志用，便于定位） */
export type LoginFailureStage =
  | "request"
  | "config"
  | "wechat"
  | "identity"
  | "session";

/** 关键失败日志：只带类别与请求标识，不带密钥、堆栈或数据库细节（NFR3） */
export type LoginFailureLog = {
  event: "wechat_login_failed";
  requestId: string;
  code: LoginErrorCode;
  status: number;
  stage: LoginFailureStage;
};

export type WechatLoginDeps = {
  appId: string;
  appSecret: string;
  fetchFn: typeof fetch;
  /** Story 2.2：把 openid 解析为平台用户与身份映射；失败抛错，由本层归为 identity_failed。 */
  resolveIdentity: (openid: string) => Promise<WechatIdentity>;
  /** Story 2.3：为已确定的身份签发平台会话；失败抛错，由本层归为 session_failed。 */
  issueSession: (identity: WechatIdentity) => Promise<LoginSession>;
  /** 关键失败日志出口；缺省不记（离线脚本可省略） */
  log?: (record: LoginFailureLog) => void;
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
  identity_failed: 500, // 身份解析失败：服务端内部故障，调用方只能重试
  session_failed: 500, // 会话签发失败：服务端内部故障，调用方只能重试
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
  identity_failed: "Could not establish the user identity",
  session_failed: "Could not establish a session",
};

function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
    },
  });
}

export async function handleRequest(
  req: Request,
  deps: WechatLoginDeps,
): Promise<Response> {
  // 请求标识：随响应头返回，客户端可用来与服务端日志对账（Story 2.6）
  const requestId = crypto.randomUUID();

  const errorResponse = (
    code: LoginErrorCode,
    stage: LoginFailureStage,
    status: number = errorStatus[code],
    message: string = errorMessages[code],
  ): Response => {
    deps.log?.({
      event: "wechat_login_failed",
      requestId,
      code,
      status,
      stage,
    });
    return jsonResponse({ code, message }, status, requestId);
  };

  if (req.method !== "POST") {
    return errorResponse("invalid_request", "request", 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_request", "request");
  }

  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || code.trim() === "") {
    return errorResponse("invalid_request", "request");
  }

  if (deps.appId === "" || deps.appSecret === "") {
    // 缺配置时快速失败，不拿 undefined 去打微信；只报变量名，不报变量值
    return errorResponse(
      "unknown",
      "config",
      500,
      "Server is missing WECHAT_APP_ID or WECHAT_APP_SECRET",
    );
  }

  // 1. fetch 微信接口获取openid
  const result = await code2Session({
    appId: deps.appId,
    appSecret: deps.appSecret,
    code,
    fetchFn: deps.fetchFn,
  });
  if (!result.ok) {
    return errorResponse(result.code, "wechat");
  }

  // 2. 核心代码。创建auth.users和对应的wechat_identities
  let identity: WechatIdentity;
  try {
    identity = await deps.resolveIdentity(result.openid);
  } catch {
    // 身份解析失败属服务端内部故障：只给稳定类别，不带任何内部细节（NFR3、FR-P2-5）
    return errorResponse("identity_failed", "identity");
  }

  // 3. 给当前用户派发token
  try {
    const session = await deps.issueSession(identity);
    return jsonResponse(session, 200, requestId);
  } catch {
    // 会话签发失败同上；失败不会留下半登录状态，客户端重试即可（FR-P2-3）
    return errorResponse("session_failed", "session");
  }
}
