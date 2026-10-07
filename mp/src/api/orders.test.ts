/**
 * 订单 API 层单元测试（P3 Story 3.4 / 3.5 / 4.1；AD-7 / AD-10 / AD-11 / AR-P3-15 / AR-P3-18）
 *
 * 1. 结算意图生命周期：用 stub 的 `uni` 存储验证 `api/orders.ts` 的意图出口——
 *    复用（指纹一致）、按购物车 / 就餐方式重建、坏数据兜底、清除后重建；
 * 2. `payOrder`：用 mock 的对接层断言请求形状（只发四个 wire 字段、声明 `session-required`），
 *    不发起真实网络请求；
 * 3. `fetchOrders`：断言读取走服务端 RPC（默认 20 条、游标原样回传、`session-required`），
 *    不发起真实网络请求；
 * 4. `fetchOrderById`：断言详情读取走服务端 RPC（订单 id 是唯一参数、`session-required`），
 *    不发起真实网络请求；
 * 5. `urgeOrder`：断言催单走服务端 RPC（订单 id 是唯一参数、`session-required`、无用户标识），
 *    不发起真实网络请求；
 * 6. `completeOrder`：断言确认取餐走服务端 RPC（订单 id 是唯一参数、`session-required`、
 *    无用户标识与完成时刻），不发起真实网络请求。
 *
 * 生成 / 序列化 / 校验 / 决策的纯函数测试见 `utils/checkout-intent.test.ts`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateOrderRequest,
  OrderDetail,
  OrderResult,
  OrdersPage,
} from '@/types/api-contracts'
import type { CartItem } from '@/types/cart'
import type { CheckoutIntent } from '@/utils/checkout-intent'
import {
  clearCheckoutIntent,
  completeOrder,
  ensureCheckoutIntent,
  fetchOrderById,
  fetchOrders,
  payOrder,
  subscribeOrders,
  urgeOrder,
} from './orders'
import type { RealtimeChannelSpec } from '@/core/realtime'

/** 支付接口调用经 mock 的对接层断言；`vi.hoisted` 保证 mock 工厂先于模块导入生效 */
const { openChannelMock, postMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  openChannelMock: vi.fn(),
}))

vi.mock('@/core/realtime', () => ({
  openChannel: openChannelMock,
}))

vi.mock('@/core/transport', () => ({
  transport: { Post: postMock },
  // core/session 装载链在本测试中经过 mock 通道：补上它注册 provider 与调平台端点所需的导出
  registerSessionProvider: vi.fn(),
  rawTransport: {},
  supabaseUrl: vi.fn(),
  supabasePublishableKey: vi.fn(),
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
        item_images: [{ image_path: 'products/latte.png' }],
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

describe('fetchOrderById（Story 4.2；FR-P3-11 / AR-P3-18）', () => {
  /** 服务端详情快照：订单对外形状 + 门店快照三列 + 明细快照数组 */
  const detail: OrderDetail = {
    id: '22222222-2222-4222-8222-222222222222',
    order_number: '202609301200000001',
    status: 'cooking',
    dining_mode: 'takeout',
    packaging_fee: 2,
    total_amount: 34,
    notes: '少冰',
    pickup_code: 'A-0001',
    created_at: '2026-09-30 12:00:00',
    store_name: '星巴克 啡快自提店',
    store_address: '北京市朝阳区创意产业园 A 座 1 层',
    store_phone: '010-88888888',
    items: [
      {
        product_id: 'p-1',
        product_name: '拿铁',
        spec_summary: '大杯 Grande',
        selections: { size: 'grande' },
        unit_price: 32,
        quantity: 1,
        image_path: null,
      },
    ],
  }

  beforeEach(() => {
    postMock.mockReset()
    postMock.mockResolvedValue(detail)
  })

  it('经对接层 POST get_my_order_detail：订单 id 是唯一参数、session-required', async () => {
    await expect(fetchOrderById(detail.id)).resolves.toEqual(detail)

    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body, config] = postMock.mock.calls[0] as [string, Record<string, unknown>, unknown]
    expect(url).toBe('/rest/v1/rpc/get_my_order_detail')
    expect(body).toEqual({ p_order_id: detail.id })
    expect(config).toEqual({ meta: { auth: 'session-required' } })
  })

  it('请求体只有订单 id：不传用户标识（归属由服务端会话决定，FR-P3-11）', () => {
    void fetchOrderById(detail.id)

    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(Object.keys(body)).toEqual(['p_order_id'])
  })
})

describe('urgeOrder（Story 4.4；FR-P3-13）', () => {
  /** 服务端催单返回 = 订单对外形状（本端不消费返回值，仅确认调用成功） */
  const order: OrderResult = {
    id: '33333333-3333-4333-8333-333333333333',
    order_number: '202610041200000001',
    status: 'cooking',
    dining_mode: 'dinein',
    packaging_fee: 0,
    total_amount: 32,
    notes: '无备注要求',
    pickup_code: 'B-0001',
    created_at: '2026-10-04 12:00:00',
  }

  beforeEach(() => {
    postMock.mockReset()
    postMock.mockResolvedValue(order)
  })

  it('经对接层 POST urge_order：订单 id 是唯一参数、session-required', async () => {
    await expect(urgeOrder(order.id)).resolves.toEqual(order)

    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body, config] = postMock.mock.calls[0] as [string, Record<string, unknown>, unknown]
    expect(url).toBe('/rest/v1/rpc/urge_order')
    expect(body).toEqual({ p_order_id: order.id })
    expect(config).toEqual({ meta: { auth: 'session-required' } })
  })

  it('请求体只有订单 id：不传用户标识、时间与金额（归属与提前量由服务端决定）', () => {
    void urgeOrder(order.id)

    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(Object.keys(body)).toEqual(['p_order_id'])
  })
})

describe('completeOrder（Story 4.5；FR-P3-14）', () => {
  /** 服务端确认取餐返回 = 完成后的订单对外形状（展示经读取路径刷新，本端不直接消费） */
  const order: OrderResult = {
    id: '44444444-4444-4444-8444-444444444444',
    order_number: '202610041200000002',
    status: 'completed',
    dining_mode: 'dinein',
    packaging_fee: 0,
    total_amount: 32,
    notes: '无备注要求',
    pickup_code: 'C-0001',
    created_at: '2026-10-04 12:00:00',
  }

  beforeEach(() => {
    postMock.mockReset()
    postMock.mockResolvedValue(order)
  })

  it('经对接层 POST complete_order：订单 id 是唯一参数、session-required', async () => {
    await expect(completeOrder(order.id)).resolves.toEqual(order)

    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body, config] = postMock.mock.calls[0] as [string, Record<string, unknown>, unknown]
    expect(url).toBe('/rest/v1/rpc/complete_order')
    expect(body).toEqual({ p_order_id: order.id })
    expect(config).toEqual({ meta: { auth: 'session-required' } })
  })

  it('请求体只有订单 id：不传用户标识与完成时刻（归属与时间由服务端决定）', () => {
    void completeOrder(order.id)

    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(Object.keys(body)).toEqual(['p_order_id'])
    expect(body).not.toHaveProperty('completed_at')
    expect(body).not.toHaveProperty('user_id')
  })
})

describe('subscribeOrders（Story 5.1 / 5.2 订阅入口；AD-9）', () => {
  beforeEach(() => {
    openChannelMock.mockReset()
  })

  it('列表：key / topic 固定，本人 id 过滤的 INSERT + UPDATE 两条绑定', () => {
    subscribeOrders({ scope: 'list' })

    expect(openChannelMock).toHaveBeenCalledTimes(1)
    const spec = openChannelMock.mock.calls[0][0] as RealtimeChannelSpec
    expect(spec.key).toBe('orders:list')
    expect(spec.topic).toBe('orders')
    expect(typeof spec.resolveUserId).toBe('function')
    expect(spec.bindingFor('user-1')).toEqual([
      { event: 'INSERT', schema: 'public', table: 'orders', filter: 'user_id=eq.user-1' },
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'user_id=eq.user-1' },
    ])
    expect(spec.onEvent).toBeUndefined() // 未传（Story 5.1 被动接线契约不变）
  })

  it('onEvent（Story 5.2）：推送触发回调经选项原样转交 core（只作触发信号、不携带行数据）', () => {
    const onEvent = vi.fn()
    subscribeOrders({ scope: 'list', onEvent })

    const spec = openChannelMock.mock.calls[0][0] as RealtimeChannelSpec
    expect(spec.onEvent).toBe(onEvent)
    spec.onEvent?.()
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('详情：按订单 id 过滤（只订 INSERT / UPDATE）；缺订单 id 时静态 unavailable、不发起订阅', () => {
    subscribeOrders({ scope: 'order', orderId: 'o-9' })
    const spec = openChannelMock.mock.calls[0][0] as RealtimeChannelSpec
    expect(spec.key).toBe('orders:o-9')
    expect(spec.bindingFor('user-1').map((binding) => binding.filter)).toEqual([
      'id=eq.o-9',
      'id=eq.o-9',
    ])
    expect(spec.bindingFor('user-1').map((binding) => binding.event)).toEqual(['INSERT', 'UPDATE'])

    openChannelMock.mockReset()
    const statuses: string[] = []
    const handle = subscribeOrders({ scope: 'order' })
    handle.onStatus((status) => statuses.push(status))
    expect(statuses).toEqual(['unavailable'])
    expect(openChannelMock).not.toHaveBeenCalled()
  })
})
