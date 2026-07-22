/**
 * 购物车 Composable — Pinia Store 唯一写入口
 *
 * 职责：
 * 1. 初始化时从 localStorage 加载购物车
 * 2. 购物车变更时自动持久化到 localStorage
 * 3. 暴露 addItem / removeItem / updateQuantity / clearCart 等操作方法
 * 4. 暴露 totalCount / totalPrice / items 等派生状态
 *
 * 遵循 AD-1：localStorage 读写经由 api/cart
 * 遵循 AD-8：仅此 composable 对 cart store 持有写权限
 */
import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCartStore } from '@/stores/cart'
import { loadCartString, saveCartString } from '@/api/cart'
import type { CartItem } from '@/types/product'

let _initialized = false

export function useCart() {
  const store = useCartStore()
  const { items, totalCount, totalPrice } = storeToRefs(store)

  if (!_initialized) {
    const raw = loadCartString()
    if (raw) {
      try {
        const parsed: CartItem[] = JSON.parse(raw)
        store.setItems(parsed)
      } catch {
        // 解析失败则从空购物车开始
      }
    }
    _initialized = true
  }

  watch(
    items,
    () => {
      saveCartString(JSON.stringify(items.value))
    },
    { deep: true, flush: 'post' },
  )

  function addItem(item: CartItem) {
    store.addItem(item)
  }

  function removeItem(productId: string, selections: Record<string, string | string[]>) {
    store.removeItem(productId, selections)
  }

  function updateQuantity(
    productId: string,
    selections: Record<string, string | string[]>,
    quantity: number,
  ) {
    store.updateQuantity(productId, selections, quantity)
  }

  function clearCart() {
    store.clearCart()
  }

  return {
    items,
    totalCount,
    totalPrice,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
  }
}
