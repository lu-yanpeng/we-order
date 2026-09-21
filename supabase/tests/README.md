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

说明：

- 测试自带数据（事务内清空目录表再插入样例，结束回滚），不依赖种子，也不依赖手工准备的数据——`supabase db reset --no-seed` 后直接跑同样通过。
- 模拟身份用角色切换（`set local role anon` / `authenticated`）加 `request.jwt.claims` 注入（Story 3.3 起按用户身份断言）；注入写法本身是实现细节、不写入契约，契约是测试结果（AD-19）。
- 断言描述都带对象名，失败时输出形如 `# Failed test 1: "未认证不能写入 categories"`，可定位到具体策略或对象。

## 本地链路验证（不在 `supabase test db` 内）

并发行为单连接测不了，按 FR-P2-19 以「实现方式说明 + 人工验证记录」作为证据：

- `cd supabase && deno task verify:idempotency` → `scripts/verify-idempotency.ts`：5 个请求各自建立独立 TCP 连接、同时打本地 PostgREST 的 `create_order`（真实会话、真实 HTTP），断言全部成功且返回同一张订单、库里只有一张单。并发正确性由 `(user_id, idempotency_key)` 唯一约束兜住，「先查有没有」只是顺序重试的快速通道——脚本给赢家的请求 500 行明细把它的写入事务拉长到秒级，保证其余请求在它提交前到达并撞上唯一约束；断言还检查耗时最短的请求也等到了同一个事务，快速通道的几毫秒响应会立刻暴露。第二个用户用同一标识只得到自己的新单，且读不到对方订单。结束后清理测试用户。

### 验证记录

- 2026-09-21 本地栈：通过（`deno task verify:idempotency` 16 项断言；5 个并发请求各自独立连接、约 1.8s 内全部返回同一张订单；库里该标识 1 张单、500 行明细；跨用户只拿到自己的单。另用临时插入计数器核对：5 个并发请求产生 5 次插入尝试，其中 4 个实际走到唯一约束的捕获分支，验证后已移除该临时对象。）
