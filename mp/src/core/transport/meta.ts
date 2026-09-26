/**
 * api/ 方法在 alova `config.meta` 里携带的请求元信息（P3 AD-3）
 *
 * 身份要求由 `api/` 的方法声明，执行由 `core/transport` 的请求前拦截器完成：
 * - `anonymous`：不等待会话、不附 Authorization（目录 / 门店 / 图片）；
 * - `session-required`：先经 provider 会合（ensureSession）再附 Authorization（订单 / 支付）；
 *   会合失败统一产出 `client.session_expired`。
 *
 * 未声明 meta 时按 `anonymous` 处理（目录读取未登录即可用）；订单 / 支付方法必须显式声明。
 */
export type TransportMeta = {
  auth?: 'anonymous' | 'session-required'
  /** 内部使用：续期重放一次的去重标记，api/ 不需要（也不应）声明 */
  sessionRetried?: boolean
}

/** 裸通道的元信息：显式传访问凭证（平台 auth 端点用），不触发续期 / 重放 */
export type RawTransportMeta = {
  accessToken?: string
}
