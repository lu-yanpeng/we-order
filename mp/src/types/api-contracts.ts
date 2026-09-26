/**
 * 客户端唯一契约文件（P3 AD-14 / AR-P3-18）
 *
 * 客户端形状只有两个来源，不允许在各调用点另建一份：
 *   1. 生成类型（`supabase/types/database.types.ts`，唯一生成命令见 supabase/types/README.md）——
 *      表列、枚举、函数签名由数据库结构自动生成，本文件用 `Pick` / 别名窄化引用；
 *      以相对路径 `import type` 引用同一份生成物：编译期擦除、不进小程序包，不复制、不手工同步。
 *   2. 本文件中带「服务端来源」注释的手工覆盖类型——只覆盖生成类型看不到的 JSON 结构
 *      （jsonb 嵌套、分页信封、请求体），来源是数据库函数 / 视图的迁移文件。
 *
 * 形状漂移的拦截点：
 *   - 表列 / 枚举改名或改可空性 → 下方 `Pick` 立刻编译报错；
 *   - 契约形状混入非 JSON 值 → 文件末尾 `ContractDriftChecks` 编译报错；
 *   - JSON 的键由 SQL 手写、生成类型看不到：改动时须人工对照每个类型标注的来源函数。
 */
import type { Database, Json, Tables } from '../../../supabase/types/database.types'

// ── 枚举：取值集合唯一来源是数据库 ──────────────────────────────────────────

/** 服务端来源：enum `dining_mode` */
export type DiningMode = Database['public']['Enums']['dining_mode']

/** 服务端来源：enum `order_status` */
export type OrderStatus = Database['public']['Enums']['order_status']

/** 服务端来源：enum `product_availability`；`menu` 视图已过滤 `delisted` */
export type ProductAvailability = Database['public']['Enums']['product_availability']

// ── 共享 JSON 形状 ─────────────────────────────────────────────────────────

/** 规格选择（P2 AD-22 唯一形状）：规格组 id → 选项 id（单选）/ 选项 id 数组（多选） */
export type SpecSelections = Record<string, string | string[]>

// ── 订单 ───────────────────────────────────────────────────────────────────

/**
 * 订单对外形状。
 * 服务端来源：`public.order_result_json(p_order, p_timezone)`（migrations/20260921193022_create_order.sql）。
 * 列表、详情、下单、催单、确认取杯共用同一映射；金额为定点 JSON 数字（元）；
 * `created_at` 为门店时区格式化文本 `YYYY-MM-DD HH:mm:ss`；`pickup_code` 下单即分配、恒有值。
 */
export type OrderResult = Pick<
  Tables<'orders'>,
  | 'id'
  | 'order_number'
  | 'status'
  | 'dining_mode'
  | 'packaging_fee'
  | 'total_amount'
  | 'notes'
  | 'pickup_code'
  | 'created_at'
>

/**
 * 订单列表项。
 * 服务端来源：`public.get_my_orders(...)` 的 `items[]`（migrations/20260923055705_get_my_orders.sql）
 * = 订单对外形状 + `item_summary`（商品名 ×数量、顿号连接）。
 */
export type OrderListItem = OrderResult & { item_summary: string }

/**
 * 订单明细快照项。
 * 服务端来源：`public.get_my_order_detail(...)` 的 `items[]`（migrations/20260923124452_get_my_order_detail.sql）
 * = `order_items` 快照六列；标量列取自生成类型，`selections` 为 JSON 人工覆盖。
 */
export type OrderDetailItem = Pick<
  Tables<'order_items'>,
  'product_id' | 'product_name' | 'spec_summary' | 'unit_price' | 'quantity'
> & { selections: SpecSelections }

/**
 * 订单详情。
 * 服务端来源：`public.get_my_order_detail(...)`（同上）
 * = 订单对外形状 + 门店快照三列 + 明细快照数组；门店信息是下单时快照，不随门店改名变化。
 */
export type OrderDetail = OrderResult &
  Pick<Tables<'orders'>, 'store_name' | 'store_address' | 'store_phone'> & {
    items: OrderDetailItem[]
  }

/**
 * 订单列表分页信封。
 * 服务端来源：`public.get_my_orders(...)` 的返回（同上）；
 * `next_cursor = null` 表示到底，非 null 时原样回传作为下一页游标。
 */
export type OrdersPage = {
  items: OrderListItem[]
  next_cursor: { created_at: string; id: string } | null
}

/**
 * 下单请求的单个商品条目。
 * 服务端来源：`public.create_order` 的 `p_items` 元素（migrations/20260921193022_create_order.sql）；
 * 客户端不提交展示字段，也不提交任何金额字段。
 */
export type CreateOrderItem = {
  product_id: string
  quantity: number
  selections: SpecSelections
}

/**
 * 下单请求体。
 * 服务端来源：支付接口 `pay-order` 的请求形状（P3 AR-P3-16）；`items` 经 api/cart.ts 的
 * 唯一转换器 `toCreateOrderItems()` 产出；不含金额与用户标识。
 */
export type CreateOrderRequest = {
  items: CreateOrderItem[]
  dining_mode: DiningMode
  notes: string
  idempotency_key: string
}

// ── 目录与门店 ─────────────────────────────────────────────────────────────

/**
 * 目录规格选项。
 * 服务端来源：`public.menu` 视图的 `products[].spec_groups[].options[]`
 * （migrations/20260917103204_menu_view.sql）。
 */
export type MenuSpecOption = Pick<Tables<'spec_options'>, 'id' | 'label' | 'price_extra'>

/**
 * 目录规格组。
 * 服务端来源：`public.menu` 视图的 `products[].spec_groups[]`（同上）；
 * `multi` 为 true 时，选择值是选项 id 数组。
 */
export type MenuSpecGroup = Pick<Tables<'spec_groups'>, 'id' | 'title' | 'multi'> & {
  options: MenuSpecOption[]
}

/**
 * 目录商品。
 * 服务端来源：`public.menu` 视图的 `products[]`（同上）；
 * 下架商品已过滤，售罄商品保留并带 `availability`。
 */
export type MenuProduct = Pick<
  Tables<'products'>,
  'id' | 'name' | 'description' | 'price' | 'tags' | 'sales' | 'availability' | 'image_path'
> & { spec_groups: MenuSpecGroup[] }

/**
 * 目录分类（一行 = 一个分类，含其全部商品）。
 * 服务端来源：`public.menu` 视图一行（同上）。
 */
export type MenuCategory = Pick<Tables<'categories'>, 'id' | 'name'> & { products: MenuProduct[] }

/**
 * 门店信息（目录读取只用这四列）。
 * 服务端来源：`public.stores` 行。
 */
export type StoreInfo = Pick<Tables<'stores'>, 'id' | 'name' | 'address' | 'phone'>

// ── 编译期防漂移检查 ───────────────────────────────────────────────────────
// 纯类型断言、0 运行时：任何一条不成立，`pnpm type-check` 在检查本文件时立即报错。

type Expect<T extends true> = T

/** 形状必须是合法 JSON（挡住 Date / 函数 / undefined 混入 wire 形状） */
type IsJson<T> = T extends Json ? true : false

export type ContractDriftChecks = [
  Expect<IsJson<OrderResult>>,
  Expect<IsJson<OrderListItem>>,
  Expect<IsJson<OrderDetail>>,
  Expect<IsJson<OrdersPage>>,
  Expect<IsJson<CreateOrderItem>>,
  Expect<IsJson<CreateOrderRequest>>,
  Expect<IsJson<MenuCategory>>,
  Expect<IsJson<StoreInfo>>,
  // `pickup_code` 下单即分配、恒有值（P2 AD-7）：若变成可空，这一条编译报错
  Expect<null extends OrderResult['pickup_code'] ? false : true>,
]
