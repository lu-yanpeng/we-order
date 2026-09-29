/**
 * 结算意图生命周期单元测试（P3 Story 3.4；AD-10 / AR-P3-15）
 *
 * 用 stub 的 `uni` 存储验证 `api/orders.ts` 的两个出口：
 * 复用（指纹一致）、按购物车 / 就餐方式重建、坏数据兜底、清除后重建。
 * 生成 / 序列化 / 校验 / 决策的纯函数测试见 `utils/checkout-intent.test.ts`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CartItem } from '@/types/cart'
import type { CheckoutIntent } from '@/utils/checkout-intent'
import { clearCheckoutIntent, ensureCheckoutIntent } from './orders'

const INTENT_KEY = 'weorder_checkout_intent'

let stored: Record<string, unknown>

const cart: CartItem[] = [
  {
    productId: 'p-1',
    productName: '拿铁',
    selections: { size: 'grande' },
    quantity: 1,
    unitPrice: 32,
    specSummary: '大杯',
  },
]

beforeEach(() => {
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
})

/** 读取持久化意图（形状错误会让测试直接抛错，起断言作用） */
function readStoredIntent(): CheckoutIntent {
  return JSON.parse(stored[INTENT_KEY] as string) as CheckoutIntent
}

describe('ensureCheckoutIntent / clearCheckoutIntent', () => {
  it('无意图 → 生成并持久化；再次提交且购物车未变 → 复用同一键', () => {
    const first = ensureCheckoutIntent(cart, 'dinein')
    expect(readStoredIntent().key).toBe(first)

    const second = ensureCheckoutIntent(cart, 'dinein')
    expect(second).toBe(first)
  })

  it('购物车内容变化 → 作废重建（新键覆盖持久化值）', () => {
    const first = ensureCheckoutIntent(cart, 'dinein')
    const changed = [{ ...cart[0], quantity: 2 }]
    const second = ensureCheckoutIntent(changed, 'dinein')

    expect(second).not.toBe(first)
    expect(readStoredIntent().key).toBe(second)
  })

  it('就餐方式变化 → 作废重建', () => {
    const first = ensureCheckoutIntent(cart, 'dinein')
    const second = ensureCheckoutIntent(cart, 'takeout')

    expect(second).not.toBe(first)
    expect(readStoredIntent().key).toBe(second)
  })

  it('存储值损坏 → 视同无意图、重建并覆盖坏数据', () => {
    stored[INTENT_KEY] = 'not-json'
    const key = ensureCheckoutIntent(cart, 'dinein')

    expect(readStoredIntent().key).toBe(key)
  })

  it('成功后清除 → 再次提交生成新键', () => {
    const first = ensureCheckoutIntent(cart, 'dinein')
    clearCheckoutIntent()
    expect(stored[INTENT_KEY]).toBeUndefined()

    const second = ensureCheckoutIntent(cart, 'dinein')
    expect(second).not.toBe(first)
  })

  it('存储不可用：不抛错，仍返回可发送的键', () => {
    vi.stubGlobal('uni', {
      getStorageSync: () => {
        throw new Error('storage unavailable')
      },
      setStorageSync: () => {
        throw new Error('storage unavailable')
      },
      removeStorageSync: () => {
        throw new Error('storage unavailable')
      },
    })

    expect(() => ensureCheckoutIntent(cart, 'dinein')).not.toThrow()
    expect(ensureCheckoutIntent(cart, 'dinein')).toMatch(/^co_/)
    expect(() => clearCheckoutIntent()).not.toThrow()
  })
})
