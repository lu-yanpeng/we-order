/**
 * 门店 Mock 数据
 *
 * Phase 1 使用固定的模拟门店（PRD §8 数据策略），不做门店切换。
 * 门店名称 / 地址 / 电话沿用 HTML 原型（docs/starbucks-ordering-program-8.html）。
 */
import type { Store } from '@/types/store'

export const mockStore: Store = {
  name: '星巴克 啡快自提店',
  address: '北京市朝阳区创意产业园 A 座 1 层',
  phone: '010-88888888',
}
