/**
 * 确认取餐 Composable 单元测试（P3 Story 4.5；FR-P3-14）
 *
 * 用 mock 的 `api/orders.completeOrder` + stub 的 `uni.showToast` 驱动（不发起真实网络请求）：
 * 1. 成功：调一次 API → toast「取餐成功」→ 先刷新后清 loading（顺序）；
 * 2. 在飞期间连点：同一订单只发一次请求，loading 保持到读取完成；
 * 3. 失败：类别文案 toast、不刷新、可重试（重试成功后刷新）；
 * 4. 读取失败静默：确认仍成功、不叠加第二条错误提示、loading 清除；
 * 5. 不同订单互不影响；空 id 不发请求。
 *
 * 模块级「在飞」状态在每个用例前经 `vi.resetModules()` 重新导入
 * （等价 App 重启后的空白状态，保证用例互不污染）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderResult } from '@/types/api-contracts'

const { completeOrderApiMock, toastMock } = vi.hoisted(() => ({
  completeOrderApiMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/api/orders', () => ({
  completeOrder: completeOrderApiMock,
}))

let useConfirmPickup: (typeof import('./use-confirm-pickup'))['useConfirmPickup']

beforeEach(async () => {
  vi.resetModules()
  completeOrderApiMock.mockReset()
  toastMock.mockReset()
  vi.stubGlobal('uni', { showToast: toastMock })
  ;({ useConfirmPickup } = await import('./use-confirm-pickup'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 服务端确认取餐返回 = 完成后的订单对外形状（展示经读取路径刷新，本端不直接消费） */
const orderResult: OrderResult = {
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

describe('useConfirmPickup（Story 4.5）', () => {
  it('成功：调一次 API、toast「取餐成功」、先刷新后清 loading', async () => {
    completeOrderApiMock.mockResolvedValueOnce(orderResult)
    const { isConfirming, confirmPickup } = useConfirmPickup()
    const refresh = vi.fn(async () => {})

    const ok = await confirmPickup('order-1', refresh)

    expect(ok).toBe(true)
    expect(completeOrderApiMock).toHaveBeenCalledTimes(1)
    expect(completeOrderApiMock).toHaveBeenCalledWith('order-1')
    // toast 在读取之前发出（读取期间按钮保持 loading，不闪回「确认取餐」）
    expect(toastMock).toHaveBeenCalledWith({ title: '取餐成功', icon: 'none' })
    expect(toastMock.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(isConfirming('order-1')).toBe(false)
  })

  it('在飞期间连点：同一订单只发一次请求、loading 保持到读取完成', async () => {
    let resolveComplete: (value: OrderResult) => void = () => {}
    completeOrderApiMock.mockImplementationOnce(
      () =>
        new Promise<OrderResult>((resolve) => {
          resolveComplete = resolve
        }),
    )
    let resolveRefresh: () => void = () => {}
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    const { isConfirming, confirmPickup } = useConfirmPickup()

    const first = confirmPickup('order-2', refresh)
    const second = confirmPickup('order-2', refresh)
    expect(completeOrderApiMock).toHaveBeenCalledTimes(1)
    expect(isConfirming('order-2')).toBe(true)

    resolveComplete(orderResult)
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    // 读取仍在飞：按钮保持 loading，直到读取完成才清
    expect(isConfirming('order-2')).toBe(true)

    resolveRefresh()
    await Promise.all([first, second])
    expect(completeOrderApiMock).toHaveBeenCalledTimes(1)
    expect(isConfirming('order-2')).toBe(false)
  })

  it('失败：类别文案 toast、不刷新、可重试（重试成功后刷新）', async () => {
    completeOrderApiMock.mockRejectedValueOnce({ source: 'order', code: 'invalid_status' })
    const { confirmPickup } = useConfirmPickup()
    const refresh = vi.fn(async () => {})

    const ok = await confirmPickup('order-3', refresh)

    expect(ok).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith({
      title: '当前状态不支持该操作，请刷新后重试',
      icon: 'none',
    })

    completeOrderApiMock.mockResolvedValueOnce(orderResult)
    await confirmPickup('order-3', refresh)

    expect(completeOrderApiMock).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('读取失败静默：确认仍成功、不叠加错误提示、loading 清除', async () => {
    completeOrderApiMock.mockResolvedValueOnce(orderResult)
    const { isConfirming, confirmPickup } = useConfirmPickup()
    const refresh = vi.fn(async () => {
      throw new Error('boom')
    })

    const ok = await confirmPickup('order-4', refresh)

    expect(ok).toBe(true)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({ title: '取餐成功', icon: 'none' })
    expect(isConfirming('order-4')).toBe(false)
  })

  it('不同订单互不影响（可并发）；空 id 不发请求', async () => {
    completeOrderApiMock.mockResolvedValue(orderResult)
    const { confirmPickup } = useConfirmPickup()

    await Promise.all([confirmPickup('order-5'), confirmPickup('order-6')])
    expect(completeOrderApiMock).toHaveBeenCalledTimes(2)
    expect(toastMock).toHaveBeenCalledTimes(2) // 两张单各一次成功提示

    await confirmPickup('')
    expect(completeOrderApiMock).toHaveBeenCalledTimes(2)
    expect(toastMock).toHaveBeenCalledTimes(2) // 空 id 不发请求、也不提示
  })
})
