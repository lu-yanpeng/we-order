-- 周期兜底扫描的声明（Story 4.2 / 4.5；FR-P2-11、FR-P2-13；AR-6、AR-13、AR-19）
-- 分工（避免重复）：
--   * 推进行为本身（作用域、发号、幂等、非法迁移）在 90_advance.test.sql；
--   * 超时自动完成的行为与两个触发源的语义在 93_complete.test.sql；
--   * 「时间到了任务真的会跑」需要一个扫描周期，pgTAP 在事务里等不到（定时器在另一个会话，
--     看不见未提交数据），按 FR-P2-19 以人工验证记录作证据：见 tests/README.md 的
--     Story 4.2 / 4.5 验收记录与 scripts/verify-sweep.ts、scripts/verify-complete.ts。
-- 本文件钉住的是「声明」这份契约：任务以迁移入仓、一次扫描同时兜底推进与超时完成两个机制、
-- 参数缺省即兜底作用域、旧任务名被替换而不是新增，且机制对客户端不可达。
begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- 本文件不切换角色：cron schema 只对所有者/迁移者开放（客户端不可达，见最后一条断言）。
-- ── 声明式入仓与任务形状（AR-6）──────────────────────────────────────────────

select is(
  (select count(*)::int from pg_extension where extname = 'pg_cron'),
  1,
  'pg_cron 可用：本地由迁移安装，云端托管项目默认已启用（本句为空操作）'
);
select is(
  (select count(*)::int from cron.job
    where command ilike '%advance_due_orders%'
      and command ilike '%complete_due_orders%'),
  1,
  '恰好一个定时任务在同一条命令里同时兜底推进与超时完成（Story 4.5 合并，不是两个任务）'
);
select is(
  (select jobname from cron.job where command ilike '%advance_due_orders%'),
  'order-sweep',
  '任务以命名方式注册：它现在不只推进，名字是 order-sweep（Story 4.5 改名）'
);
select is(
  (select count(*)::int from cron.job where jobname = 'advance-due-orders'),
  0,
  '旧任务名 advance-due-orders 已被替换：迁移重放不会留下第二个任务'
);
select is(
  (select schedule from cron.job where jobname = 'order-sweep'),
  '15 seconds',
  '扫描周期是 15 秒（演示参数，pg_cron 的秒级间隔写法）'
);
select is(
  (select active from cron.job where jobname = 'order-sweep'),
  true,
  '任务处于启用状态'
);

-- ── 与机制的关系：同一条命令调用两份实现、参数缺省即兜底作用域（AD-6、AR-13）─────

select is(
  (select command from cron.job where jobname = 'order-sweep'),
  'select public.advance_due_orders(), public.complete_due_orders()',
  '任务一条语句调用两个与读时触发共用的函数，且都不传用户参数——缺省即「全部到点订单」的兜底作用域'
);
select is(
  (select database::text from cron.job where jobname = 'order-sweep'),
  current_database()::text,
  '任务在当前数据库注册（与迁移应用的库一致）'
);
select ok(
  (select has_function_privilege(
      job.username, 'public.advance_due_orders(uuid)', 'EXECUTE')
     from cron.job as job
    where job.jobname = 'order-sweep'),
  '任务的执行身份有权执行推进函数（不会被权限拦下）'
);
select ok(
  (select has_function_privilege(
      job.username, 'public.complete_due_orders(uuid)', 'EXECUTE')
     from cron.job as job
    where job.jobname = 'order-sweep'),
  '任务的执行身份有权执行超时完成函数（不会被权限拦下）'
);

-- ── 机制边界：调度设施不向客户端暴露（AD-21）─────────────────────────────────

select ok(
  not has_schema_privilege('anon', 'cron', 'USAGE')
  and not has_schema_privilege('authenticated', 'cron', 'USAGE'),
  'cron schema 对客户端（未认证与已登录）不可达：客户端不能自建或篡改定时任务'
);

select * from finish();

rollback;
