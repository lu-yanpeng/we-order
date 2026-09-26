/**
 * core/session 对外出口（只允许 `api/` 引用，P3 AD-1、AD-2）
 *
 * - 装载时向 `core/transport` 注册会话 provider（取凭证 + 会合会话），
 *   填补 Story 1.2 预留的插槽；
 * - 对外提供取凭证、取本人标识、`ensureSession()` 与凭证变更通知；
 * - 会话的持久化、续期、回退重登全部封在本模块内；页面 / Composable 不可见，
 *   只能经 `api/auth.ts` 门面的预热与本人标识两个动作接触。
 */
import { registerSessionProvider } from '@/core/transport'
import { fetchLoginCode, loginWithCode, refreshWithToken } from './login'
import { createSession } from './session'

const instance = createSession({
  fetchLoginCode,
  login: loginWithCode,
  refresh: refreshWithToken,
})

registerSessionProvider({
  getAccessToken: () => instance.getAccessToken(),
  ensureSession: (force) => instance.ensureSession(force),
})

export const ensureSession = instance.ensureSession
export const getAccessToken = instance.getAccessToken
export const getUserId = instance.getUserId
export const subscribeSession = instance.subscribeSession
export type { SessionSnapshot } from './session'
