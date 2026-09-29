/**
 * 购物车 API 层
 *
 * 职责：
 * 1. 购物车的 localStorage 持久化读写（`weorder_cart` 唯一出口）；
 * 2. 唯一转换器 `toCreateOrderItems()`：购物车视图条目 → 下单 wire 条目（AD-10）。
 *
 * 遵循 AD-1：外部数据源读写经由 API 层统一入口。
 */
import type { CreateOrderItem } from '@/types/api-contracts'
import type { CartItem } from '@/types/cart'

const STORAGE_KEY = 'weorder_cart'

export function loadCartString(): string | null {
  try {
    return uni.getStorageSync(STORAGE_KEY) as string | null
  } catch {
    return null
  }
}

export function saveCartString(raw: string): void {
  try {
    uni.setStorageSync(STORAGE_KEY, raw)
  } catch {
    // localStorage 写入失败时静默忽略
  }
}

/**
 * 唯一转换器（AD-10 / AR-P3-15）：`CartItem[] → CreateOrderItem[]`（wire 形状）。
 * 结算与「再来一单」共用，禁止在调用点展开购物车条目直传：
 * 只保留服务端认识的 `product_id` / `quantity` / `selections`，
 * 展示字段（商品名 / 规格摘要 / 单价）与金额一律不进请求。
 */
export function toCreateOrderItems(items: CartItem[]): CreateOrderItem[] {
  return items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    selections: { ...item.selections },
  }))
}
