/**
 * 订单详情页 Composable（FR-13）
 *
 * 职责：
 * 1. 经 API 层按 id 加载订单详情（AD-1）；门店信息取订单上的快照列（AD-9），不单独读门店
 * 2. 封装状态卡操作：催单、确认取餐（Phase 1 仅轻提示，不做状态流转）
 *
 * 遵循 AD-7：订单不存在或加载失败时返回 error 状态供页面渲染。
 * 遵循 AD-9：分包专属 composable 放在分包目录内。
 */
import { computed, ref } from 'vue'
import { fetchOrderById } from '@/api/orders'
import type { OrderDetail } from '@/types/api-contracts'

export function useOrderDetail() {
  /** 当前订单（服务端详情形状：订单对外形状 + 门店快照 + 明细快照） */
  const order = ref<OrderDetail | null>(null)
  /** 数据加载错误信息（AD-7） */
  const error = ref<string | null>(null)

  /** 就餐方式文案 */
  const modeLabel = computed(() =>
    order.value?.dining_mode === 'takeout' ? '打包外带' : '店内堂食',
  )

  /** 按订单 id（服务端 UUID）加载订单详情 */
  const initOrderDetail = async (id: string) => {
    error.value = null
    try {
      const detail = await fetchOrderById(id)
      if (!detail) {
        error.value = '订单不存在'
        return
      }
      order.value = detail
    } catch {
      error.value = '订单加载失败'
    }
  }

  /** 催单（FR-12：仅前端轻提示，无后端逻辑） */
  const urgeOrder = () => {
    uni.showToast({ title: '已通知门店加快制作', icon: 'none' })
  }

  /** 确认取餐（Phase 1 不做状态流转，仅占位提示） */
  const confirmPickup = () => {
    uni.showToast({ title: '确认取餐功能开发中', icon: 'none' })
  }

  return { order, error, modeLabel, initOrderDetail, urgeOrder, confirmPickup }
}
