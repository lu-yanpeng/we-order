/**
 * 商品实体 — 点餐核心数据模型
 */
export interface Product {
  id: string
  name: string
  desc: string
  price: number
  tags: string[]
  sales: number
  /** 规格组列表：有则弹出规格选择，无则仅显示数量步进器 */
  specGroups?: SpecGroup[]
}

/**
 * 单个规格选项（如"中杯 Tall"）
 */
export interface SpecOption {
  id: string
  label: string
  /** 该选项的加价金额，0 表示不加价 */
  priceExtra: number
}

/**
 * 一组同类规格（如"杯型"包含中杯/大杯/超大杯）
 */
export interface SpecGroup {
  id: string
  title: string
  options: SpecOption[]
  /** 是否支持多选（如加料可多选，杯型只能单选） */
  multi: boolean
}

/**
 * 商品分类
 */
export interface Category {
  id: string
  name: string
  products: Product[]
}

/**
 * 购物车条目 — 已选规格的商品实例
 */
export interface CartItem {
  productId: string
  productName: string
  productDesc: string
  basePrice: number
  selections: Record<string, string | string[]>
  quantity: number
  unitPrice: number
  specSummary: string
}
