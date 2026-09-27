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
