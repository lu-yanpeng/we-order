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
 * 数据形状 = 服务端 `public.get_my_order_detail()` 的返回（`OrderDetail`，见 types/api-contracts.ts）：
 * `id` 是服务端 UUID（列表 key / 跳转用）、`order_number` 是展示编号；取杯号下单即分配、恒有值
 * （制作中的单也已带号，只是 Phase 1 界面暂只在「待取餐」展示）。
 * 仅存续到 Epic 4 订单切换真实数据前（ADR 允许临时 Mock）。
 *
 * 前 3 条的商品名 / 编号 / 金额 / 时间 / 备注 沿用 HTML 原型（docs/starbucks-ordering-program-8.html），
 * 规格摘要文案使用项目自身规格标签，与 utils/price.ts 的 buildSpecSummary 输出格式一致。
 * 注：前 3 条商品 id 沿用原型的 p3/p6/p4，与 mock/products.ts 的商品目录不一一对应；
 * 后 2 条为补充的已完成订单（原型只有 3 条），商品取自 mock/products.ts 目录，用于订单列表滚动测试。
 * selections 为规格选项快照（选项 id 取自 mock/products.ts 的规格组），用于再来一单还原同一 SKU（FR-14）。
 */
import type { OrderDetail } from '@/types/api-contracts'
import { mockStore } from '@/mock/store'

function storeSnapshot() {
  return {
    store_name: mockStore.name,
    store_address: mockStore.address,
    store_phone: mockStore.phone,
  }
}

export const mockOrders: OrderDetail[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    order_number: 'SG92748201',
    status: 'cooking',
    dining_mode: 'dinein',
    packaging_fee: 0,
    total_amount: 48,
    notes: '多冰',
    pickup_code: 'A-12',
    created_at: '2026-06-28 23:15:20',
    ...storeSnapshot(),
    items: [
      {
        product_id: 'p3',
        product_name: '春日限定樱花拿铁',
        spec_summary: '超大杯 Venti / 冰饮推荐 / 燕麦奶 / 2份浓缩 / 焦糖淋酱',
        selections: { size: 'venti', temp: 'ice', milk: 'oat', addons: ['caramel'] },
        unit_price: 48,
        quantity: 1,
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    order_number: 'SG10023942',
    status: 'pickup',
    dining_mode: 'takeout',
    packaging_fee: 2,
    total_amount: 44,
    notes: '常温，去稀奶油',
    pickup_code: 'A-08',
    created_at: '2026-06-28 22:58:14',
    ...storeSnapshot(),
    items: [
      {
        product_id: 'p6',
        product_name: '抹茶星冰乐',
        spec_summary: '大杯 Grande / 冰饮推荐 / 燕麦奶 / 1份浓缩 / 可可碎片',
        selections: { size: 'grande', temp: 'ice', milk: 'oat', addons: ['chips'] },
        unit_price: 42,
        quantity: 1,
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    order_number: 'SG10023940',
    status: 'completed',
    dining_mode: 'dinein',
    packaging_fee: 0,
    total_amount: 27,
    notes: '无备注要求',
    pickup_code: 'A-02',
    created_at: '2026-06-28 21:10:05',
    ...storeSnapshot(),
    items: [
      {
        product_id: 'p4',
        product_name: '美式咖啡',
        spec_summary: '中杯 Tall / 冰饮推荐 / 全脂牛奶 / 1份浓缩',
        selections: { size: 'tall', temp: 'ice', milk: 'whole' },
        unit_price: 27,
        quantity: 1,
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    order_number: 'SG10023938',
    status: 'completed',
    dining_mode: 'takeout',
    packaging_fee: 2,
    total_amount: 82,
    notes: '不用吸管',
    pickup_code: 'A-31',
    created_at: '2026-06-28 19:42:11',
    ...storeSnapshot(),
    items: [
      {
        product_id: 'prod-005',
        product_name: '焦糖玛奇朵',
        spec_summary: '大杯 Grande / 热饮 / 燕麦奶 / 2份浓缩',
        selections: { size: 'grande', temp: 'hot', milk: 'oat' },
        unit_price: 40,
        quantity: 2,
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    order_number: 'SG10023936',
    status: 'completed',
    dining_mode: 'dinein',
    packaging_fee: 0,
    total_amount: 39,
    notes: '无备注要求',
    pickup_code: 'A-27',
    created_at: '2026-06-28 12:36:48',
    ...storeSnapshot(),
    items: [
      {
        product_id: 'prod-008',
        product_name: '冷萃冰咖啡',
        spec_summary: '大杯 Grande / 冰饮推荐 / 少冰',
        selections: { size: 'grande', temp: 'ice', ice_level: 'less_ice' },
        unit_price: 39,
        quantity: 1,
      },
    ],
  },
]
