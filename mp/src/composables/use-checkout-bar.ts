/**
 * 结算栏 Composable（AD-4）
 *
 * 职责：
 * 1. 管理结算栏可见性状态（once-true-never-false，AD-4-e）
 * 2. 页面初始化时根据购物车数据决定是否触发渲染（initCheckoutBar）
 * 3. 首次加购、再来一单时触发渲染并显示 loading（showCheckoutBar）
 * 4. 管理购物车面板显隐，供再来一单命令展开（openCartDetail / onBarReady）
 * 5. 结算跳转与防重复点击（goToCheckout）
 * 6. 接收结算栏自报高度、维护侧边栏底部留白
 *
 * 结算栏与购物车面板跨页面共享（首页渲染、再来一单从订单页命令展开），
 * 故放在根 composables（AD-9）。面板显隐为模块级状态，组件侧通过 v-model 受控。
 *
 * 遵循 AD-4：结算栏位于分包中，使用占位组件机制按需加载。
 * 遵循 AD-8：此 composable 不会写入 cart store。
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import type { CartItem } from '@/types/cart'

/** 结算栏可见性：模块级共享，保证 once-true-never-false（AD-4-e） */
const checkoutBarVisible = ref(false)
/** 购物车面板显隐：模块级共享，由此 composable 与结算栏组件（受控）共同读写 */
const cartDetailVisible = ref(false)

/** 结算栏组件是否已挂载（分包下载完成前，面板 DOM 不存在，无法展开） */
let _checkoutBarMounted = false
/** 组件挂载前收到的展开请求，挂载后补执行 */
let _pendingCartDetailOpen = false

export function useCheckoutBar(items: Ref<CartItem[]>) {
  /** 结算跳转进行中标记，防止重复点击（navigateTo 成功后重置） */
  const checkingOut = ref(false)

  /** 页面初始化时调用：若购物车已有数据，立即触发结算栏渲染 */
  function initCheckoutBar() {
    if (checkoutBarVisible.value) return
    if (items.value.length > 0) {
      checkoutBarVisible.value = true
    }
  }

  /** 首次加购 / 再来一单时调用：触发结算栏渲染（仅首次生效） */
  function showCheckoutBar() {
    if (checkoutBarVisible.value) return
    checkoutBarVisible.value = true
    uni.showLoading({ title: '加载中...', mask: true })
    // loading 由结算栏组件挂载后自行关闭（组件 onMounted 内 hideLoading）
  }

  /**
   * 再来一单：展开购物车面板。
   * 面板 DOM 在结算栏组件内部，分包未挂载时先触发加载并挂起请求，
   * 等组件 ready 后补执行展开。
   */
  function openCartDetail() {
    if (_checkoutBarMounted) {
      cartDetailVisible.value = true
      return
    }
    _pendingCartDetailOpen = true
    showCheckoutBar()
  }

  /** 结算栏就绪（已挂载并完成滑入动画，组件 ready 事件）：补执行挂载前的展开请求 */
  function onBarReady() {
    _checkoutBarMounted = true
    if (_pendingCartDetailOpen) {
      _pendingCartDetailOpen = false
      cartDetailVisible.value = true
    }
  }

  /**
   * 跳转到确认订单页（FR-7，无参数跳转）。
   * 空车时静默忽略（本人已确认，有意不弹 toast，UI 上按钮已置灰禁用）。
   * success 时重置 checkingOut，保证从结算页返回后可以再次跳转。
   */
  async function goToCheckout() {
    if (checkingOut.value) return
    if (items.value.length === 0) return
    checkingOut.value = true
    await uni.showLoading({
      title: '加载中...',
      mask: true,
    })
    uni.navigateTo({
      url: '/sub-order-confirm/order-confirm/index',
      success: () => {
        checkingOut.value = false
      },
      fail: () => {
        checkingOut.value = false
      },
      complete: () => {
        uni.hideLoading()
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
    cartDetailVisible,
    initCheckoutBar,
    showCheckoutBar,
    openCartDetail,
    onBarReady,
    goToCheckout,
    sidebarHeight,
    onBarHeightChange,
  }
}
