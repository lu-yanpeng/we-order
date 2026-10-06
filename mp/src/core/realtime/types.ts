/**
 * `core/realtime` 内部类型（不对外；`api/` 之上只可见 `types/realtime.ts` 的订阅契约）
 *
 * 这里的「端口」是刻意收窄的最小接口：`client.ts` 用真实 realtime-js 实现，
 * 单测注入假件——编排逻辑（单活跃订阅、重连上限、会话等待）不依赖库的具体形状。
 */
import type { RealtimeConnectionStatus } from '@/types/realtime'

/** 一条 `postgres_changes` 绑定（只允许 INSERT / UPDATE，AD-9；DELETE 的 RLS 过滤不适用） */
export interface RealtimePostgresBinding {
  event: 'INSERT' | 'UPDATE'
  schema: string
  table: string
  filter: string
}

/**
 * 订阅规格（由 `api/` 构造，业务知识留在 api，core 只执行）：
 * - `key`：业务键（`orders:list` / `orders:<id>`），同键重复 openChannel 幂等复用；
 * - `topic`：channel topic（不含凭证；realtime-js 自动加 `realtime:` 前缀）；
 * - `bindingFor`：把本人 id 映射为绑定清单（**经 api/ 传入**，core 不发明身份）；
 * - `resolveUserId`：本人 id 取值函数（来源 `core/session`，会话就绪后调用）；
 * - `onEvent`：推送到达回调（只作触发信号，不携带原始行；5.2 用它触发读取）。
 */
export interface RealtimeChannelSpec {
  key: string
  topic: string
  bindingFor: (userId: string) => RealtimePostgresBinding[]
  resolveUserId: () => string | undefined
  onEvent?: () => void
}

/** channel 级订阅状态（收窄 realtime-js 的 `REALTIME_SUBSCRIBE_STATES`） */
export type RealtimeChannelStatus = 'subscribed' | 'timed_out' | 'error' | 'closed'

/** 一条 channel 的最小端口（client.ts 实现，测试注入假件） */
export interface RealtimeChannelPort {
  /** 绑定一个 postgres_changes 过滤器；命中时回调（不传原始行） */
  bind(binding: RealtimePostgresBinding, onEvent: () => void): void
  /** 发起订阅（realtime-js 内部会在未连接时自动建连）；状态经回调上浮 */
  subscribe(onStatus: (status: RealtimeChannelStatus) => void): void
}

/** 连接的最小端口（掩盖 realtime-js 表面，只暴露编排所需） */
export interface RealtimeClientPort {
  openChannel(topic: string): RealtimeChannelPort
  /** 移除 channel（返回后同 topic 可安全重建） */
  removeChannel(channel: RealtimeChannelPort): Promise<void>
  connect(): void
  disconnect(): Promise<void>
  setAuth(token: string | null): Promise<void>
  /** socket 级事件（重连计数与状态上浮用）；dispose 时清理 */
  onOpen(callback: () => void): void
  onClose(callback: () => void): void
  /** 清理事件注册并断开连接（放弃订阅时调用） */
  dispose(): void
}

/** `createRealtime` 的装配依赖（index.ts 注入真实实现；测试注入假件） */
export interface RealtimeDeps {
  ensureSession(): Promise<void>
  getAccessToken(): string | undefined
  subscribeSession(listener: (snapshot: { accessToken: string }) => void): () => void
  createClient(): RealtimeClientPort
  log(...args: unknown[]): void
}

export type { RealtimeConnectionStatus }
