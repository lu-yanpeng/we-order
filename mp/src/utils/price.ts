/**
 * 价格与规格摘要计算 — 纯函数集合
 *
 * 不依赖 Vue 响应式系统，可独立测试。
 */
import type { SpecGroup } from '@/types/product'

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
 * 生成规格摘要字符串（在弹窗底部价格旁展示）
 *
 * @example "大杯 Grande / 冰饮推荐 / 燕麦奶 / 正常糖 / 正常冰 / 1份浓缩"
 *
 * @param specGroups 规格组列表
 * @param selections 用户选择的规格值
 * @param shotCount 浓缩份数
 * @returns 用 " / " 分隔的规格摘要
 */
export function buildSpecSummary(
  specGroups: SpecGroup[],
  selections: Record<string, string | string[]>,
  shotCount: number,
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

  parts.push(`${shotCount}份浓缩`)
  return parts.join(' / ')
}

/**
 * 计算商品最终价格（含规格加价与浓缩份数加价）
 *
 * 业务规则：浓缩份数 > 1 时，每额外一份 +¥4。
 * 无规格时为基础价 × 购买数量。
 *
 * @param basePrice 商品基础价格
 * @param specGroups 规格组列表
 * @param selections 用户选择的规格值
 * @param shotCount 浓缩份数（无规格时即为购买数量）
 * @param hasSpecs 是否有规格组
 * @returns 最终价格
 */
export function calcTotalPrice(
  basePrice: number,
  specGroups: SpecGroup[],
  selections: Record<string, string | string[]>,
  shotCount: number,
  hasSpecs: boolean,
): number {
  if (!hasSpecs) {
    return basePrice * shotCount
  }
  let price = basePrice + calcSpecExtras(specGroups, selections)
  if (shotCount > 1) {
    price += (shotCount - 1) * 4
  }
  return price
}
