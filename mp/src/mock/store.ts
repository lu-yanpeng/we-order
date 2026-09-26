/**
 * 门店 Mock 数据
 *
 * 数据形状 = 服务端 `public.stores` 行（`StoreInfo`，见 types/api-contracts.ts）；
 * 门店名称 / 地址 / 电话沿用 HTML 原型（docs/starbucks-ordering-program-8.html）。
 * 仅存续到 Epic 2 目录切换真实数据前（ADR 允许临时 Mock）。
 */
import type { StoreInfo } from '@/types/api-contracts'

export const mockStore: StoreInfo = {
  id: '00000000-0000-4000-8000-0000000000ff',
  name: '星巴克 啡快自提店',
  address: '北京市朝阳区创意产业园 A 座 1 层',
  phone: '010-88888888',
}
