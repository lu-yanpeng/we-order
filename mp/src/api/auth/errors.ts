/**
 * 登录错误类别的唯一翻译点（FR-P2-5、AD-12、Story 2.6）。
 *
 * - 类别取值集合来自数据库枚举 `login_error_code`（随类型契约生成，唯一来源）；
 *   文案表按该联合类型写全所有类别，枚举新增取值时这里会编译报错，防止漏翻译。
 * - `authErrorMessage` 是客户端唯一的「类别 → 文案」函数：未知类别（如平台 auth
 *   端点返回的错误码）一律用兜底文案，不透传服务端 message、堆栈或数据库细节。
 * - 文案不是契约；Phase 2 结束后验证页删除，此函数留给 Phase 3 的提示界面。
 */
import type { Database } from '../../../../supabase/types/database.types'
import { AuthError } from './http'

/** 登录错误类别：唯一来源是数据库枚举 login_error_code */
export type LoginErrorCode = Database['public']['Enums']['login_error_code']

/** 类别 → 文案（Record 保证每个类别都有翻译） */
const messages: Record<LoginErrorCode, string> = {
  invalid_app_id: '服务配置异常，请联系管理员',
  invalid_app_secret: '服务配置异常，请联系管理员',
  invalid_code: '登录凭证无效，请重试',
  code_expired_or_used: '登录凭证已失效，请重试',
  invalid_request: '请求参数异常，请重试',
  risky_user_blocked: '当前账号被限制登录，请稍后重试',
  rate_limited: '操作太频繁，请稍后重试',
  wechat_unavailable: '微信服务暂时不可用，请稍后重试',
  unknown: '登录失败，请稍后重试',
  network_unreachable: '网络不可用，请检查网络后重试',
  identity_failed: '登录服务暂时不可用，请稍后重试',
  session_failed: '登录服务暂时不可用，请稍后重试',
}

/** 未知类别的兜底文案（非本枚举的错误码、非 AuthError 的异常） */
const FALLBACK_MESSAGE = '登录失败，请稍后重试'

function isLoginErrorCode(value: string): value is LoginErrorCode {
  return Object.prototype.hasOwnProperty.call(messages, value)
}

/** 客户端唯一的错误翻译函数：AuthError 的类别 → 文案；其余一律兜底 */
export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthError && isLoginErrorCode(error.code)) {
    return messages[error.code]
  }
  return FALLBACK_MESSAGE
}
