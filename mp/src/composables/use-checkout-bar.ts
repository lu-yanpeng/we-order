/**
 * 结算栏按需加载 Composable（AD-4）
 *
 * 职责：
 * 1. 管理结算栏可见性状态（once-true-never-false，AD-4-e）
 * 2. 页面初始化时根据购物车数据决定是否触发渲染（initCheckoutBar）
 * 3. 首次加购时触发渲染（showCheckoutBar）
 * 4. 结算跳转与防重复点击（goToCheckout）
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

/** 清除分包加载超时兜底 timer（不关闭 loading 本身） */
function clearLoadingTimer() {
  if (_loadingTimer) {
    clearTimeout(_loadingTimer)
    _loadingTimer = null
  }
}

export function useCheckoutBar(items: Ref<CartItem[]>) {
  const checkoutBarVisible = ref(_checkoutBarVisible)
  /** 结算跳转进行中标记，防止重复点击（navigateTo 成功后重置） */
  const checkingOut = ref(false)
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

  /**
   * 跳转到确认订单页（FR-7，无参数跳转）。
   * 空车时静默忽略（本人已确认，有意不弹 toast，UI 上按钮已置灰禁用）。
   * 点击时立即显示 loading，覆盖「跳转 + 分包下载 + 结算页首屏渲染」全程；
   * loading 由结算页 onReady 取消（与结算栏分包加载同构）。
   * success 时重置 checkingOut，保证从结算页返回后可以再次跳转。
   */
  function goToCheckout() {
    if (checkingOut.value) return
    if (items.value.length === 0) return
    checkingOut.value = true
    // 清掉加购时挂载的分包加载超时兜底 timer，避免其稍后补发 hideLoading
    /*
      如果首次加载小程序，这时候结算页分包还没加载完成，showCheckoutBar加载结算栏5秒后，
      会调用hideLoading。5秒内如果跳转到结算页，就会把结算页的loading隐藏掉。
      所以跳转之前需要清空_loadingTimer，避免后续自动调用hideLoading
    */
    clearLoadingTimer()
    uni.showLoading({ title: '加载中...', mask: true })
    uni.navigateTo({
      url: '/sub-order-confirm/order-confirm/index',
      success: () => {
        checkingOut.value = false
      },
      fail: () => {
        checkingOut.value = false
        // 跳转失败兜底：关闭 loading，避免卡死
        hideLoading()
      },
    })
  }

  return {
    checkoutBarVisible,
    initCheckoutBar,
    showCheckoutBar,
    goToCheckout,
  }
}
