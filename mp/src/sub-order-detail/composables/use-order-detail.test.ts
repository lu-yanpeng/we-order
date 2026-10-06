/**
 * 订单详情 Composable 单元测试（P3 Story 4.2 / 4.3；FR-P3-11 / FR-P3-12）
 *
 * 用 mock 的 `api/orders.fetchOrderById` + fake timers 驱动状态机与轮询，不发起真实网络请求：
 * 1. 首读成功 / 失败（文案唯一来源、不展示缓存数据）；
 * 2. 首读遮罩的 250ms 防抖延迟与完成即撤；失败重试不弹遮罩；
 * 3. 下拉刷新：成功更新；已有数据失败保留数据 + toast；无数据失败进失败态；
 * 4. 空 id 本地守卫不发请求、不轮询；
 * 5. 轮询 5s 更新、completed 终态停轮询、状态单调不倒退（Story 4.3）；
 * 6. 操作后读取 `refreshAfterAction`（Story 4.5）：确认取餐后读取变已完成并停轮询、
 *    失败静默（保留数据、不 toast）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderDetail } from '@/types/api-contracts'

const { fetchOrderByIdMock, toastMock } = vi.hoisted(() => ({
  fetchOrderByIdMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/api/orders', () => ({
  fetchOrderById: fetchOrderByIdMock,
  // Story 5.1 被动接线：订阅入口（返回空句柄；订阅行为由 core/realtime 单测覆盖）
  subscribeOrders: () => ({ unsubscribe: vi.fn(), onStatus: () => () => {} }),
}))

import { useOrderDetail } from './use-order-detail'

/** 服务端详情快照（字段齐全） */
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
  fetchOrderByIdMock.mockReset()
  toastMock.mockReset()
  vi.stubGlobal('uni', { showToast: toastMock })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useOrderDetail 状态机（Story 4.2）', () => {
  it('首读成功：详情写入状态、无失败文案、遮罩收起', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detail)
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)

    await s.setActive(true)

    expect(fetchOrderByIdMock).toHaveBeenCalledWith(detail.id)
    expect(s.order.value).toEqual(detail)
    expect(s.error.value).toBeNull()
    expect(s.loading.value).toBe(false)
    expect(s.overlayVisible.value).toBe(false)
  })

  it('首读失败：不展示数据、失败态文案来自唯一翻译（order_not_found 不泄露存在性）', async () => {
    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'order', code: 'order_not_found' })
    const s = useOrderDetail()
    s.prepareOrderDetail('id-x')

    await s.setActive(true)

    expect(s.order.value).toBeNull()
    expect(s.error.value).toBe('订单不存在或已失效')
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('首读遮罩：250ms 后出现、读取完成即撤（快网不显示）', async () => {
    let resolveDetail: (value: OrderDetail) => void = () => {}
    fetchOrderByIdMock.mockImplementationOnce(
      () =>
        new Promise<OrderDetail>((resolve) => {
          resolveDetail = resolve
        }),
    )
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)

    const pending = s.setActive(true)
    expect(s.overlayVisible.value).toBe(false)
    vi.advanceTimersByTime(249)
    expect(s.overlayVisible.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(s.overlayVisible.value).toBe(true)

    resolveDetail(detail)
    await pending
    expect(s.overlayVisible.value).toBe(false)
    expect(s.order.value).toEqual(detail)
  })

  it('失败态重试：不弹全屏遮罩（只走按钮 loading），成功后恢复内容', async () => {
    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'client', code: 'network_unreachable' })
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)
    expect(s.error.value).toBe('网络不可用，请检查网络后重试')

    let resolveDetail: (value: OrderDetail) => void = () => {}
    fetchOrderByIdMock.mockImplementationOnce(
      () =>
        new Promise<OrderDetail>((resolve) => {
          resolveDetail = resolve
        }),
    )
    const retry = s.retryOrderDetail()
    vi.advanceTimersByTime(500)
    expect(s.overlayVisible.value).toBe(false)

    resolveDetail(detail)
    await retry
    expect(s.order.value).toEqual(detail)
    expect(s.error.value).toBeNull()
  })

  it('下拉刷新成功：更新数据、不弹遮罩', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detail)
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    const updated = { ...detail, status: 'pickup' as const }
    fetchOrderByIdMock.mockResolvedValueOnce(updated)
    await s.refreshOrderDetail()

    expect(s.order.value).toEqual(updated)
    expect(s.overlayVisible.value).toBe(false)
  })

  it('已有数据刷新失败：保留数据 + toast 一次（不丢内容、不伪装失败态）', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detail)
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'client', code: 'timeout' })
    await s.refreshOrderDetail()

    expect(s.order.value).toEqual(detail)
    expect(s.error.value).toBeNull()
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({ title: '请求超时，请重试', icon: 'none' })
  })

  it('无数据刷新失败：进入失败态、不展示缓存', async () => {
    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'client', code: 'network_unreachable' })
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'client', code: 'timeout' })
    await s.retryOrderDetail()

    expect(s.order.value).toBeNull()
    expect(s.error.value).toBe('请求超时，请重试')
  })

  it('空 id：本地守卫不发请求、按「订单不存在」类别呈现、不轮询', async () => {
    const s = useOrderDetail()
    s.prepareOrderDetail('')

    await s.setActive(true)

    expect(fetchOrderByIdMock).not.toHaveBeenCalled()
    expect(s.order.value).toBeNull()
    expect(s.error.value).toBe('订单不存在或已失效')

    await vi.advanceTimersByTimeAsync(15000)
    expect(fetchOrderByIdMock).not.toHaveBeenCalled()
  })
})

describe('useOrderDetail 轮询与状态单调（Story 4.3）', () => {
  it('轮询刷新：5s 自动读取一次，状态更新可见', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detail)
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    const updated = { ...detail, status: 'pickup' as const }
    fetchOrderByIdMock.mockResolvedValueOnce(updated)
    await vi.advanceTimersByTimeAsync(5000)

    expect(fetchOrderByIdMock).toHaveBeenCalledTimes(2)
    expect(s.order.value?.status).toBe('pickup')
  })

  it('completed 终态：停止轮询（不再发起无意义读取）', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detail)
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    const completed = { ...detail, status: 'completed' as const }
    fetchOrderByIdMock.mockResolvedValueOnce(completed)
    await vi.advanceTimersByTimeAsync(5000)
    expect(s.order.value?.status).toBe('completed')

    await vi.advanceTimersByTimeAsync(15000)
    expect(fetchOrderByIdMock).toHaveBeenCalledTimes(2)
  })

  it('状态单调：轮询返回旧状态不倒退（pickup 不被 cooking 覆盖）', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce({ ...detail, status: 'pickup' })
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    fetchOrderByIdMock.mockResolvedValueOnce({ ...detail, status: 'cooking' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(s.order.value?.status).toBe('pickup')
  })

  it('自动读取（轮询）失败：静默保留数据（不 toast）', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detail)
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'client', code: 'timeout' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(s.order.value).toEqual(detail)
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('隐藏停止轮询；回到前台立即读一次并更新', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detail)
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    await s.setActive(false)
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetchOrderByIdMock).toHaveBeenCalledTimes(1)

    const updated = { ...detail, status: 'pickup' as const }
    fetchOrderByIdMock.mockResolvedValueOnce(updated)
    await s.setActive(true)
    expect(fetchOrderByIdMock).toHaveBeenCalledTimes(2)
    expect(s.order.value?.status).toBe('pickup')
  })
})

describe('useOrderDetail 操作后读取（Story 4.5）', () => {
  it('refreshAfterAction：确认取餐后读取变已完成并停止轮询', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce({ ...detail, status: 'pickup' })
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    const completed = { ...detail, status: 'completed' as const }
    fetchOrderByIdMock.mockResolvedValueOnce(completed)
    await s.refreshAfterAction()

    expect(s.order.value?.status).toBe('completed')
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetchOrderByIdMock).toHaveBeenCalledTimes(2) // completed 终态：不再轮询
  })

  it('refreshAfterAction 失败静默：保留数据、不 toast', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce({ ...detail, status: 'pickup' })
    const s = useOrderDetail()
    s.prepareOrderDetail(detail.id)
    await s.setActive(true)

    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'client', code: 'timeout' })
    await s.refreshAfterAction()

    expect(s.order.value?.status).toBe('pickup')
    expect(toastMock).not.toHaveBeenCalled()
  })
})
