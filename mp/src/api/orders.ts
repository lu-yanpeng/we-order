/**
 * 订单 API 层
 *
 * 统一数据入口，负责加载订单列表（AD-1）。
 * Phase 1 使用 Mock 数据；静态页面阶段不做人为延迟，避免首屏空态闪烁。
 */
import type { Order } from '@/types/order'
import { mockOrders } from '@/mock/orders'

/**
 * 获取订单列表（按时间倒序）
 */
export async function fetchOrders(): Promise<Order[]> {
  return mockOrders
}
