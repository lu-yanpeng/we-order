/**
 * 就餐方式 — 确认订单 / 订单记录共用枚举
 */
export type DiningMode = 'dinein' | 'takeout'

/**
 * 订单状态 — 制作中 → 待取餐 → 已完成（FR-12）
 */
export type OrderStatus = 'cooking' | 'pickup' | 'completed'

/**
 * 订单商品条目 — 下单时的商品快照
 */
export interface OrderItem {
  productId: string
  productName: string
  /** 规格摘要，如「大杯 Grande / 冰饮推荐 / 燕麦奶 / 1份浓缩」 */
  specSummary: string
  /** 单价（基础价 + 规格加价） */
  unitPrice: number
  quantity: number
}

/**
 * 订单实体（FR-11 订单列表展示）
 */
export interface Order {
  /** 订单编号，如 SG92748201 */
  id: string
  status: OrderStatus
  diningMode: DiningMode
  items: OrderItem[]
  /** 外带包装费，堂食为 0 */
  packagingFee: number
  /** 实付金额 = 商品合计 + 包装费 */
  totalPrice: number
  /** 备注偏好，「无备注要求」表示未填写 */
  notes: string
  /** 下单时间，如 2026-06-28 23:15:20 */
  createdAt: string
  /** 取杯号，待取餐状态才有 */
  pickupCode: string
}
