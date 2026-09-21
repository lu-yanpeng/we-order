/**
 * 登录链路与会话的唯一出口（AR-9、AD-14）。
 *
 * 上层（composable / 页面）只能看到「拿当前会话主体」这一件事：
 * - 需要身份时 api/ 内部保证存在有效会话（惰性登录，启动时不强制）
 * - 会话的持有、持久化、过期判断、续期与失败回退全部封在本目录内；
 *   上层代码不出现 token 一词，请求头构造只在 http.ts
 * - 不向上层暴露「未登录」状态：要么成功返回，要么抛 AuthError
 */
import { supabaseRequest } from './http'
import { ensureSession } from './session'

export { AuthError } from './http'
export { authErrorMessage } from './errors'
export type { LoginErrorCode } from './errors'

/** 会话主体（平台用户）；只含 id，平台完整 user 对象不外传 */
export type SessionUser = { id: string }

/**
 * 携带会话查询当前会话主体（平台自带的当前用户查询）。
 * 访问凭证将过期时先续期再发请求，调用方感知不到过期这件事。
 */
export async function getSessionUser(): Promise<SessionUser> {
  const session = await ensureSession()
  const user = await supabaseRequest<{ id: string }>({
    path: '/auth/v1/user',
    accessToken: session.accessToken,
  })
  return { id: user.id }
}
