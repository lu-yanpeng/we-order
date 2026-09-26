/**
 * 错误形状与类别联合（P3 AD-6 / AR-P3-10）
 *
 * `AppError` 是全客户端唯一的失败形状：`core/transport` 把平台 / 服务端 / 客户端
 * 的各类失败归一成它之后才允许上浮；alova 的错误对象不进入 Composable。
 *
 * 类别取值集合的来源一律是数据库：
 * - `LoginErrorCode` / `OrderErrorCode` 窄化生成类型（枚举新增时编译期暴露）；
 * - `ClientErrorCode` 是纯客户端的封闭集合（AD-6 指定四值），由客户端自行定义。
 *
 * 文案不是契约：翻译函数在 `utils/error-copy.ts`，按 `source` 选域。
 */
import type { Database } from '../../../supabase/types/database.types'

/** 登录域类别：唯一来源是数据库枚举 `login_error_code` */
export type LoginErrorCode = Database['public']['Enums']['login_error_code']

/** 订单域类别：唯一来源是数据库枚举 `order_error_code` */
export type OrderErrorCode = Database['public']['Enums']['order_error_code']

/** 纯客户端失败类别（AD-6 客户端类别集合，封闭四值） */
export type ClientErrorCode =
  'network_unreachable' | 'timeout' | 'request_cancelled' | 'session_expired'

/** 错误域：决定文案表与类别枚举（AD-6 按端点分派） */
export type ErrorSource = 'login' | 'order' | 'client'

/**
 * 归一后的失败形状。
 * - `code`：稳定类别；服务端类别以生成类型为唯一来源，平台 auth 与未知类别原样承载后由文案兜底；
 * - `source`：域，翻译函数据此选表；
 * - `status`：HTTP 状态码（没有 HTTP 交互时为 undefined）；
 * - `requestId`：服务端 `x-request-id`，供与服务端日志对账（网络失败时没有）。
 */
export type AppError = {
  code: string
  source: ErrorSource
  status?: number
  requestId?: string
}
