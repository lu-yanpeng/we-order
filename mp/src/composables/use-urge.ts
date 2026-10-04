/**
 * 催单 Composable（Story 4.4；FR-P3-13）
 *
 * 交互设计（2026-10-04 Ly 裁定，替代 epic 原「提交 loading + 禁用」口径）：
 * - 成功一次后按钮变「已催单」，再点不再发请求、只重复提示（无提示会让用户以为系统坏了）；
 * - 无 loading；请求在飞期间忽略重复点击，保证同一订单客户端至多一次在飞；
 * - 失败不标记、可重试（类别文案 toast，唯一来源 `utils/error-copy.ts`）；
 * - 「已催单」只记在运行期内存、不落本地存储（催单不是核心功能，现实也不保证催了先做；
 *   Phase 4 会重做催单为「15 分钟未出餐才可催」的服务端逻辑）。
 *
 * 模块级状态按订单 id 跨页面共享——列表与详情看到一致状态，App 重启即忘。
 * 服务端 `urge_order` 本身幂等（不会更早 / 不会延后 / 不报错）；本端的「只调用一次」
 * 只是 UI 约束与省流量，不替代服务端纵深防御。
 *
 * 遵循 AD-9：跨主包（首页）与分包（订单详情）共享 → 放根 composables。
 */
import { ref } from 'vue'
import { urgeOrder as urgeOrderRequest } from '@/api/orders'
import { errorCopyOr } from '@/utils/error-copy'

/** 成功催过单的订单 id（模块级共享、运行期记忆；App 重启即忘） */
const urgedOrderIds = ref(new Set<string>())
/** 催单请求在飞的订单 id（防连点；无 loading 视觉） */
const inFlightOrderIds = new Set<string>()

/** 催单成功提示（最小 UI 规范「催单成功」） */
const URGE_SUCCESS_COPY = '已通知门店加快制作'
/** 已催过单再点的重复提示（重复发请求没有意义；不提示会让用户以为按钮坏了） */
const URGE_ALREADY_COPY = '已催单，请耐心等待'
/** 催单失败的兜底文案（非 AppError 时使用；AppError 走唯一翻译、取消不提示；Story 4.6） */
const URGE_FAILURE_COPY = '催单失败，请重试'

export function useUrge() {
  /** 该订单是否已成功催过单（列表卡片 / 详情按钮的第二态） */
  const isUrged = (orderId: string): boolean => urgedOrderIds.value.has(orderId)

  /**
   * 催单：成功标记「已催单」；失败不标记、可重试；
   * 已催过或请求在飞时都不再发请求（已催过给重复提示，在飞静默忽略）。
   */
  const urge = async (orderId: string): Promise<void> => {
    if (orderId === '') return
    if (urgedOrderIds.value.has(orderId)) {
      uni.showToast({ title: URGE_ALREADY_COPY, icon: 'none' })
      return
    }
    if (inFlightOrderIds.has(orderId)) return

    inFlightOrderIds.add(orderId)
    try {
      await urgeOrderRequest(orderId)
      urgedOrderIds.value.add(orderId)
      uni.showToast({ title: URGE_SUCCESS_COPY, icon: 'none' })
    } catch (err) {
      // 失败不标记：按钮保持「催单」，可重试；文案唯一来源 utils/error-copy.ts（AR-P3-20）
      // 空文案（request_cancelled）不提示；非 AppError 用场景兜底（Story 4.6）
      const message = errorCopyOr(err, URGE_FAILURE_COPY)
      if (message !== '') uni.showToast({ title: message, icon: 'none' })
    } finally {
      inFlightOrderIds.delete(orderId)
    }
  }

  return { isUrged, urge }
}
