-- 状态机与并发行为的跨故事收口（Story 4.6；FR-P2-19；AD-6、AD-7）
-- 分工（避免重复，本文件只补前面文件没钉的收口断言）：
--   * 单条迁移的语义（归属谓词、参数形状、源码级写入点）在 90_advance.test.sql；
--   * 重复催单的 min 语义与拒绝语义在 92_urge.test.sql；
--   * 确认取杯与超时自动完成的逐项语义在 93_complete.test.sql；
--   * 真并发在单连接的 pgTAP 里测不了，按 FR-P2-19 以「实现方式说明 + 人工验证记录」作证据
--     （scripts/verify-state-machine.ts 的竞态轮）。
-- 本文件钉住四件跨故事的事：
--   1) 3×3 全迁移矩阵：只有 cooking→pickup 与 pickup→completed 两条合法边，
--      其余七种被拒绝且订单整行一字不变；
--   2) 终态吸收：已完成的订单在推进、超时兜底、确认取杯、催单四个机制下都不变；
--   3) 完整生命周期：催单 → 推进 → 确认取杯，取杯号与发号日期全程不变、不跳状态；
--   4) 兜底命令整体重跑：cron 的同一条命令跑两次，第二次 (0,0)、整表快照一字不变。
-- 自带数据（事务内清空订单、门店与取杯号计数器后插入样例），结束回滚；不依赖种子。
-- 断言描述都带对象名，失败时输出形如 "# Failed test 1: ..."，可定位到具体函数或约束。

begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

-- ── 测试数据：一个门店、两个用户、三个状态各一张（迁移矩阵用） ─────────────────
-- 迁移矩阵的三张夹具：制作中 / 待取餐 / 已完成，覆盖结构约束（Story 4.4、4.5）。

delete from public.order_items;
delete from public.orders;
delete from public.pickup_code_counters;
delete from public.stores;

insert into public.stores (
  id, name, address, phone, timezone, ready_delay_seconds, urge_lead_seconds, auto_complete_seconds
)
values
  ('00000000-0000-4000-8000-000000000a01', '状态机测试门店', '测试地址', '000-00000001',
   'Asia/Shanghai', 15, 7, 30);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000b11', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'machine-a@wechat.local', now()),
  ('00000000-0000-4000-8000-000000000b12', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'machine-b@wechat.local', now());

insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at)
values
  -- e01 制作中：非法迁移夹具 + cooking→pickup 合法边
  ('00000000-0000-4000-8000-000000000e01', '202609030930000001',
   '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '状态机测试门店', '测试地址', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'machine-cooking', 'M-0001', '2026-01-01',
   now() + interval '1 hour', null, null),
  -- e02 待取餐：非法迁移夹具 + pickup→completed 合法边
  ('00000000-0000-4000-8000-000000000e02', '202609030930000002',
   '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '状态机测试门店', '测试地址', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, 'machine-pickup', 'M-0002', '2026-01-01',
   now() - interval '1 hour', null, now() + interval '30 seconds'),
  -- e03 已完成：终态吸收夹具
  ('00000000-0000-4000-8000-000000000e03', '202609030930000003',
   '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '状态机测试门店', '测试地址', '000-00000001',
   'completed', 'takeout', 2.00, 32.00, 'machine-completed', 'M-0003', '2026-01-01',
   now() - interval '2 hours', now() - interval '1 hour', now() - interval '1 hour');

-- 非法迁移尝试前的整行快照：尝试结束后逐行比对，证明「被拒且一字不变」
create temp table machine_before as
  select o.id, to_jsonb(o.*) as row
    from public.orders o
   where o.id in ('00000000-0000-4000-8000-000000000e01',
                  '00000000-0000-4000-8000-000000000e02',
                  '00000000-0000-4000-8000-000000000e03');

-- ── 1) 全迁移矩阵：七种非法组合被拒、整行不变；两条合法边执行成功（AD-6） ─────

select throws_ok(
  $$ select public.transition_order('00000000-0000-4000-8000-000000000e01', 'cooking', 'cooking') $$,
  'P0001', 'invalid_transition',
  '非法迁移 cooking→cooking（原地打转）被拒绝'
);
select throws_ok(
  $$ select public.transition_order('00000000-0000-4000-8000-000000000e01', 'cooking', 'completed') $$,
  'P0001', 'invalid_transition',
  '非法迁移 cooking→completed（跳级）被拒绝'
);
select throws_ok(
  $$ select public.transition_order('00000000-0000-4000-8000-000000000e02', 'pickup', 'cooking') $$,
  'P0001', 'invalid_transition',
  '非法迁移 pickup→cooking（倒退）被拒绝：即使行状态与 p_from 匹配也不放行'
);
select throws_ok(
  $$ select public.transition_order('00000000-0000-4000-8000-000000000e02', 'pickup', 'pickup') $$,
  'P0001', 'invalid_transition',
  '非法迁移 pickup→pickup（原地打转）被拒绝'
);
select throws_ok(
  $$ select public.transition_order('00000000-0000-4000-8000-000000000e03', 'completed', 'cooking') $$,
  'P0001', 'invalid_transition',
  '非法迁移 completed→cooking（终态倒退）被拒绝'
);
select throws_ok(
  $$ select public.transition_order('00000000-0000-4000-8000-000000000e03', 'completed', 'pickup') $$,
  'P0001', 'invalid_transition',
  '非法迁移 completed→pickup（终态倒退）被拒绝'
);
select throws_ok(
  $$ select public.transition_order('00000000-0000-4000-8000-000000000e03', 'completed', 'completed') $$,
  'P0001', 'invalid_transition',
  '非法迁移 completed→completed（终态自环）被拒绝'
);
select is(
  (select to_jsonb(o.*)::text from public.orders o where o.id = '00000000-0000-4000-8000-000000000e01'),
  (select row::text from machine_before where id = '00000000-0000-4000-8000-000000000e01'),
  '两次非法尝试后「制作中」订单整行不变（状态、号、时间戳都没动）'
);
select is(
  (select to_jsonb(o.*)::text from public.orders o where o.id = '00000000-0000-4000-8000-000000000e02'),
  (select row::text from machine_before where id = '00000000-0000-4000-8000-000000000e02'),
  '两次非法尝试后「待取餐」订单整行不变'
);
select is(
  (select to_jsonb(o.*)::text from public.orders o where o.id = '00000000-0000-4000-8000-000000000e03'),
  (select row::text from machine_before where id = '00000000-0000-4000-8000-000000000e03'),
  '三次非法尝试后「已完成」订单整行不变'
);

-- 合法边 1：cooking→pickup（进入待取餐时按门店配置写自动完成时刻）
select is(
  (select (public.transition_order('00000000-0000-4000-8000-000000000e01', 'cooking', 'pickup')).status::text),
  'pickup',
  '合法迁移 cooking→pickup 执行成功'
);
select is(
  (select pickup_code || '/' || pickup_code_date::text
     from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  'M-0001/2026-01-01',
  '进入待取餐不改写取杯号与发号日期（号在下单时已定死）'
);
select is(
  (select auto_complete_at from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  now() + interval '30 seconds',
  '进入待取餐时按门店配置写入自动完成时刻（与状态同一条更新）'
);
select is(
  (select completed_at from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  null,
  '进入待取餐不写完成时间：合法边 1 没有跳级'
);

-- 合法边 2：pickup→completed（完成时间取服务端时钟）
select is(
  (select (public.transition_order('00000000-0000-4000-8000-000000000e02', 'pickup', 'completed')).status::text),
  'completed',
  '合法迁移 pickup→completed 执行成功'
);
select is(
  (select completed_at from public.orders where id = '00000000-0000-4000-8000-000000000e02'),
  now(),
  '完成迁移记录完成时间（服务端时钟），完成时间只在这一条边上产生'
);
select is(
  (select pickup_code from public.orders where id = '00000000-0000-4000-8000-000000000e02'),
  'M-0002',
  '完成迁移不改写取杯号'
);

-- ── 2) 终态吸收：已完成订单在四个机制下都不变（AD-6、AD-13） ────────────────
-- e03 未被矩阵触碰，仍是原始快照里的那一行。

select is(
  public.advance_due_orders('00000000-0000-4000-8000-000000000b11'),
  0,
  '终态：读时推进作用域内没有可推进的订单（已完成订单不在选中集合）'
);
select is(
  public.complete_due_orders(),
  0,
  '终态：超时兜底没有可完成的订单（已完成订单不在选中集合）'
);
select is(
  (select (public.transition_order('00000000-0000-4000-8000-000000000e03', 'pickup', 'completed')).id),
  null,
  '终态：再次执行 pickup→completed 返回空值（状态谓词不匹配，不产生第二个完成时间）'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000b11"}';

select throws_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-000000000e03') $$,
  'P0001', 'invalid_status',
  '终态：催单得到明确的「当前状态不可催单」，而不是笼统失败'
);
select ok(
  (select r ->> 'status' = 'completed'
     from public.complete_order('00000000-0000-4000-8000-000000000e03') r),
  '终态：确认取杯按「目标状态已达成」返回成功（不报错、不改状态）'
);

reset role;

select is(
  (select to_jsonb(o.*)::text from public.orders o where o.id = '00000000-0000-4000-8000-000000000e03'),
  (select row::text from machine_before where id = '00000000-0000-4000-8000-000000000e03'),
  '终态：四个机制轮番尝试后整行一字不变（完成时间与取杯号都没被改写）'
);

-- ── 3) 完整生命周期：催单 → 推进 → 确认，号与发号日期全程不变（AD-6、AD-7） ──
-- e04 在下单后已到点（ready_at 在过去）：催单走 min 的「原定更早」分支、不改动，
-- 随后推进接手、确认收尾。用一条订单把三个机制串起来，钉住「不跳状态、号不变」。

insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at)
values
  ('00000000-0000-4000-8000-000000000e04', '202609030930000004',
   '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '状态机测试门店', '测试地址', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'machine-lifecycle', 'L-0001', '2026-01-01',
   now() - interval '5 seconds', null, null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000b11"}';

select ok(
  (select r ->> 'status' = 'cooking' and r ->> 'pickup_code' = 'L-0001'
     from public.urge_order('00000000-0000-4000-8000-000000000e04') r),
  '生命周期第一步：催单返回仍制作中、取杯号不变（催单不写状态）'
);

reset role;

select is(
  (select ready_at from public.orders where id = '00000000-0000-4000-8000-000000000e04'),
  now() - interval '5 seconds',
  '催单取较早者：原定时刻更早时不改动推进时刻（不早也不晚）'
);
select is(
  public.advance_due_orders('00000000-0000-4000-8000-000000000b11'),
  1,
  '生命周期第二步：到点后由推进机制接手（返回实际推进条数 1）'
);
select ok(
  (select status = 'pickup' and completed_at is null
      and pickup_code = 'L-0001' and pickup_code_date = '2026-01-01'
     from public.orders where id = '00000000-0000-4000-8000-000000000e04'),
  '推进后：待取餐、未跳级、取杯号与发号日期不变'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000b11"}';

select ok(
  (select r ->> 'status' = 'completed' and r ->> 'pickup_code' = 'L-0001'
     from public.complete_order('00000000-0000-4000-8000-000000000e04') r),
  '生命周期第三步：确认取杯完成、仍是同一个取杯号'
);

reset role;

select is(
  (select completed_at from public.orders where id = '00000000-0000-4000-8000-000000000e04'),
  now(),
  '完成时间由确认取杯这一步写入（服务端时钟）'
);
select is(
  (select pickup_code || '/' || pickup_code_date::text
     from public.orders where id = '00000000-0000-4000-8000-000000000e04'),
  'L-0001/2026-01-01',
  '整条生命周期走完：取杯号与发号日期从未被任何一步改写'
);

-- ── 4) 兜底命令整体重跑：一次扫描两个机制，重跑 (0,0) 且整表快照不变 ─────────
-- 直接执行 cron 任务里的同一条命令：select advance_due_orders(), complete_due_orders()。

insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at)
values
  -- e11 到点的制作中：应被推进
  ('00000000-0000-4000-8000-000000000e11', '202609030930000011',
   '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '状态机测试门店', '测试地址', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'sweep-due-cooking', 'S-0001', '2026-01-01',
   now() - interval '1 second', null, null),
  -- e12 未到点的制作中：不动
  ('00000000-0000-4000-8000-000000000e12', '202609030930000012',
   '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '状态机测试门店', '测试地址', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'sweep-future-cooking', 'S-0002', '2026-01-01',
   now() + interval '1 hour', null, null),
  -- e13 到点的待取餐：应被超时完成
  ('00000000-0000-4000-8000-000000000e13', '202609030930000013',
   '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '状态机测试门店', '测试地址', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, 'sweep-due-pickup', 'S-0003', '2026-01-01',
   now() - interval '1 hour', null, now() - interval '1 second'),
  -- e14 未到点的待取餐：不动
  ('00000000-0000-4000-8000-000000000e14', '202609030930000014',
   '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '状态机测试门店', '测试地址', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, 'sweep-future-pickup', 'S-0004', '2026-01-01',
   now() - interval '1 hour', null, now() + interval '1 hour'),
  -- e15 已完成：不动
  ('00000000-0000-4000-8000-000000000e15', '202609030930000015',
   '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '状态机测试门店', '测试地址', '000-00000001',
   'completed', 'takeout', 2.00, 32.00, 'sweep-completed', 'S-0005', '2026-01-01',
   now() - interval '2 hours', now() - interval '1 hour', now() - interval '1 hour');

-- 第一次执行：一条语句里同时调用两个机制（与 cron 命令同构）
create temp table sweep_run1 as
  select public.advance_due_orders() as advanced, public.complete_due_orders() as completed;

select is(
  (select advanced from sweep_run1),
  1,
  '兜底命令第一次执行：推进带走唯一到点的制作中订单（e11）'
);
select is(
  (select completed from sweep_run1),
  1,
  '兜底命令第一次执行：超时完成带走唯一到点的待取餐订单（e13）'
);
select ok(
  (select status = 'pickup' and completed_at is null and pickup_code = 'S-0001'
      and auto_complete_at = now() + interval '30 seconds'
     from public.orders where id = '00000000-0000-4000-8000-000000000e11'),
  '推进只改状态：e11 变为待取餐、号不变、按门店配置写自动完成时刻'
);
select ok(
  (select status = 'cooking' and pickup_code = 'S-0002' and ready_at = now() + interval '1 hour'
     from public.orders where id = '00000000-0000-4000-8000-000000000e12'),
  '未到点的制作中订单不被兜底改动：状态、号与推进时刻原样'
);
select ok(
  (select status = 'completed' and completed_at = now() and pickup_code = 'S-0003'
      and auto_complete_at = now() - interval '1 second'
     from public.orders where id = '00000000-0000-4000-8000-000000000e13'),
  '超时完成只改状态与完成时间：e13 的取杯号与自动完成时刻不变'
);
select ok(
  (select status = 'pickup' and pickup_code = 'S-0004'
      and auto_complete_at = now() + interval '1 hour'
     from public.orders where id = '00000000-0000-4000-8000-000000000e14'),
  '未到点的待取餐订单不被兜底完成'
);
select ok(
  (select status = 'completed' and completed_at = now() - interval '1 hour'
      and pickup_code = 'S-0005'
     from public.orders where id = '00000000-0000-4000-8000-000000000e15'),
  '已完成订单不在任何兜底选中集合内：完成时间不被改写'
);

-- 第一次执行后的整表快照：第二次执行后逐行比对
create temp table sweep_after1 as
  select o.id, to_jsonb(o.*) as row from public.orders o;

create temp table sweep_run2 as
  select public.advance_due_orders() as advanced, public.complete_due_orders() as completed;

select is(
  (select advanced from sweep_run2),
  0,
  '重跑：没有可推进的订单（重复执行幂等，不跳状态）'
);
select is(
  (select completed from sweep_run2),
  0,
  '重跑：没有可完成的订单（已完成订单不被二次完成）'
);
select is(
  (select jsonb_agg(to_jsonb(o.*) order by o.id)::text from public.orders o),
  (select jsonb_agg(s.row order by s.id)::text from sweep_after1 s),
  '重跑不破坏已有数据：整表快照一字不变'
);

select * from finish();

rollback;
