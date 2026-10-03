/**
 * 订单详情页 Composable（FR-13；Story 4.2 切真实读取）
 *
 * 职责：
 * 1. 经 API 层按 id 读取服务端详情快照（`get_my_order_detail`；AD-1）——
 *    商品、规格摘要、金额、门店信息、取杯号都是下单时快照，不随目录改名 / 改价变化
 * 2. 封装状态卡操作：催单、确认取餐（Phase 1 仅轻提示，真实调用见 Story 4.4 / 4.5）
 *
 * 状态判定顺序固定为「加载 → 失败 → 内容」（spine 最小 UI 规范）：
 * - 加载：首读期间显示全屏遮罩（延迟约 250ms 防闪烁、完成或失败即撤）；
 * - 失败：页面内失败态（文案 + 重试），不展示任何缓存数据；重试只走按钮 loading、不弹遮罩；
 * - 内容：服务端快照原样渲染（含已下架 / 售罄的历史行，详情不参与「再来一单」的失效判定）。
 *
 * 已有数据（下拉刷新）失败：保留已展示数据 + toast（与订单列表同一口径）；
 * 首读无数据失败：进入失败态。读取失败的文案唯一来源 `utils/error-copy.ts`。
 *
 * 遵循 AD-7：加载失败在此捕获并返回 error 状态供页面渲染。
 * 遵循 AD-9：分包专属 composable 放在分包目录内。
 */
import { computed, ref } from 'vue'
import { fetchOrderById } from '@/api/orders'
import { errorCopy, isAppError } from '@/utils/error-copy'
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
  /** 读取进行中（首读遮罩与失败态重试按钮共用；同时是防重守卫） */
  const loading = ref(false)
  /** 首读全屏遮罩：延迟显示、完成或失败即撤；重试 / 下拉刷新不弹遮罩 */
  const overlayVisible = ref(false)
  /** 当前订单 id（服务端 UUID；重试 / 下拉刷新复用） */
  const orderId = ref('')

  let overlayTimer: ReturnType<typeof setTimeout> | null = null

  /** 就餐方式文案 */
  const modeLabel = computed(() =>
    order.value?.dining_mode === 'takeout' ? '打包外带' : '店内堂食',
  )

  /** 异常 → 用户可见文案；非 AppError 与空文案（request_cancelled）走固定兜底 */
  const messageOf = (err: unknown): string => {
    const copy = isAppError(err) ? errorCopy(err) : ''
    return copy !== '' ? copy : FAILURE_FALLBACK
  }

  /**
   * 读取详情（首读 / 失败重试 / 下拉刷新共用）：
   * - `withOverlay`：首读带全屏遮罩（延迟 250ms）；重试 / 刷新只走按钮 / 原生指示器；
   * - 失败：屏幕已有数据 → 保留数据 + toast；无数据 → 失败态（不展示缓存）；
   * - 空 id：本地守卫不发请求（直接访问页面无参数时），按「订单不存在」类别呈现。
   */
  const load = async (withOverlay: boolean) => {
    // 防重：同一实例最多一个在飞（重试按钮禁用 + 这里兜底）
    if (loading.value) return

    if (orderId.value === '') {
      order.value = null
      // 本地前置校验失败：复用订单域类别文案（不泄露订单存在性），不发网络请求
      error.value = errorCopy({ source: 'order', code: 'order_not_found' })
      return
    }

    loading.value = true
    if (withOverlay) {
      overlayTimer = setTimeout(() => {
        overlayVisible.value = true
      }, OVERLAY_DELAY_MS)
    }
    try {
      order.value = await fetchOrderById(orderId.value)
      error.value = null
    } catch (err) {
      // transport 只会抛 AppError；文案唯一来源 utils/error-copy.ts（AR-P3-20）
      const message = messageOf(err)
      if (order.value !== null) {
        // 已有数据（下拉刷新）失败：保留数据 + 一次性 toast（同一失败只提示一次）
        uni.showToast({ title: message, icon: 'none' })
      } else {
        error.value = message
      }
    } finally {
      if (overlayTimer !== null) {
        clearTimeout(overlayTimer)
        overlayTimer = null
      }
      overlayVisible.value = false
      loading.value = false
    }
  }

  /** 进入页面首读（带全屏遮罩）；页面 onLoad 时调用 */
  const initOrderDetail = (id: string) => {
    orderId.value = id
    return load(true)
  }

  /** 失败态重试：只走按钮 loading，不弹全屏遮罩 */
  const retryOrderDetail = () => load(false)

  /** 下拉刷新：立即读取一次（不弹遮罩）；失败口径与 load 一致（保留数据 + toast / 失败态） */
  const refreshOrderDetail = () => load(false)

  /** 催单（FR-12：真实调用见 Story 4.4） */
  const urgeOrder = () => {
    uni.showToast({ title: '已通知门店加快制作', icon: 'none' })
  }

  /** 确认取杯（真实调用见 Story 4.5） */
  const confirmPickup = () => {
    uni.showToast({ title: '确认取杯功能开发中', icon: 'none' })
  }

  return {
    order,
    error,
    loading,
    overlayVisible,
    modeLabel,
    initOrderDetail,
    retryOrderDetail,
    refreshOrderDetail,
    urgeOrder,
    confirmPickup,
  }
}
