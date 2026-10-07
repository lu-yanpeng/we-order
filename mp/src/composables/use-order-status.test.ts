/**
 * 订单刷新编排 Composable 单元测试（P3 Story 4.3；FR-P3-12 / AD-8）
 *
 * 用 mock 的 `read` + fake timers 驱动，不发起真实网络请求：
 * 1. 进入可见域立即读一次 + 5s 轮询；离开 / dispose 停表；
 * 2. 重新进入立即读一次并重置轮询计时；手动读取立即执行 + 重置计时；
 *    操作触发读取（runAutoRead，Story 4.5）立即执行 auto 语义 + 重置计时；
 * 3. shouldPoll（空态 / 终态）停轮询、恢复后重排；
 * 4. 串行化：在飞时自动读取合并（不重复）、手动读取等待后补跑（不丢弃）；
 * 5. 连续失败 3 次降级为手动刷新入口；任一成功清零并恢复轮询；
 * 6. 订阅健康 → 不轮询；恢复非健康 → 回退轮询；seq 铸造递增；
 * 7. 订阅接线（bindSubscription，Story 5.2）：进入 subscribed 先补读再停轮询、非健康回退、
 *    在飞合并、补读失败静默、解绑 / dispose 后状态不再生效。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CONSECUTIVE_FAILURES, POLL_INTERVAL_MS, useOrderStatus } from './use-order-status'
import type { OrderReadKind } from './use-order-status'
import type { RealtimeConnectionStatus, RealtimeSubscriptionHandle } from '@/types/realtime'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useOrderStatus 刷新编排（Story 4.3）', () => {
  it('进入可见域立即读一次并启动 5s 轮询；离开停表', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })

    await s.setActive(true)
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenNthCalledWith(1, 1, 'auto')
    expect(s.isPolling.value).toBe(true)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenNthCalledWith(2, 2, 'auto')

    await s.setActive(false)
    expect(s.isPolling.value).toBe(false)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('重新进入可见域：立即读一次并重置轮询计时', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })

    await s.setActive(true) // 读 1，计时器在 5000
    await vi.advanceTimersByTimeAsync(3000)
    expect(read).toHaveBeenCalledTimes(1)

    await s.setActive(false)
    await s.setActive(true) // 读 2 立即，计时器重置在 3000 + 5000
    expect(read).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('shouldPoll 为 false（空态 / 终态）不轮询；恢复且读取成功后重排', async () => {
    let pollable = false
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read, shouldPoll: () => pollable })

    await s.setActive(true) // 进入读取不受 shouldPoll 限制
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(1)

    await s.runManualRead()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    expect(read).toHaveBeenCalledTimes(2)

    pollable = true
    await s.runManualRead()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('手动读取：立即执行、完成后重置轮询计时', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })

    await s.setActive(true) // 读 1，计时器在 5000
    await vi.advanceTimersByTimeAsync(2000)

    await s.runManualRead() // 读 2 立即（2000），计时器重置在 7000
    expect(read).toHaveBeenNthCalledWith(2, 2, 'manual')

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(3)
    expect(read).toHaveBeenNthCalledWith(3, 3, 'auto')
  })

  it('操作触发读取（runAutoRead）：立即执行 auto 语义并重置轮询计时', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })

    await s.setActive(true) // 读 1，计时器在 5000
    await vi.advanceTimersByTimeAsync(2000)

    await s.runAutoRead() // 读 2 立即（2000），auto 语义（合并 / 静默），计时器重置在 7000
    expect(read).toHaveBeenNthCalledWith(2, 2, 'auto')

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(3)
    expect(read).toHaveBeenNthCalledWith(3, 3, 'auto')
  })

  it('操作触发读取在在飞时合并跳过（同 auto 语义）；dispose 后 no-op', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const read = vi
      .fn<(seq: number, kind: OrderReadKind) => Promise<boolean>>()
      .mockImplementationOnce(async () => {
        await gate
        return true
      })
      .mockImplementation(async () => true)

    const s = useOrderStatus({ read })
    const entering = s.setActive(true)
    const actionRead = s.runAutoRead()
    expect(read).toHaveBeenCalledTimes(1) // 在飞时合并跳过，不并发

    release()
    await entering
    await actionRead
    expect(read.mock.calls.map((call) => call[1])).toEqual(['auto'])

    s.dispose()
    await s.runAutoRead()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('串行化：在飞时自动读取合并（不重复）、手动读取等待后补跑（不丢弃）', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const read = vi
      .fn<(seq: number, kind: OrderReadKind) => Promise<boolean>>()
      .mockImplementationOnce(async () => {
        await gate
        return true
      })
      .mockImplementation(async () => true)

    const s = useOrderStatus({ read })
    const entering = s.setActive(true)
    expect(read).toHaveBeenCalledTimes(1)

    // 在飞期间：轮询计时器尚未排定（读取完成后才重排）；进入 / 手动都合并进这同一跳
    const reentering = s.setActive(true)
    const manual = s.runManualRead()
    expect(read).toHaveBeenCalledTimes(1)

    release()
    await entering
    await reentering
    await manual
    expect(read.mock.calls.map((call) => call[1])).toEqual(['auto', 'manual'])
    expect(read.mock.calls.map((call) => call[0])).toEqual([1, 2])

    // 补跑完成后恢复正常轮询
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('连续失败达到上限即降级：停止轮询、手动仍可执行；成功清零并恢复', async () => {
    const read = vi.fn(async () => false)
    const s = useOrderStatus({ read })

    await s.setActive(true) // 失败 1
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // 失败 2
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // 失败 3 → 降级
    expect(read).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES)
    expect(s.isPolling.value).toBe(false)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES)

    // 降级后手动刷新入口仍可用；成功 → 清零 → 恢复轮询
    read.mockResolvedValue(true)
    await s.runManualRead()
    expect(read).toHaveBeenCalledTimes(4)
    expect(s.isPolling.value).toBe(true)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(5)
  })

  it('订阅健康 → 不轮询；恢复非健康 → 回退轮询', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })

    await s.setActive(true)
    s.setSubscriptionHealthy(true)
    expect(s.isPolling.value).toBe(false)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(1)

    s.setSubscriptionHealthy(false)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('seq 铸造递增；nextSeq 供分页等外部读取复用同一序号流', async () => {
    const read = vi.fn<(seq: number, kind: OrderReadKind) => Promise<boolean>>(async () => true)
    const s = useOrderStatus({ read })

    await s.setActive(true) // seq 1
    expect(s.nextSeq()).toBe(2) // 分页读取
    await s.runManualRead() // seq 3
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // seq 4

    expect(read.mock.calls.map((call) => call[0])).toEqual([1, 3, 4])
  })

  it('read 抛异常按失败计数（防御），不打断后续调度', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true)
    const s = useOrderStatus({ read })

    await s.setActive(true) // 异常 → 失败 1 → 仍排定下一次
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(2)
    expect(s.isPolling.value).toBe(true)
  })

  it('dispose：停表且之后所有入口 no-op', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })

    await s.setActive(true)
    s.dispose()
    expect(s.isPolling.value).toBe(false)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(1)

    await s.setActive(true)
    await s.runManualRead()
    s.setSubscriptionHealthy(true)
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('useOrderStatus 订阅接线（Story 5.2；AD-8）', () => {
  /** 可控假订阅句柄：注册时立即回调当前状态（同 core/realtime 契约），之后经 emit 驱动 */
  function fakeSubscription(initial: RealtimeConnectionStatus = 'connecting') {
    const listeners = new Set<(status: RealtimeConnectionStatus) => void>()
    let current = initial
    const handle: RealtimeSubscriptionHandle = {
      unsubscribe: vi.fn(),
      onStatus: (callback) => {
        listeners.add(callback)
        callback(current)
        return () => {
          listeners.delete(callback)
        }
      },
    }
    return {
      handle,
      emit: (status: RealtimeConnectionStatus) => {
        current = status
        for (const listener of [...listeners]) listener(status)
      },
    }
  }

  it('订阅健康：先补读一次再停轮询；恢复非健康回退轮询；再次健康再补读', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })
    const sub = fakeSubscription()

    await s.setActive(true) // 读 1（进入）；轮询已排
    expect(s.isPolling.value).toBe(true)
    s.bindSubscription(sub.handle)
    expect(read).toHaveBeenCalledTimes(1)

    sub.emit('subscribed') // 补读（读 2）+ 停轮询
    expect(read).toHaveBeenCalledTimes(2)
    expect(s.isPolling.value).toBe(false)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(2) // 订阅健康 → 不轮询

    sub.emit('connecting') // 断开 → 回退轮询
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(3)

    sub.emit('subscribed') // 恢复 → 补读一次再停
    expect(read).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('unavailable（会话未就绪 / 放弃重连）回退轮询', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })
    const sub = fakeSubscription()

    await s.setActive(true) // 读 1
    s.bindSubscription(sub.handle)
    sub.emit('unavailable')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(2) // 回退轮询可用

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('补读在在飞读取时合并（不并发）；订阅健康后读取链收尾不再排轮询', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const read = vi
      .fn<(seq: number, kind: OrderReadKind) => Promise<boolean>>()
      .mockImplementationOnce(async () => {
        await gate
        return true
      })
      .mockImplementation(async () => true)

    const s = useOrderStatus({ read })
    const entering = s.setActive(true) // 读 1 在飞
    const sub = fakeSubscription()
    s.bindSubscription(sub.handle)

    sub.emit('subscribed') // 补读合并进在飞读取
    expect(read).toHaveBeenCalledTimes(1)

    release()
    await entering
    expect(s.isPolling.value).toBe(false)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('补读失败：静默且不恢复轮询（D3 决策：由下一次推送 / 进页面 / 手动刷新自愈）', async () => {
    const read = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
    const s = useOrderStatus({ read })
    const sub = fakeSubscription()

    await s.setActive(true) // 读 1 成功
    s.bindSubscription(sub.handle)
    sub.emit('subscribed') // 补读（读 2）失败
    expect(read).toHaveBeenCalledTimes(2)
    expect(s.isPolling.value).toBe(false)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('解绑后迟到状态不再影响策略', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })
    const sub = fakeSubscription()

    await s.setActive(true) // 读 1
    const detach = s.bindSubscription(sub.handle)
    sub.emit('subscribed') // 读 2 + 停轮询
    expect(read).toHaveBeenCalledTimes(2)

    detach()
    sub.emit('connecting')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(2) // 不回退、不读取
  })

  it('注册时已是 subscribed（复用句柄）：立即补读一次并停轮询', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })

    await s.setActive(true) // 读 1；轮询已排
    expect(s.isPolling.value).toBe(true)

    const sub = fakeSubscription('subscribed')
    s.bindSubscription(sub.handle) // 注册即回调当前状态
    expect(read).toHaveBeenCalledTimes(2)
    expect(s.isPolling.value).toBe(false)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('dispose 后订阅状态不再驱动策略', async () => {
    const read = vi.fn(async () => true)
    const s = useOrderStatus({ read })
    const sub = fakeSubscription()

    await s.setActive(true) // 读 1
    s.bindSubscription(sub.handle)
    sub.emit('subscribed') // 读 2
    s.dispose()

    sub.emit('connecting')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
