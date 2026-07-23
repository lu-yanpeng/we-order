/**
 * 规格弹窗状态管理与价格计算 Composable
 *
 * 职责：
 * 1. 控制弹窗显隐与当前选中商品
 * 2. 管理规格选择的表单状态（selections、count）
 * 3. 计算最终价格，封装业务规则（规格加价）
 * 4. 确认回调（关闭弹窗，购物车写入由页面编排）
 *
 * 遵循 AD-2：composable 导入 utils/price（依赖方向 ✓）
 * 遵循 AD-3：交互逻辑与价格规则封装在 Composable 内，组件纯展示
 *
 * 弹窗组件始终挂载，通过 v-model:visible 控制显示。
 */
import { computed, reactive, ref, watch } from 'vue'
import type { Product } from '@/types/product'
import { calcTotalPrice, calcSpecExtras, buildSpecSummary } from '@/utils/price'

export function useSpecSheet() {
  /** 弹窗是否可见 */
  const visible = ref(false)
  /** 当前正在选规格的商品 */
  const currentProduct = ref<Product | null>(null)

  // ---- 表单状态（从 SpecSheet 组件上移到 Composable） ----
  /** 各规格组的当前选中值: { groupId: optionId | optionId[] } */
  const selections = reactive<Record<string, string | string[]>>({})
  /** 步进器数量：有规格时为浓缩份数，无规格时为购买数量 */
  const count = ref(1)

  // ---- 派生 UI 状态 ----
  /** 当前商品是否有规格组 */
  const hasSpecs = computed(() => {
    if (!currentProduct.value) return false
    return !!(currentProduct.value.specGroups && currentProduct.value.specGroups.length > 0)
  })

  /** 单件单价：有规格 = 基础价 + 规格加价，无规格 = 基础价 */
  const unitPrice = computed(() => {
    if (!currentProduct.value) return 0
    if (hasSpecs.value) {
      return (
        currentProduct.value.price + calcSpecExtras(currentProduct.value.specGroups!, selections)
      )
    }
    return currentProduct.value.price
  })

  // ---- 价格计算（业务规则在此，不侵入组件） ----
  /**
   * 计算最终价格
   * - 有规格：(基础价 + 规格加价) × 数量
   * - 无规格：基础价 × 数量
   */
  const totalPrice = computed(() => {
    if (!currentProduct.value) return 0
    const groups = currentProduct.value.specGroups || []
    return calcTotalPrice(
      currentProduct.value.price,
      groups,
      selections,
      count.value,
      hasSpecs.value,
    )
  })

  /** 价格旁的摘要文案 */
  const priceLabel = computed(() => {
    if (!currentProduct.value) return ''
    if (hasSpecs.value) {
      const summary = buildSpecSummary(currentProduct.value.specGroups!, selections)
      return `${summary} x${count.value}`
    }
    return `x${count.value}`
  })

  /** 纯规格摘要（不含数量），用于加入购物车时存储 */
  const specSummary = computed(() => {
    if (!currentProduct.value || !hasSpecs.value) return ''
    return buildSpecSummary(currentProduct.value.specGroups!, selections)
  })

  // ---- 表单操作方法 ----
  /** 重置规格选择为默认值（每次弹窗打开时调用） */
  const initSelections = () => {
    Object.keys(selections).forEach((k) => delete selections[k])
    if (!currentProduct.value) return
    const groups = currentProduct.value.specGroups || []
    for (const group of groups) {
      selections[group.id] = group.multi ? [] : group.options[0]?.id || ''
    }
    count.value = 1
  }

  /** 判断某个规格选项是否被选中 */
  const isActive = (groupId: string, optionId: string) => {
    const val = selections[groupId]
    if (Array.isArray(val)) return val.includes(optionId)
    return val === optionId
  }

  /** 切换规格选项的选中状态 */
  const toggleOption = (groupId: string, optionId: string) => {
    if (!currentProduct.value) return
    const groups = currentProduct.value.specGroups || []
    const group = groups.find((g) => g.id === groupId)
    if (!group) return

    if (group.multi) {
      const arr = (selections[groupId] as string[]) || []
      const idx = arr.indexOf(optionId)
      if (idx > -1) {
        arr.splice(idx, 1)
      } else {
        arr.push(optionId)
      }
    } else {
      selections[groupId] = optionId
    }
  }

  /** 步进器 +/- 操作，下限为 1 */
  const updateCount = (delta: number) => {
    count.value = delta
  }

  // ---- 弹窗生命周期 ----
  /** 弹窗打开时重置规格选择 */
  watch(
    () => visible.value,
    (isVisible) => {
      if (isVisible) {
        initSelections()
      }
    },
  )

  /** 打开弹窗，传入目标商品 */
  const open = (product: Product) => {
    currentProduct.value = product
    visible.value = true
  }

  /** 关闭弹窗 */
  const close = () => {
    visible.value = false
  }

  /**
   * 确认回调：关闭弹窗，由页面编排调用方负责购物车写入
   */
  const confirm = () => {
    close()
  }

  return {
    // 弹窗控制
    visible,
    currentProduct,
    open,
    close,
    confirm,
    // 表单状态（通过 props 传给组件）
    selections,
    count,
    // 计算值（通过 props 传给组件）
    hasSpecs,
    stepperLabel: '数量',
    unitPrice,
    totalPrice,
    priceLabel,
    specSummary,
    // 操作方法（组件通过 emit 触发）
    isActive,
    toggleOption,
    updateCount,
  }
}
