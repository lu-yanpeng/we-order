/**
 * 购物车条目 —— 纯本地类型
 *
 * 购物车不上云（P3 明确非目标），条目只在本地存储 `weorder_cart` 与 Pinia 之间流转，
 * 因此保持客户端视图形状（camelCase），不是服务端 wire 形状。
 *
 * 与后端契约的接缝只有一处：提交下单时由 `api/cart.ts` 的唯一转换器
 * `toCreateOrderItems()` 转成 `CreateOrderItem[]`（P3 AD-10）。
 */
import type { SpecSelections } from '@/types/api-contracts'

export interface CartItem {
  productId: string
  productName: string
  /** 规格选择：与 `SpecSelections` 同一形状（规格组 id → 选项 id / 选项 id 数组） */
  selections: SpecSelections
  quantity: number
  unitPrice: number
  specSummary: string
}
