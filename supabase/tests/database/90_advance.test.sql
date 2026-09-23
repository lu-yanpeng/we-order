-- 推进机制（Story 4.1/4.2）与取杯号的「下单时分配、一经分配不可变」（Story 4.4；FR-P2-11；AD-6、AD-7、AD-10、AD-13、AD-21）
-- 分工（避免重复）：
--   * 下单时的发号（取号与建单同一条 INSERT、发号日期、计数器）在 80_create_order.test.sql 断言；
--   * orders / order_items 的基础结构与客户端写路径封闭在 60_orders.test.sql；
--   * 非法迁移的跨故事收口（3×3 全矩阵、终态吸收、整表重跑）在 94_state_machine.test.sql；
--     真并发单连接测不了，按 FR-P2-19 以「实现方式说明 + 人工验证记录」作证据
--     （scripts/verify-state-machine.ts）。
-- 自带数据（事务内清空订单、门店与取杯号计数器后插入样例），结束回滚；不依赖种子。
-- 断言描述都带对象名，失败时输出形如 "# Failed test 1: ..."，可定位到具体函数或约束。
begin;

create extension if not exists pgtap with schema extensions;

select plan(69);

-- ── 测试数据：两个门店、两个用户 ─────────────────────────────────────────────

delete from public.order_items;
delete from public.orders;
delete from public.pickup_code_counters;
delete from public.stores;

insert into public.stores (id, name, address, phone, timezone, ready_delay_seconds)
values
  ('00000000-0000-4000-8000-000000000a01', '推进测试门店', '测试地址 A', '000-00000001', 'Asia/Shanghai', 15),
  ('00000000-0000-4000-8000-000000000a02', '第二门店', '测试地址 B', '000-00000002', 'Asia/Shanghai', 15);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000b11', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'advance-a@wechat.local', now()),
  ('00000000-0000-4000-8000-000000000b12', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'advance-b@wechat.local', now());

-- 引擎测试（user A / 门店 A）：两张待迁移 + 一张已待取餐（不该被推进改动）
-- Story 4.4 起订单在下单时已带号：这里的号由样例直接写入，推进不读也不写它。
-- Story 4.5 起「非制作中」的订单必须携带自动完成时刻（结构约束）：
-- 已待取餐的样例直接写入一个值；制作中的样例为空值。
insert into public.orders (
  order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at)
values
  ('202609030900000001', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '推进测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'engine-1', 'C-0001', '2026-09-01', now() - interval '10 minutes', null, null),
  ('202609030900000002', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '推进测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'engine-2', 'C-0002', '2026-09-01', now() - interval '10 minutes', null, null),
  ('202609030900000003', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '推进测试门店', '测试地址 A', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, 'engine-3', 'A-0007',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '10 minutes', null, now() + interval '30 seconds');

-- 推进入口测试：A 的两张到点（ready_at 有先后）、一张未到点、一张已待取餐；B 的一张到点
insert into public.orders (
  order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at)
values
  ('202609030900000011', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '推进测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'advance-a1', 'D-0001',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '2 seconds', null, null),
  ('202609030900000012', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '推进测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'advance-a2', 'D-0002',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 second', null, null),
  ('202609030900000013', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '推进测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'advance-a3', 'D-0003',
   (now() at time zone 'Asia/Shanghai')::date, now() + interval '1 hour', null, null),
  ('202609030900000014', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
   '推进测试门店', '测试地址 A', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, 'advance-a4', 'A-0009',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '10 minutes', null, now() + interval '30 seconds'),
  ('202609030900000015', '00000000-0000-4000-8000-000000000b12', '00000000-0000-4000-8000-000000000a02',
   '第二门店', '测试地址 B', '000-00000002',
   'cooking', 'takeout', 2.00, 32.00, 'advance-b1', 'E-0001',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 second', null, null);

-- ── 结构：唯一域由列与约束表达（AD-7）───────────────────────────────────────

select is(
  (select format_type(atttypid, atttypmod) from pg_attribute
    where attrelid = 'public.orders'::regclass and attname = 'pickup_code_date'),
  'date',
  'orders.pickup_code_date 是 date（取杯号唯一域的日期部分）'
);
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_pickup_code_unique'),
  'UNIQUE (store_id, pickup_code_date, pickup_code)',
  '取杯号唯一域是「门店 + 发号日期 + 取杯号」'
);
select is(
  (select array_agg(attname::text order by attname) from pg_attribute
    where attrelid = 'public.orders'::regclass
      and attname in ('pickup_code', 'pickup_code_date')
      and attnotnull),
  array['pickup_code', 'pickup_code_date'],
  '取杯号与发号日期恒有值：两列都是 NOT NULL（Story 4.4）'
);
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'pickup_code_counters'),
  array['counter', 'local_date', 'store_id'],
  '取杯号计数器的列集合：门店、日期、序号'
);
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.pickup_code_counters'::regclass and contype = 'p'),
  'PRIMARY KEY (store_id, local_date)',
  '计数器主键就是唯一域「门店 + 门店本地自然日」'
);
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.pickup_code_counters'::regclass and contype = 'f'
      and confrelid = 'public.stores'::regclass),
  'c',
  '门店删除时计数器级联删除'
);

-- ── 权限与内部表边界（AD-21、AD-6）──────────────────────────────────────────

select ok(
  (select relrowsecurity from pg_class where oid = 'public.pickup_code_counters'::regclass),
  'pickup_code_counters 启用了行级访问控制'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'pickup_code_counters'),
  0,
  'pickup_code_counters 零策略：内部表对客户端完全不可达'
);
select ok(
  not has_table_privilege('anon', 'public.pickup_code_counters', 'SELECT')
  and not has_table_privilege('anon', 'public.pickup_code_counters', 'INSERT')
  and not has_table_privilege('anon', 'public.pickup_code_counters', 'UPDATE')
  and not has_table_privilege('anon', 'public.pickup_code_counters', 'DELETE')
  and not has_table_privilege('authenticated', 'public.pickup_code_counters', 'SELECT')
  and not has_table_privilege('authenticated', 'public.pickup_code_counters', 'INSERT')
  and not has_table_privilege('authenticated', 'public.pickup_code_counters', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.pickup_code_counters', 'DELETE'),
  '取杯号计数器对客户端（未认证与已登录）完全不可读写'
);
select ok(
  not has_function_privilege('anon', 'public.pickup_code_from_counter(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.allocate_pickup_code(uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.transition_order(uuid, public.order_status, public.order_status, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.advance_due_orders(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.pickup_code_from_counter(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.allocate_pickup_code(uuid, date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.transition_order(uuid, public.order_status, public.order_status, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.advance_due_orders(uuid)', 'EXECUTE'),
  '推进机制对客户端不暴露：四个函数都不可被 anon/authenticated 执行'
);
select ok(
  (select bool_and(prosecdef) from pg_proc
    where oid in ('public.allocate_pickup_code(uuid, date)'::regprocedure,
                  'public.transition_order(uuid, public.order_status, public.order_status, uuid)'::regprocedure,
                  'public.advance_due_orders(uuid)'::regprocedure)),
  '三个表访问函数都是 security definer'
);
select ok(
  (select bool_and('search_path=""' = any(coalesce(proconfig, '{}'))) from pg_proc
    where oid in ('public.allocate_pickup_code(uuid, date)'::regprocedure,
                  'public.transition_order(uuid, public.order_status, public.order_status, uuid)'::regprocedure,
                  'public.advance_due_orders(uuid)'::regprocedure)),
  '三个表访问函数都使用空 search_path'
);
select is(
  (select provolatile::text from pg_proc
    where oid = 'public.pickup_code_from_counter(integer)'::regprocedure),
  'i',
  'pickup_code_from_counter 是无表访问的 immutable 纯函数（AD-1）'
);

-- ── 纯映射：序号 → 取杯号（AD-7）───────────────────────────────────────────

select is(public.pickup_code_from_counter(1), 'A-0001', '序号 1 → A-0001');
select is(public.pickup_code_from_counter(9999), 'A-9999', '序号 9999 → A-9999（单一字母的末号）');
select is(public.pickup_code_from_counter(10000), 'B-0001', '序号 10000 → B-0001（用尽后进入下一个字母）');
select is(public.pickup_code_from_counter(259974), 'Z-9999', '序号 259974 → Z-9999（当日容量上限 26 × 9999）');
select throws_ok(
  $$ select public.pickup_code_from_counter(0) $$,
  'P0001', null,
  '序号 0 超出容量被拒绝'
);
select throws_ok(
  $$ select public.pickup_code_from_counter(259975) $$,
  'P0001', null,
  '序号 259975 超出容量被拒绝'
);

-- ── 发号：计数器原子递增、按门店与自然日隔离（AD-7）────────────────────────

select is(
  public.allocate_pickup_code('00000000-0000-4000-8000-000000000a01', '2026-01-01'),
  'A-0001',
  '当日首个序号从 A-0001 开始'
);
select is(
  public.allocate_pickup_code('00000000-0000-4000-8000-000000000a01', '2026-01-01'),
  'A-0002',
  '同一门店同一自然日的序号递增'
);
select is(
  public.allocate_pickup_code('00000000-0000-4000-8000-000000000a01', '2026-01-02'),
  'A-0001',
  '跨日重新从 A-0001 开始（允许重复）'
);
select is(
  public.allocate_pickup_code('00000000-0000-4000-8000-000000000a02', '2026-01-01'),
  'A-0001',
  '不同门店的计数器互相独立'
);
select is(
  (select counter from public.pickup_code_counters
    where store_id = '00000000-0000-4000-8000-000000000a01' and local_date = '2026-01-01'),
  2,
  '计数器记录当日已发出的序号数'
);
select is(
  (select counter from public.pickup_code_counters
    where store_id = '00000000-0000-4000-8000-000000000a01' and local_date = '2026-01-02'),
  1,
  '跨日计数是另一个键上的新行'
);
select throws_ok(
  $$ insert into public.pickup_code_counters (store_id, local_date, counter)
     values ('00000000-0000-4000-8000-000000000a01', '2026-01-03', 0) $$,
  '23514', null,
  '计数器序号必须是正数'
);

-- ── 唯一域：同日同店重号写不进去，跨日与跨店允许（AD-7）────────────────────

select lives_ok(
  $$ insert into public.orders (
       order_number, user_id, store_id, store_name, store_address, store_phone,
       status, dining_mode, packaging_fee, total_amount, idempotency_key,
       pickup_code, pickup_code_date, ready_at, auto_complete_at)
     values
       ('202609030900000021', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
        '推进测试门店', '测试地址 A', '000-00000001',
        'pickup', 'takeout', 2.00, 32.00, 'uniq-1', 'B-0001', '2026-01-01',
        now() - interval '1 hour', now() + interval '30 seconds') $$,
  '待取餐订单可携带取杯号与发号日期'
);
select throws_ok(
  $$ insert into public.orders (
       order_number, user_id, store_id, store_name, store_address, store_phone,
       status, dining_mode, packaging_fee, total_amount, idempotency_key,
       pickup_code, pickup_code_date, ready_at, auto_complete_at)
     values
       ('202609030900000022', '00000000-0000-4000-8000-000000000b12', '00000000-0000-4000-8000-000000000a01',
        '推进测试门店', '测试地址 A', '000-00000001',
        'pickup', 'takeout', 2.00, 32.00, 'uniq-2', 'B-0001', '2026-01-01',
        now() - interval '1 hour', now() + interval '30 seconds') $$,
  '23505', null,
  '同一门店同一自然日的取杯号不能重复（唯一约束兜底）'
);
select lives_ok(
  $$ insert into public.orders (
       order_number, user_id, store_id, store_name, store_address, store_phone,
       status, dining_mode, packaging_fee, total_amount, idempotency_key,
       pickup_code, pickup_code_date, ready_at, auto_complete_at)
     values
       ('202609030900000023', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a02',
        '第二门店', '测试地址 B', '000-00000002',
        'pickup', 'takeout', 2.00, 32.00, 'uniq-3', 'B-0001', '2026-01-01',
        now() - interval '1 hour', now() + interval '30 seconds') $$,
  '不同门店可以在同一天使用同一个取杯号'
);
select lives_ok(
  $$ insert into public.orders (
       order_number, user_id, store_id, store_name, store_address, store_phone,
       status, dining_mode, packaging_fee, total_amount, idempotency_key,
       pickup_code, pickup_code_date, ready_at, auto_complete_at)
     values
       ('202609030900000024', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
        '推进测试门店', '测试地址 A', '000-00000001',
        'pickup', 'takeout', 2.00, 32.00, 'uniq-4', 'B-0001', '2026-01-02',
        now() - interval '1 hour', now() + interval '30 seconds') $$,
  '同一门店跨日允许重复使用同一个取杯号'
);
select throws_ok(
  $$ insert into public.orders (
       order_number, user_id, store_id, store_name, store_address, store_phone,
       status, dining_mode, packaging_fee, total_amount, idempotency_key,
       pickup_code, ready_at, auto_complete_at)
     values
       ('202609030900000025', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
        '推进测试门店', '测试地址 A', '000-00000001',
        'pickup', 'takeout', 2.00, 32.00, 'uniq-5', 'B-0002', now(),
        now() + interval '30 seconds') $$,
  '23502', null,
  '有号无日期被拒：发号日期必填（Story 4.4）'
);
select throws_ok(
  $$ insert into public.orders (
       order_number, user_id, store_id, store_name, store_address, store_phone,
       status, dining_mode, packaging_fee, total_amount, idempotency_key,
       pickup_code_date, ready_at, auto_complete_at)
     values
       ('202609030900000026', '00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000a01',
        '推进测试门店', '测试地址 A', '000-00000001',
        'pickup', 'takeout', 2.00, 32.00, 'uniq-6', '2026-01-01', now(),
        now() + interval '30 seconds') $$,
  '23502', null,
  '有日期无号被拒：取杯号必填（Story 4.4）'
);

-- ── 迁移引擎：唯一写 status 的实现，不携带发号参数（AD-6、AD-7）────────────

select lives_ok(
  $$ select public.transition_order(
       (select id from public.orders where order_number = '202609030900000001'),
       'cooking', 'pickup') $$,
  'transition_order 执行 cooking→pickup'
);
select ok(
  (select status = 'pickup' and completed_at is null
     from public.orders where order_number = '202609030900000001'),
  '迁移后状态为待取餐、完成时间仍为空'
);
select is(
  (select pickup_code || '/' || pickup_code_date::text
     from public.orders where order_number = '202609030900000001'),
  'C-0001/2026-09-01',
  '推进不改写取杯号与发号日期：号在下单时已定死（Story 4.4）'
);
select is(
  (select (public.transition_order(
      (select id from public.orders where order_number = '202609030900000001'),
      'cooking', 'pickup')).id),
  null,
  '重复执行同一迁移返回空值：状态谓词不匹配'
);
select is(
  (select pickup_code from public.orders where order_number = '202609030900000001'),
  'C-0001',
  '重复执行不改写取杯号'
);

select lives_ok(
  $$ select public.transition_order(
       (select id from public.orders where order_number = '202609030900000001'),
       'pickup', 'completed') $$,
  'transition_order 执行 pickup→completed'
);
select ok(
  (select status = 'completed' and completed_at is not null
     from public.orders where order_number = '202609030900000001'),
  '迁移后状态为已完成、完成时间由服务端记录'
);
select is(
  (select pickup_code || '/' || pickup_code_date::text
     from public.orders where order_number = '202609030900000001'),
  'C-0001/2026-09-01',
  '完成迁移不改写取杯号与发号日期'
);

-- 把完成时间改成一个可辨认的历史值：重复确认若改写了它，下面的断言就会失败
update public.orders set completed_at = timestamptz '2026-09-01 00:00:00+08'
 where order_number = '202609030900000001';

select is(
  (select (public.transition_order(
      (select id from public.orders where order_number = '202609030900000001'),
      'pickup', 'completed')).id),
  null,
  '重复执行 pickup→completed 返回空值（幂等）'
);
select is(
  (select completed_at from public.orders where order_number = '202609030900000001'),
  '2026-09-01 00:00:00+08'::timestamptz,
  '重复确认不修改完成时间'
);

select is(
  (select (public.transition_order(
      (select id from public.orders where order_number = '202609030900000003'),
      'cooking', 'pickup')).id),
  null,
  '对已处于待取餐的订单执行推进：返回空值、不改状态'
);
select is(
  (select pickup_code from public.orders where order_number = '202609030900000003'),
  'A-0007',
  '状态不匹配时不改写取杯号'
);

select throws_ok(
  $$ select public.transition_order(
       (select id from public.orders where order_number = '202609030900000002'),
       'cooking', 'completed') $$,
  'P0001', 'invalid_transition',
  '非法迁移 cooking→completed 被拒绝'
);
select throws_ok(
  $$ select public.transition_order(
       (select id from public.orders where order_number = '202609030900000002'),
       'pickup', 'cooking') $$,
  'P0001', 'invalid_transition',
  '非法迁移 pickup→cooking 被拒绝'
);
select throws_ok(
  $$ select public.transition_order(
       (select id from public.orders where order_number = '202609030900000002'),
       null, null) $$,
  'P0001', 'invalid_transition',
  '空状态迁移被拒绝'
);
select is(
  (select status::text from public.orders where order_number = '202609030900000002'),
  'cooking',
  '非法迁移被拒后订单当前状态不变'
);

select is(
  (select (public.transition_order(
      (select id from public.orders where order_number = '202609030900000002'),
      'cooking', 'pickup',
      p_user_id => '00000000-0000-4000-8000-000000000b12')).id),
  null,
  '归属谓词：非本人不能推进（返回空值，不泄露差异）'
);
select is(
  (select (public.transition_order(
      (select id from public.orders where order_number = '202609030900000002'),
      'cooking', 'pickup',
      p_user_id => '00000000-0000-4000-8000-000000000b11')).status::text),
  'pickup',
  '归属谓词：本人可以推进'
);
select is(
  (select pickup_code from public.orders where order_number = '202609030900000002'),
  'C-0002',
  '归属匹配时状态迁移仍不改写取杯号'
);

select is(
  (select proargnames::text from pg_proc
    where oid = 'public.transition_order(uuid, public.order_status, public.order_status, uuid)'::regprocedure),
  '{p_order_id,p_from,p_to,p_user_id}',
  'transition_order 的参数形状固定：没有发号参数（p_user_id 供确认取杯的归属校验）'
);
select ok(
  (select prosrc not ilike '%pickup_code%' from pg_proc
    where oid = 'public.transition_order(uuid, public.order_status, public.order_status, uuid)'::regprocedure),
  'transition_order 源码不含取杯号：结构上不可能改号（Story 4.4）'
);

-- ── 推进入口：作用域、幂等，以及「推进不发号、不改号」（AD-6、AD-7）──────────

select is(
  public.advance_due_orders('00000000-0000-4000-8000-000000000b11'),
  2,
  '读时推进：只推进该用户的到点订单，返回实际推进条数'
);
select ok(
  (select status = 'pickup' and completed_at is null
     from public.orders where order_number = '202609030900000011'),
  '到点订单推进为待取餐、完成时间为空'
);
select is(
  (select pickup_code || '/' || pickup_code_date::text
     from public.orders where order_number = '202609030900000011'),
  'D-0001/' || (now() at time zone 'Asia/Shanghai')::date::text,
  '推进不改写「下单时写入的号与发号日期」（Story 4.4）'
);
select ok(
  (select status = 'cooking' and pickup_code = 'D-0003'
     from public.orders where order_number = '202609030900000013'),
  '未到点订单不被推进：状态与取杯号都不变'
);
select ok(
  (select status = 'pickup' and pickup_code = 'A-0009' and completed_at is null
     from public.orders where order_number = '202609030900000014'),
  '已待取餐的到点订单不被推进改动（不跳状态、不改号）'
);
select is(
  (select status::text from public.orders where order_number = '202609030900000015'),
  'cooking',
  '作用域：其他用户的到点订单不在本次调用内'
);
select is(
  (select count(*)::int from public.pickup_code_counters
    where store_id = '00000000-0000-4000-8000-000000000a01'
      and local_date = (now() at time zone 'Asia/Shanghai')::date),
  0,
  '推进不消耗计数器：发号不再是推进的职责（Story 4.4）'
);
select is(
  public.advance_due_orders(),
  1,
  '兜底推进（不传用户）作用于全部到点订单'
);
select ok(
  (select status = 'pickup' and pickup_code = 'E-0001'
      and pickup_code_date = (now() at time zone 'Asia/Shanghai')::date
     from public.orders where order_number = '202609030900000015'),
  '推进后状态变化，取杯号仍是下单时写入的 E-0001'
);
select is(public.advance_due_orders(), 0, '重复执行兜底推进：没有可推进的订单，返回 0');
select is(
  (select pickup_code from public.orders where order_number = '202609030900000011'),
  'D-0001',
  '重复推进不改写取杯号（幂等、可重跑）'
);
select ok(
  (select prosrc not ilike '%interval%' from pg_proc
    where oid = 'public.advance_due_orders(uuid)'::regprocedure),
  '推进判断不含写死的时长：只比较 ready_at 与服务端时钟（AD-6）'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc ilike '%update public.orders%'),
  array['transition_order', 'urge_order'],
  'orders 的 UPDATE 只存在于「状态迁移」与「催单」两处（都是带状态谓词的原子更新，AD-6）'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc ilike '%set status%'),
  array['transition_order'],
  'orders.status 的写入仍只存在于 transition_order 一处（AD-6）'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc ilike '%allocate_pickup_code%'),
  array['create_order'],
  '发号调用只存在于下单函数一处：推进不再发号（Story 4.4、AD-7）'
);
select ok(
  (select prosrc not ilike '%pickup_code%' from pg_proc
    where oid = 'public.advance_due_orders(uuid)'::regprocedure),
  'advance_due_orders 源码不含取杯号：推进只做状态迁移（Story 4.4）'
);

select * from finish();

rollback;
