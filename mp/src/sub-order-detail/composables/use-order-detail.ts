/**
 * 订单详情页 Composable（FR-13）
 *
 * 职责：
 * 1. 经 API 层按 id 加载订单与门店信息（AD-1）
 * 2. 封装状态卡操作：催单、确认取餐（Phase 1 仅轻提示，不做状态流转）
 *
 * 遵循 AD-7：订单不存在或加载失败时返回 error 状态供页面渲染。
 * 遵循 AD-9：分包专属 composable 放在分包目录内。
 */
import { computed, ref } from 'vue'
import { fetchOrderById } from '@/api/orders'
import { fetchStore } from '@/api/store'
import type { Order } from '@/types/order'
import type { Store } from '@/types/store'

export function useOrderDetail() {
  /** 当前订单 */
  const order = ref<Order | null>(null)
  /** 门店信息 */
  const store = ref<Store | null>(null)
  /** 数据加载错误信息（AD-7） */
  const error = ref<string | null>(null)

  /** 就餐方式文案 */
  const modeLabel = computed(() =>
    order.value?.diningMode === 'takeout' ? '打包外带' : '店内堂食',
  )

  /** 按订单编号加载订单详情 */
  const initOrderDetail = async (id: string) => {
    error.value = null
    try {
      const [detail, storeInfo] = await Promise.all([fetchOrderById(id), fetchStore()])
      if (!detail) {
        error.value = '订单不存在'
        return
      }
      order.value = detail
      store.value = storeInfo
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

  return { order, store, error, modeLabel, initOrderDetail, urgeOrder, confirmPickup }
}
