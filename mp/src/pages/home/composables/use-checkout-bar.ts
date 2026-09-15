/**
 * 结算栏按需加载 Composable（AD-4）
 *
 * 职责：
 * 1. 管理结算栏可见性状态（once-true-never-false，AD-4-e）
 * 2. 页面初始化时根据购物车数据决定是否触发渲染（initCheckoutBar）
 * 3. 首次加购时触发渲染并显示 loading（showCheckoutBar）
 * 4. 结算跳转与防重复点击（goToCheckout）
 * 5. 接收结算栏自报高度、维护侧边栏底部留白
 *
 * 遵循 AD-4：结算栏位于分包中，使用占位组件机制按需加载。
 * 遵循 AD-8：此 composable 不会写入 cart store。
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import type { CartItem } from '@/types/product'

/** 模块级闭包，保证 once-true-never-false（AD-4-e） */
let _checkoutBarVisible = false

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
      // loading 由结算栏组件挂载后自行关闭（组件 onMounted 内 hideLoading）
    }
  }

  /**
   * 跳转到确认订单页（FR-7，无参数跳转）。
   * 空车时静默忽略（本人已确认，有意不弹 toast，UI 上按钮已置灰禁用）。
   * 不显示跳转 loading：实测 loading 跨不过页面跳转（同订单详情页结论）。
   * success 时重置 checkingOut，保证从结算页返回后可以再次跳转。
   */
  function goToCheckout() {
    if (checkingOut.value) return
    if (items.value.length === 0) return
    checkingOut.value = true
    uni.navigateTo({
      url: '/sub-order-confirm/order-confirm/index',
      success: () => {
        checkingOut.value = false
      },
      fail: () => {
        checkingOut.value = false
      },
    })
  }

  /**
   * 侧边栏底部留白：结算栏滑入后遮住侧边栏底部，
   * 需要在其出现时额外垫出对应高度，保证最后一个分类仍可滚入可视区。
   * 结算栏按需渲染（v-if），未出现时不需要留白。
   */
  const sidebarHeight = ref('0px')

  // checkout-bar挂载后会抛出自己的高度，在home中捕获后自动传递给onBarHeightChange
  const onBarHeightChange = (height: number) => {
    sidebarHeight.value = `${height}px`
  }

  return {
    checkoutBarVisible,
    initCheckoutBar,
    showCheckoutBar,
    goToCheckout,
    sidebarHeight,
    onBarHeightChange,
  }
}
