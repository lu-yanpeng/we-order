/**
 * 门店 API 层
 *
 * 统一数据入口，隐藏数据来源（AD-1）。
 * Phase 1 返回固定的 Mock 门店，Phase 2 对接 Supabase 后整体替换。
 * 不做人为延迟，避免首屏空态闪烁。
 */
import type { Store } from '@/types/store'
import { mockStore } from '@/mock/store'

/** 获取门店信息 */
export async function fetchStore(): Promise<Store> {
  return mockStore
}
