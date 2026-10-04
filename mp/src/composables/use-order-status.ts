/**
 * 订单刷新编排 Composable（P3 Story 4.3；FR-P3-12；AD-8）
 *
 * 刷新可见域 = 页面可见 且订单视图激活：页面把两者合成后调用 `setActive`；
 * 进入可见域立即读一次并启动 5s 轮询，离开 / 隐藏即停表（`onHide` / `onUnload` 语义）。
 *
 * 职责：
 * 1. 计时调度：单计时器 + 链式 setTimeout（读取完成后才排下一次）——同一视图最多一个计时器、
 *    不产生请求堆积；打开轮询的唯一条件是「可见域 + 订阅不健康 + 未降级 + 本轮值得轮询」；
 * 2. 序号铸造：每次读取发出时铸造自增 `seq`（`api/` 与 `core/` 不持有序号）；
 *    状态应用与序号门在 `utils/order-status.ts`，由使用方在 `read` 内完成；
 * 3. 失败降级：连续失败 3 次（进入 / 轮询 / 手动都计入）停止轮询、保留数据、
 *    降级为手动刷新入口；任一读取成功清零；仍可见则恢复轮询；
 * 4. 订阅接入点：`setSubscriptionHealthy(true)` 即停轮询（Epic 5 的「先补读再停」在置位前完成）；
 *    未启用订阅（默认）时轮询是唯一刷新路径；
 * 5. 串行化：同一时刻最多一个在飞读取；轮询与进入触发与在飞读取合并（跳过），
 *    手动读取不丢弃（等待在飞读取完成后补跑一次，兑现「下拉必然读取一次」）；
 * 6. 操作触发读取（Story 4.5）：确认取餐等动作成功后立即读取一次，复用 auto 语义
 *    （合并应用、失败静默——刷新失败由轮询自愈），并重置轮询计时。
 *
 * 状态呈现（失败态 / toast / 骨架 / 遮罩）由使用方在 `read` 内负责；本 Composable 不碰 UI。
 * 开发期可观察：`isPolling` 暴露轮询计时器状态（NFR-P3-5）。
 */
import { ref } from 'vue'
import type { Ref } from 'vue'

/** 读取语义：`auto` = 首屏 / 进入可见域 / 轮询；`manual` = 下拉刷新 / 失败重试（显式刷新） */
export type OrderReadKind = 'auto' | 'manual'

export interface UseOrderStatusOptions {
  /**
   * 读取并应用一次：`seq` 由本编排在发出时铸造，使用方在应用时用
   * `utils/order-status.ts` 的纯函数做序号门与状态单调；返回是否成功
   * （成功 = 本次结果已可用；失败由编排计数，是否提示由使用方决定）。
   */
  read: (seq: number, kind: OrderReadKind) => Promise<boolean>
  /** 是否值得轮询（每次调度前求值）：列表空态 / 详情已完成返回 false；默认恒 true */
  shouldPoll?: () => boolean
}

export interface OrderStatusController {
  /**
   * 可见域开关。进入（false → true）：立即读一次并重置轮询计时；离开：停表。
   * 重复置同值幂等。返回进入时那次读取的完成 Promise（页面无需等待，测试 / 下拉可 await）。
   */
  setActive: (active: boolean) => Promise<void>
  /** 订阅健康上报（Epic 5 接入点）：healthy → 不轮询；恢复非健康 → 回退轮询（若可见） */
  setSubscriptionHealthy: (healthy: boolean) => void
  /** 显式刷新（下拉 / 失败重试）：立即读一次并重置轮询计时；在飞时等待后补跑，可 await */
  runManualRead: () => Promise<void>
  /**
   * 操作触发的立即读取（确认取餐等，Story 4.5）：与进入可见域同语义（`auto`——
   * 合并应用、失败静默，刷新失败由轮询自愈），并重置轮询计时；在飞时合并跳过。
   */
  runAutoRead: () => Promise<void>
  /** 铸造下一个读取序号（供分页等非编排读取复用同一条单调路径） */
  nextSeq: () => number
  /** 停止编排（页面卸载 / 测试清理）：停表、不再发起任何读取；之后所有入口 no-op */
  dispose: () => void
  /** 轮询计时器在飞（开发期观察 + 测试断言；NFR-P3-5） */
  isPolling: Ref<boolean>
}

/** 轮询间隔（毫秒）：spine 收敛值 5s，满足「到点后 ≤ 一个周期 + 1s 可见」 */
export const POLL_INTERVAL_MS = 5000

/** 连续失败上限：达到即停止轮询、降级为手动刷新入口（FR-P3-12「静默重试 3 次」） */
export const MAX_CONSECUTIVE_FAILURES = 3

export function useOrderStatus(options: UseOrderStatusOptions): OrderStatusController {
  const shouldPoll = options.shouldPoll ?? (() => true)

  /** 可见域（页面可见 且订单视图激活） */
  let active = false
  /** 订阅健康：默认 false（未启用订阅 → 轮询为唯一刷新路径） */
  let subscriptionHealthy = false
  /** 连续失败计数（进入 / 轮询 / 手动共用；任一成功清零） */
  let consecutiveFailures = 0
  /** 一次读取的自增序号（铸造点唯一） */
  let seqCounter = 0
  /** 已停止（页面卸载 / 测试清理）：之后所有入口 no-op */
  let disposed = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  /** 在飞读取（串行化门）；null = 无在飞 */
  let inFlight: Promise<void> | null = null
  /** 手动读取在在飞期间被合并后的补跑标记（不丢弃显式刷新） */
  let manualPending = false

  const isPolling = ref(false)

  const nextSeq = () => ++seqCounter

  /** 可轮询：未停止 + 可见 + 订阅不健康 + 未降级 + 本轮值得轮询（空态 / 终态停） */
  const canPoll = () =>
    !disposed &&
    active &&
    !subscriptionHealthy &&
    consecutiveFailures < MAX_CONSECUTIVE_FAILURES &&
    shouldPoll()

  const cancelTimer = () => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    isPolling.value = false
  }

  /** 读取完成后重排下一次轮询（重置计时）；读取链的 finally 统一调用 */
  const scheduleNextPoll = () => {
    cancelTimer()
    if (!canPoll()) return
    isPolling.value = true
    pollTimer = setTimeout(() => {
      pollTimer = null
      isPolling.value = false
      if (!canPoll()) return
      void startRead('auto')
    }, POLL_INTERVAL_MS)
  }

  /** 执行一次读取并计数：成功清零、失败 +1（失败呈现由 `read` 使用方负责） */
  const execute = async (kind: OrderReadKind): Promise<boolean> => {
    try {
      const ok = await options.read(nextSeq(), kind)
      consecutiveFailures = ok ? 0 : consecutiveFailures + 1
      return ok
    } catch {
      // read 约定自行处理失败呈现；这里兜底计数，防未捕获异常打断调度
      consecutiveFailures += 1
      return false
    }
  }

  /**
   * 启动一次读取并接管后续调度：
   * - 无在飞：开跑，完成后统一重排轮询计时；
   * - 有在飞：自动读取合并（跳过——在飞读取已覆盖本次意图）；
   *   手动读取登记补跑（在飞读取完成后同一读取链内立即执行，不并发、不堆积）。
   */
  const startRead = (kind: OrderReadKind): Promise<void> => {
    if (disposed) return Promise.resolve()

    if (inFlight !== null) {
      if (kind === 'manual') manualPending = true
      return inFlight
    }

    cancelTimer() // 新一次读取重置轮询计时（完成后重排）
    inFlight = (async () => {
      try {
        await execute(kind)
        while (manualPending) {
          manualPending = false
          await execute('manual')
        }
      } finally {
        inFlight = null
        scheduleNextPoll()
      }
    })()
    return inFlight
  }

  /**
   * 可见域开关：进入 → 立即读一次并重置轮询计时；离开 → 停表。
   * 重复置同值幂等（不重复读取）。
   */
  const setActive = (next: boolean): Promise<void> => {
    if (disposed || next === active) return Promise.resolve()
    active = next
    cancelTimer()
    if (!active) return Promise.resolve()
    return startRead('auto')
  }

  /** 订阅健康上报：healthy → 不轮询，等待推送；恢复非健康 → 若可见则回退轮询 */
  const setSubscriptionHealthy = (healthy: boolean) => {
    if (disposed || healthy === subscriptionHealthy) return
    subscriptionHealthy = healthy
    if (healthy) {
      cancelTimer()
      return
    }
    scheduleNextPoll()
  }

  /** 显式刷新（下拉 / 失败重试）：立即读一次并重置轮询计时 */
  const runManualRead = () => (disposed ? Promise.resolve() : startRead('manual'))

  /**
   * 操作触发的立即读取（确认取餐等，Story 4.5）：同 auto 语义（合并、静默）+
   * 重置轮询计时；在飞时与在飞读取合并跳过（最坏由下一个轮询周期自愈）。
   */
  const runAutoRead = () => (disposed ? Promise.resolve() : startRead('auto'))

  /** 停止编排：停表并让所有入口失效（页面卸载后残留计时器 / 补跑不再触发） */
  const dispose = () => {
    disposed = true
    active = false
    manualPending = false
    cancelTimer()
  }

  return {
    setActive,
    setSubscriptionHealthy,
    runManualRead,
    runAutoRead,
    nextSeq,
    dispose,
    isPolling,
  }
}
