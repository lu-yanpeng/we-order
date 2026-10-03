/**
 * 再来一单 Composable（FR-14；Story 4.2 起快照还原接真实目录）
 *
 * 职责：
 * 1. 数据来源：必要时按 id 取服务端详情（列表卡只有摘要），再读当前目录（`menu` 视图）
 * 2. 经纯函数 `utils/reorder.ts` 的 `buildReorderItems()` 还原购物车条目：
 *    计价 / 名称 / 规格摘要按当前目录（快照价仅历史展示）；商品下架 / 规格失效的行丢弃
 * 3. 经 useCart 整车替换购物车：不做合并，原商品全部丢弃
 * 4. 回到首页「点餐」tab 并展开购物车面板，由用户手动结算（参考美团外卖）
 *
 * 失败与边界（FR-P3-19 不脏状态）：
 * - 详情 / 目录读取失败：errorCopy toast + 中止，购物车不变、可重试；
 * - 全部行失效：toast「部分商品已失效」+ 中止（不替换购物车、不跳转）；
 * - 部分失效：有效条目入车 + toast（面板就绪后提示，避开结算栏懒加载的 loading）。
 *
 * 遵循 AD-1：订单 / 目录数据经 API 层取得。
 * 遵循 AD-8：不直接写 cart store，写入统一经 useCart。
 * 遵循 AD-9：首页订单卡与订单详情页都要用，跨包复用故放在根 composables/。
 */
import { ref } from 'vue'
import { fetchOrderById } from '@/api/orders'
import { fetchCategories } from '@/api/catalog'
import { useCart } from '@/composables/use-cart'
import { useCheckoutBar } from '@/composables/use-checkout-bar'
import { HOME_TAB_SWITCH_EVENT } from '@/composables/use-home-tabs'
import { buildReorderItems } from '@/utils/reorder'
import { errorCopy, isAppError } from '@/utils/error-copy'
import type { OrderDetail, OrderListItem } from '@/types/api-contracts'

/** 快照部分行 / 全部行失效时的提示（spine 最小 UI 规范「再来一单部分失效」） */
const PARTIAL_INVALID_TOAST = '部分商品已失效'

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

  /** 操作级失败提示：文案唯一来源 utils/error-copy.ts；空文案（取消）不提示 */
  const toast = (title: string) => {
    if (title !== '') uni.showToast({ title, icon: 'none' })
  }

  /**
   * 再来一单：读详情（列表卡场景）→ 读当前目录 → 还原 → 整车替换 →
   * 回首页点餐 tab → 自动展开面板（详情页场景先返回）。
   */
  const reorder = async (order: OrderDetail | OrderListItem) => {
    if (reordering.value) return
    reordering.value = true
    try {
      const detail = 'items' in order ? order : await fetchOrderById(order.id)
      const categories = await fetchCategories()
      const { items: restored, droppedCount } = buildReorderItems(detail.items, categories)

      // 全部失效：不动现有购物车、不跳转（避免「替换」把用户当前购物车清空）
      if (restored.length === 0) {
        toast(PARTIAL_INVALID_TOAST)
        return
      }

      setItems(restored)
      uni.$emit(HOME_TAB_SWITCH_EVENT, 'menu')

      // 结算栏未挂载时展开面板会先走分包懒加载的 loading；
      // 等面板就绪（loading 已关闭）再提示，避免 toast 被 hideLoading 吞掉
      const panelReady = openCartDetail()
      if (!isHomePage()) {
        await new Promise<void>((resolve) => {
          uni.navigateBack({
            success: () => resolve(),
            fail: () => resolve(),
          })
        })
      }
      await panelReady

      if (droppedCount > 0) {
        toast(PARTIAL_INVALID_TOAST)
      }
    } catch (err) {
      toast(isAppError(err) ? errorCopy(err) : '')
    } finally {
      reordering.value = false
    }
  }

  return { reorder }
}
