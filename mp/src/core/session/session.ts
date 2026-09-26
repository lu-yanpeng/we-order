/**
 * 会话状态机：单飞、主动续期、失败回退重登（P3 AD-2、AD-4）
 *
 * 对外（经 index.ts）提供取凭证、取本人标识、`ensureSession()` 与凭证变更通知；
 * 「未登录」不是对外状态——要么会合成功，要么以 `AppError` 失败。
 *
 * 关键行为与需求逐条对应：
 * - **单飞**：同一时刻只有一条「取有效会话」链在飞（`inflight`），并发调用等待并复用同一结果；
 * - **主动续期**：每次拿到新会话后按 `expiresAt − 提前量` 排**一个**定时器，到点后台续期；
 *   失败不重排（避免循环重试），下一次 `ensureSession()` 自然再试；
 * - **回退重登**：续期被平台明确拒绝（400 / 401：凭证已失效 / 已轮换）→ 清本地会话 →
 *   重新静默登录；结果不明的网络类失败保留原会话、错误上抛，不用登录掩盖网络问题；
 * - **退避与上限**：登录失败仅对可重试类别自动重试（上限 3 次、退避 0 / 1s / 2s）；
 * - **不留半登录**：只有拿到完整会话才写内存与存储；任何失败都不落盘。
 *
 * 「续期请求发出后应用被杀、新凭证丢失」无需特判：平台已轮换刷新凭证，下次启动用旧
 * 凭证续期会被拒绝，自然走回退重登。
 */
import type { AppError } from '@/types/errors'
import { clearStoredSession, loadStoredSession, saveStoredSession } from './storage'
import type { PlatformSession, Session } from './types'

/** 主动续期提前量：剩余有效期不足 5 分钟即视为「该续期了」 */
const RENEW_LEAD_SECONDS = 5 * 60

/** 登录失败自动重试：总尝试次数与第 2、3 次尝试前的等待（毫秒） */
const LOGIN_MAX_ATTEMPTS = 3
const LOGIN_BACKOFF_MS = [1000, 2000] as const

/** 登录域可自动重试的类别（并发登录产生的 session_failed 在此；rate_limited 不重试） */
const RETRYABLE_LOGIN_CODES: ReadonlySet<string> = new Set(['session_failed', 'identity_failed'])

/** 客户端网络类：同样可自动重试（网络抖动） */
const RETRYABLE_CLIENT_CODES: ReadonlySet<string> = new Set(['network_unreachable', 'timeout'])

/** 会话获取的协议依赖（唯一注入点，测试传假实现） */
export type SessionDeps = {
  /** `uni.login` 取微信一次性凭证 */
  fetchLoginCode: () => Promise<string>
  /** `wechat-login` 换平台会话 */
  login: (code: string) => Promise<PlatformSession>
  /** 平台 token 端点续期 */
  refresh: (refreshToken: string) => Promise<PlatformSession>
}

/** 凭证变更快照：只含订阅方需要的字段（Epic 5 的 realtime 用它同步订阅凭证） */
export type SessionSnapshot = {
  accessToken: string
  userId: string
}

export type SessionInstance = {
  /**
   * 会合语义（AD-4）：拿到一份有效会话。
   * - 不传 force：已有有效会话直接复用；续期 / 登录在飞时等待并复用结果；
   * - `force = true`：当前凭证被服务端拒绝后的强制恢复，跳过「本地看起来有效」的判断；
   * 失败抛 `AppError`。
   */
  ensureSession(force?: boolean): Promise<void>
  /** 取当前访问凭证；没有可用会话时返回 undefined（只给 transport 与 api/ 用） */
  getAccessToken(): string | undefined
  /** 取当前会话主体 id；没有可用会话时返回 undefined（只给 api/ 与 core/realtime 用） */
  getUserId(): string | undefined
  /** 订阅凭证变更（登录 / 续期成功后回调）；返回退订函数 */
  subscribeSession(listener: (snapshot: SessionSnapshot) => void): () => void
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** 会话是否已进入续期窗口（剩余不足提前量或已过期） */
function needsRenewal(value: Session): boolean {
  return value.expiresAt - RENEW_LEAD_SECONDS <= nowSeconds()
}

/** 收窄 AppError（core 不引用 utils/，此处用最小同构判断，只认三个 source） */
function isAppErrorLike(value: unknown): value is AppError {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.code === 'string' &&
    (record.source === 'login' || record.source === 'order' || record.source === 'client')
  )
}

function loginUnknownError(): AppError {
  return { source: 'login', code: 'unknown' }
}

/** 是否值得自动重试（服务端可重试类别 + 客户端网络类） */
function isRetryable(error: unknown): boolean {
  if (!isAppErrorLike(error)) return false
  if (error.source === 'login') return RETRYABLE_LOGIN_CODES.has(error.code)
  if (error.source === 'client') return RETRYABLE_CLIENT_CODES.has(error.code)
  return false
}

/** 平台对无效 / 已轮换的刷新凭证返回 400 / 401；其余错误不算失效 */
function isInvalidRefresh(error: unknown): boolean {
  return (
    isAppErrorLike(error) &&
    error.source === 'login' &&
    (error.status === 400 || error.status === 401)
  )
}

/** 平台响应归一化为内部会话；缺字段 / 缺过期信息视为登录域 unknown */
function fromPlatform(data: PlatformSession, fallbackUserId?: string): Session {
  const responseUserId = data.user?.id
  const userId =
    typeof responseUserId === 'string' && responseUserId !== ''
      ? responseUserId
      : (fallbackUserId ?? '')
  const expiresAt =
    typeof data.expires_at === 'number' && Number.isFinite(data.expires_at)
      ? data.expires_at
      : typeof data.expires_in === 'number' &&
          Number.isFinite(data.expires_in) &&
          data.expires_in > 0
        ? nowSeconds() + data.expires_in
        : Number.NaN
  if (
    typeof data.access_token !== 'string' ||
    data.access_token === '' ||
    typeof data.refresh_token !== 'string' ||
    data.refresh_token === '' ||
    userId === '' ||
    !Number.isFinite(expiresAt)
  ) {
    throw loginUnknownError()
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    userId,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createSession(deps: SessionDeps): SessionInstance {
  /** 内存中的当前会话：运行时状态的唯一出处；启动时从存储恢复 */
  let session: Session | null = loadStoredSession()
  /** 单飞链：同一时刻只有一条 */
  let inflight: Promise<Session> | null = null
  /** 主动续期定时器：每份会话最多一个 */
  let renewTimer: ReturnType<typeof setTimeout> | null = null
  /** 凭证变更订阅者 */
  const listeners = new Set<(snapshot: SessionSnapshot) => void>()

  function notify(value: Session): void {
    const snapshot: SessionSnapshot = { accessToken: value.accessToken, userId: value.userId }
    for (const listener of [...listeners]) {
      try {
        listener(snapshot)
      } catch {
        // 订阅方的异常不影响会话模块
      }
    }
  }

  function clearRenewTimer(): void {
    if (renewTimer !== null) {
      clearTimeout(renewTimer)
      renewTimer = null
    }
  }

  /** 排一个对准 `expiresAt − 提前量` 的续期定时器；过期会话立即排（delay 0） */
  function scheduleRenewal(): void {
    clearRenewTimer()
    if (session === null) return
    const delayMs = Math.max(0, (session.expiresAt - RENEW_LEAD_SECONDS) * 1000 - Date.now())
    renewTimer = setTimeout(() => {
      renewTimer = null
      void renewInBackground()
    }, delayMs)
  }

  /** 主动续期：后台走同一条单飞链；失败静默、不重排（下一次会合时再试） */
  async function renewInBackground(): Promise<void> {
    try {
      await acquire()
    } catch {
      // 不打扰用户；也不在这里重排定时器（避免循环重试）
    }
  }

  /** 提交一份完整会话：写内存、落存储、排下一次续期、通知订阅方 */
  function commit(next: Session): Session {
    session = next
    saveStoredSession(next)
    scheduleRenewal()
    notify(next)
    return next
  }

  /** 续期一次；失败原样上抛（由调用方分类） */
  async function renewOnce(current: Session): Promise<Session> {
    const data = await deps.refresh(current.refreshToken)
    return fromPlatform(data, current.userId)
  }

  /** 登录一次：取新的一次性凭证 → 换会话 */
  async function loginOnce(): Promise<Session> {
    const code = await deps.fetchLoginCode()
    const data = await deps.login(code)
    return fromPlatform(data)
  }

  /** 登录 + 退避重试；非可重试类别或到达上限时抛最后一个错误 */
  async function loginWithRetry(): Promise<Session> {
    for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(LOGIN_BACKOFF_MS[attempt - 1] ?? 0)
      try {
        return await loginOnce()
      } catch (error) {
        const isLastAttempt = attempt === LOGIN_MAX_ATTEMPTS - 1
        if (isLastAttempt || !isRetryable(error)) throw error
      }
    }
    // 循环必然 return 或 throw；此行为类型完备兜底
    throw loginUnknownError()
  }

  /** 一次「取有效会话」的完整链路：续期 → 失败回退重登 */
  async function runAcquire(): Promise<Session> {
    const current = session
    if (current !== null) {
      try {
        return commit(await renewOnce(current))
      } catch (error) {
        if (!isInvalidRefresh(error)) throw error
        // 刷新凭证已被平台拒绝：清掉不可用会话，回退重新静默登录
        clearStoredSession()
        session = null
      }
    }
    return commit(await loginWithRetry())
  }

  /** 单飞：并发调用等待并复用同一条链的结果 */
  function acquire(): Promise<Session> {
    if (inflight !== null) return inflight
    const run = runAcquire()
    inflight = run
    // 不依赖 Promise.prototype.finally：小程序运行时兼容性更稳
    const release = (): void => {
      inflight = null
    }
    run.then(release, release)
    return run
  }

  async function ensureSession(force = false): Promise<void> {
    if (!force && session !== null && !needsRenewal(session)) return
    await acquire()
  }

  function getAccessToken(): string | undefined {
    return session?.accessToken
  }

  function getUserId(): string | undefined {
    return session?.userId
  }

  function subscribeSession(listener: (snapshot: SessionSnapshot) => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  // 恢复的会话立即纳入主动续期：剩余充足则排定时器，已进窗口 / 已过期则立即后台续期
  if (session !== null) scheduleRenewal()

  return { ensureSession, getAccessToken, getUserId, subscribeSession }
}
