/**
 * 再来一单 Composable（FR-14）
 *
 * 职责：
 * 1. 把原订单的商品（保留规格与数量）转成购物车条目
 * 2. 经 useCart 并入购物车：SKU 完全相同则用订单里的数量覆盖，不累加
 * 3. 跳转到确认订单页，由用户确认后支付
 *
 * 遵循 AD-1：订单数据由调用方经 API 层取得后传入。
 * 遵循 AD-8：不直接写 cart store，写入统一经 useCart。
 * 遵循 AD-9：首页订单卡与订单详情页都要用，跨包复用故放在根 composables/。
 */
import { ref } from 'vue'
import { useCart } from '@/composables/use-cart'
import type { Order, OrderItem } from '@/types/order'
import type { CartItem } from '@/types/product'

/** 订单商品快照 → 购物车条目 */
function toCartItem(item: OrderItem): CartItem {
  return {
    productId: item.productId,
    productName: item.productName,
    selections: item.selections,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    specSummary: item.specSummary,
  }
}

export function useReorder() {
  const { mergeItems } = useCart()
  /** 跳转进行中标记，防止重复点击 */
  const reordering = ref(false)

  /** 再来一单：商品并入购物车后跳转确认订单页 */
  const reorder = async (order: Order) => {
    if (reordering.value) return
    reordering.value = true
    mergeItems(order.items.map(toCartItem))
    await uni.showLoading({
      title: '加载中...',
      mask: true,
    })
    uni.navigateTo({
      url: '/sub-order-confirm/order-confirm/index',
      success: () => {
        reordering.value = false
      },
      fail: () => {
        reordering.value = false
      },
      complete: () => {
        uni.hideLoading()
      },
    })
  }

  return { reorder }
}
