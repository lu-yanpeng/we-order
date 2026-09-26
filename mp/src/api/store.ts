/**
 * 门店 API 层
 *
 * 统一数据入口，隐藏数据来源（AD-1）。
 * Phase 3 Epic 1：数据源仍是 Mock，返回形状已对齐服务端 `public.stores` 行
 * （types/api-contracts.ts 的 StoreInfo）。
 */
import type { StoreInfo } from '@/types/api-contracts'
import { mockStore } from '@/mock/store'

/** 获取门店信息 */
export async function fetchStore(): Promise<StoreInfo> {
  return mockStore
}
