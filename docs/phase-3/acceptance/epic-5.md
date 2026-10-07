# Phase 3 验收记录 — Epic 5：状态自己找上门（Realtime 订阅自适配）

- 说明：按 Story 追加记录（场景 / 证据 / 结论）；轻量验收口径沿用 2026-10-06 Ly 裁定（本人实操确认、自审自负责，截图 / 录屏不入档）。
- 本 Epic 为挑战项（M2，可降级）：任意时点可整块停用 `core/realtime`，Epic 1 ~ Epic 4 行为完整不受影响；止损线见 `docs/phase-3/epics.md` Epic 5 / AR-P3-23。

## Story 5.1 Realtime 协议客户端与传输适配（`core/realtime`）

- 日期：2026-10-06
- 环境：mp 侧 `pnpm test`（vitest 3.2.7）/ `pnpm type-check`（vue-tsc 3.3.6）/ `pnpm lint` / `pnpm build:mp-weixin`；本地 Supabase 栈（WSL，迁移 + seed 已应用，`supabase_realtime` 容器运行中）；协议层预演用 Node 24 原生 WebSocket + `@supabase/realtime-js@2.117.1` 直连本地栈。
- 范围：只使用 `@supabase/realtime-js` 的 transport 扩展点（不引 `supabase-js` 与社区适配库）；`uni.connectSocket` → `WebSocketLike` 适配器；宿主缺失 / 不可构造 `URL` 时的最小垫片（构造点临时替换、用完还原）；订阅编排（单活跃、幂等、会话等待与凭证同步、退避 + 上限、静默）；`api/orders.ts` 订阅入口与订单列表 / 详情的被动接线（只连接与日志，不改刷新策略）。
- 决策记录（Ly，本轮开工前）：① 路线 = realtime-js transport 扩展点（1A）；② 5.1 接线 = 页面被动接线（2A）；③ 重连上限 = 连续 5 次失败后放弃（3A）；④ publication 前置 = 5.1 本地临时应用、正式入仓归 5.3（4A）。

### 交付物

| 类别 | 内容 |
| --- | --- |
| 修改（依赖） | `mp/package.json` / `pnpm-lock.yaml`：`@supabase/realtime-js@2.117.1`（唯一 SDK 例外）；`@supabase/phoenix@0.4.5`（显式直依赖——uni 构建链固定 `preserveSymlinks: true`，pnpm 隔离布局下 realtime-js 的传递依赖无法被 Rollup 解析，版本与其要求一致、pnpm 去重为单实例） |
| 新增（客户端） | `mp/src/core/realtime/`：`index.ts`（出口）、`url-shim.ts`、`socket-adapter.ts`、`client.ts`、`subscription.ts`、`types.ts`、`log.ts`、`README.md`；`mp/src/types/realtime.ts`（订阅契约） |
| 修改（客户端） | `api/orders.ts`（`subscribeOrders()` 无状态工厂）；`pages/home/composables/use-orders.ts` / `sub-order-detail/composables/use-order-detail.ts`（被动接线）；`core/transport/index.ts`（补导出 `supabasePublishableKey`，唯一读取点仍是 `config.ts`） |
| 新增（测试） | `core/realtime/url-shim.test.ts` / `socket-adapter.test.ts` / `subscription.test.ts`（28 项）；`api/orders.test.ts` 增加订阅入口用例与所需 mock 导出；5 个既有测试文件的 `@/api/orders` mock 补 `subscribeOrders` |
| 新增（依赖补丁） | `mp/patches/@supabase__realtime-js@2.117.1.patch`（+ `pnpm-workspace.yaml` 的 `patchedDependencies`）：库内 `httpEndpointURL` 的 `new URL` 改为内联解析——宿主拒绝改写 `URL`、垫片无效（第一轮冒烟发现，见下节），补丁为实际修复 |
| 未改动 | 后端全部（迁移 / 函数 / 类型 / 脚本）——publication 与 RLS 隔离验证属 Story 5.3 |

### 关键实现点

- **连接地址**：`supabaseUrl()` 的 http(s) 换成 ws(s) 后拼 `/realtime/v1`；`/websocket?apikey=…&vsn=2.0.0` 由库自行拼接。
- **URL 兼容**：库内 `httpEndpointURL` 在客户端 / channel 两处构造时执行且使用 `new URL`；微信宿主既不提供可构造的 `URL`、也拒绝改写全局（第一轮冒烟实测）→ 以 **pnpm patch** 把该函数改为内联解析（**实际修复**）；`withUrlShim()` 垫片保留为构造点兼容层（在可改写 `URL` 的宿主生效，如 Node / H5）。
- **适配器**：SocketTask 回调映射为 WebSocket 事件属性；自行维护 `readyState`（phoenix 关闭等待会轮询）；建连阶段 error 后 200ms 无真实 close 则补发一次 close，保证上层一定进入重连逻辑；`send` / `close` 透传且 close 幂等。
- **凭证与身份**：token 在 `phx_join` 载荷（不需要 `btoa` / 子协议）；`accessToken` 回调（连接 + 心跳取最新）+ 会话变更时 `setAuth`（续期即时同步）双保险；本人 id 由 `api/` 经 `resolveUserId`（`core/session.getUserId`）传入，`core/realtime` 不发明身份。
- **订阅编排**：模块级单客户端 + 单活跃 channel；同键 `openChannel` 幂等复用、异键替换；退订幂等；`onStatus` 注册时立即回调当前状态、之后只在转移时回调（`connecting | subscribed | unavailable`，供 5.2 判定）。
- **重连与上限**：断线由库退避重连（1/2/5/10s，之后每 10s）；连续失败 5 次（约 28s 无一次成功）→ 放弃、状态 `unavailable`、断开客户端，下次进入可见域重新订阅；看门狗 20s 处理「无 open 也无 close」的挂起。订阅失败对用户静默、不产出错误类别；日志固定前缀 `[realtime]`（不含凭证与 uid）。
- **订阅范围**：只订 `orders` 的 `INSERT` / `UPDATE`；列表 `user_id=eq.<本人 id>`、详情 `id=eq.<订单 id>`；不订 `DELETE`（RLS 过滤不适用）与 `order_items`；filter 不构成归属判定，RLS 是唯一裁决。

### 验收点与证据

| Story 5.1 验收点 | 结论 / 证据 |
| --- | --- |
| `uni.connectSocket` 适配器 + 只用 realtime-js transport 扩展点；构造点 URL 兼容（垫片 + 依赖补丁） | 代码落点 + `pnpm build:mp-weixin` Build complete；适配器 / 垫片单测通过；**工具与真机复测通过**（PoC 第一验证点；修复过程见下节） |
| 入口形状 `subscribe → { unsubscribe, onStatus }`；状态经回调上浮、不抛异常；订阅 / 退订幂等；同一视图单活跃 | `subscription.test.ts`（建立与状态上浮、同键复用、异键替换、退订幂等）；`api/orders.test.ts` 断言入口形状与缺 id 的静态 unavailable |
| 只订 `orders` INSERT / UPDATE；列表 / 详情 filter 正确；不订 DELETE / order_items | `api/orders.test.ts` 断言两条绑定与 filter；协议层预演（Node 直连本地栈）INSERT / UPDATE 均到达 |
| 本人 id 来源 `core/session`、经 `api/` 传入；`api/` 无状态工厂；`core/realtime` 只做协议、连接、退避与生命周期 | `api/orders.ts` 以 `resolveUserId: getUserId` 传入；`api/orders.test.ts` 断言；`core/realtime` 无模块级 channel / 业务状态 |
| 断线自动重连（退避 + 上限）；订阅失败 / 回退 / 恢复静默；固定前缀日志 | `subscription.test.ts`（失败累计达上限放弃、socket open 清零、看门狗重建与取消）；`log.ts` 固定前缀 |
| 真机冒烟（PoC 第一验证点） | **通过**（2026-10-06 Ly 实操确认）：开发者工具与真机均完成「连接 → 订阅 → 事件到达 → 断线自动重连恢复」，与 ① / ③ 清单一致；第一轮 `URL` 问题修复过程见下节 |

### 验证命令与输出（由演示者本人执行，输出不入档）

```bash
cd mp
pnpm test            # 20 文件 / 226 项全过（含 realtime 新增 32 项：垫片 / 适配器 / 编排 / 日志脱敏）
pnpm type-check      # 0 错误
pnpm lint            # 0 错误
pnpm build:mp-weixin # Build complete（产物约 1.2M；realtime 与 phoenix 打包进 common/vendor.js）
```

### 手动冒烟第一轮（2026-10-06，开发者工具）

- **现象**：进入订单 tab 后日志停在 `[realtime] subscription requested orders:list`，无 `socket open`；控制台报 `TypeError: URL is not a constructor`（`at httpEndpointURL`，MiniProgramError 包装）。
- **根因（两轮定位）**：① 宿主 `URL` **存在但不是构造函数**（并非「缺失」），旧垫片只按「undefined 才安装」判定而跳过；且 realtime-js 在 **channel 构造**（`broadcastEndpointURL`）也会 `new URL`，只包客户端构造不足以覆盖；② 改为构造点 `withUrlShim()` 临时替换后复测仍失败——**微信宿主拒绝改写 `URL`**（工具实测），替换不生效。
- **修复（最终）**：以 **pnpm patch** 把库内 `httpEndpointURL` 的 `new URL` 改为内联解析（语义与原实现一致，已用 Node 对照验证；该函数只服务 broadcast 端点，但我们会在客户端 / channel 构造时执行到）；`withUrlShim()` 垫片保留为构造点兼容层。另：`attachChannel` 增加异常兜底（不再产生未处理异常：计失败 + 看门狗重试 + 达上限降级 `unavailable`，轮询兜底不受影响）；新增 / 更新单测（坏 URL 宿主可构造、attach 抛错不外抛且达上限降级）。
- **产物核对**：`pnpm build:mp-weixin` 与 dev 构建产物中 `httpEndpointURL` 已是内联解析（不再 `new URL`）；剩余 `new URL` 仅在 broadcast 发送路径（本模块不使用）。
- **状态**：已复测通过（见下节「复测结果」）。

### 协议层预演（真机适配器之前的关键中间验证；2026-10-06）

- **方法**：Node 24 原生 WebSocket + `realtime-js` 直连本地栈（不经过小程序适配器），用 `JWT_SECRET` 现场签发本人用户 JWT，覆盖三种组合：用户 token + filter、用户 token 无 filter、service token 无 filter；分别验证 INSERT 与 UPDATE 事件到达；事件通过 `PATCH /rest/v1/orders`（service 角色）触发。
- **结果：全部 PASS**——`SUBSCRIBED` 正常达成；INSERT / UPDATE 事件均被收到（含列表 `user_id=eq.<uid>` 与详情 `id=eq.<order>` 两种 filter）；说明 join 载荷、token 传法、publication、RLS、filter 形状与协议版本均正确。
- **运维发现（进 5.3 / 演示预检）**：publication 变更后，**运行中的 realtime 容器不会自动拾取**——预演首次订阅后事件不达，重启 `supabase_realtime` 容器后恢复。5.3 的迁移/预检需注明：应用 publication 迁移后重启 realtime（或整体 `supabase stop && start`）。
- **`replica identity` 结论**：实测 `default` 即可（我们只订 INSERT / UPDATE 且推送只作触发器、不读 `payload.old`）；`full` 非必需，未保留该改动。
- **数据清理**：预演创建的测试订单（10 条）已全部删除；`orders` 的 publication 成员关系与本地栈原状保留。

### 复测结果（2026-10-06，Ly 实操确认，开发者工具 + 真机）

| # | 场景 | 结果 | 观察（日志要点） |
| --- | --- | --- | --- |
| ① | 开发者工具冒烟 | 通过 | `subscription requested` → `socket open` → `channel subscribed orders:list` → `event UPDATE`（3 次）；工具与真机表现一致 |
| ② | 真机冒烟（PoC 第一验证点） | 通过 | 与工具完全一致：连接 / 订阅 / 事件到达；URL 兼容修复在真机同样生效 |
| ③ | 断线恢复 | 通过 | 重启 `supabase_realtime` 后 `transport close` → `socket closed; failure 1/5 … 4/5` → `socket open` → `phx_join` → `channel subscribed`：上限内自愈、无重连风暴、无用户打扰；期间页面轮询照旧 |
| ④ | 未在本轮覆盖 | 留待 | 切 tab 的退订 / 重订日志（随 Story 5.2 接入刷新策略时复验）；订阅驱动页面刷新与回退策略（5.2）；两级身份 RLS 隔离（5.3）；时间盒止损判定（5.4） |

### 手动验证清单（演示者执行；2026-10-06 复测通过）

> 宿主 `URL` 在工具与真机可能是不同坏形态（实测工具为「存在但不可构造」），两处都要冒烟；
> 本清单保留为复现步骤（复测结论见上节）。

1. **开发者工具**：`cd mp && pnpm dev:mp-weixin` → 开发者工具导入 `dist/dev/mp-weixin` → 勾选「不校验合法域名」→ 清缓存重启 → 进订单 tab。
   期望日志：`[realtime] socket open` → `[realtime] channel subscribed orders:list`；下一单 / 催单 / 推进时 `[realtime] event INSERT|UPDATE`；切走 tab `[realtime] unsubscribed`，切回重新订阅。
2. **真机（PoC 第一验证点）**：开发版 + 调试模式（同局域网，`mp/.env.local` 指向可访问地址）→ 重复第 1 步观察点。
   关注：若真机上出现连接失败 / 长时间 `connecting`→`unavailable`，而工具模拟器正常，优先怀疑 URL 兼容（垫片 / 补丁）与网络路径，保存日志现象反馈。
3. **断线恢复**：`docker restart supabase_realtime_we-order`（或断网）→ 期望 `[realtime] socket closed`、重连尝试 → 恢复后重新 `subscribed`；期间订单页轮询照旧、界面无报错无提示。
4. 结果由 Ly 本人实操确认后回填本记录（轻量验收口径）。

### 有意偏差与遗留

1. **被动接线**：5.1 在可见域建立 / 退订订阅并打日志，**不改变刷新策略**（轮询照旧）；「健康 → 停轮询、推送 → 读取、回退」由 Story 5.2 在同一接入点接入。
2. **publication**：本地栈 `orders` 已在 `supabase_realtime` publication（无迁移文件，属既有手工状态）；正式迁移与 RLS 隔离验证（两身份 A 订阅 / B 变更）归 Story 5.3；预演发现的「重启 realtime」操作需写进 5.3 与演示预检。
3. **真机冒烟与止损**：Story 5.1 的真机冒烟属 PoC 第一验证点，与 Story 5.4 的完整 PoC（订阅驱动更新、回退恢复、时间盒判定）区分；超 1 天未跑通即降级纯轮询（`core/realtime` 不启用）。
4. **`@supabase/phoenix` 直依赖**：为 uni 构建链 `preserveSymlinks` 与 pnpm 隔离布局的兼容所需，版本锁 0.4.5（与 realtime-js 要求一致）；移除会重新出现 Rollup 解析失败。
5. **`@supabase/realtime-js` 依赖补丁（有意偏差）**：spine 的原始路线是「transport 扩展点 + URL 垫片」；实测微信宿主拒绝改写 `URL`（工具与真机形态可能不同），垫片在该宿主无效，故追加 pnpm patch 移除库内 `new URL` 调用。补丁只改 `httpEndpointURL`（行为与 WHATWG 版对照验证一致）；**升级该依赖时必须重做 / 验证补丁**，`pnpm install` 会自动应用（`patchedDependencies` 已登记）。
6. **协议层预演脚本**：一次性工具（Node 直连），不入仓；复现步骤已记于本记录。
7. **日志脱敏（复测后无损加固）**：库的 transport 日志会携带 `apikey` 查询参数（发布密钥属公开值），复测后在输出前统一脱敏为 `apikey=***`（`log.ts` 的 `redactLogMessage` + 单测）；行为不变，随 Story 5.2 的回归一并复验 → **已于 Story 5.2 复测确认（`apikey=***`，无回归）**。

## Story 5.2 订阅接入与回退（刷新策略）

- 日期：2026-10-07
- 环境：mp 侧 `pnpm test`（vitest 3.2.7）/ `pnpm type-check`（vue-tsc 3.3.6）/ `pnpm lint` / `pnpm build:mp-weixin`；手动冒烟在本地 Supabase 栈 + 开发者工具 / 真机（清单与复测结果见下节）。
- 范围：订阅状态 → 刷新策略接入——`subscribed` → 先补读一次再停轮询、等待推送；其余状态回退 5s 轮询；推送（`onEvent`）只作触发信号触发一次读取；**读后定订阅**（有未完成订单才订阅；空态 / 全完成 / 未读到数据不订阅；恢复内容自动补订；离开可见域退订）；不设统一开关。**不含** publication 正式入仓与 RLS 隔离验证（Story 5.3）与真机完整 PoC（Story 5.4）。
- 决策记录（Ly，开工前逐项拍板）：① 推送信号线 = `subscribeOrders` 选项 `onEvent`（加法型扩展，句柄形状不变）；② 状态翻译唯一落点 = `useOrderStatus.bindSubscription`；③ 补读失败 = 静默照常停轮询（自愈路径：下一次推送 / 进页面 / 手动刷新）；④ 订阅生命周期 = 读后定订阅；⑤ 连发推送 = 靠既有「在飞读取合并」；⑥ 离开订单 tab / 页面隐藏即退订（不采用「首页常开」——socket 本身常驻，退订只是 channel 级 join/leave；常开会在不可见视图上产生后台读取或无效订阅）。

### 交付物

| 类别 | 内容 |
| --- | --- |
| 修改（客户端） | `api/orders.ts`（`onEvent` 选项 → `core/realtime` 的 `spec.onEvent`）；`composables/use-order-status.ts`（新增 `bindSubscription`：subscribed → 补读 + 停轮询，其余 → 回退轮询；返回解绑函数）；`pages/home/composables/use-orders.ts` 与 `sub-order-detail/composables/use-order-detail.ts`（读后定订阅：`worthSubscribing` / open / close / sync + `onEvent` 推送触发）；`types/realtime.ts`（句柄契约备注）；`core/realtime/README.md`（用法与 5.2 接线说明） |
| 修改（测试） | `use-order-status.test.ts`（+7）；`api/orders.test.ts`（+1）；`use-orders.test.ts`（+6）；`use-order-detail.test.ts`（+6），合计 20 项 |
| 未改动 | `core/realtime` 运行时编排、会话 / 对接层、后端全部 |

### 关键实现点

- **读后定订阅**：订阅建立 / 拆除都由读取结果驱动——`worthSubscribing()`（列表：存在未完成订单；详情：已读到且未完成）满足才开、不满足即关；从未读到数据（失败 / 加载中）不订阅，轮询重试成功后补订。
- **补读再停**：`bindSubscription` 是唯一翻译点；进入 `subscribed`（含首次建立、重连恢复、注册即 subscribed 的复用句柄）→ 先 `startRead('auto')` 补读（auto 语义，填上订阅生效前未重放的变化），再 `setSubscriptionHealthy(true)` 停轮询；补读在在飞读取时合并（不并发）。
- **回退**：任何非 `subscribed` 状态（连接中 / 断开 / 重连中 / 会话未就绪 / 放弃重连）→ `setSubscriptionHealthy(false)` → 5s 轮询；断开到回退生效 ≤ 1 个轮询周期。
- **推送触发**：`onEvent` 只作触发信号（不携带行数据）→ `runAutoRead()`（合并 / 静默 / 保游标），与轮询共享序号门与状态单调（AD-7）；连发推送靠「同一时刻最多一个在飞读取」合并。
- **不设开关**：无任何订阅开 / 关配置或 Mock 回退；订阅不可用是唯一回退条件。

### 验收点与证据（自动验证部分）

| Story 5.2 验收点 | 结论 / 证据 |
| --- | --- |
| 订阅健康：推送只作触发、共享同一应用路径、不轮询 | 单测：subscribed 后 15s 无轮询、推送 +1 次读取、在飞时合并；序号门 / 状态单调用例保持通过 |
| 非 `SUBSCRIBED` → `SUBSCRIBED`（含首次）先补读再停 | 单测：emit subscribed / 注册即 subscribed → 立即补读一次且此后不轮询 |
| 订阅不可用 → 回退 5s、≤ 2 个周期恢复、无报错打扰 | 单测：unavailable / connecting → 5s 轮询恢复更新；无 toast；订阅失败不产错误类别（5.1 既有） |
| 仅有效会话建立、等待、补订、续期同步 | 5.1 既有（core/realtime 单测：会话等待 / 补订 / setAuth）；5.2 只消费状态（unavailable → 回退），手测第 3 条复核 |
| 不设开关；离开可见域退订 + 停轮询 | 单测：leave → unsubscribe + 停表；代码无开关 |
| 单活跃 channel；无双倍刷新 / 旧结果回写 | core/realtime 单活跃（5.1 既有）+ 健康 → 不轮询（单测）+ 序号门（既有单测） |
| 空态 / 全完成退订（spine「空态停止轮询与订阅」） | 单测：空态 / 全完成不建立订阅、恢复内容自动补订 |
| 推送不产生用户可见失败 | 单测无 toast；订阅失败静默由 5.1 既有覆盖 |

### 验证命令与输出（由演示者本人执行，输出不入档）

```bash
cd mp
pnpm test            # 21 文件 / 246 项全过（含 Story 5.2 新增 20 项）
pnpm type-check      # 0 错误
pnpm lint            # 0 错误
pnpm build:mp-weixin # Build complete
```

### 手动冒烟清单与复测结果（2026-10-07，Ly 实操确认，开发者工具 + 真机）

> 轻量验收口径（沿用 2026-10-06 Ly 裁定）：本人实操确认、自审自负责，截图 / 录屏不入档。
> 前置：本地 Supabase 栈运行中、`orders` 在 `supabase_realtime` publication（5.1 手工状态，5.3 正式入仓）；开发者工具导入 `dist/dev/mp-weixin`（或 `pnpm dev:mp-weixin`）并勾选「不校验合法域名」。
> 观察要点：只刷订单可见域；切到点餐 tab / 页面隐藏后应无任何请求。

1. **健康路径**：进订单 tab（有未完成订单）→ `[realtime] channel subscribed`；订阅补读一次后 Network 面板不再每 5s 出现 `get_my_orders`。
2. **推送驱动**：催单 / 等推进 → `[realtime] event UPDATE` 后立即出现一次 `get_my_orders`，页面无需手动刷新更新。
3. **断线回退与恢复**：`docker restart supabase_realtime_we-order`（或断网）→ `[realtime] socket closed`；5s 轮询恢复；恢复后 `channel subscribed` → 先补读一次 → 轮询停（断线窗口内的推进不丢——Story 5.4 / 矩阵 #5 的预备）。
4. **离开可见域**：切到点餐 tab / 页面隐藏 → `[realtime] unsubscribed`、无请求；切回 → 立即读一次 + `channel subscribed`。
5. **空态与终态**：无未完成订单（空态 / 全部已完成）→ 不建立订阅、不轮询；下单后回到订单 tab → 立即读取并补订（`[realtime] subscription requested`）。

复测结果：**全部通过**（本人实操确认，开发者工具 + 真机，行为与上述期望一致）。

| # | 场景 | 结果 | 观察（日志要点） |
| --- | --- | --- | --- |
| 1 | 健康路径：订阅后不轮询 | 通过 | `channel subscribed` → 补读一次后不再每 5s 轮询 |
| 2 | 推送驱动更新 | 通过 | `event UPDATE` 后立即出现一次 `get_my_orders`，页面自动更新 |
| 3 | 断线回退与恢复 | 通过 | `socket closed` → 5s 轮询恢复；恢复后先补读一次 → 轮询停 |
| 4 | 离开可见域退订 | 通过 | 切走 `unsubscribed`、无请求；切回立即读取 + 订阅 |
| 5 | 空态 / 终态与下单后补订 | 通过 | 空态 / 全完成无订阅、无轮询；下单回来读取后补订 |

5.1 遗留项复验：`[realtime]` 日志脱敏随本轮回归确认无回归——`apikey` 显示为 `***`。

### 有意偏差与遗留

1. **`onEvent` 属加法型扩展**：AD-9 入口形状为 `subscribe({ scope, orderId? })`；本次为入口增加可选 `onEvent`（推送触发信号），句柄形状 `{ unsubscribe, onStatus }` 不变——该口为 Story 5.1 的 `spec.onEvent` 预留、本次接线使用。
2. **空态 / 全完成不建立订阅（读后定订阅）**：空态期间的新单不靠推送发现，由可见域重进 / 下拉刷新读取发现——spine 明确「空态停止轮询与订阅」，属有意行为。
3. **补读失败静默停轮询**（决策 D3）：不停轮询之外的兜底，由下一次推送 / 进页面 / 手动刷新自愈。
4. **真机完整 PoC、订阅驱动更新观察（SM-5）与验证矩阵 #5 / #6 / #12** 留 Story 5.4；publication 迁移与两身份隔离验证留 Story 5.3。
