/**
 * 服务端错误类别的运行时允许清单（P3 AD-6）
 *
 * 生成类型只在编译期存在（`type` 导入会被擦除、不进小程序包），而归一表需要在运行期
 * 判断「服务端返回的类别值是否属于该域」。因此这里手写一份运行时清单，并用类型断言
 * 保证它与生成枚举**互相穷尽**：枚举新增取值时 `Expect<Equal<...>>` 立即编译报错。
 */
import type { LoginErrorCode, OrderErrorCode } from '@/types/errors'

/** 订单域类别清单（顺序与数据库枚举一致，便于人工核对） */
export const ORDER_ERROR_CODES = [
  'invalid_request',
  'invalid_quantity',
  'invalid_selection',
  'product_unavailable',
  'not_authenticated',
  'store_unavailable',
  'invalid_transition',
  'order_not_found',
  'invalid_status',
  'unknown',
] as const

/** 登录域类别清单（顺序与数据库枚举一致，便于人工核对） */
export const LOGIN_ERROR_CODES = [
  'invalid_app_id',
  'invalid_app_secret',
  'invalid_code',
  'code_expired_or_used',
  'invalid_request',
  'risky_user_blocked',
  'rate_limited',
  'wechat_unavailable',
  'unknown',
  'network_unreachable',
  'identity_failed',
  'session_failed',
] as const

export const ORDER_ERROR_CODE_SET: ReadonlySet<string> = new Set(ORDER_ERROR_CODES)
export const LOGIN_ERROR_CODE_SET: ReadonlySet<string> = new Set(LOGIN_ERROR_CODES)

// ── 编译期穷尽检查：清单与生成枚举必须双向一致 ────────────────────────────────

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

type OrderCodesExhaustive = Expect<Equal<(typeof ORDER_ERROR_CODES)[number], OrderErrorCode>>
type LoginCodesExhaustive = Expect<Equal<(typeof LOGIN_ERROR_CODES)[number], LoginErrorCode>>

/** 供编译期检查使用，运行时无意义（导出以避免「未使用」告警） */
export type ErrorCodeListChecks = [OrderCodesExhaustive, LoginCodesExhaustive]
