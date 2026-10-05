/**
 * 商品分类与列表 Composable
 *
 * 职责：
 * 1. 通过 API 层加载商品分类数据
 * 2. 管理侧边栏分类与右侧商品列表的双向滚动联动
 * 3. 加载失败时产出失败文案（唯一翻译 `utils/error-copy.ts`）供页面失败态渲染（Story 2.2）
 * 4. 首屏无数据时延迟显示目录骨架（Story 4.1；2026-09-27 加载态范围修订）
 *
 * 遵循 AD-3：页面仅负责组件编排，业务逻辑封装在此。
 */
import { ref, nextTick } from 'vue'
import type { MenuCategory } from '@/types/api-contracts'
import { fetchCategories, productImageUrl } from '@/api/catalog'
import { errorCopyOr } from '@/utils/error-copy'

/**
 * 分类锚点 id：真实分类 id 是 UUID（数字开头），而 `scroll-into-view` 与选择器
 * 都要求 id 首字符不能是数字——统一加 `cat-` 前缀，数据层仍用原始 id。
 */
const anchorId = (categoryId: string) => `cat-${categoryId}`

/** 首屏骨架的防抖延迟（毫秒）：快网不显示；spine 最小 UI 规范取约 250ms */
const SKELETON_DELAY_MS = 250

/** 页面态失败文案的兜底（非 AppError 与空文案时使用；Story 4.6） */
const FAILURE_FALLBACK = '加载失败，请重试'

/**
 * 高亮边界的容差（px）。
 *
 * `@scroll` 事件里的 `scrollTop` 是 float32 精度，而 `boundingClientRect` 预算出的
 * 分类 top 是 double：例如目标 top=6020.8（double），事件给出 6020.7998046875
 * （float32 向下偏约 0.0002px），严格 `>=` 会差之毫厘地把高亮判给前一个分类。
 * 1px 的模糊带可吸收浮点误差与真机像素对齐残差；分类间距有几百 px，不会误判。
 */
const BOUNDARY_TOLERANCE_PX = 1

export function useProducts() {
  /** 商品分类列表（含各分类下的商品） */
  const categories = ref<MenuCategory[]>([])
  /** 数据加载状态 */
  const loading = ref(false)
  /** 数据加载错误信息 */
  const error = ref<string | null>(null)
  /** 首屏骨架显示中（延迟出现；首屏无数据时才可能出现，刷新 / 重试不回骨架） */
  const skeletonVisible = ref(false)
  /** 首屏是否已出过结果（成功或失败）：骨架判定依据 */
  const loaded = ref(false)

  let skeletonTimer: ReturnType<typeof setTimeout> | null = null

  /** 当前高亮的分类 ID */
  const activeCategory = ref('')
  /** 用于 scroll-into-view 的目标分类 ID */
  const scrollIntoViewId = ref('')
  /** 各分类区块在 scroll-view 中的 top 偏移量 */
  const sectionPositions = ref<{ id: string; top: number }[]>([])

  /**
   * 程序化滚动目标锁：点击侧边栏后记录目标分类及其预算 top，非 null 时右→左联动
   * 不参与高亮判定（高亮由点击目标兜底），直到滚动真正到达目标附近、或用户手指
   * 接管列表才解锁。
   *
   * 不用「布尔标志 + 固定时长解锁」的原因见 docs/一些思考/双区联动.md 复盘：
   * scroll-into-view 的动画时长与定时器同量级，末尾 scroll 事件早到/晚到会导致
   * 同一次操作时对时错；不设超时则避免动画尾部的不完整事件在超时后把高亮带偏。
   */
  let programmaticTarget: { id: string; top: number } | null = null

  /** 加载分类数据：成功渲染完整目录；失败产出文案、保留失败态供页面渲染（Story 2.2） */
  const loadCategories = async () => {
    // 防重复：重试按钮已禁用，这里再兜一层（不产生并发请求）
    if (loading.value) return
    loading.value = true

    // 首屏无数据才可能显示骨架：延迟 250ms，快网不闪烁；失败 / 重试不回骨架
    if (!loaded.value && categories.value.length === 0 && error.value === null) {
      skeletonTimer = setTimeout(() => {
        skeletonVisible.value = true
      }, SKELETON_DELAY_MS)
    }

    try {
      categories.value = await fetchCategories()
      if (categories.value.length > 0) {
        activeCategory.value = categories.value[0].id
      }
      // 成功才清错误：重试期间失败态保持可见、按钮呈 loading（而非闪回空目录）
      error.value = null
    } catch (err) {
      // transport 只会抛 AppError；文案唯一来源 utils/error-copy.ts（AR-P3-20）
      // 空文案（request_cancelled 不展示）与非 AppError 用场景兜底，保证失败态始终可渲染
      const message = errorCopyOr(err, FAILURE_FALLBACK)
      error.value = message !== '' ? message : FAILURE_FALLBACK
    } finally {
      if (skeletonTimer) {
        clearTimeout(skeletonTimer)
        skeletonTimer = null
      }
      skeletonVisible.value = false
      loading.value = false
      loaded.value = true
    }
  }

  /**
   * 侧边栏点击 → 滚动商品列表到对应分类
   * 先清空 scrollIntoViewId 再赋值，触发小程序 scroll-into-view 重新定位；
   * 同时立目标锁：程序化动画期间左侧高亮钉在点击分类上。
   */
  const handleSidebarClick = (categoryId: string) => {
    activeCategory.value = categoryId

    const targetTop = sectionPositions.value.find((pos) => pos.id === categoryId)?.top
    // 位置尚未测量时退化为无锁，由右侧滚动的常规匹配兜底
    programmaticTarget = targetTop === undefined ? null : { id: categoryId, top: targetTop }

    scrollIntoViewId.value = ''
    nextTick(() => {
      scrollIntoViewId.value = anchorId(categoryId)
    })
  }

  /**
   * 用户手指触碰商品列表：立即解除目标锁，把高亮交还给滚动位置判定。
   *
   * 注意：微信 scroll-view 在执行 `scroll-into-view` 平滑动画期间通常不接受拖拽
   * （动画由平台掌控、无法打断），所以这里不是"抢在动画中接管滚动"，而是安全网——
   * 当真机落点残差大于容差、目标锁无法因"到达"而释放时，用户一碰列表即可恢复
   * 右→左联动，避免高亮被永久锁死。
   */
  const handleContentTouchStart = () => {
    programmaticTarget = null
  }

  /**
   * 用户滚动商品列表 → 更新侧边栏高亮
   * 通过对比预计算的各分类 top 位置确定当前所在分类；比较带 1px 容差
   * （吸收 float32/double 精度差与像素对齐残差，见 BOUNDARY_TOLERANCE_PX）。
   */
  const handleContentScroll = (e: { detail: { scrollTop: number } }) => {
    const { scrollTop } = e.detail

    // 目标锁生效期间：未到达目标前不改高亮；到达（或已越过）目标后解锁并继续常规匹配
    if (programmaticTarget) {
      if (scrollTop + BOUNDARY_TOLERANCE_PX < programmaticTarget.top) return
      programmaticTarget = null
    }

    const positions = sectionPositions.value
    if (positions.length === 0) return

    // 从后往前匹配，找到第一个 top <= scrollTop + 容差 的分类
    for (let i = positions.length - 1; i >= 0; i--) {
      if (scrollTop + BOUNDARY_TOLERANCE_PX >= positions[i].top) {
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
      query.select(`#${anchorId(cat.id)}`).boundingClientRect()
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

  /**
   * 商品列表底部留白：让最后一个分类被 scroll-into-view 定位时恰好把标题顶到列表顶部。
   * 精确值 = 商品内容区高度 - 分类标题高度
   * 首次渲染时 swiper 未就绪，先用50vh高度兜底。
   */
  const footerHeight = ref<string>('50vh')

  const measureFooterHeight = () => {
    const query = uni.createSelectorQuery()
    // 内容区
    query.select('.content-area').boundingClientRect()
    // 获取分类标题
    query.select('.content-area > .category-section > .category-title').boundingClientRect()
    query.exec((res: UniApp.NodeInfo[]) => {
      const contentRect = res[0]
      const titleRect = res[1]
      if (!contentRect || !titleRect) return
      const contentHeight = contentRect.height ?? 0
      const titleHeight = titleRect.height ?? 0
      if (contentHeight <= 0) return
      footerHeight.value = `calc(${contentHeight}px - ${titleHeight}px)`
    })
  }

  /**
   * 初始化加载数据，并延时触发位置计算与底部留白测量（等待首次渲染完成）
   */
  const init = async () => {
    await loadCategories()
    if (categories.value.length > 0) {
      activeCategory.value = categories.value[0].id
      // 初始加载后延时计算各分类区域位置，等待首次渲染完成
      setTimeout(() => {
        computeSectionPositions()
        measureFooterHeight()
      }, 400)
    }
  }

  return {
    categories,
    loading,
    error,
    skeletonVisible,
    activeCategory,
    scrollIntoViewId,
    footerHeight,
    handleSidebarClick,
    handleContentTouchStart,
    handleContentScroll,
    computeSectionPositions,
    init,
    /** 模板锚点 id（`cat-` 前缀）；同一规则由 handleSidebarClick / 位置测量共用 */
    anchorId,
    /** 商品图片地址构造（经 api/ 出口）：缺图返回空串，卡片以色块占位 */
    productImageUrl,
  }
}
