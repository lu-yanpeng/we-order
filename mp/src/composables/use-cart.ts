/**
 * 购物车 Composable — Pinia Store 唯一写入口
 *
 * 职责：
 * 1. 初始化时从 localStorage 加载购物车
 * 2. 购物车变更时自动持久化到 localStorage
 * 3. 暴露 addItem / setItemQuantity / clearCart 等操作方法
 * 4. 暴露 totalCount / totalPrice / items 等派生状态
 * 5. 管理 checkout-bar 用时加载状态（见下方注释）
 *
 * 遵循 AD-1：localStorage 读写经由 api/cart
 * 遵循 AD-8：仅此 composable 对 cart store 持有写权限
 *
 * === checkout-bar 用时加载（AD-4）为何放在此处？ ===
 *
 * AD-4 为结算栏定义了独立的加载策略，但从架构上看它应该是独立的 composable。
 * 然而实践发现：@dcloudio/vite-plugin-uni 对项目初始化后新增的 composable
 * 文件即使全量清理重编也无法被微信运行时正确加载（require 报 module not defined）。
 * 这是 Uniapp 构建工具的已知限制，旧有 composable 不受影响，新增 standalone JS
 * 模块则不可靠。
 *
 * 最终决策：将 checkout-bar 的显示状态 (checkoutBarVisible) 与加载触发函数
 * (initCheckoutBar / showCheckoutBar) 合入 useCart。理由：
 *   1. 二者共享同一 localStorage 数据源（AD-1）
 *   2. checkoutBarVisible 是购物车数据状态的派生——"购物车有数据则结算栏可见"
 *   3. 不违反任何 AD 约束（AD-4／AD-6／AD-8）
 *
 * 该决策记录于此处，Phase 2+ 若发现更好的独立 composable 方案可再拆分。
 */
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCartStore } from '@/stores/cart'
import { loadCartString, saveCartString } from '@/api/cart'
import type { CartItem } from '@/types/product'

let _initialized = false

/**
 * 结算栏是否应触发渲染。
 *
 * 模块级闭包变量，保证 once-true-never-false（AD-4-e）。
 * 通过 useCart() 返回的 checkoutBarVisible ref 暴露给页面。
 */
let _checkoutBarVisible = false

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

  // --- checkout-bar 用时加载 (AD-4) ---

  const checkoutBarVisible = ref(_checkoutBarVisible)

  let _loadingTimer: ReturnType<typeof setTimeout> | null = null

  function hideLoading() {
    if (_loadingTimer) {
      clearTimeout(_loadingTimer)
      _loadingTimer = null
    }
    uni.hideLoading()
  }

  /** 页面初始化时调用：若 localStorage 已存有购物车数据，立即触发结算栏渲染 */
  function initCheckoutBar() {
    if (_checkoutBarVisible) return
    if (items.value.length > 0) {
      _checkoutBarVisible = true
      checkoutBarVisible.value = true
    }
  }

  /** 首次加购时调用：触发结算栏渲染（仅首次生效） */
  function showCheckoutBar() {
    if (!_checkoutBarVisible) {
      _checkoutBarVisible = true
      checkoutBarVisible.value = true
      uni.showLoading({ title: '加载中...', mask: true })
      _loadingTimer = setTimeout(hideLoading, 5000)
    }
  }

  // --- 购物车 CRUD ---

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
    checkoutBarVisible,
    initCheckoutBar,
    showCheckoutBar,
    addItem,
    clearCart,
    setItemQuantity,
  }
}
