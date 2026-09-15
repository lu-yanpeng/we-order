/**
 * 确认订单页 Composable
 *
 * 职责：
 * 1. 只读购物车 cart store（AD-8：写入权限唯一归 useCart）
 * 2. 管理就餐方式与备注偏好状态（FR-7 / FR-8）
 * 3. 派生包装费、商品合计、总件数、应付金额与 ETA 文案
 * 4. 模拟支付状态机：验证中 → 成功（FR-10）；支付成功时构建订单记录经 API 层写入本地存储
 *
 * 遵循 AD-1：运行时响应式状态（Pinia store）由 Composable 直接读写；
 *              订单持久化经由 api/orders。
 * 遵循 AD-6：购物车作为跨页面共享状态使用 Pinia。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useCartStore } from '@/stores/cart'
import { createOrder } from '@/api/orders'
import { calcPackagingFee } from '@/utils/price'
import type { DiningMode, Order } from '@/types/order'

/** 模拟支付阶段（FR-10） */
type PaymentPhase = 'idle' | 'verifying' | 'success'

/** 当前时间格式化为「2026-06-28 23:15:20」，与订单 Mock 数据格式一致 */
function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function useOrderConfirm() {
  const cartStore = useCartStore()
  const { items, totalPrice, totalCount } = storeToRefs(cartStore)

  /** 就餐方式：默认店内堂食（FR-7） */
  const diningMode = ref<DiningMode>('dinein')
  /** 备注偏好，随订单一并保存到本地订单记录（FR-8） */
  const notes = ref('')

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

  /** 用当前购物车与订单页状态构建订单记录（FR-10：新订单状态为「制作中」） */
  function buildOrder(): Order {
    return {
      id: `SG${String(Date.now()).slice(-8)}`,
      status: 'cooking',
      diningMode: diningMode.value,
      items: items.value.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        specSummary: item.specSummary,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      })),
      packagingFee: packagingFee.value,
      totalPrice: payAmount.value,
      notes: notes.value.trim() || '无备注要求',
      createdAt: formatDateTime(new Date()),
      pickupCode: '',
    }
  }

  /**
   * 开始模拟支付（FR-10）
   * 支付中重复点击静默阻断；1.5s 后生成订单记录写入本地存储并进入「成功」，
   * 成功展示后的清空购物车与跳转由页面编排（AD-3）。
   */
  function startPay() {
    if (paying.value) return
    paymentPhase.value = 'verifying'
    setTimeout(() => {
      createOrder(buildOrder())
      paymentPhase.value = 'success'
    }, 1500)
  }

  return {
    items,
    diningMode,
    notes,
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
