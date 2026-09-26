# Phase 3 验收记录

本文件按 Story 追加验收记录（场景 / 证据 / 结论）；后续故事（1.2 ~ 1.4、Epic 2 ~ 5）在同一文件中续写。
Story 4.8 的手动验证矩阵（演示主路径与失败场景）可在本文件另起一节，或按该 Story 的落点单独成文后再链回此处。

## Story 1.1 类型契约对齐与客户端唯一契约文件

- 日期：2026-09-26
- 环境：本地 Supabase 栈（CLI 2.117.0 / Postgres 17，迁移 + 种子已应用，数据卷为既有现场）；mp 侧 `pnpm type-check`（vue-tsc 3.3.6）与 `pnpm lint`
- 范围：客户端类型层 + 全部消费方改名对齐；Mock 数据源与 `api/` 实现保留（仅签名与形状对齐），后端零改动、无迁移

### 交付物

| 类别 | 内容 |
| --- | --- |
| 重新生成 | `supabase/types/database.types.ts`（生成物入仓，唯一一份，不手工编辑） |
| 新增 | `mp/src/types/api-contracts.ts`（客户端唯一契约文件）、`mp/src/types/cart.ts`（纯本地 `CartItem`） |
| 删除 | `mp/src/types/order.ts`、`mp/src/types/product.ts`、`mp/src/types/store.ts`（P1 手工类型退休） |
| 形状对齐 | Mock 三件（products / orders / store）改为服务端 wire 形状；`api/` 三个 Mock 实现的签名改为契约签名；16 个消费方文件（composables / stores / utils / pages / 组件）字段改名 |

### 契约文件内容

- 七个 AC 点名类型：`OrderResult`、`OrderListItem`、`OrderDetail`、`OrdersPage`、`CreateOrderItem`、`CreateOrderRequest`、`SpecSelections`；外加目录与门店：`MenuCategory` / `MenuProduct` / `MenuSpecGroup` / `MenuSpecOption` / `StoreInfo`，以及三个枚举窄别名（`DiningMode` / `OrderStatus` / `ProductAvailability`）。
- 每个类型标注服务端来源（`order_result_json` / `get_my_orders` / `get_my_order_detail` / `menu` 视图 / `stores` 行 / `pay-order` 请求体 / `create_order` 的 `p_items`）。
- 标量字段用 `Pick<Tables<...>>` 窄化生成类型（列名与可空性自动跟随）；只有 JSON 嵌套与格式化字段（如 `created_at` 文本、`spec_groups`、`next_cursor`、请求体）为手工覆盖，并注明出处迁移文件。
- 编译期防漂移：`ContractDriftChecks` 纯类型断言块（每个形状必须是合法 JSON；`pickup_code` 恒有值），0 运行时。

### 验收点与证据

| Story 1.1 验收点 | 证据 |
| --- | --- |
| 唯一生成命令产出唯一文件、再次生成零差异、不被手工编辑 | `cd supabase && supabase gen types typescript --local > types/database.types.ts`：与提交版零差异（`git diff --stat` 为空）；再生成一份逐字节比对 `diff` 为空（`GEN-TYPES ZERO-DIFF OK`） |
| mp 以相对路径 `import type` 引用同一份生成物（编译期擦除、不复制、不手工同步） | `mp/src/types/api-contracts.ts` 唯一引用点 `import type { Database, Json, Tables } from '../../../supabase/types/database.types'`；全仓检索生成类型引用只有此处与既有 `mp/src/api/auth/errors.ts`（Phase 2 遗留，Story 1.2/1.3 随错误与会话重建收口） |
| 生成类型与契约文件编译期擦除、不进小程序包 | `cd mp && pnpm build:mp-weixin` 构建成功；产物 `dist/build/mp-weixin` 中检索 `ContractDriftChecks` / `api-contracts` / `database.types` 命中 0 个文件（对照：运行时字符串 `item_summary` 命中 2 个文件，证明检索方法有效） |
| 七个类型定义在唯一契约文件、标注服务端来源 | 见上方「契约文件内容」；`grep -rn "OrderResult\|OrderListItem\|..." src/types src/api` 确认定义只有一处 |
| P1 手工类型退休、不保留手工副本 | 三个旧类型文件已删除；`grep -rn "@/types/order\|@/types/product\|@/types/store" mp/src` 无结果；`CartItem` 为纯本地类型、迁至 `types/cart.ts`，`selections` 复用 `SpecSelections` |
| 字段可空性与生成类型一致（如 `pickup_code` 恒有值） | `OrderResult` 以 `Pick<Tables<'orders'>>` 取 `pickup_code`（列 NOT NULL）；`ContractDriftChecks` 含 `null extends OrderResult['pickup_code'] ? false : true` |
| 故意构造的形状错误在编译期报错 | 临时文件 `mp/src/types/__drift-demo.ts` 造两处错误后 `pnpm type-check` 输出：<br>`src/types/__drift-demo.ts(14,3): error TS2353: Object literal may only specify known properties, and 'total_price' does not exist in type 'OrderListItem'.`<br>`src/types/__drift-demo.ts(22,14): error TS2322: Type 'null' is not assignable to type 'string'.`<br>删除临时文件后 type-check 恢复全绿 |
| 客户端全量编译保护成立 | `cd mp && pnpm type-check` 通过（0 错误）；`cd mp && pnpm lint` 通过（0 错误、0 警告）；`pnpm format` 后无格式告警 |
| 既有 UI 同步 `order.id` / `order_number` 身份映射 | 展示编号改用 `order_number`（订单卡片、详情页订单编号）；跳转 / 列表 key / 查询改用服务端 UUID `order.id`（`use-orders.goToOrderDetail`、`use-reorder` 取详情、`order-card` 的 `:key`） |
| 界面结构与交互不回归 | 未新增 / 删除页面，未改交互结构；改动均为字段名与数据内容（见下方「字段映射」）；无样式与布局改动 |

### 由契约形状决定的行为差异（有意，非回归）

1. 订单卡片的第二行（原「规格摘要」）移除：服务端列表项只有 `item_summary`（商品名 ×数量、顿号连接），没有逐条规格摘要；卡片标题改为 `[就餐方式] 商品摘要`。Story 4.1 按此形状验收。
2. 订单详情页门店信息改读订单上的快照列（`store_name` / `store_address` / `store_phone`），不再单独调用 `fetchStore()`——与服务端 `get_my_order_detail` 的快照语义一致（P2 AD-9）。
3. 订单卡「再来一单」改为先按 `order.id` 取详情再还原购物车：列表项不含明细快照，无法直接还原；详情页触发时直接用已加载快照。Epic 4 起两条都走服务端读取路径。
4. Mock 订单数据的 `id` 改为 UUID 形态、`order_number` 保留 `SG...`；制作中的 Mock 单也带取杯号（契约恒有值），界面仍按 Phase 1 仅在「待取餐」展示（显示条件的变化属 Story 4.2）。

### 字段映射（P1 手工形状 → 服务端契约）

| P1 | 契约 | 说明 |
| --- | --- | --- |
| `Order.id`（订单编号） | `order.id`（UUID）+ `order.order_number`（展示） | 身份映射，AD-14 |
| `totalPrice` / `packagingFee` / `pickupCode` / `createdAt` / `diningMode` | `total_amount` / `packaging_fee` / `pickup_code` / `created_at` / `dining_mode` | 字段名沿用库中列名 |
| `Order.items[].productId/productName/specSummary/unitPrice` | `items[].product_id/product_name/spec_summary/unit_price` | 详情快照六列 |
| `Product.desc` / `specGroups` / `specGroups[].options[].priceExtra` | `description` / `spec_groups` / `price_extra` | `menu` 视图形状 |
| `Category` | `MenuCategory`（`products` 嵌套） | `menu` 视图一行 = 一个分类 |
| `Store.name/address/phone` | `StoreInfo.id/name/address/phone` | 服务端 `stores` 行 |
| 手写 `Record<string, string \| string[]>` | `SpecSelections` | 规格选择唯一形状（P2 AD-22） |

### 开发者工具冒烟（2026-09-26，演示者执行）

结果：通过（逐项确认）。同日提出订单页图片化改进需求（列表卡片与详情页），已立为 Epic 4 的 Story 4.7，不属本 story 缺陷。

- [x] 点餐 tab：分类渲染、双栏联动、有规格 / 无规格弹窗、加价显示与实时计价
- [x] 加购、结算栏出现、数量步进、清空购物车
- [x] 结算页：门店信息、堂食 / 外带切换、包装费与应付金额
- [x] 支付成功 → 订单列表出现新单（制作中、编号 SG…、卡片无规格摘要行）
- [x] 订单详情：门店快照、明细、金额、时间；列表卡片与详情页各试一次「再来一单」
- [x] 注意：升级前 `weorder_orders` 里可能残留旧形状数据（Epic 1 的清理 gate 属 Story 1.4、尚未实现）；冒烟前在开发者工具里清一次 Storage，或手工删除该 key
