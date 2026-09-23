-- 确认取杯与超时自动完成（Story 4.5；FR-P2-13；AD-5、AD-6、AD-13、AR-13、AR-17）
-- 分工（避免重复）：
--   * transition_order 的两条合法迁移、归属谓词、参数形状与「推进只做状态迁移」在 90_advance.test.sql；
--   * order_error_code 的完整取值清单在 80_create_order.test.sql（本故事不新增取值）；
--   * 与推进/兜底的真并发单连接测不了，按 FR-P2-19 以「实现方式说明 + 人工验证记录」作证据
--     （scripts/verify-complete.ts 的并发确认轮与超时轮）。
-- 自带数据（事务内清空订单、门店与取杯号计数器后插入样例），结束回滚；不依赖种子。
-- 订单 id 显式指定：测试自己插的行自己知道 id，不依赖查询（以本人身份也查不到他人的单——RLS）。
-- 断言描述都带对象名，失败时输出形如 "# Failed test 1: ..."，可定位到具体函数或约束。

begin;

create extension if not exists pgtap with schema extensions;

-- 测试辅助：以调用者身份执行一段 SQL，把异常转成 "SQLSTATE 消息" 文本，
-- 用于断言两种拒绝（他人的单 / 不存在的单）返回的结果完全一致、不可区分。
create function public.test_catch_error(p_sql text) returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function public.test_catch_error(text) to authenticated;

select plan(54);

-- ── 测试数据：两个门店（自动完成时长不同）、两个用户、各状态订单 ──────────────
-- Story 4.5 起「非制作中」的订单必须携带自动完成时刻（结构约束）：样例直接写入，
-- 制作中的样例为空值；引擎用例（e06/e08）从制作中出发，由 transition_order 自己写。
-- e01/e07 未到自动完成时刻，e02/e03 已到点；e06/e08 用来证明时刻按门店配置计算。

delete from public.order_items;
delete from public.orders;
delete from public.pickup_code_counters;
delete from public.stores;

insert into public.stores (
  id, name, address, phone, timezone, ready_delay_seconds, auto_complete_seconds
)
values
  ('00000000-0000-4000-8000-000000000c01', '自动完成测试门店', '测试地址 A', '000-00000001',
   'Asia/Shanghai', 15, 7),
  ('00000000-0000-4000-8000-000000000c02', '第二门店', '测试地址 B', '000-00000002',
   'Asia/Shanghai', 15, 20);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000d11', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'complete-a@wechat.local', now()),
  ('00000000-0000-4000-8000-000000000d12', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'complete-b@wechat.local', now());

insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at
)
values
  -- e01 待取餐、未到自动完成时刻：用于手动确认（确认不要求到点）
  ('00000000-0000-4000-8000-000000000e01', '202609030920000001',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '自动完成测试门店', '测试地址 A', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, 'complete-a-waiting', 'Y-0001',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 hour', null,
   now() + interval '30 seconds'),
  -- e02 待取餐、已到自动完成时刻：用户 A 的兜底对象
  ('00000000-0000-4000-8000-000000000e02', '202609030920000002',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '自动完成测试门店', '测试地址 A', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, 'complete-a-due', 'Y-0002',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 hour', null,
   now() - interval '1 second'),
  -- e03 待取餐、已到点、用户 B：A 确认它必须与「不存在」同结果；兜底按用户区分作用域
  ('00000000-0000-4000-8000-000000000e03', '202609030920000003',
   '00000000-0000-4000-8000-000000000d12', '00000000-0000-4000-8000-000000000c01',
   '自动完成测试门店', '测试地址 A', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, 'complete-b-due', 'Y-0003',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 hour', null,
   now() - interval '1 second'),
  -- e04 制作中：确认得到明确的 invalid_status
  ('00000000-0000-4000-8000-000000000e04', '202609030920000004',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '自动完成测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'complete-a-cooking', 'Y-0004',
   (now() at time zone 'Asia/Shanghai')::date, now() + interval '1 hour', null, null),
  -- e05 已完成：重复确认与兜底扫描都不得改写完成时间
  ('00000000-0000-4000-8000-000000000e05', '202609030920000005',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '自动完成测试门店', '测试地址 A', '000-00000001',
   'completed', 'takeout', 2.00, 32.00, 'complete-a-completed', 'Y-0005',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '2 hours', now() - interval '1 hour',
   now() - interval '1 hour'),
  -- e06 制作中（第二门店）：由引擎迁移，验证时刻按门店配置的 20 秒
  ('00000000-0000-4000-8000-000000000e06', '202609030920000006',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c02',
   '第二门店', '测试地址 B', '000-00000002',
   'cooking', 'takeout', 2.00, 32.00, 'complete-a-store2-cooking', 'Y-0001',
   (now() at time zone 'Asia/Shanghai')::date, now(), null, null),
  -- e07 待取餐（第二门店）、未到点：验证「改配置不影响已出的单」
  ('00000000-0000-4000-8000-000000000e07', '202609030920000007',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c02',
   '第二门店', '测试地址 B', '000-00000002',
   'pickup', 'takeout', 2.00, 32.00, 'complete-a-store2-pickup', 'Y-0002',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 hour', null,
   now() + interval '20 seconds'),
  -- e08 制作中（第一门店）：由引擎迁移，验证时刻按门店配置的 7 秒、不是默认 30
  ('00000000-0000-4000-8000-000000000e08', '202609030920000008',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '自动完成测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'complete-a-store1-cooking', 'Y-0006',
   (now() at time zone 'Asia/Shanghai')::date, now(), null, null);

-- ── 函数属性与权限：用户入口唯一、内部机制不暴露（AD-5、AD-21）───────────────

select ok(
  (select prosecdef from pg_proc where oid = 'public.complete_order(uuid)'::regprocedure),
  'complete_order 是 security definer'
);
select ok(
  (select 'search_path=""' = any(coalesce(proconfig, '{}')) from pg_proc
    where oid = 'public.complete_order(uuid)'::regprocedure),
  'complete_order 使用空 search_path'
);
select is(
  (select proargnames::text from pg_proc
    where oid = 'public.complete_order(uuid)'::regprocedure),
  '{p_order_id}',
  'complete_order 的参数只有订单 id——没有时间、用户与凭证入口'
);
select is(
  (select pg_get_function_result(oid) from pg_proc
    where oid = 'public.complete_order(uuid)'::regprocedure),
  'jsonb',
  'complete_order 返回与下单/催单共用的订单形状（jsonb，AD-22）'
);
select ok(
  (select prosrc ilike '%transition_order%' from pg_proc
    where oid = 'public.complete_order(uuid)'::regprocedure),
  'complete_order 的完成写入走 transition_order 同一处实现（AD-6）'
);
select ok(
  not has_function_privilege('anon', 'public.complete_order(uuid)', 'EXECUTE'),
  '未认证没有确认取杯入口'
);
select ok(
  has_function_privilege('authenticated', 'public.complete_order(uuid)', 'EXECUTE'),
  '已登录身份可以确认取杯'
);

select ok(
  (select prosecdef from pg_proc
    where oid = 'public.complete_due_orders(uuid)'::regprocedure),
  'complete_due_orders 是 security definer'
);
select ok(
  (select 'search_path=""' = any(coalesce(proconfig, '{}')) from pg_proc
    where oid = 'public.complete_due_orders(uuid)'::regprocedure),
  'complete_due_orders 使用空 search_path'
);
select is(
  (select proargnames::text from pg_proc
    where oid = 'public.complete_due_orders(uuid)'::regprocedure),
  '{p_user_id}',
  'complete_due_orders 的参数只有用户作用域——缺省即全部超时订单'
);
select is(
  (select pg_get_function_result(oid) from pg_proc
    where oid = 'public.complete_due_orders(uuid)'::regprocedure),
  'integer',
  'complete_due_orders 返回实际完成条数'
);
select ok(
  (select prosrc ilike '%transition_order%' from pg_proc
    where oid = 'public.complete_due_orders(uuid)'::regprocedure),
  'complete_due_orders 与确认取杯共用 transition_order 同一处实现（AD-6）'
);
select ok(
  not has_function_privilege('anon', 'public.complete_due_orders(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.complete_due_orders(uuid)', 'EXECUTE'),
  '兜底机制对客户端不暴露（与 advance_due_orders 同，AD-21）'
);

-- ── 结构约束：不在制作中 ⇔ 有自动完成时刻（Story 4.5）───────────────────────

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_auto_complete_check' and contype = 'c'),
  1,
  '存在 orders_auto_complete_check 约束（不在制作中 ⇔ 有自动完成时刻）'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        status, dining_mode, packaging_fee, total_amount, idempotency_key,
        pickup_code, pickup_code_date, ready_at)
     values
       ('202609030920000097', '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
        '自动完成测试门店', '测试地址 A', '000-00000001',
        'pickup', 'takeout', 2.00, 32.00, 'missing-deadline', 'Y-0007',
        (now() at time zone 'Asia/Shanghai')::date, now()) $$,
  '23514', null,
  '待取餐却没有自动完成时刻被拒绝：不可能永久挂在待取餐'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, idempotency_key,
        pickup_code, pickup_code_date, ready_at, auto_complete_at)
     values
       ('202609030920000098', '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
        '自动完成测试门店', '测试地址 A', '000-00000001',
        'takeout', 2.00, 32.00, 'cooking-with-deadline', 'Y-0008',
        (now() at time zone 'Asia/Shanghai')::date, now(), now() + interval '30 seconds') $$,
  '23514', null,
  '制作中却带自动完成时刻被拒绝：时刻只属于已出杯的单'
);
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'orders'
      and indexname = 'orders_auto_complete_idx'),
  1,
  '存在超时扫描的部分索引：只索引「待取餐」的到点判定（NFR1）'
);

-- ── 进入待取餐：自动完成时刻与状态在同一条更新里、按门店配置写入（AD-6）──────

select is(
  (select (public.transition_order('00000000-0000-4000-8000-000000000e06',
                                   'cooking', 'pickup')).status::text),
  'pickup',
  'transition_order 执行 cooking→pickup（第二门店）'
);
select is(
  (select auto_complete_at from public.orders where id = '00000000-0000-4000-8000-000000000e06'),
  now() + interval '20 seconds',
  '自动完成时刻 = 进入待取餐时刻 + 门店配置的 20 秒（不是写死的默认 30 秒）'
);
select is(
  (select (public.transition_order('00000000-0000-4000-8000-000000000e08',
                                   'cooking', 'pickup')).status::text),
  'pickup',
  'transition_order 执行 cooking→pickup（第一门店）'
);
select is(
  (select auto_complete_at from public.orders where id = '00000000-0000-4000-8000-000000000e08'),
  now() + interval '7 seconds',
  '自动完成时刻按订单所属门店读取：第一门店是 7 秒'
);

-- ── 入口身份：未认证连入口都没有；已登录但无身份则明确拒绝 ───────────────────

set local role anon;

select throws_ok(
  $$ select public.complete_order('00000000-0000-4000-8000-000000000e01') $$,
  '42501', null,
  '未认证不能执行 complete_order'
);

set local role authenticated;

select throws_ok(
  $$ select public.complete_order('00000000-0000-4000-8000-000000000e01') $$,
  'P0001', 'not_authenticated',
  '没有会话身份时拒绝确认取杯（归属没有来源）'
);
select throws_ok(
  $$ select public.complete_due_orders() $$,
  '42501', null,
  '已登录身份不能直接执行兜底机制'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000d11"}';

-- ── 确认取杯：成功路径与共享形状（FR-P2-13、AD-22）──────────────────────────

select is(
  (select array_agg(k order by k) from public.complete_order('00000000-0000-4000-8000-000000000e01') r,
   jsonb_object_keys(r) k),
  array['created_at', 'dining_mode', 'id', 'notes', 'order_number', 'packaging_fee',
        'pickup_code', 'status', 'total_amount'],
  '确认取杯返回与下单/催单同一份订单形状（字段集合一致）'
);
select ok(
  (select r ->> 'status' = 'completed'
      and r ->> 'order_number' = '202609030920000001'
      and r ->> 'pickup_code' = 'Y-0001'
     from public.complete_order('00000000-0000-4000-8000-000000000e01') r),
  '重复确认返回成功，且还是同一张订单（幂等）'
);
select ok(
  (select status = 'completed' and completed_at = now()
      and pickup_code = 'Y-0001' and auto_complete_at = now() + interval '30 seconds'
     from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  '确认后：状态已完成、完成时间取服务端时钟；取杯号与自动完成时刻都不被改写'
);

-- ── 拒绝语义：他人与不存在同结果；本人未到待取餐给明确结果（AD-13）──────────

select throws_ok(
  $$ select public.complete_order('00000000-0000-4000-8000-000000000e04') $$,
  'P0001', 'invalid_status',
  '本人的制作中订单：明确的「当前状态不可确认取杯」'
);
select throws_ok(
  $$ select public.complete_order('00000000-0000-4000-8000-000000000e03') $$,
  'P0001', 'order_not_found',
  '确认他人的订单被拒绝'
);
select throws_ok(
  $$ select public.complete_order('00000000-0000-4000-8000-0000000000ff') $$,
  'P0001', 'order_not_found',
  '确认不存在的订单被拒绝'
);
select is(
  public.test_catch_error($$ select public.complete_order('00000000-0000-4000-8000-000000000e03') $$),
  public.test_catch_error($$ select public.complete_order('00000000-0000-4000-8000-0000000000ff') $$),
  '「他人的单」与「不存在的单」返回完全相同的拒绝，不泄露存在性'
);
select throws_ok(
  $$ select public.complete_order(null) $$,
  'P0001', 'invalid_request',
  '订单 id 为空被拒绝'
);

-- 拒绝后的数据检查以库所有者身份读：以本人身份读他人的单会先被 RLS 挡住
reset role;

select ok(
  (select status = 'cooking' and completed_at is null and auto_complete_at is null
     from public.orders where id = '00000000-0000-4000-8000-000000000e04'),
  '状态不可确认的拒绝不改变订单：状态、完成时间与自动完成时刻都原样'
);
select ok(
  (select status = 'pickup' and completed_at is null
      and auto_complete_at = now() - interval '1 second' and pickup_code = 'Y-0003'
     from public.orders where id = '00000000-0000-4000-8000-000000000e03'),
  '被拒绝时他人的订单没有任何改动（无部分写入）'
);

-- ── 重复确认与确认已完成的订单：目标状态已达成即成功、不改写完成时间（AD-13）──

-- 把完成时间改成一个可辨认的历史值：重复确认若改写了它，下面的断言就会失败
update public.orders set completed_at = timestamptz '2026-09-01 00:00:00+08'
 where id = '00000000-0000-4000-8000-000000000e01';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000d11"}';

select ok(
  (select r ->> 'status' = 'completed'
     from public.complete_order('00000000-0000-4000-8000-000000000e01') r),
  '重复确认不报错：目标状态已达成时返回成功'
);
select is(
  (select completed_at from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  '2026-09-01 00:00:00+08'::timestamptz,
  '重复确认不修改完成时间'
);
select ok(
  (select r ->> 'status' = 'completed' and r ->> 'order_number' = '202609030920000005'
     from public.complete_order('00000000-0000-4000-8000-000000000e05') r),
  '确认一张已完成的订单同样返回成功'
);
select is(
  (select completed_at from public.orders where id = '00000000-0000-4000-8000-000000000e05'),
  now() - interval '1 hour',
  '已完成的订单：完成时间不被确认改写成当前时刻'
);

-- ── 超时兜底：按用户作用域、只完成到点的待取餐单（FR-P2-13、AD-6）────────────

reset role;

select is(
  public.complete_due_orders('00000000-0000-4000-8000-000000000d11'),
  1,
  '读时兜底：只完成该用户到点的订单（e02），返回实际完成条数'
);
select ok(
  (select status = 'completed' and completed_at = now()
      and pickup_code = 'Y-0002' and auto_complete_at = now() - interval '1 second'
     from public.orders where id = '00000000-0000-4000-8000-000000000e02'),
  '超时自动完成：状态变已完成、完成时间取服务端时钟；取杯号与自动完成时刻都不被改写'
);
select is(
  (select status::text from public.orders where id = '00000000-0000-4000-8000-000000000e03'),
  'pickup',
  '作用域：其他用户的到点订单不在本次调用内'
);
select is(
  (select status::text from public.orders where id = '00000000-0000-4000-8000-000000000e04'),
  'cooking',
  '制作中的订单不参与超时完成：它没有自动完成时刻'
);
select is(
  (select status::text from public.orders where id = '00000000-0000-4000-8000-000000000e07'),
  'pickup',
  '未到点的待取餐订单不被完成'
);
select is(
  public.complete_due_orders('00000000-0000-4000-8000-000000000d11'),
  0,
  '重复执行读时兜底：已完成的订单不再被选中（幂等、可重跑）'
);
select is(
  (select completed_at from public.orders where id = '00000000-0000-4000-8000-000000000e05'),
  now() - interval '1 hour',
  '兜底扫描不改写已完成订单的完成时间（重跑不破坏已有数据）'
);
select is(
  public.complete_due_orders(),
  1,
  '兜底完成（不传用户）作用于全部用户的超时订单'
);
select ok(
  (select status = 'completed' and completed_at = now() and pickup_code = 'Y-0003'
     from public.orders where id = '00000000-0000-4000-8000-000000000e03'),
  '其他用户的超时订单由兜底完成：取杯号不被改写'
);
select is(
  public.complete_due_orders(),
  0,
  '重复执行兜底完成：没有可完成的订单，返回 0'
);

-- ── 确认一张已由超时自动完成的订单：成功且不改写完成时间（FR-P2-13）──────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000d11"}';

select ok(
  (select r ->> 'status' = 'completed'
     from public.complete_order('00000000-0000-4000-8000-000000000e02') r),
  '确认一张已由超时自动完成的订单：返回成功'
);
select is(
  (select completed_at from public.orders where id = '00000000-0000-4000-8000-000000000e02'),
  now(),
  '自动完成的订单：确认不改写完成时间（仍是最早落库的那次）'
);

-- ── 改配置不影响已出的单（AD-6、FR-P2-13）───────────────────────────────────

reset role;

update public.stores set auto_complete_seconds = 600
 where id = '00000000-0000-4000-8000-000000000c02';

select is(
  (select auto_complete_at from public.orders where id = '00000000-0000-4000-8000-000000000e06'),
  now() + interval '20 seconds',
  '改门店配置不重算已进入待取餐订单的自动完成时刻（时刻是落库数据，不是派生值）'
);

-- 把 e07 的落库时刻拨到过去（它现在已经到点）：扫描按库内时刻完成它，而不是按新配置的 600 秒
update public.orders set auto_complete_at = now() - interval '1 second'
 where id = '00000000-0000-4000-8000-000000000e07';

select is(
  public.complete_due_orders(),
  1,
  '自动完成只看落库时刻：配置已改大，已到点的订单仍被完成'
);
select ok(
  (select status = 'completed' and pickup_code = 'Y-0002'
     from public.orders where id = '00000000-0000-4000-8000-000000000e07'),
  '被配置变更之后的扫描完成的订单：取杯号不被改写'
);
select is(
  (select status::text from public.orders where id = '00000000-0000-4000-8000-000000000e06'),
  'pickup',
  '未到点（20 秒后）的订单不被新配置提前影响'
);

select * from finish();

rollback;
