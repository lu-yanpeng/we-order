/**
 * 订单 API 层
 *
 * 统一数据入口，负责订单列表的 localStorage 读写（AD-1）。
 * 首次读取时将 mock/orders.ts 的预置订单写入存储作为演示数据，
 * 之后读写一律以存储为准（Phase 2 对接 Supabase 后整体替换）。
 * 不做人为延迟，避免首屏空态闪烁。
 */
import type { Order } from '@/types/order'
import { mockOrders } from '@/mock/orders'

const STORAGE_KEY = 'weorder_orders'

function loadOrders(): Order[] {
  const raw = uni.getStorageSync(STORAGE_KEY) as string
  if (raw) return JSON.parse(raw) as Order[]

  // 首次读取：预置订单 seed 到存储（FR-11）
  saveOrders(mockOrders)
  return mockOrders
}

function saveOrders(orders: Order[]): void {
  uni.setStorageSync(STORAGE_KEY, JSON.stringify(orders))
}

/** 获取订单列表（按时间倒序） */
export async function fetchOrders(): Promise<Order[]> {
  return loadOrders()
}

/** 按订单编号获取单个订单，不存在时返回 undefined */
export async function fetchOrderById(id: string): Promise<Order | undefined> {
  return loadOrders().find((order) => order.id === id)
}

/** 创建订单：插入列表顶部并写入存储 */
export async function createOrder(order: Order): Promise<void> {
  saveOrders([order, ...loadOrders()])
}
