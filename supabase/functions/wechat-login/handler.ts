import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import type { Database } from "../../types/database.types.ts";
import { errorResponse } from "./errors.ts";
import { ensureIdentity, syntheticEmail } from "./identity.ts";
import { issueSession } from "./session.ts";
import { exchangeCode, type FetchLike } from "./wechat.ts";

export type WechatLoginConfig = {
  appId?: string;
  appSecret?: string;
  apiBase?: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  anonKey?: string;
  fetchFn?: FetchLike;
};

/** 建平台客户端用的配置：地址 + 密钥（服务端密钥或发布密钥） */
type PlatformClientConfig = {
  supabaseUrl: string;
  key: string;
  fetchFn?: FetchLike;
};

/** 建平台客户端。官方 SDK 的入口只有这一处；自定义 fetch 仅供测试注入。 */
export function createPlatformClient(config: PlatformClientConfig): SupabaseClient<Database> {
  return createClient<Database>(config.supabaseUrl, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: config.fetchFn ? { fetch: config.fetchFn } : undefined,
  });
}

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

      if (!config.supabaseUrl || !config.serviceRoleKey || !config.anonKey) {
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

      const platformUrl = config.supabaseUrl;
      const admin = createPlatformClient({
        supabaseUrl: platformUrl,
        key: config.serviceRoleKey,
        fetchFn: config.fetchFn,
      });

      const identity = await ensureIdentity(result.openid, admin);
      if (!identity.ok) {
        return errorResponse("unknown");
      }

      // 兑换用发布密钥：它就是客户端本来会用的那个身份，不是服务端密钥
      const anon = createPlatformClient({ supabaseUrl: platformUrl, key: config.anonKey, fetchFn: config.fetchFn });

      const issued = await issueSession(syntheticEmail(result.openid), { admin, anon });
      if (!issued.ok) {
        return errorResponse("unknown");
      }

      // 响应含刷新凭证：不下发 openid / user_id，也不打日志
      return Response.json(issued.session);
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
