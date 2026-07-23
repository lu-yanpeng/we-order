/**
 * 购物车 Composable — Pinia Store 唯一写入口
 *
 * 职责：
 * 1. 初始化时从 localStorage 加载购物车
 * 2. 购物车变更时自动持久化到 localStorage
 * 3. 暴露 addItem / setItemQuantity / clearCart 等操作方法
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

  function clearCart() {
    store.clearCart()
  }

  function setItemQuantity(item: CartItem, quantity: number) {
    if (quantity <= 0) {
      store.removeItem(item.productId, item.selections)
    } else {
      store.updateQuantity(item.productId, item.selections, quantity)
    }
  }

  return {
    items,
    totalCount,
    totalPrice,
    addItem,
    clearCart,
    setItemQuantity,
  }
}
