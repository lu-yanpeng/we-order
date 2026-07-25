/**
 * 结算栏按需加载 Composable（AD-4）
 *
 * 职责：
 * 1. 管理结算栏可见性状态（once-true-never-false，AD-4-e）
 * 2. 页面初始化时根据购物车数据决定是否触发渲染（initCheckoutBar）
 * 3. 首次加购时触发渲染（showCheckoutBar）
 *
 * 遵循 AD-4：结算栏位于分包中，使用占位组件机制按需加载。
 * 遵循 AD-8：此 composable 不会写入 cart store。
 */

import { ref, type Ref } from 'vue'
import type { CartItem } from '@/types/product'

/** 模块级闭包，保证 once-true-never-false（AD-4-e） */
let _checkoutBarVisible = false

let _loadingTimer: ReturnType<typeof setTimeout> | null = null

function hideLoading() {
  if (_loadingTimer) {
    clearTimeout(_loadingTimer)
    _loadingTimer = null
  }
  uni.hideLoading()
}

export function useCheckoutBar(items: Ref<CartItem[]>) {
  const checkoutBarVisible = ref(_checkoutBarVisible)

  /** 页面初始化时调用：若购物车已有数据，立即触发结算栏渲染 */
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
      // 结算栏分包加载超时兜底：超时后自动隐藏 loading
      _loadingTimer = setTimeout(hideLoading, 5000)
    }
  }

  return {
    checkoutBarVisible,
    initCheckoutBar,
    showCheckoutBar,
  }
}
