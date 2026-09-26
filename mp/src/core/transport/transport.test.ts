/**
 * 通道拦截单元测试（P3 Story 1.2；AD-5 / AD-6）
 *
 * 用 stub 的 `uni.request` 跑**真实 alova 实例**（不 mock alova），配合伪 provider 断言：
 * - 唯一请求头构造：apikey 恒带、按 meta.auth 附 Authorization；
 * - 会话类失败（401 / PGRST301 / not_authenticated）续期后只重放一次，重放用新凭证；
 * - 二次失败 / 恢复失败 → client.session_expired；42501 不触发续期；
 * - 非 2xx 按端点分域归一；uni fail 归一为客户端三类别；
 * - 裸通道不重放、按 meta.accessToken 显式带凭证。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTransport } from './instance'
import { registerSessionProvider, type SessionProvider } from './provider'

type FakeRequestOptions = {
  url: string
  method?: string
  header?: Record<string, string>
  data?: unknown
  success?: (result: {
    statusCode: number
    data: unknown
    header?: Record<string, unknown>
  }) => void
  fail?: (error: { errMsg: string }) => void
}

type QueuedResult =
  | { kind: 'response'; statusCode: number; data: unknown; header?: Record<string, unknown> }
  | { kind: 'fail'; errMsg: string }

const BASE_URL = 'http://localhost:54321'
const PUBLISHABLE_KEY = 'pk-test'

const { business, raw } = createTransport({
  baseURL: BASE_URL,
  publishableKey: PUBLISHABLE_KEY,
  timeoutMs: 50,
})

let calls: FakeRequestOptions[] = []
let queue: QueuedResult[] = []

beforeEach(() => {
  calls = []
  queue = []
  registerSessionProvider(null)
  vi.stubGlobal('uni', {
    request: (options: FakeRequestOptions) => {
      calls.push(options)
      const next = queue.shift()
      if (next === undefined) throw new Error('测试未准备响应（queue 为空）')
      // 真实 uni.request 是异步回调；保持异步避免时序差异
      setTimeout(() => {
        if (next.kind === 'response') {
          options.success?.({ statusCode: next.statusCode, data: next.data, header: next.header })
        } else {
          options.fail?.({ errMsg: next.errMsg })
        }
      }, 0)
      return { abort: () => {} }
    },
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getStorageInfoSync: () => ({ keys: [] }),
  })
})

afterEach(() => {
  registerSessionProvider(null)
  vi.unstubAllGlobals()
})

function providerWith(overrides: Partial<SessionProvider> = {}): SessionProvider {
  return {
    getAccessToken: () => 'token-1',
    ensureSession: vi.fn<SessionProvider['ensureSession']>(async () => {}),
    ...overrides,
  }
}

describe('请求头构造', () => {
  it('session-required：先会合会话，再带 apikey 与 Authorization', async () => {
    const provider = providerWith()
    registerSessionProvider(provider)
    queue.push({ kind: 'response', statusCode: 200, data: { ok: true } })

    const method = business.Get<{ ok: boolean }>('/rest/v1/rpc/get_my_orders', {
      meta: { auth: 'session-required' },
    })
    await expect(method.send()).resolves.toEqual({ ok: true })

    expect(provider.ensureSession).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${BASE_URL}/rest/v1/rpc/get_my_orders`)
    expect(calls[0]?.header).toMatchObject({
      apikey: PUBLISHABLE_KEY,
      Authorization: 'Bearer token-1',
    })
  })

  it('anonymous：不等待会话、不附 Authorization，但 apikey 恒带', async () => {
    const provider = providerWith()
    registerSessionProvider(provider)
    queue.push({ kind: 'response', statusCode: 200, data: {} })

    await business.Get('/rest/v1/menu', { meta: { auth: 'anonymous' } }).send()

    expect(provider.ensureSession).not.toHaveBeenCalled()
    expect(calls[0]?.header).toMatchObject({ apikey: PUBLISHABLE_KEY })
    expect(calls[0]?.header).not.toHaveProperty('Authorization')
  })

  it('有请求体时声明 Content-Type', async () => {
    queue.push({ kind: 'response', statusCode: 200, data: {} })
    await business
      .Post('/functions/v1/wechat-login', { code: 'x' }, { meta: { auth: 'anonymous' } })
      .send()
    expect(calls[0]?.header?.['Content-Type']).toBe('application/json')
  })

  it('session-required 且会合失败：不发请求，直接 client.session_expired', async () => {
    registerSessionProvider(
      providerWith({
        ensureSession: vi.fn(async () => {
          throw new Error('login failed')
        }),
      }),
    )
    await expect(
      business.Get('/rest/v1/rpc/get_my_orders', { meta: { auth: 'session-required' } }).send(),
    ).rejects.toMatchObject({ source: 'client', code: 'session_expired' })
    expect(calls).toHaveLength(0)
  })
})

describe('会话类失败：续期 + 只重放一次', () => {
  it('401 → 续期后用新凭证重放，成功返回数据', async () => {
    let token = 'token-old'
    const ensureSession = vi.fn<SessionProvider['ensureSession']>(async (force) => {
      if (force === true) token = 'token-new'
    })
    registerSessionProvider({ getAccessToken: () => token, ensureSession })
    queue.push({
      kind: 'response',
      statusCode: 401,
      data: { code: 'PGRST301', message: 'JWT expired' },
    })
    queue.push({ kind: 'response', statusCode: 200, data: { ok: true } })

    await expect(
      business
        .Get<{ ok: boolean }>('/rest/v1/rpc/get_my_orders', { meta: { auth: 'session-required' } })
        .send(),
    ).resolves.toEqual({ ok: true })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.header?.Authorization).toBe('Bearer token-old')
    expect(calls[1]?.header?.Authorization).toBe('Bearer token-new')
    expect(ensureSession.mock.calls.filter(([force]) => force === true)).toHaveLength(1)
  })

  it('重放后仍是会话类：归一为 client.session_expired，且一共只发两次请求', async () => {
    const ensureSession = vi.fn<SessionProvider['ensureSession']>(async () => {})
    registerSessionProvider(providerWith({ ensureSession }))
    queue.push({ kind: 'response', statusCode: 401, data: {} })
    queue.push({ kind: 'response', statusCode: 401, data: {} })

    await expect(
      business.Get('/rest/v1/rpc/get_my_orders', { meta: { auth: 'session-required' } }).send(),
    ).rejects.toMatchObject({ source: 'client', code: 'session_expired' })

    expect(calls).toHaveLength(2)
    expect(ensureSession.mock.calls.filter(([force]) => force === true)).toHaveLength(1)
  })

  it('续期 / 重登本身失败：归一为 client.session_expired，不重放', async () => {
    const ensureSession = vi.fn<SessionProvider['ensureSession']>(async (force) => {
      if (force === true) throw new Error('refresh failed')
    })
    registerSessionProvider(providerWith({ ensureSession }))
    queue.push({ kind: 'response', statusCode: 401, data: {} })

    await expect(
      business.Get('/rest/v1/rpc/get_my_orders', { meta: { auth: 'session-required' } }).send(),
    ).rejects.toMatchObject({ source: 'client', code: 'session_expired' })

    expect(calls).toHaveLength(1)
  })

  it('RPC not_authenticated 走同一条续期重放路径', async () => {
    const ensureSession = vi.fn<SessionProvider['ensureSession']>(async () => {})
    registerSessionProvider(providerWith({ ensureSession }))
    queue.push({
      kind: 'response',
      statusCode: 400,
      data: { code: 'P0001', message: 'not_authenticated' },
    })
    queue.push({ kind: 'response', statusCode: 200, data: { ok: true } })

    await expect(
      business.Get('/rest/v1/rpc/get_my_orders', { meta: { auth: 'session-required' } }).send(),
    ).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('42501 不是会话问题：不续期、不重放，归一为 order.unknown', async () => {
    const ensureSession = vi.fn<SessionProvider['ensureSession']>(async () => {})
    registerSessionProvider(providerWith({ ensureSession }))
    queue.push({
      kind: 'response',
      statusCode: 403,
      data: { code: '42501', message: 'permission denied' },
    })

    await expect(
      business.Get('/rest/v1/rpc/get_my_orders', { meta: { auth: 'session-required' } }).send(),
    ).rejects.toMatchObject({ source: 'order', code: 'unknown' })

    expect(calls).toHaveLength(1)
    expect(ensureSession.mock.calls.filter(([force]) => force === true)).toHaveLength(0)
  })

  it('未注册 provider 时（Story 1.2 常态）会话类失败直接归一', async () => {
    queue.push({ kind: 'response', statusCode: 401, data: {} })
    await expect(
      business.Get('/rest/v1/menu', { meta: { auth: 'anonymous' } }).send(),
    ).rejects.toMatchObject({
      source: 'client',
      code: 'session_expired',
    })
    expect(calls).toHaveLength(1)
  })
})

describe('端点分域归一', () => {
  it('pay-order 业务拒绝：order 域该类别 + requestId', async () => {
    queue.push({
      kind: 'response',
      statusCode: 400,
      data: { code: 'product_unavailable', message: 'x' },
      header: { 'x-request-id': 'rid-1' },
    })
    await expect(
      business.Post('/functions/v1/pay-order', {}, { meta: { auth: 'session-required' } }).send(),
    ).rejects.toMatchObject({
      source: 'order',
      code: 'product_unavailable',
      status: 400,
      requestId: 'rid-1',
    })
  })

  it('wechat-login 失败：login 域该类别', async () => {
    queue.push({ kind: 'response', statusCode: 400, data: { code: 'invalid_code', message: 'x' } })
    await expect(
      business
        .Post('/functions/v1/wechat-login', { code: 'x' }, { meta: { auth: 'anonymous' } })
        .send(),
    ).rejects.toMatchObject({ source: 'login', code: 'invalid_code' })
  })
})

describe('传输失败归一', () => {
  it('timeout / abort / 其他', async () => {
    queue.push({ kind: 'fail', errMsg: 'request:fail timeout' })
    await expect(
      business.Get('/rest/v1/menu', { meta: { auth: 'anonymous' } }).send(),
    ).rejects.toMatchObject({
      source: 'client',
      code: 'timeout',
    })

    queue.push({ kind: 'fail', errMsg: 'request:fail abort' })
    await expect(
      business.Get('/rest/v1/menu', { meta: { auth: 'anonymous' } }).send(),
    ).rejects.toMatchObject({
      source: 'client',
      code: 'request_cancelled',
    })

    queue.push({ kind: 'fail', errMsg: 'request:fail' })
    await expect(
      business.Get('/rest/v1/menu', { meta: { auth: 'anonymous' } }).send(),
    ).rejects.toMatchObject({
      source: 'client',
      code: 'network_unreachable',
    })
  })
})

describe('裸通道', () => {
  it('按 meta.accessToken 显式带凭证；平台 auth 错误原样承载；401 不重放', async () => {
    queue.push({
      kind: 'response',
      statusCode: 400,
      data: { code: 400, error_code: 'refresh_token_not_found', msg: 'x' },
    })

    await expect(
      raw
        .Post(
          '/auth/v1/token?grant_type=refresh_token',
          { refresh_token: 'r1' },
          { meta: { accessToken: 'token-1' } },
        )
        .send(),
    ).rejects.toMatchObject({ source: 'login', code: 'refresh_token_not_found', status: 400 })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.header).toMatchObject({
      apikey: PUBLISHABLE_KEY,
      Authorization: 'Bearer token-1',
    })

    queue.push({ kind: 'response', statusCode: 401, data: { error_code: 'invalid_grant' } })
    await expect(
      raw.Get('/auth/v1/user', { meta: { accessToken: 'token-2' } }).send(),
    ).rejects.toMatchObject({
      source: 'login',
      code: 'invalid_grant',
    })
    expect(calls).toHaveLength(2)
  })
})
