/**
 * 确认取餐 Composable（Story 4.5；FR-P3-14）
 *
 * 交互设计（2026-10-04 裁定）：
 * - 成功：toast「取餐成功」→ 执行调用方传入的「操作后立即读取」→ 再清 loading——
 *   状态更新前按钮不闪回「确认取餐」；读取失败静默（由轮询自愈，不叠加第二条错误提示）；
 * - 失败：类别文案 toast（唯一来源 `utils/error-copy.ts`）、不刷新、不改变本地展示状态、
 *   按钮恢复可点（可重试）；服务端本身幂等——已完成（含已由超时自动完成）再确认返回成功
 *   且不改写完成时间，本端的在飞守卫只防重复提交；
 * - 提交类操作进入 loading 防重复态（spine 最小 UI 规范）：同一订单在飞期间忽略再次点击，
 *   列表卡片与详情按钮都显示 loading / 禁用。
 *
 * 「在飞」记录按订单 id 模块级共享——列表与详情看到一致的 loading 状态；App 重启即忘。
 *
 * 操作后读取使用编排的 auto 语义（合并、失败静默），不做整表替换、不重置分页（AD-7；
 * 确认取餐不是显式刷新）。
 *
 * 遵循 AD-9：跨主包（首页）与分包（订单详情）共享 → 放根 composables。
 */
import { ref } from 'vue'
import { completeOrder as completeOrderRequest } from '@/api/orders'
import { errorCopy, isAppError } from '@/utils/error-copy'

/** 确认取餐请求在飞的订单 id（模块级共享、运行期记忆） */
const confirmingOrderIds = ref(new Set<string>())

/** 确认取餐成功提示（最小 UI 规范「确认取餐成功」） */
const COMPLETE_SUCCESS_COPY = '取餐成功'

export function useConfirmPickup() {
  /** 该订单是否正在确认取餐（按钮 loading + 禁用） */
  const isConfirming = (orderId: string): boolean => confirmingOrderIds.value.has(orderId)

  /** 异常 → 用户可见文案；非 AppError 与空文案（request_cancelled）走固定兜底 */
  const messageOf = (err: unknown): string => {
    const copy = isAppError(err) ? errorCopy(err) : ''
    return copy !== '' ? copy : '操作失败，请重试'
  }

  /**
   * 确认取餐：成功后先 toast、再执行调用方的「操作后立即读取」（loading 覆盖到读取完成）；
   * 失败不刷新、不标记，按钮恢复可点（类别文案 toast）。返回是否成功。
   */
  const confirmPickup = async (
    orderId: string,
    refreshAfterAction?: () => Promise<void>,
  ): Promise<boolean> => {
    if (orderId === '') return false
    if (confirmingOrderIds.value.has(orderId)) return false

    confirmingOrderIds.value.add(orderId)
    try {
      await completeOrderRequest(orderId)
      uni.showToast({ title: COMPLETE_SUCCESS_COPY, icon: 'none' })
      if (refreshAfterAction) {
        try {
          await refreshAfterAction()
        } catch {
          // 读取失败静默：确认已成功；状态由轮询自愈（不叠加第二条错误提示）
        }
      }
      return true
    } catch (err) {
      // 失败不改变本地展示的状态、不刷新：按钮保持「确认取餐」可重试
      uni.showToast({ title: messageOf(err), icon: 'none' })
      return false
    } finally {
      confirmingOrderIds.value.delete(orderId)
    }
  }

  return { isConfirming, confirmPickup }
}
