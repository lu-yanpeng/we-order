/**
 * `uni.connectSocket` → WebSocketLike 适配器（P3 Story 5.1；AD-9）
 *
 * realtime-js 通过 `transport` 注入口在连接时执行 `new transport(url, protocols)`，
 * 随后把 `onopen` / `onmessage` / `onerror` / `onclose` 赋到实例上，并读写
 * `binaryType` / `readyState` / `bufferedAmount`，调用 `send` / `close`。
 * 微信 SocketTask 只提供 `onOpen` / `onMessage` / `onError` / `onClose` / `send` / `close`，
 * 因此这里做三件事：
 * 1. 把 SocketTask 的回调映射为 WebSocket 风格的事件属性（含 `addEventListener`）；
 * 2. 自行维护 `readyState`（phoenix 的 teardown 会轮询它等待关闭完成）；
 * 3. 建连阶段收到 error 但迟迟没有 close 时，补发一次 close（宽限期见
 *    `ERROR_CLOSE_GRACE_MS`），保证上层一定进入自己的重连逻辑。
 *
 * 不做协议层任何事（join / 心跳 / 重连均归 realtime-js），只做传输形状桥接。
 */
import type { WebSocketLike } from '@supabase/realtime-js'

/** 建连阶段 error 后等待真实 close 的宽限期（毫秒）：超时仍无 close 则补发，避免卡在 CONNECTING */
export const ERROR_CLOSE_GRACE_MS = 200

type SocketMessage = { data: string | ArrayBuffer }
type SocketCloseDetail = { code?: number; reason?: string }

export class UniSocketAdapter implements WebSocketLike {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly CONNECTING = UniSocketAdapter.CONNECTING
  readonly OPEN = UniSocketAdapter.OPEN
  readonly CLOSING = UniSocketAdapter.CLOSING
  readonly CLOSED = UniSocketAdapter.CLOSED

  readonly url: string
  readonly protocol = ''
  readonly extensions = ''
  binaryType = 'arraybuffer'
  bufferedAmount = 0
  readyState = UniSocketAdapter.CONNECTING

  onopen: WebSocketLike['onopen'] = null
  onmessage: WebSocketLike['onmessage'] = null
  onclose: WebSocketLike['onclose'] = null
  onerror: WebSocketLike['onerror'] = null

  private readonly task: UniNamespace.SocketTask
  private readonly listeners = new Map<string, Set<EventListener>>()
  /** 只派发一次 close（真实 / 补发互斥） */
  private closeDispatched = false
  private syntheticCloseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(address: string | URL, protocols?: string | string[]) {
    this.url = typeof address === 'string' ? address : String(address)
    this.task = uni.connectSocket({
      url: this.url,
      protocols: typeof protocols === 'string' ? [protocols] : protocols,
      complete: () => {},
    })
    this.task.onOpen(() => this.handleOpen())
    this.task.onMessage((result) => this.handleMessage(result as SocketMessage))
    this.task.onClose((result) => this.handleClose(result as SocketCloseDetail))
    this.task.onError((result) => this.handleError(result))
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    try {
      this.task.send({
        data: data as unknown as string | ArrayBuffer,
        fail: (error) => this.emitError(error),
      })
    } catch (error) {
      this.emitError(error)
    }
  }

  close(code?: number, reason?: string): void {
    if (
      this.readyState === UniSocketAdapter.CLOSING ||
      this.readyState === UniSocketAdapter.CLOSED
    ) {
      return
    }
    this.readyState = UniSocketAdapter.CLOSING
    try {
      this.task.close({
        code,
        reason,
        // 连接尚未建立时 close 可能失败：直接按已关闭处理（phoenix 的关闭等待会走完）
        fail: () => this.finishClose({ code: code ?? 1000, reason: reason ?? '' }),
      })
    } catch {
      this.finishClose({ code: code ?? 1000, reason: reason ?? '' })
    }
  }

  addEventListener(type: string, listener: EventListener): void {
    const set = this.listeners.get(type) ?? new Set<EventListener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  private handleOpen(): void {
    this.clearSyntheticClose()
    this.readyState = UniSocketAdapter.OPEN
    const event = { type: 'open' } as Event
    this.emit('open', event)
    this.onopen?.call(this, event)
  }

  private handleMessage(result: SocketMessage): void {
    const event = { data: result.data } as MessageEvent
    this.emit('message', event)
    this.onmessage?.call(this, event)
  }

  private handleClose(result: SocketCloseDetail): void {
    this.finishClose({ code: result?.code ?? 1006, reason: result?.reason ?? '' })
  }

  private handleError(result: unknown): void {
    this.emitError(result)
    if (
      this.readyState === UniSocketAdapter.CONNECTING &&
      !this.closeDispatched &&
      this.syntheticCloseTimer === null
    ) {
      this.syntheticCloseTimer = setTimeout(() => {
        this.syntheticCloseTimer = null
        if (this.readyState === UniSocketAdapter.CONNECTING && !this.closeDispatched) {
          this.finishClose({ code: 1006, reason: 'socket error before open' })
        }
      }, ERROR_CLOSE_GRACE_MS)
    }
  }

  private finishClose(detail: { code: number; reason: string }): void {
    if (this.closeDispatched) return
    this.closeDispatched = true
    this.clearSyntheticClose()
    this.readyState = UniSocketAdapter.CLOSED
    const event = { type: 'close', code: detail.code, reason: detail.reason } as CloseEvent
    this.emit('close', event)
    this.onclose?.call(this, event)
  }

  private emitError(error: unknown): void {
    const event = error as Event
    this.emit('error', event)
    this.onerror?.call(this, event)
  }

  private emit(type: string, event: unknown): void {
    const set = this.listeners.get(type)
    if (set === undefined) return
    for (const listener of [...set]) {
      try {
        listener(event as Event)
      } catch {
        // 监听方异常不影响传输事件派发
      }
    }
  }

  private clearSyntheticClose(): void {
    if (this.syntheticCloseTimer !== null) {
      clearTimeout(this.syntheticCloseTimer)
      this.syntheticCloseTimer = null
    }
  }
}
