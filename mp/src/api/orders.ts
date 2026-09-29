/**
 * 订单 API 层
 *
 * 统一数据入口，负责：
 * 1. 订单列表 / 详情的本地存储读写（Mock 过渡；Epic 4 切换真实读取时只改本文件内部）；
 * 2. 结算意图（幂等键）生命周期（Story 3.4；AD-10）——`weorder_checkout_intent` 唯一出口。
 *
 * Phase 3 Epic 1：订单数据源仍是 Mock，但对外形状已对齐服务端契约
 * （`get_my_orders` 的 `OrdersPage` / `get_my_order_detail` 的 `OrderDetail`）。
 * 首次读取时将 mock/orders.ts 的预置订单写入存储作为演示数据，
 * 之后读写一律以存储为准。不做人为延迟，避免首屏空态闪烁。
 */
import type { DiningMode, OrderDetail, OrderListItem, OrdersPage } from '@/types/api-contracts'
import type { CartItem } from '@/types/cart'
import type { CheckoutIntent } from '@/utils/checkout-intent'
import { toCreateOrderItems } from '@/api/cart'
import { mockOrders } from '@/mock/orders'
import {
  parseCheckoutIntent,
  resolveCheckoutIntent,
  serializeCheckoutIntent,
} from '@/utils/checkout-intent'

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

// ── 结算意图（幂等键）（Story 3.4；AD-10） ─────────────────────────────────
// 本地存储出口唯一在 api/orders.ts（AD-3）；生成 / 序列化 / 校验 / 决策等纯函数
// 在 utils/checkout-intent.ts，进单元测试清单。

/** 结算意图的存储 key：`{ key, fingerprint }` 的 JSON 值 */
const INTENT_STORAGE_KEY = 'weorder_checkout_intent'

/** 读取持久化意图；坏数据 / 存储异常一律按「无意图」处理（由 ensure 重建） */
function readCheckoutIntent(): CheckoutIntent | null {
  try {
    return parseCheckoutIntent(uni.getStorageSync(INTENT_STORAGE_KEY))
  } catch {
    return null
  }
}

/** 写入意图（同步）：先落盘、再发请求，杀进程后的重试才能复用同一个键 */
function writeCheckoutIntent(intent: CheckoutIntent): void {
  try {
    uni.setStorageSync(INTENT_STORAGE_KEY, JSON.stringify(intent))
  } catch {
    // 存储异常不阻断支付；本次重试会换成新键，与「意图重建」同代价
  }
}

/**
 * 提交前的意图会合（点击支付、请求发出前调用）：
 * 读持久化意图 → 指纹（购物车 wire 条目 + 就餐方式）一致则复用，
 * 否则生成新键并落盘；返回本次请求要带的幂等键。
 * 进入确认订单页只浏览不写入；购物车 / 就餐方式变化由这里的指纹比较自然作废重建。
 */
export function ensureCheckoutIntent(items: CartItem[], diningMode: DiningMode): string {
  const fingerprint = serializeCheckoutIntent(toCreateOrderItems(items), diningMode)
  const { key, reused } = resolveCheckoutIntent(readCheckoutIntent(), fingerprint)
  if (!reused) writeCheckoutIntent({ key, fingerprint })
  return key
}

/** 清除结算意图：下单成功、或请求未进写路径的明确失败（决策见 `shouldClearCheckoutIntent`） */
export function clearCheckoutIntent(): void {
  try {
    uni.removeStorageSync(INTENT_STORAGE_KEY)
  } catch {
    // 存储异常不阻断支付：残留键由下次提交的指纹比较决定复用或重建
  }
}
