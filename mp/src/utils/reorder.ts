/**
 * 「再来一单」快照还原 — 纯函数（FR-P3-11；P3 AD-15）
 *
 * 输入是服务端订单详情快照（`get_my_order_detail` 的 `items[]`）与当前目录
 * （`menu` 视图的分类 / 商品 / 规格），输出可直接写入购物车的条目：
 *
 * 1. **计价永远按当前目录**：`unitPrice = 当前商品价 + 当前规格加价`、`specSummary` 用当前
 *    规格标签重建，`productName` 取当前目录名；快照价 / 旧名只留详情页做历史展示；
 * 2. **失效行丢弃**：商品已下架（不在 `menu`）或规格选择无法在现规格组中还原 → 丢弃该行，
 *    由调用方 toast「部分商品已失效」（不阻断其余条目）；
 * 3. **售罄不丢弃**：`availability = sold_out` 的商品仍在 `menu` 中，正常入车，
 *    支付时由服务端以 `product_unavailable` 拒绝（FR-P3-7 口径，本阶段不做置灰）。
 *
 * 规格还原规则（严格双向）：
 * - 当前有规格组：分组必须存在有效选择（单选 = 选项 id 字符串；多选 = 选项 id 数组），
 *   快照出现当前不存在的规格组 key → 失效；
 * - 当前无规格组：快照必须无任何选择（快照带选择 → 规格已变更，失效）。
 *
 * 不依赖 Vue 响应式系统与 uni API，可独立单元测试。
 */
import type {
  MenuCategory,
  MenuProduct,
  OrderDetailItem,
  SpecSelections,
} from '@/types/api-contracts'
import type { CartItem } from '@/types/cart'
import { buildSpecSummary, calcSpecExtras } from '@/utils/price'

/** 还原结果：可入车条目 + 因下架 / 规格失效被丢弃的明细行数 */
export type ReorderRestoreResult = {
  items: CartItem[]
  droppedCount: number
}

/** 把 `menu` 的分类树拍平成 商品 id → 商品 的索引 */
function indexProducts(categories: MenuCategory[]): Map<string, MenuProduct> {
  const products = new Map<string, MenuProduct>()
  for (const category of categories) {
    for (const product of category.products) {
      products.set(product.id, product)
    }
  }
  return products
}

/**
 * 校验快照规格选择能否在商品当前规格组中还原；
 * 可还原时返回防御性拷贝（数组复制），否则返回 null（规格已失效，丢弃该行）。
 */
function resolveSelections(
  product: MenuProduct,
  selections: SpecSelections,
): SpecSelections | null {
  const groups = product.spec_groups
  const keys = Object.keys(selections)

  // 商品当前无规格：快照也必须无选择（曾带规格后移除 → 视为规格失效）
  if (groups.length === 0) {
    return keys.length === 0 ? {} : null
  }

  // 快照出现当前不存在的规格组 key（规格组被改名 / 删除）→ 失效
  for (const key of keys) {
    if (!groups.some((group) => group.id === key)) return null
  }

  const resolved: SpecSelections = {}
  for (const group of groups) {
    const value = selections[group.id]
    if (group.multi) {
      if (!Array.isArray(value)) return null
      for (const optionId of value) {
        if (!group.options.some((option) => option.id === optionId)) return null
      }
      resolved[group.id] = [...value]
    } else {
      if (typeof value !== 'string') return null
      if (!group.options.some((option) => option.id === value)) return null
      resolved[group.id] = value
    }
  }
  return resolved
}

/**
 * 从订单快照与当前目录还原购物车条目（整车替换用）。
 * 商品已下架 / 规格已失效的行不产出，只计入 `droppedCount`。
 */
export function buildReorderItems(
  snapshotItems: OrderDetailItem[],
  categories: MenuCategory[],
): ReorderRestoreResult {
  const products = indexProducts(categories)
  const items: CartItem[] = []
  let droppedCount = 0

  for (const snapshot of snapshotItems) {
    const product = products.get(snapshot.product_id)
    if (!product) {
      // 已下架（menu 视图不返回）或商品被删除
      droppedCount += 1
      continue
    }

    const selections = resolveSelections(product, snapshot.selections)
    if (selections === null) {
      droppedCount += 1
      continue
    }

    const unitPrice = product.price + calcSpecExtras(product.spec_groups, selections)
    items.push({
      productId: product.id,
      productName: product.name,
      selections,
      quantity: snapshot.quantity,
      unitPrice,
      specSummary: buildSpecSummary(product.spec_groups, selections),
    })
  }

  return { items, droppedCount }
}
