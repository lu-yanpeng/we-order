/**
 * 再来一单编排单元测试（P3 Story 4.2；FR-P3-11 / FR-P3-19）
 *
 * mock API 层（详情 / 目录）、购物车写入口与结算栏命令，不发起真实网络请求：
 * 1. 有效行整车替换 + 切点餐 tab + 展开面板（列表卡先取详情、详情页直接返回）；
 * 2. 部分失效：只写有效条目 + toast「部分商品已失效」（面板就绪后提示）；
 * 3. 全部失效：不动购物车、不跳转、不展开面板；
 * 4. 详情 / 目录读取失败：errorCopy toast，购物车与界面不脏；
 * 5. 重复点击守卫。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MenuCategory,
  OrderDetail,
  OrderDetailItem,
  OrderListItem,
} from '@/types/api-contracts'

const {
  fetchOrderByIdMock,
  fetchCategoriesMock,
  setItemsMock,
  openCartDetailMock,
  emitMock,
  toastMock,
  navigateBackMock,
  getCurrentPagesMock,
} = vi.hoisted(() => ({
  fetchOrderByIdMock: vi.fn(),
  fetchCategoriesMock: vi.fn(),
  setItemsMock: vi.fn(),
  openCartDetailMock: vi.fn(),
  emitMock: vi.fn(),
  toastMock: vi.fn(),
  navigateBackMock: vi.fn(),
  getCurrentPagesMock: vi.fn(),
}))

vi.mock('@/api/orders', () => ({
  fetchOrderById: fetchOrderByIdMock,
  // Story 5.1 被动接线：订阅入口（返回空句柄；订阅行为由 core/realtime 单测覆盖）
  subscribeOrders: () => ({ unsubscribe: vi.fn(), onStatus: () => () => {} }),
}))
vi.mock('@/api/catalog', () => ({
  fetchCategories: fetchCategoriesMock,
}))
vi.mock('@/composables/use-cart', () => ({
  useCart: () => ({ items: [], setItems: setItemsMock }),
}))
vi.mock('@/composables/use-checkout-bar', () => ({
  useCheckoutBar: () => ({ openCartDetail: openCartDetailMock }),
}))

import { useReorder } from './use-reorder'
import { HOME_TAB_SWITCH_EVENT } from '@/composables/use-home-tabs'

/** 当前目录：拿铁（size 单选）、美式（无规格） */
const categories: MenuCategory[] = [
  {
    id: 'cat-coffee',
    name: '咖啡',
    products: [
      {
        id: 'latte',
        name: '拿铁',
        description: '浓缩与牛奶',
        price: 30,
        tags: [],
        sales: 0,
        availability: 'on_sale',
        image_path: 'latte.jpg',
        spec_groups: [
          {
            id: 'size',
            title: '杯型',
            multi: false,
            options: [
              { id: 'tall', label: '中杯 Tall', price_extra: 0 },
              { id: 'grande', label: '大杯 Grande', price_extra: 3 },
            ],
          },
        ],
      },
      {
        id: 'americano',
        name: '美式',
        description: '纯咖啡',
        price: 22,
        tags: [],
        sales: 0,
        availability: 'on_sale',
        image_path: null,
        spec_groups: [],
      },
    ],
  },
]

/** 有效快照行：拿铁大杯 */
const validItem: OrderDetailItem = {
  product_id: 'latte',
  product_name: '拿铁（旧名）',
  spec_summary: '旧摘要',
  selections: { size: 'grande' },
  unit_price: 99,
  quantity: 2,
  image_path: null,
}

/** 失效快照行：商品不在当前目录（已下架） */
const delistedItem: OrderDetailItem = {
  ...validItem,
  product_id: 'delisted-product',
}

/** 服务端详情（items 可覆盖以构造失效场景） */
function detailOf(items: OrderDetailItem[]): OrderDetail {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    order_number: '202609301200000001',
    status: 'completed',
    dining_mode: 'dinein',
    packaging_fee: 0,
    total_amount: 74,
    notes: '无备注要求',
    pickup_code: 'A-0001',
    created_at: '2026-09-30 12:00:00',
    store_name: '星巴克 啡快自提店',
    store_address: '北京市朝阳区创意产业园 A 座 1 层',
    store_phone: '010-88888888',
    items,
  }
}

/** 列表卡条目（只有图片行，没有明细） */
const listItem: OrderListItem = {
  id: '22222222-2222-4222-8222-222222222222',
  order_number: '202609301200000001',
  status: 'completed',
  dining_mode: 'dinein',
  packaging_fee: 0,
  total_amount: 74,
  notes: '无备注要求',
  pickup_code: 'A-0001',
  created_at: '2026-09-30 12:00:00',
  item_images: [{ image_path: 'products/latte.png' }],
}

/** 还原后的购物车条目：当前价 30 + 大杯 3 = 33 */
const restoredLatte = {
  productId: 'latte',
  productName: '拿铁',
  selections: { size: 'grande' },
  quantity: 2,
  unitPrice: 33,
  specSummary: '大杯 Grande',
}

beforeEach(() => {
  fetchOrderByIdMock.mockReset()
  fetchCategoriesMock.mockReset().mockResolvedValue(categories)
  setItemsMock.mockReset()
  openCartDetailMock.mockReset().mockResolvedValue(undefined)
  emitMock.mockReset()
  toastMock.mockReset()
  navigateBackMock.mockReset().mockImplementation((options?: { success?: () => void }) => {
    options?.success?.()
  })
  getCurrentPagesMock.mockReset().mockReturnValue([{ route: 'pages/home/index' }])
  vi.stubGlobal('uni', {
    showToast: toastMock,
    $emit: emitMock,
    navigateBack: navigateBackMock,
  })
  // 微信平台全局函数（use-reorder 的 isHomePage 直接调用）
  vi.stubGlobal('getCurrentPages', getCurrentPagesMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useReorder 编排（Story 4.2）', () => {
  it('列表卡触发：先按 id 取详情，全部有效 → 整车替换 + 切点餐 tab + 展开面板，无 toast', async () => {
    fetchOrderByIdMock.mockResolvedValueOnce(detailOf([validItem]))
    const { reorder } = useReorder()

    await reorder(listItem)

    expect(fetchOrderByIdMock).toHaveBeenCalledWith(listItem.id)
    expect(setItemsMock).toHaveBeenCalledWith([restoredLatte])
    expect(emitMock).toHaveBeenCalledWith(HOME_TAB_SWITCH_EVENT, 'menu')
    expect(openCartDetailMock).toHaveBeenCalledTimes(1)
    expect(toastMock).not.toHaveBeenCalled()
    expect(navigateBackMock).not.toHaveBeenCalled()
  })

  it('详情页触发 + 部分失效：返回首页、面板就绪后才 toast「部分商品已失效」', async () => {
    getCurrentPagesMock.mockReturnValue([{ route: 'sub-order-detail/order-detail/index' }])
    const { reorder } = useReorder()

    await reorder(detailOf([validItem, delistedItem]))

    expect(fetchOrderByIdMock).not.toHaveBeenCalled()
    expect(setItemsMock).toHaveBeenCalledWith([restoredLatte])
    expect(navigateBackMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({ title: '部分商品已失效', icon: 'none' })
    // 提示在返回与面板就绪之后：toast 的调用顺序晚于 navigateBack / openCartDetail
    expect(toastMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      navigateBackMock.mock.invocationCallOrder[0],
    )
    expect(toastMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      openCartDetailMock.mock.invocationCallOrder[0],
    )
  })

  it('全部失效：toast + 不替换购物车、不跳转、不展开面板', async () => {
    const { reorder } = useReorder()

    await reorder(detailOf([delistedItem]))

    expect(setItemsMock).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
    expect(openCartDetailMock).not.toHaveBeenCalled()
    expect(navigateBackMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith({ title: '部分商品已失效', icon: 'none' })
  })

  it('详情读取失败（列表卡场景）：toast 类别文案、购物车不变', async () => {
    fetchOrderByIdMock.mockRejectedValueOnce({ source: 'client', code: 'network_unreachable' })
    const { reorder } = useReorder()

    await reorder(listItem)

    expect(fetchCategoriesMock).not.toHaveBeenCalled()
    expect(setItemsMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith({
      title: '网络不可用，请检查网络后重试',
      icon: 'none',
    })
  })

  it('目录读取失败：toast 类别文案、购物车不变（不落到快照价兜底）', async () => {
    fetchCategoriesMock.mockRejectedValueOnce({ source: 'client', code: 'timeout' })
    const { reorder } = useReorder()

    await reorder(detailOf([validItem]))

    expect(setItemsMock).not.toHaveBeenCalled()
    expect(openCartDetailMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith({ title: '请求超时，请重试', icon: 'none' })
  })

  it('非 AppError（程序缺陷）失败：用场景兜底文案 toast，购物车不变（Story 4.6）', async () => {
    fetchOrderByIdMock.mockRejectedValueOnce(new Error('boom'))
    const { reorder } = useReorder()

    await reorder(listItem)

    expect(setItemsMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith({ title: '操作失败，请重试', icon: 'none' })
  })

  it('重复点击守卫：在飞期间第二次调用不发请求、不重复写购物车', async () => {
    let resolveDetail: (value: OrderDetail) => void = () => {}
    fetchOrderByIdMock.mockImplementationOnce(
      () =>
        new Promise<OrderDetail>((resolve) => {
          resolveDetail = resolve
        }),
    )
    const { reorder } = useReorder()

    const first = reorder(listItem)
    await reorder(listItem)
    expect(fetchOrderByIdMock).toHaveBeenCalledTimes(1)
    expect(setItemsMock).not.toHaveBeenCalled()

    resolveDetail(detailOf([validItem]))
    await first
    expect(setItemsMock).toHaveBeenCalledTimes(1)
  })
})
