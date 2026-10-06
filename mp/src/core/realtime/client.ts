/**
 * realtime-js 客户端装配（P3 Story 5.1；AD-9）
 *
 * 唯一接触 `@supabase/realtime-js` 的文件：构造客户端、注入 `uni.connectSocket` 适配器、
 * 把库的回调/方法收窄为 `RealtimeClientPort`（`types.ts`）。编排逻辑（`subscription.ts`）
 * 只面向端口编程，不依赖库的具体形状。
 *
 * 关键点：
 * - 地址：`supabaseUrl()` 是 http(s)，WebSocket 需要 ws(s)；realtime-js 自行拼
 *   `/websocket?apikey=…&vsn=2.0.0`，这里只给到 `/realtime/v1`；
 * - URL 垫片：客户端构造与每次 channel 构造（库内部两处 `new URL`）都用
 *   `withUrlShim()` 临时替换宿主 `URL`、用完还原——宿主「没有 URL」或
 *   「URL 不是构造函数」（开发者工具实测）都能工作；
 * - 凭证：`accessToken` 回调在连接与每次心跳时取最新会话；续期后的即时同步由
 *   `subscription.ts` 经 `setAuth` 完成（双保险）；
 * - 重连退避：与库默认一致（1s / 2s / 5s / 10s 后每 10s）；**上限**由编排层计数控制；
 * - 日志：只透传库的 kind/msg（丢弃 data，避免意外带出敏感信息）。
 */
import { RealtimeClient } from '@supabase/realtime-js'
import type { RealtimeChannel, RealtimePostgresChangesFilter } from '@supabase/realtime-js'
import { supabasePublishableKey, supabaseUrl } from '@/core/transport'
import { redactLogMessage, realtimeLog } from './log'
import { UniSocketAdapter } from './socket-adapter'
import type {
  RealtimeChannelPort,
  RealtimeChannelStatus,
  RealtimeClientPort,
  RealtimePostgresBinding,
} from './types'
import { withUrlShim } from './url-shim'

/** 会话侧最小接口（core/session 满足；测试可注入假件） */
export interface RealtimeClientSession {
  ensureSession(): Promise<void>
  getAccessToken(): string | undefined
}

/** 与库默认一致的重连退避：前四次 1s / 2s / 5s / 10s，之后每 10s */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000] as const
export const RECONNECT_FALLBACK_MS = 10000

/** 库的 channel 状态字符串 → 内部四态 */
function mapChannelStatus(status: string): RealtimeChannelStatus {
  switch (status) {
    case 'SUBSCRIBED':
      return 'subscribed'
    case 'TIMED_OUT':
      return 'timed_out'
    case 'CLOSED':
      return 'closed'
    default:
      return 'error'
  }
}

/** http(s) → ws(s)：WebSocket 地址必须是 ws 协议（库只在该协议上拼 websocket 路径） */
function toWebSocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/i, 'ws')}/realtime/v1`
}

export function createRealtimeClient(session: RealtimeClientSession): RealtimeClientPort {
  // 客户端构造内部会 new URL(...)：临时提供垫片（host 缺失 / 不可构造都覆盖）
  const client = withUrlShim(
    () =>
      new RealtimeClient(toWebSocketUrl(supabaseUrl()), {
        transport: UniSocketAdapter,
        params: { apikey: supabasePublishableKey() },
        accessToken: async () => {
          try {
            await session.ensureSession()
            return session.getAccessToken() ?? null
          } catch {
            // 会话失败：本次以空 token 继续（RLS 不会返回任何事件），由编排层回退轮询
            return null
          }
        },
        reconnectAfterMs: (tries) => RECONNECT_DELAYS_MS[tries - 1] ?? RECONNECT_FALLBACK_MS,
        logger: (kind, msg) => realtimeLog('lib', kind, redactLogMessage(msg)),
      }),
  )

  /** port → 真实 channel 的反查（removeChannel 需要原对象） */
  const rawChannels = new WeakMap<RealtimeChannelPort, RealtimeChannel>()
  /** 已注册的 socket 级回调 ref（dispose 时按 ref 摘除） */
  const callbackRefs: string[] = []
  let refSeq = 0

  const pushCallback = (type: 'open' | 'close', callback: () => void): void => {
    refSeq += 1
    const ref = `rt-${refSeq}`
    callbackRefs.push(ref)
    client.stateChangeCallbacks[type].push([ref, callback])
  }

  return {
    openChannel(topic) {
      // channel 构造内部同样会 new URL(...)（broadcastEndpointURL）：同用垫片包住
      const raw = withUrlShim(() => client.channel(topic))
      const port: RealtimeChannelPort = {
        bind(binding: RealtimePostgresBinding, onEvent: () => void) {
          const filter = binding as RealtimePostgresChangesFilter<'INSERT' | 'UPDATE'>
          raw.on('postgres_changes', filter, () => onEvent())
        },
        subscribe(onStatus) {
          raw.subscribe((status) => onStatus(mapChannelStatus(status)))
        },
      }
      rawChannels.set(port, raw)
      return port
    },

    async removeChannel(channel) {
      const raw = rawChannels.get(channel)
      rawChannels.delete(channel)
      if (raw !== undefined) await client.removeChannel(raw)
    },

    connect() {
      client.connect()
    },

    async disconnect() {
      await client.disconnect()
    },

    async setAuth(token) {
      await client.setAuth(token)
    },

    onOpen(callback) {
      pushCallback('open', callback)
    },

    onClose(callback) {
      pushCallback('close', callback)
    },

    dispose() {
      for (const ref of callbackRefs) {
        for (const type of ['open', 'close', 'error', 'message'] as const) {
          client.stateChangeCallbacks[type] = client.stateChangeCallbacks[type].filter(
            ([id]) => id !== ref,
          )
        }
      }
      callbackRefs.length = 0
      void client.disconnect()
    },
  }
}
