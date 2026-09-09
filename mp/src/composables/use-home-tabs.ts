/**
 * 首页 Tab/Swiper 双向同步 Composable
 *
 * 职责：管理顶栏 Tab 与 swiper 的双向绑定及 TDesign 受控模式首屏 workaround。
 *
 * 遵循 AD-3：页面仅负责组件编排，交互逻辑封装在此 Composable 内。
 */
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

/** 跨页面 tab 切换事件名：确认订单页支付成功后通知首页切到订单 tab */
export const HOME_TAB_SWITCH_EVENT = 'home-tab-switch'

export function useHomeTabs() {
  /** 当前激活的 Tab 值 */
  const activeTab = ref('menu')
  /** 当前 swiper 索引 */
  const swiperIndex = ref(0)

  /** Tab 切换 → 同步 swiper */
  const onTabChange = (e: { value: string | number }) => {
    activeTab.value = String(e.value)
    swiperIndex.value = e.value === 'menu' ? 0 : 1
  }

  /** Swiper 滑动 → 同步 Tab */
  const onSwiperChange = (e: { detail: { current: number } }) => {
    activeTab.value = e.detail.current === 0 ? 'menu' : 'orders'
  }

  /** 跨页面 tab 切换（如支付成功后切到订单 tab） */
  const handleTabSwitch = (tab: string) => {
    if (tab === 'orders') {
      activeTab.value = 'orders'
      swiperIndex.value = 1
    } else if (tab === 'menu') {
      activeTab.value = 'menu'
      swiperIndex.value = 0
    }
  }

  onMounted(() => {
    uni.$on(HOME_TAB_SWITCH_EVENT, handleTabSwitch)

    // TDesign Tabs 组件首次渲染 workaround：重新挂载 Tab 以触发正确布局
    setTimeout(() => {
      const current = activeTab.value
      activeTab.value = ''
      nextTick(() => {
        activeTab.value = current
      })
    }, 100)
  })

  onUnmounted(() => {
    uni.$off(HOME_TAB_SWITCH_EVENT, handleTabSwitch)
  })

  return { activeTab, swiperIndex, onTabChange, onSwiperChange }
}
