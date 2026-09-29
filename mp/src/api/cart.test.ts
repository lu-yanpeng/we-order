/**
 * 购物车唯一转换器单元测试（P3 Story 3.4；AD-10 / AR-P3-15）
 *
 * `toCreateOrderItems()` 是 `CartItem[] → CreateOrderItem[]`（wire 形状）的唯一实现：
 * 只保留服务端认识的字段，展示字段与金额不进请求。
 */
import { describe, expect, it } from 'vitest'
import type { CartItem } from '@/types/cart'
import { toCreateOrderItems } from './cart'

const cartItem: CartItem = {
  productId: 'p-1',
  productName: '拿铁',
  selections: { size: 'grande', addons: ['milk'] },
  quantity: 2,
  unitPrice: 32,
  specSummary: '大杯 / 燕麦奶',
}

describe('toCreateOrderItems（唯一转换器）', () => {
  it('只保留 wire 字段：product_id / quantity / selections', () => {
    expect(toCreateOrderItems([cartItem])).toEqual([
      { product_id: 'p-1', quantity: 2, selections: { size: 'grande', addons: ['milk'] } },
    ])
  })

  it('空购物车 → 空数组', () => {
    expect(toCreateOrderItems([])).toEqual([])
  })

  it('selections 不与购物车条目不共享引用（不把 store 状态交给请求层）', () => {
    const [wire] = toCreateOrderItems([cartItem])
    expect(wire.selections).not.toBe(cartItem.selections)
    expect(wire.selections).toEqual(cartItem.selections)
  })
})
