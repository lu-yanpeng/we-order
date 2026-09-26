/**
 * 会话 provider：`core/transport` 与 `core/session` 之间的依赖反转插槽（P3 AD-1、AD-2）
 *
 * 依赖方向是 `core/session → core/transport`（session 经裸通道调平台 auth 端点），
 * 因此 transport 不能 import session。取凭证与会话失效处理由 session 在装载时
 * 注册进这个插槽，transport 只认接口、不认实现（避免循环依赖）。
 */
export type SessionProvider = {
  /** 取当前访问凭证；没有可用会话时返回 undefined */
  getAccessToken(): string | undefined
  /**
   * 会合语义（AD-4）：等待 / 取得一份有效会话。
   * - 不传 force：已有有效会话直接复用，续期 / 登录在飞时等待并复用结果；
   * - `force = true`：当前凭证被服务端拒绝后的强制恢复（续期失败回退重登），
   *   仍保持单飞（由 session 保证）。
   * 失败时抛错，由 transport 统一归一为 `client.session_expired`。
   */
  ensureSession(force?: boolean): Promise<void>
}

let sessionProvider: SessionProvider | null = null

/** 装载时注册（唯一调用方：core/session）；传 null 可清除（测试用） */
export function registerSessionProvider(provider: SessionProvider | null): void {
  sessionProvider = provider
}

/** transport 内部读取当前 provider；未注册时返回 null（请求照发、不等待会话） */
export function getSessionProvider(): SessionProvider | null {
  return sessionProvider
}
