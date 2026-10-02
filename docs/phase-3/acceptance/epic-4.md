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
