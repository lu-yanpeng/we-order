# Phase 3 验收记录 · Epic 3（下单：支付接口说了算）

## Story 3.1 `create_order` 权限收紧与 `create_order_for_user`

- 日期：2026-09-27
- 环境：本地 Supabase 栈（CLI 2.117.0 / Postgres 17）；`supabase db reset` 重建（21 条迁移 + 种子，空订单库）；`supabase test db`；mp 侧 `pnpm type-check`（vue-tsc 3.3.6）
- 范围：后端权限模型（迁移 + pgTAP 调用面改造 + 类型再生 + 文档）；**客户端零改动**；verify 脚本的端到端改造按 epic 分工留给 Story 3.3（本 Story 完成至 3.2 完工前，`deno task verify:*` 中直呼 `create_order` 的脚本预期不可跑，见遗留 #1）
- 裁定记录（Ly）：① verify 脚本过渡期变红接受（Story 3.3 收口）；② 读路径只对 RLS 可见性断言保留 `authenticated` + claim 注入，其余读用 `service_role`；③ `service_role` 对内核的既有执行权不额外收紧、不作断言（按 epic 字面）；④ 重建用 `supabase db reset`（不动 Storage 卷与已有身份数据，不跑全量 `rebuild.sh`）；⑤「注入失败」以两条等价证据落地——内核无注入时 fail-closed（`not_authenticated`）+ 注入后 `auth.uid()` 等于 `p_user_id`

### 交付物

| 类别 | 内容 |
| --- | --- |
| 新增（迁移） | `supabase/migrations/20260927234927_create_order_for_user.sql`：`create_order_for_user` 包装函数（`SECURITY DEFINER`、`set search_path = ''`、`p_user_id` 非空校验、事务局部 `set_config` 注入）、内核与包装函数的 revoke / grant（语句级固定顺序）、两个函数的注释更新 |
| 修改（测试） | `tests/database/80_create_order.test.sql`：实际调用点 42 处改经包装函数；权限断言反转 + 新增（函数属性、静态权限、反向直呼、正向注入与归属、fail-closed）；`plan(93)` → `plan(102)` |
| 修改（测试） | `tests/database/85_idempotency.test.sql`：10 处调用改经包装函数；「B 只看得见自己的单」两段保留客户端身份读取（`authenticated` + claim） |
| 修改（测试） | `tests/database/86_order_invariants.test.sql`：5 处调用改经包装函数（显式 `p_user_id`：c011 / c012） |
| 修改（文档） | `tests/README.md`：80 / 85 / 86 三行覆盖说明与「模拟身份」说明同步新授权模型 |
| 重新生成 | `supabase/types/database.types.ts`：新增 `create_order_for_user` 的函数形状（+10 行，加法型） |
| 未改动 | 客户端全部（`mp/`）；`create_order` 本体签名与逻辑；verify 脚本（Story 3.3）；其余 16 个测试文件 |

### 关键实现点

1. **包装函数只做三件事**：`p_user_id` 为空 → `not_authenticated`；`set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id)::text, true)` 事务局部注入；调用内核并原样返回。不复制任何金额 / 归属 / 写库逻辑（内核签名与逻辑一字未改），不存在第二套写路径。
2. **权限语句固定顺序**：先 `revoke execute … from public, anon, authenticated`，再 `grant execute … to service_role`。必须显式 revoke `public`：Postgres 新建函数默认对 PUBLIC 开放执行权，且本地库 `pg_default_acl` 实测 Supabase 还会自动给 `anon` / `authenticated` / `service_role` 各授一份——只 grant 不 revoke 会遗留客户端入口。
3. **fail-closed 有两层**：包装函数的非空校验；内核自身 `auth.uid()` 为空 → `not_authenticated`（注入不生效时的兜底，表现伪装成会话失效）。反向断言（客户端直呼两函数 → `42501`）与正向断言（建单归属 = `p_user_id`；调用后 `auth.uid()` 生效）共同钉住。
4. **测试改造策略**：写路径一律 `set local role service_role` + 显式用户 UUID（fixture 提供，移除 claim 注入）；只有「验证 RLS 可见性」的断言（85 的 B 段）保留 `authenticated` + claim——否则「B 只看得见自己的单」会被 service_role 的 BYPASSRLS 变成恒真。
5. **`service_role` 对内核的默认授权未动**：`create_order` 的 ACL 为 `{postgres=X, service_role=X}`；epic 明确「对内核不授权、不作断言」，故不额外 revoke、测试不断言。

### 验收点与证据

| Story 3.1 验收点 | 证据 |
| --- | --- |
| 迁移应用后内核从 public / anon / authenticated 收回 EXECUTE；包装函数签名 / 安全属性 / 属主与 `p_user_id` 非空校验成立 | `psql` 实测 ACL：`create_order` 与 `create_order_for_user` 均为 `{postgres=X/postgres,service_role=X/postgres}`；80 的新断言检查 security definer、`search_path=""`、`proargnames = '{p_user_id,p_items,p_dining_mode,p_notes,p_idempotency_key}'`、`proowner` 与内核相同 |
| 授权语句级固定顺序；客户端与 `public` 对两个函数均无 EXECUTE（直呼 → `42501`） | 80 静态权限断言：`public` / `anon` / `authenticated` 对两函数均 false、`service_role` 对包装函数 true；运行断言：`anon` / `authenticated` 直呼两函数均 `42501`（4 条 `throws_ok`） |
| 事务局部注入后调用内核；唯一「声明我是谁」的服务端接缝；不出现第二套金额 / 归属 / 写路径 | 迁移中包装函数仅注入 + 转发；80 断言「包装函数与内核属主相同」；建单归属 = `p_user_id`（86 用两个身份提交同一份含伪造 `user_id` 的请求，各归各的） |
| 注入不生效 fail-closed（`not_authenticated`）；正向断言证明注入到达 `auth.uid()` | 包装函数空 `p_user_id` → `P0001 not_authenticated`；清空注入后直调内核 → `P0001 not_authenticated`；包装函数成功调用后 `select auth.uid()` = `p_user_id`（`is` 断言） |
| `order_error_code` 追加 `unknown` 并重新生成类型；`error-copy.ts` 穷尽检查补齐文案 | 该半句已由 Story 1.2 交付（迁移 `20260926100745`、`utils/error-copy.ts` 的 `order.unknown`「操作失败，请稍后重试」）；本 Story 只再生类型（+`create_order_for_user`） |
| 重建后的空库运行 `supabase test db` 全绿：3 个测试文件全部调用改道（`service_role`、fixture 用户 UUID、移除 claim 注入） | `supabase db reset` + `supabase test db`：**19 文件 / 632 项 PASS**（原 623；80 净增 9 项）。实际调用点 57 处（80: 42、85: 10、86: 5）全部改道；epic 的「62 处」含 5 处权限 / 属性断言里的函数名引用（非调用），见遗留 #2 |
| 静态权限断言反转；新增反向（直呼 `42501`）与正向（归属 = `p_user_id`、注入失败 → `not_authenticated`）断言；三类边界覆盖不减少 | 80 权限段反转 + 新增 5 条、身份段 3 → 6 条、成功路径 +1 条；其余 16 个文件零改动全绿（`60` / `95` / `96` / `97` 的边界断言原样通过） |
| 失败能定位到具体函数 / 策略 | 突变验证：故意从迁移删掉包装函数的 `revoke` 后 `db reset` + `test db`，失败输出逐条点名——`# Failed test 9: "create_order_for_user 只授服务端角色：public / anon / authenticated 均不可执行"`、`# Failed test 15/17: "…直呼包装函数被拒…"`（`caught: no exception / wanted: 42501`）；还原迁移后全绿 |
| 类型契约加法型、客户端不受影响 | `supabase gen types typescript --local` 再次生成逐字节零差异（`diff` 为空）；`cd mp && pnpm type-check` 0 错误 |

### 验证命令与输出（后端侧，可复现）

```bash
cd supabase
supabase db reset && supabase test db     # 21 条迁移 + 种子；Files=19, Tests=632, Result: PASS
supabase gen types typescript --local > types/database.types.ts   # 再生成零差异
cd ../mp && pnpm type-check               # 0 错误
```

HTTP 现场（`supabase status -o env` 取密钥，请求均被拒 / 不落数据）：

```text
anon      -> POST /rest/v1/rpc/create_order             401 {"code":"42501","message":"permission denied for function create_order"}
anon      -> POST /rest/v1/rpc/create_order_for_user    401 {"code":"42501","message":"permission denied for function create_order_for_user"}
service_role -> POST /rest/v1/rpc/create_order          400 {"code":"P0001","message":"not_authenticated"}   # 无身份注入，内核 fail-closed
```

### 有意偏差与遗留

1. **verify 脚本过渡期不可跑**：8 个脚本里 10 处 `create_order` 调用（含 2 处手写 HTTP 并发请求）在权限收紧后拿不到执行权，按 epic 分工由 Story 3.3 改造（优先改走 `pay-order`，确需直呼的用 `service_role` + 包装函数）。客户端不受影响（当前仍是 Mock 下单，Story 3.5 才接 `pay-order`）。
2. **「3 个文件 62 处」的事实校正**：grep 匹配 62 处中含 80 文件里 5 处权限 / 属性断言中的函数名引用（`'public.create_order(jsonb, …)'::regprocedure` 与 `has_function_privilege`），实际调用点 57 处，已全部改道；不影响 AC 语义。
3. **verify 脚本「9 处」的事实校正**：实测 10 处调用（`verify-idempotency` 与 `verify-pickup-codes` 各有 1 处手写 HTTP 并发请求），留给 Story 3.3 按实际清单改造。
4. **`service_role` 对内核保留 EXECUTE**：来自 Supabase 默认权限，按 epic「对内核不授权、不作断言」未额外收紧；若后续要更严可在新迁移 `revoke execute … from service_role`（不影响包装函数路径）。
5. **未跑 `rebuild.sh` 全量重建**（裁定的 ④）：`db reset` 已满足「重建后的空库」；全量重建会在 Story 3.3 / Epic 4 收口时按需执行。

## Story 3.2 支付接口 `pay-order`（边缘函数）

- 日期：2026-09-28
- 环境：本地 Supabase 栈（CLI 2.117.0 / Postgres 17）；`supabase db reset` 重建（21 条迁移 + 种子，空订单库）；`supabase test db`；`deno task test`；`deno task verify:pay-order`（真 HTTP）
- 范围：后端新增边缘函数 `pay-order`（客户端创建订单唯一入口）+ 配置 + 离线测试 + 现场脚本 + 文档；**无迁移、客户端零改动**；既有 verify 脚本调用面改造按 epic 分工留给 Story 3.3

### 交付物

| 类别 | 内容 |
| --- | --- |
| 新增（函数） | `supabase/functions/pay-order/`：`index.ts`（入口接线：服务端密钥客户端 + 失败日志）、`handler.ts`（HTTP：形状校验 / 身份 / 模拟支付 / 错误归一）、`caller.ts`（已验签 JWT 的 `sub` 读取）、`order.ts`（调 `create_order_for_user` 并归一数据库类别）、`README.md`（契约 / 状态码表 / 凭证边界 / 日志 / 本地验证） |
| 修改（配置） | `supabase/config.toml`：新增 `[functions.pay-order] verify_jwt = true` |
| 新增（测试） | `supabase/functions/tests/pay-order/pay-order.test.ts`：14 项 Deno.test（离线，假建单器 + 假 fetch；含 2 项契约解析测试） |
| 新增（脚本） | `supabase/scripts/verify-pay-order.ts` + `deno.json` 的 `verify:pay-order`：真 HTTP 现场验证 30 项断言 |
| 修改（文档） | `supabase/README.md`（函数与 verify 清单）、`supabase/functions/tests/README.md`（测试清单） |
| 未改动 | 数据库（无迁移、类型再生成零差异）；客户端全部（Story 3.4~3.6）；既有 8 个 verify 脚本（Story 3.3） |

### 关键实现点

1. **身份只读声明（`caller.ts`）**：平台先验签（`verify_jwt = true`），函数内只解码 payload 读 `sub`——不重复验签、不请求 auth 服务；要求 `role = authenticated` 且 `sub` 是合法 UUID，任一不成立 → 401 `not_authenticated` 且不触碰数据库（fail-closed）。实测发布密钥也是平台认可的有效 JWT，但没有 `sub`、角色是 `anon`，同样被拒。
2. **请求形状 = FastAPI 式解构 + 校验**（2026-09-28 与 Ly 收敛）：顶层解构 `items / dining_mode / notes / idempotency_key`，条目解构 `product_id / quantity / selections`；其余字段一律忽略且**不转发**（金额 / 用户标识 / camelCase / 展示字段都不参与任何判定）；必填缺失或类型不对 → `invalid_request`，数量非正整数 → `invalid_quantity`；不做类型强转（`"2"` 不收）。camelCase 的「不接受」= 读不到必填值 → 400；混发时以 snake_case 为准。
3. **模拟支付的单一接缝**：`handler.ts` 的 `simulatePayment()` 恒成功，是将来真实微信支付（预下单 / 客户端二次授权 / 服务端回调）的唯一替换点；不建支付记录实体与状态机。
4. **凭证边界（`order.ts`）**：用服务端密钥客户端调 `create_order_for_user`（`apikey` 与 `Authorization` 均 `service_role`）；客户端 JWT 绝不转发；请求体没有用户标识参数（归属由 `p_user_id = sub` 表达）；不跨目录 import（部署只打包函数自身目录）。
5. **错误归一**：`P0001 + message ∈ order_error_code` → 业务类别（日志阶段 `order`）；网络 / 未知 SQLSTATE / 返回形状异常 → 抛错后归 `unknown` + 阶段 `internal`（500）。成功响应也带 `x-request-id`；非 2xx 记一条结构化日志 `{event, requestId, code, status, stage}`，不含堆栈 / 密钥 / 数据库细节。
6. **状态码映射**（业务拒绝 4xx、内部故障 5xx）：`invalid_request` / `invalid_quantity` 400；`invalid_selection` / `product_unavailable` 409；`not_authenticated` 401；`store_unavailable` 503；`order_not_found` 404 与 `invalid_status` / `invalid_transition` 409（本函数不产生，为枚举完备保留）；`unknown` 500。类别集合与映射均为 `Record<OrderErrorCode, …>`：枚举新增取值时编译报错。

### 验收点与证据

| Story 3.2 验收点 | 证据 |
| --- | --- |
| 平台先校验会话；无有效会话 401 且不产生任何订单 | 现场：① 完全无凭证 → 平台 401 `UNAUTHORIZED_NO_AUTH_HEADER`（**无 `x-request-id`，函数未执行**）；② 只有发布密钥 / 把发布密钥当 Bearer → 函数 401 `not_authenticated`（带 `x-request-id`）。三例订单总数不变（脚本断言 + 核对订单表最终 0 行） |
| 用户 id 取自已验签 JWT 的 `sub`；不引入可伪造的用户标识参数 | 单测：anon / 无 sub / 非 UUID / service_role / 畸形 JWT 共 10 例 → 401 且不调建单器；请求体多余 `user_id` 被忽略不转发；现场合法请求落库 `user_id = 会话身份` |
| 用服务端密钥调 `create_order_for_user`；客户端 JWT 绝不转发 | 单测：假 fetch 记录出站请求——`POST /rest/v1/rpc/create_order_for_user`，`apikey` 与 `Authorization` 均为服务端密钥，出站请求体 / URL 不含客户端 JWT |
| 请求不含展示字段与金额字段、不接受 camelCase、`selections` 形状 | 单测：camelCase-only → 400；金额 / 展示字段被忽略且不转发；现场：陷阱字段 `unit_price: 0.01 / total_amount: 0.01 / product_name` 被忽略，订单金额 = 服务端重算（35） |
| 成功 200、体 = `order_result_json` 原样（不加信封、不改字段名） | 单测：成功体与 `order_result_json` 深比较一致、字段无增删；现场 curl：200 响应体即订单形状（见下方 transcript） |
| 失败非 2xx + `{code, message}`，业务拒绝 4xx / 内部故障 5xx，带 `x-request-id` | 单测：10 个类别逐项映射 + 未知 SQLSTATE / 网络失败 → 500 `unknown` + `internal` 日志；现场：camelCase 400、售罄 409、数量 400、规格失效 409、未鉴权 401 均带 `x-request-id` |
| 客户端以 HTTP 状态判别成功 / 失败 | 成功恒 200、失败恒非 2xx（单测 + 现场一致） |
| `pay-order` 是客户端创建订单唯一入口；不建支付记录 / 无真实支付渠道代码 | 建单只经 `create_order_for_user`（直呼两函数 → `42501`，Story 3.1）；函数内无支付表 / 状态机访问，`simulatePayment()` 单点；README 标注 |
| 幂等键原样转发；重试不产生第二张订单 | 单测：`p_idempotency_key` 原样出现在出站请求；现场：同一键重放返回同一 `id`，库里该用户仍只有 1 张 |
| 无迁移、类型契约向后兼容、客户端不受影响 | `supabase gen types typescript --local` 再生成逐字节零差异；`supabase test db` 632 项 PASS；客户端未改动（`mp/` 零 diff） |

### 验证命令与输出（可复现）

```bash
cd supabase
supabase db reset && supabase test db     # 21 条迁移 + 种子；Files=19, Tests=632, Result: PASS
deno task test                            # 34 passed | 0 failed（pay-order 14 + wechat-login 20）
deno task verify:pay-order                # PASS：30 项断言全部通过
supabase gen types typescript --local | diff - types/database.types.ts   # 零差异
```

冷启动复核：`supabase stop` → `supabase start`（让 `config.toml` 的 `[functions.pay-order] verify_jwt = true` 在冷启动下生效）后复跑 `deno task verify:pay-order` 仍 **30 项通过**；核对订单表 0 行残留。

HTTP 现场（`supabase status -o env` 取密钥；函数由 `supabase start` 统一服务）：

```text
# 无任何凭证 → 平台层 401，函数不执行（无 x-request-id）
POST /functions/v1/pay-order  →  401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header","msg":"..."}

# 只有发布密钥（apikey）→ 平台放行，函数 fail-closed（带 x-request-id: 0223b634-…）
POST /functions/v1/pay-order  →  401 {"code":"not_authenticated","message":"Session is missing or invalid"}
```

真会话 + 合法请求（手工 curl，等价 Postman；含金额陷阱字段）：

```text
HTTP/1.1 200 OK
x-request-id: 91a1721d-2996-4d7e-ab54-9ffb11727ec4

{"id":"e02881f5-…","notes":"无备注要求","status":"cooking","created_at":"2026-09-28 17:16:40",
 "dining_mode":"takeout","pickup_code":"A-0002","order_number":"202609281716409298",
 "total_amount":34,"packaging_fee":2}   # 卡布奇诺 32 + 外带包装 2；提交的 unit_price/total_amount 0.01 被忽略
```

失败日志（`docker logs supabase_edge_runtime_we-order`，与响应头 `x-request-id` 可对账）：

```json
{"event":"pay_order_failed","requestId":"…","code":"invalid_request","status":400,"stage":"request"}
{"event":"pay_order_failed","requestId":"…","code":"product_unavailable","status":409,"stage":"order"}
{"event":"pay_order_failed","requestId":"…","code":"invalid_quantity","status":400,"stage":"request"}
{"event":"pay_order_failed","requestId":"…","code":"invalid_selection","status":409,"stage":"order"}
{"event":"pay_order_failed","requestId":"…","code":"not_authenticated","status":401,"stage":"auth"}
```

### 手工验证清单（Postman / curl，演示与回归用）

前置：本地栈在跑、`db reset` 过；想拿真会话可以先用 `verify:pay-order` 的同款方式（service role 建用户 + 密码登录）或真机登录；所有请求都带 `apikey: <发布密钥>`。

| # | 请求 | 期望 |
| --- | --- | --- |
| 1 | 不带 Authorization（带 apikey 与不带各一次） | 401；带 apikey 时是函数返回的 `not_authenticated`（有 `x-request-id`），不带 apikey 时是平台 401（无 `x-request-id`）；两种情况订单表都不新增 |
| 2 | 带真会话，body 用 `diningMode` 代替 `dining_mode` | 400 `invalid_request`（camelCase 不生效） |
| 3 | 带真会话，合法 body + 额外 `total_amount` / `unit_price` | 200；返回 `total_amount` 为服务端重算值，与提交的陷阱值无关 |
| 4 | 同 #3 的 `idempotency_key` 再发一次（可改数量 / 金额） | 200；`id` 与首次相同；库里该用户仍只有一张订单 |
| 5 | 商品 id 换成一个不存在的 UUID（或种子里的售罄商品 `…233`） | 409 `product_unavailable` |
| 6 | `quantity: 0` 或 `"2"` 字符串 | 400 `invalid_quantity` |
| 7 | 带规格组商品（如美式咖啡 `…201`）只传部分规格组 | 409 `invalid_selection`（对应客户端「规格选项已变更，请重新选择」） |

### 有意偏差与遗留

1. **「无有效会话被平台拒绝」的机制校正**：实测只有**完全无凭证**时平台才在函数前 401（无 `x-request-id`）；**带发布密钥（apikey）而不带会话**时平台以该 JWT 放行到函数，由函数 fail-closed 401。两者都「401 且不产生订单」，AC 成立；实现按「函数也必须自己把关」处理。
2. **「不接受 camelCase」的收敛**（2026-09-28 Ly 裁定）：采用 FastAPI 式忽略语义——camelCase 不生效（必填读不到 → 400），混发时以 snake_case 为准；金额 / 用户标识不参与判定也不转发。若将来要「出现未知键即拒绝」，属加法型行为变更，需在契约里单列。
3. **`40_menu_view.test.sql` 与库内订单的相互影响**：该测试 `delete from public.products`，库里有订单明细（`order_items` 外键）时会整文件失败（`Bad plan`）。本次验收先 `supabase db reset` 再跑（与 Story 3.1 同流程，632 项全绿）；非本 Story 引入，但「任何时刻直接跑基线」会受手工下单影响，留作 Phase 4 前的可选改进。
4. **verify 脚本调用面改造仍留给 Story 3.3**：8 个脚本共 10 处 `create_order` 调用；本 Story 新增的 `verify:pay-order` 已覆盖「登录 → 支付建单 → 查询」中的支付段，可作为 3.3 改造参照。
5. **未跑 `rebuild.sh` 全量重建**（同 Story 3.1 裁定）：`db reset` 已满足现场验证；全量重建在 Story 3.3 / Epic 4 收口时按需执行。
6. **未接真实支付渠道**：`simulatePayment()` 替换点在 handler 内；下单成功但客户端断网（结果不明）的端到端文案与幂等键保留属 Story 3.6；订阅 / publication 属 Epic 5。

### 补记（2026-09-28）：请求契约显式化（zod）

- 触发：Ly 评审指出请求形状藏在 `validateDraft` 的分支里，没有一个显式的请求体类型——「不读源码不知道要传什么」，与 FastAPI 的 `class Item(BaseModel)` 相比缺了契约的一等公民（wechat-login 同形，但只有一个字段，另行单独改造提交，不与本 Story 混提）。
- 裁定（Ly）：pay-order 采用 zod（`npm:zod@4`），schema 即类型即校验；新增运行时依赖记入遗留。
- 落地：
  - 新增 `functions/pay-order/contract.ts`：zod schema + `z.infer` 导出的 `PayOrderRequest` / `PayOrderItem` + `parsePayOrderRequest()`；
    未知字段默认剥离（忽略语义不变）；类别映射按「首个失败字段是 quantity → `invalid_quantity`，其余 → `invalid_request`」，不用文案判定；
    `DINING_MODES` 带编译期完备性检查（数据库枚举新增取值时编译报错）。
  - `handler.ts` 删除 `validateDraft`，请求形状只从 `contract.ts` 来；`deps.createOrder` 入参类型变为 `PayOrderRequest`。
  - `order.ts` 在唯一映射处做可选字段规范化（`notes ?? ""`、`selections ?? {}`）；原 `OrderDraft` 类型删除（wire 类型即契约）。
  - `functions/pay-order/README.md` 与 `functions/tests/README.md` 指向 `contract.ts`。
- 证据：`deno task test` **34 项通过**（pay-order 14 项；新增 2 项契约解析测试：未知字段剥离 / 可选字段省略 / selections 值域 / 数量类别映射）；`deno task verify:pay-order` **30 项断言通过**（真 HTTP，热加载后复核）；`deno.lock` 记录 zod 4.6.5。
- 行为差异（唯一一处）：`selections` 的**值类型**在边界即被校验——非字符串 / 字符串数组（如 `{ group: 1 }`）现在得到 `invalid_request`，此前会转发给内核并以 `invalid_selection` 拒绝。类别/状态码/响应形状/凭证边界其余各项与重构前逐项一致。

## Story 3.3 verify 脚本调用面改造与端到端证据链

- 日期：2026-09-28
- 环境：本地 Supabase 栈（CLI 2.117.0 / Postgres 17）；**全量干净重建** `bash scripts/rebuild.sh`（stop --no-backup → start → db reset → test db；21 条迁移 + 种子）；`deno task test`；10 个 verify 脚本真 HTTP 现场
- 范围：8 个 verify 脚本的 **9 处建单调用**统一改经 `pay-order`（客户端创建订单的唯一入口）+ 文档同步 + 端到端证据链；**无迁移、无函数改动、客户端零改动**；`verify:two-identities` 按其前置（真机身份）调整到重建前运行（见有意偏差 #1）

### 交付物

| 类别 | 内容 |
| --- | --- |
| 修改（脚本） | `verify-rebuild.ts` / `verify-two-identities.ts`：新增 `postPayOrder()`（`fetch` POST `/functions/v1/pay-order`，`apikey` + `Bearer` 会话），建单调用改道；响应形状不变，后续断言零改动 |
| 修改（脚本） | `verify-state-machine.ts` / `verify-urge.ts` / `verify-sweep.ts` / `verify-complete.ts`：建单改 `client.functions.invoke("pay-order", { body })` |
| 修改（脚本） | `verify-idempotency.ts`：并发轮改打 `/functions/v1/pay-order`（独立 TCP 连接机制不变）；新增 `warmUpPayOrder()` 预热；顺序重放 / 两身份绑定轮改 `invoke` |
| 修改（脚本） | `verify-pickup-codes.ts`：并发轮改打 `/functions/v1/pay-order` |
| 修改（文档） | `supabase/README.md`（verify 表注明建单统一经 pay-order）、`tests/README.md`（当前脚本描述同步） |
| 未改动 | 数据库（无迁移）；`pay-order` / `create_order` / `create_order_for_user`；客户端全部（`mp/`）；`verify-login.ts` / `verify-pay-order.ts` |

### 关键实现点

1. **9 处调用点清单**：`verify-rebuild`（1）、`verify-two-identities`（1）、`verify-state-machine`（1）、`verify-urge`（1）、`verify-sweep`（1）、`verify-complete`（1）、`verify-idempotency`（2：并发轮手写 HTTP + 顺序轮 RPC）、`verify-pickup-codes`（1：并发轮手写 HTTP）——全部改道，没有脚本需要「service_role + 包装函数」的直呼 fallback。
2. **改动只在「怎么调」**：`pay-order` 成功响应 = 订单对外形状原样（与 `create_order` 返回同形），各脚本的订单断言未改一行；并发脚本保留「每个请求一条独立 TCP 连接」的机制，仅换 URL 与请求体字段名（`p_*` → wire 形状）。
3. **幂等并发的预热**：pay-order 多一跳，冷启动可能把某个并发请求推迟到赢家提交之后、破坏「耗时最短的请求也等到同一事务」的断言；并发批前先打一发无效请求（`items: []` → 400 `invalid_request`，不落库）唤醒函数，实测断言保持。
4. **two-identities 的前置决定顺序**：该脚本要求两个真机登录身份；重建会清除身份与现场订单。按裁定在改完脚本后、重建前先运行取证，再重建跑其余脚本；输出只有 openid 指纹，不含原文。

### 验收点与证据

| Story 3.3 验收点 | 证据 |
| --- | --- |
| 重建后的环境（`rebuild.sh` + 边缘函数 serve）运行 8 个 verify 脚本全部可跑通过；9 处调用已改造、优先走 pay-order（保持端到端语义：登录 → 支付建单 → 查询） | `bash scripts/rebuild.sh` exit 0：21 条迁移 + 种子，`supabase test db` **19 文件 / 632 项 PASS**，桶 `product-images` 与 cron `order-sweep`（15s）随重建回来；8 个脚本全绿——`verify:rebuild` 24 项（订单 202609282258462373，链路 = 匿名读目录/门店 → 登录 → pay-order 建单 → 列表与详情 → 他人不可见）、`verify:two-identities` 15 项、`verify:state-machine` 26 项（类型修复与余量适配后连跑两次全绿）、`verify:idempotency` 16 项、`verify:urge` 12 项、`verify:sweep` 8 项、`verify:pickup-codes` 6 项、`verify:complete` 16 项；另有 `verify:login` 40 项、`verify:pay-order` 30 项 |
| 确需直呼内核的脚本改用 service_role + 包装函数并注明语义变化 | 本 Story 改造后 **9 处全部走 pay-order**，无需直呼 fallback；8 个脚本头部统一注明「建单统一经 pay-order（客户端创建订单的唯一入口）」 |
| 脚本内不出现客户端身份可用的直呼建单路径；失败输出可定位到具体步骤 | `grep` 证据：`rpc("create_order"` 与 `/rest/v1/rpc/create_order` 在 `scripts/` **0 命中**；旁路现场：anon 直呼两函数均 `401 42501`（transcript 见下）；脚本失败即抛 `FAIL: <具体断言标签>` |
| 幂等语义保持：重试不产生第二张订单 | `verify:idempotency` 16 项——5 个并发请求各自独立连接全部成功且返回同一张订单（202609282259058188）、耗时 1724–1986ms（「都等到赢家事务」断言保持）、库里该标识仅 1 张；顺序重放 / 两身份绑定 / 跨用户隔离全过 |
| 类型契约向后兼容 | `supabase gen types typescript --local \| diff - types/database.types.ts` **零差异**；`deno task test` **36 passed / 0 failed** |

### 验证命令与输出（可复现）

```bash
cd supabase
bash scripts/rebuild.sh       # 21 迁移 + 种子；Files=19, Tests=632, Result: PASS
deno task test                # 36 passed | 0 failed
deno task verify:login        # 40 项断言
deno task verify:pay-order    # 30 项断言
deno task verify:rebuild      # 24 项断言（订单 202609282258462373）
deno task verify:idempotency  # 16 项断言（5 并发 · 1724–1986ms）
deno task verify:pickup-codes # 6 项断言（取杯号 A-0005…A-0012）
deno task verify:sweep        # 8 项断言（订单 202609282259306425 在 23.2s 后被兜底推进，A-0013）
deno task verify:urge         # 12 项断言（订单 202609282259545847 催单后 14.1s 被推进，A-0014）
deno task verify:complete     # 16 项断言（订单 202609282300280226 / 202609282300284582）
deno task verify:state-machine # 26 项断言（四轮竞态，A-0018…A-0022）
deno task verify:two-identities --user-a <idA> --user-b <idB>   # 15 项断言（重建前运行）
```

HTTP 现场（重建后）：

```text
anon -> POST /rest/v1/rpc/create_order          401 {"code":"42501","message":"permission denied for function create_order"}
anon -> POST /rest/v1/rpc/create_order_for_user 401 {"code":"42501","message":"permission denied for function create_order_for_user"}
重建后核对：orders=0 identities=0 users=0；bucket product-images=1；cron order-sweep=15s；migrations=21
```

### 有意偏差与遗留

1. **two-identities 在重建前运行**（顺序调整，非缺陷）：其前置是两个真机登录身份，重建会清除它们；按裁定先运行取证（15 项全绿，订单 202609282251069215 / A-0014），再重建跑其余脚本。真机身份与验证订单随重建清除，演示前需重新登录。
2. **重建后 pay-order 首调 504（冷启动观测）**：首次 `verify:pay-order` 在「只有发布密钥被拒」步骤拿到 HTTP 504（Kong → 边缘运行时的首次调用）；手动预热一发后复跑 **30 项全绿**。属本地栈冷启动现象、非改造引入（Story 3.2 的冷启动复核发生在已有调用之后）。幂等脚本已内置预热；其余脚本是否需要预热留待演示前预检观察。
3. **演示图片与 `image_path` 随全量重建清除**（Epic 2 手动项 #7 的现场布置）：属全量重建的已知代价（Story 3.1 裁定④的延期项在本次兑现），演示前按 addendum §F 预检重新上传并设置。
4. **「9 处 vs 10 处」事实校正**：Story 3.1 遗留写「实测 10 处」，静态调用点实为 9 处（7 处 RPC + 2 处手写 HTTP 并发请求），本 Story 已全部改造并同步脚本头注释。
5. **`verify-state-machine.ts` 的两条既有类型错误已顺带修复**（评审裁定：不遗留）：`update` 的补丁类型改用生成类型 `Database["public"]["Tables"]["stores"]["Update"]`，闭包里改用捕获的 `storeId` 常量（不依赖外层 narrowing 穿透函数体）；`deno check scripts/*.ts` 现全部 0 错误。纯类型层改动，无运行时行为变化。
6. **`verify-state-machine.ts` 的时序余量适配 pay-order 一跳**：三处「到点 + 60/80ms 就发并发批」的余量放宽到 +300ms（覆盖边缘函数一跳与客户端/数据库毫秒级时钟差），并发兜底轮改为等两张单都到点再发批。放宽前重跑曾出现两次间歇失败（第 1 轮 `ready_at` 一致性、第 4 轮一张单未到点）；适配后**连跑两次 26 项全绿**。属验证脚本对新链路的适配，不涉及产品行为。
7. **客户端零改动**：客户端下单接入（`api/orders.ts` → pay-order + 幂等键）属 Story 3.4 / 3.5，本 Story 只收口验证脚本与证据链。

## Story 3.4 幂等键生命周期（结算意图）

- 日期：2026-09-29
- 环境：mp 侧 `pnpm test`（vitest 3.2.7）、`pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`；**后端零改动**（服务端唯一域与 `pay-order` 转发沿用 Story 3.1 / 3.2 / 3.3 证据）
- 范围：客户端结算意图模块（纯函数 + `api/orders.ts` 存储出口 + 确认订单页提交接线）；生成时机按 2026-09-29 设计修订改为「点击支付、请求发出前 ensure」，PRD / spine / epics 已同步回写
- 裁定记录（Ly）：① 不引 crypto 依赖——键不是凭证（服务端唯一域带 `user_id`），只需同一用户内不撞车；小程序无 Web Crypto，crypto-js 4.x 在无原生 crypto 时不可用、3.x 为弱随机；② 幂等键生成时机改为「提交时 ensure」——浏览 / 反复修改购物车不产生写入，「变化即作废重建」由提交时指纹比较自然满足（改回原样且指纹一致仍复用原键）；③ 唯一转换器 `toCreateOrderItems()` 提前到本 Story 落地（指纹必须基于实际发送的 wire 形状）；④ 失败保留 / 清除只做纯函数 + 单测，catch 分支消费随 Story 3.5 / 3.6；⑤ 验收记录随实现交付

### 交付物

| 类别 | 内容 |
| --- | --- |
| 新增（客户端） | `src/utils/checkout-intent.ts`：纯函数——`generateIdempotencyKey()`（`co_` + 时间戳 + 两段随机）、`serializeCheckoutIntent()`（规范化指纹）、`parseCheckoutIntent()`（存储值校验，坏数据 → null）、`resolveCheckoutIntent()`（复用 / 重建）、`shouldClearCheckoutIntent()`（清除 / 保留）；不碰存储、不碰 uni API |
| 新增（测试） | `src/utils/checkout-intent.test.ts`（13 项） |
| 修改（客户端） | `src/api/cart.ts`：新增唯一转换器 `toCreateOrderItems()`（`CartItem[] → CreateOrderItem[]`；只保留 wire 三字段，结算与「再来一单」共用） |
| 新增（测试） | `src/api/cart.test.ts`（3 项） |
| 修改（客户端） | `src/api/orders.ts`：`weorder_checkout_intent` 唯一出口——`ensureCheckoutIntent(items, diningMode)`（同步先落盘、返回本次请求要带的键）、`clearCheckoutIntent()`；读 / 写 / 删均吞存储异常 |
| 新增（测试） | `src/api/orders.test.ts`（6 项） |
| 修改（客户端） | `src/sub-order-confirm/composables/use-order-confirm.ts`：`startPay` 提交前 ensure（先落盘、再进入支付流程）、成功建单后 clear；进入页面 / 切换就餐方式不触碰意图 |
| 修改（文档） | PRD FR-P3-9 + 修订记录；spine AD-10 时机表 + 修订记录；epics FR-P3-9 / AR-P3-15 / Story 3.4 验收口径（2026-09-29 设计修订） |
| 未改动 | 后端全部（迁移 / 函数 / 脚本）；订单读取的 Mock 实现（Epic 4 移除）；`pay-order` 请求体构造与失败分支消费（Story 3.5 / 3.6） |

### 关键实现点

1. **存储形状与指纹**：`{ key, fingerprint }`；指纹 = `{ v: 1, dining_mode, items }` 的规范化序列化，`items` 只含 `product_id` / `quantity` / `selections`，行 / 规格组 key / 多选数组排序后序列化——顺序无关、展示字段与金额、备注不参与。
2. **生命周期**：提交前 `ensureCheckoutIntent`（同步先落盘、再发请求）；指纹一致 → 复用；无 / 不一致 / 坏数据 → 生成新键并覆盖；成功 → 清除。正确性的三个不变量：发送前已持久化、每次提交做指纹比较、成功或明确失败才清除。
3. **清除 / 保留决策**（`shouldClearCheckoutIntent`）：order 域全部类别（含 `not_authenticated`；`42501` 已归一为 `order.unknown`）或 `client.session_expired` → 清除；`timeout` / `network_unreachable` / `request_cancelled` → 保留；登录域 / 未知客户端类别兜底保留。
4. **键生成不引依赖**：`co_` + 时间戳(base36) + 两段 `Math.random`（约 80 bit 熵）。极端碰撞的后果只是「本次结算被当成上一次」（同用户域内），无安全影响；若将来需要平台级随机，用 `wx.getRandomValues`（异步、基础库 2.15.0+）即可，仍无需依赖。
5. **指纹与实际请求同源**：`ensureCheckoutIntent` 基于 `toCreateOrderItems()` 的输出算指纹——指纹的字段集合与 Story 3.5 将要发送的请求体天然一致，不会漂移。
6. **坏数据不卡死**：`parseCheckoutIntent` 校验失败 / JSON 损坏 / 存储异常一律按「无意图」重建；`setStorageSync` / `removeStorageSync` 异常不阻断支付。

### 验收点与证据

| Story 3.4 验收点 | 证据 |
| --- | --- |
| 提交时无持久化意图 / 指纹不一致 → 生成并持久化；一致 → 复用 | `orders.test.ts` 6 项：首次提交生成并落盘、同购物车再次提交复用同键、购物车变化重建、就餐方式变化重建、坏数据重建并覆盖、成功清除后再提交生成新键；存储不可用时不抛错且仍返回可发送的键 |
| 进入确认订单页只浏览不写入；购物车 / 就餐方式变化由提交时指纹比较自然重建 | 代码证据：`use-order-confirm.ts` 只在 `startPay` 内调用 ensure / clear（页面挂载、`selectDiningMode` 均不触碰）；`grep -rn "weorder_checkout_intent" src/`：读写只在 `api/orders.ts`（另有 `api/storage.ts` 的启动清理清单）；页面 / Composable 无直呼存储 |
| 指纹规范化：排序无关、关键字段敏感 | `checkout-intent.test.ts`：行顺序 / 规格组顺序 / 多选顺序不影响指纹；数量 / 商品 / 规格 / 就餐方式变化指纹不同；空购物车指纹稳定 |
| 清除 / 保留按类别（含 42501 与 not_authenticated） | `shouldClearCheckoutIntent` 单测：`ORDER_ERROR_CODES` 枚举穷尽 → true（含 `not_authenticated`、`42501` 归一后的 `unknown`）；`session_expired` → true；`timeout` / `network_unreachable` / `request_cancelled` → false；登录域 / 未知客户端类别 → false（兜底保留） |
| 键必填、与用户绑定（服务端唯一域 `(user_id, idempotency_key)`） | 服务端证据沿用 Story 3.2 / 3.3：`pay-order` 原样转发 `idempotency_key`；`verify:idempotency` 16 项（同键并发 / 重放只落一张、跨用户隔离）；客户端侧「每次请求必带键」的唯一入口是提交时 ensure 的返回值 |
| 唯一转换器只允许在 `api/cart.ts` | `cart.test.ts` 3 项：只保留 wire 字段、空数组、`selections` 不共享引用；`grep -rn "toCreateOrderItems" src/`：实现唯一 |
| 生成 / 校验 / 序列化纯函数在 `utils/` 并进单元测试清单 | `utils/checkout-intent.test.ts` 13 项 + `api/cart.test.ts` 3 项 + `api/orders.test.ts` 6 项 = 新增 22 项；既有 62 项不回归 |
| 文档同步修订 | PRD FR-P3-9 + 修订记录、spine AD-10 + 修订记录、epics FR-P3-9 / AR-P3-15 / Story 3.4 验收口径（均为 2026-09-29 设计修订） |

### 验证命令与输出（可复现）

```bash
cd mp
pnpm test             # 8 文件 / 84 项全过（新增 3 文件 22 项；既有 5 文件 62 项不回归）
pnpm type-check       # 0 错误
pnpm lint             # 0 错误（eslint --fix --cache 后零改动）
pnpm build:mp-weixin  # Build complete.（产物含 utils/checkout-intent.js；weorder_checkout_intent 只出现在 api/orders.js 与 api/storage.js）
```

```text
✓ src/utils/checkout-intent.test.ts (13 tests)
✓ src/api/cart.test.ts (3 tests)
✓ src/api/orders.test.ts (6 tests)
✓ src/core/transport/normalize.test.ts (18 tests)
✓ src/core/session/session.test.ts (16 tests)
✓ src/core/transport/transport.test.ts (14 tests)
✓ src/utils/error-copy.test.ts (8 tests)
✓ src/api/storage.test.ts (6 tests)

Test Files  8 passed (8)
     Tests  84 passed (84)
```

### 手动验证清单（演示者执行）

前置：开发者工具打开本项目（本地栈 / Mock 支付流程即可，无需后端）；Storage 面板可编辑。3.4 阶段支付为 mock（恒成功），超时 / 杀进程 / 失败保留属 Story 3.5 / 3.6（矩阵 #4）。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | 加购商品 → 进入确认订单页（**不点支付**）→ 查看 Storage | 不存在 `weorder_checkout_intent`（浏览不写入） | 待执行 |
| 2 | 点「立即支付」→ 支付弹层出现时查看 Storage | 出现 `{ key, fingerprint }`，`key` 形如 `co_...` | 待执行 |
| 3 | 等待支付成功展示（1.5s）→ 再查看 Storage | `weorder_checkout_intent` 已被清除 | 待执行 |

### 有意偏差与遗留

1. **生成时机的设计修订已回写**（非偏差）：原 AC「进入确认订单页生成」改为「提交时 ensure」，理由与不变量见上方裁定记录；文档三处 + 修订记录已同步。
2. **失败分支消费在 Story 3.5 / 3.6**：决策函数（保留 / 清除）本 Story 已交付并单测；`pay-order` 接通后由 3.5 / 3.6 在 catch 分支调用，超时重试与杀进程复验（矩阵 #4）届时取证。
3. **手动 Storage 面板三项待演示者执行**：见上表；执行后补结果列。
4. **`createOrder`（本地 Mock 建单）仍被调用**：真实 `pay-order` 调用与请求体构造属 Story 3.5；本 Story 已按最终语义在「成功建单后清除意图」处接线。
5. **随机源取舍记录**：键生成用时间戳 + 两段 `Math.random`；不引 crypto 依赖的理由见裁定记录 ①。若未来演示需要展示「平台级随机」，改为 `wx.getRandomValues` 不改变本模块接口（`ensureCheckoutIntent` 目前同步；改异步属加法型演进，需在彼时评估）。
