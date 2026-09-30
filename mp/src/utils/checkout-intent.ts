/**
 * 结算意图（幂等键）生命周期纯函数（P3 Story 3.4；AD-10 / AR-P3-15）
 *
 * 幂等键 = 一次结算意图的编号：客户端生成、随 `pay-order` 请求原样转发，
 * 服务端唯一域 `(user_id, idempotency_key)`——同一编号重试只落一张订单。
 *
 * 生成时机（2026-09-29 设计修订）：点击「支付」、请求发出前 ensure；
 * 进入确认订单页只浏览不写入——「购物车 / 就餐方式变化即作废重建」
 * 由提交时的指纹比较自然满足（见验收记录 Story 3.4）。
 *
 * 本文件只做纯计算（生成 / 规范化序列化 / 校验 / 复用与清除决策），
 * 不碰存储、不碰 uni API；持久化出口是 `api/orders.ts`（AD-3）。
 */
import type { CreateOrderItem, DiningMode } from '@/types/api-contracts'
import type { AppError } from '@/types/errors'

/** 持久化形状：`api/orders.ts` 读写 `weorder_checkout_intent` 的 JSON 值 */
export type CheckoutIntent = {
  /** 幂等键：随请求原样转发 */
  key: string
  /** 结算意图指纹：购物车 wire 条目 + 就餐方式的规范化序列化 */
  fingerprint: string
}

/** 指纹版本：规则变化时 +1，旧指纹自然失配 → 重建（加法型演进） */
const FINGERPRINT_VERSION = 1

/** 幂等键前缀（便于在存储 / 日志里辨认） */
const KEY_PREFIX = 'co_'

/**
 * 生成幂等键。
 * 键不是凭证（身份由会话表达，服务端唯一域带 `user_id`），只要求同一用户内不撞车；
 * 小程序运行时没有 Web Crypto，用时间戳 + 两段随机（约 80 bit 熵）足够。
 */
export function generateIdempotencyKey(): string {
  const time = Date.now().toString(36)
  const randomA = Math.random().toString(36).slice(2, 10)
  const randomB = Math.random().toString(36).slice(2, 10)
  return `${KEY_PREFIX}${time}_${randomA}${randomB}`
}

/** 规格选择规范化：规格组 id 排序、多选数组排序（选择顺序不同 → 同一指纹） */
function canonicalSelections(
  selections: CreateOrderItem['selections'],
): Record<string, string | string[]> {
  const canonical: Record<string, string | string[]> = {}
  for (const groupId of Object.keys(selections).sort()) {
    const value = selections[groupId]
    canonical[groupId] = Array.isArray(value) ? [...value].sort() : value
  }
  return canonical
}

/**
 * 规范化序列化：购物车 wire 条目 + 就餐方式 → 意图指纹。
 * 只含提交会发送的字段（`product_id` / `quantity` / `selections` + `dining_mode`）：
 * 商品名 / 单价 / 规格摘要等展示字段与备注、金额都不参与——改备注不重建、展示字段变化不重建。
 * 行顺序、规格组顺序、多选顺序不影响结果（排序后序列化）。
 */
export function serializeCheckoutIntent(items: CreateOrderItem[], diningMode: DiningMode): string {
  const sortedItems = items
    .map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      selections: canonicalSelections(item.selections),
    }))
    .sort((a, b) => {
      if (a.product_id !== b.product_id) return a.product_id < b.product_id ? -1 : 1
      const aSelections = JSON.stringify(a.selections)
      const bSelections = JSON.stringify(b.selections)
      if (aSelections !== bSelections) return aSelections < bSelections ? -1 : 1
      return 0
    })
  return JSON.stringify({ v: FINGERPRINT_VERSION, dining_mode: diningMode, items: sortedItems })
}

/**
 * 校验持久化值：形状不合法（含损坏 JSON、空串）→ null。
 * 调用方把 null 当「无意图」处理并重建——坏数据永远不导致卡死；
 * 同时接受对象与 JSON 字符串（`uni.getStorageSync` 原样返回写入时的类型）。
 */
export function parseCheckoutIntent(raw: unknown): CheckoutIntent | null {
  let value = raw
  if (typeof raw === 'string') {
    if (raw === '') return null
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (value === null || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const key = record.key
  const fingerprint = record.fingerprint
  if (typeof key !== 'string' || key.trim() === '') return null
  if (typeof fingerprint !== 'string' || fingerprint === '') return null
  return { key: key.trim(), fingerprint }
}

/**
 * 复用 / 重建决策：指纹一致才复用（`reused: true`），否则生成新键。
 * 调用方在 `reused === false` 时负责持久化——「先落盘、再发请求」。
 */
export function resolveCheckoutIntent(
  stored: CheckoutIntent | null,
  fingerprint: string,
): { key: string; reused: boolean } {
  if (stored !== null && stored.fingerprint === fingerprint) {
    return { key: stored.key, reused: true }
  }
  return { key: generateIdempotencyKey(), reused: false }
}

/**
 * 清除 / 保留决策（AD-10 表）：
 * - 服务端类别（`order` 域全部，含 `not_authenticated`；`42501` 已归一为 `order.unknown`）→ 清除；
 * - `client.session_expired` → 清除；
 * - 结果不明（`timeout` / `network_unreachable` / `request_cancelled`）→ 保留，重试不换键。
 * 未列出的失败方向兜底为「保留」：多留一个键只会命中下次指纹比较，不会多下单。
 */
export function shouldClearCheckoutIntent(error: AppError): boolean {
  if (error.source === 'order') return true
  return error.source === 'client' && error.code === 'session_expired'
}

/**
 * 超时安全重试提示（Story 3.6；FR-P3-9；spine「最小 UI 规范」支付超时行）：
 * 仅 `client.timeout`——结果不明中唯一需要向用户解释「为什么可以放心再点一次」的场景，
 * 结算页据此内联「可安全重试，不会重复下单」（幂等键已保留）。
 * 网络不可达 / 取消同样保留键，但只给基础文案，不出现该提示。
 */
export function shouldShowRetryHint(error: AppError): boolean {
  return error.source === 'client' && error.code === 'timeout'
}
