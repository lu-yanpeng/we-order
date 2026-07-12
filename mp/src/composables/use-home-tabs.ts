/**
 * 首页 Tab/Swiper 双向同步 Composable
 *
 * 职责：管理顶栏 Tab 与 swiper 的双向绑定及 TDesign 受控模式首屏 workaround。
 *
 * 遵循 AD-3：页面仅负责组件编排，交互逻辑封装在此 Composable 内。
 */
import { nextTick, onMounted, ref } from 'vue'

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

  /**
   * TDesign tabs 受控模式下首屏不渲染激活态指示器的 workaround
   * 通过先清空再赋值触发重新渲染
   */
  onMounted(() => {
    setTimeout(() => {
      const current = activeTab.value
      activeTab.value = ''
      nextTick(() => {
        activeTab.value = current
      })
    }, 100)
  })

  return { activeTab, swiperIndex, onTabChange, onSwiperChange }
}
