/**
 * 类别 → 文案：全客户端**唯一**翻译函数（P3 AD-6、AD-17 / AR-P3-20）
 *
 * - 签名 `(error: AppError) => string`，按 `source` 选域表；域表用 `Record<联合类型, string>`
 *   写全，枚举新增取值时这里编译报错（防漏翻译）；
 * - 文案不是契约：类别是稳定契约，文案随演示可改；
 * - 未知类别落到该域的 `unknown` 文案，绝不透传服务端 message / 堆栈 / 数据库细节 / 密钥 / OpenID；
 * - `request_cancelled` 返回空串，表示不产生用户可见提示（由消费方跳过空串）；
 * - 「同一失败只提示一次」由消费类别的 Composable 保证，不在本函数内去重。
 *
 * 文案基准 = spine「最小 UI 规范」：登录类沿用 Phase 2、订单类新增 10 项、客户端类 4 项。
 */
import type {
  AppError,
  ClientErrorCode,
  ErrorSource,
  LoginErrorCode,
  OrderErrorCode,
} from '@/types/errors'

/** 登录域文案（沿用 Phase 2 表） */
const LOGIN_COPY: Record<LoginErrorCode, string> = {
  invalid_app_id: '服务配置异常，请联系管理员',
  invalid_app_secret: '服务配置异常，请联系管理员',
  invalid_code: '登录凭证无效，请重试',
  code_expired_or_used: '登录凭证已失效，请重试',
  invalid_request: '请求参数异常，请重试',
  risky_user_blocked: '当前账号被限制登录，请稍后重试',
  rate_limited: '操作太频繁，请稍后重试',
  wechat_unavailable: '微信服务暂时不可用，请稍后重试',
  unknown: '登录失败，请稍后重试',
  // 枚举中存在但服务端不产生；出现时按客户端类文案处理（spine 最小 UI 规范）
  network_unreachable: '网络不可用，请检查网络后重试',
  identity_failed: '登录服务暂时不可用，请稍后重试',
  session_failed: '登录服务暂时不可用，请稍后重试',
}

/** 订单域文案（最小 UI 规范新增 10 项） */
const ORDER_COPY: Record<OrderErrorCode, string> = {
  invalid_request: '请求有误，请重试',
  invalid_quantity: '商品数量不正确，请调整后重试',
  invalid_selection: '规格选项已变更，请重新选择',
  product_unavailable: '部分商品已售罄或已下架，请调整购物车后重试',
  not_authenticated: '登录状态已失效，请重试',
  store_unavailable: '门店暂时无法下单，请稍后重试',
  order_not_found: '订单不存在或已失效',
  invalid_status: '当前状态不支持该操作，请刷新后重试',
  invalid_transition: '操作无法完成，请刷新后重试',
  unknown: '操作失败，请稍后重试',
}

/** 客户端域文案；空串 = 不产生用户可见提示 */
const CLIENT_COPY: Record<ClientErrorCode, string> = {
  network_unreachable: '网络不可用，请检查网络后重试',
  timeout: '请求超时，请重试',
  session_expired: '登录状态已失效，请重试',
  request_cancelled: '',
}

function pickCopy(table: Record<string, string>, code: string, fallback: string): string {
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : fallback
}

/** 唯一翻译函数：AppError → 用户可见文案（空串表示不展示） */
export function errorCopy(error: AppError): string {
  switch (error.source) {
    case 'login':
      return pickCopy(LOGIN_COPY, error.code, LOGIN_COPY.unknown)
    case 'order':
      return pickCopy(ORDER_COPY, error.code, ORDER_COPY.unknown)
    case 'client':
      // 客户端类别是封闭集合；未知值属程序缺陷，按“不展示”防御（与 request_cancelled 一致）
      return pickCopy(CLIENT_COPY, error.code, '')
  }
}

const APP_ERROR_SOURCES: readonly ErrorSource[] = ['login', 'order', 'client']

/** 类型守卫：消费方拿到 unknown 异常时用它收窄到 AppError（transport 只会抛 AppError） */
export function isAppError(value: unknown): value is AppError {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.code === 'string' && APP_ERROR_SOURCES.includes(record.source as ErrorSource)
}
