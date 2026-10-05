/**
 * 「再来一单」快照还原纯函数单元测试（P3 Story 4.2；FR-P3-11 / AD-15）
 *
 * 覆盖：
 * 1. 有效行：按当前目录价（基础价 + 规格加价）与当前标签重建，快照价 / 旧名被忽略；
 * 2. 失效行丢弃：商品下架（不在 menu）、规格组 / 选项已变更、快照带多余规格 key、
 *    无规格商品残留旧选择、多选类型不符，并计入 droppedCount；
 * 3. 售罄（sold_out）商品保留（支付时由服务端拒绝，本阶段不置灰）；
 * 4. 混合场景与空快照。
 */
import { describe, expect, it } from 'vitest'
import type { MenuCategory, OrderDetailItem } from '@/types/api-contracts'
import { buildReorderItems } from './reorder'

/** 当前目录：拿铁（size 单选 + addons 多选）、美式（无规格、售罄） */
const categories: MenuCategory[] = [
  {
    id: 'cat-coffee',
    name: '咖啡',
    products: [
      {
        id: 'latte',
        name: '拿铁（当前名）',
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
          {
            id: 'addons',
            title: '加料',
            multi: true,
            options: [
              { id: 'shot', label: '加浓缩', price_extra: 4 },
              { id: 'syrup', label: '加糖浆', price_extra: 2 },
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
        availability: 'sold_out',
        image_path: null,
        spec_groups: [],
      },
    ],
  },
]

/** 快照明细行（默认拿铁大杯，可覆盖字段构造失效场景） */
function snapshotItem(overrides: Partial<OrderDetailItem> = {}): OrderDetailItem {
  return {
    product_id: 'latte',
    product_name: '拿铁（旧名）',
    spec_summary: '旧规格摘要',
    selections: { size: 'grande', addons: ['shot'] },
    unit_price: 99,
    quantity: 2,
    image_path: null,
    ...overrides,
  }
}

describe('buildReorderItems（Story 4.2）', () => {
  it('有效行按当前目录价与当前标签重建：快照价 / 旧名 / 旧摘要被忽略', () => {
    const { items, droppedCount } = buildReorderItems([snapshotItem()], categories)

    expect(droppedCount).toBe(0)
    expect(items).toEqual([
      {
        productId: 'latte',
        productName: '拿铁（当前名）',
        selections: { size: 'grande', addons: ['shot'] },
        quantity: 2,
        // 当前价 30 + 大杯 3 + 加浓缩 4 = 37（快照 99 不参与计价）
        unitPrice: 37,
        specSummary: '大杯 Grande / 加浓缩',
      },
    ])
  })

  it('selections 返回防御性拷贝：修改结果不影响快照', () => {
    const snapshot = snapshotItem()
    const { items } = buildReorderItems([snapshot], categories)

    const restored = items[0].selections as { addons: string[] }
    restored.addons.push('syrup')
    expect(snapshot.selections.addons).toEqual(['shot'])
  })

  it('商品不在当前 menu（已下架 / 已删除）→ 丢弃', () => {
    const { items, droppedCount } = buildReorderItems(
      [snapshotItem({ product_id: 'delisted-product' })],
      categories,
    )

    expect(items).toEqual([])
    expect(droppedCount).toBe(1)
  })

  it('规格选项已变更（旧选项 id 不存在）→ 丢弃', () => {
    const { items, droppedCount } = buildReorderItems(
      [snapshotItem({ selections: { size: 'venti', addons: [] } })],
      categories,
    )

    expect(items).toEqual([])
    expect(droppedCount).toBe(1)
  })

  it('快照缺少当前规格组的选择 → 丢弃', () => {
    const { items, droppedCount } = buildReorderItems(
      [snapshotItem({ selections: { size: 'grande' } })],
      categories,
    )

    expect(items).toEqual([])
    expect(droppedCount).toBe(1)
  })

  it('快照带当前不存在的规格组 key → 丢弃', () => {
    const { items, droppedCount } = buildReorderItems(
      [snapshotItem({ selections: { size: 'grande', addons: [], legacy: 'x' } })],
      categories,
    )

    expect(items).toEqual([])
    expect(droppedCount).toBe(1)
  })

  it('多选值类型不符（字符串而非数组）→ 丢弃', () => {
    const { items, droppedCount } = buildReorderItems(
      [snapshotItem({ selections: { size: 'grande', addons: 'shot' } })],
      categories,
    )

    expect(items).toEqual([])
    expect(droppedCount).toBe(1)
  })

  it('无规格商品：残留旧规格选择 → 丢弃；空 selections → 保留（售罄不丢）', () => {
    const stale = snapshotItem({
      product_id: 'americano',
      product_name: '美式（旧名）',
      selections: { size: 'grande' },
      unit_price: 18,
      quantity: 1,
    })
    const soldOut = snapshotItem({
      product_id: 'americano',
      product_name: '美式（旧名）',
      spec_summary: '',
      selections: {},
      unit_price: 18,
      quantity: 1,
    })

    const staleResult = buildReorderItems([stale], categories)
    expect(staleResult.items).toEqual([])
    expect(staleResult.droppedCount).toBe(1)

    const soldOutResult = buildReorderItems([soldOut], categories)
    expect(soldOutResult.droppedCount).toBe(0)
    expect(soldOutResult.items).toEqual([
      {
        productId: 'americano',
        productName: '美式',
        selections: {},
        quantity: 1,
        unitPrice: 22,
        specSummary: '',
      },
    ])
  })

  it('混合场景：有效行保留、失效行丢弃并计数', () => {
    const { items, droppedCount } = buildReorderItems(
      [
        snapshotItem(),
        snapshotItem({ product_id: 'delisted-product' }),
        snapshotItem({ product_id: 'americano', selections: { size: 'grande' } }),
      ],
      categories,
    )

    expect(items.map((item) => item.productId)).toEqual(['latte'])
    expect(droppedCount).toBe(2)
  })

  it('空快照 / 空目录：不产出条目、不误判丢弃', () => {
    expect(buildReorderItems([], categories)).toEqual({ items: [], droppedCount: 0 })
    expect(buildReorderItems([snapshotItem()], [])).toEqual({ items: [], droppedCount: 1 })
  })
})
