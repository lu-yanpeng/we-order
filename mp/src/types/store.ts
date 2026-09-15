/**
 * 门店信息 — 自提门店
 *
 * Phase 1 使用固定的 Mock 门店（PRD §8 数据策略），不做门店切换。
 */
export interface Store {
  /** 门店名称 */
  name: string
  /** 门店地址 */
  address: string
  /** 联系电话 */
  phone: string
}
