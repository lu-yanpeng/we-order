---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - docs/phase-3/prd.md
  - docs/phase-3/addendum.md
  - docs/phase-3/ARCHITECTURE-SPINE.md
  - docs/phase-3/SPEC.md
---

# We-Order 点餐小程序 · Phase 3（前后端对接）— Epic 分解

## Overview

本文档把 We-Order Phase 3 的需求（PRD 的 FR-P3-1 ~ FR-P3-19、跨切面 NFR 与旅程 UJ-P3-1 / UJ-P3-2；架构 spine 的 AD-1 ~ AD-17、继承不变量、最小 UI 规范、Stack、Structural Seed 与验证矩阵模板）分解为可实施的 Epic 与 Story。

Phase 3 的产品形态：**界面结构与交互零变化**（仅兑现「最小 UI 规范」这一界面增量），改动集中在客户端数据层——重建 `api/`、新增 `core/` 基础设施层，把 Mock 驱动整体切换为 Phase 2 真实后端，并落地支付接口、幂等键、轮询刷新与回退订阅，全程零结构性返工。

输入文档说明：UX 设计契约**不存在**，理由见下方「UX Design Requirements」一节。Phase 1 的 PRD 与架构 spine（界面与前端行为基准）、Phase 2 的 PRD 与架构 spine（后端契约与不变量）按其约定不在本次输入清单内，仅在需要追溯时引用。

## Requirements Inventory

### Functional Requirements

FR-P3-1 统一请求对接层：客户端所有后端访问（REST / RPC / 支付接口）都经由单一对接层完成，页面或 Composable 不允许直接发起网络请求；每个请求自动携带平台公开密钥（`apikey`）与按需携带当前会话访问凭证，服务端密钥绝不出现在客户端；请求参数与返回形状（含可空性）与生成类型一致，调用方拿到类型化结果而不是 `any`；失败统一归一为「服务端错误类别 + 客户端错误类别」，由对接层产出、不在调用点重复判断；对接层不持有业务状态或会话状态；不引入 Supabase 官方 SDK 与社区适配库，允许通用 HTTP 库（选型留架构阶段），底层为 `uni.request`。

FR-P3-2 类型契约对齐与编译期保护：生成类型重新生成不需要手工修改，客户端引用同一份生成物、不复制不手改，跨子项目同步方式给出可复现步骤；Phase 1 手工定义在 `types/` 的类型退休（替换为生成类型或其窄别名），快照类 JSON 字段的手工覆盖类型单独保留并标注出处；服务端返回值字段可空性与实际一致，不出现「类型说有、实际没有」的崩溃；对接期只允许加法型改动，不允许要求后端迁就手工类型、不允许结构性返工。

FR-P3-3 存量清理与单一数据源：本地存储中的 Mock 订单数据与存量本地购物车被清空（无迁移价值），界面不再可能读到任何 Mock 内容；本地数据库数据可整体清空并由迁移 + seed 重建；旧 `api/` 代码删除（不保留死代码），职责由重建的对接层承接、会话职责另行安置；Phase 2 最小验证入口移除；不存在任何「Mock 与真实数据并存」的开关或回退路径。

FR-P3-4 启动静默登录：小程序启动时静默完成登录（一次性凭证 → 服务端换取 OpenID → 建立会话），用户无感；裁定「启动即静默登录」（架构阶段显式修订 P2 AD-14 惰性条款）；不出现登录界面、不索取用户资料、不依赖用户点击；已有有效会话直接复用、不重复登录；登录失败按错误类别给出可区分提示并可重试（并发登录产生的可重试 `session_failed` 属自动重试类别），重试不留下半登录状态（不产生孤儿用户、不残留不可用会话）；失败提示与重试入口位置明确、启动不阻塞页面；未登录不阻塞目录浏览（目录公开只读）。

FR-P3-5 会话持久化与自动续期：应用重启后会话可恢复，不需要用户再次操作；职责接缝：会话模块持有会话状态并提供取凭证 / 续期能力，对接层只持有「请求前取凭证、401 时调用续期并重放一次」的拦截逻辑、不持有会话状态；访问凭证过期时自动续期并重试原请求，调用方无感、不出现「同一操作先失败再成功」的可见抖动；续期单飞（同一时刻只允许一个续期在飞，其余请求等待并复用同一结果）；续期失败可回退到重新静默登录且不产生第二个身份，续期请求发出后应用被杀导致新凭证丢失时同样回退重登；重登有退避与尝试上限，不出现反复掉线或循环重试。

FR-P3-6 会话状态归属修正：会话与续期状态不再居住在 `api/` 对接层内，恢复 P1 AD-1（API 层不持有运行时状态），关闭 Phase 2 记录的有期限偏离；对接层可被独立替换而不需要携带会话上下文（以「注入伪会话的手动验证记录」为证据）；会话状态的承载位置有唯一出处、不通过导入 `api/` 的方式访问、不进 Pinia、本地存储 key 沿用 `weorder_session`（承载形态由架构阶段决定）；上层（页面 / Composable）不出现 token 一词，请求头构造只在对接层与会话模块内，不向上层暴露未登录状态。

FR-P3-7 目录读取切到真实数据：分类、商品、规格与门店信息从后端读取，可售状态由后端返回（下架不返回、售罄保留并带状态）；双栏联动、规格定制、实时计价等交互行为与 Phase 1 一致；商品图片源从本地资源切换到对象存储，图片缺失或加载失败以默认占位（色块）呈现、不阻塞列表渲染、不出现与商品不符的图片（本阶段不做图片对象入仓与上传）；本阶段不做售罄 / 下架的差异化置灰交互（统一在支付被拒时以可行动文案呈现，差异化交互属 Phase 4）；目录读取未登录即可用；加载失败有明确失败态与重试入口，不白屏。

FR-P3-8 支付接口（支付 → 创建订单）：模拟支付完成后，客户端经服务端支付接口（边缘函数）一次完成「支付 → 创建订单」；客户端不具备绕过支付接口的订单创建路径（直呼既有创建路径被拒绝），支付接口是客户端创建订单的唯一入口；接口语义为创建成功才返回支付成功，客户端交互保持在一次操作内；支付接口必须要求有效会话（不关闭会话校验）；订单创建仍由既有服务端创建实现完成，不出现第二套金额计算、归属判定或写路径，归属仍取自会话身份，不得引入客户端可伪造的用户标识参数、不得以服务端密钥绕过归属判定、不得直接写订单表；支付环节为模拟实现，为未来真实微信支付预留单一替换接缝（不承诺客户端零改动）；客户端提交不含任何金额字段，结算页展示金额为本地计价（展示口径），订单金额以服务端重算为准；创建成功后获得订单号与取杯号（下单即分配）并可在订单列表看到该单，支付成功后的行为沿袭 Phase 1（清空购物车、重置备注与就餐方式、成功反馈并跳转订单列表，支付过程保留 loading）；下单成功清空本地购物车、下单失败保留购物车、可直接重试；本阶段不接真实支付渠道、不建立支付记录实体与支付状态机。

FR-P3-9 支付接口幂等与失败恢复：幂等键定义为一次结算意图——进入确认订单页时由客户端生成并持久化，购物车内容或就餐方式变化即作废重建，下单成功或明确失败后清除、超时不明则保留；键必填、与用户绑定、经对接层 / 支付接口原样转发；网络超时后的重试复用同一幂等键，服务端不因重试产生第二张订单，杀进程后重试仍不产生第二张订单；支付接口失败给出可区分的错误提示（网络 / 业务拒绝 / 鉴权失效；业务原因至少区分售罄、规格失效、商品不可售）并停留在可重试的界面状态；接口内部失败不产生「已显示支付成功但没有订单」的不可恢复状态；失败路径结束后购物车内容与失败前一致。

FR-P3-10 订单列表（三态）：订单列表从服务端读取，按制作中 / 待取餐 / 已完成分组展示；订单读取一律经服务端读取路径（读时推进），客户端不直接读表（REST 裸表仅作纵深防御）；三态分组与 Phase 1 一致，分页沿袭默认 20 条；读取失败（未登录 / 会话失效）先触发续期或重登，成功则继续展示本人订单、失败则显示失败态与重试入口，不展示任何订单数据（含本地缓存）、不以空列表伪装成功；归属不可伪造（客户端不传用户标识）；全新身份的空订单态有明确呈现（文案 + 引导去点餐），空态不做无意义轮询；进入页面与手动刷新均触发最新读取。

FR-P3-11 订单详情：订单详情展示服务端快照（商品、规格摘要、金额、门店信息、取杯号）；详情字段与生成类型一致，快照字段即使商品已改名 / 改价也不变；取杯号在制作中即展示（付款后即出号，属对 Phase 1 界面的有意增量）；「再来一单」沿用 Phase 1 行为（替换当前购物车、返回首页、自动展开面板），按服务端快照还原规格选择，购物车计价永远按当前目录价、快照价仅用于历史展示；快照中已下架或规格已失效的行被丢弃，并以 toast 简单提示「部分商品已失效」（不阻断其余条目），行为写入手动验证矩阵。

FR-P3-12 轮询刷新订单状态：在订单可见的页面上按固定间隔读取最新状态，使服务端推进（含催单与自动完成）及时可见；制作中 / 待取餐状态下推进时刻到点后页面在不超过一个轮询周期 + 1 秒内自动更新，不依赖用户手动刷新；页面隐藏 / 离开时停止轮询，回到前台立即刷新一次（`onHide` / `onShow` 语义）；轮询失败静默重试（默认 3 次）后降级为手动刷新入口，且不会造成请求堆积；状态应用单调——轮询与订阅共享同一条状态应用路径，结果带请求序号，只接受不早于本地状态的结果、旧响应不得覆盖新状态；轮询间隔取值必须满足可见性上界（数值由架构阶段定）。

FR-P3-13 催单：催单调用服务端把推进时刻提前（取原定时刻与「催单时刻 + 3 秒」的较早者），界面即时反馈；催单后在一个轮询周期 + 3 秒（催单演示参数）内可见状态推进；重复催单幂等（不会更早、不会延后、不报错）；非制作中状态的订单不出现催单入口，或催单被拒绝时提示明确；制作中窗口有限（演示参数 15 秒），演示时可用配置临时调长推进时长以保证催单可演。

FR-P3-14 确认取杯与自动完成：用户在待取餐状态可确认取杯，确认后订单立即进入已完成；不确认时由服务端在等待时长（演示参数约 30 秒）后自动完成，页面在一个轮询周期内感知；已完成订单在列表中归属「已完成」分组，详情可再次打开。

FR-P3-15 Realtime 订阅自适配（挑战项）：客户端基于 Supabase Realtime 公开协议、以 `uni.connectSocket` 提供传输层，订阅本人订单的状态变化；订阅仅在有有效会话时建立，会话续期后订阅所用凭证同步更新；断线自动重连并恢复订阅，采用退避策略与重试上限（不产生重连风暴），订阅断开到回退轮询生效的空窗不超过 2 个轮询周期；订阅收到的状态变化与轮询共享同一条状态应用路径（单调应用），订阅建立成功后的轮询策略（降频或停止）由架构定，但不得出现双倍刷新或旧结果回写；实现路线二选一并在架构阶段收敛（`@supabase/realtime-js` 仅用 transport 扩展点，或零 SDK 手写协议客户端），两者都不依赖已停更的社区适配库；本组不作为演示验收内容，轮询始终是可用保底。

FR-P3-16 订阅与轮询的切换与回退：订阅不可用时自动回退轮询，用户无感；不设统一开关（验证纯轮询行为时临时调整代码）；订阅不可用时全部刷新行为与 FR-P3-12 一致（功能完整）；订阅建立失败、被拒绝或中途断开时自动回退轮询（≤ 2 个轮询周期内恢复更新），页面行为不降级、不报错打扰用户；回退与恢复过程在开发期可观察，但不面向用户暴露。

FR-P3-17 Supabase 侧订阅配套：后端补上订阅所需的最小配置与验证，仅做加法型改动；发布配置（publication）启用，覆盖范围（表 / 列清单）在架构阶段列明、仅限订阅所需最小集合；数据访问策略与订阅兼容的验证：两个身份客户端，A 订阅、B 产生订单变更——A 收不到任何事件（含列级数据）；`orders` 的本人 SELECT 策略是订阅前置，以人工验证记录为证据；现有 REST / RPC 行为不受影响，类型契约向后兼容（加法型），P2 的 pgTAP 基线保持可运行且通过（权限收紧带来的既有用例调用身份调整与静态权限断言反转属有意修订，另新增反向与正向断言）。

FR-P3-18 全局错误拦截与用户可见提示：所有后端请求失败经统一拦截，归一为错误类别并映射为用户可见提示；错误类别为「服务端生成类别 + 客户端类别」的联合（纯客户端失败：网络不可达 / 超时 / 请求取消 / 会话失效有明确的客户端类别集合），类别到文案的翻译只有一个函数、同时消费两类；服务端类别在响应中的承载字段由架构阶段与 Phase 2 侧核对后钉死；支付接口的类别复用 `order_error_code`，未知类别归一为加法型 `unknown`（随本阶段迁移入库并重新生成类型），订阅失败对用户静默、不产生数据库类别，其它新增失败类别先在客户端侧记录；类别取值仍以生成类型为唯一来源；下单失败至少区分售罄、规格失效、商品不可售、权限等业务原因且文案可行动；提示不包含内部堆栈、数据库细节、密钥或 OpenID 等敏感信息；页面级加载失败有失败态与重试入口，操作级失败不留下脏界面；本组是对 P1 AD-7「不建全局错误拦截器」的显式替代，Phase 1 未覆盖的界面增量（错误提示、失败态、重试入口、空态、缺图占位、提交防重复态）在本阶段首次定义，形态与文案来源由架构阶段的最小 UI 规范落定。

FR-P3-19 关键失败不产生脏状态：演示路径上的关键失败（登录、创建订单、状态变更）都不产生难以恢复的中间态——登录失败不产生半登录状态；创建订单失败不丢购物车、不产生重复订单；催单 / 确认取杯失败不改变本地展示的状态；任一步失败后用户都能在界面上找到明确的下一步（重试 / 返回）；演示路径不依赖任何「特判后门」或假数据兜底。

### NonFunctional Requirements

NFR-P3-1 性能：目录加载与下单路径在演示网络条件下不出现可感知卡顿（以演示预演记录为证据）；轮询不得造成请求堆积或界面卡顿（离开即停、同一时间单实例）。

NFR-P3-2 可靠性：写路径幂等（至少覆盖创建订单）；读路径失败可重试；订单状态推进不依赖客户端在线（沿袭 Phase 2）。

NFR-P3-3 安全：客户端只持有可公开的发布密钥与会话凭证；服务端密钥绝不出现；提示与日志不含敏感信息；订阅不泄露非本人数据。

NFR-P3-4 兼容性：不引入 Supabase 官方 SDK 与社区适配库（Realtime 传输为显式例外）；界面结构与交互沿用 Phase 1 基准，替换只发生在数据层；结算栏分包按需加载（P1 AD-4）不回归；本阶段首次定义的界面增量以 FR-P3-18 的最小 UI 规范为准。

NFR-P3-5 可观测性（开发期）：订阅连接、回退与重连过程可在开发期被观察；错误类别贯穿到用户提示。

### Additional Requirements

来源：Phase 3 架构 spine（AD-1 ~ AD-17、Inherited Invariants、最小 UI 规范、Consistency Conventions、Stack、Structural Seed、验证矩阵模板）与 PRD §6 约束。

**仓库边界与起点**

- AR-P3-1 无 starter 模板：架构未指定任何 greenfield / starter 模板。当前仓库为**规划仓库**（只产出 PRD、架构与 Epic 文档）；实际实现发生在**开发仓库 `we-order`**（含 `mp/` 与 `supabase/`）。Epic 1 的第一个 story 不是「从模板初始化项目」，而是在既有开发仓库内落地 Phase 3 骨架与存量清理。
- AR-P3-2 客户端结构落点（Structural Seed）：`mp/src/` 新增 `core/{session,transport,realtime}`；重建 `api/{catalog,orders,cart,auth,storage}.ts`；根新增 `composables/use-app-bootstrap.ts`、`use-order-status.ts`（跨主包 / 分包 → 根）；`utils/error-copy.ts`、`utils/order-status.ts`；`types/api-contracts.ts` 为客户端唯一契约文件；删除 `src/mock/`、`pages/auth-check/` 并同步 `pages.json` 首页与声明。
- AR-P3-3 后端改动清单（Phase 3 全部加法型）：迁移（`create_order_for_user` + revoke / grant 收紧、`orders` 加入 publication、扫描周期同名替换 3s、`order_error_code` 追加 `unknown`）；新增边缘函数 `pay-order`（`verify_jwt = true`、失败响应带 `x-request-id`）；pgTAP 既有断言按新授权反转 / 重述并新增反向与正向断言；8 个 verify 脚本 9 处 `create_order` 调用改造（优先改走 `pay-order`）；`supabase/types/database.types.ts` 重新生成。
- AR-P3-4 环境与拓扑：本地 Supabase 栈是唯一运行环境（Postgres 17、迁移 + 种子、RLS、publication、Storage 公开读桶、`wechat-login` / `pay-order`、cron 扫描）；小程序并发走 REST / RPC、HTTP（登录 / 支付）、Socket（订阅）、图片 URL；Phase 4 前不上云；演示前按 addendum §F 预检（含真机读目录最小冒烟）。

**客户端分层与基础设施**

- AR-P3-5 分层与依赖方向（AD-1）：依赖方向固定为 `pages/ · sub-* → composables/ → api/ → core/ → 平台 API`；`core/` 只被 `api/` 引用，任何 api / 之上的层不得 import `core/`；`components/` 不依赖 pages / composables / stores；`stores/` 只被 composables 引用；`types/` 全层可引用；`utils/` 为纯函数、可被 pages / composables / api 引用，**`core/` 不引用 `utils/`**；core 内部 `realtime → session`（取凭证与本人标识）、`session → transport`（经裸请求通道调平台 auth 端点），`transport` 不 import `session`（取凭证与 401 处理经 `session` 装载时注册的 provider 回调完成）；Composable 可使用 alova hooks，但数据访问仍必须经 `api/`。
- AR-P3-6 core 三模块职责与运行时状态边界（AD-2）：运行时状态只允许住在 `core/`（**仅基础设施**）、既有 `stores/`（经 Composable 读写，本阶段不新增）与 Composable 内，`core/` 不承接任何业务响应式状态；`core/session` 是会话唯一读写者（持有、持久化、过期判断、单飞续期、失败回退重登、按到期时间**主动安排续期**、`ensureSession()` 等待在飞登录 / 续期、对外提供取凭证 / 取本人标识 / 凭证变更通知）；`core/transport` 承载 alova 实例、唯一请求头构造、错误归一、`401` / `PGRST301` / `not_authenticated` 的续期与重放、以及供 `core/session` 使用的裸请求通道；`core/realtime` 承载协议客户端、`uni.connectSocket` 传输适配、订阅生命周期、凭证同步；`api/` 不持有运行时状态（不放订阅句柄、不放请求序号、不缓存会话）。
- AR-P3-7 唯一数据出口与本地存储出口（AD-3）：所有业务后端访问（REST、RPC、边缘函数、Realtime 订阅）必须经 `api/`，页面与 Composable 不得直接发起网络请求；`core/` 为完成自身职责所发的协议调用（平台 auth 端点、刷新、socket）不经 `api/`、不向上暴露；本地存储唯一出口：`weorder_session` → `core/session`，`weorder_cart` → `api/cart.ts`，`weorder_checkout_intent` → `api/orders.ts`，`weorder_schema_version` → `api/storage.ts`（`migrateStorageOnce()`）；页面与 Composable 不得直接调用 `uni.setStorageSync` / `getStorageSync`；`api/` 的每个方法声明身份要求（`anonymous` 目录 / 门店 / 图片不等待会话、`session-required` 订单 / 支付先经 `ensureSession()` 且失败统一产出 `client.session_expired`）；订阅入口按 AD-9 单独处理（等待会话、静默回退与补订，不产出用户可见失败）。
- AR-P3-8 会话纪律与显式修订（AD-4；显式修订 P2 AD-14）：启动即静默登录——`App.vue:onLaunch` 经根 Composable `use-app-bootstrap.ts` 触发会话预热，不阻塞页面、失败不弹全局提示；启动 gate——`onLaunch` 第一步同步执行 `api/storage.ts` 的版本清理，完成前不允许任何存储读取或 store 水合，清理后购物车重新水合（空）；已有有效会话直接复用；续期单飞 + 主动续期，续期失败回退重新静默登录（带退避与尝试上限，不产生第二身份、不留半登录状态）；会合语义——需要身份的动作（进订单页、点结算等）经 `ensureSession()` 等待在飞登录，不主动失败，只有它失败才暴露（订单页失败态 + 重试 / 结算 toast）；上层代码不出现 token 一词，请求头构造只在 `core/transport`，不向上层暴露未登录，会话不进 Pinia；本条显式取代 P2 AD-14 的「登录为惰性、启动不强制」并连带修订其「请求头构造只在 `api/` 内」判据（判据随 AD-2 迁至 `core/transport`）。
- AR-P3-9 请求库落点 alova（AD-5）：采用 `alova` + `@alova/adapter-uniapp`，仅用于传输与页面请求状态；`createAlova` 实例与全部拦截器只存在于 `core/transport`；**强制点在实例级**——关闭响应缓存与请求共享，方法作者不得依赖默认值或逐方法覆盖；`api/` 定义请求方法并导出，Composable 可用 `useRequest` / `useWatcher` 包裹 `api/` 的方法，但不得用 alova 直接访问后端；错误经 `core/transport` 归一为 `AppError` 后才可上浮；续期与重放由认证拦截器经 `core/session` 注册的 provider 完成；唯一 SDK 例外 = `@supabase/realtime-js` 的 transport 扩展点。

**错误、状态与刷新**

- AR-P3-10 错误归一与唯一翻译（AD-6）：承载字段钉死——RPC 失败 = PostgREST 标准载荷（`P0001` + `message` = 类别值）、边缘函数失败 = 非 2xx + `{ code, message }` + `x-request-id`、平台 auth 端点 = `{ code | error_code, msg | message }`，不新增自定义错误信封；服务端类别以生成类型为唯一来源（`order_error_code` 加法新增 `unknown`、`login_error_code`），按端点分派枚举域、同名类别在不同域可有不同文案；客户端类别集合 = `network_unreachable` / `timeout` / `request_cancelled` / `session_expired`；归一表唯一实现落在 `core/transport`，含 `42501 → order.unknown`（不触发续期）、会话类行优先（`401` / `PGRST301` / `not_authenticated` 先续期重放）等规则；`AppError { code, source: 'login' | 'order' | 'client', status?, requestId? }` 定义在 `types/`；唯一翻译函数 `(error: AppError) => string` 放在 `utils/error-copy.ts`（按 `source` 选域、域内 `Record` 穷尽联合类型）；`request_cancelled` 不产生用户可见提示；同一失败只提示一次。
- AR-P3-11 状态应用单调（AD-7）：状态的唯一来源是服务端读取（列表 / 详情函数）；推送只作触发信号——收到 INSERT / UPDATE 事件后合并去重并立即触发一次对应读取，原始行不进入 UI 状态；读取结果按请求序号应用——`seq` 由编排 Composable 在每次读取发出时铸造、比较范围按订单 id，`api/` 与 `core/` 不持有或递增任何序号，只应用 `seq` 更大的结果；任何来源都不接受状态倒退（`cooking < pickup < completed`，`completed` 为终态）；重复应用同一状态幂等；列表合并只增不删（已知 id 更新、未知 id 插入、陈旧读取只合并不删除），整表替换只由首屏读取 / 显式刷新 / 分页重置决定；状态按页实例持有、页间不共享；纯逻辑（状态排序、合并、序号判定）放 `utils/order-status.ts` 并进单元测试清单。
- AR-P3-12 刷新策略（AD-8）：刷新可见域 = 页面可见且订单视图激活（订单列表 tab 或详情页），切 tab 由页面显式调用编排 Composable 的 `setActive`；订阅健康（channel `SUBSCRIBED`）→ 不轮询、等待推送（推送再触发读取）；订阅不可用（连接中 / 断开 / 重连中）→ 启用轮询、间隔 5s；订阅由非 `SUBSCRIBED` 进入 `SUBSCRIBED`（含首次建立）时先补读一次再停止轮询；进入可见域 / 切回订单 tab / App 与页面 `onShow` → 立即读一次并重置轮询计时；轮询失败静默重试 3 次，仍失败则停止轮询、降级为手动刷新入口（保留已有数据），首屏无数据的失败 → 页面失败态；同一时刻同一视图最多一个轮询计时器、不产生请求堆积；不设统一开关（订阅不可用是唯一回退条件，验证纯轮询时临时调整代码）；M2 降级时停用 `core/realtime`，本 AD 其余规则不变、轮询为唯一刷新路径。
- AR-P3-13 订阅路线、生命周期与凭证同步（AD-9）：实现路线 = 单独使用 `@supabase/realtime-js`（PRD §6 显式例外，仅取 transport 扩展点）+ `core/realtime` 注入 `uni.connectSocket` 的 `WebSocketLike` 适配器，不引 `supabase-js` 与社区适配库；**PoC 第一验证点** = realtime-js 构造期 `new URL()` 的最小 `URL` 垫片必须在导入 / 构造前提供，且必须**真机冒烟**（开发者工具运行在 NW.js、会掩盖该问题）；所有权——Composable 决定何时需要订阅并持有句柄与决策，`api/` 的订阅入口是无状态工厂（不得持有模块级 channel），`core/realtime` 只做协议、连接、退避与生命周期；订阅 / 退订幂等，同一视图只允许一个活跃 channel（列表与详情互斥）；入口形状 `subscribe({ scope: 'list' | 'order', orderId? }) → { unsubscribe(), onStatus(cb) }`，连接状态经回调上浮；仅在有有效会话时建立，会话未就绪时入口等待（不阻塞页面）、就绪或重登成功后自动补订、期间回退轮询，续期成功后同步凭证（`setAuth`）；本人 id 由 `core/session` 提供、经 `api/` 传入 `core/realtime`，filter 不构成归属判定、**RLS 是唯一裁决**；只订阅 `orders` 的 `INSERT` / `UPDATE`（列表 filter `user_id=eq.<本人 id>`、详情 filter `id=eq.<订单 id>`），不订阅 `DELETE`（Realtime 的 RLS 过滤不适用于 DELETE）与 `order_items`；订阅失败、回退与恢复对用户静默，开发期以固定前缀日志输出连接 / 退订 / 回退 / 恢复。
- AR-P3-14 订阅配套与验证（AD-13）：迁移中把 `public.orders` 加入 `supabase_realtime` publication（**只加这一张表**）；publication 决定「什么能进日志流」、RLS 决定「谁能看到哪一行」，publication 不构成授权放开；验证方式（人工验证记录）——两个身份客户端，A 订阅、B 产生订单变更 → A 收不到任何 `INSERT` / `UPDATE` 事件（含列级数据）；订阅是 P2 AD-5「客户端不直读表」的显式例外（消费 RLS 过滤后的变更事件，不是行读取）；现有 REST / RPC 行为不受影响、类型契约向后兼容、pgTAP 基线保持可运行且通过。

**下单与支付**

- AR-P3-15 幂等键生命周期（AD-10）：幂等键 = 一次结算意图，由客户端生成、必填、跨页面重进与进程重启稳定；进入确认订单页时无持久化意图、或与当前购物车 + 就餐方式的规范化序列化不一致 → 生成并持久化，一致 → 复用；购物车内容或就餐方式变化 → 作废重建；下单成功、服务端类别（`order_error_code` 全部，含 `not_authenticated`）、`42501`、`session_expired` → 清除（请求未进写路径）；`timeout` / `network_unreachable` / `request_cancelled`（结果不明）→ 保留，重试不换键；键随请求经 `pay-order` 请求体原样转发；服务端唯一域 `(user_id, idempotency_key)`；**唯一转换器** `CartItem[] → CreateOrderItem[]`（wire 形状）只允许在 `api/cart.ts`（`toCreateOrderItems()`）实现、结算与「再来一单」共用，禁止展开购物车条目直传；生成 / 校验 / 序列化的纯函数放 `utils/` 并进单元测试清单。
- AR-P3-16 支付接口 `pay-order`（AD-11）：形态 `POST /functions/v1/pay-order`、`verify_jwt = true`（平台先校验会话，不关闭校验）；请求 `{ items: [{ product_id, quantity, selections }], dining_mode, notes, idempotency_key }`（`selections` = 规格组 id → 选项 id（单选）/ 选项 id 数组（多选）），不含展示字段与任何金额字段、不接受 camelCase；身份取自平台已验签 JWT 的 `sub`，用服务端密钥调用 `create_order_for_user`（`apikey` 与 `Authorization` 都使用服务端密钥、角色必须是 `service_role`，客户端 JWT 绝不转发给包装函数调用），不引入客户端可伪造的用户标识参数、不直写订单表；成功响应 200、体 = 包装函数返回的订单对外形状（`order_result_json`）原样（不加信封、不改字段名），语义 = 创建成功才返回支付成功；失败响应非 2xx、体 `{ code, message }`、类别复用 `order_error_code`、带 `x-request-id`；`pay-order` 是客户端创建订单的唯一入口，不建立支付记录实体与支付状态机；必要性 = 将来真实微信支付的接缝（本阶段只做模拟支付 + 转发）。
- AR-P3-17 `create_order` 权限收紧（AD-12）：`create_order` 的 EXECUTE 从 `public` / `anon` / `authenticated` **收回**，成为只有服务端可达的内核（本体签名与逻辑不变，归属仍只由请求上下文表达）；新增包装函数 `create_order_for_user(p_user_id uuid, p_items jsonb, p_dining_mode public.dining_mode, p_notes text, p_idempotency_key text) returns jsonb`（`SECURITY DEFINER`、`set search_path = ''`、属主与 `create_order` 相同、`p_user_id` 非空校验）；授权按语句级执行、顺序固定——先 `revoke execute ... from public, anon, authenticated`，再 `grant execute ... to service_role`；内部以 `set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id)::text, true)`（事务局部）注入后调用 `create_order`；这是唯一允许声明「我是谁」的服务端接缝，也是 P2 AD-3「归属表达点恰好两处」的**显式例外**（第三个声明点，只授 `service_role`）；客户端直呼任一函数 → `42501`；注入不生效必须 fail-closed（抛 `not_authenticated`，表现伪装成会话失效）并以**正向断言**证明注入真的到达 `auth.uid()`；调用面调整——pgTAP 3 个文件 62 处改经 `create_order_for_user`（`service_role`、fixture 提供用户 UUID、移除 claim 注入），静态权限断言反转（`anon` / `authenticated` 含 `public` 对两函数均须 false、`service_role` 对包装函数 true），新增反向断言（直呼两函数 → `42501`）与正向断言（wrapper 建单归属 = `p_user_id`；注入失败 → `not_authenticated`）；8 个 verify 脚本 9 处 `create_order` 调用改造（优先改走 `pay-order`，确需直呼的用 `service_role` + 包装函数并注明语义变化）。

**类型、清理与 UI**

- AR-P3-18 类型契约与客户端唯一契约文件（AD-14）：唯一生成命令 `supabase gen types typescript --local > supabase/types/database.types.ts`，生成物入仓、不手工编辑；mp 以相对路径 `import type` 引用同一份生成物（编译期擦除、不进包），不复制 / 不做手工同步步骤；**客户端唯一契约文件 `types/api-contracts.ts`**——`OrderResult` / `OrderListItem` / `OrderDetail` / `OrdersPage` / `CreateOrderItem` / `CreateOrderRequest` / `SpecSelections` 各自标注服务端来源（`order_result_json` / `get_my_orders` / `get_my_order_detail` / `menu` …），目录、订单、结算、再来一单都从此引用、不得各建一份，用 `satisfies` / 穷尽键检查防漂移；身份映射——`order.id` = 服务端 UUID（RPC / 订阅 / 列表 key）、`order_number` = 展示编号，并同步修改既有 UI（`order-card`、`order-detail`、`use-orders.goToOrderDetail`、`use-reorder`）；JSON 形态——金额为 jsonb 数字（元、两位小数），时间为服务端按门店时区格式化的 `YYYY-MM-DD HH:mm:ss` 文本，快照类 JSON 字段（`selections`、`create_order` 入参、订单读取返回等）保留手工覆盖类型并标注出处；字段可空性与生成类型一致（如 `pickup_code` 恒有值）；落点沿用 P1 约定（共享业务类型以生成类型窄别名形式留在 `types/`，`api/` 专属请求 / 响应类型定义在 `api/` 文件内）。
- AR-P3-19 存量清理与单一数据源（AD-15）：删除 `src/mock/`、Phase 2 遗留 `api/` 实现（重建）与 `pages/auth-check/` 验证入口，**同步更新 `pages.json` 首页与声明**；不存在任何 Mock 回退开关；清理是 `onLaunch` 的第一步同步操作（执行者唯一：`api/storage.ts` 的 `migrateStorageOnce()`；版本标记 `weorder_schema_version` 由其写入）；清理集合 `weorder_orders` / `weorder_cart` / `weorder_checkout_intent`（跨版本复用会取回旧订单）→ 版本 ≠ 3 时清空并写 3，`weorder_session` 保留（有效会话直接复用）；清理后购物车 store 重新水合（空）；「再来一单」只从服务端快照还原、wire 转换复用唯一转换器，快照中已失效的行丢弃并 toast「部分商品已失效」。
- AR-P3-20 最小 UI 规范与失败不脏状态（AD-17 + spine「最小 UI 规范」节）：单一文案来源 `utils/error-copy.ts`（按 `AppError.source` 分域），场景专属补充（如支付超时提示）由场景 Composable 追加、不复制翻译；P1 AD-7 承接——数据加载失败由 Composable 返回 error 状态供页面失败态渲染，客户端业务校验失败（如空购物车结算）由场景 Composable 以 toast 阻断并保留可重试；形态分工——操作级失败（下单 / 催单 / 确认取杯）用 `uni.showToast({ icon: 'none' })` 且界面停留可重试，页面级加载失败（目录 / 订单列表 / 订单详情）用页面内失败态（文案 + 「重试」）；订单页加载失败不展示任何订单数据（含本地缓存）、不以空列表伪装；空态（订单列表）显示「还没有订单」+「去点餐」并停止轮询与订阅；提交类操作进入 loading 防重复态、失败后恢复可点（支付过程保留 Phase 1 的 loading 与成功反馈）；缺图以色块占位、不阻塞列表渲染；启动静默登录失败不弹全局提示、在需要身份的动作处暴露失败类别（不暴露会话状态）；关键失败不留脏状态（下单失败保留购物车、不产生重复订单；催单 / 确认取杯失败不改变本地展示状态）；文案表（登录类沿用 Phase 2、订单类新增 10 项、客户端类 4 项）与形态表（含催单成功 / 确认取杯成功 / 支付超时内联提示 / 再来一单部分失效 toast）为内容基准。
- AR-P3-21 演示参数（AD-16）：参数分两类载体、均为服务端 / 声明式、演示前可调，客户端不参与任何时间判定；门店行——推进时长 15s / 催单提前量 3s / 自动完成等待 30s，对新建单与新催单立即生效、已出单的时刻不变；cron 声明——扫描周期 3s（由 15s 调小），修改必须**同名替换** `order-sweep`、不得留下第二个扫描任务；演示前调整方式：门店行 `UPDATE` 即时生效，cron 周期走迁移或 `cron.alter_job` 后重新确认任务列表。

**验证与节奏**

- AR-P3-22 验证策略与手动验证矩阵：不做端到端自动化测试、不做 CI/CD；作为交换交付**手动验证矩阵**（场景 / 前置 / 步骤 / 期望 / 实际 / 证据 / 结论），覆盖演示路径与主要失败场景（登录失败、续期单飞、杀进程后重试、订阅回退等）；spine 提供 13 行模板（含演示主路径、登录失败与重试、续期单飞与主动续期、杀进程后重试、订阅回退与恢复、归属隔离含订阅、数据库测试基线、存量清理后的空启动、界面无回归含 AD-4 四项专项、会话承载可替换、业务拒绝可区分、订阅驱动更新可观察、自动完成）；允许对纯函数做少量单元测试（错误映射、状态映射、幂等键管理）；接受无自动化回归网的代价。
- AR-P3-23 实施节奏与止损：M1（demo-critical）= 对接层 → 登录 → 目录 → 支付接口（模拟）→ 订单 / 轮询 / 催单 / 确认 → 错误提示，达成 SM-1；M2（加分）= Realtime 挑战，止损线——PoC 超过 1 天（Ly 裁定，与 AI 协同）或演示前仍未跑通，即降级为纯轮询、不再投入。
- AR-P3-24 平台约束与运行环境：小程序无 `fetch` / 原生 WebSocket；请求域名需备案，开发期依赖三条绕过手段（开发者工具不校验 → 真机调试模式 → 同一局域网 IP 直连）；后端本地实例、Phase 4 前不上云；边缘函数有内存与时长上限、无持久化磁盘、冷启动数百毫秒，不能依赖本地文件状态、不做长任务；`migration squash` 会丢弃 cron 任务、使用前须知会丢什么。

**约定**

- AR-P3-25 命名与一致性约定：沿用 Phase 1——kebab-case、组件目录 `index.vue`、Composable `use-*.ts`、SFC 区块顺序 `<script> → <template> → <style>`；客户端模块 `core/{session,transport,realtime}`、`api/` 分域 `catalog / orders / cart / auth / storage`（`auth` 仅会话门面、转调 `core/session`、不得自建登录请求）、`types/api-contracts.ts` 为客户端唯一契约文件；本地存储 key 沿用 `weorder_` 前缀；请求头恒带 `apikey: <发布密钥>`，需要身份时附 `Authorization: Bearer <访问凭证>`，发布密钥不是 JWT、不得放 `Authorization`，调包装函数时 `apikey` 与 `Authorization` 均为服务端密钥；订阅 filter 只用 `eq`、channel 名不含凭证、同一视图单活跃 channel、只订 `INSERT` / `UPDATE`；时间与金额客户端不参与判定；错误类别是稳定契约、文案不是，日志不含密钥 / OpenID / 堆栈；全部结构变更（含 publication、cron、包装函数与 ACL）声明式入仓、新函数必须显式 revoke PUBLIC 再按需 grant。
- AR-P3-26 继承不变量红线与显式修订：P1 AD-1 / AD-2 / AD-3 / AD-4 / AD-5 / AD-6 / AD-9 与 P2 AD-1 ~ AD-23 除本 spine 显式修订 / 例外者外继续有效；显式修订 = P2 AD-14 惰性条款（→ AD-4 启动即静默登录）、请求头构造判据（`api/` → `core/transport`）、P2 AD-3 归属表达点（→ AD-12 增加第三个服务端声明接缝）、P2 AD-5 客户端不直读表（→ AD-13 订阅为 RLS 过滤变更事件的显式例外）；其余不得弱化，含 P1 AD-4 结算栏分包按需加载与展开时机（(a)–(f) 六分支进验证矩阵 #9）、P1 AD-9 主包 / 分包文件归属、P2 AD-7 取杯号恒有值 / 不可变、P2 AD-13 归属拒绝不可区分、P2 AD-19 测试基线三类边界覆盖不减少、P2 AD-22/AD-23 共享形状与有界读取。

### UX Design Requirements

本阶段**无独立 UX 设计契约输入**，且不产生独立的 UX 设计需求条目。依据：

- 未找到任何 UX 设计文档（`DESIGN.md` 与 `EXPERIENCE.md` 均不存在，也无 legacy `*ux*.md`）。
- Phase 3 的界面增量已由架构 spine 的「最小 UI 规范」（AD-17）定义，并已完整抽取为 **AR-P3-20**（错误提示 / 失败态 / 重试入口 / 空态 / 缺图占位 / 提交防重复态 + 文案表与形态表）；对应验收基准在 FR-P3-18 与 FR-P3-7。
- 界面结构与交互行为的唯一基准仍是 Phase 1 PRD 与 Phase 1 架构 spine；本阶段只换数据源、不改交互结构。

若后续为错误提示、失败态或空态补充 UX 设计契约，应作为新输入重新进入本流程，并把相应 UX-DR 追加到本节。

### FR Coverage Map

FR-P3-1: Epic 1 - 统一请求对接层(重建 `api/` 与新增 `core/`，唯一出口、自动带凭据、错误归一)
FR-P3-2: Epic 1 - 类型契约对齐与编译期保护(生成类型入仓、P1 手工类型退休、唯一契约文件)
FR-P3-3: Epic 2 + Epic 4 - 存量清理与单一数据源(启动清理 gate 在 Epic 1；目录侧 Mock 与旧目录实现、Phase 2 验证入口在 Epic 2 移除；订单侧 Mock 与旧订单实现随 Epic 4 订单切换移除后整体收口)
FR-P3-4: Epic 1 - 启动静默登录(启动预热，不阻塞页面，失败按类别在需要身份处暴露)
FR-P3-5: Epic 1 - 会话持久化与自动续期(单飞 + 主动续期 + 回退重登)
FR-P3-6: Epic 1 - 会话状态归属修正(`core/session`，关闭 Phase 2 偏离)
FR-P3-7: Epic 2 - 目录读取切到真实数据(含缺图占位与加载失败态)
FR-P3-8: Epic 3 - 支付接口(支付 → 创建订单 `pay-order` 唯一入口，权限收紧)
FR-P3-9: Epic 3 - 支付接口幂等与失败恢复(结算意图幂等键、杀进程重试、购物车保留)
FR-P3-10: Epic 4 - 订单列表(三态、读时推进、失败不伪装空列表)
FR-P3-11: Epic 4 - 订单详情与「再来一单」(服务端快照、取杯号制作中即可见)
FR-P3-12: Epic 4 - 轮询刷新(含状态单调应用与降级手动刷新)
FR-P3-13: Epic 4 - 催单(提前推进时刻、重复幂等)
FR-P3-14: Epic 4 - 确认取杯与自动完成
FR-P3-15: Epic 5 - Realtime 订阅自适配(挑战项，可降级)
FR-P3-16: Epic 5 - 订阅与轮询的切换与回退(自动回退、无统一开关)
FR-P3-17: Epic 5 - Supabase 侧订阅配套(publication 只含 `orders` + RLS 隔离验证)
FR-P3-18: Epic 4 - 全局错误拦截与用户可见提示(归一骨架与唯一翻译在 Epic 1 落地；目录失败态在 Epic 2、支付失败文案在 Epic 3、订单失败态与业务拒绝在 Epic 4 收口)
FR-P3-19: Epic 4 - 关键失败不产生脏状态(登录失败在 Epic 1、建单失败在 Epic 3 逐条验收；完整验收在 Epic 4)

## Epic List

### Epic 1: 真实通道与无感身份(对接层重建 · 类型对齐 · 静默登录与会话)

冷启动即静默建立身份、重启免登录、凭证过期无感续期；所有后端访问经唯一对接层(自动带发布密钥与访问凭证，失败统一归一为 `AppError` 并按域唯一翻译)；类型向生成类型对齐；启动 gate 清除 Mock 时代存量数据；会话迁出 `api/`，关闭 Phase 2 偏离。

**FRs covered:** FR-P3-1, FR-P3-2, FR-P3-4, FR-P3-5, FR-P3-6

**Additional requirements:** AR-P3-1, AR-P3-2, AR-P3-5, AR-P3-6, AR-P3-7, AR-P3-8, AR-P3-9, AR-P3-10, AR-P3-18, AR-P3-19(启动 gate 部分), AR-P3-20(文案与形态基建), AR-P3-24, AR-P3-25, AR-P3-26

**Delivered value:** M1 第一、二段(对接层、登录)；SM-4 类型契约生效的前半。

**Depends on:** 无(起点)。

**Note:** 本 Epic 交付「无感身份 + 统一通道 + 类型契约 + 启动清理 gate」，是后续所有 Epic 的地基；旧 `api/auth/` 随会话重建删除（由 `core/session` + `api/auth.ts` 门面承接）；目录与订单在各自 Epic 切换前仍由 Mock 驱动，本 Epic 不删除 Mock 数据源。

### Epic 2: 打开就是真菜单(目录对接 · 存量清理 · 单一数据源)

分类、商品、规格与门店全部来自后端；双栏联动 / 规格计价 / 缺图占位不回归；加载失败有失败态与重试；Mock 数据源、旧 `api/` 死代码与 Phase 2 最小验证入口彻底移除——客户端只剩一条真实数据通路。

**FRs covered:** FR-P3-7, FR-P3-3(目录侧移除)

**Additional requirements:** AR-P3-3, AR-P3-4, AR-P3-19(清理收口), AR-P3-20(缺图 / 失败态), AR-P3-26(P1 AD-4 分包按需加载与 AD-9 文件归属不回归)

**Delivered value:** M1 第三段(目录)；SM-6 界面无回归前段。

**Depends on:** Epic 1(新 `api/` 通道与会话)。

### Epic 3: 下单：支付接口说了算(支付 → 创建订单 · 幂等与失败恢复)

模拟支付经唯一服务端入口一次完成建单；金额、订单号、取杯号、归属全部服务端产出；客户端直呼旧创建路径被拒(`42501`)；网络超时与杀进程重试不产生第二张订单；失败保留购物车、文案可行动。

**FRs covered:** FR-P3-8, FR-P3-9

**Additional requirements:** AR-P3-3, AR-P3-15, AR-P3-16, AR-P3-17, AR-P3-20(提交防重复 / 支付超时内联提示), AR-P3-26(P2 写路径封闭 / 幂等 / 拒绝语义)

**Delivered value:** M1 第四段(支付接口)；R-1 最险段落关闭；SM-2 零结构性返工的关键证据。

**Depends on:** Epic 1(会话 / 通道)、Epic 2(真实目录与加购)。

### Epic 4: 一单到底：订单进度与失败可控(列表 · 详情 · 轮询 · 催单 · 取杯)

下单后看到「制作中」，催单加速 →「待取餐」→ 确认取杯或自动完成；列表三态与分页、详情快照与再来一单；推进在一个轮询周期内可见且状态应用单调；空态不做无意义轮询；关键失败不留脏状态(不丢购物车、不重复单、不改本地状态)；手动验证矩阵覆盖演示主路径与失败场景。

**FRs covered:** FR-P3-10, FR-P3-11, FR-P3-12, FR-P3-13, FR-P3-14, FR-P3-18(收口), FR-P3-19(收口), FR-P3-3(订单侧移除并整体收口)

**Additional requirements:** AR-P3-6, AR-P3-7, AR-P3-11, AR-P3-12(轮询分支), AR-P3-18(`order.id` / `order_number` 映射与既有 UI 同步), AR-P3-20, AR-P3-21, AR-P3-22, AR-P3-23(M1 达成)

**Delivered value:** M1 收口；SM-1 演示主路径完成；UJ-P3-1 高潮。

**Depends on:** Epic 3(真实订单)。

### Epic 5: 状态自己找上门：Realtime 订阅自适配(挑战项 · 可降级)

真机上用 `uni.connectSocket` + realtime-js transport 扩展点订阅本人订单变化，替代轮询；订阅不可用自动回退、用户无感；publication + RLS 证明不泄露他人数据；**超 1 天未跑通即降级纯轮询，不阻塞交付**。

**FRs covered:** FR-P3-15, FR-P3-16, FR-P3-17

**Additional requirements:** AR-P3-12(订阅健康分支), AR-P3-13, AR-P3-14, AR-P3-22(验证矩阵 #5 / #6 / #12 行), AR-P3-23(M2 止损), AR-P3-24(真机 / 域名)

**Delivered value:** M2；SM-5 / UJ-P3-2。

**Depends on:** Epic 1(会话凭证)、Epic 4(订单可见域与状态应用路径)。

**Note(挑战项属性)：** 本 Epic 不纳入演示验收；任意时点可整块停用(`core/realtime` 不启用)，Epic 1~4 的行为完整不受影响。

**Epic 3/4 重叠说明：** 两个 Epic 都会改动订单域核心文件(`api/orders.ts`、订单 composables、pgTAP / verify 脚本)。不合并的理由：「支付接口权限收紧 + 幂等」与「状态流转 + 刷新 + 单调应用」是两个独立可验收的证明点，失败模式与验证方式不同；Epic 3 完成即可独立证明「客户端建不了绕过单、重试不出第二单」，Epic 4 完成即可独立证明「推进可见、绝不倒退」。

<!-- 以下为 Epic 1 ~ Epic 5 的完整 story 分解 -->

## Epic 1: 真实通道与无感身份(对接层重建 · 类型对齐 · 静默登录与会话)

冷启动即静默建立身份、重启免登录、凭证过期无感续期；所有后端访问经唯一对接层(自动带发布密钥与访问凭证，失败统一归一为 `AppError` 并按域唯一翻译)；类型向生成类型对齐；启动 gate 清除 Mock 时代存量数据；会话迁出 `api/`，关闭 Phase 2 偏离。

### Story 1.1: 类型契约对齐与客户端唯一契约文件

As a Phase 3 对接者，
I want 客户端形状与后端生成类型保持单一来源，
So that 形状错误在编译期暴露，而不是运行期崩溃。

**Requirements:** FR-P3-2; AR-P3-18

**Acceptance Criteria:**

**Given** 已应用全部当前迁移
**When** 运行唯一生成命令（`supabase gen types typescript --local > supabase/types/database.types.ts`）
**Then** 生成物写入仓库唯一一份文件，再次生成零差异，生成物不被手工编辑
**And** mp 以相对路径 `import type` 引用同一份生成物（编译期擦除、不进包），不复制、不做手工同步步骤（ADR-0001）

**Given** `types/api-contracts.ts`
**When** 定义客户端契约类型
**Then** `OrderResult` / `OrderListItem` / `OrderDetail` / `OrdersPage` / `CreateOrderItem` / `CreateOrderRequest` / `SpecSelections` 全部在此定义，每个标注服务端来源（`order_result_json` / `get_my_orders` / `get_my_order_detail` / `menu` …）
**And** 目录、订单、结算、再来一单都从此引用，不得各建一份；用 `satisfies` / 穷尽键检查防漂移

**Given** Phase 1 手工类型（`types/order.ts`、`types/product.ts`、`types/store.ts`）
**When** 对齐生成类型
**Then** 退休为生成类型窄别名或删除，不保留手工副本；快照类 JSON 字段（`selections`、`create_order` 入参、订单读取返回等）的手工覆盖类型保留并标注出处
**And** 字段可空性与生成类型一致（如 `pickup_code` 恒有值）；故意构造的形状错误在编译期报错

### Story 1.2: 请求通道重建与错误归一

As a 小程序用户，
I want 每一次后端访问都走同一条真实通道、失败有一致语义，
So that 我不感知鉴权细节，演示的每一跳都发生在真实网络上。

**Requirements:** FR-P3-1, FR-P3-18(骨架); AR-P3-5, AR-P3-7, AR-P3-9, AR-P3-10, AR-P3-25

**Acceptance Criteria:**

**Given** 客户端源码
**When** 发起任何后端访问
**Then** 全部经 `api/` → `core/transport`；全仓不存在页面 / Composable 直发请求、不存在绕开通道的 `uni.request`；`api/` 不持有运行时状态（不放订阅句柄、不放请求序号、不缓存会话）
**And** 依赖方向 `pages/ · sub-* → composables/ → api/ → core/ → 平台 API` 成立；`core/` 只被 `api/` 引用、上层不 import `core/`；`core/` 不引用 `utils/`；`components/`、`stores/` 的既有约束不被破坏

**Given** `core/transport`
**When** 构造 alova 实例
**Then** 实例与全部拦截器只存在于 `core/transport`；实例级关闭响应缓存与请求共享（方法作者不得依赖默认值或逐方法覆盖）
**And** 请求头构造只此一处：恒带 `apikey: <发布密钥>`，需要身份时附 `Authorization: Bearer <访问凭证>`；发布密钥不是 JWT、不得放 `Authorization`；服务端密钥不出现在客户端
**And** 另导出「裸请求」通道（不挂续期 / 重登拦截）供 `core/session` 调平台 auth 端点；`core/transport` 不 import `core/session`，取凭证与 401 处理经装载时注册的 provider 回调完成

**Given** 各类失败
**When** 归一错误
**Then** 归一表唯一实现在 `core/transport`：RPC（`P0001` + `message` ∈ 类别域，未知 → `order.unknown`）、`42501` → `order.unknown`（不触发续期）、边缘函数（非 2xx + `{ code, message }` + `x-request-id`）、平台 auth（`{ error_code | code, msg | message }`）、`uni.request` fail（`timeout` / `request_cancelled` / `network_unreachable`）
**And** 会话类行优先：`401` / `PGRST301` / `not_authenticated` 先经 provider 续期并重放一次；恢复失败 → `AppError{ source: 'client', code: 'session_expired' }`；以伪 provider 注入可断言「只重放一次」与「二次失败归一」
**And** `AppError { code, source: 'login' | 'order' | 'client', status?, requestId? }` 定义在 `types/`；alova 的错误对象不进入 Composable

**Given** `utils/error-copy.ts`
**When** 把类别翻译为文案
**Then** 它是唯一翻译函数（签名 `(error: AppError) => string`），按 `source` 分域、域内用 `Record` 穷尽联合类型（枚举新增时编译报错）；`request_cancelled` 不产生用户可见提示
**And** 登录类文案沿用 Phase 2 表（`invalid_code` / `code_expired_or_used` / `rate_limited` / `identity_failed` / `session_failed` …）；客户端类文案按最小 UI 规范
**And** 提示不包含内部堆栈、数据库细节、密钥或 OpenID；同一失败只提示一次（由消费类别的 Composable 保证）

### Story 1.3: 会话模块（登录 · 持久化 · 单飞续期 · 回退重登）

As a 用户，
I want 打开小程序就有一个可用身份、重启免登录、凭证过期也感觉不到，
So that 全程没有登录界面、不被打断。

**Requirements:** FR-P3-4, FR-P3-5, FR-P3-6; AR-P3-6, AR-P3-8

**Acceptance Criteria:**

**Given** 冷启动且无有效会话
**When** 触发会话预热
**Then** 静默完成「`uni.login` 一次性凭证 → `wechat-login` 换取 → 建立会话并持久化」（`weorder_session`，唯一读写者 `core/session`）；无登录界面、无授权弹窗、不索取用户资料
**And** `api/auth.ts` 仅作会话门面（转调 `core/session`），不自建登录请求；旧 `api/auth/` 实现删除，会话职责由 `core/session` 承接

**Given** 已有有效会话
**When** 冷启动 / 应用重启
**Then** 直接复用、不重复登录；应用重启后会话可恢复，不需要用户再次操作

**Given** 访问凭证到期前后来到的并发请求
**When** 触发续期
**Then** 同一时刻只允许一个续期 / 登录在飞（单飞），其余请求等待并复用同一结果；到期前主动安排续期，调用方无感、不出现「同一操作先失败再成功」的可见抖动
**And** 续期失败回退重新静默登录（带退避与尝试上限），不产生第二个身份、不留下半登录状态（不产生孤儿用户、不残留不可用会话）；续期请求发出后应用被杀导致新凭证丢失时同样回退
**And** 并发登录产生的可重试 `session_failed` 属自动重试类别

**Given** 需要身份的动作（进订单页、点结算等）
**When** 会话尚未就绪
**Then** 经 `ensureSession()` 等待在飞登录 / 续期，不主动失败；只有它失败才暴露（订单页失败态 + 重试 / 结算 toast），暴露的是失败类别而非会话状态
**And** 上层代码不出现 token 一词、不暴露「未登录」；会话不进 Pinia；请求头构造只在 `core/transport`（`core/session` 只提供凭证取值、本人标识与凭证变更通知）
**And** 会话承载可替换（验证矩阵 #10）：以「注入伪会话」的替换为证据，证明对接层可独立替换、不携带会话上下文

### Story 1.4: 启动编排与存量清理 gate

As a 升级用户，
I want Mock 时代残留自动清掉、启动不被登录阻塞，
So that 界面永远读不到假数据，也不会卡在启动等待里。

**Requirements:** FR-P3-3(gate), FR-P3-4(启动不阻塞); AR-P3-8, AR-P3-19

**Acceptance Criteria:**

**Given** 带 Mock 时代 `weorder_orders` / `weorder_cart` / `weorder_checkout_intent` 的环境
**When** 冷启动
**Then** `App.vue:onLaunch` 第一步同步执行 `migrateStorageOnce()`（唯一执行者 `api/storage.ts`）：版本 ≠ 3 时清空三者并写 `weorder_schema_version = 3`；完成前不发生任何存储读取或 store 水合
**And** `weorder_session` 保留：有效会话直接复用；清理后购物车 store 重新水合（空）

**Given** 清理完成
**When** 继续启动
**Then** 经根 Composable `use-app-bootstrap.ts` 触发会话预热（异步、不阻塞页面渲染）；预热失败不弹全局提示，也不产生半登录状态
**And** 本 story 不删除 Mock 数据源与旧 `api/` 的订单 / 目录实现（分别随 Epic 2、Epic 4 切换收口）；不存在任何 Mock↔真实的开关或回退路径

## Epic 2: 打开就是真菜单(目录对接 · 存量清理 · 单一数据源)

分类、商品、规格与门店全部来自后端；双栏联动 / 规格计价 / 缺图占位不回归；加载失败有失败态与重试；Mock 数据源、旧 `api/` 死代码与 Phase 2 最小验证入口彻底移除——客户端只剩一条真实数据通路。

### Story 2.1: 目录读取切到真实数据

As a 未登录用户，
I want 打开小程序就看到数据库里的真实菜单，
So that 我浏览、加购的是真实数据，不是包里预先写死的数据。

**Requirements:** FR-P3-7; AR-P3-2, AR-P3-4, AR-P3-7, AR-P3-20, AR-P3-26

**Acceptance Criteria:**

**Given** 本地栈已应用迁移与 seed
**When** 打开小程序（未登录）
**Then** 分类、商品、规格组与选项、门店信息来自后端（`menu` 视图，REST，`anonymous`——**不等待会话**，登录失败不阻塞目录）
**And** 双栏联动、规格定制、实时计价等交互行为与 Phase 1 一致；展示价与计价来源同一份数据
**And** 下架商品不出现在读取结果；售罄商品保留并随结果返回 `availability`；本阶段不做售罄 / 下架的差异化置灰交互
**And** 目录形状按生成类型 / `types/api-contracts.ts` 消费，调用方拿到类型化结果而不是 `any`；旧 `api/products.ts`、`api/store.ts` 的 Mock 实现不再被调用

**Given** 商品图片
**When** 列表渲染
**Then** 图片源由 `image_path` 构造对象存储 URL；图片缺失或加载失败以色块占位、不阻塞列表渲染，不出现与商品不符的图片
**And** 本阶段不做图片对象入仓与上传（演示图片由 Ly 自行准备）

**Given** 数据源替换完成
**When** 复验 Phase 1 关键交互
**Then** 结算栏分包按需加载与展开时机不被改变（P1 AD-4；(a)–(f) 六分支的可观测判据属验证矩阵 #9 复验项）
**And** 新增文件落位符合 P1 AD-9（主包引用的 JS 不得放分包、仅分包使用的 JS 不得放主包目录树；根级新增文件至少有一个主包调用方）

### Story 2.2: 目录加载失败态与重试

As a 未登录用户，
I want 目录加载失败时看到失败态和重试入口，
So that 我不会面对白屏，能自己恢复。

**Requirements:** FR-P3-7, FR-P3-18(目录段); AR-P3-20

**Acceptance Criteria:**

**Given** 后端不可达 / 超时 / 5xx
**When** 打开首页或加载目录
**Then** 页面内失败态：文案来自 `utils/error-copy.ts`（按类别）+「重试」入口；不白屏、不渲染半截目录、不写入本地缓存
**And** 重试成功后恢复完整目录；重试进行中按钮禁用 / loading，防重复提交
**And** 失败文案不包含内部堆栈、数据库细节、密钥；同一失败只提示一次

### Story 2.3: 存量清理收口（目录侧）

As a Phase 3 对接者，
I want Mock 目录数据源与旧目录实现彻底删除、Phase 2 验证入口移除，
So that 客户端不再可能读到任何 Mock 内容。

**Requirements:** FR-P3-3(目录侧); AR-P3-19, AR-P3-26

**Acceptance Criteria:**

**Given** 目录已切换到真实数据
**When** 执行清理
**Then** 删除 `src/mock/products.ts`、`src/mock/store.ts`、旧 `api/products.ts`、`api/store.ts`；删除 `pages/auth-check/`（Phase 2 最小验证入口）并在 `pages.json` 移除其声明、首页改为 `pages/home/index`（旧 `api/auth/` 已在 Epic 1 随会话重建删除）
**And** 全仓搜索不存在 Mock 目录 / 门店数据的引用；不存在任何「Mock 与真实并存」的开关或回退路径
**And** 本地数据库数据可整体清空并由迁移 + seed 重建（重建后目录立即可读、会话不受影响），流程沿用 `supabase/scripts/rebuild.sh`、不依赖手工步骤
**And** 旧 `api/orders.ts`（Mock 订单读写）与 `mock/orders.ts` 仍服务尚未迁移的订单页，随 Epic 4 订单切换移除（FR-P3-3 的订单侧收口）——本 story 不删除它们、也不让目录依赖它们
**And** 新增 / 移动文件满足 P1 AD-9 归属规则

## Epic 3: 下单：支付接口说了算(支付 → 创建订单 · 幂等与失败恢复)

模拟支付经唯一服务端入口一次完成建单；金额、订单号、取杯号、归属全部服务端产出；客户端直呼旧创建路径被拒(`42501`)；网络超时与杀进程重试不产生第二张订单；失败保留购物车、文案可行动。

### Story 3.1: `create_order` 权限收紧与 `create_order_for_user`

As a 作品集作者，
I want 客户端不存在任何绕过支付接口的建单路径，
So that 「前端改价 / 冒充他人下单」在结构层面就不成立。

**Requirements:** FR-P3-8; AR-P3-3, AR-P3-17

**Acceptance Criteria:**

**Given** 迁移
**When** 应用
**Then** `create_order` 的 EXECUTE 从 `public` / `anon` / `authenticated` 收回，成为只有服务端可达的内核（本体签名与逻辑不变）；新增 `create_order_for_user(p_user_id uuid, p_items jsonb, p_dining_mode public.dining_mode, p_notes text, p_idempotency_key text) returns jsonb`（`SECURITY DEFINER`、`set search_path = ''`、属主与 `create_order` 相同、`p_user_id` 非空校验）
**And** 授权按语句级固定顺序：先 `revoke execute ... from public, anon, authenticated`，再 `grant execute ... to service_role`；客户端与 `public` 对两个函数均无 EXECUTE（直呼 → `42501`）
**And** 内部以 `set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id)::text, true)` 事务局部注入后调用 `create_order`；这是唯一允许声明「我是谁」的服务端接缝（P2 AD-3 的显式例外）；不引入客户端可伪造的用户标识参数、不直写订单表、不出现第二套金额 / 归属 / 写路径
**And** 注入不生效 fail-closed（`not_authenticated`）；同批迁移为 `order_error_code` 追加 `unknown`（加法型）并重新生成类型；类型重新生成后 `utils/error-copy.ts` 的穷尽检查驱动补齐订单域 `unknown` 文案

**Given** 重建后的空库
**When** 运行 `supabase test db`
**Then** 全绿：3 个测试文件 62 处 `create_order` 调用改经 `create_order_for_user`（`service_role`、fixture 提供用户 UUID、移除 claim 注入）
**And** 静态权限断言按新授权反转：`anon` / `authenticated`（含 `public`）对两函数均为 false；`service_role` 对包装函数为 true（对内核不授权、不作断言）
**And** 新增反向断言（`anon` / `authenticated` 直呼两函数 → `42501`）与正向断言（wrapper 建单归属 = `p_user_id`；注入失败 → `not_authenticated`）；三类边界覆盖不减少；失败能定位到具体函数 / 策略

### Story 3.2: 支付接口 `pay-order`（边缘函数）

As a 已登录用户，
I want 一次操作完成「模拟支付 → 创建订单」，
So that 支付成功与订单创建要么一起发生、要么都不发生。

**Requirements:** FR-P3-8; AR-P3-16, AR-P3-3

**Acceptance Criteria:**

**Given** 有效会话
**When** `POST /functions/v1/pay-order`，请求 `{ items: [{ product_id, quantity, selections }], dining_mode, notes, idempotency_key }`
**Then** 平台先校验 JWT（`verify_jwt = true`，不关闭校验）；用户 id 取自已验签 JWT 的 `sub`；以服务端密钥（`apikey` 与 `Authorization` 均 `service_role`）调用 `create_order_for_user`；客户端 JWT 绝不转发给包装函数调用
**And** 请求不含展示字段与任何金额字段、不接受 camelCase；`selections` 形状 = 规格组 id → 选项 id（单选）/ 选项 id 数组（多选）
**And** 成功响应 200、体 = 包装函数返回的订单对外形状（`order_result_json`）**原样**（不加信封、不改字段名）；语义 = 创建成功才返回支付成功
**And** 失败响应非 2xx、体 `{ code, message }`（类别复用 `order_error_code`，业务拒绝 4xx、内部故障 5xx）、失败响应带 `x-request-id`；客户端以 HTTP 状态判别成功 / 失败
**And** `pay-order` 是客户端创建订单的唯一入口；不建立支付记录实体与支付状态机；不含任何真实支付渠道代码（为真实微信支付预留单一接缝）

**Given** 无有效会话
**When** 调用支付接口
**Then** 被平台拒绝（401），不产生任何订单

### Story 3.3: verify 脚本调用面改造与端到端证据链

As a 后端作者，
I want 全部 verify 脚本在新权限模型下继续可跑，
So that 「重建 → 登录 → 下单 → 查询」的证据链不断。

**Requirements:** FR-P3-8; AR-P3-3, AR-P3-17

**Acceptance Criteria:**

**Given** 重建后的环境（`supabase/scripts/rebuild.sh` + 边缘函数 serve）
**When** 运行 8 个 verify 脚本
**Then** 全部可跑通过：9 处 `create_order` 调用已改造，优先改走 `pay-order`（保持端到端语义：登录 → 支付建单 → 查询）
**And** 确需直呼内核的脚本改用 `service_role` + 包装函数，并在脚本头部注明语义变化
**And** 脚本内不出现客户端身份可用的直呼建单路径；失败时输出可定位到具体步骤

### Story 3.4: 幂等键生命周期（结算意图）

As a 网络不稳的用户，
I want 超时重试、杀进程重进都不会多出一单，
So that 我不用担心重复下单。

**Requirements:** FR-P3-9; AR-P3-15

**Acceptance Criteria:**

**Given** 进入确认订单页
**When** 无持久化意图、或与当前购物车 + 就餐方式的规范化序列化不一致
**Then** 生成并持久化幂等键（`weorder_checkout_intent`，唯一出口 `api/orders.ts`）；一致则复用
**And** 购物车内容或就餐方式变化 → 作废重建

**Given** 一次下单请求的结局
**When** 决定幂等键的清除 / 保留
**Then** 下单成功、服务端类别（`order_error_code` 全部，含 `not_authenticated`）、`42501`、`session_expired` → 清除；`timeout` / `network_unreachable` / `request_cancelled`（结果不明）→ 保留，重试不换键
**And** 键必填、与用户绑定（服务端唯一域 `(user_id, idempotency_key)`）；键经对接层 / 支付接口原样转发
**And** 生成 / 校验 / 序列化的纯函数在 `utils/` 并进单元测试清单

### Story 3.5: 客户端下单对接（支付 → 创建订单）

As a 已登录用户，
I want 在结算页点一次就把订单下到服务端，
So that 订单号、取杯号与金额都真实来自服务端。

**Requirements:** FR-P3-8; AR-P3-15, AR-P3-16, AR-P3-20

**Acceptance Criteria:**

**Given** 购物车有商品、已选就餐方式与备注
**When** 点「支付」
**Then** 经 `api/orders.ts` 调用 `pay-order`（经对接层携带会话与幂等键），过程保留 Phase 1 的 loading 与成功反馈
**And** 成功 → 清空购物车、重置备注与就餐方式、跳转订单列表（订单列表的真实读取在 Epic 4 切换，本 story 不改变其现有行为）；订单金额展示以服务端返回为准
**And** 请求体只含 `items` / `dining_mode` / `notes` / `idempotency_key`；客户端提交不含任何金额字段
**And** `CartItem[] → CreateOrderItem[]` 只在 `api/cart.ts` 的 `toCreateOrderItems()` 实现，结算与「再来一单」共用；禁止展开购物车条目直传
**And** 购物车存储读写经 `api/cart.ts`（`weorder_cart`），页面 / Composable 不直接调用 `uni.getStorageSync` / `setStorageSync`
**And** 空购物车结算由场景 Composable 以 toast 阻断并保留可重试（P1 AD-7 承接）

### Story 3.6: 支付失败恢复与可行动提示

As a 用户，
I want 支付失败时知道发生了什么、还能安全重试，
So that 我不丢购物车、也不会以为下成功了却没单。

**Requirements:** FR-P3-9, FR-P3-18(支付段), FR-P3-19; AR-P3-20

**Acceptance Criteria:**

**Given** 支付接口失败（网络 / 超时 / 业务拒绝 / 鉴权失效）
**When** 返回结算页
**Then** 按类别给出可区分、可行动的文案（业务原因至少区分售罄、规格失效、商品不可售、权限）；停留可重试界面
**And** 下单失败保留购物车，内容与失败前一致；不产生「已显示支付成功但没有订单」的不可恢复状态；重试复用同一幂等键、不产生重复订单
**And** 支付超时：基础文案 + 结算页内联「可安全重试，不会重复下单」（幂等键保留）
**And** 提交按钮进入 loading + 禁用、失败后恢复可点；同一失败只提示一次
**And** 失败路径结束后无脏状态：本地无第二条订单、购物车不丢、备注与就餐方式保留

## Epic 4: 一单到底：订单进度与失败可控(列表 · 详情 · 轮询 · 催单 · 取杯)

下单后看到「制作中」，催单加速 →「待取餐」→ 确认取杯或自动完成；列表三态与分页、详情快照与再来一单；推进在一个轮询周期内可见且状态应用单调；空态不做无意义轮询；关键失败不留脏状态(不丢购物车、不重复单、不改本地状态)；手动验证矩阵覆盖演示主路径与失败场景。

### Story 4.1: 订单列表（三态 · 读时推进 · 分页 · 空态）

As a 已下单用户，
I want 看到我的订单按「制作中 / 待取餐 / 已完成」分组展示，
So that 我知道哪杯可以去拿了。

**Requirements:** FR-P3-10; AR-P3-7, AR-P3-18, AR-P3-20

**Acceptance Criteria:**

**Given** 已登录且有订单
**When** 进入订单可见域 / 手动刷新
**Then** 经服务端读取路径（`get_my_orders`，读时推进）返回本人订单，三态分组、分页默认 20 条；展示订单号、状态、取杯号、商品摘要、金额、时间（格式来自服务端）
**And** 读取失败（未登录 / 会话失效）先触发续期或重登：成功则继续展示本人订单；失败则显示失败态与重试入口，不展示任何订单数据（含本地缓存）、不以空列表伪装
**And** 客户端不直接读表（REST 裸表仅作纵深防御）；不传用户标识、归属不可伪造
**And** `order.id`（服务端 UUID）用于 RPC / 订阅 / 列表 key，`order_number` 用于展示；`order-card`、`use-orders.goToOrderDetail` 同步修正
**And** 全新身份空订单态：「还没有订单」+「去点餐」引导；空态不发起重复读取
**And** 不再读本地 `weorder_orders`、不再 seed Mock 订单

### Story 4.2: 订单详情与「再来一单」

As a 用户，
I want 打开某一单看到完整快照并把同款加回购物车，
So that 我能核对商品与金额、快速再点一次。

**Requirements:** FR-P3-11; AR-P3-15, AR-P3-18, AR-P3-19, AR-P3-20

**Acceptance Criteria:**

**Given** 本人订单
**When** 打开详情
**Then** 展示服务端快照（商品与规格摘要、金额、门店名称 / 地址 / 电话、取杯号、订单号、下单时间、就餐方式、备注），字段与生成类型一致；快照不受商品改名 / 改价影响
**And** 取杯号在「制作中」即展示（付款后即出号）
**And** 读取失败 / 不可见订单给出明确的失败态与重试入口（类别文案，不泄露订单存在性），不展示缓存数据

**Given** 详情页点「再来一单」
**When** 还原购物车
**Then** 替换当前购物车、返回首页、自动展开结算面板；按服务端快照还原规格选择；计价按当前目录价（快照价仅历史展示）；wire 转换复用 `toCreateOrderItems()`
**And** 快照中已下架 / 规格失效的行丢弃，并以 toast 提示「部分商品已失效」（不阻断其余条目）；该行为属验证矩阵 #9 的复验项（矩阵由 Epic 4 收口 story 落定）

**Given** 列表与详情均已切换到真实读取
**When** 收口存量清理
**Then** 旧订单实现（`api/orders.ts` 中的 Mock 读写路径）与 `mock/orders.ts` 删除；全仓搜索不再存在 Mock 数据源引用与并存开关（FR-P3-3 整体收口）
**And** 既有 UI 对取杯号的「待取餐才有」旧假设同步修正（制作中即展示）

### Story 4.3: 刷新编排与状态应用单调（轮询）

As a 用户，
I want 订单进度到点就自动出现在页面上，
So that 我从不手动刷新、也不会看到状态倒退。

**Requirements:** FR-P3-12; AR-P3-11, AR-P3-12

**Acceptance Criteria:**

**Given** 订单视图可见（订单列表 tab 或详情页）
**When** 推进时刻到点（含催单后提前的时刻）
**Then** 页面在 ≤ 一个轮询周期 + 1 秒内自动更新（轮询间隔 5s）
**And** 进入可见域 / 切回 tab / `onShow` 立即读一次并重置轮询计时；页面隐藏 / 离开可见域停止轮询；同一时刻同一视图最多一个计时器、不产生请求堆积
**And** 本编排以「订阅健康 → 不轮询」为最终形态留出接入点（`setActive` 与刷新状态机）；订阅未启用时轮询为唯一刷新路径

**Given** 读取结果
**When** 应用状态
**Then** 状态应用单调：`utils/order-status.ts` 纯函数负责排序、合并与序号判定——只接受 `seq` 更大的结果（`seq` 由编排 Composable 铸造、比较范围按订单 id；`api/` 与 `core/` 不持有序号），旧响应不覆盖新状态；任何来源不接受状态倒退（`cooking < pickup < completed`，`completed` 为终态）；重复应用同一状态幂等
**And** 列表合并只增不删（已知 id 更新、未知 id 插入、陈旧读取只合并不删除）；整表替换只由首屏读取 / 显式刷新 / 分页重置决定；状态按页实例持有、页间不共享
**And** 纯函数进单元测试清单

**Given** 轮询失败
**When** 连续失败
**Then** 静默重试 3 次；仍失败则停止轮询、降级为手动刷新入口（保留已有数据）；首屏无数据的失败 → 页面失败态；失败不叠加、不产生请求堆积

### Story 4.4: 催单

As a 等餐用户，
I want 点一下催单让出餐更快，
So that 我能表达「我这单着急」，而不是干等。

**Requirements:** FR-P3-13; AR-P3-21

**Acceptance Criteria:**

**Given** 本人「制作中」的订单
**When** 点催单
**Then** 调用服务端催单（`urge_order` RPC），界面即时反馈（toast「已通知门店加快制作」）；催单后 ≤ 一个轮询周期 + 3 秒内可见「待取餐」（演示参数）
**And** 重复催单幂等：不会更早、不会延后、不报错；提交中按钮 loading + 禁用、防重复
**And** 非「制作中」状态的订单不出现催单入口；被拒时提示明确（类别文案）
**And** 催单失败不改变本地展示的状态

**Given** 演示参数
**When** 调整扫描周期
**Then** cron 扫描周期以迁移**同名替换**为 3s（`order-sweep` 唯一，不得留下第二个扫描任务）；门店行参数（推进 15s / 催单提前 3s / 自动完成 30s）对新建单与新催单立即生效、已出单时刻不变；客户端不参与任何时间判定

### Story 4.5: 确认取杯与自动完成

As a 取到餐的用户，
I want 点确认取杯把订单完成，忘记点也会自动完成，
So that 订单列表反映真实进度，而不是一直挂在「待取餐」。

**Requirements:** FR-P3-14; AR-P3-20, AR-P3-21

**Acceptance Criteria:**

**Given** 本人「待取餐」的订单
**When** 点确认取杯
**Then** 立即进入「已完成」并 toast「取杯成功」+ 状态即时更新；重复确认幂等（不报错、不改完成时间）；按钮 loading + 禁用防重复
**And** 确认失败不改变本地展示的状态，并给出类别提示

**Given** 「待取餐」后不做任何操作
**When** 门店等待时长（演示参数约 30s）到点
**Then** 服务端自动完成，页面在一个轮询周期内感知；已完成订单归「已完成」分组、详情可再次打开
**And** 自动完成感知与手动确认共用状态应用路径（单调、不倒退）

### Story 4.6: 错误提示收口与失败不脏状态

As a 演示者，
I want 演示路径上的每个失败都有可区分提示且不留脏状态，
So that 面试官看到的是设计过的兜底，而不是事故现场。

**Requirements:** FR-P3-18(收口), FR-P3-19(收口); AR-P3-10, AR-P3-20

**Acceptance Criteria:**

**Given** 全部错误类别（登录 / 订单 / 客户端）
**When** 触发对应失败
**Then** 文案由 `utils/error-copy.ts` 唯一函数产出（同时消费服务端与客户端两类）；域内穷尽，新增类别编译报错；未知类别以 `unknown` 兜底、不白屏
**And** 页面级加载失败（目录 / 订单列表 / 订单详情）→ 页面内失败态：文案 + 「重试」；操作级失败（下单 / 催单 / 确认取杯）→ toast（`icon: 'none'`）+ 界面停留可重试
**And** 订单页加载失败不展示任何订单数据（含本地缓存）、不以空列表伪装；空态显示引导且停止轮询（订阅接入后同受同一启停控制，见 Epic 5）
**And** 订阅失败对用户静默、不产生数据库类别；其它新增失败类别先在客户端侧记录（`unknown` 为加法型入库类别）
**And** 登录失败不产生半登录；建单失败不丢购物车、不产生重复订单；催单 / 确认取杯失败不改变本地展示状态；任一步失败后用户都能找到明确的下一步（重试 / 返回）
**And** 提示不含内部堆栈、数据库细节、密钥或 OpenID；演示路径不依赖任何「特判后门」或假数据兜底

### Story 4.7: 演示主路径预演与手动验证矩阵（M1 收口）

As a 演示者，
I want 一次预演走完 UJ-P3-1 并留下验证记录，
So that 「演示一次通过」不是口头承诺。

**Requirements:** FR-P3-10 ~ FR-P3-14, FR-P3-18, FR-P3-19(验收); AR-P3-22, AR-P3-23; UJ-P3-1

**Acceptance Criteria:**

**Given** 本地演示栈（迁移 + seed + 边缘函数 serve）与开发者工具 / 真机调试模式
**When** 按剧本完整预演
**Then** 静默登录 → 目录 → 加购 → 支付建单 → 催单 → 待取餐 → 确认取杯 / 自动完成 → 已完成 → 详情全程走通，全程真实数据、无人工补救（用户在 UI 上点重试不算补救）——SM-1
**And** 手动验证矩阵（场景 / 前置 / 步骤 / 期望 / 实际 / 证据 / 结论）至少覆盖：#1 演示主路径（含催单时效边界）、#2 登录失败与重试、#3 续期单飞与主动续期、#4 杀进程后重试、#7 数据库测试基线、#8 存量清理后的空启动、#9 界面无回归（含 AD-4 四项专项）、#10 会话承载可替换、#11 业务拒绝可区分、#13 自动完成
**And** 每行有实际结果与证据（截图 / 录屏 / 命令输出）；未通过项如实记录并给出处置
**And** 演示参数调整方式与还原方式记录在案；演示预检清单（addendum §F）逐项可执行；备用证据（录屏 / 截图）就绪
**And** 订阅相关行（#5 / #6 / #12）由 Epic 5 补充；本 story 结论作为 SM-3 的证据

## Epic 5: 状态自己找上门：Realtime 订阅自适配(挑战项 · 可降级)

真机上用 `uni.connectSocket` + realtime-js transport 扩展点订阅本人订单变化，替代轮询；订阅不可用自动回退、用户无感；publication + RLS 证明不泄露他人数据；**超 1 天未跑通即降级纯轮询，不阻塞交付**。

### Story 5.1: Realtime 协议客户端与传输适配（`core/realtime`）

As a 开发者，
I want 在小程序运行时能建立 Realtime 连接并订阅本人订单变化，
So that 状态变化可以自己找上门，而不是靠我反复去问。

**Requirements:** FR-P3-15; AR-P3-13

**Acceptance Criteria:**

**Given** 小程序运行时（真机）
**When** 建立订阅
**Then** `core/realtime` 以 `uni.connectSocket` 注入 `WebSocketLike` 适配器，单独使用 `@supabase/realtime-js` 的 transport 扩展点（不引 `supabase-js` 与社区适配库）；构造前提供最小 `URL` 垫片（只需 `protocol` / `pathname` / `href` 读写）
**And** 入口形状 `subscribe({ scope: 'list' | 'order', orderId? }) → { unsubscribe(), onStatus(cb) }`；连接状态经回调上浮、不上抛异常；订阅 / 退订幂等；同一视图只允许一个活跃 channel（列表与详情互斥）
**And** 只订阅 `orders` 的 `INSERT` / `UPDATE`（列表 filter `user_id=eq.<本人 id>`、详情 filter `id=eq.<订单 id>`）；不订阅 `DELETE`（RLS 过滤不适用）与 `order_items`；filter 不构成归属判定，RLS 是唯一裁决
**And** 本人 id 由 `core/session` 提供、经 `api/` 传入 `core/realtime`；`api/` 的订阅入口是无状态工厂（不持模块级 channel）；`core/realtime` 只做协议、连接、退避与生命周期
**And** 断线自动重连（退避 + 重试上限，不产生重连风暴）；订阅失败、回退与恢复对用户静默；开发期以固定前缀日志输出连接 / 退订 / 回退 / 恢复
**And** **真机冒烟为 PoC 第一验证点**（开发者工具运行在 NW.js、会掩盖 `URL` 问题）

### Story 5.2: 订阅接入与回退（刷新策略）

As a 用户，
I want 状态变化自己推到我面前、推不到也感觉不到，
So that 我从不手动刷新、也从不看报错。

**Requirements:** FR-P3-15, FR-P3-16; AR-P3-12, AR-P3-13

**Acceptance Criteria:**

**Given** 订阅健康（channel `SUBSCRIBED`）
**When** 服务端推进一次状态
**Then** 推送只作触发信号：合并去重后立即触发一次对应读取，与轮询共享同一状态应用路径（单调、不倒退）；**订阅健康时不轮询**
**And** 由非 `SUBSCRIBED` 进入 `SUBSCRIBED`（含首次建立）时**先补读一次再停止轮询**（补断线窗口内未重放的变化）

**Given** 订阅不可用（连接中 / 断开 / 重连中）
**When** 需要刷新
**Then** 自动回退 5s 轮询，功能与 FR-P3-12 完全一致；订阅建立失败、被拒绝或中途断开时，≤ 2 个轮询周期内恢复更新；页面行为不降级、无报错打扰用户
**And** 订阅仅在有有效会话时建立；会话未就绪时入口等待（不阻塞页面）、就绪或重登成功后自动补订、期间回退轮询；续期 / 主动续期成功后同步凭证（`setAuth`）
**And** 不设统一开关（验证纯轮询行为时临时调整代码）；离开可见域 / 页面隐藏 → 退订 + 停轮询
**And** 同一视图单活跃 channel，订阅状态供 AD-8 刷新策略判定（通过 `onStatus` 回调上浮）；不得出现双倍刷新或旧结果回写

### Story 5.3: publication 配置与 RLS 隔离验证

As a 作品集作者，
I want 订阅有数据可收、且绝不泄露他人数据，
So that 「换个人就收不到」是可验证的事实，而不是推测。

**Requirements:** FR-P3-17; AR-P3-3, AR-P3-14

**Acceptance Criteria:**

**Given** 迁移
**When** 应用
**Then** `public.orders` 加入 `supabase_realtime` publication（**只加这一张表**）；publication 只决定「什么能进日志流」、不构成授权放开
**And** `orders` 的本人 SELECT 策略仍是订阅前置；现有 REST / RPC 行为不受影响；类型契约向后兼容（加法型）

**Given** 两个身份客户端（A 订阅、B 产生订单变更）
**When** B 建单 / 推进
**Then** A 收不到任何 `INSERT` / `UPDATE` 事件（含列级数据）——以人工验证记录为证据（验证矩阵 #6）
**And** 现有 pgTAP 基线保持可运行且通过；订阅是 P2 AD-5 的显式例外（RLS 过滤的变更事件，非行读取）

### Story 5.4: 真机 PoC 冒烟与止损判定

As a 演示者，
I want 在真机上亲眼看到一次订阅驱动的更新，并在超预算时果断降级，
So that 挑战项不挤占核心联调，也不阻塞演示。

**Requirements:** FR-P3-15, FR-P3-16(验收); AR-P3-22, AR-P3-23; UJ-P3-2

**Acceptance Criteria:**

**Given** 真机（开发版 / 调试模式，局域网可达）与订阅启用
**When** 服务端推进一次状态（订单详情页保持可见、不动手）
**Then** 可观察到一次订阅驱动的页面更新（无需手动刷新；日志 / 录屏为证据）——SM-5
**And** 阻断 socket / 停 Realtime：自动回退 5s 轮询；恢复 `SUBSCRIBED` 时先补读一次再停轮询，断线窗口内变化不丢失（验证矩阵 #5）；订阅断开到回退生效的空窗 ≤ 2 个轮询周期
**And** 归属隔离（#6）与订阅驱动更新（#12）记录进手动验证矩阵；回退与恢复过程在开发期可观察、不面向用户暴露

**Given** 时间盒（1 天）
**When** PoC 超时或演示前未跑通
**Then** 停用 `core/realtime`（纯轮询），Epic 1 ~ Epic 4 的行为完整不受影响；降级结论如实记录（止损线：PoC 超 1 天或演示前未跑通即不再投入）
**And** 验证「纯轮询」：临时调整代码后，全部刷新行为与 FR-P3-12 一致
