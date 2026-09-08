/**
 * 购物车 API 层
 *
 * 负责购物车的 localStorage 持久化读写。
 * Phase 1 使用 uni.getStorageSync / uni.setStorageSync。
 *
 * 遵循 AD-1：外部数据源读写经由 API 层统一入口。
 */

const STORAGE_KEY = 'weorder_cart'

export function loadCartString(): string | null {
  try {
    return uni.getStorageSync(STORAGE_KEY) as string | null
  } catch {
    return null
  }
}

export function saveCartString(raw: string): void {
  try {
    uni.setStorageSync(STORAGE_KEY, raw)
  } catch {
    // localStorage 写入失败时静默忽略
  }
}
