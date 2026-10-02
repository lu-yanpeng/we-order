/**
 * 订单列表 Composable 单元测试（P3 Story 4.1；AD-7 / AR-P3-18）
 *
 * 用 mock 的 `api/orders.fetchOrders` 驱动状态机，不发起真实网络请求：
 * 1. 整表读取（首屏）：成功渲染、空态、失败态（无数据）；
 * 2. 进入可见域读取的「只增不删」合并与游标续翻；
 * 3. 下拉刷新（显式刷新）的整表替换与游标重置；
 * 4. 触底分页的追加去重；
 * 5. 骨架的 250ms 防抖延迟；
 * 6. 失败保留已有数据（用户主动刷新才 toast）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderListItem, OrdersPage, OrderStatus } from '@/types/api-contracts'

const { fetchOrdersMock, toastMock } = vi.hoisted(() => ({
  fetchOrdersMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/api/orders', () => ({
  fetchOrders: fetchOrdersMock,
}))

import { useOrders } from './use-orders'

/** 构造列表项（形状 = `get_my_orders` 的条目，字段齐全） */
function item(n: number, status: OrderStatus = 'cooking'): OrderListItem {
  return {
    id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    order_number: `2026093012000000${String(n).padStart(2, '0')}`,
    status,
    dining_mode: 'dinein',
    packaging_fee: 0,
    total_amount: 20 + n,
    notes: '无备注要求',
    pickup_code: `A-000${n}`,
    created_at: `2026-09-30 12:00:00`,
    item_summary: `拿铁 ×${n}`,
  }
}

/** 键集游标（形状 = 服务端 `next_cursor`；创建时原样回传） */
function cursor(n: number) {
  return { created_at: `2026-09-30T12:00:00+00:00`, id: item(n).id }
}

function page(items: OrderListItem[], next: OrdersPage['next_cursor'] = null): OrdersPage {
  return { items, next_cursor: next }
}

beforeEach(() => {
  fetchOrdersMock.mockReset()
  toastMock.mockReset()
  vi.stubGlobal('uni', { showToast: toastMock })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useOrders 状态机（Story 4.1）', () => {
  it('首屏成功：渲染列表、游标入状态；快网不显示骨架', async () => {
    fetchOrdersMock.mockResolvedValueOnce(page([item(3), item(2)], cursor(2)))
    const s = useOrders()

    await s.loadOrders()

    expect(s.orders.value.map((o) => o.id)).toEqual([item(3).id, item(2).id])
    expect(s.hasMore.value).toBe(true)
    expect(s.isEmpty.value).toBe(false)
    expect(s.error.value).toBeNull()
    expect(s.skeletonVisible.value).toBe(false)
  })

  it('成功且 0 条 → 空态；失败且 0 条 → 失败态（文案来自唯一翻译）', async () => {
    fetchOrdersMock.mockResolvedValueOnce(page([]))
    const s = useOrders()
    await s.loadOrders()
    expect(s.isEmpty.value).toBe(true)
    expect(s.error.value).toBeNull()

    fetchOrdersMock.mockRejectedValueOnce({ source: 'client', code: 'network_unreachable' })
    const failed = useOrders()
    await failed.loadOrders()
    expect(failed.error.value).toBe('网络不可用，请检查网络后重试')
    expect(failed.isEmpty.value).toBe(false)
  })

  it('首屏骨架：慢网 250ms 后出现，读取完成即收起', async () => {
    vi.useFakeTimers()
    let resolvePage: (value: OrdersPage) => void = () => {}
    fetchOrdersMock.mockImplementationOnce(
      () =>
        new Promise<OrdersPage>((resolve) => {
          resolvePage = resolve
        }),
    )
    const s = useOrders()

    const pending = s.loadOrders()
    expect(s.skeletonVisible.value).toBe(false)
    vi.advanceTimersByTime(250)
    expect(s.skeletonVisible.value).toBe(true)

    resolvePage(page([item(1)]))
    await pending
    expect(s.skeletonVisible.value).toBe(false)
  })

  it('进入可见域读取：合并只增不删（新单插入、已翻的页保留），游标从原处续翻', async () => {
    fetchOrdersMock
      // 首屏第 1 页 → 触底拿到第 2 页（仍有下一页）
      .mockResolvedValueOnce(page([item(4), item(3)], cursor(3)))
      .mockResolvedValueOnce(page([item(2)], cursor(2)))
      // 再次进入可见域：服务端第一页新增 item(5)，其余为已知
      .mockResolvedValueOnce(page([item(5), item(4)], cursor(4)))
      // 触底续翻：仍从原游标 c(2) 取下一页
      .mockResolvedValueOnce(page([item(1)]))

    const s = useOrders()
    await s.loadOrders()
    await s.loadMoreOrders()
    expect(s.orders.value.map((o) => o.id)).toEqual([item(4).id, item(3).id, item(2).id])
    expect(s.hasMore.value).toBe(true)

    await s.loadOrders()
    expect(s.orders.value.map((o) => o.id)).toEqual([
      item(5).id,
      item(4).id,
      item(3).id,
      item(2).id,
    ])

    // 尾部未变：续翻仍从原游标 c(2) 取，不从第一页重头翻
    await s.loadMoreOrders()
    expect(fetchOrdersMock).toHaveBeenLastCalledWith(cursor(2))
    expect(s.orders.value.map((o) => o.id)).toEqual([
      item(5).id,
      item(4).id,
      item(3).id,
      item(2).id,
      item(1).id,
    ])
  })

  it('到底后再次进入可见域：保持「没有更多」，不被服务端第一页的游标重新解锁', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(2)], cursor(2)))
      .mockResolvedValueOnce(page([item(1)])) // 第 2 页 → 到底
      // 进入可见域：库中仍有 >20 条，服务端第一页仍带 next_cursor
      .mockResolvedValueOnce(page([item(3), item(2)], cursor(2)))

    const s = useOrders()
    await s.loadOrders()
    await s.loadMoreOrders()
    expect(s.hasMore.value).toBe(false)

    await s.loadOrders()
    expect(s.orders.value.map((o) => o.id)).toEqual([item(3).id, item(2).id, item(1).id])
    expect(s.hasMore.value).toBe(false)

    // 到底后触底不再发分页请求（2026-10-02 评审修复：原实现会重新解锁并再翻一遍）
    await s.loadMoreOrders()
    expect(fetchOrdersMock).toHaveBeenCalledTimes(3)
  })

  it('下拉刷新（显式刷新）：整表替换并重置游标（已翻的页由服务端第一页重新开始）', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(3), item(2)], cursor(2)))
      .mockResolvedValueOnce(page([item(1)]))
      .mockResolvedValueOnce(page([item(5)], cursor(5)))

    const s = useOrders()
    await s.loadOrders()
    await s.loadMoreOrders()
    await s.refreshOrders()

    expect(s.orders.value.map((o) => o.id)).toEqual([item(5).id])
    expect(s.hasMore.value).toBe(true)
    expect(s.refreshing.value).toBe(false)
  })

  it('触底分页：追加去重、游标推进；无游标 / 已在加载时不发请求', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(3), item(2)], cursor(2)))
      // 第 2 页含重复 id，去重后只追加新条目
      .mockResolvedValueOnce(page([item(2), item(1)]))

    const s = useOrders()
    await s.loadOrders()
    await s.loadMoreOrders()
    expect(s.orders.value.map((o) => o.id)).toEqual([item(3).id, item(2).id, item(1).id])
    expect(fetchOrdersMock).toHaveBeenCalledTimes(2)

    // 到底后触底不再发请求
    await s.loadMoreOrders()
    expect(fetchOrdersMock).toHaveBeenCalledTimes(2)
    expect(s.orders.value.map((o) => o.id)).toEqual([item(3).id, item(2).id, item(1).id])
  })

  it('失败保留已有数据：自动刷新静默、用户主动刷新 toast 一次', async () => {
    fetchOrdersMock.mockResolvedValueOnce(page([item(2)]))
    const s = useOrders()
    await s.loadOrders()

    // 自动（进入可见域）刷新失败 → 保留数据、不提示
    fetchOrdersMock.mockRejectedValueOnce({ source: 'client', code: 'timeout' })
    await s.loadOrders()
    expect(s.orders.value.map((o) => o.id)).toEqual([item(2).id])
    expect(s.error.value).toBeNull()
    expect(toastMock).not.toHaveBeenCalled()

    // 用户主动刷新失败 → 保留数据 + toast 一次
    fetchOrdersMock.mockRejectedValueOnce({ source: 'client', code: 'timeout' })
    await s.refreshOrders()
    expect(s.orders.value.map((o) => o.id)).toEqual([item(2).id])
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({ title: '请求超时，请重试', icon: 'none' })
  })

  it('触底分页失败：保留已加载数据、产出页脚失败文案', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(2)], cursor(2)))
      .mockRejectedValueOnce({ source: 'client', code: 'network_unreachable' })

    const s = useOrders()
    await s.loadOrders()
    await s.loadMoreOrders()

    expect(s.orders.value.map((o) => o.id)).toEqual([item(2).id])
    expect(s.loadMoreError.value).toBe('网络不可用，请检查网络后重试')
    expect(s.loadingMore.value).toBe(false)
  })
})
