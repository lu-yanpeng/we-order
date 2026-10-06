/**
 * `core/realtime` 对外出口（只允许 `api/` 引用，P3 AD-1 / AD-9）
 *
 * - `openChannel(spec)`：通用订阅编排入口——协议、连接、退避、生命周期都封在本模块内；
 *   业务规格（表 / 事件 / filter / 本人 id 取值）由 `api/` 构造后传入；
 * - 上层（Composable / 页面）只消费 `api/` 返回的 `RealtimeSubscriptionHandle`
 *   （形状与状态类型见 `types/realtime.ts`），不接触本模块。
 *
 * 装配：本模块是 `core/realtime → core/session` 的依赖点（取凭证、本人标识、
 * 凭证变更通知）与 `core/realtime → core/transport` 的配置读取点（项目地址 / 发布密钥）。
 */
import { ensureSession, getAccessToken, subscribeSession } from '@/core/session'
import { createRealtimeClient } from './client'
import { realtimeLog } from './log'
import { createRealtime } from './subscription'

const instance = createRealtime({
  ensureSession,
  getAccessToken,
  subscribeSession,
  createClient: () => createRealtimeClient({ ensureSession, getAccessToken }),
  log: realtimeLog,
})

export const openChannel = instance.openChannel
export { REALTIME_MAX_FAILURES, REALTIME_WATCHDOG_MS } from './subscription'
export type { RealtimeChannelSpec, RealtimePostgresBinding } from './types'
