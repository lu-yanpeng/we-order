/**
 * 订单详情 Composable 单元测试（P3 Story 4.2；FR-P3-11 / 最小 UI 规范）
 *
 * 用 mock 的 `api/orders.fetchOrderById` 驱动状态机，不发起真实网络请求：
 * 1. 首读成功 / 失败（文案唯一来源、不展示缓存数据）；
 * 2. 首读遮罩的 250ms 防抖延迟与完成即撤；失败重试不弹遮罩；
 * 3. 下拉刷新：成功更新；已有数据失败保留数据 + toast；无数据失败进失败态；
 * 4. 空 id 本地守卫不发请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderDetail } from '@/types/api-contracts'

const { fetchOrderByIdMock, toastMock } = vi.hoisted(() => ({
  fetchOrderByIdMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/api/orders', () => ({
  fetchOrderById: fetchOrderByIdMock,
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
    },
  ],
}

beforeEach(() => {
  fetchOrderByIdMock.mockReset()
  toastMock.mockReset()
  vi.stubGlobal('uni', { showToast: toastMock })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useOrderDetail 状态机（Story 4.2）', () => {
  it('首读成功：详情写入状态、无失败文案、遮罩收起', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detail)
    const s = useOrderDetail()

    await s.initOrderDetail(detail.id)

    expect(fetchOrderByIdMock).toHaveBeenCalledWith(detail.id)
    expect(s.order.value).toEqual(detail)
    expect(s.error.value).toBeNull()
    expect(s.loading.value).toBe(false)
    expect(s.overlayVisible.value).toBe(false)
  })

  it('首读失败：不展示数据、失败态文案来自唯一翻译（order_not_found 不泄露存在性）', async () => {
    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'order', code: 'order_not_found' })
    const s = useOrderDetail()

    await s.initOrderDetail('id-x')

    expect(s.order.value).toBeNull()
    expect(s.error.value).toBe('订单不存在或已失效')
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('首读遮罩：250ms 后出现、读取完成即撤（快网不显示）', async () => {
    vi.useFakeTimers()
    let resolveDetail: (value: OrderDetail) => void = () => {}
    fetchOrderByIdMock.mockImplementationOnce(
      () =>
        new Promise<OrderDetail>((resolve) => {
          resolveDetail = resolve
        }),
    )
    const s = useOrderDetail()

    const pending = s.initOrderDetail(detail.id)
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
    await s.initOrderDetail(detail.id)
    expect(s.error.value).toBe('网络不可用，请检查网络后重试')

    vi.useFakeTimers()
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
    await s.initOrderDetail(detail.id)

    const updated = { ...detail, status: 'pickup' as const }
    fetchOrderByIdMock.mockResolvedValueOnce(updated)
    await s.refreshOrderDetail()

    expect(s.order.value).toEqual(updated)
    expect(s.overlayVisible.value).toBe(false)
  })

  it('已有数据刷新失败：保留数据 + toast 一次（不丢内容、不伪装失败态）', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detail)
    const s = useOrderDetail()
    await s.initOrderDetail(detail.id)

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
    await s.initOrderDetail(detail.id)

    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'client', code: 'timeout' })
    await s.refreshOrderDetail()

    expect(s.order.value).toBeNull()
    expect(s.error.value).toBe('请求超时，请重试')
  })

  it('空 id：本地守卫不发请求，按「订单不存在」类别呈现', async () => {
    const s = useOrderDetail()

    await s.initOrderDetail('')

    expect(fetchOrderByIdMock).not.toHaveBeenCalled()
    expect(s.order.value).toBeNull()
    expect(s.error.value).toBe('订单不存在或已失效')
  })
})
