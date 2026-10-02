/**
 * 订单列表 Composable（FR-P3-10；Story 4.1）
 *
 * 数据源：服务端读取路径 `get_my_orders`（读时推进、游标分页、只含本人订单），
 * 经 `api/orders.ts` 接入；本地 `weorder_orders` 不再参与任何读取（单一数据源）。
 *
 * 职责：
 * 1. 首屏 / 进入订单可见域 / 下拉刷新 / 触底分页的读取编排与状态机；
 * 2. 封装卡片操作：进入订单详情、催单、确认取杯（催单 / 取杯的真实调用见 Story 4.4 / 4.5）。
 *
 * 状态判定顺序固定为「加载 → 失败 → 空 → 内容」（spine 最小 UI 规范）：
 * - 加载：首屏无数据时延迟 250ms 显示骨架（快网不闪烁；刷新 / 重试不回骨架）；
 * - 失败：首屏无数据失败 → 页面内失败态；已有数据失败 → 保留数据、用户主动刷新时 toast；
 * - 空：读取成功且 0 条 → 空态引导，不发起无意义读取；
 * - 内容：真实订单按时间倒序平铺（三态样式由 order-card 呈现）。
 *
 * 触底分页（2026-09-30 范围修订）：`next_cursor` 非空时追加下一页并保持顺序；
 * 加载失败保留已加载数据、页脚给重试入口；下拉刷新（显式刷新）整表替换并重置游标；
 * 进入可见域读取按「只增不删」合并（首屏为空时等价整表替换）——不冲掉已翻的页，
 * 也不把「已到底」重新解锁（2026-10-02 评审修复）。
 *
 * 刷新编排（轮询 / 订阅）随 Story 4.3 接入：本 Composable 的读取入口是那时
 * 「同一条状态应用路径」的接入点（请求序号与单调规则在 4.3 的编排层落地）。
 *
 * 遵循 AD-3：页面仅负责组件编排，业务逻辑封装在此。
 * 遵循 AD-7：加载失败在此捕获并返回 error 状态。
 * 遵循 AD-9：首页专属 composable 放在页面目录内。
 */
import { computed, ref } from 'vue'
import type { OrderListItem, OrdersPage } from '@/types/api-contracts'
import { fetchOrders } from '@/api/orders'
import { errorCopy, isAppError } from '@/utils/error-copy'

/** 首屏骨架的防抖延迟（毫秒）：快网不显示；spine 最小 UI 规范取约 250ms */
const SKELETON_DELAY_MS = 250

export function useOrders() {
  /** 订单列表（按时间倒序；分页为追加） */
  const orders = ref<OrderListItem[]>([])
  /** 失败文案（唯一来源 utils/error-copy.ts）；仅在「无数据」失败时承载失败态 */
  const error = ref<string | null>(null)
  /** 整表读取进行中（首屏 / 进入可见域 / 下拉刷新 / 失败重试） */
  const loading = ref(false)
  /** 分页读取进行中（触底加载下一页） */
  const loadingMore = ref(false)
  /** 分页失败文案（保留已加载数据，由页脚提供重试入口） */
  const loadMoreError = ref<string | null>(null)
  /** 下一页游标（服务端随信封返回，客户端原样回传；null = 到底） */
  const nextCursor = ref<OrdersPage['next_cursor']>(null)
  /** 首屏骨架显示中（延迟出现、首屏无数据时才可能出现） */
  const skeletonVisible = ref(false)
  /** 下拉刷新进行中（绑定 scroll-view 的 refresher-triggered，读完收起） */
  const refreshing = ref(false)
  /** 首屏是否已出过结果（成功或失败）：骨架 / 空态 / 失败态的判定依据 */
  const loaded = ref(false)
  /** 订单详情跳转进行中标记，防止重复点击（navigateTo 成功后重置） */
  const navigatingToDetail = ref(false)

  let skeletonTimer: ReturnType<typeof setTimeout> | null = null

  /** 还有下一页可加载 */
  const hasMore = computed(() => nextCursor.value !== null)
  /** 是否有已加载的订单（页脚与内容区渲染依据） */
  const hasOrders = computed(() => orders.value.length > 0)
  /** 空态：读取成功且 0 条（失败态 / 加载中不算空） */
  const isEmpty = computed(() => loaded.value && error.value === null && orders.value.length === 0)

  /** 异常 → 用户可见文案；非 AppError 与空文案（request_cancelled）走固定兜底 */
  const messageOf = (err: unknown): string => {
    const copy = isAppError(err) ? errorCopy(err) : ''
    return copy !== '' ? copy : '加载失败，请重试'
  }

  /**
   * 把第一页读到的条目合并进现有列表（AD-7「只增不删」的最小实现）：
   * - 已知 id 就地更新（新读到的为准）、未知 id 按页顺序插入在前；
   * - 未出现在本页的已加载条目保留——切 tab / 回到前台不冲掉已翻的页；
   * - 游标：本地已有尾部时保留原游标——已到底保持到底（不被服务端第一页的游标重新
   *   解锁分页）、未到底从原处续翻；本地没有可续翻的尾部（首屏 / 空态 / 失败恢复后的
   *   首次成功）才采用服务端游标。
   * Story 4.3 引入请求序号与状态单调后沿用同一读取入口，这里先保证「不删」。
   */
  const mergeFirstPage = (page: OrdersPage) => {
    // 本地在合并前是否已有可续翻的尾部：决定游标归属（尾部未变 → 游标不变）
    const hadOrders = orders.value.length > 0

    const merged = new Map<string, OrderListItem>()
    for (const order of page.items) merged.set(order.id, order)
    for (const order of orders.value) {
      if (!merged.has(order.id)) merged.set(order.id, order)
    }
    orders.value = [...merged.values()]

    if (!hadOrders) nextCursor.value = page.next_cursor
  }

  /**
   * 整表读取（首屏 / 进入订单可见域 / 下拉刷新 / 失败重试）。
   * - 同一时刻最多一个整表读取（守卫 + 页面侧可见域判定，不产生请求堆积）；
   * - 首屏无数据时按 250ms 延迟显示骨架；
   * - 失败：无数据 → 失败态；已有数据 → 保留数据，用户主动触发（userInitiated）时 toast；
   * - 用户主动刷新 = 显式刷新：整表替换并重置游标（AD-7）；进入可见域 = 合并不删除。
   */
  const loadOrders = async (userInitiated = false) => {
    if (loading.value) return
    loading.value = true

    if (!loaded.value && orders.value.length === 0) {
      skeletonTimer = setTimeout(() => {
        skeletonVisible.value = true
      }, SKELETON_DELAY_MS)
    }

    try {
      const page = await fetchOrders(null)
      if (userInitiated) {
        // 显式刷新（下拉 / 失败重试）：整表替换并重置游标（AD-7 的「显式刷新」）
        orders.value = page.items
        nextCursor.value = page.next_cursor
      } else {
        // 首屏 / 进入可见域：合并不删除（首屏为空列表时等价整表替换）
        mergeFirstPage(page)
      }
      error.value = null
      loadMoreError.value = null
    } catch (err) {
      // transport 只会抛 AppError；文案唯一来源 utils/error-copy.ts（AR-P3-20）
      const message = messageOf(err)
      if (orders.value.length === 0) {
        error.value = message
      } else if (userInitiated) {
        // 已有数据时失败不丢数据：仅对用户主动发起的刷新给出提示（同一失败只提示一次）
        uni.showToast({ title: message, icon: 'none' })
      }
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

  /** 下拉刷新：整表替换 + 重置游标（spine 最小 UI 规范 / AD-7 的「显式刷新」）；失败保留数据 */
  const refreshOrders = async () => {
    refreshing.value = true
    try {
      await loadOrders(true)
    } finally {
      refreshing.value = false
    }
  }

  /**
   * 触底加载下一页（scroll-view 的 scrolltolower）：
   * 有游标才发请求；追加去重（已知 id 不重复插入）；失败保留已加载数据并在页脚重试。
   */
  const loadMoreOrders = async () => {
    if (loading.value || loadingMore.value || nextCursor.value === null) return
    loadingMore.value = true
    loadMoreError.value = null
    try {
      const page = await fetchOrders(nextCursor.value)
      const known = new Set(orders.value.map((order) => order.id))
      orders.value = [...orders.value, ...page.items.filter((order) => !known.has(order.id))]
      nextCursor.value = page.next_cursor
    } catch (err) {
      loadMoreError.value = messageOf(err)
    } finally {
      loadingMore.value = false
    }
  }

  /**
   * 点击卡片 → 进入订单详情页（FR-13）。
   * 跳转用服务端 UUID（order.id）；展示编号是 order.order_number。
   * 防连点靠 navigatingToDetail 标记。
   */
  const goToOrderDetail = async (order: OrderListItem) => {
    if (navigatingToDetail.value) return
    navigatingToDetail.value = true
    await uni.showLoading({
      title: '加载中...',
      mask: true,
    })
    uni.navigateTo({
      url: `/sub-order-detail/order-detail/index?id=${order.id}`,
      success: () => {
        navigatingToDetail.value = false
      },
      fail: () => {
        navigatingToDetail.value = false
      },
      complete: () => {
        uni.hideLoading()
      },
    })
  }

  /** 催单（FR-12：真实调用见 Story 4.4） */
  const urgeOrder = () => {
    uni.showToast({ title: '已通知门店加快制作', icon: 'none' })
  }

  /** 确认取杯（真实调用见 Story 4.5） */
  const confirmPickup = () => {
    uni.showToast({ title: '确认取杯功能开发中', icon: 'none' })
  }

  return {
    orders,
    error,
    loading,
    loadingMore,
    loadMoreError,
    hasMore,
    hasOrders,
    isEmpty,
    skeletonVisible,
    refreshing,
    loadOrders,
    refreshOrders,
    loadMoreOrders,
    goToOrderDetail,
    urgeOrder,
    confirmPickup,
  }
}
