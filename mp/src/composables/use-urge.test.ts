/**
 * 催单 Composable 单元测试（P3 Story 4.4；FR-P3-13）
 *
 * 用 mock 的 `api/orders.urgeOrder` + stub 的 `uni.showToast` 驱动（不发起真实网络请求）：
 * 1. 成功：调一次 API、标记「已催单」、toast 成功文案；
 * 2. 失败：不标记、类别文案 toast、可重试；
 * 3. 在飞期间连点：同一订单只发一次请求；
 * 4. 已催过再点：不发请求、只重复提示「已催单，请耐心等待」；
 * 5. 跨实例共享标记（列表与详情一致）；空 id 不发请求。
 *
 * 模块级「已催单 / 在飞」状态在每个用例前经 `vi.resetModules()` 重新导入
 * （等价 App 重启后的空白状态，保证用例互不污染）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderResult } from '@/types/api-contracts'

const { urgeOrderApiMock, toastMock } = vi.hoisted(() => ({
  urgeOrderApiMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/api/orders', () => ({
  urgeOrder: urgeOrderApiMock,
}))

let useUrge: (typeof import('./use-urge'))['useUrge']

beforeEach(async () => {
  vi.resetModules()
  urgeOrderApiMock.mockReset()
  toastMock.mockReset()
  vi.stubGlobal('uni', { showToast: toastMock })
  ;({ useUrge } = await import('./use-urge'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 服务端催单返回 = 订单对外形状（本端不消费返回值，仅确认调用成功） */
const orderResult: OrderResult = {
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

describe('useUrge（Story 4.4）', () => {
  it('成功：调一次 API、标记「已催单」、toast「已通知门店加快制作」', async () => {
    urgeOrderApiMock.mockResolvedValueOnce(orderResult)
    const { isUrged, urge } = useUrge()

    await urge('order-1')

    expect(urgeOrderApiMock).toHaveBeenCalledTimes(1)
    expect(urgeOrderApiMock).toHaveBeenCalledWith('order-1')
    expect(isUrged('order-1')).toBe(true)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({ title: '已通知门店加快制作', icon: 'none' })
  })

  it('失败：不标记、类别文案 toast、可重试（重试成功后标记）', async () => {
    urgeOrderApiMock.mockRejectedValueOnce({ source: 'order', code: 'invalid_status' })
    const { isUrged, urge } = useUrge()

    await urge('order-2')

    expect(isUrged('order-2')).toBe(false)
    expect(toastMock).toHaveBeenCalledWith({
      title: '当前状态不支持该操作，请刷新后重试',
      icon: 'none',
    })

    urgeOrderApiMock.mockResolvedValueOnce(orderResult)
    await urge('order-2')

    expect(urgeOrderApiMock).toHaveBeenCalledTimes(2)
    expect(isUrged('order-2')).toBe(true)
  })

  it('在飞期间连点：同一订单只发一次请求', async () => {
    let resolveUrge: (value: OrderResult) => void = () => {}
    urgeOrderApiMock.mockImplementationOnce(
      () =>
        new Promise<OrderResult>((resolve) => {
          resolveUrge = resolve
        }),
    )
    const { isUrged, urge } = useUrge()

    const first = urge('order-3')
    const second = urge('order-3')
    resolveUrge(orderResult)
    await Promise.all([first, second])

    expect(urgeOrderApiMock).toHaveBeenCalledTimes(1)
    expect(isUrged('order-3')).toBe(true)
  })

  it('已催过再点：不发请求、只重复提示「已催单，请耐心等待」', async () => {
    urgeOrderApiMock.mockResolvedValueOnce(orderResult)
    const { urge } = useUrge()
    await urge('order-4')
    toastMock.mockClear()

    await urge('order-4')

    expect(urgeOrderApiMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({ title: '已催单，请耐心等待', icon: 'none' })
  })

  it('跨实例共享标记（列表与详情一致）；空 id 不发请求', async () => {
    urgeOrderApiMock.mockResolvedValueOnce(orderResult)
    const listSide = useUrge()
    const detailSide = useUrge()

    await listSide.urge('order-5')
    expect(detailSide.isUrged('order-5')).toBe(true)

    await detailSide.urge('')
    expect(urgeOrderApiMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledTimes(1)
  })
})
