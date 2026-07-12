/**
 * 规格弹窗状态管理
 *
 * 职责：控制弹窗显隐和当前选中商品。
 * 弹窗组件始终挂载，通过 v-model:visible 控制显示。
 */
import { ref } from 'vue'
import type { Product } from '@/types/product'

export function useSpecSheet() {
  /** 弹窗是否可见 */
  const visible = ref(false)
  /** 当前正在选规格的商品 */
  const currentProduct = ref<Product | null>(null)

  /** 打开弹窗，传入目标商品 */
  const open = (product: Product) => {
    currentProduct.value = product
    visible.value = true
  }

  /** 关闭弹窗 */
  const close = () => {
    visible.value = false
  }

  return { visible, currentProduct, open, close }
}
