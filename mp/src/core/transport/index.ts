/**
 * core/transport 对外出口（只允许 api/ 引用，P3 AD-1）
 *
 * - `transport`：业务通道（REST / RPC / 边缘函数），自动带请求头、错误归一、
 *   会话类失败续期重放一次；api/ 方法用它定义并导出 alova Method（AD-5）。
 * - `rawTransport`：裸通道（不等待会话、不续期、不重放），仅 `core/session` 使用。
 * - `registerSessionProvider`：会话插槽注册；唯一调用方是 `core/session`（Story 1.3）。
 *
 * api/ 方法示例（Story 2.1 起）：
 *   transport.Get<MenuCategory[]>('/rest/v1/menu', { meta: { auth: 'anonymous' } })
 *   transport.Post<OrderResult>('/functions/v1/pay-order', body, { meta: { auth: 'session-required' } })
 */
import { supabasePublishableKey, supabaseUrl } from './config'
import { createTransport } from './instance'

export { registerSessionProvider } from './provider'
export type { SessionProvider } from './provider'
export type { RawTransportMeta, TransportMeta } from './meta'
export type {
  AppError,
  ClientErrorCode,
  ErrorSource,
  LoginErrorCode,
  OrderErrorCode,
} from '@/types/errors'

const { business, raw } = createTransport({
  baseURL: supabaseUrl(),
  publishableKey: supabasePublishableKey(),
})

/** 业务通道：客户端创建订单、读取目录 / 订单等一切业务后端访问 */
export const transport = business

/** 裸通道：仅 core/session 调平台 auth 端点与 wechat-login */
export const rawTransport = raw
