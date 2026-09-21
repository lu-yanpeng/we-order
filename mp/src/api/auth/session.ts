/**
 * 会话状态机：持久化、过期判断、单飞续期、失败回退重登（FR-P2-4、AD-14）。
 *
 * 对 api/ 内部只暴露 ensureSession()：拿到的一定是可用会话，
 * 「未登录」这个概念不出本模块（AD-14）。
 *
 * 单飞：同一时刻只有一个「取有效会话」（续期，或其失败后的回退重登）在飞，
 * 其余调用等待并复用同一结果；重登也在这条链上，避免并发触发多次登录。
 */
import { AuthError, supabaseRequest } from './http'
import { silentLogin, type PlatformSession } from './login'

/** 会话的内部形状；只在本模块读写，对上层不可见（AD-14） */
export type Session = {
  accessToken: string
  refreshToken: string
  /** Unix 秒 */
  expiresAt: number
  userId: string
}

/** 本地存储 key（沿用 weorder_ 前缀；会话为 weorder_session） */
const STORAGE_KEY = 'weorder_session'

/** 提前量：剩余有效期小于该值就先续期，避免请求发出瞬间刚好过期 */
const EXPIRY_MARGIN_SECONDS = 60

/** 单飞中的「取有效会话」链 */
let acquiring: Promise<Session> | null = null

/** 从本地存储恢复会话；缺失或内容损坏时返回 null */
function readSession(): Session | null {
  const raw: unknown = uni.getStorageSync(STORAGE_KEY)
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const { accessToken, refreshToken, expiresAt, userId } = value
    if (
      typeof accessToken === 'string' &&
      accessToken !== '' &&
      typeof refreshToken === 'string' &&
      refreshToken !== '' &&
      typeof expiresAt === 'number' &&
      Number.isFinite(expiresAt) &&
      typeof userId === 'string' &&
      userId !== ''
    ) {
      return { accessToken, refreshToken, expiresAt, userId }
    }
  } catch {
    // 内容不是合法 JSON：按无会话处理
  }
  uni.removeStorageSync(STORAGE_KEY)
  return null
}

function saveSession(session: Session): void {
  uni.setStorageSync(STORAGE_KEY, JSON.stringify(session))
}

function clearSession(): void {
  uni.removeStorageSync(STORAGE_KEY)
}

/** 平台响应归一化为内部会话；缺 expires_at 时按 expires_in 估算 */
function fromPlatform(data: PlatformSession, fallbackUserId?: string): Session {
  const responseUserId = data.user?.id
  const userId =
    typeof responseUserId === 'string' && responseUserId !== ''
      ? responseUserId
      : (fallbackUserId ?? '')
  if (
    typeof data.access_token !== 'string' ||
    data.access_token === '' ||
    typeof data.refresh_token !== 'string' ||
    data.refresh_token === '' ||
    userId === ''
  ) {
    throw new AuthError('unknown', '会话响应缺少必要字段')
  }
  const expiresAt =
    typeof data.expires_at === 'number' && Number.isFinite(data.expires_at)
      ? data.expires_at
      : Math.floor(Date.now() / 1000) + (typeof data.expires_in === 'number' ? data.expires_in : 0)
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    userId,
  }
}

function isExpiring(session: Session): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return session.expiresAt - EXPIRY_MARGIN_SECONDS <= nowSeconds
}

/** 刷新凭证失效：平台对无效/过期刷新凭证返回 400 / 401（其余错误不算失效） */
function isInvalidRefresh(error: unknown): boolean {
  return error instanceof AuthError && (error.status === 400 || error.status === 401)
}

/** 用刷新凭证换新会话；平台会轮换 refresh token，一并写回 */
async function refreshSession(session: Session): Promise<Session> {
  const data = await supabaseRequest<PlatformSession>({
    path: '/auth/v1/token?grant_type=refresh_token',
    method: 'POST',
    body: { refresh_token: session.refreshToken },
  })
  return fromPlatform(data, session.userId)
}

/** 取有效会话的完整链路：续期 → 失败回退静默重登 */
async function acquireSession(): Promise<Session> {
  const stored = readSession()
  if (stored !== null) {
    try {
      const refreshed = await refreshSession(stored)
      saveSession(refreshed)
      return refreshed
    } catch (error) {
      // 只有「刷新凭证失效」才回退重登；网络不可达、5xx 等原样上抛，
      // 不用登录掩盖（FR-P2-4）
      if (!isInvalidRefresh(error)) throw error
      clearSession()
    }
  }
  const session = fromPlatform(await silentLogin())
  saveSession(session)
  return session
}

/**
 * 取一份有效会话（api/ 内部使用）：
 * - 本地会话未过期：直接复用（重启后即恢复，无需用户操作）
 * - 已过期：先续期；刷新凭证失效则静默重登
 * - 并发调用共享同一条单飞链
 */
export function ensureSession(): Promise<Session> {
  const stored = readSession()
  if (stored !== null && !isExpiring(stored)) return Promise.resolve(stored)

  if (acquiring === null) {
    const run = acquireSession()
    acquiring = run
    // 不依赖 Promise.prototype.finally：小程序运行时兼容性更稳
    const release = () => {
      acquiring = null
    }
    run.then(release, release)
  }
  return acquiring
}
