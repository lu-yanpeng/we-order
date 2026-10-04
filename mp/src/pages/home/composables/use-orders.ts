/**
 * 订单列表 Composable（FR-P3-10；Story 4.1 / 4.3）
 *
 * 数据源：服务端读取路径 `get_my_orders`（读时推进、游标分页、只含本人订单），
 * 经 `api/orders.ts` 接入；本地 `weorder_orders` 不再参与任何读取（单一数据源）。
 *
 * 职责：
 * 1. 读取与应用：经 `readOrders`（编排 Composable 传入 seq 与读取语义）把结果应用到列表——
 *    自动读取（首屏 / 进入可见域 / 轮询）「只增不删」合并、显式刷新整表替换并重置游标；
 *    序号门与状态单调在 `utils/order-status.ts`（AD-7：旧响应不覆盖新状态、状态不倒退）；
 * 2. 刷新编排：经 `composables/use-order-status.ts` 管理可见域开关与 5s 轮询（Story 4.3；
 *    FR-P3-12）——空态与「全部已完成」停止轮询（FR-P3-10 + 2026-10-04 补记）、
 *    连续失败 3 次降级为手动刷新入口；
 * 3. 状态机与交互：加载 → 失败 → 空 → 内容；骨架 / 下拉刷新 / 触底分页；
 *    卡片操作：进入订单详情；催单 / 确认取餐的真实动作分别由根 `use-urge` /
 *    `use-confirm-pickup` 承接（Story 4.4 / 4.5）；操作后立即读取入口 `refreshAfterAction`。
 *
 * 状态判定顺序固定为「加载 → 失败 → 空 → 内容」（spine 最小 UI 规范）：
 * - 加载：首屏无数据时延迟 250ms 显示骨架（快网不闪烁；刷新 / 重试不回骨架）；
 * - 失败：首屏无数据失败 → 页面内失败态；已有数据失败 → 保留数据、用户主动刷新时 toast；
 * - 空：读取成功且 0 条 → 空态引导，不发起无意义轮询；
 * - 内容：真实订单按时间倒序平铺（三态样式由 order-card 呈现）。
 *
 * 触底分页（2026-09-30 范围修订）：`next_cursor` 非空时追加下一页并保持顺序；
 * 加载失败保留已加载数据、页脚给重试入口；下拉刷新（显式刷新）整表替换并重置游标；
 * 进入可见域读取按「只增不删」合并（首屏为空时等价整表替换）——不冲掉已翻的页，
 * 也不把「已到底」重新解锁（2026-10-02 评审修复）。
 *
 * 遵循 AD-3：页面仅负责组件编排，业务逻辑封装在此。
 * 遵循 AD-7：加载失败在此捕获并返回 error 状态；状态应用单调在此走序号门。
 * 遵循 AD-9：首页专属 composable 放在页面目录内。
 */
import { computed, ref } from 'vue'
import type { OrderListItem, OrdersPage } from '@/types/api-contracts'
import { fetchOrders } from '@/api/orders'
import { errorCopy, isAppError } from '@/utils/error-copy'
import { appendOrderPage, mergeOrderList, replaceOrderList } from '@/utils/order-status'
import type { AppliedSeqMap } from '@/utils/order-status'
import { useOrderStatus } from '@/composables/use-order-status'
import type { OrderReadKind } from '@/composables/use-order-status'

/** 首屏骨架的防抖延迟（毫秒）：快网不显示；spine 最小 UI 规范取约 250ms */
const SKELETON_DELAY_MS = 250

export function useOrders() {
  /** 订单列表（按时间倒序；分页为追加） */
  const orders = ref<OrderListItem[]>([])
  /** 失败文案（唯一来源 utils/error-copy.ts）；仅在「无数据」失败时承载失败态 */
  const error = ref<string | null>(null)
  /** 整表读取进行中（首屏 / 进入可见域 / 轮询 / 下拉刷新 / 失败重试） */
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

  /** 每个订单 id 最新一次已应用读取的序号（比较范围按订单 id；按页实例持有、页间不共享） */
  let appliedSeqs: AppliedSeqMap = new Map()

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
   * 一次读取的完整执行体（编排层铸造 seq 传入；Story 4.3）：
   * - `manual`（下拉 / 失败重试）：显式刷新——整表替换并重置游标（AD-7），同 id 状态仍单调；
   * - `auto`（首屏 / 进入可见域 / 轮询）：只增不删合并 + 序号门——旧响应不覆盖新状态、
   *   未出现在本次结果中的已加载条目保留（陈旧读取只合并不删除）。
   * 失败口径不变：无数据 → 失败态；已有数据 → 手动 toast / 自动静默（轮询失败静默重试）。
   */
  const readOrders = async (seq: number, kind: OrderReadKind): Promise<boolean> => {
    loading.value = true
    if (!loaded.value && orders.value.length === 0) {
      skeletonTimer = setTimeout(() => {
        skeletonVisible.value = true
      }, SKELETON_DELAY_MS)
    }

    try {
      const page = await fetchOrders(null)
      if (kind === 'manual') {
        // 显式刷新（下拉 / 失败重试）：整表替换并重置游标（AD-7 的「显式刷新」）
        const replaced = replaceOrderList(orders.value, page.items, seq)
        orders.value = replaced.orders
        appliedSeqs = replaced.applied
        nextCursor.value = page.next_cursor
      } else {
        // 游标归属：本地合并前已有可续翻的尾部 → 保留原游标（到底保持到底、未到底从原处续翻）；
        // 只有首屏 / 空态 / 失败恢复后的首次成功才采用服务端游标（2026-10-02 评审修复）
        const hadOrders = orders.value.length > 0
        const merged = mergeOrderList(orders.value, page.items, seq, appliedSeqs)
        orders.value = merged.orders
        appliedSeqs = merged.applied
        if (!hadOrders) nextCursor.value = page.next_cursor
      }
      error.value = null
      loadMoreError.value = null
      return true
    } catch (err) {
      // transport 只会抛 AppError；文案唯一来源 utils/error-copy.ts（AR-P3-20）
      const message = messageOf(err)
      if (orders.value.length === 0) {
        error.value = message
      } else if (kind === 'manual') {
        // 已有数据时失败不丢数据：仅对显式刷新的用户动作给出提示（同一失败只提示一次）
        uni.showToast({ title: message, icon: 'none' })
      }
      return false
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

  // 刷新编排（Story 4.3；AD-8）：进入可见域立即读 + 5s 轮询。
  // 停止轮询 = 没有可能推进的内容（2026-10-04 补记修订裁定 ③）：
  // - 空态（FR-P3-10）；
  // - 列表全部已完成（completed 终态集合；新单只能从点餐 tab 下单产生，
  //   回来必经可见域重进 → 立即读取，不靠轮询发现）；
  // 失败态（0 条）继续静默重试以自愈——不因「没有数据」而停。
  const status = useOrderStatus({
    read: readOrders,
    shouldPoll: () => {
      if (isEmpty.value) return false
      if (orders.value.length === 0) return true
      return orders.value.some((order) => order.status !== 'completed')
    },
  })

  /**
   * 可见域开关（AD-8）：页面把「订单 tab 激活 且页面可见」合成后调用。
   * 进入（含切回 tab、从详情返回、回到前台）→ 立即读一次并重置轮询计时；离开 → 停表。
   */
  const setActive = status.setActive

  /** 下拉刷新：显式刷新（整表替换 + 重置轮询计时）；失败保留数据 */
  const refreshOrders = async () => {
    refreshing.value = true
    try {
      await status.runManualRead()
    } finally {
      refreshing.value = false
    }
  }

  /**
   * 操作后立即读取（确认取餐成功后由根 `use-confirm-pickup` 调用；Story 4.5）：
   * 与进入可见域同语义（auto——合并应用、失败静默、保游标），并重置轮询计时；
   * 不整表替换、不重置分页（确认取餐不是显式刷新，AD-7）。
   */
  const refreshAfterAction = () => status.runAutoRead()

  /**
   * 触底加载下一页（scroll-view 的 scrolltolower）：
   * 有游标才发请求；追加去重（已知 id 不重复插入、不更新已有条目）；
   * 读取序号经同一编排铸造（比较范围仍是订单 id）；失败保留已加载数据并在页脚重试。
   */
  const loadMoreOrders = async () => {
    if (loading.value || loadingMore.value || nextCursor.value === null) return
    loadingMore.value = true
    loadMoreError.value = null
    try {
      const page = await fetchOrders(nextCursor.value)
      const appended = appendOrderPage(orders.value, page.items, status.nextSeq(), appliedSeqs)
      orders.value = appended.orders
      appliedSeqs = appended.applied
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
    setActive,
    refreshOrders,
    refreshAfterAction,
    loadMoreOrders,
    goToOrderDetail,
  }
}
