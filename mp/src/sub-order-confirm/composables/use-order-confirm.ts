/**
 * 确认订单页 Composable
 *
 * 职责：
 * 1. 只读购物车 cart store（AD-8：写入权限唯一归 useCart）
 * 2. 经 API 层加载门店信息（AD-1）：首读显示全屏遮罩（延迟防闪烁）、
 *    失败进卡片失败态（可重试、不阻断支付）
 * 3. 管理就餐方式与备注偏好状态（FR-7 / FR-8）
 * 4. 派生包装费、商品合计、总件数与应付金额
 * 5. 结算意图（幂等键）会合：提交前 ensure（先落盘）、成功后清除（Story 3.4；AD-10）
 * 6. 模拟支付状态机：提交经 `api/orders.ts` 的 `payOrder()` 调 `pay-order` 真实建单（Story 3.5）；
 *    成功进入反馈态；失败按类别 toast、保留幂等键与购物车
 *
 * 遵循 AD-1：运行时响应式状态（Pinia store）由 Composable 直接读写；
 *              门店信息与下单经由 api/。
 * 遵循 AD-6：购物车作为跨页面共享状态使用 Pinia。
 */
import { computed, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useCartStore } from '@/stores/cart'
import { clearCheckoutIntent, ensureCheckoutIntent, payOrder } from '@/api/orders'
import { toCreateOrderItems } from '@/api/cart'
import { fetchStore } from '@/api/catalog'
import { errorCopy, isAppError } from '@/utils/error-copy'
import { calcPackagingFee } from '@/utils/price'
import type { DiningMode, StoreInfo } from '@/types/api-contracts'

/** 模拟支付阶段（FR-10）：idle → verifying（请求在飞）→ success */
type PaymentPhase = 'idle' | 'verifying' | 'success'

/** 门店首读遮罩延迟：约 250ms 防闪烁（快网不显示；spine 最小 UI 规范） */
const STORE_OVERLAY_DELAY_MS = 250

/** 门店读取失败的兜底文案（无类别可翻译时；与目录失败态同一兜底口径） */
const STORE_FAILURE_FALLBACK = '加载失败，请重试'

export function useOrderConfirm() {
  const cartStore = useCartStore()
  const { items, totalPrice, totalCount } = storeToRefs(cartStore)

  /** 就餐方式：默认店内堂食（FR-7） */
  const diningMode = ref<DiningMode>('dinein')
  /** 备注偏好，随订单一并提交（FR-8） */
  const notes = ref('')
  /** 门店信息（真实后端 `stores` 行；读取失败保持 null 并进卡片失败态） */
  const store = ref<StoreInfo | null>(null)
  /** 门店读取失败文案（唯一翻译 `utils/error-copy.ts`；仅卡片内展示，不阻断支付） */
  const storeError = ref<string | null>(null)
  /** 门店读取进行中（首读遮罩与卡片重试按钮共用；同时是防重守卫） */
  const storeLoading = ref(false)
  /** 门店首读全屏遮罩：延迟显示、完成或失败即撤；重试不弹遮罩 */
  const storeOverlayVisible = ref(false)
  /** 首读遮罩的延迟计时器（页面卸载时清理） */
  let overlayTimer: ReturnType<typeof setTimeout> | null = null

  /** 包装费：外带 ¥2，堂食免收（展示口径；订单金额以服务端重算为准） */
  const packagingFee = computed(() => calcPackagingFee(diningMode.value))
  /** 应付金额 = 商品合计 + 包装费（展示口径） */
  const payAmount = computed(() => totalPrice.value + packagingFee.value)

  function selectDiningMode(mode: DiningMode) {
    diningMode.value = mode
  }

  /**
   * 加载门店信息：数据来自真实后端（api/catalog.ts）。
   * - 首读（进入页面）：`withOverlay` 经约 250ms 延迟后显示全屏遮罩，完成或失败即撤；
   * - 重试（卡片按钮）：只走按钮 loading，不遮全屏、不阻断支付；
   * - 失败保持可重试；门店配置错误由服务端在支付时以 `store_unavailable` 拒绝，客户端不拦截支付。
   */
  async function loadStore(withOverlay: boolean) {
    // 防重：同一实例最多一个在飞（重试按钮禁用 + 这里兜底）
    if (storeLoading.value) return
    storeLoading.value = true
    if (withOverlay) {
      overlayTimer = setTimeout(() => {
        storeOverlayVisible.value = true
      }, STORE_OVERLAY_DELAY_MS)
    }
    try {
      const info = await fetchStore()
      store.value = info
      // 空结果同样按失败呈现（服务端保证恰好一家门店，读不到即无法展示门店信息）
      storeError.value = info === null ? STORE_FAILURE_FALLBACK : null
    } catch (err) {
      // transport 只会抛 AppError；文案唯一来源 utils/error-copy.ts（AR-P3-20）
      store.value = null
      const message = isAppError(err) ? errorCopy(err) : ''
      // 空文案（request_cancelled 不展示）与未知异常兜底，保证失败态始终可渲染
      storeError.value = message !== '' ? message : STORE_FAILURE_FALLBACK
    } finally {
      storeLoading.value = false
      storeOverlayVisible.value = false
      if (overlayTimer !== null) {
        clearTimeout(overlayTimer)
        overlayTimer = null
      }
    }
  }

  /** 进入页面首读（带全屏遮罩）；页面挂载时调用 */
  const initStore = () => loadStore(true)
  /** 卡片失败态重试（不遮全屏、不阻断支付） */
  const retryStore = () => loadStore(false)

  onUnmounted(() => {
    if (overlayTimer !== null) {
      clearTimeout(overlayTimer)
      overlayTimer = null
    }
  })

  /** 模拟支付阶段（FR-10）：idle → verifying → success */
  const paymentPhase = ref<PaymentPhase>('idle')
  /** 支付进行中（请求在飞或成功展示中），用于弹层显隐与防重复点击 */
  const paying = computed(() => paymentPhase.value !== 'idle')

  /** 成功收尾：重置备注与就餐方式（FR-P3-8；页面即将离开，这里显式归零） */
  function resetOrderDraft() {
    notes.value = ''
    diningMode.value = 'dinein'
  }

  /**
   * 开始模拟支付（FR-10；Story 3.5 起为真实建单）
   * - 空购物车：toast 阻断、不发请求（P1 AD-7 承接）；
   * - 提交前会合结算意图：同步先落盘、再进入支付流程（Story 3.4——杀进程后的重试才能复用同一键）；
   * - 请求在飞期间为 `verifying`；成功后清除幂等键并进入 `success`（清车与跳转由页面编排）；
   * - 失败退出 loading、按类别 toast（唯一翻译），保留幂等键与购物车；
   *   清除 / 保留的细分类别决策随 Story 3.6。
   */
  async function startPay() {
    if (paying.value) return
    if (items.value.length === 0) {
      uni.showToast({ title: '请先选择商品', icon: 'none' })
      return
    }

    const idempotencyKey = ensureCheckoutIntent(items.value, diningMode.value)
    paymentPhase.value = 'verifying'
    try {
      await payOrder({
        items: toCreateOrderItems(items.value),
        dining_mode: diningMode.value,
        notes: notes.value.trim(),
        idempotency_key: idempotencyKey,
      })
      clearCheckoutIntent()
      paymentPhase.value = 'success'
    } catch (err) {
      paymentPhase.value = 'idle'
      const message = isAppError(err) ? errorCopy(err) : ''
      // 空文案（request_cancelled）不提示；同一失败只提示一次（单次 catch 只 toast 一次）
      if (message !== '') {
        uni.showToast({ title: message, icon: 'none' })
      }
    }
  }

  return {
    items,
    diningMode,
    notes,
    store,
    storeError,
    storeLoading,
    storeOverlayVisible,
    totalPrice,
    totalCount,
    packagingFee,
    payAmount,
    selectDiningMode,
    initStore,
    retryStore,
    paymentPhase,
    paying,
    resetOrderDraft,
    startPay,
  }
}
