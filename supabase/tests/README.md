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
| `database/60_orders.test.sql` | 订单结构与写路径封闭：两张表 RLS 启用且只有一条本人 SELECT 策略、客户端（未认证与已登录）对两张表的 insert/update/delete 全部被拒、列集合（明细无归属字段）、金额与时间列类型、取杯号与发号日期为 NOT NULL（Story 4.4：制作中必须带号）、完成时间联动、幂等唯一域 (user_id, idempotency_key)、订单号唯一、明细级联删除 |
| `database/70_amounts.test.sql` | 金额纯计算函数：单价/行小计/包装费（费率为入参）/总额/规格摘要的规则与精度、声明为 immutable 且不提权、无表访问（用无表权限的对照角色调用成功作证明）、anon/authenticated 不可执行 |
| `database/80_create_order.test.sql` | 下单服务端函数：参数无金额/用户入口、只授权已登录身份、客户端对订单与明细仍不可写、金额重算（单价=基础价+加价，总额=小计+包装费）、规格选择严格校验与快照、订单号 18 位、门店快照与推进时刻取自配置、下单即发号（Story 4.4：取号与建单同一条 INSERT、号有值且外形正确、发号日期 = 门店本地自然日、计数器消耗一次、同日两单不重号）、非法输入整单拒绝不落数据、幂等重放、门店唯一性 |
| `database/85_idempotency.test.sql` | 重复提交防护：同一标识重放返回同一张订单（请求内容不同也一样）且不覆盖原内容、商品下架后重放仍成功、不同标识产生两张订单、标识与用户绑定（他人用同一标识只得到自己的新单、读不到对方订单）、被拒的请求不占用标识 |
| `database/86_order_invariants.test.sql` | Story 3.5 的跨故事不变量：归属取自会话身份（请求里伪造的 `user_id` / `order_number` 被忽略）、落库金额用库内价目公式级交叉验算（明细单价 = 基础价 + 所选选项加价；订单头 = 明细小计之和 + 包装费）、混合清单与 null 就餐方式整单被拒且已有订单行数与金额不变、不存在「有单无明细」的行 |
| `database/90_advance.test.sql` | 推进与取杯号（Story 4.1/4.4）：`pickup_code_date` 与唯一域约束 `(store_id, pickup_code_date, pickup_code)`、两列 NOT NULL、计数器表（RLS 启用、零策略、客户端完全不可读写）、序号 → 号码纯映射（`A-9999 → B-0001` 轮转与容量边界）、计数器按门店与自然日隔离、同日同店重号被唯一约束拒绝而跨日/跨店允许、`transition_order` 两条合法迁移与非法迁移拒绝、归属谓词、参数形状不含发号参数、推进只做状态迁移（`advance_due_orders` 不发号、不消耗计数器、不改写取杯号），以及「发号调用只存在于 `create_order` 一处、orders 的 UPDATE 只存在于 `transition_order` 与 `urge_order` 两处、`status` 的写入仍唯一在 `transition_order`」 |
| `database/91_cron_sweep.test.sql` | 周期兜底扫描的声明（Story 4.2）：pg_cron 由迁移安装、恰好一条引用 `advance_due_orders` 的命名任务、周期 `15 seconds` 且启用、命令是不传参数的同一实现（= 全量兜底作用域）、注册在迁移应用的库、执行身份有权执行推进函数、cron schema 对客户端不可达 |
| `database/92_urge.test.sql` | 催单（Story 4.3）：函数属性与权限（security definer、空 search_path、只授权已登录）、参数只有订单 id、两个新错误类别（`order_not_found` / `invalid_status`）、提前到「催单时刻 + 门店配置的提前量」（7 秒与 20 秒两个门店证明不写死默认 3 秒）、min 语义（原定更早、已到点、重复催单都不改动）、催单不改状态、也不改写下单时的取杯号（Story 4.4）、到点订单仍由推进机制照常接管、拒绝语义（他人与不存在同一结果、本人非制作中 `invalid_status`、无身份 `not_authenticated`） |

说明：

- 测试自带数据（事务内清空目录表再插入样例，结束回滚），不依赖种子，也不依赖手工准备的数据——`supabase db reset --no-seed` 后直接跑同样通过。
- 模拟身份用角色切换（`set local role anon` / `authenticated`）加 `request.jwt.claims` 注入（Story 3.3 起按用户身份断言）；注入写法本身是实现细节、不写入契约，契约是测试结果（AD-19）。
- 断言描述都带对象名，失败时输出形如 `# Failed test 1: "未认证不能写入 categories"`，可定位到具体策略或对象。
- `86_order_invariants.test.sql` 的金额断言是公式级而非硬编码期望值：辅助函数从规格选择快照还原选项 id、查 `spec_options.price_extra`，再调用 Story 3.2 的纯函数重算单价与总额。故意改错辅助函数会看到对应断言失败（已做过一次突变验证）。
- 周期兜底扫描（Story 4.2）由迁移 `20260922130629_advance_due_orders_cron.sql` 声明：本地与云端都靠它重建，本地栈的 pg_cron 每 15 秒执行一次 `public.advance_due_orders()`（不传用户 = 全部到点订单）。**不要手工删除 `pickup_code_counters` 的行**：它是「下一个取杯号」的唯一来源（Story 4.4 起下单时发号也读它），删掉会让新号撞上已存在订单的号，使之后每一次发号都失败、订单永久卡在「制作中」。

## Story 4.4 验收记录

- 2026-09-23 本地栈（干净重建）：`supabase db reset`（重建库 + 种子）后 `supabase test db` 全绿——14 个文件 / 401 条断言（Story 4.4 前为 394：`60_orders` +1（取杯号与发号日期 NOT NULL）、`80_create_order` +4（下单即发号的号值/日期/计数器/两单不重号）、`90_advance` +2（两列 NOT NULL 与「发号调用只存在于 create_order」），其余文件断言数不变）。新增迁移 `20260922155306_pickup_code_at_creation.sql`：清空既有测试订单后把号与发号日期收紧为 NOT NULL，`create_order` 在同一条 INSERT 内取号建单，`transition_order` 去掉发号参数（6 参 → 4 参），`advance_due_orders` 不再发号。
- 2026-09-23 `deno task verify:pickup-codes`（新增）：8 个并发下单（各自独立连接、不同幂等键）全部成功，拿到 8 个互不相同的取杯号（`A-0015、A-0012、A-0013、A-0016、A-0009、A-0011、A-0010、A-0014`——返回顺序交错，并发真实发生，序号不是按请求顺序发的），库中每张单都是「制作中」且号与 RPC 返回一致，发号日期都是门店本地自然日，计数器恰好 +8（8 → 16）。6 项断言全部通过。
- 2026-09-23 `deno task verify:urge`：12 项断言全部通过——下单瞬间即带号（`A-0017`），催单返回与库中的号都不变，催单把推进时刻提前、并发重复催单不变，推进后仍是同一个号，之后催单得到 `invalid_status`。
- 2026-09-23 `deno task verify:sweep`：8 项断言全部通过——下单即带号（`A-0018`），到点前保持「制作中」且号不变，推进后号仍是 `A-0018`、发号日期是门店本地自然日。
- 2026-09-23 `deno task verify:idempotency` 回归：16 项断言全部通过（`create_order` 重写后幂等重放语义不变）。
- 类型契约：`supabase gen types typescript --local` 与入仓的 `types/database.types.ts` 零差异——`orders.pickup_code` / `pickup_code_date` 变为非空、`transition_order` 参数去掉 `p_pickup_code` / `p_pickup_code_date`。
- 实现方式说明（并发为什么不重号；FR-P2-19 的证据形式）：发号是计数器行上的「插入或递增并返回」原子操作，并发请求在行锁上排队、各拿不同序号（不是「查最大值加一」）；取号与建单在同一条 INSERT 内完成，不存在「有单无号」；`orders` 上的 `(store_id, pickup_code_date, pickup_code)` 唯一约束是兜底，即使程序写错也不可能落两个相同的号。`verify:pickup-codes` 的并发轮是该机制的现场记录。
- 迁移的删除动作：号码列收紧为必填的前置条件是既有订单全都带号；旧订单没有号、补号等于伪造历史，因此迁移清空 `orders`（明细级联删除；Phase 2 本地与云端都只有测试数据）。计数器 `pickup_code_counters` 保留——跳号无害，重号才是事故。
- 客户端范围：小程序端零改动（AD-15）；`pickup_code` 恒有值的展示行为在 Phase 3 随订单接口对接落地。

## Story 4.3 验收记录

- 2026-09-22 本地栈（干净重建）：`supabase db reset`（重建库 + 种子）后 `supabase test db` 全绿——14 个文件 / 394 条断言（Story 4.3 前为 13 / 360：新增 `92_urge` 的 33 条；`90_advance` 的「orders 的 UPDATE 唯一性」由 1 条拆成 2 条，+1）。`92_urge` 覆盖提前量取自门店配置、min 语义、催单不改状态、拒绝语义与权限边界；因 pgTAP 事务内 `now()` 固定，跨事务的「催单后更早被推进」由下面的脚本给证据。
- 2026-09-22 `deno task verify:urge`：真 HTTP + 真实会话，订单 202609222156471770 的到点时刻从「下单 + 15 秒」（13:57:02.026）被催到「催单 + 3 秒」（13:56:50.055）；催单返回里状态仍是「制作中」、取杯号为空；两个并发催单都成功且 `ready_at` 完全不变；随后只做裸表读轮询，订单在催单后 9.1 秒被周期兜底扫描推进为「待取餐」并拿到 `A-0001`（早于原定到点时刻，加速真实发生）；推进后再次催单得到明确的 `invalid_status`。12 项断言全部通过。
- 类型契约：`supabase gen types typescript --local` 与入仓的 `types/database.types.ts` 完全一致——新增 `urge_order` 与 `order_not_found` / `invalid_status` 两个枚举值；`urge_order` 的返回与 `create_order` 共用订单形状（需手工类型覆盖，见 `types/README.md`）。
- 跨故事改动（已在同一批验证中回归）：`80_create_order` 的 `order_error_code` 完整取值清单追加两个新值；`90_advance` 的唯一性断言拆分为「UPDATE 两处」与「status 写入一处」。
- 并发说明（FR-P2-19：真并发不在数据库测试范围，以实现说明 + 人工记录为证据）：催单是与推进同构的「带状态谓词的一次性更新」。推进先赢时，催单的更新匹配 0 行（随后读到的状态是待取餐，返回 `invalid_status`）；催单先赢时，推进看到的是被提前的 `ready_at`，只会更早不会更晚。两条更新在同一行上由行锁串行化，不存在「先读后写」的丢更新；催单永不写 `status`，因此不可能把已推进的订单拨回去。`verify:urge` 的并发重复催单（两个请求同时到达、`ready_at` 完全不变）是该机制的现场记录。
- 客户端范围：小程序端零改动（AD-15：Phase 2 只接登录链路与最小验证入口）；催单的按钮与冷却属 Phase 3/Phase 4 的产品语义，不在本故事范围。
- 发号时机修订说明（随 Story 4.4 落地）：本记录与下方 Story 4.2 / 4.1 记录中「催单返回里…取杯号为空」「推进后拿到取杯号」描述的是发号时机前移之前的旧行为；Story 4.4 起取杯号在下单时即分配，催单与推进都不再写它，相关测试与脚本已同步修订（见上方 Story 4.4 验收记录）。

## Story 4.2 验收记录

- 2026-09-22 本地栈（干净重建）：`supabase db reset`（重建库 + 种子）后 `supabase test db` 全绿——13 个文件 / 360 条断言（Story 4.2 前为 12 / 351，新增 `91_cron_sweep` 的 9 条）。重建后任务由迁移自动回来：`cron.job` 一条 `advance-due-orders`（`15 seconds`、`select public.advance_due_orders()`、`active`、注册在 `postgres` 库、执行身份 `postgres`），`cron.job_run_details` 每 15 秒一条 `succeeded`。
- 2026-09-22 `deno task verify:sweep`：真 HTTP 下一单后**不做任何写操作、也不调用订单读取函数**，只做裸表读轮询；订单在下单后 22.2 秒被推进为「待取餐」并拿到 `A-0001`（到点 15 秒 + 一个扫描周期内），8 项断言全部通过。改状态的只可能是周期兜底扫描。
- 类型契约无变化：`supabase gen types typescript --local` 与入仓的 `types/database.types.ts` 完全一致（cron 对象在 `public` 之外，不影响对外形状）。

## Story 4.1 验收记录

- 2026-09-22 本地栈：`supabase db reset`（重建库 + 种子）后 `supabase test db` 全绿——12 个文件 / 351 条断言（Story 4.1 前为 11 / 285，新增 `90_advance` 的 66 条）。
- 2026-09-22 人工演示（跨事务，模拟真实调用节奏）：经 `create_order` 下一单（门店 `ready_delay_seconds = 15`），下单瞬间为 `cooking`、取杯号为空、距到点 15 秒；等待 16 秒后执行一次 `advance_due_orders(用户)`，返回实际推进 1 条，订单变为 `pickup`、取杯号 `A-0001`、发号日期为门店本地自然日。演示在临时用户上完成并在结束时清理（订单随用户级联删除）。注：当时连计数器行一起删除了；按 Story 4.2 起的约定，`pickup_code_counters` 的行不再手工删除（理由见上方说明）。
- 演示期间顺带验证了唯一约束的真实拦截：引擎测试里把 `A-0001` 手工写在当天日期上，与推进自动发号的 `A-0001` 相撞，插入被 `orders_pickup_code_unique` 拒绝——这正是「同日同店重号写不进去」的现场证据。

## Story 3.5 验收记录

- 2026-09-22 本地栈：`supabase db reset`（重建库 + 种子）后 `supabase test db` 全绿——11 个文件 / 285 条断言（Story 3.5 前为 10 / 270，新增 `86_order_invariants` 的 15 条）。另做一次突变验证：故意改错 86 的辅助函数（选项加价还原为 0），断言 7 按预期失败、输出定位到具体断言（`# Failed test 7: "库中不存在与「商品基础价 + 所选选项加价」重算不符的明细单价…"`），验证后已还原。
- 随本故事新增迁移 `20260922041552_dining_mode_guard.sql`：`p_dining_mode` 为 null 时归类为 `invalid_request`，不再漏成数据库 not-null 报错（NFR3）。

## 本地链路验证（不在 `supabase test db` 内）

并发与时间行为单连接测不了，按 FR-P2-19 以「实现方式说明 + 人工验证记录」作为证据：

- `cd supabase && deno task verify:idempotency` → `scripts/verify-idempotency.ts`：5 个请求各自建立独立 TCP 连接、同时打本地 PostgREST 的 `create_order`（真实会话、真实 HTTP），断言全部成功且返回同一张订单、库里只有一张单。并发正确性由 `(user_id, idempotency_key)` 唯一约束兜住，「先查有没有」只是顺序重试的快速通道——脚本给赢家的请求 500 行明细把它的写入事务拉长到秒级，保证其余请求在它提交前到达并撞上唯一约束；断言还检查耗时最短的请求也等到了同一个事务，快速通道的几毫秒响应会立刻暴露。第二个用户用同一标识只得到自己的新单，且读不到对方订单。结束后清理测试用户。
- `cd supabase && deno task verify:sweep` → `scripts/verify-sweep.ts`：真 HTTP 下一单，之后**不做任何写操作、也不调用订单读取函数**，只用「裸表读」（PostgREST 直接 SELECT `public.orders`）轮询，断言订单在「到点 + 一个扫描周期」内被周期任务自己推进。之所以能证明「无人读取也会推进」：Phase 2 的读时推进只存在于服务端读取函数里（Story 5.1），裸表读不会触发推进，改状态的只可能是 cron 兜底扫描。脚本还顺带断言「到点前一直保持制作中」（推进时长没有被绕过）与「取杯号在下单时已拿到、推进不改写它」（Story 4.4）。
- `cd supabase && deno task verify:urge` → `scripts/verify-urge.ts`：真 HTTP + 真实会话走「下单 → 催单 → 并发重复催单 → 被兜底扫描推进 → 推进后再催单」。断言 `ready_at` 从「下单 + 门店配置的推进时长」被提前到「催单时刻 + 门店配置的提前量」、催单响应里状态仍制作中且取杯号不变、并发重复催单后 `ready_at` 完全不变（min 语义）、订单在新到点后一个扫描周期内被周期任务推进（不改状态的仍只有推进机制）、推进不改写取杯号、推进后催单得到明确的 `invalid_status`。之所以要脚本：pgTAP 的事务里 `now()` 固定，跨事务的时间行为测不了。
- `cd supabase && deno task verify:pickup-codes` → `scripts/verify-pickup-codes.ts`：真 HTTP + 真实会话并发下 8 单（各自独立 TCP 连接、不同幂等键），断言全部成功且拿到 8 个互不相同的取杯号（外形正确）、发号日期都是门店本地自然日、库中行与 RPC 返回一致且仍「制作中」、计数器恰好 +8。之所以要脚本：发号是「计数器原子递增 + 唯一约束兜底」，真并发在单连接的 pgTAP 里测不了。

### 验证记录

- 2026-09-23 本地栈（干净重建后）：通过（`deno task verify:pickup-codes` 6 项断言；8 个并发下单拿到 8 个互不相同的取杯号 `A-0015…A-0014`、返回顺序交错、发号日期为门店本地自然日、计数器 8 → 16；测试用户已清理，取杯号计数器按约定保留）。
- 2026-09-23 本地栈（干净重建后）：通过（`deno task verify:urge` 12 项断言；订单 202609230016129681 下单即带 `A-0017`，催单后 9.1 秒被兜底扫描推进、号不变；测试用户已清理，取杯号计数器按约定保留）。
- 2026-09-23 本地栈（干净重建后）：通过（`deno task verify:sweep` 8 项断言；订单 202609230016434463 下单即带 `A-0018`，24.2 秒后被兜底扫描推进、号不变；期间只做裸表读轮询；测试用户已清理，取杯号计数器按约定保留）。
- 2026-09-23 本地栈：通过（`deno task verify:idempotency` 16 项断言；`create_order` 改为同一条 INSERT 内取号建单后，幂等重放语义不变）。
- 2026-09-21 本地栈：通过（`deno task verify:idempotency` 16 项断言；5 个并发请求各自独立连接、约 1.8s 内全部返回同一张订单；库里该标识 1 张单、500 行明细；跨用户只拿到自己的单。另用临时插入计数器核对：5 个并发请求产生 5 次插入尝试，其中 4 个实际走到唯一约束的捕获分支，验证后已移除该临时对象。）
