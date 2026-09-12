/**
 * 价格与规格摘要计算 — 纯函数集合
 *
 * 不依赖 Vue 响应式系统，可独立测试。
 */
import type { SpecGroup } from '@/types/product'
import type { DiningMode } from '@/types/order'

/**
 * 计算规格选项的累计加价金额
 *
 * @param specGroups 规格组列表
 * @param selections 用户选择的规格值，key=groupId, value=optionId(s)
 * @returns 全部规格选项的加价总和
 */
export function calcSpecExtras(
  specGroups: SpecGroup[],
  selections: Record<string, string | string[]>,
): number {
  let extra = 0
  for (const group of specGroups) {
    const val = selections[group.id]
    if (!val) continue
    if (group.multi) {
      const ids = val as string[]
      for (const id of ids) {
        const opt = group.options.find((o) => o.id === id)
        if (opt) extra += opt.priceExtra
      }
    } else {
      const opt = group.options.find((o) => o.id === val)
      if (opt) extra += opt.priceExtra
    }
  }
  return extra
}

/**
 * 生成规格摘要字符串
 *
 * @example "大杯 Grande / 冰饮推荐 / 燕麦奶 / 正常糖 / 正常冰"
 *
 * @param specGroups 规格组列表
 * @param selections 用户选择的规格值
 * @returns 用 " / " 分隔的规格摘要，无规格时返回空字符串
 */
export function buildSpecSummary(
  specGroups: SpecGroup[],
  selections: Record<string, string | string[]>,
): string {
  const parts: string[] = []

  for (const group of specGroups) {
    const val = selections[group.id]
    if (!val) continue
    if (group.multi) {
      const ids = val as string[]
      for (const id of ids) {
        const label = group.options.find((o) => o.id === id)?.label
        if (label) parts.push(label)
      }
    } else {
      const label = group.options.find((o) => o.id === val)?.label
      if (label) parts.push(label)
    }
  }

  return parts.join(' / ')
}

/**
 * 计算商品最终价格（数量 × 单价）
 *
 * 有规格时单价 = 基础价 + 规格加价；无规格时单价 = 基础价。
 * 最终价 = 单价 × 数量。
 *
 * @param basePrice 商品基础价格
 * @param specGroups 规格组列表
 * @param selections 用户选择的规格值
 * @param count 购买数量（无规格时即为购买数量，有规格时也为购买数量）
 * @param hasSpecs 是否有规格组
 * @returns 最终价格
 */
export function calcTotalPrice(
  basePrice: number,
  specGroups: SpecGroup[],
  selections: Record<string, string | string[]>,
  count: number,
  hasSpecs: boolean,
): number {
  const unitPrice = hasSpecs ? basePrice + calcSpecExtras(specGroups, selections) : basePrice
  return unitPrice * count
}

/**
 * 计算包装费（FR-7）
 *
 * @param mode 就餐方式
 * @returns 外带 ¥2，堂食免收
 */
export function calcPackagingFee(mode: DiningMode): number {
  return mode === 'takeout' ? 2 : 0
}
