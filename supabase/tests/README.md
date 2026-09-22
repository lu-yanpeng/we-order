# supabase/tests

数据库测试（pgTAP）。一条命令跑全部：`supabase test db`（本地栈需已启动）。边缘函数的测试不在这里，见 `functions/tests/`。

| 文件 | 覆盖 |
| --- | --- |
| `database/00_smoke.test.sql` | pgTAP 可运行、`public` schema 存在 |
| `database/10_catalog.test.sql` | 目录 5 表：RLS 已启用、未认证可读、未认证与已登录都不可写 |
| `database/20_stores.test.sql` | 门店：RLS 已启用、未认证可读、客户端不可写 |
| `database/30_storage.test.sql` | 图片桶：公开桶、`storage.objects` 零策略、未认证读不到对象、客户端不可写 |
| `database/40_menu_view.test.sql` | `menu` 视图：过滤（下架 / 售罄 / 空分类）、排序、嵌套形状、字段名 |
| `database/50_wechat_identities.test.sql` | 身份映射：RLS 启用且零策略、客户端完全不可达、列集合只有 openid/user_id/时间戳、openid 唯一、user_id 唯一、外键与级联、枚举含 `identity_failed` 与 `session_failed`、`record_wechat_login` 与 `find_user_by_email` 的权限/安全属性/幂等与查询行为 |
| `database/60_orders.test.sql` | 订单结构与写路径封闭：两张表 RLS 启用且只有一条本人 SELECT 策略、客户端（未认证与已登录）对两张表的 insert/update/delete 全部被拒、列集合（明细无归属字段）、金额与时间列类型、状态与取杯号/完成时间联动、幂等唯一域 (user_id, idempotency_key)、订单号唯一、明细级联删除 |
| `database/70_amounts.test.sql` | 金额纯计算函数：单价/行小计/包装费（费率为入参）/总额/规格摘要的规则与精度、声明为 immutable 且不提权、无表访问（用无表权限的对照角色调用成功作证明）、anon/authenticated 不可执行 |
| `database/80_create_order.test.sql` | 下单服务端函数：参数无金额/用户入口、只授权已登录身份、客户端对订单与明细仍不可写、金额重算（单价=基础价+加价，总额=小计+包装费）、规格选择严格校验与快照、订单号 18 位、门店快照与推进时刻取自配置、非法输入整单拒绝不落数据、幂等重放、门店唯一性 |
| `database/85_idempotency.test.sql` | 重复提交防护：同一标识重放返回同一张订单（请求内容不同也一样）且不覆盖原内容、商品下架后重放仍成功、不同标识产生两张订单、标识与用户绑定（他人用同一标识只得到自己的新单、读不到对方订单）、被拒的请求不占用标识 |
| `database/86_order_invariants.test.sql` | Story 3.5 的跨故事不变量：归属取自会话身份（请求里伪造的 `user_id` / `order_number` 被忽略）、落库金额用库内价目公式级交叉验算（明细单价 = 基础价 + 所选选项加价；订单头 = 明细小计之和 + 包装费）、混合清单与 null 就餐方式整单被拒且已有订单行数与金额不变、不存在「有单无明细」的行 |
| `database/90_advance.test.sql` | 推进与取杯号（Story 4.1）：`pickup_code_date` 与唯一域约束 `(store_id, pickup_code_date, pickup_code)`、计数器表（RLS 启用、零策略、客户端完全不可读写）、序号 → 号码纯映射（`A-9999 → B-0001` 轮转与容量边界）、计数器按门店与自然日隔离、同日同店重号被唯一约束拒绝而跨日/跨店允许、`transition_order` 两条合法迁移与非法迁移拒绝、归属谓词、`advance_due_orders` 的作用域/顺序/幂等，以及「orders 的 UPDATE 只存在于 `transition_order` 一处」 |

说明：

- 测试自带数据（事务内清空目录表再插入样例，结束回滚），不依赖种子，也不依赖手工准备的数据——`supabase db reset --no-seed` 后直接跑同样通过。
- 模拟身份用角色切换（`set local role anon` / `authenticated`）加 `request.jwt.claims` 注入（Story 3.3 起按用户身份断言）；注入写法本身是实现细节、不写入契约，契约是测试结果（AD-19）。
- 断言描述都带对象名，失败时输出形如 `# Failed test 1: "未认证不能写入 categories"`，可定位到具体策略或对象。
- `86_order_invariants.test.sql` 的金额断言是公式级而非硬编码期望值：辅助函数从规格选择快照还原选项 id、查 `spec_options.price_extra`，再调用 Story 3.2 的纯函数重算单价与总额。故意改错辅助函数会看到对应断言失败（已做过一次突变验证）。

## Story 4.1 验收记录

- 2026-09-22 本地栈：`supabase db reset`（重建库 + 种子）后 `supabase test db` 全绿——12 个文件 / 351 条断言（Story 4.1 前为 11 / 285，新增 `90_advance` 的 66 条）。
- 2026-09-22 人工演示（跨事务，模拟真实调用节奏）：经 `create_order` 下一单（门店 `ready_delay_seconds = 15`），下单瞬间为 `cooking`、取杯号为空、距到点 15 秒；等待 16 秒后执行一次 `advance_due_orders(用户)`，返回实际推进 1 条，订单变为 `pickup`、取杯号 `A-0001`、发号日期为门店本地自然日。演示在临时用户上完成并在结束时清理（订单随用户级联删除，留下的计数器行也已删除）。
- 演示期间顺带验证了唯一约束的真实拦截：引擎测试里把 `A-0001` 手工写在当天日期上，与推进自动发号的 `A-0001` 相撞，插入被 `orders_pickup_code_unique` 拒绝——这正是「同日同店重号写不进去」的现场证据。

## Story 3.5 验收记录

- 2026-09-22 本地栈：`supabase db reset`（重建库 + 种子）后 `supabase test db` 全绿——11 个文件 / 285 条断言（Story 3.5 前为 10 / 270，新增 `86_order_invariants` 的 15 条）。另做一次突变验证：故意改错 86 的辅助函数（选项加价还原为 0），断言 7 按预期失败、输出定位到具体断言（`# Failed test 7: "库中不存在与「商品基础价 + 所选选项加价」重算不符的明细单价…"`），验证后已还原。
- 随本故事新增迁移 `20260922041552_dining_mode_guard.sql`：`p_dining_mode` 为 null 时归类为 `invalid_request`，不再漏成数据库 not-null 报错（NFR3）。

## 本地链路验证（不在 `supabase test db` 内）

并发行为单连接测不了，按 FR-P2-19 以「实现方式说明 + 人工验证记录」作为证据：

- `cd supabase && deno task verify:idempotency` → `scripts/verify-idempotency.ts`：5 个请求各自建立独立 TCP 连接、同时打本地 PostgREST 的 `create_order`（真实会话、真实 HTTP），断言全部成功且返回同一张订单、库里只有一张单。并发正确性由 `(user_id, idempotency_key)` 唯一约束兜住，「先查有没有」只是顺序重试的快速通道——脚本给赢家的请求 500 行明细把它的写入事务拉长到秒级，保证其余请求在它提交前到达并撞上唯一约束；断言还检查耗时最短的请求也等到了同一个事务，快速通道的几毫秒响应会立刻暴露。第二个用户用同一标识只得到自己的新单，且读不到对方订单。结束后清理测试用户。

### 验证记录

- 2026-09-21 本地栈：通过（`deno task verify:idempotency` 16 项断言；5 个并发请求各自独立连接、约 1.8s 内全部返回同一张订单；库里该标识 1 张单、500 行明细；跨用户只拿到自己的单。另用临时插入计数器核对：5 个并发请求产生 5 次插入尝试，其中 4 个实际走到唯一约束的捕获分支，验证后已移除该临时对象。）
