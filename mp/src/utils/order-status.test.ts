/**
 * 订单状态应用纯函数单元测试（P3 Story 4.3；AD-7）
 *
 * 覆盖：状态排序 / 单调推进（completed 终态、同值幂等）、序号门（旧响应忽略）、
 * 列表合并只增不删、整表替换的状态单调与 applied 重置、分页追加去重。
 */
import { describe, expect, it } from 'vitest'
import type { OrderStatus } from '@/types/api-contracts'
import {
  advanceStatus,
  appendOrderPage,
  applyOrderRead,
  mergeOrderList,
  replaceOrderList,
  statusRank,
  type OrderLike,
} from './order-status'

/** 测试用最小订单行：覆盖「其余字段取新值」与「状态单调」两个维度 */
interface Row extends OrderLike {
  total: number
}

const row = (id: string, status: OrderStatus, total = 0): Row => ({ id, status, total })

describe('statusRank / advanceStatus（状态排序与单调）', () => {
  it('排序：cooking < pickup < completed', () => {
    expect(statusRank('cooking')).toBeLessThan(statusRank('pickup'))
    expect(statusRank('pickup')).toBeLessThan(statusRank('completed'))
  })

  it('只前进不倒退、同值幂等、completed 终态不可逆', () => {
    expect(advanceStatus('cooking', 'pickup')).toBe('pickup')
    expect(advanceStatus('pickup', 'completed')).toBe('completed')
    expect(advanceStatus('cooking', 'cooking')).toBe('cooking')
    // 倒退 / 终态回退 → 保留当前值
    expect(advanceStatus('pickup', 'cooking')).toBe('pickup')
    expect(advanceStatus('completed', 'pickup')).toBe('completed')
    expect(advanceStatus('completed', 'cooking')).toBe('completed')
  })
})

describe('applyOrderRead（单条序号门 + 状态单调）', () => {
  it('未知 id（无历史序号）：应用本次结果', () => {
    const result = applyOrderRead<Row>(undefined, row('a', 'cooking', 10), 1, undefined)
    expect(result.applied).toBe(true)
    expect(result.order).toEqual(row('a', 'cooking', 10))
  })

  it('seq 更大：应用，但状态取单调值、其余字段取新值', () => {
    const current = row('a', 'pickup', 10)
    const advanced = applyOrderRead(current, row('a', 'completed', 12), 2, 1)
    expect(advanced.applied).toBe(true)
    expect(advanced.order).toEqual(row('a', 'completed', 12))

    // 服务端返回倒退状态：状态保留、其余字段照常更新
    const regressed = applyOrderRead(current, row('a', 'cooking', 20), 3, 2)
    expect(regressed.applied).toBe(true)
    expect(regressed.order).toEqual(row('a', 'pickup', 20))
  })

  it('seq 相同或更小：旧响应忽略、返回当前对象', () => {
    const current = row('a', 'pickup', 10)
    const same = applyOrderRead(current, row('a', 'cooking', 99), 5, 5)
    expect(same.applied).toBe(false)
    expect(same.order).toBe(current)

    const stale = applyOrderRead(current, row('a', 'cooking', 99), 4, 5)
    expect(stale.applied).toBe(false)
    expect(stale.order).toBe(current)
  })
})

describe('mergeOrderList（只增不删 + 序号门）', () => {
  it('已知 id 更新、未知 id 插入在前、未出现条目保留在尾部；不修改入参', () => {
    const current = [row('b', 'cooking', 1), row('c', 'cooking', 2)]
    const applied = new Map([['b', 1]])
    const merged = mergeOrderList(
      current,
      [row('a', 'cooking', 3), row('b', 'pickup', 11)],
      2,
      applied,
    )

    expect(merged.orders.map((o) => o.id)).toEqual(['a', 'b', 'c'])
    expect(merged.orders[1]).toEqual(row('b', 'pickup', 11))
    // applied：应用过的记 seq，新一轮序号推进
    expect(merged.applied.get('a')).toBe(2)
    expect(merged.applied.get('b')).toBe(2)
    // 入参不被修改
    expect(current.map((o) => o.id)).toEqual(['b', 'c'])
    expect(applied.get('b')).toBe(1)
  })

  it('陈旧读取（seq 更小）：已知 id 不覆盖、状态不倒退；未知 id 仍插入（只增不删）', () => {
    const current = [row('a', 'pickup', 10)]
    const applied = new Map([['a', 9]])
    const merged = mergeOrderList(
      current,
      [row('a', 'cooking', 99), row('z', 'cooking', 1)],
      3,
      applied,
    )

    expect(merged.orders[0]).toEqual(row('a', 'pickup', 10))
    expect(merged.orders[1]).toEqual(row('z', 'cooking', 1))
    expect(merged.applied.get('a')).toBe(9)
    expect(merged.applied.get('z')).toBe(3)
  })

  it('本次结果内的重复 id 去重（保留首个）', () => {
    const merged = mergeOrderList<Row>(
      [],
      [row('a', 'cooking', 1), row('a', 'pickup', 2)],
      1,
      new Map(),
    )
    expect(merged.orders).toEqual([row('a', 'cooking', 1)])
  })
})

describe('replaceOrderList（整表替换 + 状态单调）', () => {
  it('以本次结果为准：未出现条目被替换掉；同 id 状态单调；applied 重置为本次 seq', () => {
    const current = [row('a', 'pickup', 10), row('b', 'cooking', 1)]
    const replaced = replaceOrderList(current, [row('a', 'cooking', 99), row('c', 'cooking', 3)], 7)

    expect(replaced.orders.map((o) => o.id)).toEqual(['a', 'c'])
    // 倒退状态保留当前值，其余字段取新值
    expect(replaced.orders[0]).toEqual(row('a', 'pickup', 99))
    expect(replaced.applied.get('a')).toBe(7)
    expect(replaced.applied.get('c')).toBe(7)
    expect(replaced.applied.has('b')).toBe(false)
  })
})

describe('appendOrderPage（分页追加）', () => {
  it('只追加未知 id、跳过重复、保持顺序；记录追加条目序号', () => {
    const current = [row('a', 'cooking', 1)]
    const applied = new Map([['a', 1]])
    const appended = appendOrderPage(
      current,
      [row('a', 'pickup', 9), row('b', 'cooking', 2)],
      2,
      applied,
    )

    expect(appended.orders.map((o) => o.id)).toEqual(['a', 'b'])
    expect(appended.orders[0]).toEqual(row('a', 'cooking', 1))
    expect(appended.applied.get('b')).toBe(2)
    // 重复 id 不更新已有条目、不覆盖序号
    expect(appended.applied.get('a')).toBe(1)
  })

  it('无新条目时原样返回既有数组', () => {
    const current = [row('a', 'cooking', 1)]
    const appended = appendOrderPage(current, [row('a', 'cooking', 2)], 2, new Map())
    expect(appended.orders).toBe(current)
  })
})
