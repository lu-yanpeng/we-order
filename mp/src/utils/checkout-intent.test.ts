/**
 * 结算意图生命周期纯函数单元测试（P3 Story 3.4；AD-10 / AR-P3-15）
 *
 * 覆盖：键格式与唯一性、指纹规范化（排序无关 / 字段敏感）、存储值校验、
 * 复用与重建决策、清除与保留决策。
 */
import { describe, expect, it } from 'vitest'
import type { CreateOrderItem } from '@/types/api-contracts'
import type { AppError } from '@/types/errors'
import { ORDER_ERROR_CODES } from '@/core/transport/error-codes'
import {
  generateIdempotencyKey,
  parseCheckoutIntent,
  resolveCheckoutIntent,
  serializeCheckoutIntent,
  shouldClearCheckoutIntent,
} from './checkout-intent'

/** 固定购物车 fixture：两行、含多选规格（行顺序与提交顺序故意不同） */
function itemsFixture(): CreateOrderItem[] {
  return [
    {
      product_id: 'p-b',
      quantity: 1,
      selections: { size: 'grande', addons: ['milk', 'sugar'] },
    },
    { product_id: 'p-a', quantity: 2, selections: {} },
  ]
}

/** 改第一行（p-b）的某个字段，其余不变 */
function withFirstItem(patch: Partial<CreateOrderItem>): CreateOrderItem[] {
  const items = itemsFixture()
  items[0] = { ...items[0], ...patch }
  return items
}

describe('generateIdempotencyKey', () => {
  it('带 co_ 前缀、非空，多次生成不重复', () => {
    const keys = Array.from({ length: 50 }, () => generateIdempotencyKey())
    for (const key of keys) {
      expect(key).toMatch(/^co_[a-z0-9]+_[a-z0-9]+$/)
    }
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('serializeCheckoutIntent（指纹规范化）', () => {
  it('行顺序 / 规格组顺序 / 多选顺序不影响指纹', () => {
    const base = serializeCheckoutIntent(itemsFixture(), 'dinein')
    const reordered = serializeCheckoutIntent(
      [
        { product_id: 'p-a', quantity: 2, selections: {} },
        {
          product_id: 'p-b',
          quantity: 1,
          selections: { addons: ['sugar', 'milk'], size: 'grande' },
        },
      ],
      'dinein',
    )
    expect(reordered).toBe(base)
  })

  it('数量 / 商品 / 规格 / 就餐方式变化 → 指纹不同', () => {
    const base = serializeCheckoutIntent(itemsFixture(), 'dinein')
    expect(serializeCheckoutIntent(withFirstItem({ quantity: 3 }), 'dinein')).not.toBe(base)
    expect(serializeCheckoutIntent(withFirstItem({ product_id: 'p-c' }), 'dinein')).not.toBe(base)
    expect(
      serializeCheckoutIntent(
        withFirstItem({ selections: { size: 'grande', addons: ['milk'] } }),
        'dinein',
      ),
    ).not.toBe(base)
    expect(serializeCheckoutIntent(itemsFixture(), 'takeout')).not.toBe(base)
  })

  it('空购物车也产生稳定指纹', () => {
    expect(serializeCheckoutIntent([], 'dinein')).toBe(serializeCheckoutIntent([], 'dinein'))
  })
})

describe('parseCheckoutIntent（存储值校验）', () => {
  const intent = { key: 'co_test_1', fingerprint: '{"v":1}' }

  it('接受 JSON 字符串与对象两种形态', () => {
    expect(parseCheckoutIntent(JSON.stringify(intent))).toEqual(intent)
    expect(parseCheckoutIntent(intent)).toEqual(intent)
  })

  it('空串 / 损坏 JSON / 缺字段 / 空字段 / 非对象 → null（按无意图处理）', () => {
    expect(parseCheckoutIntent('')).toBeNull()
    expect(parseCheckoutIntent('not-json')).toBeNull()
    expect(parseCheckoutIntent(JSON.stringify({}))).toBeNull()
    expect(parseCheckoutIntent(JSON.stringify({ key: '', fingerprint: 'f' }))).toBeNull()
    expect(parseCheckoutIntent(JSON.stringify({ key: '   ', fingerprint: 'f' }))).toBeNull()
    expect(parseCheckoutIntent(JSON.stringify({ key: 'k', fingerprint: '' }))).toBeNull()
    expect(parseCheckoutIntent(JSON.stringify({ key: 'k' }))).toBeNull()
    expect(parseCheckoutIntent(null)).toBeNull()
    expect(parseCheckoutIntent(42)).toBeNull()
  })
})

describe('resolveCheckoutIntent（复用 / 重建）', () => {
  it('无持久化意图 → 生成新键、标记未复用', () => {
    const result = resolveCheckoutIntent(null, 'fp-1')
    expect(result.reused).toBe(false)
    expect(result.key).toMatch(/^co_/)
  })

  it('指纹一致 → 复用同一键', () => {
    const stored = { key: 'co_stored_1', fingerprint: 'fp-1' }
    expect(resolveCheckoutIntent(stored, 'fp-1')).toEqual({ key: 'co_stored_1', reused: true })
  })

  it('指纹不一致 → 新键（且不等于旧键）', () => {
    const stored = { key: 'co_stored_1', fingerprint: 'fp-1' }
    const result = resolveCheckoutIntent(stored, 'fp-2')
    expect(result.reused).toBe(false)
    expect(result.key).not.toBe(stored.key)
  })
})

describe('shouldClearCheckoutIntent（清除 / 保留）', () => {
  it('服务端类别（枚举穷尽，含 not_authenticated 与 42501 归一后的 unknown）→ 清除', () => {
    for (const code of ORDER_ERROR_CODES) {
      expect(shouldClearCheckoutIntent({ source: 'order', code })).toBe(true)
    }
  })

  it('client.session_expired → 清除', () => {
    expect(shouldClearCheckoutIntent({ source: 'client', code: 'session_expired' })).toBe(true)
  })

  it('结果不明（timeout / network_unreachable / request_cancelled）→ 保留', () => {
    const keepCodes = ['timeout', 'network_unreachable', 'request_cancelled'] as const
    for (const code of keepCodes) {
      expect(shouldClearCheckoutIntent({ source: 'client', code })).toBe(false)
    }
  })

  it('登录域与未知客户端类别 → 兜底保留', () => {
    const loginError: AppError = { source: 'login', code: 'rate_limited' }
    const unknownClient: AppError = { source: 'client', code: 'weird' }
    expect(shouldClearCheckoutIntent(loginError)).toBe(false)
    expect(shouldClearCheckoutIntent(unknownClient)).toBe(false)
  })
})
