/**
 * 存量清理 gate 单元测试（P3 Story 1.4；AD-15 / AR-P3-19）
 *
 * 用 stub 的 `uni` 存储验证 `migrateStorageOnce()` 的版本判定、清理集合、
 * session 保留与异常容错。全部同步 API，不需要 fake timers。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateStorageOnce } from './storage'

const VERSION_KEY = 'weorder_schema_version'
const SESSION_KEY = 'weorder_session'
const STALE_KEYS = ['weorder_orders', 'weorder_cart', 'weorder_checkout_intent'] as const

let stored: Record<string, unknown>
let removedKeys: string[]

beforeEach(() => {
  stored = {}
  removedKeys = []
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => stored[key] ?? '',
    setStorageSync: (key: string, value: unknown) => {
      stored[key] = value
    },
    removeStorageSync: (key: string) => {
      removedKeys.push(key)
      delete stored[key]
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 预置 Mock 时代三件存量数据 */
function seedStaleData(): void {
  stored['weorder_orders'] = JSON.stringify([{ id: 'mock-order' }])
  stored['weorder_cart'] = JSON.stringify([{ productId: 'mock-product', quantity: 2 }])
  stored['weorder_checkout_intent'] = JSON.stringify({ key: 'intent-1' })
}

describe('migrateStorageOnce（启动存量清理 gate）', () => {
  it('版本缺失：清空三个存量 key、写入版本 3，保留 weorder_session', () => {
    seedStaleData()
    stored[SESSION_KEY] = JSON.stringify({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1,
      userId: 'user-1',
    })

    migrateStorageOnce()

    for (const key of STALE_KEYS) {
      expect(stored[key]).toBeUndefined()
    }
    expect(stored[VERSION_KEY]).toBe(3)
    expect(stored[SESSION_KEY]).toBeDefined()
  })

  it('旧版本（2）：同样清空存量并升级到 3', () => {
    seedStaleData()
    stored[VERSION_KEY] = 2

    migrateStorageOnce()

    for (const key of STALE_KEYS) {
      expect(stored[key]).toBeUndefined()
    }
    expect(stored[VERSION_KEY]).toBe(3)
  })

  it('版本已是 3：空转，不清真实购物车、不触碰存储', () => {
    const cart = JSON.stringify([{ productId: 'real-product', quantity: 1 }])
    stored['weorder_cart'] = cart
    stored['weorder_orders'] = JSON.stringify([{ id: 'real-order' }])
    stored[VERSION_KEY] = 3

    migrateStorageOnce()

    expect(stored['weorder_cart']).toBe(cart)
    expect(stored['weorder_orders']).toBeDefined()
    expect(removedKeys).toEqual([])
    expect(stored[VERSION_KEY]).toBe(3)
  })

  it('版本高于当前（未来版本 / 降级）：空转，不重复清理、不改写版本戳', () => {
    const cart = JSON.stringify([{ productId: 'real-product', quantity: 1 }])
    stored['weorder_cart'] = cart
    stored[VERSION_KEY] = 4

    migrateStorageOnce()

    expect(stored['weorder_cart']).toBe(cart)
    expect(removedKeys).toEqual([])
    expect(stored[VERSION_KEY]).toBe(4)
  })

  it('重复调用幂等：第二次不再触碰存储', () => {
    seedStaleData()

    migrateStorageOnce()
    expect(removedKeys).toHaveLength(3)

    migrateStorageOnce()
    expect(removedKeys).toHaveLength(3)
  })

  it('存储异常：不抛错、不写版本戳（下次启动重试）', () => {
    seedStaleData()
    vi.stubGlobal('uni', {
      getStorageSync: (key: string) => stored[key] ?? '',
      setStorageSync: (key: string, value: unknown) => {
        stored[key] = value
      },
      removeStorageSync: () => {
        throw new Error('storage unavailable')
      },
    })

    expect(() => migrateStorageOnce()).not.toThrow()
    expect(stored[VERSION_KEY]).toBeUndefined()
  })
})
