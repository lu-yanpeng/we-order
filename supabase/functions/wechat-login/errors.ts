import type { Database } from "../../types/database.types.ts";

/**
 * 登录错误类别：取值集合的唯一来源是数据库枚举 login_error_code（AD-12）。
 * 服务端响应、客户端翻译函数、测试断言都引用这一份，不各自发明字符串。
 */
export type LoginErrorCode = Database["public"]["Enums"]["login_error_code"];

/**
 * 服务端会返回的类别。network_unreachable 由客户端判定（请求发不出去），
 * 服务端永远不会产生它。
 */
export type ServerLoginErrorCode = Exclude<LoginErrorCode, "network_unreachable">;

/** 类别 → HTTP 状态码 */
const STATUS: Record<ServerLoginErrorCode, number> = {
  invalid_app_id: 500,
  invalid_app_secret: 500,
  invalid_code: 400,
  code_expired_or_used: 400,
  risky_user_blocked: 403,
  rate_limited: 429,
  wechat_unavailable: 502,
  unknown: 500,
};

/** 类别 → 固定短文案：给人和日志看，不透传微信原文，也不是客户端展示用的契约 */
const MESSAGES: Record<ServerLoginErrorCode, string> = {
  invalid_app_id: "小程序 AppID 无效",
  invalid_app_secret: "小程序密钥无效",
  invalid_code: "登录凭证无效",
  code_expired_or_used: "登录凭证已过期或已被使用",
  risky_user_blocked: "该账号暂时无法登录",
  rate_limited: "请求过于频繁",
  wechat_unavailable: "微信服务暂时不可用",
  unknown: "登录服务暂时不可用",
};

export function errorResponse(code: ServerLoginErrorCode): Response {
  return Response.json({ code, message: MESSAGES[code] }, { status: STATUS[code] });
}
