/**
 * 订单 API 层单元测试（P3 Story 3.4 / 3.5 / 4.1；AD-7 / AD-10 / AD-11 / AR-P3-15 / AR-P3-18）
 *
 * 1. 结算意图生命周期：用 stub 的 `uni` 存储验证 `api/orders.ts` 的意图出口——
 *    复用（指纹一致）、按购物车 / 就餐方式重建、坏数据兜底、清除后重建；
 * 2. `payOrder`：用 mock 的对接层断言请求形状（只发四个 wire 字段、声明 `session-required`），
 *    不发起真实网络请求；
 * 3. `fetchOrders`：断言读取走服务端 RPC（默认 20 条、游标原样回传、`session-required`），
 *    不发起真实网络请求。
 *
 * 生成 / 序列化 / 校验 / 决策的纯函数测试见 `utils/checkout-intent.test.ts`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateOrderRequest, OrderResult, OrdersPage } from '@/types/api-contracts'
import type { CartItem } from '@/types/cart'
import type { CheckoutIntent } from '@/utils/checkout-intent'
import { clearCheckoutIntent, ensureCheckoutIntent, fetchOrders, payOrder } from './orders'

/** 支付接口调用经 mock 的对接层断言；`vi.hoisted` 保证 mock 工厂先于模块导入生效 */
const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))

vi.mock('@/core/transport', () => ({
  transport: { Post: postMock },
}))

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

describe('payOrder（Story 3.5；AD-11）', () => {
  /** wire 请求体：只含服务端认识的四个字段（唯一转换器产出 items） */
  const request: CreateOrderRequest = {
    items: [
      { product_id: 'p-1', quantity: 2, selections: { size: 'grande' } },
      { product_id: 'p-2', quantity: 1, selections: {} },
    ],
    dining_mode: 'takeout',
    notes: '少冰',
    idempotency_key: 'co_test-key',
  }

  /** 服务端返回：订单对外形状（金额 / 取杯号由服务端产出） */
  const orderResult: OrderResult = {
    id: '00000000-0000-0000-0000-000000000001',
    order_number: '202609291200000001',
    status: 'cooking',
    dining_mode: 'takeout',
    packaging_fee: 2,
    total_amount: 34,
    notes: '少冰',
    pickup_code: 'A-0001',
    created_at: '2026-09-29 12:00:00',
  }

  beforeEach(() => {
    postMock.mockReset()
    postMock.mockResolvedValue(orderResult)
  })

  it('经对接层 POST pay-order：声明 session-required，返回服务端订单形状', async () => {
    await expect(payOrder(request)).resolves.toEqual(orderResult)

    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body, config] = postMock.mock.calls[0] as [string, CreateOrderRequest, unknown]
    expect(url).toBe('/functions/v1/pay-order')
    expect(config).toEqual({ meta: { auth: 'session-required' } })
    expect(body).toEqual(request)
  })

  it('请求体只含 items / dining_mode / notes / idempotency_key：不含金额字段与用户标识', () => {
    void payOrder(request)

    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(Object.keys(body).sort()).toEqual(['dining_mode', 'idempotency_key', 'items', 'notes'])
    expect(body).not.toHaveProperty('total_amount')
    expect(body).not.toHaveProperty('unit_price')
    expect(body).not.toHaveProperty('user_id')
  })
})

describe('fetchOrders（Story 4.1；AD-7 / AR-P3-18）', () => {
  /** 服务端读取信封：列表项 + 键集游标（`next_cursor = null` 表示到底） */
  const page: OrdersPage = {
    items: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        order_number: '202609291200000001',
        status: 'cooking',
        dining_mode: 'takeout',
        packaging_fee: 2,
        total_amount: 34,
        notes: '少冰',
        pickup_code: 'A-0001',
        created_at: '2026-09-29 12:00:00',
        item_summary: '拿铁 ×1',
      },
    ],
    next_cursor: {
      created_at: '2026-09-29T12:00:00+00:00',
      id: '11111111-1111-4111-8111-111111111111',
    },
  }

  beforeEach(() => {
    postMock.mockReset()
    postMock.mockResolvedValue(page)
  })

  it('经对接层 POST get_my_orders：默认 20 条、首屏无游标、session-required', async () => {
    await expect(fetchOrders()).resolves.toEqual(page)

    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body, config] = postMock.mock.calls[0] as [string, Record<string, unknown>, unknown]
    expect(url).toBe('/rest/v1/rpc/get_my_orders')
    expect(body).toEqual({ p_limit: 20, p_before_created_at: null, p_before_id: null })
    expect(config).toEqual({ meta: { auth: 'session-required' } })
  })

  it('游标原样回传：客户端不解析、不拼接（键集分页，P2 AD-22）', async () => {
    await fetchOrders(page.next_cursor)

    const [url, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('/rest/v1/rpc/get_my_orders')
    expect(body).toEqual({
      p_limit: 20,
      p_before_created_at: '2026-09-29T12:00:00+00:00',
      p_before_id: '11111111-1111-4111-8111-111111111111',
    })
    // 请求体恰为三个分页参数：没有用户标识等可伪造字段（归属由服务端会话决定）
    expect(Object.keys(body).sort()).toEqual(['p_before_created_at', 'p_before_id', 'p_limit'])
  })
})
