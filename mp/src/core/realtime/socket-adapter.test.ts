/**
 * `uni.connectSocket` → WebSocketLike 适配器单元测试（P3 Story 5.1）
 *
 * 用假 SocketTask 断言：事件映射、readyState 生命周期、send / close 透传、
 * 「建连阶段 error 无 close 时补发一次 close」的兜底。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_CLOSE_GRACE_MS, UniSocketAdapter } from './socket-adapter'

type TaskHandler = (result: unknown) => void

function createFakeTask() {
  const handlers: Record<string, TaskHandler> = {}
  const sent: unknown[] = []
  const closes: Array<{ code?: number; reason?: string }> = []
  const task = {
    onOpen: (cb: TaskHandler) => {
      handlers.open = cb
    },
    onMessage: (cb: TaskHandler) => {
      handlers.message = cb
    },
    onClose: (cb: TaskHandler) => {
      handlers.close = cb
    },
    onError: (cb: TaskHandler) => {
      handlers.error = cb
    },
    send: (options: { data: unknown }) => {
      sent.push(options.data)
    },
    close: (options: { code?: number; reason?: string }) => {
      closes.push({ code: options.code, reason: options.reason })
    },
  }
  return {
    task,
    sent,
    closes,
    emitOpen: () => handlers.open?.({}),
    emitMessage: (data: unknown) => handlers.message?.({ data }),
    emitClose: (code?: number, reason?: string) => handlers.close?.({ code, reason }),
    emitError: (errMsg: string) => handlers.error?.({ errMsg }),
  }
}

let fake: ReturnType<typeof createFakeTask>
let connectSocket: ReturnType<typeof vi.fn>

beforeEach(() => {
  fake = createFakeTask()
  connectSocket = vi.fn(() => fake.task)
  vi.stubGlobal('uni', { connectSocket })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function createAdapter() {
  return new UniSocketAdapter('ws://127.0.0.1:54321/realtime/v1/websocket?apikey=k')
}

describe('建连与事件映射', () => {
  it('构造时以给定 url 建连，初始 readyState = CONNECTING', () => {
    const adapter = createAdapter()
    expect(connectSocket).toHaveBeenCalledTimes(1)
    expect(connectSocket).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'ws://127.0.0.1:54321/realtime/v1/websocket?apikey=k' }),
    )
    expect(adapter.url).toBe('ws://127.0.0.1:54321/realtime/v1/websocket?apikey=k')
    expect(adapter.readyState).toBe(adapter.CONNECTING)
  })

  it('open → readyState = OPEN 且触发 onopen', () => {
    const adapter = createAdapter()
    const onopen = vi.fn()
    adapter.onopen = onopen
    fake.emitOpen()
    expect(adapter.readyState).toBe(adapter.OPEN)
    expect(onopen).toHaveBeenCalledTimes(1)
  })

  it('message → 派发 { data }（realtime-js 从事件取 .data 解码）', () => {
    const adapter = createAdapter()
    const onmessage = vi.fn()
    adapter.onmessage = onmessage
    fake.emitMessage('["1","1","phoenix","phx_reply",{}]')
    expect(onmessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: '["1","1","phoenix","phx_reply",{}]' }),
    )
  })

  it('send 透传数据；close 透传 code / reason 并按 CLOSING → CLOSED 迁移', () => {
    const adapter = createAdapter()
    const onclose = vi.fn()
    adapter.onclose = onclose
    fake.emitOpen()
    adapter.send('payload')
    expect(fake.sent).toEqual(['payload'])

    adapter.close(1000, 'bye')
    expect(adapter.readyState).toBe(adapter.CLOSING)
    expect(fake.closes).toEqual([{ code: 1000, reason: 'bye' }])
    expect(onclose).not.toHaveBeenCalled()

    fake.emitClose(1000, 'bye')
    expect(adapter.readyState).toBe(adapter.CLOSED)
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('close 幂等：重复调用只透传一次', () => {
    const adapter = createAdapter()
    adapter.close()
    adapter.close()
    expect(fake.closes).toHaveLength(1)
  })
})

describe('建连阶段 error 的 close 兜底', () => {
  it('error 后宽限期内无真实 close → 补发一次 close（readyState = CLOSED）', () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    const onclose = vi.fn()
    const onerror = vi.fn()
    adapter.onclose = onclose
    adapter.onerror = onerror

    fake.emitError('url not in domain list')
    expect(onerror).toHaveBeenCalledTimes(1)
    expect(onclose).not.toHaveBeenCalled()

    vi.advanceTimersByTime(ERROR_CLOSE_GRACE_MS)
    expect(onclose).toHaveBeenCalledTimes(1)
    expect(adapter.readyState).toBe(adapter.CLOSED)

    // 之后真实 close 到达也不重复派发
    fake.emitClose(1006, '')
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('error 后真实 close 先到 → 不再补发', () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    const onclose = vi.fn()
    adapter.onclose = onclose

    fake.emitError('boom')
    fake.emitClose(1006, 'boom')
    vi.advanceTimersByTime(ERROR_CLOSE_GRACE_MS)
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('已 open 后的 error 不触发补发（由真实 close 收尾）', () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    const onclose = vi.fn()
    adapter.onclose = onclose

    fake.emitOpen()
    fake.emitError('server connection reset')
    vi.advanceTimersByTime(ERROR_CLOSE_GRACE_MS)
    expect(onclose).not.toHaveBeenCalled()
  })
})
