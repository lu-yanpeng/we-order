/**
 * 归一表单元测试（P3 Story 1.2；AD-6）
 *
 * 逐行覆盖 spine 的归一表：RPC / pay-order / wechat-login / 平台 auth / REST，
 * 以及会话类判定（401、PGRST301、not_authenticated、42501 优先）与传输失败三类别。
 */
import { describe, expect, it } from 'vitest'
import {
  isSessionFailure,
  normalizeFailure,
  routeOfUrl,
  sessionExpiredError,
  toHttpFailure,
  toTransportFailure,
  type HttpFailure,
} from './normalize'

function httpFailure(
  route: HttpFailure['route'],
  status: number,
  body: unknown,
  requestId?: string,
): HttpFailure {
  return { kind: 'http', status, body, route, requestId }
}

describe('routeOfUrl', () => {
  it('按端点分派路由；pay-order / wechat-login / platform-auth / rpc 各归其位', () => {
    expect(routeOfUrl('/functions/v1/pay-order')).toBe('pay-order')
    expect(routeOfUrl('/functions/v1/wechat-login')).toBe('wechat-login')
    expect(routeOfUrl('/rest/v1/rpc/get_my_orders')).toBe('rpc')
    expect(routeOfUrl('/auth/v1/token?grant_type=refresh_token')).toBe('platform-auth')
    expect(routeOfUrl('/rest/v1/menu')).toBe('rest')
    expect(routeOfUrl('/rest/v1/stores')).toBe('rest')
  })
})

describe('toHttpFailure / toTransportFailure', () => {
  it('2xx 返回 null，其余带状态码与请求标识', () => {
    expect(toHttpFailure({ statusCode: 200, data: {} }, 'rest')).toBeNull()
    expect(toHttpFailure({ statusCode: 204, data: null }, 'rest')).toBeNull()
    expect(
      toHttpFailure(
        { statusCode: 400, data: { a: 1 }, header: { 'X-Request-Id': 'rid-1' } },
        'rpc',
      ),
    ).toEqual({
      kind: 'http',
      status: 400,
      body: { a: 1 },
      route: 'rpc',
      requestId: 'rid-1',
    })
  })

  it('传输错误统一转成 errMsg；非 Error 也兜底', () => {
    expect(toTransportFailure(new Error('request:fail timeout'))).toEqual({
      kind: 'transport',
      errMsg: 'request:fail timeout',
    })
    expect(toTransportFailure('boom')).toEqual({ kind: 'transport', errMsg: 'boom' })
  })
})

describe('normalizeFailure：RPC 路由', () => {
  it('P0001 + message ∈ 类别域 → order 域该类别', () => {
    expect(
      normalizeFailure(httpFailure('rpc', 400, { code: 'P0001', message: 'invalid_quantity' })),
    ).toEqual({
      source: 'order',
      code: 'invalid_quantity',
      status: 400,
      requestId: undefined,
    })
  })

  it('P0001 + 未知 message → order.unknown', () => {
    expect(
      normalizeFailure(httpFailure('rpc', 400, { code: 'P0001', message: 'brand_new_code' })),
    ).toMatchObject({
      source: 'order',
      code: 'unknown',
    })
  })

  it('42501 → order.unknown（权限拒绝不是会话问题）', () => {
    expect(
      normalizeFailure(httpFailure('rpc', 403, { code: '42501', message: 'permission denied' })),
    ).toMatchObject({
      source: 'order',
      code: 'unknown',
    })
  })

  it('非 P0001 的 PostgREST 错误 → order.unknown', () => {
    expect(
      normalizeFailure(
        httpFailure('rpc', 404, { code: 'PGRST202', message: 'function not found' }),
      ),
    ).toMatchObject({ source: 'order', code: 'unknown' })
  })
})

describe('normalizeFailure：pay-order / wechat-login / 平台 auth', () => {
  it('pay-order 非 2xx + 已知类别 → order 域该类别，保留 requestId', () => {
    expect(
      normalizeFailure(
        httpFailure('pay-order', 400, { code: 'product_unavailable', message: 'x' }, 'rid-9'),
      ),
    ).toEqual({ source: 'order', code: 'product_unavailable', status: 400, requestId: 'rid-9' })
  })

  it('pay-order 未知类别 → order.unknown', () => {
    expect(
      normalizeFailure(httpFailure('pay-order', 500, { code: 'boom', message: 'x' })),
    ).toMatchObject({
      source: 'order',
      code: 'unknown',
      status: 500,
    })
  })

  it('wechat-login 已知类别 → login 域该类别；未知 → login.unknown', () => {
    expect(
      normalizeFailure(httpFailure('wechat-login', 400, { code: 'invalid_code' })),
    ).toMatchObject({
      source: 'login',
      code: 'invalid_code',
    })
    expect(normalizeFailure(httpFailure('wechat-login', 500, { code: 'boom' }))).toMatchObject({
      source: 'login',
      code: 'unknown',
    })
  })

  it('平台 auth 错误码原样承载（含数字 code 兜底），翻译交给文案表', () => {
    expect(
      normalizeFailure(
        httpFailure('platform-auth', 400, {
          code: 400,
          error_code: 'refresh_token_not_found',
          msg: 'x',
        }),
      ),
    ).toEqual({
      source: 'login',
      code: 'refresh_token_not_found',
      status: 400,
      requestId: undefined,
    })
    expect(normalizeFailure(httpFailure('platform-auth', 403, { code: 403 }))).toMatchObject({
      source: 'login',
      code: '403',
    })
  })

  it('REST 未归类失败 → order.unknown 兜底文案', () => {
    expect(normalizeFailure(httpFailure('rest', 500, { message: 'internal' }))).toMatchObject({
      source: 'order',
      code: 'unknown',
    })
  })
})

describe('normalizeFailure：传输失败', () => {
  it('timeout / abort / 其他 → 客户端三类别', () => {
    expect(normalizeFailure({ kind: 'transport', errMsg: 'request:fail timeout' })).toEqual({
      source: 'client',
      code: 'timeout',
    })
    expect(normalizeFailure({ kind: 'transport', errMsg: 'request:fail abort' })).toEqual({
      source: 'client',
      code: 'request_cancelled',
    })
    expect(normalizeFailure({ kind: 'transport', errMsg: 'request:fail' })).toEqual({
      source: 'client',
      code: 'network_unreachable',
    })
  })
})

describe('isSessionFailure', () => {
  it('401 / PGRST301 / not_authenticated 是会话类', () => {
    expect(isSessionFailure(httpFailure('rpc', 401, {}))).toBe(true)
    expect(
      isSessionFailure(httpFailure('rpc', 400, { code: 'PGRST301', message: 'JWT expired' })),
    ).toBe(true)
    expect(
      isSessionFailure(httpFailure('rpc', 400, { code: 'P0001', message: 'not_authenticated' })),
    ).toBe(true)
    expect(isSessionFailure(httpFailure('pay-order', 401, { code: 'not_authenticated' }))).toBe(
      true,
    )
  })

  it('42501 与 401 同现时以 SQLSTATE 为准：不是会话类', () => {
    expect(isSessionFailure(httpFailure('rpc', 401, { code: '42501' }))).toBe(false)
  })

  it('登录路由自身的 400/401 不是会话类（那是登录失败）', () => {
    expect(
      isSessionFailure(httpFailure('platform-auth', 401, { error_code: 'invalid_grant' })),
    ).toBe(false)
    expect(isSessionFailure(httpFailure('wechat-login', 401, {}))).toBe(false)
  })

  it('传输失败不是会话类', () => {
    expect(isSessionFailure({ kind: 'transport', errMsg: 'request:fail timeout' })).toBe(false)
  })
})

describe('sessionExpiredError', () => {
  it('保留触发失败的状态与请求标识', () => {
    expect(sessionExpiredError(httpFailure('rpc', 401, {}, 'rid-2'))).toEqual({
      source: 'client',
      code: 'session_expired',
      status: 401,
      requestId: 'rid-2',
    })
    expect(sessionExpiredError()).toEqual({
      source: 'client',
      code: 'session_expired',
      status: undefined,
      requestId: undefined,
    })
  })
})
