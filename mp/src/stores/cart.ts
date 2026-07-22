/**
 * 购物车 Pinia Store
 *
 * 仅管理购物车的内存状态（items 数组、派生计算），不负责持久化。
 * 持久化由 useCart composable 通过 API 层协调。
 *
 * 遵循 AD-6：Pinia 仅用于跨组件共享的响应式状态。
 * 遵循 AD-8：仅 useCart composable 持有写权限。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CartItem } from '@/types/product'

function selectionsKey(selections: Record<string, string | string[]>): string {
  const normalized: Record<string, string | string[]> = {}
  for (const key of Object.keys(selections).sort()) {
    const val = selections[key]
    normalized[key] = Array.isArray(val) ? [...val].sort() : val
  }
  return JSON.stringify(normalized)
}

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([])

  const totalCount = computed(() => items.value.reduce((s, i) => s + i.quantity, 0))
  const totalPrice = computed(() => items.value.reduce((s, i) => s + i.unitPrice * i.quantity, 0))

  function setItems(newItems: CartItem[]) {
    items.value = newItems
  }

  function addItem(item: CartItem) {
    const key = selectionsKey(item.selections)
    const existing = items.value.find(
      (i) => i.productId === item.productId && selectionsKey(i.selections) === key,
    )
    if (existing) {
      existing.quantity += item.quantity
    } else {
      items.value.push({ ...item })
    }
  }

  function removeItem(productId: string, selections: Record<string, string | string[]>) {
    const key = selectionsKey(selections)
    const idx = items.value.findIndex(
      (i) => i.productId === productId && selectionsKey(i.selections) === key,
    )
    if (idx > -1) {
      items.value.splice(idx, 1)
    }
  }

  function updateQuantity(
    productId: string,
    selections: Record<string, string | string[]>,
    quantity: number,
  ) {
    const key = selectionsKey(selections)
    const item = items.value.find(
      (i) => i.productId === productId && selectionsKey(i.selections) === key,
    )
    if (item) {
      item.quantity = quantity
    }
  }

  function clearCart() {
    items.value = []
  }

  return { items, totalCount, totalPrice, setItems, addItem, removeItem, updateQuantity, clearCart }
})
