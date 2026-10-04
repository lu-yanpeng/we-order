/**
 * 订单详情页 Composable（FR-13；Story 4.2 切真实读取 / 4.3 接入轮询与单调）
 *
 * 职责：
 * 1. 经 API 层按 id 读取服务端详情快照（`get_my_order_detail`；AD-1）——
 *    商品、规格摘要、金额、门店信息、取杯号都是下单时快照，不随目录改名 / 改价变化；
 * 2. 刷新编排：经 `composables/use-order-status.ts` 管理可见域与 5s 轮询（Story 4.3；
 *    FR-P3-12）——订单已完成（终态）停止轮询；连续失败 3 次降级为手动刷新入口；
 * 3. 状态应用单调：序号门 + 状态不倒退（`utils/order-status.ts`；AD-7）；
 * 4. 操作后立即读取入口 `refreshAfterAction`（确认取餐成功后由根 `use-confirm-pickup` 调用，
 *    Story 4.5；同 auto 语义：合并 / 静默 + 重置轮询计时）；确认取餐与催单的真实动作分别由
 *    根 `use-confirm-pickup` / `use-urge` 承接。
 *
 * 触发路径唯一：`onLoad` 只登记订单 id（`prepareOrderDetail`），读取一律由页面的
 * `onShow → setActive(true)`（可见域进入）与下拉刷新 / 失败重试（显式刷新）发起。
 *
 * 状态判定顺序固定为「加载 → 失败 → 内容」（spine 最小 UI 规范）：
 * - 加载：首个读取期间显示全屏遮罩（延迟约 250ms 防闪烁、完成或失败即撤）；
 * - 失败：页面内失败态（文案 + 重试），不展示任何缓存数据；重试只走按钮 loading、不弹遮罩；
 * - 内容：服务端快照原样渲染（含已下架 / 售罄的历史行，详情不参与「再来一单」的失效判定）。
 *
 * 已有数据失败：手动刷新（下拉 / 重试）toast、自动读取（轮询）静默保留数据；
 * 无数据失败：进入失败态。读取失败的文案唯一来源 `utils/error-copy.ts`。
 *
 * 遵循 AD-7：加载失败在此捕获并返回 error 状态供页面渲染。
 * 遵循 AD-9：分包专属 composable 放在分包目录内。
 */
import { computed, ref } from 'vue'
import { fetchOrderById } from '@/api/orders'
import { errorCopy, errorCopyOr } from '@/utils/error-copy'
import { applyOrderRead } from '@/utils/order-status'
import { useOrderStatus } from '@/composables/use-order-status'
import type { OrderReadKind } from '@/composables/use-order-status'
import type { OrderDetail } from '@/types/api-contracts'

/** 首读遮罩延迟（毫秒）：约 250ms 防闪烁（spine 最小 UI 规范；快网不显示） */
const OVERLAY_DELAY_MS = 250

/** 无类别可翻译（非 AppError、空文案）时的兜底文案，保证失败态始终可渲染 */
const FAILURE_FALLBACK = '加载失败，请重试'

export function useOrderDetail() {
  /** 当前订单（服务端详情形状：订单对外形状 + 门店快照 + 明细快照） */
  const order = ref<OrderDetail | null>(null)
  /** 失败文案（唯一翻译 `utils/error-copy.ts`）；仅在「无数据」失败时承载失败态 */
  const error = ref<string | null>(null)
  /** 读取进行中（首个读取的遮罩与失败态重试按钮共用） */
  const loading = ref(false)
  /** 首个读取的全屏遮罩：延迟显示、完成或失败即撤；重试 / 下拉 / 轮询不弹 */
  const overlayVisible = ref(false)
  /** 当前订单 id（服务端 UUID；读取 / 重试 / 下拉 / 轮询复用） */
  const orderId = ref('')

  /** 该订单 id 最新一次已应用读取的序号（比较范围即该订单 id） */
  let lastAppliedSeq: number | undefined
  /** 是否已出过结果（成功或失败）：只有首个读取弹全屏遮罩 */
  let loadedOnce = false

  let overlayTimer: ReturnType<typeof setTimeout> | null = null

  /** 就餐方式文案 */
  const modeLabel = computed(() =>
    order.value?.dining_mode === 'takeout' ? '打包外带' : '店内堂食',
  )

  /** 页面态失败文案：AppError 走唯一翻译；非 AppError 与空文案用场景兜底（保证可渲染） */
  const messageOf = (err: unknown): string => {
    const copy = errorCopyOr(err, FAILURE_FALLBACK)
    return copy !== '' ? copy : FAILURE_FALLBACK
  }

  /**
   * 一次读取的完整执行体（编排层铸造 seq 传入；Story 4.3）：
   * - 首个读取带全屏遮罩（延迟 250ms）；重试 / 下拉 / 轮询只走按钮 / 原生指示器；
   * - 序号门 + 状态单调：旧结果忽略（`utils/order-status.ts`）、completed 终态不回退；
   * - 失败：屏幕已有数据 → 手动 toast / 自动静默；无数据 → 失败态（不展示缓存）；
   * - 空 id：本地守卫不发请求（直接访问页面无参数时），按「订单不存在」类别呈现。
   */
  const readOrder = async (seq: number, kind: OrderReadKind): Promise<boolean> => {
    if (orderId.value === '') {
      order.value = null
      // 本地前置校验失败：复用订单域类别文案（不泄露订单存在性），不发网络请求
      error.value = errorCopy({ source: 'order', code: 'order_not_found' })
      return false
    }

    loading.value = true
    if (!loadedOnce) {
      overlayTimer = setTimeout(() => {
        overlayVisible.value = true
      }, OVERLAY_DELAY_MS)
    }
    try {
      const incoming = await fetchOrderById(orderId.value)
      const { order: next, applied } = applyOrderRead(
        order.value ?? undefined,
        incoming,
        seq,
        lastAppliedSeq,
      )
      order.value = next
      if (applied) lastAppliedSeq = seq
      error.value = null
      return true
    } catch (err) {
      // transport 只会抛 AppError；文案唯一来源 utils/error-copy.ts（AR-P3-20）
      if (order.value !== null) {
        // 已有数据：手动刷新（下拉 / 重试）toast；自动读取（轮询）静默保留数据
        // 空文案（request_cancelled）不提示；非 AppError 用场景兜底（Story 4.6）
        if (kind === 'manual') {
          const message = errorCopyOr(err, FAILURE_FALLBACK)
          if (message !== '') uni.showToast({ title: message, icon: 'none' })
        }
      } else {
        // 无数据：失败态必须可渲染（空文案再兜一次，不展示缓存）
        error.value = messageOf(err)
      }
      return false
    } finally {
      if (overlayTimer !== null) {
        clearTimeout(overlayTimer)
        overlayTimer = null
      }
      overlayVisible.value = false
      loadedOnce = true
      loading.value = false
    }
  }

  // 刷新编排（Story 4.3；AD-8）：进入可见域立即读 + 5s 轮询；
  // 订单已完成（终态、不可变）停止轮询；空 id 本地错误不轮询
  const status = useOrderStatus({
    read: readOrder,
    shouldPoll: () => orderId.value !== '' && order.value?.status !== 'completed',
  })

  /** 登记订单 id（页面 onLoad）：只记录，读取由可见域进入（onShow → setActive）统一触发 */
  const prepareOrderDetail = (id: string) => {
    orderId.value = id
  }

  /** 可见域开关（页面 onShow / onHide / onUnload）：进入时返回首个读取的完成 Promise */
  const setActive = status.setActive

  /** 停止编排（页面 onUnload）：停表，不再发起任何读取 */
  const dispose = status.dispose

  /** 失败态重试：显式刷新（走统一读取入口 + 重置轮询计时），不弹全屏遮罩 */
  const retryOrderDetail = () => status.runManualRead()

  /** 下拉刷新：显式刷新（同重试），失败口径由 readOrder 决定 */
  const refreshOrderDetail = () => status.runManualRead()

  /**
   * 操作后立即读取（确认取餐成功后由根 `use-confirm-pickup` 调用；Story 4.5）：
   * 与进入可见域同语义（auto——失败静默），并重置轮询计时；completed 后自然停轮询。
   */
  const refreshAfterAction = () => status.runAutoRead()

  return {
    order,
    error,
    loading,
    overlayVisible,
    modeLabel,
    prepareOrderDetail,
    setActive,
    dispose,
    retryOrderDetail,
    refreshOrderDetail,
    refreshAfterAction,
  }
}
