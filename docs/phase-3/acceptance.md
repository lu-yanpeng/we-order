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

## Story 1.3 会话模块（登录 · 持久化 · 单飞续期 · 回退重登）

- 日期：2026-09-26
- 环境：本地 Supabase 栈（CLI 2.117.0 / Postgres 17）；mp 侧 `pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm test`（vitest 3.2.7）、`pnpm build:mp-weixin`
- 范围：客户端新增 `core/session`、重建 `api/auth.ts` 门面并删除旧 `api/auth/`、验证页换接线；**后端零改动**
- 裁定记录：验证页保留改接线（1A）、凭证重放按钮删除（2A）、提前量 5 分钟 + 登录重试上限 3 次退避 0/1s/2s（3A）、凭证变更通知本 story 一起做（4A）、会话状态内存持有（5A，Storage 篡改需重新编译/重启）

### 交付物

| 类别 | 内容 |
| --- | --- |
| 新增（客户端） | `src/core/session/`：`index.ts`（组装 + transport provider 注册）、`session.ts`（单飞 / 主动续期 / 回退重登 / 退避与上限 / 变更通知）、`storage.ts`（`weorder_session` 唯一读写 + 损坏自愈）、`login.ts`（`uni.login` + `wechat-login` + 平台续期，走裸通道）、`types.ts`、`README.md`、`session.test.ts`（16 项） |
| 新增（客户端） | `src/api/auth.ts`：会话门面（`warmUpSession()` / `getSessionUser()`，只转调 `core/session`，不自建登录请求） |
| 删除（客户端） | `src/api/auth/` 全目录（`index` / `session` / `login` / `http` / `errors` / `config` / `verify` / `README`）；旧会话状态、旧 `uni.request` 通道、旧翻译函数一并退场 |
| 修改（客户端） | `pages/auth-check/`（换接新门面：会话预热 / 并发 ×3 / 失败文案自检；移除凭证重放）；`core/transport` 三处注释与 README 的 Story 1.2 遗留段 |
| 依赖（客户端） | `+@alova/shared@1.3.4`（直挂；见下方「构建阻塞修复」） |
| 未改动 | `src/api/orders.ts`、`src/api/cart.ts`、`src/mock/**`、页面结构（订单侧随 Epic 3/4 迁移） |

### 会话设计落点

- 依赖方向成立：`api/auth.ts → core/session → core/transport（裸通道）→ 平台`；transport 不 import session，取凭证与会合经装载时注册的 provider 回调（`core/session/index.ts` 注册）。
- 静默登录：`uni.login` 一次性凭证 → `wechat-login`（裸通道）→ 建立会话并持久化；无登录界面、无授权弹窗、不索取资料。
- 持久化：`weorder_session` 形状与 Phase 2 完全一致（`accessToken` / `refreshToken` / `expiresAt` / `userId`），升级不强制重登（Story 1.4 的 gate 保留该 key）；损坏 / 缺字段按无会话处理并清掉。
- 单飞 + 主动续期：模块级 `inflight` 一条链；每次拿到会话后按 `expiresAt − 5 分钟` 排一个定时器，到点后台续期；失败静默且不重排（下一次会合兜底）；请求前 `ensureSession()` 是硬保证。
- 回退重登：续期被平台明确拒绝（400 / 401）→ 清会话 → 静默重登（同一 openid 映射同一身份）；网络类失败保留原会话、错误上抛。「续期发出后被杀、新凭证丢失」走同一条回退路径（平台已轮换，旧刷新凭证被拒）。
- 退避与上限：登录失败仅对 `session_failed` / `identity_failed` / `network_unreachable` / `timeout` 自动重试，上限 3 次、退避 0 / 1s / 2s；`rate_limited` 等不自动重试。
- 不留半登录：只有完整会话才写内存与存储；任何失败不落盘。
- 会话状态内存持有（5A）：启动时从存储恢复并纳入主动续期（剩余不足提前量则立即后台续期）；不进 Pinia、不经 `api/` 暴露。
- 凭证变更通知：`subscribeSession()` 在登录 / 续期成功后回调 `{ accessToken, userId }`，供 Epic 5 的 realtime 同步订阅凭证。

### 验收点与证据

| Story 1.3 验收点 | 证据 |
| --- | --- |
| 冷启动无会话：静默完成登录并持久化；无登录界面、无授权弹窗 | `core/session/login.ts` + `api/auth.ts`；单测「无会话：静默登录一次并持久化；重复会合不重复登录」；手动验证 #1 |
| 已有有效会话：冷启动 / 重启直接复用、不重复登录 | `createSession` 装载时 `loadStoredSession()`；单测「有效会话恢复：零网络、零登录」；存储形状与 Phase 2 一致（升级可复用）；手动 #2 |
| 续期单飞：并发只发一次续期，其余复用同一结果 | 单测「并发会合只发一次续期」「并发会合单飞：冷启动三条并发只登录一次」；手动 #4 |
| 主动续期：到期前自动续期、调用方无感 | `session.ts` `scheduleRenewal()` + 单测「主动续期：不需要请求触发」；手动 #5 |
| 续期失败回退重登：带退避与上限、不产生第二身份、不留半登录 | `isInvalidRefresh` → `loginWithRetry()`；单测「续期被平台拒绝：清本地会话并回退重登，身份不变」「续期遇到网络失败：不重登、保留原会话」「连续失败到达上限：抛最后错误、不落盘」「session_failed 自动重试」「非可重试类别不自动重试」；手动 #6 |
| 续期发出后被杀、新凭证丢失同样回退 | 平台轮换后旧刷新凭证被拒 → 同一条回退路径（无特判）；手动 #7 |
| `ensureSession()` 会合语义：等待在飞登录 / 续期，不暴露「未登录」 | provider 注册（`core/session/index.ts`）→ transport 请求前会合；`api/auth.ts` 只暴露 `warmUpSession()` / `getSessionUser()`；单测「force：本地看似有效也强制恢复」 |
| 上层不出现 token 一词；请求头构造只在 `core/transport` | `grep -rni token` 于 pages / composables / stores / components / 分包：唯一命中为 `bottom-bar/index.vue` 的 CSS 设计变量注释（与会话无关）；`headers.ts` 为唯一请求头构造点（Story 1.2 已证） |
| 旧 `api/auth/` 删除，会话职责由 `core/session` 承接 | 目录已删除（8 个文件）；`api/auth.ts` 仅转调 `core/session`；`grep "AuthError\|authErrorMessage\|verifyUsedCodeReplay"` 无结果 |
| 关闭 Story 1.2 遗留：「全仓无绕开通道的 `uni.request`」 | `grep -rn "uni\.request(" src` 无字面调用；请求全部经 alova（适配器内部调用），旧 `api/auth/http.ts` 已删 |
| 关闭 Story 1.2 遗留：「`api/` 不持有运行时状态」 | 会话状态在 `core/session` 内存；`api/` 引用 `core/` 仅 `api/auth.ts`；`api/` 其余文件只做存储出口（cart / orders）与 Mock（随各自 story 迁移） |
| 关闭 Story 1.2 遗留：「error-copy 是唯一翻译函数」 | `api/auth/errors.ts` 已删；`utils/error-copy.ts` 为唯一翻译点；验证页改用 `errorCopy` + `isAppError` |
| 会话承载可替换（验证矩阵 #10） | transport 层以伪 provider 断言续期 / 重放（Story 1.2 的 14 项）；本 story `session.test.ts` 以注入假 http 跑真实状态机（不 mock 自身）；`grep` 上层（pages / composables）无 `core/` import |
| 参数与存储自愈 | 提前量 / 上限 / 退避为 `session.ts` 顶部常量；单测「存储损坏 / 缺字段：自愈为无会话并重新登录」「平台响应缺字段：归一为 login.unknown 且不落盘」 |
| 客户端全量编译与构建 | `pnpm type-check` 0 错误；`pnpm lint` 0 错误 / 0 警告；`pnpm format` 无格式告警 |
| 单元测试全绿 | `pnpm test`：4 个文件 56 项全过（会话 16、归一 18、文案 8、通道 14） |
| 小程序仍可构建且会话代码入包 | `pnpm build:mp-weixin` → `Build complete.`；产物含 `core/session/*` 与 `core/transport/*` |

### 构建阻塞修复（Vite/uni 与 pnpm）

alova 在本 story 第一次真正进入小程序包（此前无调用方），暴露 `@dcloudio/vite-plugin-uni` 强制 `resolve.preserveSymlinks: true` 与 pnpm 严格目录的组合问题：alova / adapter 的传递依赖 `@alova/shared` 从符号链接路径解析不到。处理：`pnpm add -E @alova/shared@1.3.4` 直挂（与 alova 内部 pin 的版本一致），构建恢复；`@alova/shared` 是 alova ESM 入口唯一的外部 import。

### 手动验证结果（模拟器 / 真机，2026-09-26 演示者执行）

步骤与预期见 `mp/src/core/session/README.md`「手动验证」一节（11 步 + 真机复验）。

| # | 结果 | 证据 / 说明 |
| --- | --- | --- |
| 1 | 通过（模拟器 + 真机） | 冷启动 1 次 `wechat-login` 成功、页面显示本人 id、`weorder_session` 落盘；无授权弹窗 |
| 2 | 通过（模拟器 + 真机） | 重启后无 `wechat-login`、无续期请求，同一 id（有效会话直接复用） |
| 3 | 通过（模拟器） | 过期会话重启后 1 次 `refresh_token` 续期成功，存储更新 |
| 4 | 通过（模拟器） | 冷启动并发 ×3 只发 1 次 `wechat-login`（单飞），三条结果同一 id |
| 5 | 通过（模拟器） | 静置约 15 秒自动出现续期（主动续期，无需点击） |
| 6 | 通过（模拟器） | 无效刷新凭证 → 续期 400 → 自动 `wechat-login` 重登，id 不变 |
| 7 | 通过（模拟器，修正版） | 用真实被轮换掉的旧刷新凭证（续期后回填旧会话 + 过期时间）→ 续期 400 → 自动重登，id 不变（模拟「续期发出后被杀、新凭证丢失」） |
| 8 | 通过（模拟器） | `supabase stop` 后显示 `[network_unreachable] 网络不可用，请检查网络后重试`，无白屏、不崩 |
| 9 | 通过（模拟器） | `supabase start` 后重试成功，同一 id、不产生第二个身份 |
| 10 | 通过（模拟器） | 非法 JSON 的 `weorder_session` 被自动清理并重新登录 |
| 11 | 通过（模拟器） | 三行文案互不相同、无堆栈 / 密钥 / OpenID 等敏感信息 |
| 真机（1 / 2 / 6） | 1、2 通过；6 未执行 | 真机证据：静默登录与会话恢复。6 的原因：真机重启小程序会断开真机调试、重连耗时长于「启动瞬间续期 / 重登」的观察窗口，无法观察网络面板；与模拟器为同一代码路径，经演示者确认**接受该偏移**。 |

> 步骤 7 的原始写法在「内存持有会话 + 只改 Storage 不重启」时观察不到现象（回填的旧会话若仍在有效期会被直接复用）；已按「真实轮换作废的旧刷新凭证 + 过期时间」的修正版执行通过，README 已同步该写法。该时序（400 / 401 → 回退重登）另有单测覆盖。

### 有意偏差与遗留（Story 1.4 / 2.3 / Epic 5）

1. **验证页保留到 Story 2.3**（1A）：本 story 只换接线并移除凭证重放按钮（2A）；`pages.json` 首页与页面删除仍按原计划留给 Story 2.3。
2. **会话状态内存持有**（5A）：开发者工具直接改 Storage 需重新编译 / 重启才生效（README 已注明）；Phase 2 的「读-through 存储」写法不再保留。
3. **主动续期失败不重排定时器**：失败静默且有界（下一次请求 / 会合兜底），避免循环重试；如演示上需要更积极的恢复策略，再评估。
4. **凭证变更通知暂无消费方**：`subscribeSession()` 已按 AD-2 提供，Epic 5 的 `core/realtime` 接 `setAuth` 时消费。
5. **启动编排未接**：`App.vue:onLaunch` 的预热调用属 Story 1.4（`use-app-bootstrap.ts`）；当前验证入口为 `pages/auth-check/`。
6. **订单 / 目录侧仍 Mock**：`api/orders.ts`、`api/products.ts`、`api/store.ts`、`src/mock/` 未动，随 Epic 2 / Epic 4 迁移；本 story 不产生 Mock↔真实开关。
