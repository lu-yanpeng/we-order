/**
 * 文案表单元测试（P3 Story 1.2；AD-6 / 最小 UI 规范）
 *
 * 覆盖：三个域的穷尽可译、未知类别兜底、request_cancelled 不产文案、文案不含敏感信息。
 */
import { describe, expect, it } from 'vitest'
import { LOGIN_ERROR_CODES, ORDER_ERROR_CODES } from '@/core/transport/error-codes'
import { errorCopy, isAppError } from './error-copy'

const SENSITIVE_MARKERS = [
  'PGRST',
  'postgres',
  'PostgREST',
  'openid',
  'OpenID',
  'Bearer',
  'apikey',
  'Error:',
  'stack',
]

describe('errorCopy：域内穷尽', () => {
  it('订单域每个类别都有非空文案', () => {
    for (const code of ORDER_ERROR_CODES) {
      expect(errorCopy({ source: 'order', code }), `order.${code}`).not.toBe('')
    }
  })

  it('登录域每个类别都有非空文案', () => {
    for (const code of LOGIN_ERROR_CODES) {
      expect(errorCopy({ source: 'login', code }), `login.${code}`).not.toBe('')
    }
  })

  it('客户端类别：request_cancelled 不展示，其余非空', () => {
    expect(errorCopy({ source: 'client', code: 'request_cancelled' })).toBe('')
    expect(errorCopy({ source: 'client', code: 'network_unreachable' })).not.toBe('')
    expect(errorCopy({ source: 'client', code: 'timeout' })).not.toBe('')
    expect(errorCopy({ source: 'client', code: 'session_expired' })).not.toBe('')
  })
})

describe('errorCopy：内容基准', () => {
  it('订单类文案与最小 UI 规范一致（抽查关键类别）', () => {
    expect(errorCopy({ source: 'order', code: 'product_unavailable' })).toBe(
      '部分商品已售罄或已下架，请调整购物车后重试',
    )
    expect(errorCopy({ source: 'order', code: 'invalid_selection' })).toBe(
      '规格选项已变更，请重新选择',
    )
    expect(errorCopy({ source: 'order', code: 'not_authenticated' })).toBe('登录状态已失效，请重试')
  })

  it('登录类文案沿用 Phase 2（抽查）', () => {
    expect(errorCopy({ source: 'login', code: 'code_expired_or_used' })).toBe(
      '登录凭证已失效，请重试',
    )
    expect(errorCopy({ source: 'login', code: 'session_failed' })).toBe(
      '登录服务暂时不可用，请稍后重试',
    )
  })

  it('未知类别落该域 unknown 文案；平台 auth 的域外错误码同样兜底', () => {
    expect(errorCopy({ source: 'order', code: '不存在的类别' })).toBe('操作失败，请稍后重试')
    expect(errorCopy({ source: 'login', code: 'refresh_token_not_found' })).toBe(
      '登录失败，请稍后重试',
    )
    // 客户端类别封闭；域外值防御性不展示
    expect(errorCopy({ source: 'client', code: '不存在的类别' })).toBe('')
  })

  it('文案不含内部堆栈、数据库细节、密钥或 OpenID', () => {
    const all = [
      ...ORDER_ERROR_CODES.map((code) => errorCopy({ source: 'order', code })),
      ...LOGIN_ERROR_CODES.map((code) => errorCopy({ source: 'login', code })),
      ...(['network_unreachable', 'timeout', 'session_expired'] as const).map((code) =>
        errorCopy({ source: 'client', code }),
      ),
    ]
    for (const copy of all) {
      for (const marker of SENSITIVE_MARKERS) {
        expect(copy.includes(marker), `「${copy}」不应包含 ${marker}`).toBe(false)
      }
    }
  })
})

describe('isAppError', () => {
  it('收窄 AppError；其余值一律拒绝', () => {
    expect(isAppError({ source: 'order', code: 'unknown' })).toBe(true)
    expect(isAppError({ source: 'client', code: 'timeout', status: 401 })).toBe(true)
    expect(isAppError(new Error('boom'))).toBe(false)
    expect(isAppError({ code: 'unknown' })).toBe(false)
    expect(isAppError({ source: 'server', code: 'unknown' })).toBe(false)
    expect(isAppError(null)).toBe(false)
    expect(isAppError('boom')).toBe(false)
  })
})
