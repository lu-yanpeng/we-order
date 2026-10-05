/**
 * 订单列表 Composable 单元测试（P3 Story 4.1 / 4.3；AD-7 / AD-8）
 *
 * 用 mock 的 `api/orders.fetchOrders` + fake timers 驱动状态机与轮询，不发起真实网络请求：
 * 1. 首屏读取（进入可见域）：成功渲染、空态、失败态（无数据）；
 * 2. 进入可见域读取的「只增不删」合并与游标续翻（含轮询读取）；
 * 3. 下拉刷新（显式刷新）的整表替换与游标重置；
 * 4. 触底分页的追加去重；
 * 5. 骨架的 250ms 防抖延迟；
 * 6. 失败保留已有数据（自动 / 轮询静默、用户主动刷新才 toast）；
 * 7. 轮询 5s 刷新、状态单调不倒退、空态停止轮询（Story 4.3）；
 * 8. 操作后读取 `refreshAfterAction`（Story 4.5）：立即读取 + auto 语义合并（保游标、
 *    状态更新）、失败静默（保留数据、不 toast）。
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
    item_images: [],
  }
}

/** 键集游标（形状 = 服务端 `next_cursor`；创建时原样回传） */
function cursor(n: number) {
  return { created_at: `2026-09-30T12:00:00+00:00`, id: item(n).id }
}

function page(items: OrderListItem[], next: OrdersPage['next_cursor'] = null): OrdersPage {
  return { items, next_cursor: next }
}

/** 进入订单可见域：触发立即读取并等待完成（Story 4.3 的编排入口） */
function enter(s: ReturnType<typeof useOrders>) {
  return s.setActive(true)
}

beforeEach(() => {
  fetchOrdersMock.mockReset()
  toastMock.mockReset()
  vi.stubGlobal('uni', { showToast: toastMock })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useOrders 状态机（Story 4.1）', () => {
  it('首屏成功：渲染列表、游标入状态；快网不显示骨架', async () => {
    fetchOrdersMock.mockResolvedValueOnce(page([item(3), item(2)], cursor(2)))
    const s = useOrders()

    await enter(s)

    expect(s.orders.value.map((o) => o.id)).toEqual([item(3).id, item(2).id])
    expect(s.hasMore.value).toBe(true)
    expect(s.isEmpty.value).toBe(false)
    expect(s.error.value).toBeNull()
    expect(s.skeletonVisible.value).toBe(false)
  })

  it('成功且 0 条 → 空态；失败且 0 条 → 失败态（文案来自唯一翻译）', async () => {
    fetchOrdersMock.mockResolvedValueOnce(page([]))
    const s = useOrders()
    await enter(s)
    expect(s.isEmpty.value).toBe(true)
    expect(s.error.value).toBeNull()

    fetchOrdersMock.mockRejectedValueOnce({ source: 'client', code: 'network_unreachable' })
    const failed = useOrders()
    await failed.setActive(true)
    expect(failed.error.value).toBe('网络不可用，请检查网络后重试')
    expect(failed.isEmpty.value).toBe(false)
  })

  it('首屏骨架：慢网 250ms 后出现，读取完成即收起', async () => {
    let resolvePage: (value: OrdersPage) => void = () => {}
    fetchOrdersMock.mockImplementationOnce(
      () =>
        new Promise<OrdersPage>((resolve) => {
          resolvePage = resolve
        }),
    )
    const s = useOrders()

    const pending = s.setActive(true)
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
    await enter(s)
    await s.loadMoreOrders()
    expect(s.orders.value.map((o) => o.id)).toEqual([item(4).id, item(3).id, item(2).id])
    expect(s.hasMore.value).toBe(true)

    await s.setActive(false)
    await enter(s)
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
    await enter(s)
    await s.loadMoreOrders()
    expect(s.hasMore.value).toBe(false)

    await s.setActive(false)
    await enter(s)
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
    await enter(s)
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
    await enter(s)
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
    await enter(s)

    // 自动（重新进入可见域）刷新失败 → 保留数据、不提示
    fetchOrdersMock.mockRejectedValueOnce({ source: 'client', code: 'timeout' })
    await s.setActive(false)
    await s.setActive(true)
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
    await enter(s)
    await s.loadMoreOrders()

    expect(s.orders.value.map((o) => o.id)).toEqual([item(2).id])
    expect(s.loadMoreError.value).toBe('网络不可用，请检查网络后重试')
    expect(s.loadingMore.value).toBe(false)
  })
})

describe('useOrders 轮询与状态单调（Story 4.3）', () => {
  it('轮询刷新：5s 自动读取一次，状态更新可见且不手动刷新', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(1, 'cooking')]))
      .mockResolvedValueOnce(page([item(1, 'pickup')]))

    const s = useOrders()
    await enter(s)
    expect(s.orders.value[0].status).toBe('cooking')

    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(2)
    expect(s.orders.value[0].status).toBe('pickup')
  })

  it('状态单调：轮询返回旧状态不倒退（pickup 不被 cooking 覆盖）', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(1, 'pickup')]))
      .mockResolvedValueOnce(page([item(1, 'cooking')]))

    const s = useOrders()
    await enter(s)

    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(2)
    expect(s.orders.value[0].status).toBe('pickup')
  })

  it('轮询读取同样「只增不删」：不冲掉已翻的页、不重新解锁「已到底」', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(3), item(2)], cursor(2)))
      .mockResolvedValueOnce(page([item(1)])) // 第 2 页 → 到底
      .mockResolvedValueOnce(page([item(4), item(3)], cursor(3))) // 轮询第一页

    const s = useOrders()
    await enter(s)
    await s.loadMoreOrders()
    expect(s.hasMore.value).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(s.orders.value.map((o) => o.id)).toEqual([
      item(4).id,
      item(3).id,
      item(2).id,
      item(1).id,
    ])
    expect(s.hasMore.value).toBe(false)
  })

  it('轮询失败：静默保留数据（不 toast、不叠加提示）', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(1)]))
      .mockRejectedValueOnce({ source: 'client', code: 'timeout' })

    const s = useOrders()
    await enter(s)

    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(2)
    expect(s.orders.value.map((o) => o.id)).toEqual([item(1).id])
    expect(s.error.value).toBeNull()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('空态停止轮询（FR-P3-10）：不再发起无意义读取', async () => {
    fetchOrdersMock.mockResolvedValueOnce(page([]))
    const s = useOrders()
    await enter(s)
    expect(s.isEmpty.value).toBe(true)

    await vi.advanceTimersByTimeAsync(15000)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(1)
  })

  it('离开可见域停止轮询；回来立即读一次', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(1)]))
      .mockResolvedValueOnce(page([item(2), item(1)]))

    const s = useOrders()
    await enter(s)

    await s.setActive(false)
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(1)

    await enter(s)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(2)
    expect(s.orders.value.map((o) => o.id)).toEqual([item(2).id, item(1).id])
  })

  it('全部已完成停止轮询（终态集合）；刷新带回非完成单后自动恢复', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(2, 'completed'), item(1, 'completed')]))
      // 手动刷新：带回一张「制作中」单（等价于离开订单 tab 下单再回来的可见域重读）
      .mockResolvedValueOnce(page([item(3, 'cooking'), item(2, 'completed')]))
      // 恢复后轮询继续：下一次轮询拿到状态推进
      .mockResolvedValueOnce(page([item(3, 'pickup'), item(2, 'completed')]))

    const s = useOrders()
    await enter(s)
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(1) // 全完成 → 不再轮询

    await s.refreshOrders()
    expect(fetchOrdersMock).toHaveBeenCalledTimes(2)

    // 混合状态（制作中 + 已完成）继续轮询，轮询合并按序号门更新状态
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(3)
    expect(s.orders.value.map((o) => o.id)).toEqual([item(3).id, item(2).id])
    expect(s.orders.value[0].status).toBe('pickup')
  })
})

describe('useOrders 操作后读取（Story 4.5）', () => {
  it('refreshAfterAction：立即读取一次并按 auto 语义合并（保游标、保已翻页、状态更新）', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(3, 'pickup'), item(2, 'completed')], cursor(2)))
      .mockResolvedValueOnce(page([item(1)])) // 触底翻第 2 页 → 到底
      // 确认取餐后的操作读取：第一页里该单已变已完成（服务端读时自动完成 / 确认成功）
      .mockResolvedValueOnce(page([item(3, 'completed'), item(2, 'completed')], cursor(2)))

    const s = useOrders()
    await enter(s)
    await s.loadMoreOrders()
    expect(s.hasMore.value).toBe(false)

    await s.refreshAfterAction()

    // 操作读取第一页（不传游标）→ 合并：已翻的第 2 页保留、游标保持「已到底」
    expect(fetchOrdersMock).toHaveBeenCalledTimes(3)
    expect(fetchOrdersMock).toHaveBeenLastCalledWith(null)
    expect(s.orders.value.map((o) => o.id)).toEqual([item(3).id, item(2).id, item(1).id])
    expect(s.orders.value[0].status).toBe('completed')
    expect(s.hasMore.value).toBe(false)
  })

  it('refreshAfterAction 失败静默（保留数据、不 toast），并重置轮询计时', async () => {
    fetchOrdersMock
      .mockResolvedValueOnce(page([item(1, 'pickup')]))
      .mockRejectedValueOnce({ source: 'client', code: 'timeout' })
      .mockResolvedValueOnce(page([item(1, 'completed')]))

    const s = useOrders()
    await enter(s)

    await vi.advanceTimersByTimeAsync(2000)
    await s.refreshAfterAction()
    expect(fetchOrdersMock).toHaveBeenCalledTimes(2)
    expect(s.orders.value[0].status).toBe('pickup') // 失败保留数据
    expect(toastMock).not.toHaveBeenCalled() // 静默：由轮询自愈

    // 计时重置：距操作读取 5000ms 后下一次轮询（而非距首读 5000ms）
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchOrdersMock).toHaveBeenCalledTimes(3)
    expect(s.orders.value[0].status).toBe('completed')
  })
})
