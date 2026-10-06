/**
 * 订阅编排单元测试（P3 Story 5.1；AD-9）
 *
 * 注入假 client / 假 channel，覆盖：建立与状态上浮、同键幂等复用、不同键替换、
 * 退订幂等、断线失败累计与上限放弃、会话未就绪挂起与补订、凭证同步、看门狗重建、
 * 事件触发回调。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRealtime, REALTIME_MAX_FAILURES, REALTIME_WATCHDOG_MS } from './subscription'
import type {
  RealtimeChannelPort,
  RealtimeChannelSpec,
  RealtimeChannelStatus,
  RealtimeClientPort,
  RealtimePostgresBinding,
} from './types'
import type { RealtimeConnectionStatus } from '@/types/realtime'

class FakeChannel implements RealtimeChannelPort {
  bindings: Array<{ binding: RealtimePostgresBinding; onEvent: () => void }> = []
  private statusCallback: ((status: RealtimeChannelStatus) => void) | null = null

  bind(binding: RealtimePostgresBinding, onEvent: () => void): void {
    this.bindings.push({ binding, onEvent })
  }

  subscribe(onStatus: (status: RealtimeChannelStatus) => void): void {
    this.statusCallback = onStatus
  }

  emitEvent(bindingIndex = 0): void {
    this.bindings[bindingIndex]?.onEvent()
  }

  emitStatus(status: RealtimeChannelStatus): void {
    this.statusCallback?.(status)
  }
}

class FakeClient implements RealtimeClientPort {
  channels: FakeChannel[] = []
  openTopics: string[] = []
  auths: Array<string | null> = []
  disconnectCalls = 0
  disposed = false
  private openHandlers: Array<() => void> = []
  private closeHandlers: Array<() => void> = []

  openChannel(topic: string): RealtimeChannelPort {
    this.openTopics.push(topic)
    const channel = new FakeChannel()
    this.channels.push(channel)
    return channel
  }

  async removeChannel(channel: RealtimeChannelPort): Promise<void> {
    this.channels = this.channels.filter((item) => item !== channel)
  }

  connect(): void {}

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1
  }

  async setAuth(token: string | null): Promise<void> {
    this.auths.push(token)
  }

  onOpen(callback: () => void): void {
    this.openHandlers.push(callback)
  }

  onClose(callback: () => void): void {
    this.closeHandlers.push(callback)
  }

  dispose(): void {
    this.disposed = true
  }

  emitOpen(): void {
    for (const callback of [...this.openHandlers]) callback()
  }

  emitClose(): void {
    for (const callback of [...this.closeHandlers]) callback()
  }
}

function setup() {
  const client = new FakeClient()
  let sessionListener: ((snapshot: { accessToken: string }) => void) | null = null
  const deps = {
    ensureSession: vi.fn(async () => {}),
    getAccessToken: vi.fn(() => 'token-1'),
    subscribeSession: vi.fn((listener: (snapshot: { accessToken: string }) => void) => {
      sessionListener = listener
      return () => {
        sessionListener = null
      }
    }),
    createClient: vi.fn(() => client),
    log: vi.fn(),
  }
  const realtime = createRealtime(deps)
  return {
    client,
    deps,
    realtime,
    emitSession: (accessToken: string) => {
      sessionListener?.({ accessToken })
    },
  }
}

function spec(overrides: Partial<RealtimeChannelSpec> = {}): RealtimeChannelSpec {
  return {
    key: 'orders:list',
    topic: 'orders',
    resolveUserId: () => 'user-1',
    bindingFor: (userId) => [
      { event: 'INSERT', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('建立订阅', () => {
  it('等会话 → setAuth → 绑定 INSERT / UPDATE → 状态上浮（onStatus 注册时立即回调）', async () => {
    const { client, deps, realtime } = setup()
    const statuses: RealtimeConnectionStatus[] = []
    const handle = realtime.openChannel(spec())
    handle.onStatus((status) => statuses.push(status))
    expect(statuses).toEqual(['connecting'])

    await vi.waitFor(() => expect(client.channels).toHaveLength(1))
    expect(deps.ensureSession).toHaveBeenCalledTimes(1)
    expect(client.auths).toContain('token-1')

    const channel = client.channels[0]
    expect(channel.bindings.map((entry) => entry.binding)).toEqual([
      { event: 'INSERT', schema: 'public', table: 'orders', filter: 'user_id=eq.user-1' },
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'user_id=eq.user-1' },
    ])

    channel.emitStatus('subscribed')
    expect(statuses).toEqual(['connecting', 'subscribed'])
  })

  it('事件命中：调用 onEvent（5.1 被动接线可不传）；退订后不再触发', async () => {
    const onEvent = vi.fn()
    const { client, realtime } = setup()
    const handle = realtime.openChannel(spec({ onEvent }))
    await vi.waitFor(() => expect(client.channels).toHaveLength(1))

    const channel = client.channels[0]
    channel.emitEvent()
    expect(onEvent).toHaveBeenCalledTimes(1)

    handle.unsubscribe()
    channel.emitEvent()
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('单笔订阅 filter = id=eq.<orderId>（列表 / 详情互斥时替换）', async () => {
    const { client, realtime } = setup()
    realtime.openChannel(
      spec({
        key: 'orders:o-1',
        bindingFor: () => [
          { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'id=eq.o-1' },
        ],
      }),
    )
    await vi.waitFor(() => expect(client.channels).toHaveLength(1))
    expect(client.channels[0].bindings[0].binding.filter).toBe('id=eq.o-1')
  })
})

describe('幂等与替换', () => {
  it('同键重复订阅：复用同一订阅，不重复建 channel / 不重复会合会话', async () => {
    const { client, deps, realtime } = setup()
    const first = realtime.openChannel(spec())
    const second = realtime.openChannel(spec())

    await vi.waitFor(() => expect(client.channels).toHaveLength(1))
    expect(client.openTopics).toEqual(['orders'])
    expect(deps.ensureSession).toHaveBeenCalledTimes(1)

    // 第二个句柄同样能收到后续状态（复用同一订阅的监听集合）
    const statuses: RealtimeConnectionStatus[] = []
    second.onStatus((status) => statuses.push(status))
    expect(statuses).toEqual(['connecting'])
    client.channels[0].emitStatus('subscribed')
    expect(statuses).toEqual(['connecting', 'subscribed'])

    first.unsubscribe()
    await vi.waitFor(() => expect(client.channels).toHaveLength(0))
  })

  it('不同键订阅：旧 channel 移除、新 channel 建立（同一时刻单活跃）', async () => {
    const { client, realtime } = setup()
    realtime.openChannel(spec())
    await vi.waitFor(() => expect(client.channels).toHaveLength(1))
    const previous = client.channels[0]

    realtime.openChannel(spec({ key: 'orders:o-2' }))
    await vi.waitFor(() => {
      expect(client.channels).toHaveLength(1)
      expect(client.channels[0]).not.toBe(previous)
    })
    expect(client.openTopics).toEqual(['orders', 'orders'])
  })

  it('退订幂等：只移除一次；退订后状态回调不再触发', async () => {
    const { client, realtime } = setup()
    const handle = realtime.openChannel(spec())
    await vi.waitFor(() => expect(client.channels).toHaveLength(1))
    const channel = client.channels[0]
    const statuses: RealtimeConnectionStatus[] = []
    handle.onStatus((status) => statuses.push(status))

    handle.unsubscribe()
    handle.unsubscribe()
    await vi.waitFor(() => expect(client.channels).toHaveLength(0))

    channel.emitStatus('subscribed')
    expect(statuses).toEqual(['connecting'])
  })
})

describe('断线与重试上限', () => {
  it('socket close → 状态回 connecting 并计数；达到上限 → unavailable + 断开客户端、不再重建', async () => {
    const { client, realtime } = setup()
    const statuses: RealtimeConnectionStatus[] = []
    const handle = realtime.openChannel(spec())
    handle.onStatus((status) => statuses.push(status))
    await vi.waitFor(() => expect(client.channels).toHaveLength(1))
    client.channels[0].emitStatus('subscribed')
    expect(statuses.at(-1)).toBe('subscribed')

    for (let index = 0; index < REALTIME_MAX_FAILURES; index += 1) client.emitClose()
    expect(statuses.at(-1)).toBe('unavailable')
    expect(client.disposed).toBe(true)

    const topicsBefore = client.openTopics.length
    client.emitClose()
    expect(client.openTopics.length).toBe(topicsBefore)

    // 放弃后重新订阅：从头开始尝试（新客户端由 createClient 提供）
    const next = realtime.openChannel(spec())
    const nextStatuses: RealtimeConnectionStatus[] = []
    next.onStatus((status) => nextStatuses.push(status))
    expect(nextStatuses).toEqual(['connecting'])
  })

  it('socket open 清零失败计数（断线 → 重连成功仍可继续）', async () => {
    const { client, realtime } = setup()
    const handle = realtime.openChannel(spec())
    await vi.waitFor(() => expect(client.channels).toHaveLength(1))

    client.emitClose()
    client.emitClose()
    client.emitOpen()
    client.channels[0].emitStatus('subscribed')

    for (let index = 0; index < REALTIME_MAX_FAILURES - 1; index += 1) client.emitClose()
    expect(client.disposed).toBe(false)
    handle.unsubscribe()
  })

  it('建连 / 配置抛错：不外抛（不产生未处理异常）；连续失败达上限 → unavailable', async () => {
    vi.useFakeTimers()
    const { deps, realtime } = setup()
    deps.createClient.mockImplementation(() => {
      throw new Error('URL is not a constructor')
    })
    const statuses: RealtimeConnectionStatus[] = []
    const handle = realtime.openChannel(spec())
    handle.onStatus((status) => statuses.push(status))

    await vi.advanceTimersByTimeAsync(0)
    expect(statuses.at(-1)).toBe('connecting')

    await vi.advanceTimersByTimeAsync(REALTIME_WATCHDOG_MS * 5)
    expect(statuses.at(-1)).toBe('unavailable')
  })
})

describe('会话等待与凭证同步', () => {
  it('会话未就绪：挂起为 unavailable、不建 channel；会话成功后自动补订', async () => {
    const { client, deps, realtime, emitSession } = setup()
    deps.ensureSession.mockRejectedValueOnce(new Error('login failed'))
    const statuses: RealtimeConnectionStatus[] = []
    const handle = realtime.openChannel(spec())
    handle.onStatus((status) => statuses.push(status))

    await vi.waitFor(() => expect(statuses.at(-1)).toBe('unavailable'))
    expect(client.openTopics).toHaveLength(0)

    emitSession('token-2')
    await vi.waitFor(() => expect(client.channels).toHaveLength(1))
    expect(client.auths).toContain('token-1')
  })

  it('会话续期：setAuth 同步最新凭证（凭证变更通知）', async () => {
    const { client, realtime, emitSession } = setup()
    realtime.openChannel(spec())
    await vi.waitFor(() => expect(client.channels).toHaveLength(1))
    client.auths.length = 0

    emitSession('token-9')
    expect(client.auths).toContain('token-9')
  })

  it('会话就绪但取不到本人 id：挂起等待，不建 channel', async () => {
    const { client, realtime } = setup()
    const statuses: RealtimeConnectionStatus[] = []
    const handle = realtime.openChannel(spec({ resolveUserId: () => undefined }))
    handle.onStatus((status) => statuses.push(status))

    await vi.waitFor(() => expect(statuses.at(-1)).toBe('unavailable'))
    expect(client.openTopics).toHaveLength(0)
  })
})

describe('看门狗', () => {
  it('connecting 超时 → 计一次失败并重建 channel（不产生重连风暴）', async () => {
    vi.useFakeTimers()
    const { client, realtime } = setup()
    realtime.openChannel(spec())
    await vi.advanceTimersByTimeAsync(0)
    expect(client.channels).toHaveLength(1)
    const first = client.channels[0]

    await vi.advanceTimersByTimeAsync(REALTIME_WATCHDOG_MS)
    expect(client.disconnectCalls).toBe(1)
    expect(client.channels).toHaveLength(1)
    expect(client.channels[0]).not.toBe(first)
  })

  it('订阅成功后看门狗取消（不再重建）', async () => {
    vi.useFakeTimers()
    const { client, realtime } = setup()
    realtime.openChannel(spec())
    await vi.advanceTimersByTimeAsync(0)
    client.channels[0].emitStatus('subscribed')

    await vi.advanceTimersByTimeAsync(REALTIME_WATCHDOG_MS * 2)
    expect(client.disconnectCalls).toBe(0)
    expect(client.openTopics).toHaveLength(1)
  })
})
