/**
 * 订单刷新编排 Composable 单元测试（P3 Story 4.3；FR-P3-12 / AD-8）
 *
 * 用 mock 的 `read` + fake timers 驱动，不发起真实网络请求：
 * 1. 进入可见域立即读一次 + 5s 轮询；离开 / dispose 停表；
 * 2. 重新进入立即读一次并重置轮询计时；手动读取立即执行 + 重置计时；
 * 3. shouldPoll（空态 / 终态）停轮询、恢复后重排；
 * 4. 串行化：在飞时自动读取合并（不重复）、手动读取等待后补跑（不丢弃）；
 * 5. 连续失败 3 次降级为手动刷新入口；任一成功清零并恢复轮询；
 * 6. 订阅健康 → 不轮询；恢复非健康 → 回退轮询；seq 铸造递增。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CONSECUTIVE_FAILURES, POLL_INTERVAL_MS, useOrderStatus } from './use-order-status'
import type { OrderReadKind } from './use-order-status'

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
