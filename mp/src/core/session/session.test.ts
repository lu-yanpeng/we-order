/**
 * 会话状态机单元测试（P3 Story 1.3；AD-2 / AD-4）
 *
 * 用 `createSession` 注入假 http（不 mock 状态机本身），配合 stub 的 `uni` 存储与
 * fake timers，覆盖：冷启动静默登录与持久化、有效会话恢复、单飞、主动续期、
 * 回退重登、退避与上限、不留半登录、存储自愈与凭证变更通知。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, type SessionDeps } from './session'
import type { PlatformSession, Session } from './types'

const STORAGE_KEY = 'weorder_session'

let stored: Record<string, unknown>

beforeEach(() => {
  vi.useFakeTimers()
  stored = {}
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => stored[key] ?? '',
    setStorageSync: (key: string, value: unknown) => {
      stored[key] = value
    },
    removeStorageSync: (key: string) => {
      delete stored[key]
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function platformSession(overrides: Partial<PlatformSession> = {}): PlatformSession {
  return {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_in: 3600,
    expires_at: nowSeconds() + 3600,
    user: { id: 'user-1' },
    ...overrides,
  }
}

function storeSession(overrides: Partial<Session> = {}): void {
  stored[STORAGE_KEY] = JSON.stringify({
    accessToken: 'access-old',
    refreshToken: 'refresh-old',
    expiresAt: nowSeconds() + 3600,
    userId: 'user-1',
    ...overrides,
  })
}

function readStored(): Session {
  return JSON.parse(stored[STORAGE_KEY] as string) as Session
}

function makeDeps() {
  const fetchLoginCode = vi.fn<SessionDeps['fetchLoginCode']>(async () => 'code-1')
  const login = vi.fn<SessionDeps['login']>(async () => platformSession())
  const refresh = vi.fn<SessionDeps['refresh']>(async () =>
    platformSession({ access_token: 'access-2', refresh_token: 'refresh-2' }),
  )
  return { fetchLoginCode, login, refresh }
}

describe('冷启动与持久化', () => {
  it('无会话：静默登录一次并持久化；重复会合不重复登录', async () => {
    const { fetchLoginCode, login, refresh } = makeDeps()
    const session = createSession({ fetchLoginCode, login, refresh })

    await session.ensureSession()

    expect(fetchLoginCode).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith('code-1')
    expect(session.getAccessToken()).toBe('access-1')
    expect(session.getUserId()).toBe('user-1')
    expect(readStored()).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      userId: 'user-1',
    })

    await session.ensureSession()
    expect(fetchLoginCode).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('有效会话恢复：零网络、零登录', async () => {
    storeSession()
    const { fetchLoginCode, login, refresh } = makeDeps()
    const session = createSession({ fetchLoginCode, login, refresh })

    await session.ensureSession()

    expect(fetchLoginCode).not.toHaveBeenCalled()
    expect(login).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(session.getUserId()).toBe('user-1')
    expect(session.getAccessToken()).toBe('access-old')
  })

  it('并发会合单飞：冷启动三条并发只登录一次', async () => {
    const { fetchLoginCode, login, refresh } = makeDeps()
    const session = createSession({ fetchLoginCode, login, refresh })

    await Promise.all([session.ensureSession(), session.ensureSession(), session.ensureSession()])

    expect(login).toHaveBeenCalledTimes(1)
    expect(fetchLoginCode).toHaveBeenCalledTimes(1)
  })

  it('存储损坏 / 缺字段：自愈为无会话并重新登录', async () => {
    stored[STORAGE_KEY] = '{ 不是合法 JSON }'
    const broken = makeDeps()
    const first = createSession(broken)
    await first.ensureSession()
    expect(broken.login).toHaveBeenCalledTimes(1)
    expect(readStored()).toMatchObject({ userId: 'user-1' })

    stored[STORAGE_KEY] = JSON.stringify({ accessToken: 'a-only' })
    const incomplete = makeDeps()
    const second = createSession(incomplete)
    await second.ensureSession()
    expect(incomplete.login).toHaveBeenCalledTimes(1)
  })

  it('平台响应缺字段 / 缺过期信息：归一为 login.unknown 且不落盘', async () => {
    const { fetchLoginCode, login, refresh } = makeDeps()
    login.mockResolvedValue({ access_token: '', refresh_token: 'refresh-x' })
    const session = createSession({ fetchLoginCode, login, refresh })

    await expect(session.ensureSession()).rejects.toMatchObject({
      source: 'login',
      code: 'unknown',
    })
    expect(stored[STORAGE_KEY]).toBeUndefined()
    expect(session.getAccessToken()).toBeUndefined()
  })
})

describe('续期与单飞', () => {
  it('临近到期：会合触发一次续期并更新存储', async () => {
    storeSession({ expiresAt: nowSeconds() + 60 })
    const { fetchLoginCode, login, refresh } = makeDeps()
    const session = createSession({ fetchLoginCode, login, refresh })

    await session.ensureSession()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('refresh-old')
    expect(login).not.toHaveBeenCalled()
    expect(session.getAccessToken()).toBe('access-2')
    expect(readStored()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' })
  })

  it('并发会合只发一次续期', async () => {
    storeSession({ expiresAt: nowSeconds() + 60 })
    const { fetchLoginCode, login, refresh } = makeDeps()
    const session = createSession({ fetchLoginCode, login, refresh })

    await Promise.all([session.ensureSession(), session.ensureSession(), session.ensureSession()])

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(session.getAccessToken()).toBe('access-2')
  })

  it('主动续期：不需要请求触发，到期前提前量到点自动续期', async () => {
    storeSession({ expiresAt: nowSeconds() + 3600 })
    const { fetchLoginCode, login, refresh } = makeDeps()
    const session = createSession({ fetchLoginCode, login, refresh })

    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync((3600 - 5 * 60) * 1000)

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(session.getAccessToken()).toBe('access-2')
  })

  it('主动续期失败：静默且不重排定时器（不循环重试）', async () => {
    storeSession({ expiresAt: nowSeconds() + 3600 })
    const { fetchLoginCode, login, refresh } = makeDeps()
    refresh.mockRejectedValue({ source: 'client', code: 'network_unreachable' })
    createSession({ fetchLoginCode, login, refresh })

    await vi.advanceTimersByTimeAsync((3600 - 5 * 60) * 1000)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(7200 * 1000)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(login).not.toHaveBeenCalled()
  })

  it('续期被平台拒绝：清本地会话并回退重登，身份不变', async () => {
    storeSession({ expiresAt: nowSeconds() + 60 })
    const { fetchLoginCode, login, refresh } = makeDeps()
    refresh.mockRejectedValue({ source: 'login', code: 'refresh_token_not_found', status: 400 })
    login.mockImplementation(async () =>
      platformSession({ access_token: 'access-new', refresh_token: 'refresh-new' }),
    )
    const session = createSession({ fetchLoginCode, login, refresh })

    await session.ensureSession()

    expect(refresh).toHaveBeenCalledWith('refresh-old')
    expect(login).toHaveBeenCalledTimes(1)
    expect(session.getUserId()).toBe('user-1')
    expect(readStored()).toMatchObject({ accessToken: 'access-new', refreshToken: 'refresh-new' })
  })

  it('续期遇到网络失败：不重登、保留原会话、错误上抛', async () => {
    storeSession({ expiresAt: nowSeconds() + 60 })
    const { fetchLoginCode, login, refresh } = makeDeps()
    refresh.mockRejectedValue({ source: 'client', code: 'network_unreachable' })
    const session = createSession({ fetchLoginCode, login, refresh })

    await expect(session.ensureSession()).rejects.toMatchObject({
      source: 'client',
      code: 'network_unreachable',
    })
    expect(login).not.toHaveBeenCalled()
    expect(session.getAccessToken()).toBe('access-old')
    expect(stored[STORAGE_KEY]).toBeDefined()
  })

  it('force：本地看似有效也强制恢复', async () => {
    storeSession()
    const { fetchLoginCode, login, refresh } = makeDeps()
    const session = createSession({ fetchLoginCode, login, refresh })

    await session.ensureSession()
    expect(refresh).not.toHaveBeenCalled()

    await session.ensureSession(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(login).not.toHaveBeenCalled()
  })
})

describe('登录失败与退避重试', () => {
  it('session_failed 自动重试：退避后第二次成功', async () => {
    const { fetchLoginCode, login, refresh } = makeDeps()
    login.mockRejectedValueOnce({ source: 'login', code: 'session_failed', status: 500 })
    const session = createSession({ fetchLoginCode, login, refresh })

    const pending = session.ensureSession()
    await vi.advanceTimersByTimeAsync(1000)
    await pending

    expect(fetchLoginCode).toHaveBeenCalledTimes(2)
    expect(login).toHaveBeenCalledTimes(2)
    expect(session.getAccessToken()).toBe('access-1')
  })

  it('连续失败到达上限：抛最后错误、不落盘（不留半登录）', async () => {
    const { fetchLoginCode, login, refresh } = makeDeps()
    login.mockRejectedValue({ source: 'login', code: 'session_failed', status: 500 })
    const session = createSession({ fetchLoginCode, login, refresh })

    const pending = session.ensureSession()
    // 先挂断言（避免 rejects 被异步处理触发 unhandled rejection 警告），再推进退避定时器
    const rejected = expect(pending).rejects.toMatchObject({
      source: 'login',
      code: 'session_failed',
    })
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(2000)
    await rejected
    expect(login).toHaveBeenCalledTimes(3)
    expect(fetchLoginCode).toHaveBeenCalledTimes(3)
    expect(stored[STORAGE_KEY]).toBeUndefined()
    expect(session.getAccessToken()).toBeUndefined()
  })

  it('非可重试类别（rate_limited）不自动重试', async () => {
    const { fetchLoginCode, login, refresh } = makeDeps()
    login.mockRejectedValue({ source: 'login', code: 'rate_limited', status: 429 })
    const session = createSession({ fetchLoginCode, login, refresh })

    await expect(session.ensureSession()).rejects.toMatchObject({ code: 'rate_limited' })
    expect(login).toHaveBeenCalledTimes(1)
  })
})

describe('凭证变更通知', () => {
  it('登录 / 续期后回调，退订后不再回调', async () => {
    storeSession({ expiresAt: nowSeconds() + 60 })
    const { fetchLoginCode, login, refresh } = makeDeps()
    const session = createSession({ fetchLoginCode, login, refresh })
    const listener = vi.fn()
    const unsubscribe = session.subscribeSession(listener)

    await session.ensureSession()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ accessToken: 'access-2', userId: 'user-1' })

    unsubscribe()
    await session.ensureSession(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
