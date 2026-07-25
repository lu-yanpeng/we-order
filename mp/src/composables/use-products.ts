/**
 * 商品分类与列表 Composable
 *
 * 职责：
 * 1. 通过 API 层加载商品分类数据
 * 2. 管理侧边栏分类与右侧商品列表的双向滚动联动
 *
 * 遵循 AD-3：页面仅负责组件编排，业务逻辑封装在此。
 */
import { ref, nextTick } from 'vue'
import type { Category } from '@/types/product'
import { fetchCategories } from '@/api/products'

export function useProducts() {
  /** 商品分类列表（含各分类下的商品） */
  const categories = ref<Category[]>([])
  /** 数据加载状态 */
  const loading = ref(false)
  /** 数据加载错误信息 */
  const error = ref<string | null>(null)

  /** 当前高亮的分类 ID */
  const activeCategory = ref('')
  /** 用于 scroll-into-view 的目标分类 ID */
  const scrollIntoViewId = ref('')
  /** 各分类区块在 scroll-view 中的 top 偏移量 */
  const sectionPositions = ref<{ id: string; top: number }[]>([])
  /** 是否为程序触发的滚动（防止与用户滚动互相干扰） */
  const isProgrammaticScroll = ref(false)

  /** 加载分类数据 */
  const loadCategories = async () => {
    loading.value = true
    error.value = null
    try {
      categories.value = await fetchCategories()
      if (categories.value.length > 0) {
        activeCategory.value = categories.value[0].id
      }
    } catch {
      error.value = '加载商品失败'
    } finally {
      loading.value = false
    }
  }

  /**
   * 侧边栏点击 → 滚动商品列表到对应分类
   * 先清空 scrollIntoViewId 再赋值，触发小程序 scroll-into-view 重新定位
   */
  const handleSidebarClick = (categoryId: string) => {
    activeCategory.value = categoryId
    isProgrammaticScroll.value = true
    scrollIntoViewId.value = ''
    nextTick(() => {
      scrollIntoViewId.value = categoryId
      // 程序滚动完成后，延时重置 isProgrammaticScroll 标志
      setTimeout(() => {
        isProgrammaticScroll.value = false
      }, 400)
    })
  }

  /**
   * 用户滚动商品列表 → 更新侧边栏高亮
   * 通过对比预计算的各分类 top 位置确定当前所在分类
   */
  const handleContentScroll = (e: { detail: { scrollTop: number } }) => {
    if (isProgrammaticScroll.value) return

    const { scrollTop } = e.detail
    const positions = sectionPositions.value
    if (positions.length === 0) return

    // 从后往前匹配，找到第一个 top <= scrollTop 的分类
    for (let i = positions.length - 1; i >= 0; i--) {
      if (scrollTop >= positions[i].top) {
        if (activeCategory.value !== positions[i].id) {
          activeCategory.value = positions[i].id
        }
        return
      }
    }
  }

  /**
   * 预计算各分类区块在 scroll-view 内的 top 位置
   * 通过 uni.createSelectorQuery 获取 DOM 尺寸后计算相对偏移
   */
  const computeSectionPositions = () => {
    if (categories.value.length === 0) return

    const query = uni.createSelectorQuery()
    query.select('.content-area').boundingClientRect()
    categories.value.forEach((cat) => {
      query.select(`#${cat.id}`).boundingClientRect()
    })
    query.exec((res: UniApp.NodeInfo[]) => {
      const scrollViewRect = res[0]
      if (!scrollViewRect) return

      const offset = scrollViewRect.top || 0
      sectionPositions.value = categories.value.map((cat, i) => ({
        id: cat.id,
        top: (res[i + 1]?.top || 0) - offset,
      }))
    })
  }

  /** 初始化：加载数据并延迟计算分类位置（等待 DOM 渲染完成） */
  const init = async () => {
    await loadCategories()
    if (categories.value.length > 0) {
      activeCategory.value = categories.value[0].id
      // 初始加载后延时计算各分类区域位置，等待首次渲染完成
      setTimeout(() => {
        computeSectionPositions()
      }, 400)
    }
  }

  return {
    categories,
    loading,
    error,
    activeCategory,
    scrollIntoViewId,
    isProgrammaticScroll,
    handleSidebarClick,
    handleContentScroll,
    computeSectionPositions,
    init,
  }
}
