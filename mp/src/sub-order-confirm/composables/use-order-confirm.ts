/**
 * 确认订单页 Composable
 *
 * 职责：
 * 1. 只读购物车 cart store（AD-8：写入权限唯一归 useCart）
 * 2. 管理就餐方式状态，派生包装费与 ETA 文案（FR-7）
 * 3. 派生商品合计、总件数、应付金额
 * 4. 模拟支付状态机：验证中 → 成功（FR-10）
 *
 * 遵循 AD-1：运行时响应式状态（Pinia store）由 Composable 直接读写。
 * 遵循 AD-6：购物车作为跨页面共享状态使用 Pinia。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useCartStore } from '@/stores/cart'
import { calcPackagingFee } from '@/utils/price'
import type { DiningMode } from '@/types/order'

/** 模拟支付阶段（FR-10） */
type PaymentPhase = 'idle' | 'verifying' | 'success'

export function useOrderConfirm() {
  const cartStore = useCartStore()
  const { items, totalPrice, totalCount } = storeToRefs(cartStore)

  /** 就餐方式：默认店内堂食（FR-7） */
  const diningMode = ref<DiningMode>('dinein')

  /** 包装费：外带 ¥2，堂食免收 */
  const packagingFee = computed(() => calcPackagingFee(diningMode.value))
  /** 应付金额 = 商品合计 + 包装费 */
  const payAmount = computed(() => totalPrice.value + packagingFee.value)
  /** 取餐时间 ETA（FR-7 固定文案） */
  const etaText = computed(() =>
    diningMode.value === 'dinein' ? '预计 10-15 分钟后可取' : '预计 15-20 分钟后打包完成',
  )

  function selectDiningMode(mode: DiningMode) {
    diningMode.value = mode
  }

  /** 模拟支付阶段（FR-10）：idle → verifying → success */
  const paymentPhase = ref<PaymentPhase>('idle')
  /** 支付进行中（验证中或成功展示中），用于弹层显隐与防重复点击 */
  const paying = computed(() => paymentPhase.value !== 'idle')

  /**
   * 开始模拟支付（FR-10）
   * 支付中重复点击静默阻断；1.5s 后由「验证中」进入「成功」，
   * 成功展示后的清空购物车与跳转由页面编排（AD-3）。
   */
  function startPay() {
    if (paying.value) return
    paymentPhase.value = 'verifying'
    setTimeout(() => {
      paymentPhase.value = 'success'
    }, 1500)
  }

  return {
    items,
    diningMode,
    totalPrice,
    totalCount,
    packagingFee,
    payAmount,
    etaText,
    selectDiningMode,
    paymentPhase,
    paying,
    startPay,
  }
}
