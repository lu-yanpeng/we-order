/**
 * 订单 API 层
 *
 * 统一数据入口，负责订单列表 / 详情的本地存储读写（AD-1）。
 * Phase 3 Epic 1：数据源仍是 Mock，但对外形状已对齐服务端契约
 * （`get_my_orders` 的 `OrdersPage` / `get_my_order_detail` 的 `OrderDetail`），
 * Epic 4 切换真实读取时只改本文件内部。
 *
 * 首次读取时将 mock/orders.ts 的预置订单写入存储作为演示数据，
 * 之后读写一律以存储为准。不做人为延迟，避免首屏空态闪烁。
 */
import type { OrderDetail, OrderListItem, OrdersPage } from '@/types/api-contracts'
import { mockOrders } from '@/mock/orders'

const STORAGE_KEY = 'weorder_orders'

function loadOrders(): OrderDetail[] {
  const raw = uni.getStorageSync(STORAGE_KEY) as string
  if (raw) return JSON.parse(raw) as OrderDetail[]

  // 首次读取：预置订单 seed 到存储（FR-11）
  saveOrders(mockOrders)
  return mockOrders
}

function saveOrders(orders: OrderDetail[]): void {
  uni.setStorageSync(STORAGE_KEY, JSON.stringify(orders))
}

/**
 * 详情快照 → 列表项：与服务端 `get_my_orders` 的条目形状一致
 * （订单对外形状 + item_summary「商品名 ×数量」、顿号连接）。
 */
function toListItem(order: OrderDetail): OrderListItem {
  // 解构只为剔除详情字段（门店快照与明细），其余字段经 rest 透传
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { store_name, store_address, store_phone, items, ...result } = order
  return {
    ...result,
    item_summary: items.map((item) => `${item.product_name} ×${item.quantity}`).join('、'),
  }
}

/** 获取本人订单列表（按时间倒序；Mock 阶段一次返回全部，next_cursor 恒为 null） */
export async function fetchOrders(): Promise<OrdersPage> {
  return {
    items: loadOrders().map(toListItem),
    next_cursor: null,
  }
}

/** 按订单 id（服务端 UUID）获取单个订单，不存在时返回 undefined */
export async function fetchOrderById(id: string): Promise<OrderDetail | undefined> {
  return loadOrders().find((order) => order.id === id)
}

/** 创建订单：插入列表顶部并写入存储（Epic 3 起改为经 pay-order 服务端建单） */
export async function createOrder(order: OrderDetail): Promise<void> {
  saveOrders([order, ...loadOrders()])
}
