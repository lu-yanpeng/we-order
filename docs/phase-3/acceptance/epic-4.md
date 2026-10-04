# Phase 3 验收记录 · Epic 4（一单到底：订单进度与失败可控）

## Story 4.1 订单列表（三态 · 读时推进 · 分页 · 空态）

- 日期：2026-09-30
- 环境：mp 侧 `pnpm test`（vitest 3.2.7）、`pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm build:mp-weixin`；**后端零改动**（无迁移、无函数改动、无类型再生成——读取接口 `get_my_orders` 与读时推进 / 归属隔离沿用 Phase 2 Story 5.1 证据）
- 范围：订单列表切换为服务端真实读取（`get_my_orders`）+ 列表状态机（加载 / 失败 / 空 / 内容）+ 下拉刷新 + 触底分页（2026-09-30 范围修订）+ 卡片下单时间 + 首页两 tab 首屏骨架（2026-09-27 范围修订留给本 Story 的目录骨架一并落地）+ 文档回写；**未含**：订单详情真实读取与「再来一单」快照还原（Story 4.2）、轮询与状态单调应用（4.3）、催单（4.4）、确认取杯（4.5）
- 裁定记录（Ly，2026-09-30）：① 触底分页本轮落地，不做会遗忘（落点 = 本 Story：AC 增补 + PRD / spine 回写；避免「永远只显示 20 单」的隐性缺口）；② 卡片增加下单时间（观察 UI；4.7 重排卡片时保留）；③ 4.1 只切列表，详情 / 再来一单在 4.2 之前的过渡失败态接受（严格按 epic 故事边界）；④ 三态平铺、不做状态分组标题（与 Phase 1 一致）

### 交付物


| 类别 | 内容 |
| --- | --- |
| 修改（客户端） | `src/api/orders.ts`：`fetchOrders(cursor)` 改为经对接层 `POST /rest/v1/rpc/get_my_orders`（`p_limit = 20`、游标原样回传、`session-required`）；删除 Mock 列表读写与 seed（`loadOrders` / `saveOrders` / `toListItem` / `mock/orders.ts` 引用）；`fetchOrderById` 过渡期不下发本地读取 |
| 修改（客户端） | `src/pages/home/composables/use-orders.ts`：状态机（加载 → 失败 → 空 → 内容）、可见域读取入口 `loadOrders(userInitiated?)`（进入可见域按「只增不删」合并、游标从原处续翻；用户主动刷新整表替换）、下拉刷新 `refreshOrders()`、触底分页 `loadMoreOrders()`（追加去重 + 页脚失败态 + 守卫）、骨架 250ms 延迟、失败保留数据 |
| 修改（客户端） | `src/pages/home/composables/use-products.ts`：目录骨架 250ms 延迟状态（仅首屏无数据可能显示；刷新 / 重试不回骨架） |
| 修改（客户端） | `src/pages/home/index.vue`：订单可见域（订单 tab 激活 且页面可见，`onShow` / `onHide`）驱动读取；订单 tab 模板三分支（骨架 / 失败态 / 内容）+ `scroll-view` refresher 与 scrolltolower + 分页页脚；点餐 tab 骨架接线 |
| 修改（客户端） | `src/pages/home/components/order-card/index.vue`：卡片头部增加下单时间（服务端格式化的 `created_at` 文本，原样展示） |
| 修改（客户端） | `src/composables/use-home-tabs.ts`：新增 `switchTab('menu' \| 'orders')`（订单空态「去点餐」使用） |
| 新增（客户端） | `src/pages/home/components/order-card-skeleton/`（订单卡片骨架）、`catalog-skeleton/`（目录双栏骨架）、`orders-empty/`（空态「还没有订单」+「去点餐」）：三者均为纯展示，事件只向外 emit |
| 修改（测试） | `src/api/orders.test.ts`：`fetchOrders` 2 项（URL / 三参数 / `session-required`；游标原样回传、请求体无用户标识字段） |
| 新增（测试） | `src/pages/home/composables/use-orders.test.ts`：8 项——首屏渲染 / 空态 / 失败态（文案）、骨架 250ms 防抖、进入可见域合并与游标续翻、下拉刷新整表替换与游标重置、触底追加去重与守卫、失败保留数据（自动静默 / 主动 toast）、分页失败保留数据与页脚文案 |
| 修改（文档） | `prd.md`（FR-P3-10 交互增量 + 修订记录）、`ARCHITECTURE-SPINE.md`（「最小 UI 规范」形态表 + 修订记录）、`epics.md`（Story 4.1 AC 增补触底分页） |
| 未改动 | 后端全部（迁移 / 函数 / 类型 / 脚本）；`mock/orders.ts` 文件本体（已无调用方，随 Story 4.2 收口删除）；订单详情 / 再来一单（4.2）、催单（4.4）、确认取杯（4.5） |

### 关键实现点

1. **单一数据源**：列表读取只走 `get_my_orders`（RPC，读时推进）；`src/` 中 `weorder_orders` 已无任何读取（仅 `api/storage.ts` 的启动清理清单与测试保留该 key）；`mock/orders.ts` 已无任何引用。
2. **状态机顺序固定**：加载（骨架延迟 250ms、仅首屏无数据）→ 失败（首屏无数据失败 → 页面内失败态 + 重试；已有数据失败 → 保留数据、仅用户主动刷新时 toast）→ 空（成功且 0 条）→ 内容（平铺三态）。`loaded` 标记保证刷新 / 重试不回骨架、失败不被骨架或空态伪装。
3. **可见域读取与合并**：页面把「订单 tab 激活 且页面可见」合成 `ordersInDomain`，只在 false→true 时读一次——切回 tab、从详情返回、回到前台、支付成功后的自动切换全覆盖；页面隐藏 / 离开订单 tab 不发请求（Story 4.3 的 `setActive` 与轮询 / 订阅接在同一条读取入口上）。进入可见域的读取按 AD-7「只增不删」合并：已知 id 就地更新、未知 id 插入、未出现在本页的已加载条目保留；游标以「尾部未变」为准——原游标非空则保留（续翻不重头）、原游标为空而新页仍有下一页则采用新游标（覆盖「连新增多单」的缺口）；请求序号与状态单调由 Story 4.3 在这同一入口上补齐。
4. **触底分页**：`next_cursor` 原样回传（键集游标、客户端不解析不拼接）；追加按 id 去重、只增不删；守卫 = 整表读取中 / 分页在飞 / 无下一页均不触发；下拉刷新（显式刷新）整表替换并重置游标（AD-7 的「显式刷新」）。页脚三态：加载中「加载中…」/ 到底「--- 没有更多了 ---」/ 失败「类别文案 + 重试」（保留已加载数据）。
5. **过渡边界**：`fetchOrderById` 不再下发任何读取（满足「不再读本地 `weorder_orders`」的字面判据），详情页与「再来一单」在 4.2 之前表现为「订单不存在」的失败态；不做假数据兜底。

### 验收点与证据

| Story 4.1 验收点 | 证据 |
| --- | --- |
| 经服务端读取路径（`get_my_orders`，读时推进）返回本人订单；分页默认 20 条 | 单测：URL = `/rest/v1/rpc/get_my_orders`、体 = `{ p_limit: 20, p_before_created_at: null, p_before_id: null }`、`meta.session-required`；读时推进 / 归属隔离 / 未登录拒绝沿用 Phase 2 Story 5.1 与 `verify:rebuild` 证据（本 Story 零后端改动） |
| 展示订单号、状态、取杯号、商品摘要、金额、时间（格式来自服务端） | 卡片沿用 `order_number` / 三态样式 / `item_summary` / `total_amount` / 取杯号块（待取餐）；新增 `created_at` 行（服务端格式化文本原样展示）；真实链路表现属手动清单 #1 |
| 读取失败先触发续期 / 重登，失败则失败态 + 重试、不展示任何订单数据（含本地缓存）、不以空列表伪装 | `session-required` 的续期重放一次由通道拦截（Story 1.2 证据）；失败态分支仅在「无数据」时进入（`orders.length === 0`），文案来自 `utils/error-copy.ts`，重试绑定 `refreshOrders`；已有数据失败保留数据、不清空 |
| 客户端不直接读表；不传用户标识、归属不可伪造 | 请求体恰为三个分页参数（单测 `Object.keys` 断言），无 `user_id` / 金额字段；REST 裸表仅作纵深防御（P2 AD-5 沿用） |
| `order.id` 用于 RPC / 订阅 / 列表 key，`order_number` 用于展示；`order-card`、`goToOrderDetail` 同步修正 | 代码沿用：列表 `:key="order.id"`、跳转 `/sub-order-detail/order-detail/index?id=${order.id}`、展示 `order.order_number`（Epic 1 的 `types/api-contracts.ts` 映射，本 Story 未引入新的手工形状） |
| 空订单态：「还没有订单」+「去点餐」引导；空态不发起重复读取 | `orders-empty` 组件（文案 + `t-button` → `switchTab('menu')`）；`isEmpty` 仅在「已出结果 + 无错误 + 0 条」为真；不轮询（滚动 / 可见域外不发请求） |
| 不再读本地 `weorder_orders`、不再 seed Mock 订单 | `grep -rn "weorder_orders" src/`：仅注释与 `api/storage.ts` 清理清单 / 测试；`grep -rn "mock/orders\|mockOrders" src/`：仅 `mock/orders.ts` 自身定义（0 引用） |
| 首页两 tab 首屏骨架（分开实现、色块占位、`delay` 约 250ms、仅首屏无数据、刷新不回骨架） | 两个独立组件 + 各自 composable 的 250ms 定时器与 `loaded` 判定；构建产物含 `animate-pulse` 与 `@keyframes pulse`（app.wxss）；慢 3G 复验属手动 #2 |
| 状态判定顺序为加载 → 失败 → 空 → 内容 | 模板三分支顺序（骨架 / 失败态 / 内容）与 composable 状态条件一致；首屏失败进失败态（`loaded` + `error`），空态只在成功且 0 条 |
| 订单 tab 下拉刷新：触发一次最新读取；首屏失败无内容可拉，恢复入口仍是失败态「重试」 | `scroll-view` 的 `refresher-enabled` / `refresher-triggered` / `@refresherrefresh`（构建产物已含）；失败态视图无 scroll-view（无内容可拉）；手动 #5 |
| 订单 tab 触底自动加载下一页（2026-09-30 范围修订） | 构建产物含 `scrolltolower` / `lower-threshold`；`use-orders.test.ts` 覆盖游标回传 / 追加去重 / 守卫 / 分页失败保留数据；服务端键集边界不重不漏沿用 Phase 2 证据；手动 #4（需 >20 单前置） |
| 进入可见域读取「只增不删」合并（AD-7；4.3 补序号与单调） | `use-orders.test.ts`：新单插入、已翻的页保留、续翻仍用原游标；下拉刷新整表替换并重置游标（单测） |
| 类型契约与编译期保护不回归 | `types/api-contracts.ts` 未改动（`OrdersPage` / `OrderListItem` / `OrderResult` 沿用）；`pnpm type-check` 0 错误 |
| 既有行为不回归 | `pnpm test` 99 项全过（新增 10 项：orders API 2 + 列表 Composable 8；既有 89 项不回归）；`pnpm build:mp-weixin` Build complete |

### 验证命令与输出（可复现）

```bash
cd mp
pnpm test             # 9 文件 / 99 项全过（新增 10 项：orders.test.ts 2 + use-orders.test.ts 8）
pnpm type-check       # 0 错误
pnpm lint             # 0 错误
pnpm build:mp-weixin  # Build complete.

# 单一数据源证据
grep -rn "weorder_orders" src/          # 仅 api/storage.ts 清理清单 + 注释 / 测试
grep -rn "mock/orders\|mockOrders" src/ # 仅 mock/orders.ts 自身定义（0 引用）
grep -rn "initOrders" src/              # 0（旧 Mock 读取入口已移除）
```

```text
✓ src/pages/home/composables/use-orders.test.ts (8 tests)   # 状态机 / 合并 / 分页 / 骨架 / 失败保留
✓ src/api/orders.test.ts (10 tests)    # ensureCheckoutIntent 6 + payOrder 2 + fetchOrders 2
✓ src/api/storage.test.ts (6 tests)
✓ src/utils/checkout-intent.test.ts (16 tests)
✓ src/core/transport/normalize.test.ts (18 tests)
✓ src/core/transport/transport.test.ts (14 tests)
✓ src/core/session/session.test.ts (16 tests)
✓ src/utils/error-copy.test.ts (8 tests)
✓ src/api/cart.test.ts (3 tests)

Test Files  9 passed (9)
     Tests  99 passed (99)
```

构建产物抽查（`dist/build/mp-weixin`）：`pages/home/components/` 含 `catalog-skeleton` / `order-card-skeleton` / `orders-empty`；`pages/home/index.wxml` 含 `refresher-enabled` / `refresher-triggered` / `lower-threshold` / `scrolltolower`；`app.wxss` 含 `.animate-pulse` 与 `@keyframes pulse`。

### 手动验证清单（演示者执行）

前置：本地栈在跑（`supabase start`）、`mp/.env.local` 指向本地栈、开发者工具已勾选「不校验合法域名」；建议先「清缓存并重启」。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | 进订单 tab（有真实历史单） | 展示本人订单（时间倒序、三态颜色正确）：订单编号 / 下单时间 / 商品摘要 / 金额；待取餐单带取杯号块；不出现任何 Mock 订单 | 通过 |
| 2 | 开发者工具网络限速（慢 3G）冷启动，分别进两个 tab | 约 250ms 后出现骨架（点餐 = 双栏、订单 = 卡片）；快网不闪；切 tab / 下拉刷新不回骨架 | 通过 |
| 3 | 停后端（`supabase stop`）→ 进订单 tab | 失败态「网络不可用，请检查网络后重试」+「重试」；不白屏、不展示任何订单数据；起后端 → 点重试 → 列表恢复 | 通过 |
| 4 | 本地库造 >20 张单（如 `verify-pickup-codes` 或脚本批量建单）→ 触底加载；随后切到点餐 tab 再切回订单 tab | 页脚「加载中…」→ 追加下一页、顺序正确；到底「--- 没有更多了 ---」；切 tab 回来已翻的页保留、不缩回第一页；中途停后端再触底 →「类别文案 + 重试」，已加载数据不丢、恢复后可继续 | 通过 |
| 5 | 订单 tab 下拉刷新 | 触发一次读取（网络面板仅 1 条 `get_my_orders`）、指示器读完收起；已有数据时失败保留数据并 toast 一次文案 | 通过 |
| 6 | 全新身份（无订单）进订单 tab | 空态「还没有订单」+「去点餐」；点击切到点餐 tab；空态不自动轮询、不对同一失败反复重试——读取只发生在进入 tab、下拉、点重试时 | 通过 |
| 7 | 支付成功返回订单 tab | 自动读一次、新单出现在顶部且为「制作中」 | 通过 |
| 8 | 点订单卡片进详情（4.2 前的过渡） | 详情页显示「订单不存在」失败态；4.2 切换真实读取后关闭本行 | 通过 |

> 2026-10-03 由演示者在微信开发者工具按上表执行，8 项全部通过；Story 4.1 验收关闭。
>
> 4.8 预演时，本表 #1 / #2 / #4 / #5 并入验证矩阵 #1（演示主路径）、#9（界面无回归，含骨架 / 下拉 / 分页复验项）。
>
> #4 前置（为本人身份造 >20 单）：Supabase Studio → SQL Editor 批量建单（`postgres` 是函数属主，可直接执行）——
> `select public.create_order_for_user('<本人 user_id>'::uuid, '[{"product_id":"00000000-0000-4000-8000-000000000203","quantity":1,"selections":{}}]'::jsonb, 'dinein', '无备注要求', 'bulk-' || g::text) from generate_series(1, 25) g;`
> 本人 `user_id` 可从 `select user_id, created_at from public.wechat_identities order by created_at desc`（或 Studio → Authentication → Users）取得；卡布奇诺为无规格商品，`selections` 传空对象。同批键重复执行不会重复建单（幂等），要更多单换前缀即可。

### 有意偏差与遗留

1. **详情 / 再来一单的过渡失败态**：`fetchOrderById` 过渡期不下发读取（满足「不再读本地 `weorder_orders`」的字面判据、界面不可能读到 Mock），详情页与列表卡片「再来一单」在 4.2 之前表现为「订单不存在」；`mock/orders.ts` 已无调用方，随 Story 4.2 的清理清单删除。属既定故事边界（裁定 ③），非缺陷。
2. **手动清单 8 项已执行并全部通过（2026-10-03）**：运行 / 编译 / 单测 / 构建证据已在本 Story 内取证；真实链路（登录 → 读取 → 骨架 / 失败 / 空 / 分页 / 下拉 / 返回刷新）由演示者在开发者工具按上表执行（含评审反馈修复后的复验），结果列已补——本项关闭。
3. **「已有数据时刷新失败」的处理为 4.1 首次定义**：保留数据 + 仅用户主动刷新 toast、自动（可见域）刷新静默；Story 4.6 错误提示收口时可统一调整（当前不违反最小 UI 规范）。
4. **空态下拉刷新**：空态保留在 scroll-view 内（`min-h-[70vh]`）以保留下拉能力；「空态不做无意义轮询」由「无自动轮询 + 可见域外不读取」保证，未额外禁用下拉。
5. **触底分页的验收前置**：演示默认身份单量不足 20，手动 #4 需先批量建单；分页正确性的服务端部分（键集边界不重不漏）沿用 Phase 2 `95_order_list` / `verify:rebuild` 证据。

### 补记（2026-10-03）：Story 4.1 评审反馈修复

触发：Ly 在开发者工具复验 4.1（本地栈 / 26 张单）后报两个问题与一处文案疑问；本次修复不回写 PRD / spine（行为口径不变，均为实现缺陷与文案澄清）。

**问题 1：订单状态标签停在旧值**（取杯块已出现、右上角仍「制作中」；清缓存重启后正常）

- 根因：小程序构建链使用 `@vue/compiler-sfc@3.4.21`（运行时 vue 为 3.5.39），3.4 的编译器**不做响应式 props 解构**——`const { order } = defineProps()` 编译成普通解构快照，脚本内 `computed` 读到的 `order.status` 永不更新；而模板里的 `wx:if` / 取杯号绑定编译为实时 `t.order`——同一张卡片「块实时、标签滞旧」。
  证据（修复前产物 `order-card/index.js`）：`const { order: r } = t`、`s=e.computed(()=>c[r.status])`、`i:"pickup"===t.order.status`。对照组：3.5.39 编译器会把 `computed(() => order.status)` 改写为 `__props.order.status`（实测）。
- 修复：`order-card` 改为 `const props = defineProps` + `props.order`（computed / 函数全部经 props 对象）；重新构建后产物为 `const o=t`、`s=e.computed(()=>c[o.order.status])`（实时）。
- 同类排查（全仓 6 处 `defineProps`）：`spec-sheet` / `bottom-bar` 未解构；`load-failure` / `product-card` 解构但仅模板使用（模板为实时绑定）；`checkout-bar` 解构名仅出现在类型与模板、`watch` 目标是 `defineModel`；`stepper` 的 `min` / `max` 在函数中读快照，但现有两处调用均传静态值（潜在同类，未改，留待需要动态值时处理）。
- 约定回写：`mp/AGENTS.md` 的「响应式解构」条目增加编译器行为注意块。

**问题 2：到底后切 tab 回来，「没有更多了」消失且可再次触底加载**（网络响应的 `next_cursor` 非空）

- 根因：进入可见域的合并 `mergeFirstPage` 原规则「本地游标为空且服务端第一页仍有下一页 → 采用服务端游标」；单量 >20 时服务端第一页恒带 `next_cursor`，于是已到底的列表每次切回都被重新解锁，触底会重翻已加载的页。
- 修复：游标归属改为按「本地合并前是否已有可续翻的尾部」——有则**保留原游标**（到底保持到底、未到底从原处续翻）；只有首屏 / 空态 / 失败恢复后的首次成功才采用服务端游标。下拉刷新（显式刷新）仍整表替换并重置游标（AD-7 口径不变）。
- 证据：`use-orders.test.ts` 新增 1 项——「到底后再次进入可见域：保持没有更多，不被服务端第一页的游标重新解锁」（含「触底不再发分页请求」断言）。

**问题 3（文案澄清，无代码变更）**：手动 #6 的「页面不发起重复请求」改为「空态不自动轮询、不对同一失败反复重试——读取只发生在进入 tab、下拉、点重试时」（原表述易被误读为「切 tab 不读取」）。

验证命令与输出：

```bash
cd mp
pnpm test             # 9 文件 / 100 项全过（新增到底回归 1 项）
pnpm type-check       # 0 错误
pnpm lint             # 0 错误
pnpm build:mp-weixin  # Build complete.（order-card 产物已复核为实时 props 读取）
```

## Story 4.2 订单详情与「再来一单」

- 日期：2026-10-03
- 环境：mp 侧 `pnpm test`（vitest 3.2.7）、`pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm build:mp-weixin`；**后端零改动**（详情读取 `get_my_order_detail` 与读时推进 / 归属隔离沿用 Phase 2 Story 5.2 的 pgTAP `96_order_detail` 与 `verify:rebuild` 证据；无迁移、无函数改动、无类型再生成）
- 范围：订单详情切服务端真实读取（`get_my_order_detail`）+ 详情状态机（加载遮罩 / 失败态 / 下拉刷新）+ 取杯号制作中即展示（详情 + 列表卡）+ 「再来一单」按当前目录还原（失效行丢弃）+ Mock 订单侧整体收口（删除 `mock/orders.ts`）+ 文档回写；**未含**：轮询与状态单调（4.3）、催单与确认取杯真实调用（4.4 / 4.5）、错误提示全量收口（4.6）、订单图片（4.7）
- 裁定记录（Ly，2026-10-03）：① 取杯号制作中即展示范围为**详情页 + 列表卡片**（「既有 UI」按全部含旧假设处处理）；② 详情页改**页面自然滚动** + `enablePullDownRefresh` 实现页面级下拉（原 `h-screen + 内层 scroll-view` 是复制确认订单页的壳——该结构为固定支付底栏所需，详情页没有底栏，属多余且会吃掉页面级下拉手势；首页两个 scroll-view 与确认订单页结构不动）；③ 「再来一单」全部行失效时**中止**：toast + 不替换购物车、不跳转（避免清空用户当前购物车）；④ `load-failure` 移为根组件 `src/components/load-failure/`（主包首页与详情分包共用，主包仍有调用方，满足 AD-9 与微信分包硬约束）；⑤ `use-reorder` 编排写单元测试；⑥ 详情下拉的「重置轮询计时」由 Story 4.3 在同一读取入口接上（同 4.1 过渡口径）；⑦（执行中范围补充）已完成详情同样展示取餐码——标题位置显示「取餐码 + 号码」、描述改「订单已完成，祝您用餐愉快」（参考蜜雪冰城；三态详情页后续整体重新设计，本 Story 用占位样式）
- 设计补充（执行中收敛）：结算栏未挂载时展开面板会先走分包懒加载的 `uni.showLoading`，组件挂载后的 `hideLoading` 可能吞掉「部分商品已失效」toast——`use-checkout-bar.ts` 的 `openCartDetail()` 改为返回「面板就绪」Promise（行为不变，唯一调用方为再来一单），toast 在 `await` 之后就绪后提示

### 交付物

| 类别 | 内容 |
| --- | --- |
| 修改（客户端） | `src/api/orders.ts`：`fetchOrderById(id)` 由过渡桩（返回 undefined）改为真实读取——`POST /rest/v1/rpc/get_my_order_detail`、体 `{ p_order_id }`、`session-required`，返回 `OrderDetail`（失败抛 `AppError`）；头注释收口（详情接入、Mock 删除） |
| 修改（客户端） | `src/sub-order-detail/composables/use-order-detail.ts`：状态机——首读全屏遮罩（250ms 延迟防闪烁、完成 / 失败即撤）、失败态文案（唯一翻译 + 兜底）、失败重试不弹遮罩、下拉刷新（已有数据失败保留 + toast、无数据失败转失败态）、空 id 本地守卫（不发请求）；催单 / 确认取杯占位不动（4.4 / 4.5） |
| 修改（客户端） | `src/sub-order-detail/order-detail/index.vue`：改为页面自然滚动；三分支（加载 → 失败态 `load-failure` → 内容）；取杯号块条件 `status !== 'completed'`（制作中即展示），已完成在标题位置显示「取餐码 + 号码」、描述「订单已完成，祝您用餐愉快」（2026-10-03 范围补充）；全屏遮罩（`t-overlay` + 居中 `t-loading` 白字、`styleIsolation: shared`）；页面级 `onPullDownRefresh` → 读取一次 → `stopPullDownRefresh` |
| 修改（配置） | `src/pages.json`：详情页 style 增加 `"enablePullDownRefresh": true` |
| 修改（客户端） | `src/composables/use-checkout-bar.ts`：`openCartDetail()` 返回「面板就绪」Promise（已挂载立即 resolve；未挂载在 `onBarReady` 补执行展开后 resolve），其余行为不变 |
| 新增（客户端） | `src/utils/reorder.ts`：纯函数 `buildReorderItems(snapshotItems, categories)`——按当前目录价（基础价 + 规格加价）与当前标签重建购物车条目；下架 / 规格失效行丢弃并计数；售罄（`sold_out`）保留 |
| 修改（客户端） | `src/composables/use-reorder.ts`：编排——列表卡先取详情 → 读当前目录 → 纯函数还原 → 有效条目整车替换 + 切点餐 tab + 展开面板；部分失效 toast「部分商品已失效」（面板就绪后）；全部失效 / 详情读取失败 / 目录读取失败 → 中止且购物车不变 |
| 修改（客户端） | `src/pages/home/components/order-card/index.vue`：取杯块条件 `pickup` → `status !== 'completed'`，块内右侧标签改为当前状态文案（制作中 / 待取餐） |
| 重组（客户端） | `src/components/load-failure/`：由 `pages/home/components/load-failure/` 移到根组件（首页 import 同步；详情页失败态复用） |
| 删除（客户端） | `src/mock/orders.ts`（0 引用）与空目录 `src/mock/`（FR-P3-3 订单侧整体收口） |
| 新增（测试） | `src/utils/reorder.test.ts`（10 项）、`src/sub-order-detail/composables/use-order-detail.test.ts`（8 项）、`src/composables/use-reorder.test.ts`（6 项） |
| 修改（测试） | `src/api/orders.test.ts`：新增 `fetchOrderById` 2 项（URL / 唯一参数 / `session-required` / 无用户标识） |
| 修改（文档） | 本验收记录 |
| 未改动 | 后端全部（迁移 / 函数 / 类型 / 脚本）；确认订单页与其 inner scroll-view；首页两个 scroll-view；`types/api-contracts.ts` 契约（`OrderDetail` / `OrderDetailItem` 已与生成类型一致，零漂移） |

### 关键实现点

1. **详情单一数据源**：读取只经 `get_my_order_detail`（RPC、读时推进、归属谓词与 RLS 同构）；请求体只有订单 id，无用户标识；非本人与不存在返回同一类别 `order_not_found`，界面呈现「订单不存在或已失效」，不泄露订单存在性。过渡桩 `fetchOrderById` 删除后，全仓不存在任何 Mock 读取路径。
2. **详情与再来一单的职责分离**：详情永远原样展示服务端快照（含已下架、售罄的历史行，不参与任何失效判定）；「失效」只发生在再来一单构建新购物车时——商品不在当前 `menu`（下架）或规格组 / 选项无法还原 → 丢弃该行；售罄仍在 `menu` 中，正常入车，支付时由服务端 `product_unavailable` 拒绝（FR-P3-7 口径）。
3. **当前目录计价**：`buildReorderItems` 用当前 `price + calcSpecExtras(...)` 重算 `unitPrice`、用当前标签重建 `specSummary`、取当前商品名；快照价 / 旧名只留详情历史展示。`selections` 做防御性拷贝，多选数组不共享引用。
4. **规格还原严格双向**：当前有规格组 → 每组必须有有效选择（单选 string / 多选 string[]，选项 id 必须存在）；快照出现当前不存在的组 key、缺少组选择、无规格商品残留旧选择 → 一律判失效；多选部分选项失效也判失效（整行丢弃，不做部分保留）。
5. **失败不脏状态**：再来一单全程在 `try` 内——详情 / 目录读取失败用 `errorCopy` toast 后中止，`setItems` 从未调用，购物车与界面不变；全部失效同样中止；`reordering` 守卫防重复点击（在飞期间第二次调用不发请求）。
6. **toast 与懒加载 loading 的顺序**：结算栏位于分包、按需加载（P1 AD-4-f），未挂载时展开面板会 `uni.showLoading`，组件挂载后 `hideLoading` 可能吞掉 toast；`openCartDetail()` 返回就绪 Promise，toast 在「返回首页 + 面板就绪」之后才发出（单测断言调用顺序）。
7. **页面级下拉**：详情页去掉 `h-screen + 内层 scroll-view`（那是确认订单页为固定底栏所需的结构，详情页复制后多余且会吃掉页面级手势），改页面自然滚动 + `enablePullDownRefresh`；失败态分支用 `h-screen` 容器保证居中；首读遮罩期间 / 读取在飞时下拉被守卫拦住，指示器立即收起。
8. **取杯号旧假设修正**：详情状态卡与列表卡片都在 `cooking / pickup` 展示取杯号块；列表卡块内右侧标签随状态（制作中 / 待取餐）；已完成详情在标题位置展示「取餐码 + 号码」（2026-10-03 范围补充，占位样式），三态详情页后续整体重新设计时再统一。

### 验收点与证据

| Story 4.2 验收点 | 证据 |
| --- | --- |
| 详情经服务端读取路径返回本人订单快照，字段与生成类型一致；快照不受商品改名 / 改价影响 | `api/orders.test.ts`：URL = `/rest/v1/rpc/get_my_order_detail`、体 = `{ p_order_id }`、`meta.session-required`、请求体仅一个参数；读取 / 推进 / 归属隔离 / `order_not_found` 语义沿用 Phase 2 Story 5.2 证据（本 Story 零后端改动）；`types/api-contracts.ts` 未改动、`pnpm type-check` 0 错误；真实链路与改价不变属手动 #1 |
| 取杯号在「制作中」即展示（付款后即出号） | 详情模板条件 `order.status !== 'completed'`；列表卡条件同；构建产物 `order-card/index.js` 含 `"completed"!==t.order.status`；手动 #1 / #2 |
| 读取失败 / 不可见订单给出明确失败态与重试入口（类别文案，不泄露存在性），不展示缓存数据 | `use-order-detail.test.ts`：首读失败 → `order=null`、文案「订单不存在或已失效」；`load-failure` 组件（文案 + 重试按钮 loading）；失败不展示旧数据 |
| 读取期间全屏遮罩（`t-overlay` + 居中 `t-loading` 白字），完成即撤；失败转失败态 | `use-order-detail.test.ts`：遮罩 250ms 延迟出现、完成即撤、重试不弹遮罩；详情页 `styleIsolation: shared` + CSS 变量白字；构建产物 `index.json` 含 `t-overlay` / `t-loading`；手动 #3 |
| 页面级下拉刷新：触发一次最新读取；失败恢复入口仍是「文案 + 重试」 | `pages.json` → 构建产物 `index.json` 含 `"enablePullDownRefresh": true`；`index.js` 含 `onPullDownRefresh` / `stopPullDownRefresh`；刷新失败口径（已有数据保留 + toast、无数据失败态）进单测；手动 #5 |
| 「再来一单」替换购物车、返回首页、自动展开面板；按快照还原规格选择 | `use-reorder.test.ts`：`setItems(有效条目)` / `$emit(home-tab-switch,'menu')` / `openCartDetail()` / 详情页场景 `navigateBack`；`utils/reorder.test.ts`：selections 还原（含数组拷贝）；手动 #4 |
| 购物车计价永远按当前目录价，快照价仅用于历史展示 | `utils/reorder.test.ts`：快照价 99 → 还原价 37（当前 30 + 大杯 3 + 加浓缩 4）、名称 / 摘要取当前目录；`use-reorder.test.ts` 断言 `setItems` 收到当前价条目 |
| 已下架 / 规格失效的行被丢弃并 toast「部分商品已失效」（不阻断其余条目） | `utils/reorder.test.ts` 10 项覆盖：下架、选项变更、缺组、多余 key、多选类型错、无规格残留选择、售罄保留、混合计数、空输入；`use-reorder.test.ts`：部分失效只写有效条目 + toast；全部失效中止；手动 #7 |
| 再来一单的失败不留脏状态（FR-P3-19） | `use-reorder.test.ts`：详情读取失败 / 目录读取失败 → 类别文案 toast、`setItems` / `openCartDetail` 未调用；全部失效同；重复点击守卫；手动 #8 |
| wire 转换复用唯一转换器 `toCreateOrderItems()` | 再来一单只产出 `CartItem`（写购物车），下单时经唯一转换器转 wire；`grep -rn "toCreateOrderItems" src/`：实现唯一在 `api/cart.ts`，消费点为结算与意图指纹；无展开条目直传 |
| 旧订单 Mock 实现与 `mock/orders.ts` 删除；无 Mock 数据源引用与并存开关（FR-P3-3 收口） | `git status`：`src/mock/orders.ts` 删除、目录移除；`grep -rn "src/mock\|mock/orders\|mockOrders\|initOrders" src/` 仅 `api/orders.ts` 的一行历史说明注释；构建产物 `find dist -path '*mock*'` 0 命中；`weorder_orders` 仅存于启动清理清单与测试 |
| 既有 UI 取杯号「待取餐才有」旧假设修正；已完成详情在标题位置显示取餐码（2026-10-03 范围补充） | 详情页与列表卡 `cooking / pickup` 显示取杯号块；已完成详情标题位置显示「取餐码 + 号码」、描述「订单已完成，祝您用餐愉快」（参考蜜雪冰城，占位样式）；卡片块内标签随状态；手动 #1 / #2 |
| 类型契约与编译期保护不回归；已有行为不回归 | `pnpm test` 126 项全过（新增 26 项：orders API 2 + reorder 纯函数 10 + 详情 Composable 8 + 再来一单编排 6；既有 100 项不回归）；`pnpm type-check` 0 错误；`pnpm build:mp-weixin` Build complete |

### 验证命令与输出（可复现）

```bash
cd mp
pnpm test             # 12 文件 / 126 项全过（新增 26 项）
pnpm type-check       # 0 错误
pnpm lint             # 0 错误
pnpm build:mp-weixin  # Build complete.

# 单一数据源 / 收口证据
grep -rn "src/mock\|mock/orders\|mockOrders\|initOrders" src/   # 仅 api/orders.ts 历史说明注释
grep -rn "scroll-view" src/sub-order-detail/                    # 0（详情页改页面滚动）
grep -rn "get_my_order_detail" src/ | grep -v test              # 唯一调用在 api/orders.ts
find dist/build/mp-weixin -path '*mock*'                        # 0 命中
```

```text
✓ src/api/orders.test.ts (12 tests)                          # 结算意图 6 + payOrder 2 + fetchOrders 2 + fetchOrderById 2
✓ src/utils/reorder.test.ts (10 tests)                       # 失效判定 / 当前价 / 售罄保留 / 计数
✓ src/sub-order-detail/composables/use-order-detail.test.ts (8 tests)  # 状态机 / 遮罩 / 刷新 / 空 id
✓ src/composables/use-reorder.test.ts (6 tests)              # 编排 / 三个中止分支 / 顺序 / 守卫
✓ 其余 8 文件 90 项不回归

Test Files  12 passed (12)
     Tests  126 passed (126)
```

构建产物抽查（`dist/build/mp-weixin`）：`sub-order-detail/order-detail/index.json` 含 `enablePullDownRefresh: true`、`t-overlay` / `t-loading` / `load-failure` 组件声明；`index.wxml` 无 `scroll-view`、含取杯号块与 `detail-loading`；`index.js` 含 `onPullDownRefresh` / `stopPullDownRefresh`；`pages/home/components/order-card/index.js` 含 `"completed"!==t.order.status`；`utils/reorder.js` 已产出。

### 手动验证清单（演示者执行）

前置：本地栈在跑（`supabase start`）、`mp/.env.local` 指向本地栈、开发者工具已勾选「不校验合法域名」；建议先「清缓存并重启」；准备至少一张「制作中」与一张「已完成」的真实订单。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | 打开「已完成」订单详情（目录里商品曾改名 / 改价更好） | 商品名 / 规格摘要 / 金额 / 门店名称 / 地址 / 电话 / 订单编号 / 下单时间 / 就餐方式 / 备注完整；内容为下单时快照，不随目录改名改价；状态卡标题位置显示「取餐码」+ 号码，描述为「订单已完成，祝您用餐愉快」 | 通过 |
| 2 | 打开「制作中」订单详情；同时看订单列表卡片 | 详情状态卡在制作中即显示取杯号；列表卡片同样出现取杯块且块内右侧为「制作中」 | 通过 |
| 3 | 慢 3G 下进详情；快网再进一次 | 约 250ms 后出现全屏遮罩（白字「加载中...」），读取完成即撤；快网不闪遮罩；失败转入失败态、不显示缓存 | 通过 |
| 4 | 停后端（`supabase stop`）→ 进详情 | 失败态「网络不可用，请检查网络后重试」+「重试」；不白屏、不展示任何缓存；起后端 → 点重试 → 详情恢复 | 通过 |
| 5 | 详情页下拉刷新 | 触发一次 `get_my_order_detail`（网络面板仅 1 条）、指示器读完收起；停后端下拉 → 保留已展示数据 + 类别文案 toast 一次 | 通过 |
| 6 | 「再来一单」（列表卡片触发一次、详情页触发一次） | 替换当前购物车、返回首页点餐 tab、面板自动展开；规格选择按快照还原；购物车名称 / 规格摘要 / 单价为当前目录值（与结算页显示一致） | 通过 |
| 7 | 构造部分失效：对订单里**其中一个**商品执行 `update public.products set availability = 'delisted' where id = '<商品 id>';`，再回小程序「再来一单」 | 该行被丢弃、其余商品入车 + toast「部分商品已失效」；不阻断其余条目；验证后恢复 `availability = 'on_sale'` | 通过 |
| 8 | 全部行失效：对该订单的**全部**商品执行 `update public.products set availability = 'delisted' where id in (<商品 id 列表>);`，再来一单 | toast「部分商品已失效」；购物车保持原样、不跳转、不展开面板；验证后恢复 `on_sale` | 通过 |
| 9 | 停后端点「再来一单」（含列表卡与详情页两处） | 类别文案 toast；购物车与界面不变、可重试（恢复后端后重点） | 通过 |

> **失效构造说明（2026-10-03 演示者反馈）**：失效判定按**稳定 ID**（商品 id / 规格组 id / 选项 id），不按名称与 label——
> - 商品 / 规格选项**改名**不会使行失效：详情仍显示下单时快照，再来一单购物车显示当前名称 / 当前 label、当前价（预期行为，AD-14 / AD-15 口径）；
> - `sold_out` 是**售罄**不是失效：商品仍在 `menu` 中，正常入车，支付时由服务端以 `product_unavailable` 拒绝（FR-P3-7，本阶段不做置灰）——不能用来构造 #7 / #8；
> - 构造 #7 / #8 需**下架**（`availability = 'delisted'`，`menu` 视图会过滤），或删除 / 替换规格组、选项（快照 `selections` 引用的 id 不再存在）；演示后记得恢复。

> 2026-10-03 由演示者在微信开发者工具按上表执行（含已完成取餐码展示与下架失效构造复验），9 项全部通过；Story 4.2 验收关闭。

> 4.8 预演时，本表 #1 ~ #3 / #6 / #7 并入验证矩阵 #1（演示主路径）、#9（界面无回归，含 AD-4 专项 ④「未加载时再来一单触发下载并自动展开」）。

### 有意偏差与遗留

1. **详情下拉的「重置轮询计时」未实装**：轮询在 Story 4.3 接入，本 Story 只交付「立即读一次」入口（同 4.1 的过渡口径）；4.3 会在同一入口重置计时。
2. **手动清单 9 项已执行并全部通过（2026-10-03）**：运行 / 编译 / 单测 / 构建证据在本 Story 内取证；真实链路（详情 / 遮罩 / 失败态 / 下拉 / 再来一单三分支 / 失效构造 / 失败不脏状态）由演示者在开发者工具按上表执行，结果列已补——本项关闭。
3. **详情页布局结构微调**（裁定 ②）：去掉 `h-screen + 内层 scroll-view` 与 `scrollbar-hide`，改页面自然滚动；视觉与交互不变，页面级下拉由此可用。确认订单页（固定支付底栏）与首页两个 scroll-view 不动。
4. **`openCartDetail()` 返回类型变更**：`Promise<void>`（就绪 resolve），唯一调用方 `use-reorder`；未就绪时行为与原先一致（补挂载后展开），仅新增「等待者」语义。
5. **「全部失效」无 AC 明文**：按裁定 ③ 中止（不替换购物车）。替代方案（替换为空车）会把用户当前购物车清空，明确不做。
6. **手动 #8 的过渡失败态关闭**：Story 4.1 手动 #8 记录的「详情页显示订单不存在」过渡态随本 Story 切换真实读取关闭；`fetchOrderById` 不再有返回 `undefined` 的分支。
7. **再来一单的编排无 loading 反馈**（沿袭 Phase 1）：读取详情 / 目录期间只有 `reordering` 守卫防重复，不弹 loading；慢网下的可感知等待由 4.8 预演观察，若需要再加（属交互增量，需回写文档）。

## Story 4.3 刷新编排与状态应用单调（轮询）

- 日期：2026-10-04
- 环境：mp 侧 `pnpm test`（vitest 3.2.7）、`pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm build:mp-weixin`；**后端零改动**（轮询只消费既有读取路径 `get_my_orders` / `get_my_order_detail`；推进时长 / 扫描周期等演示参数的调整属 Story 4.4 的验收项）
- 范围：新增刷新编排（根 `composables/use-order-status.ts`：5s 轮询 / 可见域 / 串行化 / 失败降级 / 订阅接入点）+ 状态应用单调纯函数（`utils/order-status.ts`：排序 / 合并 / 序号判定）+ 列表与详情接入（seq 铸造、自动合并与显式刷新、分页取号、空态 / 终态停轮询）+ 页面接线（首页 `setActive`；详情 `onShow` / `onHide` / `onUnload`）；**未含**：订阅建立与回退实装（Epic 5）、催单 / 确认取杯真实调用（4.4 / 4.5）、错误提示收口（4.6）、订单图片（4.7）
- 裁定记录（Ly，2026-10-04）：① 降级恢复——任一读取成功（下拉 / 重试 / 重新进入可见域）即清零并恢复轮询；② 失败计数——进入 / 轮询 / 手动统一计数，连续 3 次即停轮询（首读失败占额度）；③ 无意义轮询停止范围——空列表停 + 详情「已完成」停；列表「全部已完成」保留轮询（按字面，不加特判）；④ 在飞读取时的手动刷新——等待在飞读取完成后补跑一次（不丢弃、不并发）；⑤ 详情首读单一触发路径——`onLoad` 只登记 id，首读由 `onShow → setActive(true)` 发起（遮罩判据改为「本页首个读取」）

### 交付物


| 类别 | 内容 |
| --- | --- |
| 新增（客户端） | `src/utils/order-status.ts`：纯函数——`statusRank` / `advanceStatus`（cooking < pickup < completed、completed 终态、同值幂等）/ `applyOrderRead`（单条序号门 + 状态单调）/ `mergeOrderList`（只增不删合并）/ `replaceOrderList`（整表替换、同 id 仍单调、applied 重置）/ `appendOrderPage`（分页追加去重）；`AppliedSeqMap` 按订单 id 记录已应用序号 |
| 新增（客户端） | `src/composables/use-order-status.ts`：刷新编排（根，主包 / 分包共用）——`setActive`（进入立即读 + 启动 5s 链式轮询、离开停表）/ `setSubscriptionHealthy`（Epic 5 接入点）/ `runManualRead`（显式刷新 + 重置计时）/ `nextSeq`（统一铸造序号，供分页）/ `dispose`（卸载停表）/ `isPolling`（开发期观察）；连续失败 3 次降级、串行化（自动合并 / 手动补跑） |
| 修改（客户端） | `src/pages/home/composables/use-orders.ts`：读取入口改为 `readOrders(seq, kind)`——`auto` 走 `mergeOrderList`（序号门 + 只增不删）、`manual` 走 `replaceOrderList`（整表替换 + 游标重置）；轮询编排接线（`shouldPoll = !isEmpty`）；分页经 `nextSeq()` + `appendOrderPage`；`loadOrders` 退役、对外暴露 `setActive` |
| 修改（客户端） | `src/pages/home/index.vue`：`watch(ordersInDomain)` 由直接 `loadOrders` 改为 `setOrdersActive`（编排入口，语义与 4.1 相同：进入 / 切回 tab / 回前台立即读） |
| 修改（客户端） | `src/sub-order-detail/composables/use-order-detail.ts`：读取入口改为 `readOrder(seq, kind)`——`applyOrderRead` 单条序号门 + 单调；编排接线（`shouldPoll` = 有 id 且未完成）；`prepareOrderDetail` 只登记 id；`setActive` / `dispose` / `retryOrderDetail` / `refreshOrderDetail` 走编排 |
| 修改（客户端） | `src/sub-order-detail/order-detail/index.vue`：`onLoad` 只登记 id；`onShow` / `onHide` / `onUnload` 驱动 `setActive` / `dispose` |
| 新增（测试） | `src/utils/order-status.test.ts`（11 项）；`src/composables/use-order-status.test.ts`（10 项，fake timers 驱动轮询 / 降级 / 订阅回退 / 串行化） |
| 修改（测试） | `src/pages/home/composables/use-orders.test.ts`（9 → 15 项：全部经 `setActive` 入口；新增轮询 5s 刷新、状态单调、轮询合并、轮询失败静默、空态停轮询、离开 / 回台） |
| 修改（测试） | `src/sub-order-detail/composables/use-order-detail.test.ts`（8 → 13 项：单一触发路径；新增轮询 5s 刷新、completed 停轮询、状态单调、自动失败静默、回台立即读） |
| 修改（文档） | 本验收记录 |
| 未改动 | 后端全部（迁移 / 函数 / 类型 / 脚本）；`types/api-contracts.ts`；`api/orders.ts`（读取接口形状不变） |

### 关键实现点

1. **职责分层**：纯逻辑（排序 / 合并 / 序号判定）唯一在 `utils/order-status.ts`（可单测）；调度与生命周期在根 `composables/use-order-status.ts`；`use-orders` / `use-order-detail` 只实现「读取 + 应用 + 呈现」，读取入口带 `seq` 与 `kind`；`api/` 与 `core/` 不持有序号（AD-7）。
2. **单计时器 + 链式 5s**：`scheduleNextPoll` 只在读取链的 `finally` 调用——读取完成后才排下一次；任何新读取先取消旧计时器（重置计时）。同一视图至多一个计时器、至多一个在飞读取（NFR-P3-1「不产生请求堆积」）。
3. **串行化**：在飞时自动读取（进入 / 轮询）合并跳过（在飞读取已覆盖本次意图）；手动读取登记补跑，在飞完成后同一读取链内执行——兑现「下拉必然读取一次」且不并发、不排队堆积。
4. **失败降级**：`execute` 统一计数（成功清零 / 失败 +1，含 `read` 抛异常兜底）；连续 3 次 `canPoll` 为 false → 停止轮询、保留数据、手动入口仍在；任一成功（含重新进入可见域）清零并恢复（裁定 ①②）。
5. **无意义轮询停止**：`shouldPoll` 谓词——列表 `!isEmpty`（空态停；失败态继续静默重试以自愈，首屏无数据失败 → 页面失败态）；详情 `orderId !== '' && status !== 'completed'`（completed 终态停；空 id 本地守卫不轮询）（裁定 ③）。
6. **详情单一触发路径**：`onLoad` 只登记 id；首个读取由 `onShow → setActive(true)` 发起；`loadedOnce` 判据保证只有首个读取弹 250ms 全屏遮罩（重试 / 下拉 / 轮询不弹）；`onUnload → dispose()` 防残留计时器（裁定 ⑤）。
7. **订阅接入点**：`setSubscriptionHealthy(true)` 停表 / `false` 回退排定；默认未启用 → 轮询为唯一刷新路径；「SUBSCRIBED 前先补读一次」由 Epic 5 在置位前完成（本 Story 只留状态机接入点）。
8. **列表游标口径不回归**：`auto` 合并沿用「本地已有可续翻尾部则保留原游标」（4.1 评审修复）；轮询读取同样只增不删，不冲掉已翻页、不重新解锁「已到底」。

### 验收点与证据

| Story 4.3 验收点 | 证据 |
| --- | --- |
| 推进时刻到点后 ≤ 一个轮询周期 + 1 秒自动更新（间隔 5s） | `use-order-status.test.ts`：进入立即读 + `advanceTimersByTimeAsync(5000)` 触发第二次读取；`use-orders.test.ts`「轮询刷新」、`use-order-detail.test.ts`「轮询刷新」；真实链路（15s 推进到点 ≤6s 可见）属手动 #1 / #2；构建产物 `use-order-status.js` 含 `setTimeout(..., 5e3)` |
| 进入 / 切 tab / onShow 立即读 + 重置计时；隐藏 / 离开停表；单计时器、无堆积 | 编排测试「重新进入重置计时」「离开停表」「串行化」；页面接线：首页 `watch(ordersInDomain) → setActive`、详情 `onShow` / `onHide` / `onUnload`（构建产物断言）；手动 #2 / #3 |
| 下拉刷新按显式刷新处理：立即读一次并重置轮询计时，与轮询 / 订阅共享同一状态应用路径（单调），不产生堆积 | `runManualRead`（manual kind；完成后重排计时；在飞时补跑）；列表 manual → `replaceOrderList` + 游标重置（既有用例不回归）；详情 manual → 同一 `applyOrderRead` 路径；手动 #4 |
| 「订阅健康 → 不轮询」的接入点（订阅未启用时轮询为唯一刷新路径） | 编排测试「订阅健康 → 不轮询 / 恢复回退」；产物含 `setSubscriptionHealthy`；Epic 5 消费；默认状态 `subscriptionHealthy = false` |
| seq 单调：只接受更大 seq 的结果、旧响应不覆盖；completed 终态；重复应用幂等 | `order-status.test.ts` 11 项（序号门 / 单调 / 终态 / 幂等）；`use-orders.test.ts`「状态单调」（pickup 不被 cooking 覆盖）；`use-order-detail.test.ts`「completed 停轮询」「状态单调」 |
| 列表只增不删（已知 id 更新、未知 id 插入、陈旧读取只合并不删除）；整表替换只由首屏 / 显式刷新 / 分页重置；状态按页实例持有 | `mergeOrderList` / `replaceOrderList` / `appendOrderPage` 用例；`use-orders.test.ts`「轮询读取同样只增不删」；`appliedSeqs` 为 composable 实例内 `Map`（页间不共享） |
| 纯函数进单元测试清单 | `src/utils/order-status.test.ts`（11 项） |
| 轮询失败静默重试 3 次；仍失败停止轮询、降级为手动刷新入口（保留已有数据）；首屏无数据失败 → 页面失败态；失败不叠加 | 编排「连续失败达到上限即降级」（3 次后不再自动读、手动仍可、成功恢复）；`use-orders.test.ts`「轮询失败：静默保留数据」；`use-order-detail.test.ts`「自动读取失败静默」；无数据失败态既有用例保留（自动失败不 toast）；手动 #7 |
| 类型契约与编译期保护不回归；既有行为不回归 | `pnpm test` 158 项全过（原 126 + 新增 32：utils 11 + 编排 10 + 列表 6 + 详情 5）；`pnpm type-check` 0 错误；`grep -rn "loadOrders\|initOrderDetail\|setInterval" src/` 0 命中（旧入口退役、无 setInterval） |

### 验证命令与输出（可复现）

```bash
cd mp
pnpm test             # 14 文件 / 158 项全过（新增 32 项）
pnpm type-check       # 0 错误
pnpm lint             # 0 错误
pnpm build:mp-weixin  # Build complete.

# 旧读取入口 / 轮询实现证据
grep -rn "loadOrders\|initOrderDetail\|setInterval" src/   # 0 命中（轮询为链式 setTimeout）
grep -rln "useOrderStatus" src/ | grep -v test             # 编排唯一实现 + 两个消费点（use-orders / use-order-detail）

# 构建产物
ls dist/build/mp-weixin/composables/use-order-status.js dist/build/mp-weixin/utils/order-status.js
# pages/home/index.js 含 setActive；sub-order-detail/order-detail/index.js 含 onShow / onHide / onUnload / prepareOrderDetail / dispose
```

```text
✓ src/utils/order-status.test.ts (11 tests)                       # 纯函数：排序 / 单调 / 序号门 / 合并 / 替换 / 追加
✓ src/composables/use-order-status.test.ts (10 tests)             # 编排：轮询 / 重置 / 降级 / 订阅回退 / 串行化 / dispose
✓ src/pages/home/composables/use-orders.test.ts (15 tests)        # 9 项改造为 setActive 入口 + 6 项轮询 / 单调 / 空态
✓ src/sub-order-detail/composables/use-order-detail.test.ts (13)  # 8 项改造为单一触发路径 + 5 项轮询 / 终态 / 单调
✓ 其余 10 文件 109 项不回归

Test Files  14 passed (14)
     Tests  158 passed (158)
```

构建产物抽查：`composables/use-order-status.js` 含 `setTimeout(()=>{o=null,m.value=!1,d()&&h("auto")},5e3)`（5s 链式轮询）与 `u<3`（连续失败 3 次降级）；`utils/order-status.js` 为纯函数模块；`pages/home/index.js` / `sub-order-detail/order-detail/index.js` 已产出接线代码。

### 手动验证清单（演示者执行）

前置：本地栈在跑（`supabase start`）、`mp/.env.local` 指向本地栈、开发者工具已勾选「不校验合法域名」；准备至少一张可推进的订单（下单后门店 15s 推进、扫描周期 3s）。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | 下单支付成功落到订单 tab（制作中），保持可见等待到点 | 不手动刷新，状态在 ≤ 一个轮询周期 + 1s（≤6s）内变「待取餐」；网络面板可见每 5s 一条 `get_my_orders` | 通过 |
| 2 | 打开一张「制作中」订单详情并保持可见 | 到点后 ≤6s 自动更新；网络面板每 5s 一条 `get_my_order_detail`；打开 / 进入已完成单后读取停止（终态停轮询） | 通过 |
| 3 | 切到点餐 tab / 退到后台，再切回 / 回前台 | 离开后网络面板不再有订单读取（停轮询）；切回 / 回前台立即出现 1 条读取（重置计时） | 通过 |
| 4 | 订单 tab 下拉刷新 | 立即 1 条 `get_my_orders`（整表替换、游标重置）；指示器收起后下一次轮询在约 5s 后 | 通过 |
| 5 | 造 >20 单并触底加载第二页后，停在列表等待轮询 | 轮询只读第一页合并：已翻出的第二页不消失、底部「--- 没有更多了 ---」不重新解锁 | 通过 |
| 6 | 服务端造一张单的异常旧状态（SQL 见下）后等待轮询 | 页面保持原状态不倒退（「待取餐」/「已完成」标签不回「制作中」）；随后按还原 SQL 恢复；属异常构造，单调守护已由单测确定性覆盖 | 通过 |
| 7 | 停后端（`supabase stop`）留在列表（已有数据），观察约 20s 后起后端 | 失败期间保留数据、无 toast 刷屏；连续 3 次失败后停止轮询（网络面板不再有请求）；起后端后下拉刷新成功并恢复轮询 | 通过 |
| 8 | 全新身份进订单 tab（空态） | 显示「还没有订单」+「去点餐」；网络面板无轮询请求（空态不轮询） | 通过 |

> **#6 的异常构造 / 还原 SQL**（Supabase Studio → SQL Editor 执行，只动本地演示数据；已在本地栈用「事务 + 回滚」验证可执行、不报约束错误）：
>
> ```sql
> -- 0) 先查最近几单，挑一张「待取餐」或「已完成」的，复制它的 id（同理记下原状态）
> select id, order_number, status, pickup_code, ready_at, auto_complete_at
> from public.orders order by created_at desc limit 5;
>
> -- 1) 构造「服务端返回旧状态」：把这单假装改回「制作中」
> --    completed_at / auto_complete_at 必须跟着清空（表约束要求：
> --    「已完成 ⇔ 有完成时刻」「非制作中 ⇔ 有自动完成时刻」），
> --    ready_at 推后 1 小时防止服务端读时推进立刻纠正回「待取餐」
> update public.orders
> set status = 'cooking',
>     auto_complete_at = null,
>     completed_at = null,
>     ready_at = now() + interval '1 hour'
> where id = '<订单 id>';
>
> -- 2) 还原（二选一，按第 0 步看到的原状态执行）
> -- 2a) 原为「待取餐」：还原成待取餐，30 秒后由服务端自动完成
> update public.orders
> set status = 'pickup',
>     completed_at = null,
>     auto_complete_at = now() + interval '30 seconds'
> where id = '<订单 id>';
> -- 2b) 原为「已完成」：还原成已完成
> update public.orders
> set status = 'completed',
>     completed_at = now(),
>     auto_complete_at = now()
> where id = '<订单 id>';
> ```
>
> 说明：构造后在订单列表 / 详情保持可见，等至少 10 秒（2 个轮询周期）观察——预期状态标签保持不倒退（「待取餐」/「已完成」不回到「制作中」），然后按 2a / 2b 还原。取杯号恒有值、不受本操作影响。

> 2026-10-04 由演示者在微信开发者工具按上表执行（含 #6 异常旧状态构造与还原复验），8 项全部通过；Story 4.3 验收关闭。

> 4.8 预演时，本表 #1 / #2 / #5 / #7 并入验证矩阵 #1（演示主路径：轮询可见性）、#13（自动完成感知）、#9（界面无回归：停轮询 / 下拉重置 / 分页不被轮询冲掉）；#3 / #4 属刷新策略专项。

### 有意偏差与遗留

1. **列表轮询只读第一页**（沿用 4.1 的第一页合并口径）：已翻出的旧页订单状态变化不在轮询范围内——演示主路径的活跃单恒在第一页；扩为「按已加载范围读取」不在本阶段（如需，Epic 5 或后续收敛）。
2. **列表「全部已完成」停轮询（2026-10-04 补记修订裁定 ③）**：停止轮询 = 没有可能推进的内容——空列表 + 列表全部已完成 + 详情 completed；假设「新订单只能经离开订单 tab 下单再回来产生」（回来必经 `setActive` 立即读取），不考虑同账号多设备——已确认。
3. **订阅实装不在本 Story**：建立 / 凭证同步 / 断线回退 / 「SUBSCRIBED 前先补读」由 Epic 5 消费 `setSubscriptionHealthy` 完成；本 Story 的编排状态机即 AD-8 的接入形状。
4. **催单 / 确认取杯后的立即刷新**：4.4 / 4.5 可直接复用 `runManualRead`（立即读 + 重置计时）作为操作后刷新入口，接入时确认口径。
5. **`dispose` 兜底**：详情页 `onHide` 已停表，`onUnload → dispose()` 兜底防残留计时器（返回时 onHide 是否触发以微信运行时为准）。
6. **失败计数含首次进入读取**（裁定 ②）：首读失败占 3 次额度中的 1 次；失败态期间轮询继续静默重试（≤2 次），成功即自愈显示——与「首屏无数据的失败 → 页面失败态」兼容。
7. **手动清单 8 项已执行并全部通过（2026-10-04）**：运行 / 编译 / 单测 / 构建证据已在本 Story 内取证；真实链路（轮询可见性 / 隐藏停表 / 回台立即读 / 下拉重置 / 分页不被轮询冲掉 / 异常旧状态不倒退 / 失败降级与恢复 / 空态不轮询）由演示者在开发者工具按上表执行（含 #6 修正后 SQL 的构造与还原），结果列已补——本项关闭。

### 补记（2026-10-04）：全完成列表停轮询（裁定 ③ 修订）

触发：演示者复验后提出——列表全部已完成时轮询纯空转，为什么不停？原裁定 ③ 为「按字面：空列表 + 详情 completed 停，列表全部已完成保留轮询」；本次修订为三处都停。

- 裁定（Ly，2026-10-04）：**不采用「连续 3 次全完成才停」的计数器方案**，用无状态谓词代替——`completed` 是终态，「全完成」不是需要采样确认的现象；新订单只能从点餐 tab 下单产生、回来必经可见域重进（`setActive(false→true)` → 立即读取），轮询对一个全完成集合没有可发现的变化；计数器只增加状态与任意阈值、不增加覆盖。
- 变更（客户端）：`src/pages/home/composables/use-orders.ts` 的 `shouldPoll` 改为三分支——空态 false（FR-P3-10）/ 失败态（0 条）true（继续静默重试以自愈）/ 内容有任一非完成 true、全部完成 false。
- 新增（测试）：`use-orders.test.ts` 1 项——「全部已完成停止轮询；刷新带回非完成单后自动恢复」（含混合状态列表继续轮询的断言；158 → 159）。
- 行为影响：全完成列表不再发轮询请求；下拉刷新 / 重进可见域带回非完成单 → 谓词重评 → 轮询自动恢复（无需额外状态）；失败态静默重试不受影响；手动 #5 的「停在列表等待轮询」场景此后仅在有非完成单时发生（「轮询不冲掉已翻页」的覆盖见 `use-orders.test.ts`「轮询读取同样只增不删」）。
- 假设（已确认）：新订单只能由本客户端产生且必经「离开订单 tab 下单再回来」；不考虑同账号多设备 / 他人代为下单。若未来 Phase 4 出现多端场景，需重新评估（或由订阅承担发现职责）。

验证命令与输出：

```bash
cd mp
pnpm test             # 14 文件 / 159 项全过（新增 1 项）
pnpm type-check       # 0 错误
pnpm lint             # 0 错误
pnpm build:mp-weixin  # Build complete.（产物 use-orders.js 含全完成停轮询谓词）
```

## Story 4.4 催单

- 日期：2026-10-04
- 环境：mp 侧 `pnpm test`（vitest 3.2.7）、`pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm build:mp-weixin`；supabase 侧 `supabase db reset`（重放全部迁移 + 种子）、`supabase test db`（19 文件 / 632 项）、`deno task verify:urge`（12 项断言）、`deno task verify:sweep`（8 项断言）
- 范围：客户端催单真实调用（`urge_order` RPC）+「已催单」两态交互 + 演示参数 cron 3 秒迁移 + 测试 / 文档回写；**未含**：确认取杯与自动完成（4.5）、操作后补读（留给 4.5）、订阅（Epic 5）
- 裁定记录（Ly，2026-10-04）：① 催单交互重设计——**不用提交 loading**，成功以「已催单」标记（按钮弱化）代替；客户端同一订单在 App 运行期内至多发起一次催单，已催过再点只重复提示「已催单，请耐心等待」（无提示会让用户以为系统坏了）；失败不标记、可重试；②「已催单」不落本地存储——催单不是核心功能（现实世界后厨收到催单也不保证先做），且 Phase 4 会重做催单（15 分钟未出餐才可催），现在不扩存储出口；③ 4.3 遗留的「催单后补读」裁定为**不做**——催单不改状态，可见性由 5 秒轮询保证，操作后刷新入口留给 4.5（确认取杯的「立即更新」是硬需求）
- 服务端背景：`urge_order` 与 `92_urge.test.sql` 在 Phase 2 已交付（提前 `ready_at`、不改状态 / 取杯号、重复幂等、归属取自会话、拒绝不可区分）；本 Story 零函数改动，只接客户端 + 收口演示参数

### 交付物

| 类别 | 内容 |
| --- | --- |
| 修改（客户端） | `src/api/orders.ts`：新增 `urgeOrder(orderId)` → `POST /rest/v1/rpc/urge_order`（体只有 `p_order_id`、`session-required`）；头注释补催单职责 |
| 新增（客户端） | `src/composables/use-urge.ts`：模块级「已催单 / 在飞」记录（按订单 id、运行期、跨页面共享）+ 单次调用 + 三种 toast（成功 / 失败类别 / 已催过重复提示） |
| 修改（客户端） | `src/pages/home/components/order-card/index.vue`：新增 `urged` prop；制作中已催过显示「已催单」（弱化样式） |
| 修改（客户端） | `src/sub-order-detail/order-detail/index.vue`：催单改经 `useUrge`（两态按钮、无 loading）；`src/pages/home/index.vue`：`@urge="urgeOrder(order.id)"` + `:urged="isUrged(order.id)"` |
| 修改（客户端） | `src/pages/home/composables/use-orders.ts` / `src/sub-order-detail/composables/use-order-detail.ts`：删除占位 `urgeOrder` 与返回项（职责移交根 composable） |
| 新增（后端） | `supabase/migrations/20261004091039_order_sweep_3s.sql`：`order-sweep` 同名替换为 3 秒（一行 `cron.schedule`） |
| 修改（后端测试） | `supabase/tests/database/91_cron_sweep.test.sql`：扫描周期断言 15 → 3 秒 |
| 修改（后端脚本） | `supabase/scripts/verify-urge.ts` / `verify-sweep.ts`：「一个扫描周期」注释与上界 15 → 3 秒 |
| 新增（测试） | `src/composables/use-urge.test.ts`（5 项）；`src/api/orders.test.ts` +2（催单请求形状） |
| 修改（文档） | `prd.md`（FR-P3-13 交互增量 + 修订记录）、`ARCHITECTURE-SPINE.md`（AD-17 + 形态表 + 修订记录）、`epics.md`（Story 4.4 AC 范围修订） |
| 未改动 | 服务端 `urge_order` 函数与 `92_urge.test.sql`；门店行参数默认值（15/3/30）；`types/database.types.ts`（无 DDL 变化）；`use-order-status` 刷新编排（操作后补读留给 Story 4.5） |

### 关键实现点

1. **服务端催单零改动**：`urge_order` 只把 `ready_at` 提前到 `min(原定时刻, 催单时刻 + 门店 `urge_lead_seconds`)`，状态翻转仍由推进机制负责；重复 / 并发催单幂等；归属取自会话、不传用户标识。本 Story 只做客户端接入 + 演示参数收口，不新增第二套逻辑。
2. **「已催单」是客户端运行期标记**（根 composable 的模块级状态，先例 `use-checkout-bar`）：成功才标记、失败不标记可重试；已催过再点不发请求、只 toast「已催单，请耐心等待」；在飞期间连点静默忽略（防重复靠标记与守卫，不靠 loading）。列表与详情共享同一份记录；App 重启即忘；不落本地存储（不新增 AD-3 存储出口）。
3. **可见性上界**：催单只把到点时刻拨到 +3 秒，页面可见时由 5 秒轮询的读时推进感知（≤ 一个轮询周期 + 3 秒）；无人读取时由 3 秒兜底扫描推进。本 Story 不做催单后补读（裁定 ③），刷新编排不动。
4. **cron 3 秒同名替换**：`cron.schedule('order-sweep', '3 seconds', ...)` 对已存在任务名是「更新」；`db reset` 重放全部迁移后 `cron.job` 仍只有一条 `order-sweep`；任务命令与两个机制（推进 + 超时完成）不动。
5. **门店行参数**：15/3/30 是列默认值（seed 不覆盖），「新单 / 新催单取新值、已出单时刻不变」沿用 Phase 2 pgTAP 证据（`80_create_order` / `92_urge` / `93_complete`）；Story 4.3 手动清单按 3 秒扫描执行的前提由本 Story 以迁移固化。
6. **失败不脏状态**：催单失败只 toast 类别文案（`utils/error-copy.ts` 唯一翻译，`invalid_status` / `order_not_found` / 网络类均可区分），不标记、不改订单展示状态。

### 验收点与证据

| Story 4.4 验收点 | 证据 |
| --- | --- |
| 调用服务端催单（`urge_order` RPC），界面即时反馈 toast「已通知门店加快制作」；≤ 一个轮询周期 + 3 秒内可见「待取餐」 | `orders.test.ts` 催单 2 项（URL / 体 / `session-required` / 无用户标识）；`use-urge.test.ts` 成功用例（toast 文案）；服务端时间行为：`verify:urge` 12 项断言（催单提前 4.1 秒被推进，≤ 12 秒上界）+ 手动 #1 |
| 客户端「只调用一次」：成功标记「已催单」、无 loading；已催过再点不发请求只提示；失败可重试；标记运行期、跨页面共享（2026-10-04 范围修订） | `use-urge.test.ts` 5 项：成功标记与 toast、失败不标记可重试、在飞连点只发一次、已催过只提示、跨实例共享；构建产物 `composables/use-urge.js` 含两条文案；手动 #2 / #3 |
| 服务端重复催单幂等：不会更早、不会延后、不报错（纵深防御） | `92_urge.test.sql`（Phase 2 基线）+ `verify:urge`「并发重复催单后推进时刻完全不变」 |
| 非「制作中」不出现催单入口；被拒时提示明确（类别文案） | 卡片 `ACTION_META` 与详情模板按状态分支（构建产物含「已催单」与状态条件）；`use-urge.test.ts` 失败用例断言 `invalid_status` 文案；手动 #4 |
| 催单失败不改变本地展示的状态 | `use-urge.test.ts` 失败用例（不标记、订单状态由读取路径持有）；手动 #5 |
| cron 扫描周期以迁移同名替换为 3s（`order-sweep` 唯一）；门店参数对新单 / 新催单立即生效、已出单时刻不变；客户端不参与时间判定 | `db reset` 后查询 `cron.job`：1 条 `order-sweep` / `3 seconds` / active；`91_cron_sweep` 断言更新；`test db` 632 项全绿；`verify:sweep` 8 项（20.2 秒 ≤ 24 秒）；门店参数证据沿用 Phase 2 pgTAP（见关键实现点 5）；手动 #6 |
| 类型契约与编译期保护不回归；既有行为不回归 | 无 DDL → `types/database.types.ts` 未动、`pnpm type-check` 0 错误；`pnpm test` 166 项全过（原 159 + 新增 7） |

### 验证命令与输出（可复现）

```bash
cd mp
pnpm test             # 15 文件 / 166 项全过（新增 7：api 2 + use-urge 5）
pnpm type-check       # 0 错误
pnpm lint             # 0 错误
pnpm build:mp-weixin  # Build complete.

cd ../supabase
supabase db reset     # 重放全部迁移（含 20261004091039_order_sweep_3s.sql）+ 种子
supabase test db      # 19 文件 / 632 项全过（Result: PASS）
deno task verify:urge   # PASS：12 项断言全部通过
deno task verify:sweep  # PASS：8 项断言全部通过

# cron 同名替换证据（重建后仅一条任务）
docker exec supabase_db_we-order psql -U postgres -d postgres \
  -c "select count(*) as sweep_jobs from cron.job where command ilike '%advance_due_orders%'"
docker exec supabase_db_we-order psql -U postgres -d postgres \
  -c "select jobname, schedule, active from cron.job order by jobid"
```

> 首次在**未重建的存量库**上跑 `test db` 时 `40_menu_view` 因存量订单引用商品触发外键错误（测试数据以干净库为前提）——按项目惯例先 `db reset` 后全绿；非本 Story 引入（见 Story 4.1 遗留的批量建单演示数据）。

```text
✓ src/composables/use-urge.test.ts (5 tests)        # 成功 / 失败可重试 / 连点一次 / 已催过只提示 / 跨实例共享
✓ src/api/orders.test.ts (14 tests)                 # 结算意图 6 + payOrder 2 + fetchOrders 2 + fetchOrderById 2 + urgeOrder 2
✓ 其余 13 文件 147 项不回归

Test Files  15 passed (15)
     Tests  166 passed (166)
```

```text
PASS：12 项断言全部通过（订单 202610041722423093 催单后 4.1 秒被兜底扫描推进为「待取餐」，取杯号 A-0001）
  ✓ 提前到「催单时刻 + 门店配置的 3 秒」（催单请求往返占用 11 毫秒）
  ✓ 并发重复催单后推进时刻完全不变（min 语义：既不更早也不更晚）
  ✓ 推进发生在「到点 + 一个扫描周期」内（4.1 秒 ≤ 12 秒）
  ✓ 推进后再次催单返回明确的 invalid_status（不是笼统的失败）

PASS：8 项断言全部通过（订单 202610041723029932 在 20.2 秒后被兜底扫描推进，取杯号 A-0002）
  ✓ 到点时刻 = 下单时刻 + 门店配置的 15 秒（推进时长没有被绕过）
  ✓ 推进发生在「到点 + 一个扫描周期」内（20.2 秒 ≤ 24 秒）

sweep_jobs = 1
jobname     | schedule  | active
order-sweep | 3 seconds | t
```

构建产物抽查（`dist/build/mp-weixin`）：`composables/use-urge.js` 含「已通知门店加快制作」「已催单，请耐心等待」；`api/orders.js` 含 `rest/v1/rpc/urge_order`；`pages/home/components/order-card/index.js` 与 `sub-order-detail/order-detail/index.js` 含「已催单」；`pages/home/index.js` 含 `urged` 属性绑定与 `isUrged`。

### 手动验证清单（演示者执行）

前置：本地栈在跑、已 `supabase db reset`（或 `migration up` 后确认 cron 为 3 秒）、`mp/.env.local` 指向本地栈、开发者工具已勾选「不校验合法域名」；建议先「清缓存并重启」；准备一张「制作中」订单（推进窗口 15 秒，下单后尽快操作；如需从容演示可按 addendum §F 临时调长门店推进时长）。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | 下单支付成功落到订单 tab → 立即点「催单」并保持可见等待 | toast「已通知门店加快制作」；按钮变「已催单」（弱化）、全程无 loading；≤ 8 秒内状态变「待取餐」（网络面板：每 5s 一条 `get_my_orders`） | 通过 |
| 2 | 连点「催单」多次；变「已催单」后再点 | 连点只发出 1 条 `urge_order`（网络面板确认）；点「已催单」不再发请求、toast「已催单，请耐心等待」 | 通过 |
| 3 | 在列表催过 → 打开该单详情；关闭并重启小程序后再打开（仍制作中，可先临时调长推进时长） | 详情按钮同样显示「已催单」（列表与详情共享）；重启后恢复为「催单」（运行期记忆、不落存储） | 通过 |
| 4 | 待取餐 / 已完成订单（列表卡片与详情） | 不出现催单入口（按钮为确认取杯 / 再来一单） | 通过 |
| 5 | 停后端（`supabase stop`）→ 点催单 → 起后端后点重试 | 失败：类别文案 toast（如「网络不可用，请检查网络后重试」）、按钮仍「催单」、订单状态不变；恢复后重试 → 成功标记 | 通过 |
| 6 | 演示参数核对（SQL） | `select jobname, schedule from cron.job` → 仅一条 `order-sweep` / `3 seconds`；`select ready_delay_seconds, urge_lead_seconds, auto_complete_seconds from stores` → 15 / 3 / 30 | 通过 |

> 2026-10-04 由演示者在微信开发者工具按上表执行（含 #3 的重启复验），6 项全部通过；Story 4.4 验收关闭。

> 4.8 预演时，本表 #1 / #2 / #4 并入验证矩阵 #1（演示主路径：催单时效边界）与 #9（界面无回归：催单两态 / 连点单次调用）；#5 并入 #11（业务拒绝可区分）；#3 / #6 属专项抽查（运行期标记 / 演示参数核对）。

### 有意偏差与遗留

1. **「已催单」只记运行期内存**（裁定 ②）：不落存储、不落库；重启或换设备后同一制作中订单可再次催单（服务端幂等、无副作用）。Phase 4 重做催单（15 分钟未出餐才可催、后台提示）时由服务端状态承接，届时客户端标记可退休。
2. **无 loading**（裁定 ①）：在飞期间连点无视觉反馈，极端慢网下按钮短暂「无反应」，失败有类别 toast；换取的是成功后的持久「已催单」状态表达，并与「重复点击只提示」的交互自洽。
3. **操作后补读未做**（裁定 ③）：催单不改状态，可见性由轮询保证；`use-order-status` 的操作后刷新入口留给 Story 4.5（确认取杯的「立即更新」）。
4. **门店行参数无代码改动**：默认值即 15/3/30；本 Story 只固化 cron 3 秒。演示前如需调整推进时长，按 addendum §F 的 `UPDATE` 方式，并记录还原方式。
5. **手动清单 6 项已执行并全部通过（2026-10-04）**：真实链路（催单两态 / 连点单次调用 / 跨页面共享 / 待取餐无入口 / 失败可重试 / cron 参数核对）由演示者在开发者工具按上表执行，结果列已补——本项关闭。

## Story 4.5 确认取餐与自动完成

- 日期：2026-10-04
- 环境：mp 侧 `pnpm test`（vitest 3.2.7）、`pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm build:mp-weixin`；supabase 侧 `supabase db reset`（重放全部迁移 + 种子）、`supabase test db`（19 文件 / 632 项）、`deno task verify:complete`（16 项断言）
- 范围：客户端确认取餐真实调用（`complete_order` RPC）+ 操作后立即读取（`runAutoRead`，auto 语义）+ 按钮 loading / 禁用 + 文案统一（「确认取餐」/「取餐成功」）+ 文档回写；**未含**：错误提示全量收口（4.6）、订单图片（4.7）、订阅（Epic 5）
- 裁定记录（Ly，2026-10-04）：① 动作逻辑落在根 composable `use-confirm-pickup.ts`（与 `use-urge` 同模式：动作唯一实现、列表与详情共享在飞状态；页内占位删除）；② 操作后读取新增 `runAutoRead()`——**auto 语义**（列表合并、保分页游标、失败静默由轮询自愈）+ 重置轮询计时，不按「显式刷新」整表替换（AD-7；4.3 遗留「接入时确认口径」的收敛）；③ 按钮 loading 从点击保持到**操作后读取完成**（状态更新前不闪回「确认取餐」）；④ 界面文案统一「确认取餐」、成功提示「取餐成功」——只统一用户可见文案，功能名与后端函数名（`complete_order`）保持「确认取杯」；⑤ 点击瞬间恰有轮询在飞时操作后读取合并跳过，最坏一个轮询周期（5s）自愈，不额外加「在飞补跑」。
- 后端背景：`complete_order` / `complete_due_orders`（含读时自动完成）在 Phase 2 已交付，cron 扫描周期 3s 已在 Story 4.4 固化；本 Story **零后端改动**，只重跑基线取证。

### 交付物

| 类别 | 内容 |
| --- | --- |
| 新增（客户端） | `src/composables/use-confirm-pickup.ts`：模块级在飞记录（按订单 id、跨页共享）+ `isConfirming` + `confirmPickup(orderId, refreshAfterAction?)`——成功 toast「取餐成功」→ 操作后读取 → 清 loading；失败类别 toast（唯一翻译）、不刷新、可重试 |
| 修改（客户端） | `src/api/orders.ts`：新增 `completeOrder(orderId)` → `POST /rest/v1/rpc/complete_order`（体只有 `p_order_id`、`session-required`）；头注释补确认取餐职责 |
| 修改（客户端） | `src/composables/use-order-status.ts`：新增 `runAutoRead()`——操作触发立即读取，同 auto 语义（合并 / 静默）+ 重置轮询计时 |
| 修改（客户端） | `src/pages/home/composables/use-orders.ts`：删除占位 `confirmPickup`；新增并暴露 `refreshAfterAction`（= `status.runAutoRead()`） |
| 修改（客户端） | `src/sub-order-detail/composables/use-order-detail.ts`：同上（占位删除 + `refreshAfterAction`） |
| 修改（客户端） | `src/pages/home/components/order-card/index.vue`：新增 `confirming` prop；待取餐按钮 loading（`t-loading`）+ 禁用 + 在飞忽略点击；按钮文案「确认取杯」→「确认取餐」 |
| 修改（客户端） | `src/pages/home/index.vue`：接入 `useConfirmPickup`（`:confirming`、`@confirm-pickup="confirmPickup(order.id, refreshAfterAction)"`） |
| 修改（客户端） | `src/sub-order-detail/order-detail/index.vue`：同上接入（按钮 loading / 禁用） |
| 新增（测试） | `src/composables/use-confirm-pickup.test.ts`（5 项） |
| 修改（测试） | `src/api/orders.test.ts` +2（completeOrder 请求形状）；`src/composables/use-order-status.test.ts` +2（runAutoRead）；`src/pages/home/composables/use-orders.test.ts` +2（refreshAfterAction）；`src/sub-order-detail/composables/use-order-detail.test.ts` +2（refreshAfterAction） |
| 修改（文档） | `ARCHITECTURE-SPINE.md`（AD-8 操作后立即读取 + 形态表 + 修订记录）、`epics.md`（Story 4.5 验收口径 + AR-P3-20 引用）、`docs/phase-1/prd.md`（FR-12 按钮文案统一）、本验收记录 |
| 未改动 | 后端全部（迁移 / 函数 / 类型 / 脚本）；`types/api-contracts.ts`；`utils/error-copy.ts`（订单域类别与文案已齐备） |

### 关键实现点

1. **服务端零改动、职责边界清晰**：确认取餐写路径仍是 `complete_order`（唯一状态写入经 `transition_order`）；自动完成由服务端承担（cron 3s + 读时即时完成），客户端只感知。本 Story 不新增第二套时间判定。
2. **动作唯一实现（根 composable）**：列表与详情共用 `useConfirmPickup`；「在飞」记录按订单 id 模块级共享、运行期内存、不落存储；服务端幂等为纵深防御（重复确认返回成功且不改完成时间）。
3. **操作后立即读取 = auto 语义**：`runAutoRead()` 复用 `startRead('auto')`——列表合并（保游标、保已翻页）、失败静默、重置轮询计时；不整表替换（AD-7 只允许首屏 / 显式刷新 / 分页重置）。
4. **loading 覆盖到状态更新**：`confirmPickup` 在 `refreshAfterAction` 完成后才清 loading，按钮不会在成功与状态更新之间闪回「确认取餐」；读取失败静默、由轮询自愈（不叠加第二条错误提示）。
5. **失败不脏状态**：确认失败只 toast 类别文案，不刷新、不改本地展示状态；按钮恢复可点、可重试（`invalid_status` / `order_not_found` / 网络类均可区分）。
6. **文案统一**：界面按钮与提示统一「确认取餐」/「取餐成功」；功能名与后端函数名保持「确认取杯」/ `complete_order`（迁移与测试注释作为历史记录不改）。
7. **已知边界**：列表分页第二页的订单确认后，操作后读取只覆盖第一页（4.3 已知「轮询只读第一页」的延伸，演示主路径活跃单恒在第一页）；点击瞬间恰有轮询在飞时合并跳过，最坏一个轮询周期（5s）自愈。

### 验收点与证据

| Story 4.5 验收点 | 证据 |
| --- | --- |
| 点确认取餐 → 立即进入「已完成」+ toast「取餐成功」+ 状态即时更新 | `use-confirm-pickup.test.ts`：成功用例断言「调一次 API → toast → 操作后读取」；`use-orders.test.ts` / `use-order-detail.test.ts` 的 `refreshAfterAction` 用例断言读取后该单变 `completed`（合并、保游标）；真实链路属手动 #1 / #2 |
| 按钮 loading + 禁用防重复（连点只发一条） | `use-confirm-pickup.test.ts`「在飞期间连点」：同一订单只调一次 API、loading 保持到读取完成；`order-card` 的 `confirming` prop + 在飞忽略点击；构建产物两者均为 `t-loading` 组件声明；手动 #1 |
| 重复确认幂等（不报错、不改完成时间） | 服务端基线：`supabase test db`（`93_complete.test.sql` 覆盖重复确认与并发）+ `deno task verify:complete`「并发两次确认取杯都成功」「重复确认返回成功（目标状态已达成）」「重复确认不修改完成时间」「确认一张已由超时自动完成的订单：返回成功」 |
| 确认失败不改变本地展示的状态，并给出类别提示 | `use-confirm-pickup.test.ts` 失败用例：类别文案 toast（`invalid_status` →「当前状态不支持该操作，请刷新后重试」）、不刷新、可重试；手动 #3 / #5 |
| 「待取餐」后不操作 → 服务端自动完成，页面 ≤ 一个轮询周期感知；已完成单归组、详情可再次打开 | 服务端基线：`verify:complete`「自动完成发生在落库时刻 + 一个扫描周期内（1.0 秒）」「时刻是数据、不是派生值」；客户端感知由 4.3 的 5s 轮询与读时自动完成承担（本 Story 零新增代码）；手动 #4 |
| 自动完成感知与手动确认共用状态应用路径（单调、不倒退） | 手动确认后的读取与轮询同走 `useOrderStatus` + `utils/order-status.ts` 序号门 / 单调（4.3 既有 11 + 12 项单测）；`refreshAfterAction` 用例断言 completed 后停轮询 |
| 类型契约与编译期保护不回归；既有行为不回归 | `types/api-contracts.ts` 未改动、`pnpm type-check` 0 错误；`pnpm test` 179 项全过（原 166 + 新增 13）；`pnpm build:mp-weixin` Build complete |

### 验证命令与输出（可复现）

```bash
cd mp
pnpm test             # 16 文件 / 179 项全过（新增 13）
pnpm type-check       # 0 错误
pnpm lint             # 0 错误
pnpm build:mp-weixin  # Build complete.

cd ../supabase
supabase db reset          # 重放全部迁移（含 cron 3s）+ 种子
supabase test db           # 19 文件 / 632 项全过（Result: PASS）
deno task verify:complete  # PASS：16 项断言全部通过

# 文案与接线证据
grep -rn "确认取杯\|取杯成功" src/ | grep -v test    # 仅 api-contracts.ts 的能力描述注释（功能名）
grep -rn "确认取杯" dist/build/mp-weixin/ | wc -l    # 0
ls dist/build/mp-weixin/composables/use-confirm-pickup.js
```

```text
✓ src/composables/use-confirm-pickup.test.ts (5 tests)   # 成功顺序 / 连点单次 / 失败可重试 / 读取失败静默 / 跨订单独立
✓ src/api/orders.test.ts (16 tests)                      # + completeOrder 2
✓ src/composables/use-order-status.test.ts (12 tests)    # + runAutoRead 2
✓ src/pages/home/composables/use-orders.test.ts (18)     # + refreshAfterAction 2
✓ src/sub-order-detail/composables/use-order-detail.test.ts (15)  # + refreshAfterAction 2
✓ 其余 11 文件 113 项不回归

Test Files  16 passed (16)
     Tests  179 passed (179)
```

```text
PASS：16 项断言全部通过（订单 202610041852217559 并发确认后完成；订单 202610041852210401 在无人操作下按落库时刻自动完成，取杯号 A-0003）
  ✓ 并发两次确认取杯都成功（一个真的完成、另一个按「目标状态已达成」返回）
  ✓ 重复确认不修改完成时间（仍是最早写入的那一次）
  ✓ 自动完成发生在落库时刻之后：配置改成 600 秒后仍按 5 秒的落库时刻完成（时刻是数据、不是派生值）
  ✓ 确认一张已由超时自动完成的订单：返回成功
  ✓ 自动完成的订单：确认不改写完成时间
```

构建产物抽查（`dist/build/mp-weixin`）：`composables/use-confirm-pickup.js` 已产出；`api/orders.js` 含 `complete_order`；`composables/use-order-status.js` 含 `runAutoRead`；`pages/home/index.js` 含 `confirming` 绑定；`order-card/index.js`、`sub-order-detail/order-detail/index.wxml` 含「确认取餐」且全仓构建产物无「确认取杯」；两处 `index.json` 均声明 `t-loading`。

### 手动验证清单（演示者执行）

前置：本地栈在跑、已 `supabase db reset`（cron 3 秒）、`mp/.env.local` 指向本地栈、开发者工具已勾选「不校验合法域名」；建议先「清缓存并重启」；准备「待取餐」订单（下单后等 15 秒推进或点催单）。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | 列表点「确认取餐」并连点几次 | 按钮出现 loading、全程只发 1 条 `complete_order`（网络面板确认）；toast「取餐成功」；卡片变「已完成」/ 按钮变「再来一单」 | 通过 |
| 2 | 另起一张单，在详情页点「确认取餐」 | 按钮 loading、toast「取餐成功」；状态卡变「已完成」并显示取餐码；完成后网络面板不再有 `get_my_order_detail`（停轮询） | 通过 |
| 3 | 停后端（`supabase stop`）→ 点确认 → 起后端 → 重试 | 失败：类别文案 toast（如「网络不可用，请检查网络后重试」）、状态仍「待取餐」、按钮恢复可点；恢复后重试成功 | 通过 |
| 4 | 下单后不操作，等进入「待取餐」后约 30 秒（详情保持可见） | 页面 ≤6 秒内自动变「已完成」（自动完成）；已完成单可再次打开详情 | 通过 |
| 5 | （可选）SQL 把一张「待取餐」单改回 `cooking`（清 `auto_complete_at` / `completed_at`、推后 `ready_at`），再点确认 | `invalid_status` 文案 toast「当前状态不支持该操作，请刷新后重试」；状态不变；轮询拉到最新状态后可再操作 | 跳过（可选） |
| 6 | 确认成功后立刻杀进程重启（或换页面清缓存重进） | 订单为「已完成」（服务端事实）；列表 / 详情正确展示，不产生第二条完成记录 | 通过 |

> 2026-10-04 由演示者在微信开发者工具按上表执行；1~4、6 项全部通过；#5 为可选构造项，未执行（原因与可用的构造 SQL 见下）；Story 4.5 验收关闭。

> **#5 构造说明（可选，2026-10-04 记录）**：在 Supabase Studio 直接 `update public.orders set status = 'cooking'` 会触发 `orders_check1`（`已完成 ⇔ 有完成时刻`）与 `orders_auto_complete_check`（`非制作中 ⇔ 有自动完成时刻`）——改状态必须连带清空两个时刻列，否则约束拒绝。可用的构造 SQL（与 Story 4.3 手动 #6 同口径）：
>
> ```sql
> -- 0) 先挑一张「待取餐」单并记下原状态
> select id, order_number, status, pickup_code, ready_at, auto_complete_at from public.orders order by created_at desc limit 5;
>
> -- 1) 改回「制作中」：清两个时刻列 + 推后 ready_at（防止服务端读时推进立刻纠正回「待取餐」）
> update public.orders
> set status = 'cooking',
>     completed_at = null,
>     auto_complete_at = null,
>     ready_at = now() + interval '1 hour'
> where id = '<订单 id>';
>
> -- 2) 验证后还原为「待取餐」（接近其原本的自动完成时刻）
> update public.orders
> set status = 'pickup',
>     completed_at = null,
>     auto_complete_at = now() + interval '30 seconds'
> where id = '<订单 id>';
> ```
>
> 本项为可选边界（UI 正常路径不会出现「制作中却可点确认」）；`invalid_status` 的文案分支已由 `use-confirm-pickup.test.ts` 确定性覆盖（toast「当前状态不支持该操作，请刷新后重试」），跳过不影响验收。

> 4.8 预演时，本表 #1 / #2 / #4 并入验证矩阵 #1（演示主路径：确认取餐 / 自动完成感知）与 #9（界面无回归：确认取餐 loading / 文案）；#3 并入 #11（失败类别可区分）；#6 属专项抽查（杀进程后状态一致性）；#5 未执行（可选构造项）。

### 有意偏差与遗留

1. **操作后读取的已知边界**（裁定 ⑤）：分页第二页的老单确认后，操作后读取只覆盖第一页（4.3「轮询只读第一页」的延伸）；点击瞬间恰有轮询在飞时合并跳过、最坏一个轮询周期（5s）自愈。演示主路径活跃单恒在第一页，不额外加「在飞补跑」。
2. **详情按钮文案本来就已是「确认取餐」**：本 Story 只改列表卡「确认取杯」→「确认取餐」，统一结果两处一致；「取杯号」「取餐码」为业务名词，不在改名范围。
3. **loading 视觉为最小实现**：列表卡与详情按钮内联 `t-loading`（28 / 32rpx、inherit-color）；Story 4.7 重排卡片与三态详情页重新设计时统一皮肤，行为（loading + 禁用 + 在飞忽略）不变。
4. **手动清单已执行（2026-10-04）**：1~4、6 项通过；#5 为可选构造项、跳过（Studio 直接改 `status` 触发 `orders_check1` / `orders_auto_complete_check`，可用的连带清空 SQL 已记入清单下方说明，时刻列约束与 Story 4.3 手动 #6 同口径）。真实链路（确认取餐两入口 / 连点单次调用 / 失败恢复 / 自动完成感知 / 杀进程一致性）由演示者在开发者工具复验——本项关闭，Story 4.5 验收关闭。

## Story 4.6 错误提示收口与失败不脏状态

- 日期：2026-10-04
- 环境：mp 侧 `pnpm test`（vitest 3.2.7）、`pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm build:mp-weixin`；**后端零改动**（`order_error_code.unknown` 与错误类别契约在 Story 1.2 已就位；迁移 / 函数 / 类型 / 脚本均未动）
- 范围：全量失败路径收口——统一兜底 `errorCopyOr`（7 个消费文件 10 处调用收敛 + 修掉「再来一单 / 支付」非 AppError 静默两个缺口）、枚举外类别的开发期记录（normalize `[transport]` 日志）、审计证据（敏感信息 / 无特判后门 / 单一数据源）、失败专项手动验证；**未含**：订阅建立 / 回退与「订阅失败静默」的运行时验收（Epic 5）、订单图片（4.7）、4.8 预演矩阵
- 裁定记录（Ly，2026-10-04）：① 非 AppError 兜底统一为 `utils/error-copy.ts` 的 `errorCopyOr`（AppError 走唯一翻译、`request_cancelled` 保持空串、非 AppError 用场景兜底），7 个消费文件 10 处调用收敛；②「新增失败类别先在客户端侧记录」落地为 normalize 的开发期日志（仅 RPC / pay-order / wechat-login 的枚举外类别分支，只记来源 / 类别 / 状态码）；③ 目录 5xx 沿用订单域 `unknown` 文案（REST 无独立域，关闭 1.2 / 2.2 遗留）；④「已有数据时刷新失败」口径确认为最终（保留数据 + 手动 toast / 自动静默，关闭 4.1 遗留 3）；⑤ 订阅静默由 Epic 5 承接；⑥ 手动验证只做失败专项 2 个场景（登录失败与重试、订单页失败不伪装 + 只提示一次），业务拒绝 4 类与操作不脏状态引用 3.6 / 4.4 / 4.5 证据；⑦ 不为 `use-order-confirm` 新建测试文件（Pinia 成本），其改动仅是接到已单测的 helper

### 交付物

| 类别 | 内容 |
| --- | --- |
| 新增（客户端） | `src/utils/error-copy.ts`：`errorCopyOr(error, fallback)`——AppError 走 `errorCopy()`（`request_cancelled` 仍为空串 = 不提示）、非 AppError 用场景兜底；注释写明「操作提示空串跳过、页面态空串再兜」使用规则 |
| 修改（客户端） | `src/core/transport/normalize.ts`：RPC / pay-order / wechat-login 的枚举外类别分支新增 `warnUnmappedCategory()`（`console.warn('[transport] unmapped category', { route, code, status })`，不含响应体 / message）；REST 通用失败与平台 auth 不记录（避免噪音） |
| 修改（客户端） | `src/pages/home/composables/use-orders.ts`：失败文案改经 `errorCopyOr`；页面态（无数据）空串兜底、手动刷新 toast 空串跳过 |
| 修改（客户端） | `src/pages/home/composables/use-products.ts`：目录失败态改经 `errorCopyOr` |
| 修改（客户端） | `src/sub-order-detail/composables/use-order-detail.ts`：详情失败态 / 手动 toast 同口径；空 id 本地守卫仍用 `errorCopy` 直取 `order_not_found` |
| 修改（客户端） | `src/sub-order-confirm/composables/use-order-confirm.ts`：门店卡失败态改经 `errorCopyOr`；支付失败 toast 改经 `errorCopyOr`（新增 `PAY_FAILURE_FALLBACK`，修静默） |
| 修改（客户端） | `src/composables/use-urge.ts`：失败 toast 改经 `errorCopyOr`（`URGE_FAILURE_COPY`） |
| 修改（客户端） | `src/composables/use-confirm-pickup.ts`：失败 toast 改经 `errorCopyOr`（`COMPLETE_FAILURE_COPY`） |
| 修改（客户端） | `src/composables/use-reorder.ts`：失败 toast 改经 `errorCopyOr`（`REORDER_FAILURE_COPY`，修静默） |
| 修改（测试） | `src/utils/error-copy.test.ts` +4（helper：AppError / 未知类别 / cancelled / 非 AppError）；`src/core/transport/normalize.test.ts` +2（三个分支各记一次；已知类别 / 42501 / REST / 平台 auth 不记；既有「未知类别」用例统一静音）；`src/composables/use-reorder.test.ts` +1（非 AppError 兜底） |
| 未改动 | 后端全部（迁移 / 函数 / 类型 / 脚本）；`types/`；页面模板；`error-copy.ts` 既有文案表；`api/` 全部 |

### 关键实现点

1. **统一兜底语义**（`errorCopyOr`）：非 AppError（程序缺陷）→ 场景兜底文案，不再静默；AppError → 一律 `errorCopy()`；`request_cancelled`（唯一空串）在操作提示处跳过、页面态渲染处再兜一次——「不产生提示」与「不空白 / 不伪装空列表」两个 AC 同时成立。
2. **两个静默缺口修复**：`use-reorder` 与支付 `startPay` 原来对非 AppError 完全无反馈；现在都经 `errorCopyOr` 给出场景兜底（「操作失败，请重试」），界面停留可重试；购物车与幂等键不受影响（非 AppError 按「结果不明」保留键）。
3. **操作提示 vs 页面态分流**：`use-orders` / `use-order-detail` 同一 catch 内分流——无数据 → `messageOf`（必非空）写失败态；有数据 + 手动刷新 → `errorCopyOr` 空串跳过 toast；自动轮询失败仍静默（Story 4.3 口径不变）。
4. **枚举外类别记录范围**：只在「服务端发了枚举外类别」时打日志；`rest` 通用失败（无独立域属常态）与 `platform-auth`（错误码由平台定义）不打，避免刷屏；日志只含 route / code / status，不含响应体、message、凭据或 OpenID。
5. **订阅静默承接**：Epic 5 未启用订阅，本 Story 不产生订阅相关用户可见失败；运行时验收由 Epic 5 的 Story 5.3 / 5.4 完成，不阻塞本 Story。
6. **文案与敏感信息审计**：全仓 `showToast` 的 title 均为文案常量或 `errorCopy` / `errorCopyOr` 产物；`error-copy.test.ts` 对全部类别断言不含 `PGRST` / `postgres` / `openid` / `Bearer` / `apikey` / stack 等标记。

### 验收点与证据

| Story 4.6 验收点 | 证据 |
| --- | --- |
| 全部错误类别（登录 / 订单 / 客户端）→ 文案由 `utils/error-copy.ts` 唯一函数产出（同时消费服务端与客户端两类）；域内穷尽、新增类别编译报错；未知类别以 `unknown` 兜底、不白屏 | `error-copy.ts` 唯一翻译 + `errorCopyOr` 统一入口；域表 `Record<联合, string>` 穷尽 + `error-codes.ts` 与生成枚举双向编译检查（Story 1.2 既有，本 Story 未动）；`error-copy.test.ts` 12 项（含 helper 4 项）；未知类别落 `unknown` 与页面态空串兜底由 `use-orders.test.ts` / `use-order-detail.test.ts` 既有失败用例回归 |
| 页面级加载失败（目录 / 订单列表 / 订单详情）→ 页面内失败态：文案 + 「重试」；操作级失败（下单 / 催单 / 确认取餐）→ toast（`icon: 'none'`）+ 界面停留可重试 | 目录：Story 2.2；列表 / 详情：Story 4.1 / 4.2；操作：Story 3.6 / 4.4 / 4.5 + 本 Story 的 toast 收敛（`use-urge.test.ts` / `use-confirm-pickup.test.ts` 既有失败用例回归）；`grep showToast`：全部 `icon: 'none'`，无原始异常透传 |
| 订单页加载失败不展示任何订单数据（含本地缓存）、不以空列表伪装；空态显示引导且停止轮询（订阅接入后同受同一启停控制，见 Epic 5） | Story 4.1 / 4.3 既有证据（失败态仅在无数据时进入、空态判定条件、`shouldPoll` 空态返回 false）；本 Story 未改状态机，仅改文案入口 |
| 订阅失败对用户静默、不产生数据库类别；其它新增失败类别先在客户端侧记录（`unknown` 为加法型入库类别） | normalize 三个枚举外类别分支 `[transport]` 日志（`normalize.test.ts` 新增 2 项断言）；订阅部分由 Epic 5 承接（关键实现点 5）；`unknown` 入库在 Story 1.2 已完成 |
| 登录失败不产生半登录；建单失败不丢购物车、不产生重复订单；催单 / 确认取杯失败不改变本地展示状态；任一步失败后用户都能找到明确的下一步（重试 / 返回） | 登录：Story 1.3（状态机单测 16 项 + 手动 11 步）+ 本 Story 手动 #1 / #2；建单：Story 3.6（手动 #1~#10）与 3.4（幂等键单测 16 项）；催单 / 确认：Story 4.4 / 4.5 手动与单测；本 Story 手动 #3 / #4 / #5 复验失败入口与下一步 |
| 提示不含内部堆栈、数据库细节、密钥或 OpenID；演示路径不依赖任何「特判后门」或假数据兜底 | `error-copy.test.ts` 敏感信息断言；审计命令（见下）——无 mock 引用 / 无 `uni.request` / 存储出口收敛 / `import.meta.env` 仅配置读取；`fetchOrderById` 无桩、无假数据兜底（Story 4.2 已收口） |
| 类型契约与编译期保护不回归；既有行为不回归 | `pnpm test` 186 项全过（原 179 + 新增 7）；`pnpm type-check` 0 错误；`pnpm lint` 0 错误；`pnpm build:mp-weixin` Build complete |

### 验证命令与输出（可复现）

```bash
cd mp
pnpm test             # 16 文件 / 186 项全过（原 179 + 新增 7）
pnpm type-check       # 0 错误
pnpm lint             # 0 错误
pnpm build:mp-weixin  # Build complete.

# 收口证据
grep -rn "errorCopyOr" src/ | grep -v test | grep -v "utils/error-copy"  # 10 处调用 / 7 个文件
grep -rn "\[transport\]" src/core/transport/normalize.ts               # 唯一日志点
grep -rn "src/mock\|mock/orders\|initOrders\|mockOrders" src/          # 仅 api/orders.ts 历史说明注释
grep -rn "uni\.request(" src/                                          # 0（请求全经 alova 通道）
grep -rn "import\.meta\.env" src/                                      # 仅 core/transport/config.ts
grep -rln "setStorageSync\|getStorageSync\|removeStorageSync" src/ | grep -v test
# → core/session/storage.ts / api/cart.ts / api/orders.ts / api/storage.ts（四个允许出口；checkout-intent.ts 仅注释命中）
grep -rn "showToast" src/ | grep -v test                               # title 均为文案常量或 errorCopy 产物
```

构建产物抽查（`dist/build/mp-weixin`）：`utils/error-copy.js` 含 `errorCopyOr`；`core/transport/normalize.js` 含 `[transport] unmapped category`；`composables/use-reorder.js` 与 `sub-order-confirm/composables/use-order-confirm.js` 含「操作失败，请重试」。

```text
✓ src/utils/error-copy.test.ts (12 tests)            # +4：helper 语义
✓ src/core/transport/normalize.test.ts (20 tests)    # +2：枚举外类别记录 / 不记录
✓ src/composables/use-reorder.test.ts (7 tests)      # +1：非 AppError 兜底
✓ 其余 13 文件 147 项不回归

Test Files  16 passed (16)
     Tests  186 passed (186)
```

### 手动验证清单（演示者执行）

前置：本地栈在跑（`supabase start`）、边缘函数已启动（`supabase functions serve`）、`mp/.env.local` 指向本地栈、开发者工具已勾选「不校验合法域名」；建议先「清缓存并重启」。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | 登录失败（矩阵 #2）：备份 `supabase/functions/.env` 并把 `WECHAT_APP_SECRET` 改成无效值 → 重启 `supabase functions serve` → 清缓存重启小程序 → 进订单 tab | 目录照常可浏览、无全局提示（启动预热失败静默）；订单 tab 失败态「登录状态已失效，请重试」+「重试」；不展示任何订单数据 | 通过 |
| 2 | 停在第 1 步的失败态点「重试」 | 重试只触发一次登录尝试（无并发 / 无请求堆积），仍失败后回到失败态；`wechat_identities` 行数前后一致（无孤儿身份） | 通过 |
| 3 | 恢复 `.env` 并重启 serve → 点「重试」；杀进程重启后再进订单 tab | 本人订单列表恢复（同一身份、订单不变） | 通过 |
| 4 | 订单页失败不伪装 + 只提示一次：订单 tab 已有数据 → `supabase stop` → 下拉刷新 | 数据保留、只 1 条「网络不可用，请检查网络后重试」toast、不刷屏；轮询失败静默、连续 3 次后停止（网络面板不再有请求） | 通过 |
| 5 | 清缓存并重启（后端仍停）→ 进订单 tab → 观察后 `supabase start` → 点「重试」 | 失败态（文案 + 「重试」），不是骨架、不是空态、不展示任何订单数据；恢复后列表回来 | 通过 |

> #1 的「改坏 AppSecret」沿用 Story 3.6 手动 #5 的现场制造手法；`.env` 已 gitignore，验证后务必还原并重启 serve。#1 / #5 的登录类文案按 AD-7 统一为 `client.session_expired`（不暴露登录域内部类别）。

> 2026-10-04 由演示者在微信开发者工具按上表执行，5 项全部通过（含登录失败现场制造与还原、`wechat_identities` 无孤儿身份核对）；Story 4.6 验收关闭。

> 4.8 预演时，本表 #1 / #2 / #4 并入验证矩阵 #2（登录失败与重试）与 #11（失败可区分）；#3 / #5 属失败恢复复验。

### 有意偏差与遗留

1. **目录 5xx 文案确认**（裁定 ③）：REST 无独立错误域，目录加载 5xx 显示订单域 `unknown` → 「操作失败，请稍后重试」；关闭 Story 1.2 / 2.2 遗留，不再评估场景替换。
2. **「已有数据时刷新失败」口径确认**（裁定 ④）：保留数据 + 仅手动刷新 toast / 自动静默；关闭 Story 4.1 遗留 3。
3. **`request_cancelled` 属防御分支**：全仓无取消入口、适配器不产生 abort；「操作提示跳过、页面态兜底」的规则已在 `errorCopyOr` 注释与单测中固化，未来引入取消入口时直接消费。
4. **`use-order-confirm` 无独立单测**（裁定 ⑦）：门店 / 支付失败分支的改动是接到已单测的 `errorCopyOr` 上；真实链路由手动行覆盖，后续如需再补测试文件（Pinia 搭建成本）。
5. **订阅失败静默的运行时验收在 Epic 5**（裁定 ⑤）：本 Story 只保证不产生订阅相关失败路径与类别；Epic 5 落地后由矩阵 #5 / #6 / #12 补充证据。
6. **手动清单已执行并全部通过（2026-10-04）**：5 行（登录失败与重试、无孤儿身份、失败不伪装、只提示一次、恢复回归）由演示者在开发者工具复验，结果列已补——本项关闭，Story 4.6 验收关闭。

