/**
 * 错误归一表：**唯一实现**（P3 AD-6 / AR-P3-10）
 *
 * 输入是「原始失败」——已经脱离 alova / uni 的纯数据结构，因此本文件是纯函数，
 * 可直接单元测试。归一规则（与 spine 的 AD-6 表逐行对应）：
 *
 *   | 来源            | 收到什么                                         | 归一为                          |
 *   | RPC             | P0001 + message ∈ order_error_code               | order 域该类别                  |
 *   | RPC             | P0001 + 未知 message                             | order.unknown                   |
 *   | RPC             | 42501                                            | order.unknown（不触发续期）     |
 *   | pay-order       | 非 2xx + { code } ∈ order_error_code              | order 域该类别；未知 → unknown  |
 *   | wechat-login    | 非 2xx + { code } ∈ login_error_code              | login 域该类别；未知 → unknown  |
 *   | 平台 auth       | { error_code | code }                            | login 域原样承载，翻译兜底      |
 *   | 任意（非 auth） | 401 / PGRST301 / not_authenticated               | 会话类（先续期重放，见 instance）|
 *   | 任意            | 42501 与 401 同现                                | 以 SQLSTATE 为准 → order.unknown|
 *   | uni.request     | fail：timeout / abort / 其他                     | client 域三类别                 |
 *
 * `rest` 路由（目录 / 门店等 REST 读取）不在 AD-6 表的显式覆盖里：未归类的服务端
 * 失败统一落入 `order.unknown` 的兜底文案（域模型没有目录域，见 Story 1.2 验收记录）。
 */
import type { AppError } from '@/types/errors'
import { LOGIN_ERROR_CODE_SET, ORDER_ERROR_CODE_SET } from './error-codes'

/** 端点路由：决定服务端类别属于哪个枚举域（AD-6 按端点分派） */
export type EndpointRoute = 'rpc' | 'pay-order' | 'wechat-login' | 'platform-auth' | 'rest'

/** HTTP 失败：承载字段保持平台原样（PostgREST / 边缘函数 / 平台 auth 三类载荷） */
export type HttpFailure = {
  kind: 'http'
  status: number
  body: unknown
  requestId?: string
  route: EndpointRoute
}

/** 传输失败：uni.request fail（适配器只抛 Error(errMsg)） */
export type TransportFailure = {
  kind: 'transport'
  errMsg: string
}

export type RawFailure = HttpFailure | TransportFailure

/** uni.request 结果里本模块需要的字段（避免依赖 uni 全局类型；下载类结果无 data） */
export type UniResponseLike = {
  statusCode?: number
  data?: unknown
  header?: unknown
}

/** 按 URL 判定端点路由；`pay-order` / `wechat-login` 必须排在通用前缀之前 */
export function routeOfUrl(url: string): EndpointRoute {
  if (url.startsWith('/functions/v1/pay-order')) return 'pay-order'
  if (url.startsWith('/functions/v1/wechat-login')) return 'wechat-login'
  if (url.startsWith('/rest/v1/rpc/')) return 'rpc'
  if (url.startsWith('/auth/v1/')) return 'platform-auth'
  return 'rest'
}

/** 读取服务端请求标识；uni 的响应头键为小写，这里仍做大小写不敏感匹配 */
function readRequestId(header: unknown): string | undefined {
  if (header === null || typeof header !== 'object') return undefined
  const record = header as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === 'x-request-id') {
      const value = record[key]
      return typeof value === 'string' && value !== '' ? value : undefined
    }
  }
  return undefined
}

/** 读取响应体；下载类结果没有 data，返回 undefined（本通道不使用下载） */
export function readResponseData(response: UniResponseLike): unknown {
  return response.data
}

/** 2xx 之外的响应转成原始失败；2xx 返回 null */
export function toHttpFailure(response: UniResponseLike, route: EndpointRoute): HttpFailure | null {
  const status = response.statusCode ?? 0
  if (status >= 200 && status < 300) return null
  return {
    kind: 'http',
    status,
    body: response.data,
    requestId: readRequestId(response.header),
    route,
  }
}

/** alova 的传输错误转成原始失败；适配器只会抛 Error，其余类型兜底成字符串 */
export function toTransportFailure(error: unknown): TransportFailure {
  const errMsg = error instanceof Error ? error.message : String(error)
  return { kind: 'transport', errMsg }
}

/** 三类错误载荷的公共字段：PostgREST / 边缘函数用 code+message，平台 auth 用 error_code+msg */
type ServerErrorFields = {
  code?: string
  message?: string
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
    // 平台 auth 的 code 是数字（如 400），原样承载为字符串
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function readServerError(body: unknown): ServerErrorFields | null {
  if (body === null || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const code = pickString(record, ['error_code', 'code'])
  const message = pickString(record, ['message', 'msg'])
  if (code === undefined && message === undefined) return null
  return { code, message }
}

/**
 * 是否属于「会话类失败」：401 / PGRST301 / not_authenticated。
 * 会话类不走文案表，而是先续期并重放一次（见 instance.ts）；42501 优先判定，
 * 与 401 同现时以 SQLSTATE 为准（AD-6）。
 * 平台 auth 与 wechat-login 自身返回的 400/401 不是会话类（那是登录失败，交给调用方处理）。
 */
export function isSessionFailure(failure: RawFailure): boolean {
  if (failure.kind !== 'http') return false
  if (failure.route === 'platform-auth' || failure.route === 'wechat-login') return false

  const { code, message } = readServerError(failure.body) ?? {}
  if (code === '42501') return false
  if (failure.status === 401) return true
  if (code === 'PGRST301') return true
  if (code === 'not_authenticated') return true
  if (code === 'P0001' && message === 'not_authenticated') return true
  return false
}

/** 会话恢复失败的统一出口：client.session_expired（AD-6） */
export function sessionExpiredError(cause?: HttpFailure): AppError {
  return {
    source: 'client',
    code: 'session_expired',
    status: cause?.status,
    requestId: cause?.requestId,
  }
}

/** 归一：原始失败 → AppError（唯一实现） */
export function normalizeFailure(failure: RawFailure): AppError {
  if (failure.kind === 'transport') {
    const errMsg = failure.errMsg.toLowerCase()
    if (errMsg.includes('timeout')) return { source: 'client', code: 'timeout' }
    if (errMsg.includes('abort')) return { source: 'client', code: 'request_cancelled' }
    return { source: 'client', code: 'network_unreachable' }
  }

  const context = { status: failure.status, requestId: failure.requestId }
  const serverError = readServerError(failure.body)

  // 42501 优先于 401：权限拒绝不是会话问题，不触发续期（AD-6）
  if (serverError?.code === '42501') {
    return { source: 'order', code: 'unknown', ...context }
  }

  switch (failure.route) {
    case 'rpc': {
      // PostgREST 把 raise exception 转成 P0001 + message = 类别值
      const category = serverError?.code === 'P0001' ? serverError.message : undefined
      if (category !== undefined && ORDER_ERROR_CODE_SET.has(category)) {
        return { source: 'order', code: category, ...context }
      }
      return { source: 'order', code: 'unknown', ...context }
    }
    case 'pay-order': {
      if (serverError?.code !== undefined && ORDER_ERROR_CODE_SET.has(serverError.code)) {
        return { source: 'order', code: serverError.code, ...context }
      }
      return { source: 'order', code: 'unknown', ...context }
    }
    case 'wechat-login': {
      if (serverError?.code !== undefined && LOGIN_ERROR_CODE_SET.has(serverError.code)) {
        return { source: 'login', code: serverError.code, ...context }
      }
      return { source: 'login', code: 'unknown', ...context }
    }
    case 'platform-auth': {
      // 平台 auth 的错误码不属于客户端枚举（如 invalid_grant），原样承载、翻译兜底
      return { source: 'login', code: serverError?.code ?? 'unknown', ...context }
    }
    case 'rest': {
      // 目录 / 门店等 REST 读取：AD-6 未定义独立域，未归类失败落 order.unknown 兜底文案
      return { source: 'order', code: 'unknown', ...context }
    }
  }
}
