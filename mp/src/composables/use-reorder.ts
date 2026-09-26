/**
 * 再来一单 Composable（FR-14）
 *
 * 职责：
 * 1. 把原订单的商品（保留规格与数量）转成购物车条目
 * 2. 经 useCart 整车替换购物车：不做合并，原商品全部丢弃
 * 3. 回到首页「点餐」tab 并展开购物车面板，由用户手动结算（参考美团外卖）
 *
 * 遵循 AD-1：订单数据由调用方经 API 层取得后传入。
 * 遵循 AD-8：不直接写 cart store，写入统一经 useCart。
 * 遵循 AD-9：首页订单卡与订单详情页都要用，跨包复用故放在根 composables/。
 */
import { ref } from 'vue'
import { fetchOrderById } from '@/api/orders'
import { useCart } from '@/composables/use-cart'
import { useCheckoutBar } from '@/composables/use-checkout-bar'
import { HOME_TAB_SWITCH_EVENT } from '@/composables/use-home-tabs'
import type { OrderDetail, OrderDetailItem, OrderListItem } from '@/types/api-contracts'
import type { CartItem } from '@/types/cart'

/** 订单商品快照（服务端形状）→ 购物车条目（纯本地形状） */
function toCartItem(item: OrderDetailItem): CartItem {
  return {
    productId: item.product_id,
    productName: item.product_name,
    selections: item.selections,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    specSummary: item.spec_summary,
  }
}

/** 当前页是否为首页：首页订单卡触发时不需要返回，订单详情页触发时先返回首页 */
function isHomePage(): boolean {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  return current?.route === 'pages/home/index'
}

export function useReorder() {
  const { items, setItems } = useCart()
  const { openCartDetail } = useCheckoutBar(items)
  /** 跳转进行中标记，防止重复点击 */
  const reordering = ref(false)

  /**
   * 再来一单：整车替换购物车 → 回到首页点餐 tab → 展开购物车面板。
   *
   * 订单卡触发时只有列表项（没有明细快照），先按 id 取一次详情；
   * 详情页触发时直接用已加载的快照。Epic 4 起这两条都走服务端读取路径。
   */
  const reorder = async (order: OrderDetail | OrderListItem) => {
    if (reordering.value) return
    reordering.value = true

    const detail = 'items' in order ? order : await fetchOrderById(order.id)
    if (!detail) {
      reordering.value = false
      uni.showToast({ title: '订单不存在', icon: 'none' })
      return
    }

    setItems(detail.items.map(toCartItem))
    uni.$emit(HOME_TAB_SWITCH_EVENT, 'menu')
    openCartDetail()

    if (isHomePage()) {
      reordering.value = false
      return
    }
    uni.navigateBack({
      success: () => {
        reordering.value = false
      },
      fail: () => {
        reordering.value = false
      },
    })
  }

  return { reorder }
}
