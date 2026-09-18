import { errorResponse } from "./errors.ts";
import { ensureIdentity } from "./identity.ts";
import { exchangeCode, type FetchLike } from "./wechat.ts";

export type WechatLoginConfig = {
  appId?: string;
  appSecret?: string;
  apiBase?: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetchFn?: FetchLike;
};

/** 调用本函数时客户端尚无会话，输入由函数内自行校验（AD-16）。 */
export function createWechatLoginHandler(config: WechatLoginConfig) {
  return async function handle(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST") {
        return Response.json({ code: "unknown", message: "不支持的请求方法" }, { status: 405 });
      }

      const code = await readCode(request);
      if (code === null) {
        return errorResponse("invalid_code");
      }

      if (!config.appId) {
        return errorResponse("invalid_app_id");
      }
      if (!config.appSecret) {
        return errorResponse("invalid_app_secret");
      }

      if (!config.supabaseUrl || !config.serviceRoleKey) {
        return errorResponse("unknown");
      }

      const result = await exchangeCode(code, {
        appId: config.appId,
        appSecret: config.appSecret,
        apiBase: config.apiBase,
        fetchFn: config.fetchFn,
      });
      if (!result.ok) {
        return errorResponse(result.code);
      }

      const identity = await ensureIdentity(result.openid, {
        supabaseUrl: config.supabaseUrl,
        serviceRoleKey: config.serviceRoleKey,
        fetchFn: config.fetchFn,
      });
      if (!identity.ok) {
        return errorResponse("unknown");
      }

      return Response.json({ openid: result.openid, user_id: identity.userId });
    } catch {
      // 兜底：未预料到的异常只回类别，不泄露堆栈或数据库细节
      return errorResponse("unknown");
    }
  };
}

/** 请求体只认一个非空的 code 字符串，其余输入一律按「凭证无效」处理。 */
async function readCode(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { code?: unknown };
    if (typeof body.code === "string" && body.code.trim() !== "") {
      return body.code.trim();
    }
  } catch {
    // 非法 JSON
  }
  return null;
}
