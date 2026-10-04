/**
 * 订单状态应用纯函数（P3 Story 4.3；AD-7 / AR-P3-11）
 *
 * 状态应用单调的唯一实现：排序、合并与序号判定。
 * - 状态的唯一来源是服务端读取（列表 / 详情函数），推送只作触发信号（Epic 5）；
 * - 读取结果按请求序号应用：`seq` 由编排 Composable（`composables/use-order-status.ts`）
 *   在每次读取发出时铸造，比较范围按订单 id；`api/` 与 `core/` 不持有或递增任何序号；
 * - 任何来源都不接受状态倒退（`cooking < pickup < completed`，`completed` 为终态）；
 * - 列表合并只增不删（已知 id 更新、未知 id 插入、陈旧读取只合并不删除）；
 *   整表替换只由首屏读取 / 显式刷新 / 分页重置决定。
 *
 * 本文件只做纯计算（不碰网络、存储与 uni API），进单元测试清单。
 */
import type { OrderStatus } from '@/types/api-contracts'

/** 订单形状的最小要求：列表项与详情都满足（id 用于序号比较，status 用于单调判定） */
export interface OrderLike {
  id: string
  status: OrderStatus
}

/** 按订单 id 记录「最新一次已应用读取」的序号（比较范围按订单 id，随页实例持有） */
export type AppliedSeqMap = Map<string, number>

/** 状态排序值：cooking(0) < pickup(1) < completed(2) */
export function statusRank(status: OrderStatus): number {
  switch (status) {
    case 'cooking':
      return 0
    case 'pickup':
      return 1
    case 'completed':
      return 2
  }
}

/**
 * 状态单调推进：只前进不倒退（cooking < pickup < completed）、同值幂等。
 * `completed` 为三值状态机终态——任何来源都不能把它改回去。
 */
export function advanceStatus(current: OrderStatus, incoming: OrderStatus): OrderStatus {
  return statusRank(incoming) > statusRank(current) ? incoming : current
}

/**
 * 单条读取结果的序号门 + 状态单调（列表与详情共用的核心原语）：
 * - `lastSeq` 已记录且 `seq` 不更大 → 旧响应，忽略本条（返回 `applied: false`）；
 * - 否则应用：`status` 取单调值（不接受倒退），其余字段取本次读取结果。
 *
 * 调用方在 `applied: true` 时把该订单 id 的序号推进为 `seq`。
 */
export function applyOrderRead<T extends OrderLike>(
  current: T | undefined,
  incoming: T,
  seq: number,
  lastSeq: number | undefined,
): { order: T; applied: boolean } {
  if (lastSeq !== undefined && seq <= lastSeq) {
    return { order: current ?? incoming, applied: false }
  }
  if (current === undefined) {
    return { order: incoming, applied: true }
  }
  return {
    order: { ...incoming, status: advanceStatus(current.status, incoming.status) } as T,
    applied: true,
  }
}

/** 复制 applied 表（纯函数返回新表，调用方替换引用） */
function copyApplied(applied: ReadonlyMap<string, number>): AppliedSeqMap {
  return new Map(applied)
}

/**
 * 列表合并（AD-7「只增不删」）：
 * - 已知 id：走 `applyOrderRead` 的序号门 + 状态单调——旧读取被忽略、条目保留；
 * - 未知 id：插入（没有历史序号，永远接受）；
 * - 未出现在本次结果中的已加载条目：保留（陈旧读取只合并不删除）。
 *
 * 顺序 = 本次结果在前（按服务端时间倒序置顶） + 尾部保留条目；
 * 返回新数组与新 applied 表，不修改入参。
 */
export function mergeOrderList<T extends OrderLike>(
  current: T[],
  incoming: T[],
  seq: number,
  applied: ReadonlyMap<string, number>,
): { orders: T[]; applied: AppliedSeqMap } {
  const nextApplied = copyApplied(applied)
  const previous = new Map(current.map((order) => [order.id, order]))
  const seen = new Set<string>()
  const orders: T[] = []

  for (const item of incoming) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const { order, applied: ok } = applyOrderRead(
      previous.get(item.id),
      item,
      seq,
      nextApplied.get(item.id),
    )
    if (ok) nextApplied.set(item.id, seq)
    orders.push(order)
  }
  for (const order of current) {
    if (!seen.has(order.id)) orders.push(order)
  }

  return { orders, applied: nextApplied }
}

/**
 * 整表替换（首屏读取 / 显式刷新）：以本次结果为准、不再保留未出现的条目；
 * 同 id 仍走状态单调（任何来源不接受倒退）；applied 重置为本次 seq。
 */
export function replaceOrderList<T extends OrderLike>(
  current: T[],
  incoming: T[],
  seq: number,
): { orders: T[]; applied: AppliedSeqMap } {
  const previous = new Map(current.map((order) => [order.id, order]))
  const applied: AppliedSeqMap = new Map()

  const orders = incoming.map((item) => {
    applied.set(item.id, seq)
    const prev = previous.get(item.id)
    if (prev === undefined) return item
    return { ...item, status: advanceStatus(prev.status, item.status) } as T
  })

  return { orders, applied }
}

/**
 * 分页追加（触底加载下一页）：只追加未知 id、不更新已有条目（重复 id 跳过），
 * 保持已加载顺序、尾部续接；记录追加条目的序号。
 */
export function appendOrderPage<T extends OrderLike>(
  current: T[],
  incoming: T[],
  seq: number,
  applied: ReadonlyMap<string, number>,
): { orders: T[]; applied: AppliedSeqMap } {
  const nextApplied = copyApplied(applied)
  const known = new Set(current.map((order) => order.id))
  const appended: T[] = []

  for (const item of incoming) {
    if (known.has(item.id)) continue
    known.add(item.id)
    nextApplied.set(item.id, seq)
    appended.push(item)
  }

  return { orders: appended.length > 0 ? [...current, ...appended] : current, applied: nextApplied }
}
