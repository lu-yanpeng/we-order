/**
 * 订单 Mock 数据
 *
 * 5 条预置订单覆盖三种状态（FR-11）：
 *   - SG92748201 制作中（店内堂食，¥48，备注「多冰」）
 *   - SG10023942 待取餐（打包外带，¥44 = 商品 ¥42 + 包装费 ¥2，取杯号 A-08）
 *   - SG10023940 已完成（店内堂食，¥27）
 *   - SG10023938 已完成（打包外带，¥82 = 商品 ¥80 + 包装费 ¥2）
 *   - SG10023936 已完成（店内堂食，¥39）
 *
 * 前 3 条的商品名 / 编号 / 金额 / 时间 / 备注 沿用 HTML 原型（docs/starbucks-ordering-program-8.html），
 * 规格摘要文案使用项目自身规格标签，与 utils/price.ts 的 buildSpecSummary 输出格式一致。
 * 注：前 3 条商品 id 沿用原型的 p3/p6/p4，与 mock/products.ts 的商品目录不一一对应；
 * 后 2 条为补充的已完成订单（原型只有 3 条），商品取自 mock/products.ts 目录，用于订单列表滚动测试。
 */
import type { Order } from '@/types/order'

export const mockOrders: Order[] = [
  {
    id: 'SG92748201',
    status: 'cooking',
    diningMode: 'dinein',
    items: [
      {
        productId: 'p3',
        productName: '春日限定樱花拿铁',
        specSummary: '超大杯 Venti / 冰饮推荐 / 燕麦奶 / 2份浓缩 / 焦糖淋酱',
        unitPrice: 48,
        quantity: 1,
      },
    ],
    packagingFee: 0,
    totalPrice: 48,
    notes: '多冰',
    createdAt: '2026-06-28 23:15:20',
    pickupCode: '',
  },
  {
    id: 'SG10023942',
    status: 'pickup',
    diningMode: 'takeout',
    items: [
      {
        productId: 'p6',
        productName: '抹茶星冰乐',
        specSummary: '大杯 Grande / 冰饮推荐 / 燕麦奶 / 1份浓缩 / 可可碎片',
        unitPrice: 42,
        quantity: 1,
      },
    ],
    packagingFee: 2,
    totalPrice: 44,
    notes: '常温，去稀奶油',
    createdAt: '2026-06-28 22:58:14',
    pickupCode: 'A-08',
  },
  {
    id: 'SG10023940',
    status: 'completed',
    diningMode: 'dinein',
    items: [
      {
        productId: 'p4',
        productName: '美式咖啡',
        specSummary: '中杯 Tall / 冰饮推荐 / 全脂牛奶 / 1份浓缩',
        unitPrice: 27,
        quantity: 1,
      },
    ],
    packagingFee: 0,
    totalPrice: 27,
    notes: '无备注要求',
    createdAt: '2026-06-28 21:10:05',
    pickupCode: 'A-02',
  },
  {
    id: 'SG10023938',
    status: 'completed',
    diningMode: 'takeout',
    items: [
      {
        productId: 'prod-005',
        productName: '焦糖玛奇朵',
        specSummary: '大杯 Grande / 热饮 / 燕麦奶 / 2份浓缩',
        unitPrice: 40,
        quantity: 2,
      },
    ],
    packagingFee: 2,
    totalPrice: 82,
    notes: '不用吸管',
    createdAt: '2026-06-28 19:42:11',
    pickupCode: 'A-31',
  },
  {
    id: 'SG10023936',
    status: 'completed',
    diningMode: 'dinein',
    items: [
      {
        productId: 'prod-008',
        productName: '冷萃冰咖啡',
        specSummary: '大杯 Grande / 冰饮推荐 / 少冰',
        unitPrice: 39,
        quantity: 1,
      },
    ],
    packagingFee: 0,
    totalPrice: 39,
    notes: '无备注要求',
    createdAt: '2026-06-28 12:36:48',
    pickupCode: 'A-27',
  },
]
