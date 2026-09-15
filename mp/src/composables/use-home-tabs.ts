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
  /**
   * 当前 swiper 索引。
   * 手滑 swiper 不会回写 current，此值必须由 change 事件修正成真实位置：
   * 一旦它是脏的，之后切到同一个索引时 setData 值没变化，swiper 就不会动。
   */
  const swiperIndex = ref(0)

  /** Tab 值与 swiper 索引必须成对更新，统一从这里写 */
  const syncTab = (index: number) => {
    swiperIndex.value = index
    activeTab.value = index === 0 ? 'menu' : 'orders'
  }

  /** Tab 切换 → 同步 swiper */
  const onTabChange = (e: { value: string | number }) => {
    syncTab(e.value === 'menu' ? 0 : 1)
  }

  /** Swiper 滑动 → 同步 Tab，并把索引修正为真实位置 */
  const onSwiperChange = (e: { detail: { current: number } }) => {
    syncTab(e.detail.current)
  }

  /** 跨页面 tab 切换（如支付成功后切到订单 tab） */
  const handleTabSwitch = (tab: string) => {
    if (tab === 'orders') syncTab(1)
    else if (tab === 'menu') syncTab(0)
  }

  onMounted(() => {
    uni.$on(HOME_TAB_SWITCH_EVENT, handleTabSwitch)

    // TDesign Tabs 组件首次渲染 workaround：先置空再还原，强制组件重新解析激活项
    // 还原时取那一刻的最新值，避免把用户在等待期间的切换覆盖回去
    setTimeout(() => {
      activeTab.value = ''
      nextTick(() => {
        syncTab(swiperIndex.value)
      })
    }, 100)
  })

  onUnmounted(() => {
    uni.$off(HOME_TAB_SWITCH_EVENT, handleTabSwitch)
  })

  return { activeTab, swiperIndex, onTabChange, onSwiperChange }
}
