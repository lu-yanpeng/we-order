/**
 * 订阅编排（P3 Story 5.1；AD-9）
 *
 * `core/realtime` 的对外行为都由这里决定：模块级**单客户端 + 单活跃 channel**；
 * 订阅 / 退订幂等；同一时刻只有一个订阅在飞（列表与详情互斥由使用方按可见域调用，
 * 这里做兜底替换）；断线由 realtime-js 按退避重连，这里负责**重试上限**与状态上浮。
 *
 * 生命周期：
 * 1. 建立：`openChannel(spec)` → 等待 `ensureSession()`（不阻塞页面）→ 取本人 id
 *    （来源 `core/session`，由 `api/` 传入取值函数）→ setAuth → 建 channel → subscribe；
 * 2. 健康：channel `SUBSCRIBED` → 状态 `subscribed`（5.2 据此停轮询）；
 * 3. 断线：socket close → 状态立即回 `connecting`（5.2 据此回退轮询）→ 库按退避重连；
 * 4. 上限：连续失败达到 `REALTIME_MAX_FAILURES` → 放弃、状态 `unavailable`、断开客户端
 *    （轮询兜底；下次进入可见域重新订阅）；
 * 5. 看门狗：状态停在 `connecting` 超过 `REALTIME_WATCHDOG_MS`（覆盖「无 open 也无 close」
 *    的挂起）→ 计一次失败并重建 channel；
 * 6. 凭证：会话每次变更（续期 / 重登成功）→ `setAuth` 同步；会话尚未就绪时订阅挂起，
 *    就绪后自动补订。
 *
 * 查看 / 退订：`onStatus` 注册时立即回调当前状态、之后只在转移时回调；`unsubscribe` 幂等。
 * 开发期日志由注入的 `log` 输出（固定前缀见 `log.ts`）；订阅失败对用户静默、不抛异常。
 */
import type { RealtimeConnectionStatus, RealtimeSubscriptionHandle } from '@/types/realtime'
import type {
  RealtimeChannelPort,
  RealtimeChannelSpec,
  RealtimeClientPort,
  RealtimeDeps,
} from './types'

/** 连续失败上限：达到即放弃重连（退避序列 1/2/5/10/10s，约 28s 内无一次成功即放弃） */
export const REALTIME_MAX_FAILURES = 5

/** 连接看门狗：状态停在 connecting 超过该时长视为失败并重建（毫秒） */
export const REALTIME_WATCHDOG_MS = 20000

interface ActiveSubscription {
  key: string
  spec: RealtimeChannelSpec
  status: RealtimeConnectionStatus
  listeners: Set<(status: RealtimeConnectionStatus) => void>
  disposed: boolean
  channel: RealtimeChannelPort | null
  userId: string | null
  /** 因会话未就绪而挂起：登录 / 重登成功后自动补订 */
  waitingSession: boolean
  watchdog: ReturnType<typeof setTimeout> | null
}

export interface RealtimeInstance {
  openChannel(spec: RealtimeChannelSpec): RealtimeSubscriptionHandle
}

/** 异常只取 message（日志不输出来自运行时的完整堆栈，AR-P3-25） */
function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createRealtime(deps: RealtimeDeps): RealtimeInstance {
  let client: RealtimeClientPort | null = null
  let active: ActiveSubscription | null = null
  /** 世代号：替换订阅后，旧异步链的迟到结果一律丢弃 */
  let generation = 0
  /** 当前订阅生命周期内的连续失败计数（socket open / subscribed 时清零） */
  let failures = 0
  /** 已放弃：达到失败上限后置位，下次 openChannel 重新开始 */
  let givenUp = false

  const log = deps.log

  // 凭证同步 + 会话就绪后补订（订阅方不感知 token；统一入口形状不变）
  deps.subscribeSession(({ accessToken }) => {
    const current = client
    if (current !== null) void current.setAuth(accessToken)
    log('session token synced')
    const sub = active
    if (sub !== null && !sub.disposed && sub.waitingSession && !givenUp) {
      sub.waitingSession = false
      void start(generation, sub)
    }
  })

  const isStale = (gen: number, sub: ActiveSubscription): boolean =>
    sub.disposed || sub !== active || gen !== generation

  function setStatus(sub: ActiveSubscription, status: RealtimeConnectionStatus): void {
    if (sub.status === status) return
    sub.status = status
    log(`status -> ${status}`, sub.key)
    for (const listener of [...sub.listeners]) {
      try {
        listener(status)
      } catch {
        // 订阅方异常不影响订阅本身
      }
    }
  }

  function clearWatchdog(sub: ActiveSubscription): void {
    if (sub.watchdog !== null) {
      clearTimeout(sub.watchdog)
      sub.watchdog = null
    }
  }

  /** 状态停在 connecting 的兜底：计一次失败并重建 channel（正常断线由库退避处理） */
  function armWatchdog(sub: ActiveSubscription): void {
    clearWatchdog(sub)
    sub.watchdog = setTimeout(() => {
      sub.watchdog = null
      if (isStale(generation, sub) || sub.status === 'subscribed') return
      failures += 1
      log(`watchdog fired; failure ${failures}/${REALTIME_MAX_FAILURES}`, sub.key)
      if (failures >= REALTIME_MAX_FAILURES) {
        giveUp(sub)
        return
      }
      void restartChannel(sub)
    }, REALTIME_WATCHDOG_MS)
  }

  /** 放弃：断开并抛弃客户端；订阅状态置 unavailable，轮询兜底 */
  function giveUp(sub: ActiveSubscription): void {
    givenUp = true
    clearWatchdog(sub)
    setStatus(sub, 'unavailable')
    log(`give up after ${failures} failures; polling takes over`, sub.key)
    sub.channel = null
    const current = client
    client = null
    if (current !== null) current.dispose()
  }

  function handleSocketOpen(): void {
    if (givenUp) return
    const sub = active
    if (sub === null || sub.disposed) return
    failures = 0
    clearWatchdog(sub)
    log('socket open')
    if (sub.status === 'unavailable') setStatus(sub, 'connecting')
  }

  function handleSocketClose(): void {
    if (givenUp) return
    const sub = active
    if (sub === null || sub.disposed) return
    clearWatchdog(sub)
    failures += 1
    if (failures >= REALTIME_MAX_FAILURES) {
      giveUp(sub)
      return
    }
    log(`socket closed; failure ${failures}/${REALTIME_MAX_FAILURES}`, sub.key)
    setStatus(sub, 'connecting')
    armWatchdog(sub)
  }

  /**
   * channel 状态（断线重连由 socket 级事件驱动，这里只做状态上浮与看门狗布置）：
   * 服务端拒绝 / 超时不自动重建（避免风暴），看门狗到点才重建一次。
   */
  function handleChannelStatus(
    sub: ActiveSubscription,
    channel: RealtimeChannelPort,
    status: string,
  ): void {
    if (sub.disposed || sub !== active || sub.channel !== channel) return
    if (status === 'subscribed') {
      failures = 0
      clearWatchdog(sub)
      log('channel subscribed', sub.key)
      setStatus(sub, 'subscribed')
      return
    }
    log(`channel ${status}`, sub.key)
    if (sub.status === 'subscribed') setStatus(sub, 'connecting')
    armWatchdog(sub)
  }

  function ensureClient(): RealtimeClientPort {
    if (client === null) {
      client = deps.createClient()
      client.onOpen(handleSocketOpen)
      client.onClose(handleSocketClose)
    }
    return client
  }

  /** 用已解析的本人 id 建 channel 并订阅；旧 channel（如有）先移除，保证同 topic 可重建 */
  async function attachChannel(gen: number, sub: ActiveSubscription): Promise<void> {
    try {
      await runAttach(gen, sub)
    } catch (error) {
      // 配置 / 构造类异常（如宿主 URL 不可用）不向外抛：计一次失败、看门狗后重试、达上限放弃
      if (isStale(gen, sub)) return
      failures += 1
      log(`attach failed (${failures}/${REALTIME_MAX_FAILURES})`, sub.key, errorMessageOf(error))
      if (failures >= REALTIME_MAX_FAILURES) {
        giveUp(sub)
        return
      }
      setStatus(sub, 'connecting')
      armWatchdog(sub)
    }
  }

  async function runAttach(gen: number, sub: ActiveSubscription): Promise<void> {
    const userId = sub.userId
    if (userId === null) return
    const current = ensureClient()
    try {
      await current.setAuth(deps.getAccessToken() ?? null)
    } catch (error) {
      log('setAuth failed', sub.key, errorMessageOf(error))
    }
    if (isStale(gen, sub)) return

    if (sub.channel !== null) {
      const previous = sub.channel
      sub.channel = null
      try {
        await current.removeChannel(previous)
      } catch (error) {
        log('remove stale channel failed', sub.key, error)
      }
      if (isStale(gen, sub)) return
    }

    const channel = current.openChannel(sub.spec.topic)
    sub.channel = channel
    for (const binding of sub.spec.bindingFor(userId)) {
      channel.bind(binding, () => {
        if (sub.disposed || sub.channel !== channel) return
        log(`event ${binding.event}`, sub.key)
        sub.spec.onEvent?.()
      })
    }
    channel.subscribe((status) => handleChannelStatus(sub, channel, status))
    log('subscribe requested', sub.key)
    armWatchdog(sub)
  }

  /** 看门狗路径：断开客户端并重建 channel（重新走一次 connect / join） */
  async function restartChannel(sub: ActiveSubscription): Promise<void> {
    const gen = generation
    const current = client
    if (current !== null) {
      try {
        await current.disconnect()
      } catch {
        // 断开失败不阻断重建
      }
    }
    if (isStale(gen, sub)) return
    await attachChannel(gen, sub)
  }

  /** 建立订阅：等待会话就绪后解析本人 id 并挂上 channel */
  async function start(gen: number, sub: ActiveSubscription): Promise<void> {
    if (isStale(gen, sub)) return
    setStatus(sub, 'connecting')
    try {
      await deps.ensureSession()
    } catch {
      if (isStale(gen, sub)) return
      sub.waitingSession = true
      setStatus(sub, 'unavailable')
      log('session not ready; waiting for login', sub.key)
      return
    }
    if (isStale(gen, sub)) return

    const userId = sub.spec.resolveUserId()
    if (userId === undefined || userId === '') {
      sub.waitingSession = true
      setStatus(sub, 'unavailable')
      log('session ready but identity missing; waiting', sub.key)
      return
    }
    sub.userId = userId
    await attachChannel(gen, sub)
  }

  function stopActive(): void {
    const sub = active
    if (sub === null) return
    active = null
    sub.disposed = true
    clearWatchdog(sub)
    sub.listeners.clear()
    const channel = sub.channel
    sub.channel = null
    const current = client
    if (current !== null && channel !== null) void current.removeChannel(channel)
  }

  function unsubscribe(sub: ActiveSubscription): void {
    if (sub.disposed) return
    sub.disposed = true
    clearWatchdog(sub)
    sub.listeners.clear()
    if (active === sub) active = null
    const channel = sub.channel
    sub.channel = null
    const current = client
    if (current !== null && channel !== null) void current.removeChannel(channel)
    log('unsubscribed', sub.key)
  }

  function makeHandle(sub: ActiveSubscription): RealtimeSubscriptionHandle {
    return {
      unsubscribe: () => unsubscribe(sub),
      onStatus: (callback) => {
        if (sub.disposed) return () => {}
        sub.listeners.add(callback)
        try {
          callback(sub.status)
        } catch {
          // 回调异常不影响订阅本身
        }
        return () => {
          sub.listeners.delete(callback)
        }
      },
    }
  }

  function openChannel(spec: RealtimeChannelSpec): RealtimeSubscriptionHandle {
    const existing = active
    // 同键且未放弃 → 幂等复用（切 tab 重进、页面重复 onShow 不会重建订阅）
    if (existing !== null && !existing.disposed && existing.key === spec.key && !givenUp) {
      log('subscription reused', spec.key)
      return makeHandle(existing)
    }

    const gen = ++generation
    stopActive()
    givenUp = false
    failures = 0
    const sub: ActiveSubscription = {
      key: spec.key,
      spec,
      status: 'connecting',
      listeners: new Set(),
      disposed: false,
      channel: null,
      userId: null,
      waitingSession: false,
      watchdog: null,
    }
    active = sub
    log('subscription requested', spec.key)
    void start(gen, sub)
    return makeHandle(sub)
  }

  return { openChannel }
}
