/**
 * 订单 API 层
 *
 * 统一数据入口，负责：
 * 1. 订单列表：经服务端读取路径 `get_my_orders`（Story 4.1；读时推进、游标分页、
 *    只含本人订单）——本地 `weorder_orders` 不再是任何读取的数据源，也不再 seed Mock 订单；
 * 2. 下单：经支付接口 `pay-order` 一次完成「模拟支付 → 创建订单」（Story 3.5；AD-11）——
 *    客户端创建订单的唯一入口，金额 / 订单号 / 取杯号 / 归属全部由服务端产出；
 * 3. 订单详情：经服务端读取路径 `get_my_order_detail`（Story 4.2；读时推进、只含本人订单，
 *    非本人 / 不存在同一类别 `order_not_found`，不泄露订单存在性）；
 * 4. 催单：经服务端 `urge_order`（Story 4.4）——只提前推进时刻、不直接改状态；
 * 5. 确认取餐：经服务端 `complete_order`（Story 4.5；FR-P3-14）——把本人「待取餐」订单置为
 *    「已完成」，重复确认幂等（返回成功且不改完成时间）；超时自动完成由服务端兜底；
 * 6. 结算意图（幂等键）生命周期（Story 3.4；AD-10）——`weorder_checkout_intent` 唯一出口。
 *
 * 订单侧 Mock 数据源（`mock/orders.ts`）已随 Story 4.2 删除；本文件不存在任何
 * Mock 读写路径或回退开关，读取只有服务端一条通路（FR-P3-3 整体收口）。
 */
import { transport } from '@/core/transport'
import type {
  CreateOrderRequest,
  DiningMode,
  OrderDetail,
  OrderResult,
  OrdersPage,
} from '@/types/api-contracts'
import type { CartItem } from '@/types/cart'
import type { CheckoutIntent } from '@/utils/checkout-intent'
import { toCreateOrderItems } from '@/api/cart'
import {
  parseCheckoutIntent,
  resolveCheckoutIntent,
  serializeCheckoutIntent,
} from '@/utils/checkout-intent'

/** 订单列表每页条数（服务端默认 20、上限 50；分页信封形状见 `OrdersPage`，P2 AD-23） */
const ORDERS_PAGE_SIZE = 20

// ── 订单读取（Story 4.1；AD-7 / AD-8） ─────────────────────────────────────

/**
 * 读取一页本人订单（创建时间倒序；服务端先推进到点 / 超时订单再返回，FR-P3-10）。
 *
 * - 游标分页：首次读取不传游标；下一页把上一页返回的 `next_cursor` 原样回传
 *   （键集游标，客户端不解析、不拼接，P2 AD-22）；
 * - `session-required`：经对接层先会合登录 / 续期，401 时自动续期并重放一次（AD-3 / AD-4）；
 * - 归属不可伪造：请求参数里没有用户标识，身份取自服务端会话（FR-P3-10）。
 *
 * 返回 alova Method：可 `await`，也可用 `useRequest` 包裹（AD-5）。
 */
export function fetchOrders(cursor: OrdersPage['next_cursor'] = null) {
  return transport.Post<OrdersPage>(
    '/rest/v1/rpc/get_my_orders',
    {
      p_limit: ORDERS_PAGE_SIZE,
      p_before_created_at: cursor?.created_at ?? null,
      p_before_id: cursor?.id ?? null,
    },
    { meta: { auth: 'session-required' } },
  )
}

/**
 * 按订单 id（服务端 UUID）读取详情（`get_my_order_detail`，Story 4.2）。
 *
 * - `session-required`：先会合登录 / 续期，401 时自动续期并重放一次（AD-3 / AD-4）；
 * - 归属不可伪造：请求参数只有订单 id，身份与服务端归属谓词同源（FR-P3-11）；
 * - 非本人订单与不存在的订单返回同一类别 `order_not_found`（AD-13，不泄露存在性）；
 * - 服务端读取前先推进本人到点 / 超时订单，返回详情不会「已到点却仍制作中」；
 * - 返回服务端快照（商品、规格摘要、金额、门店信息、取杯号），不随目录改名 / 改价变化。
 *
 * 返回 alova Method：可 `await`，也可用 `useRequest` 包裹（AD-5）。
 */
export function fetchOrderById(id: string) {
  return transport.Post<OrderDetail>(
    '/rest/v1/rpc/get_my_order_detail',
    { p_order_id: id },
    { meta: { auth: 'session-required' } },
  )
}

/**
 * 提交支付并创建订单（Story 3.5；AD-10 / AD-11）
 *
 * `pay-order` 是客户端创建订单的唯一入口，身份与金额由服务端产出：
 * - 经对接层声明 `session-required`：先会合登录 / 续期，401 时自动续期并重放一次；
 * - 幂等键由调用方经 `ensureCheckoutIntent()` 在提交前同步落盘后传入，本方法原样转发；
 * - 请求体只含 `items` / `dining_mode` / `notes` / `idempotency_key`（`CreateOrderRequest`），
 *   不含展示字段与任何金额字段；响应即订单对外形状（`OrderResult`）。
 */
export function payOrder(request: CreateOrderRequest) {
  return transport.Post<OrderResult>('/functions/v1/pay-order', request, {
    meta: { auth: 'session-required' },
  })
}

// ── 订单操作：催单（Story 4.4；FR-P3-13） ───────────────────────────────────

/**
 * 催单（`urge_order` RPC）：把本人「制作中」订单的推进时刻提前到
 * `min(原定时刻, 服务端时钟 + 门店配置的催单提前量)`。
 *
 * - `session-required`：先会合登录 / 续期，401 时自动续期并重放一次（AD-3 / AD-4）；
 * - 请求体只有订单 id，身份与服务端归属谓词同源（归属不可伪造）；
 * - 非本人 / 不存在返回同一类别 `order_not_found`，本人非「制作中」返回 `invalid_status`
 *   （AD-13，不泄露存在性）；失败经对接层归一为 `AppError`，文案走 `utils/error-copy.ts`；
 * - 服务端本身幂等（重复调用不报错、不会更早也不会更晚）；客户端「已催单」标记只约束
 *   本端不重复发送（运行期记忆，不落本地存储；Story 4.4 交互设计）。
 *
 * 返回 alova Method：可 `await`，也可用 `useRequest` 包裹（AD-5）。
 */
export function urgeOrder(orderId: string) {
  return transport.Post<OrderResult>(
    '/rest/v1/rpc/urge_order',
    { p_order_id: orderId },
    { meta: { auth: 'session-required' } },
  )
}

// ── 订单操作：确认取餐（Story 4.5；FR-P3-14） ───────────────────────────────

/**
 * 确认取餐（`complete_order` RPC）：把本人「待取餐」的订单置为「已完成」，
 * 完成时间由服务端记录；与超时自动完成共用同一处状态迁移实现。
 *
 * - `session-required`：先会合登录 / 续期，401 时自动续期并重放一次（AD-3 / AD-4）；
 * - 请求体只有订单 id，身份与服务端归属谓词同源（归属不可伪造）；
 * - 重复确认幂等：已完成（含已由超时自动完成）再确认返回成功且不改写完成时间；
 *   非本人 / 不存在返回同一类别 `order_not_found`；本人非「待取餐」返回 `invalid_status`
 *   （AD-13，不泄露存在性）；失败经对接层归一为 `AppError`，文案走 `utils/error-copy.ts`；
 * - 返回值即完成后的订单对外形状；客户端展示仍经读取路径刷新（AD-7：状态的唯一来源是
 *   服务端读取——由调用方的「操作后读取」完成，本方法不直接写 UI 状态）。
 *
 * 返回 alova Method：可 `await`，也可用 `useRequest` 包裹（AD-5）。
 */
export function completeOrder(orderId: string) {
  return transport.Post<OrderResult>(
    '/rest/v1/rpc/complete_order',
    { p_order_id: orderId },
    { meta: { auth: 'session-required' } },
  )
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
