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

## Story 1.2 请求通道重建与错误归一

- 日期：2026-09-26
- 环境：本地 Supabase 栈（CLI 2.117.0 / Postgres 17，迁移已应用）；mp 侧 `pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm test`（vitest 3.2.7 + 根 vite 5.2.8）、`pnpm build:mp-weixin`
- 范围：新增 `core/transport` 基础设施、`types/errors.ts`、`utils/error-copy.ts` 与单元测试；后端仅 `order_error_code` 追加 `unknown`（原 Story 3.1 计划项，经裁定提前）；按 2B 裁定 `api/` 零改动（含 `api/auth`）
- 裁定记录：`order_error_code.unknown` 提前（1A）；旧 `api/auth` 不接新通道（2B，收口在 Story 1.3）；引入 vitest（独立 `vitest.config.ts`，不影响小程序构建链）；api/ 方法采用 alova 原生写法（4B，Story 2.1 起落地）

### 交付物

| 类别 | 内容 |
| --- | --- |
| 新增（客户端） | `src/core/transport/`：`index.ts`（业务通道 / 裸通道 / provider 注册出口）、`instance.ts`（alova 实例与全部拦截器）、`headers.ts`（唯一请求头构造）、`normalize.ts`（唯一归一表，纯函数）、`error-codes.ts`（类别运行时清单 + 编译期穷尽检查）、`provider.ts`（会话插槽）、`meta.ts`（身份要求）、`config.ts`、`README.md` |
| 新增（客户端） | `src/types/errors.ts`（`AppError` + 三域类别联合）、`src/utils/error-copy.ts`（唯一翻译函数）、`vitest.config.ts`、三份单元测试 |
| 新增（后端） | `migrations/20260926100745_order_error_code_unknown.sql`（`alter type ... add value 'unknown'` + 类型注释更新） |
| 重新生成 | `supabase/types/database.types.ts`（只多 `unknown` 两个字符位；再次生成零差异） |
| 修改（后端） | `tests/database/80_create_order.test.sql` 的枚举清单断言补 `'unknown'` |
| 修改（客户端） | `package.json`：`+alova@3.5.5`、`+@alova/adapter-uniapp@2.0.18`、`+vitest@^3.2.7`、`+test` 脚本 |
| 未改动 | `src/api/**`、`src/mock/**`、页面与 `pages.json`、composables、stores（均按裁定留待后续 story） |

### 通道设计落点

- 依赖方向：`api/ → core/transport → 平台 API`；`core/transport` 不 import `core/session`、不 import `utils/`（transport 只归一、不翻译）。静态检查确认上层无 `core/` 引用。
- 会话插槽：`SessionProvider { getAccessToken(); ensureSession(force?) }` 由 `core/session` 装载时注册；Story 1.2 无注册方，`provider === null` 时通道照常工作（测试用伪 provider 断言续期重放）。
- 实例级强制：`cacheFor: null`、`shareRequest: false`、默认 `timeout` 10s；请求头唯一构造点：`apikey` 恒带、`session-required` 才经会合附 `Authorization`、有体才带 `Content-Type`。
- 归一表：RPC（`P0001` + message ∈ `order_error_code`；未知 → `order.unknown`）、`42501` → `order.unknown`（不触发续期，且与 401 同现时以 SQLSTATE 为准）、`pay-order` / `wechat-login` 按生成枚举分派、平台 auth 原样承载、`uni.request` fail 三类别（timeout / abort / 其他）。
- 会话类失败：`401` / `PGRST301` / `not_authenticated` → 经 provider `ensureSession(true)` 后**只重放一次**（`meta.sessionRetried` 去重）；恢复失败或二次失败 → `AppError{ source: 'client', code: 'session_expired' }`。
- 裸通道：不等待会话、不续期、不重放，凭证经 `meta.accessToken` 显式传入（平台 auth 与 `wechat-login` 用），供 Story 1.3 的 `core/session` 消费。

### 验收点与证据

| Story 1.2 验收点 | 证据 |
| --- | --- |
| 全仓唯一通道：新增代码内不存在绕开通道的 `uni.request` | `grep -rn "uni.request" src`：唯一真实调用点在旧 `src/api/auth/http.ts:94`（Phase 2 遗留，按 2B 不接新通道，Story 1.3 关闭该 AC）；新 `core/transport` 经 `@alova/adapter-uniapp` 发请求，无直接调用 |
| 依赖方向成立；`core/` 只被 `api/` 引用、上层不 import `core/`；`core/` 不引用 `utils/` | `grep -rn "core/transport" pages composables stores components sub-* App.vue` 为空；`grep -rn "from '@/utils" core/` 为空；`types/errors` 引用点仅 `core/transport`（4 文件）与 `utils/error-copy.ts` |
| alova 实例与全部拦截器只在 `core/transport`；实例级关闭响应缓存与请求共享 | `instance.ts` 单点 `createAlova`（业务 + 裸两个实例）；`cacheFor: null`、`shareRequest: false` 为实例级配置（不提供逐方法覆盖） |
| 请求头只此一处：apikey 恒带、需要身份才附 Authorization、发布密钥不入 Authorization | `headers.ts` 为唯一构造点；测试断言：`session-required` 请求头含 `apikey` + `Authorization`，`anonymous` 请求无 `Authorization`，有体请求带 `Content-Type` |
| 另导出裸请求通道供 `core/session`；transport 不 import session，provider 装载时注册 | `index.ts` 导出 `rawTransport` 与 `registerSessionProvider`；`grep "core/session" core/transport` 为空；裸通道测试断言不重放、按 `meta.accessToken` 带凭证 |
| 归一表唯一实现，覆盖 RPC / 42501 / 边缘函数 / 平台 auth / uni fail | `normalize.ts` 纯函数；`pnpm test` 的 `normalize.test.ts` 18 项逐行走表（含 `P0001` 未知 message、`42501` 与 401 同现、平台 auth 数字 code、REST 兜底、fail 三类别） |
| 会话类行优先：401 / PGRST301 / not_authenticated 先续期并重放一次；恢复失败归一 session_expired；伪 provider 可断言 | `transport.test.ts` 14 项：401 → 续期（断言 `ensureSession(true)` 只调一次）后重放一次且用新凭证；二次 401 → 只发两次请求、归一 `session_expired`；恢复失败 → 不重放；`not_authenticated` 同路径 |
| `AppError` 定义在 `types/`；alova 错误对象不进入 Composable | `types/errors.ts`；所有非 2xx 与 fail 在拦截器内归一或抛 `AppError`（测试断言 rejection 形状），alova 的原始错误无出口 |
| 唯一翻译函数、按 source 分域、域内穷尽、未知兜底、`request_cancelled` 不展示、无敏感信息 | `utils/error-copy.ts`；`error-copy.test.ts` 8 项：两域每个类别非空、`request_cancelled` 为空、未知落 `unknown`、文案不含 `PGRST`/`postgres`/`openid`/`Bearer`/`apikey`/`Error:`/`stack` |
| 枚举新增时编译报错（防漏翻译 / 清单漂移） | ① 从 `error-codes.ts` 临时删 `'unknown'` → `pnpm type-check` 报 `TS2344: Type 'false' does not satisfy the constraint 'true'`（清单与生成枚举双向穷尽检查）；② 从 `error-copy.ts` 临时删 order 的 `unknown` → `TS2741 ... but required in type 'Record<...>"unknown"...>`；均恢复后 type-check 全绿 |
| `order_error_code` 加法新增 `unknown`，类型重新生成零差异 | 迁移本地应用成功；`supabase gen types typescript --local > types/database.types.ts` 相对提交版只多 `unknown`；再次生成逐字节 `diff` 为空（`GEN-TYPES ZERO-DIFF OK`） |
| pgTAP 基线保持可运行；受影响断言按新枚举更新 | `supabase test db --local`：19 个文件 616 项；18 个文件全绿，含改过的 `80_create_order.test.sql`（枚举清单 10 值）与 `92_urge.test.sql`；唯一失败为 `40_menu_view.test.sql`，原因是本地库存在演示订单（`order_items` 外键引用商品、该用例要求空库），属既有环境状态、与本次改动无关（重建后的空库上跑 `rebuild.sh` 应全绿） |
| vitest 不引入第二份 vite、不动小程序构建链 | `ls node_modules/.pnpm \| grep '^vite@'` 只有 `vite@5.2.8_...` 一份；`pnpm ls vite -r` 根仍为 `vite@5.2.8`；`vitest.config.ts` 独立于 `vite.config.ts`（不加载 uni / tailwind 插件） |
| 小程序仍可构建 | `pnpm build:mp-weixin` → `Build complete.` |
| 客户端全量编译与风格 | `pnpm type-check` 0 错误；`pnpm lint` 0 错误 / 0 警告；`pnpm format` 无格式告警 |
| 单元测试全绿 | `pnpm test`：3 个文件 40 项全过（归一 18、文案 8、通道 14） |

### 有意偏差与遗留（Story 1.3 / 后续 story 关闭）

1. **`api/` 零改动（2B 裁定）**：`api/auth/http.ts` 仍是旧网络实现，`api/auth/errors.ts` 仍是旧翻译实现，`api/auth` 仍持有会话状态。因此「全仓无绕开通道的 `uni.request`」「`api/` 不持有运行时状态」「error-copy 是唯一翻译函数」三条在 Story 1.2 不成立，全部记在 **Story 1.3**（会话迁 `core/session` 时删除 `api/auth`）。
2. **Story 1.2 无真实运行时消费方**：`core/transport` 的第一个调用方是 Story 1.3 的 `core/session`（裸通道），故本 story 不在模拟器做通道冒烟；运行时证据由「stub `uni.request` 跑真实 alova 实例」的 14 项单测承担。
3. **`order_error_code.unknown` 提前**：原计划随 Story 3.1 权限迁移落地；Story 3.1 该项变为复核（迁移已存在、类型已生成）。
4. **AD-6 未覆盖 REST（目录）域的服务端失败**：未归类失败统一落 `order.unknown` 兜底文案（域模型没有目录域）；Story 2.2 的目录失败态按此消费，如体验不合适再评估。
5. **`40_menu_view.test.sql` 的本地环境失败**：非本次改动引入；如需全绿可在演示前跑 `supabase/scripts/rebuild.sh`（会清空本地栈数据，属演示前预检动作，不属本 story）。
6. **过渡期重复**：`core/transport/config.ts` 与 `api/auth/config.ts` 读取同名构建变量；Story 1.3 删除后者。
