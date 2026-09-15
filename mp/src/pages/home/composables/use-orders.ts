/**
 * 订单列表 Composable（FR-11 / FR-12）
 *
 * 职责：
 * 1. 通过 API 层加载订单列表
 * 2. 封装卡片操作：进入订单详情、催单、确认取杯、再来一单
 *
 * 遵循 AD-1：外部数据（Mock）读取经由 API 层。
 * 遵循 AD-3：业务操作流程封装在此，页面仅做组件编排。
 * 遵循 AD-7：加载失败在此捕获并返回 error 状态。
 * 遵循 AD-9：首页专属 composable 放在页面目录内。
 */
import { ref } from 'vue'
import type { Order } from '@/types/order'
import { fetchOrders } from '@/api/orders'

export function useOrders() {
  /** 订单列表（按时间倒序） */
  const orders = ref<Order[]>([])
  /** 数据加载错误信息 */
  const error = ref<string | null>(null)
  /** 订单详情跳转进行中标记，防止重复点击（navigateTo 成功后重置） */
  const navigatingToDetail = ref(false)

  /** 加载订单列表 */
  const initOrders = async () => {
    error.value = null
    try {
      orders.value = await fetchOrders()
    } catch {
      error.value = '订单加载失败'
    }
  }

  /**
   * 点击卡片 → 进入订单详情页（FR-13）。
   * 防连点靠 navigatingToDetail 标记。
   */
  const goToOrderDetail = (order: Order) => {
    if (navigatingToDetail.value) return
    navigatingToDetail.value = true
    uni.showLoading({
      title: '加载中',
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
    })
  }

  /** 催单（FR-12：仅前端轻提示，无后端逻辑） */
  const urgeOrder = () => {
    uni.showToast({ title: '已通知门店加快制作', icon: 'none' })
  }

  /** 确认取杯（Phase 1 不做状态流转，仅占位提示） */
  const confirmPickup = () => {
    uni.showToast({ title: '确认取杯功能开发中', icon: 'none' })
  }

  /** 再来一单（FR-14 待实现，仅占位提示） */
  const reorder = () => {
    uni.showToast({ title: '再来一单功能开发中', icon: 'none' })
  }

  return {
    orders,
    error,
    initOrders,
    goToOrderDetail,
    urgeOrder,
    confirmPickup,
    reorder,
  }
}
