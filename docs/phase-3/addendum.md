# we-order Phase 3 — Addendum

*本文件承接不属于 PRD 主体的下游素材：技术选型、机制/传输决策、调研记录。PRD 引用结论，不重复细节。*

## A. 小程序端访问 Supabase 的技术约束（调研 2026-09）

- **事实**：官方 supabase-js 只支持「原生 fetch + WebSocket」环境；小程序两者皆无，不能直接使用。
- **官方留的口子**：`global.fetch` 注入、`realtime.transport` 注入（realtime-js ≥ 2.15.1 / supabase-js ≥ 2.55.0 正式化）、`auth.storage` 定制；接入后仍需自补 `AbortController` / `Headers` / `localStorage` / `navigator.locks` 等 polyfill。
- **社区适配器**（可信但维护停滞，只作参考实现，不宜直接依赖）：
  - `supabase-wechat/supabase-js`：fork 自 supabase-js v2.46.1，2024-11 后停更；提供 wx polyfill 与 `WxRealtimeTransport`（wx.connectSocket 实现的 realtime transport）。
  - `MemFire-Cloud/supabase-wechat-stable-v2`：v2.2.0（2024-05），基于旧版 supabase-js；有中文教程跑通 REST。

## B. 请求层选型候选（未决，留待架构阶段）

共同点：最终都调用 `uni.request`，域名白名单约束相同；**重试逻辑各家均需自写**。

| 方案 | 现状 | 优势 | 坑 |
| --- | --- | --- | --- |
| luch-request | v4.0.0（2026-08），v3 长期稳定 | TS-first、零依赖、abort/拦截器完善、中文资料多 | v4 或 CLI vite 引用 v3 可能需 `transpileDependencies`；无内置重试 |
| alova + @alova/adapter-uniapp | 适配器 2.0.18（2026-07），官方维护 | 缓存、请求共享、useRequest、上传下载、mock | 概念重、体积大、社区小；Vue3 下需配合 `onLoad` |
| axios + @uni-helper/axios-adapter | 适配器随 axios 版本更新 | axios 生态与拦截器心智成熟 | AbortController 需 polyfill；无 FormData/Blob；旧适配器 `axios-miniprogram-adapter` 已停滞 |
| @uni-helper/uni-network | 0.x（0.24.1，2026-08） | axios 0.27 风格、TS 友好 | 社区小、0.x，不建议长期项目依赖 |
| 纯 uni.request 自封装 | — | 零依赖、完全可控 | 拦截、错误归一、取消、重试全部自建 |

*调研推测（非决策）*：本项目的收益点主要在**拦截器与请求取消**，luch-request 或轻量自封装是较省力路线；若看重缓存/hooks 再考虑 alova。

## C. Supabase Realtime 自适配可行性（调研 2026-09）

- **协议公开且清晰**：
  - 连接：`wss://<ref>.supabase.co/realtime/v1/websocket?apikey=…&vsn=2.0.0`
  - v2 消息为 JSON 数组：`[join_ref, ref, topic, event, payload]`
  - `phx_join` 携带 config + `access_token`；心跳 topic 为 `phoenix`，间隔 ≤ 25s；token 刷新经 `access_token` 事件；需处理 `phx_reply` / `error` / `close` 与退避重连。
- **省力路线**：用 `uni.connectSocket` 包装一个 WebSocketLike 交给 realtime-js 的 `transport` 注入，而不是手写 Phoenix 客户端（微信同时最多 5 条 socket）。
- 口径注：是否允许单独使用 `@supabase/realtime-js` 的 transport 扩展点（视为「不引入 supabase-js」的显式例外），见 PRD §6 与开放问题 6；本文件不预判。
- **现成案例**：除 A 节两个停更 fork 外，未检索到成熟的 uni-app × Supabase Realtime 开源适配。
- **可行性判断：中**；PoC 粗估 1–2 周（推测）。主要风险：
  1. 正式版 socket 域名必须已 ICP 备案；`supabase.co` 无备案 → 生产需自定义域名 + 境内反代或自托管；
  2. polyfill / 重连 / token 刷新需自维护；
  3. 社区适配器全部停更，无长期依赖可借。
- **演示路径**：开发者工具勾选「不校验合法域名」、真机调试模式（开发版/体验版）可绕过白名单；**正式版不可**。与 Phase 2「演示用开发版+调试模式绕备案」假设一致。

## D. PostgREST / RPC 调用要点

- 每个请求必带 `apikey: <anon/publishable>`；用户态再加 `Authorization: Bearer <用户 JWT>`，PostgREST 按 JWT role 切换 anon/authenticated，RLS 生效。**secret / service_role 绝不进小程序**。
- 新式 `sb_publishable_` / `sb_secret_` key 不能放 `Authorization`（只能放 `apikey`）；旧 anon JWT 两处皆可。
- JWT 过期返回 `PGRST301`，直连 REST 需自做 refresh（`/auth/v1/token?grant_type=refresh_token`）。
- RLS 拒绝常表现为 **200 + 空数组**，排查优先看策略。
- RPC：`POST /rest/v1/rpc/<fn>`；需 `GRANT EXECUTE`；默认 SECURITY INVOKER（按调用者 RLS）；缺权限报 `42501`；写入回传需 `Prefer: return=representation`。

## E. Phase 3 已定路线与实施顺序（对话记录）

- **实施顺序**（关闭 Phase 2 PRD §12 的开放问题「对接顺序」）：请求对接层 → 静默登录 → 目录 → 下单 → 订单查询。理由：对接层是其余四项的前置；登录是受保护请求的前置；目录先于下单（下单依赖目录数据）；订单查询最后（需要真实订单产生）。
- **旧代码处置**：Phase 2 遗留的 `api/` 实现整体删除、随对接层重新设计；会话状态从 `api/` 内迁出（恢复 P1 AD-1），承载位置由 Phase 3 架构决定。
- **Realtime 路线**：自适配优先（公开协议 + 官方实时传输扩展点走 `uni.connectSocket`，可行性调研见 §C）；轮询为保底；不纳入演示验收。启用订阅时需补 publication 配置与 RLS 兼容性验证。
- **支付路线**（ly 裁定，2026-09-24）：用边缘函数承载**支付接口**，一次完成「支付 → 创建订单」；本阶段支付为模拟实现，流程编排与支付渠道分离，后续接入真实微信支付只需替换支付环节。订单创建复用既有服务端路径（不产生第二套创建逻辑）。
- **请求库选型**：§B 候选（luch-request / alova / axios+适配器 / uni-network / 自封装）留待架构阶段拍板；PRD 不锁定实现。
- **演示验收定义**（ly）：完整下单流程 → 催单推进 → 已完成 → 查看已完成订单；最险段落 = 支付后创建订单。
- **范围裁定**（ly，2026-09-24）：全局错误拦截与提示、编译期类型保护收进 Phase 3；Mock 数据全清空；购物车继续纯本地；不做端到端自动化测试与 CI/CD（以手动真机覆盖为证据）；备案与正式发布延后至 Phase 4 之后。
- **登录时机裁定**（ly，2026-09-25）：启动即静默登录，不采用惰性登录；架构阶段需显式修订 P2 AD-14 的惰性条款。
- **支付接口身份传递**：客户端唯一入口与权限收紧的具体手段（转发调用者会话 / 服务端密钥 + 会话声明注入等）见 PRD 开放问题 5。
- **演示环境**：本地 Supabase 栈、Phase 4 前不上云；预检与剧本见 §F。

## F. 演示剧本与预检清单（给演示当天的自己）

**演示前预检（逐项确认）**

- [ ] 本地 Supabase 栈已启动，迁移与 seed 已应用；边缘函数（登录、支付接口）已 serve。
- [ ] 主机 IP 已确认；真机与电脑在同一局域网且可访问；做过一次真机 → 读目录的最小冒烟（含 `uni.request` 对局域网 http 的验证）。
- [ ] 开发者工具已勾选「不校验合法域名…」；真机开发版已打开调试模式。
- [ ] 演示参数已按剧本调整（如临时调长推进时长以保证催单窗口），并记下还原方式。
- [ ] 历史订单/购物车已清空或归档，确认列表不混入旧单。
- [ ] 备用证据就绪（录屏/截图），以防本地栈或网络临时不可用。

**演示剧本（建议节奏与话术要点）**

1. 冷启动 → 静默登录无感完成（话术：没有登录界面，身份已经建立）。
2. 浏览目录 → 选规格加购 → 结算（话术：数据来自数据库；结算金额是本地展示口径，下单以服务端重算为准）。
3. 支付接口（模拟）→ 订单创建成功：读出订单号与取杯号（话术：金额由服务端重算，取杯号下单即分配）。
4. 订单列表：制作中 → 立即点催单（演示参数下窗口有限）→ 待取餐（话术：状态由服务端推进，催单只是把推进时刻提前）。
5. 确认取杯 → 已完成 → 切到已完成列表查看详情。
6. （可选加分）换身份/清会话重新登录 → 列表读不到刚才那单（话术：归属来自会话与数据访问策略）。
7. （挑战展示，可选）详情页停留观察订阅驱动的更新，或口述回退轮询的兜底设计。

**止损**：Realtime 挑战若超过 1 天（Ly 裁定，与 AI 协同）或演示前未跑通，直接降级为纯轮询，不再投入。

## G. Phase 2 客户端可观察验收 → Phase 3 FR 映射（摘）

| Phase 2 验收（客户端可观察） | Phase 3 承接 |
|------|------|
| FR-P2-1 ~ FR-P2-5 登录链路与会话（含失败分类文案） | FR-P3-4、FR-P3-5、FR-P3-18 |
| FR-P2-6 ~ FR-P2-8 目录/图片/门店读取（含缺图不阻塞） | FR-P3-7 |
| FR-P2-9 ~ FR-P2-13 下单、金额重算、订单号、取杯号、状态推进、催单、自动完成 | FR-P3-8、FR-P3-9、FR-P3-13、FR-P3-14 |
| FR-P2-14 ~ FR-P2-15 订单查询与详情（未登录拒绝语义、快照） | FR-P3-10、FR-P3-11 |
| FR-P2-17 类型契约的客户端一侧 | FR-P3-1、FR-P3-2 |
| FR-P2-16/18/19 工程与安全基线（服务器侧为主） | 本阶段承接：类型同步（FR-P3-2）、密钥边界（FR-P3-1/6）、pgTAP 保持跑绿（FR-P3-17） |

（完整逐条核对见 `reconcile-phase2.md` 与 `reconcile-phase1.md`。）

## 调研来源（检索于 2026-09）

- luch-request v4（npm / 文档）
- [@alova/adapter-uniapp](https://github.com/alovajs/adapter-uniapp)
- [@uni-helper/axios-adapter](https://github.com/uni-helper/axios-adapter)
- [@uni-helper/uni-network](https://www.npmjs.com/package/@uni-helper/uni-network)
- [supabase-wechat/supabase-js fork](https://github.com/supabase-wechat/supabase-js)
- [MemFire supabase-wechat-stable-v2](https://github.com/MemFire-Cloud/supabase-wechat-stable-v2)（[中文教程](https://juejin.cn/post/7452524370558517248)）
- [Supabase Realtime 协议](https://supabase.com/docs/guides/realtime/protocol)
- [realtime-js transport 变更](https://supabase.com/changelog/37869-change-in-realtime-js-affecting-node-js-22)
- [supabase discussion #30361](https://github.com/orgs/supabase/discussions/30361)
- [微信小程序域名校验](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/domain.html)
- [PostgREST Auth](https://docs.postgrest.org/en/v13/references/auth.html)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
