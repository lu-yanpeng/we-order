/**
 * Realtime 订阅的客户端共享类型（P3 Story 5.1；FR-P3-15；AD-9）
 *
 * 只描述 `api/` 暴露给 Composable 的订阅契约（连接状态与句柄形状）；
 * 服务端数据形状仍以 `types/api-contracts.ts` 为唯一来源，协议细节封在 `core/realtime`。
 */

/**
 * 订阅连接状态（经 `onStatus` 回调上浮，供 AD-8 刷新策略判定）：
 * - `connecting`：会话等待 / 建连 / 订阅中 / 断线重连中（不健康 → 回退轮询）；
 * - `subscribed`：channel 已进入 `SUBSCRIBED`（健康 → 可停轮询、等待推送）；
 * - `unavailable`：会话未就绪或连续失败后放弃（不健康 → 轮询兜底）。
 *
 * 只在状态转移时回调；订阅失败对用户静默（不抛异常、不产出错误类别）。
 */
export type RealtimeConnectionStatus = 'connecting' | 'subscribed' | 'unavailable'

/**
 * 订阅句柄：入口形状 `subscribe({ scope, orderId? }) → { unsubscribe, onStatus }`（AD-9）。
 *
 * 备注（Story 5.2）：推送到达只作**触发信号**，不在此句柄上暴露原始行；
 * 触发回调经订阅入口的可选 `onEvent` 传入（加法型扩展），由 `api/orders.ts` 转交。
 */
export interface RealtimeSubscriptionHandle {
  /** 退订（幂等）：同一句柄重复调用只生效一次；退订后其状态回调不再触发 */
  unsubscribe(): void
  /**
   * 注册连接状态回调：注册时立即以当前状态回调一次（便于刷新策略在订阅时同步判定），
   * 之后只在状态转移时回调；返回退订函数。回调抛错不影响订阅本身。
   */
  onStatus(callback: (status: RealtimeConnectionStatus) => void): () => void
}
