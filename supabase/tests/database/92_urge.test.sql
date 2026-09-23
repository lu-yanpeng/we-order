-- 催单加速（Story 4.3；FR-P2-12；AD-6、AD-12、AD-13、AD-21、AD-22）
-- 分工（避免重复）：
--   * order_error_code 的完整取值清单在 80_create_order.test.sql（本故事追加的两个取值已同步）；
--   * 「orders 的 UPDATE 只存在于推进与催单两处、status 写入仍唯一在 transition_order」在
--     90_advance.test.sql；
--   * 与推进的真并发单连接测不了，按 FR-P2-19 由 Story 4.6 收口 + 人工验证脚本给证据。
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

select plan(33);

-- ── 测试数据：两个门店（提前量不同）、两个用户、各状态订单 ───────────────────
-- Story 4.4 起订单在下单时已带号：样例直接写入号与发号日期，催单与推进都不改写它们。

delete from public.order_items;
delete from public.orders;
delete from public.pickup_code_counters;
delete from public.stores;

insert into public.stores (
  id, name, address, phone, timezone, ready_delay_seconds, urge_lead_seconds
)
values
  ('00000000-0000-4000-8000-000000000c01', '催单测试门店', '测试地址 A', '000-00000001',
   'Asia/Shanghai', 15, 7),
  ('00000000-0000-4000-8000-000000000c02', '第二门店', '测试地址 B', '000-00000002',
   'Asia/Shanghai', 15, 20);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000d11', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'urge-a@wechat.local', now()),
  ('00000000-0000-4000-8000-000000000d12', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'urge-b@wechat.local', now());

insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at
)
values
  -- e01 原定一小时后：催单应提前到 now()+7s（门店 A 的提前量）
  ('00000000-0000-4000-8000-000000000e01', '202609030910000001',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '催单测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'urge-a-future', 'Z-0003',
   (now() at time zone 'Asia/Shanghai')::date, now() + interval '1 hour', null, null),
  -- e02 原定 2 秒后（比提前量更早）：催单不得改动（取较早者）
  ('00000000-0000-4000-8000-000000000e02', '202609030910000002',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '催单测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'urge-a-soon', 'Z-0004',
   (now() at time zone 'Asia/Shanghai')::date, now() + interval '2 seconds', null, null),
  -- e03 已到点但还没被扫到：催单不改动、也不报错；随后由推进机制接管
  ('00000000-0000-4000-8000-000000000e03', '202609030910000003',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '催单测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'urge-a-overdue', 'Z-0005',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '5 seconds', null, null),
  -- e04 已待取餐：本人但状态不可催 → invalid_status（Story 4.5 起带自动完成时刻）
  ('00000000-0000-4000-8000-000000000e04', '202609030910000004',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '催单测试门店', '测试地址 A', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, 'urge-a-pickup', 'Z-0001',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 hour', null,
   now() + interval '30 seconds'),
  -- e05 已完成：本人但状态不可催 → invalid_status
  ('00000000-0000-4000-8000-000000000e05', '202609030910000005',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c01',
   '催单测试门店', '测试地址 A', '000-00000001',
   'completed', 'takeout', 2.00, 32.00, 'urge-a-completed', 'Z-0002',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '2 hours', now() - interval '1 hour',
   now() - interval '1 hour'),
  -- e06 用户 A 在第二门店：提前量读该门店的 20 秒
  ('00000000-0000-4000-8000-000000000e06', '202609030910000006',
   '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000c02',
   '第二门店', '测试地址 B', '000-00000002',
   'cooking', 'takeout', 2.00, 32.00, 'urge-a-store2', 'Z-0001',
   (now() at time zone 'Asia/Shanghai')::date, now() + interval '1 hour', null, null),
  -- e07 用户 B 的订单：A 催它应得到与「不存在」相同的结果
  ('00000000-0000-4000-8000-000000000e07', '202609030910000007',
   '00000000-0000-4000-8000-000000000d12', '00000000-0000-4000-8000-000000000c01',
   '催单测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 32.00, 'urge-b-other', 'Z-0006',
   (now() at time zone 'Asia/Shanghai')::date, now() + interval '1 hour', null, null);

-- ── 函数属性与权限：唯一催单入口，参数里没有时间/用户入口（AD-5、AD-21）─────

select ok(
  (select prosecdef from pg_proc where oid = 'public.urge_order(uuid)'::regprocedure),
  'urge_order 是 security definer'
);
select ok(
  (select 'search_path=""' = any(coalesce(proconfig, '{}')) from pg_proc
    where oid = 'public.urge_order(uuid)'::regprocedure),
  'urge_order 使用空 search_path'
);
select is(
  (select proargnames::text from pg_proc
    where oid = 'public.urge_order(uuid)'::regprocedure),
  '{p_order_id}',
  'urge_order 的参数只有订单 id——没有时间、用户与金额入口'
);
select is(
  (select pg_get_function_result(oid) from pg_proc
    where oid = 'public.urge_order(uuid)'::regprocedure),
  'jsonb',
  'urge_order 返回与下单共用的订单形状（jsonb，AD-22）'
);
select ok(
  not has_function_privilege('anon', 'public.urge_order(uuid)', 'EXECUTE'),
  '未认证没有催单入口'
);
select ok(
  has_function_privilege('authenticated', 'public.urge_order(uuid)', 'EXECUTE'),
  '已登录身份可以执行催单'
);

-- ── 错误类别：两个新取值存在（完整清单在 80_create_order.test.sql）────────────

select ok(
  'order_not_found' = any (
    select enumlabel::text from pg_enum where enumtypid = 'public.order_error_code'::regtype
  ),
  'order_error_code 含 order_not_found（非本人与不存在共用）'
);
select ok(
  'invalid_status' = any (
    select enumlabel::text from pg_enum where enumtypid = 'public.order_error_code'::regtype
  ),
  'order_error_code 含 invalid_status（状态不允许该操作）'
);

-- ── 入口身份：未认证连入口都没有；已登录但无身份则明确拒绝 ───────────────────

set local role anon;

select throws_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-0000000000ff') $$,
  '42501', null,
  '未认证不能执行 urge_order'
);

set local role authenticated;

select throws_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-0000000000ff') $$,
  'P0001', 'not_authenticated',
  '没有会话身份时拒绝催单（归属没有来源）'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000d11"}';

-- ── 本人制作中：提前到「催单时刻 + 门店配置的提前量」，不改状态（FR-P2-12）──

select ok(
  (select r ->> 'order_number' = '202609030910000001'
      and r ->> 'status' = 'cooking'
      and r ->> 'pickup_code' = 'Z-0003'
     from public.urge_order('00000000-0000-4000-8000-000000000e01') r),
  '催单返回与下单共用的订单形状：同一张单、状态仍制作中、取杯号不变'
);
select is(
  (select ready_at from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  now() + interval '7 seconds',
  '催单把推进时刻提前到「催单时刻 + 门店配置的 7 秒」（不是写死的默认 3 秒）'
);
select is(
  (select status::text from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  'cooking',
  '催单不改状态：订单没有直接变成待取餐'
);
select is(
  (select pickup_code from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  'Z-0003',
  '催单不改写取杯号：号在下单时已定死（Story 4.4）'
);
select ok(
  (select r ->> 'id' = '00000000-0000-4000-8000-000000000e01'
     from public.urge_order('00000000-0000-4000-8000-000000000e01') r),
  '重复催单返回成功，且还是同一张订单'
);
select is(
  (select ready_at from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  now() + interval '7 seconds',
  '重复催单既不会更早也不会更晚（min 语义）'
);

select lives_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-000000000e02') $$,
  '对「原定时刻更早」的订单催单不报错'
);
select is(
  (select ready_at from public.orders where id = '00000000-0000-4000-8000-000000000e02'),
  now() + interval '2 seconds',
  '原定时刻比「催单时刻 + 提前量」更早时，催单不改动它（取较早者）'
);

select lives_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-000000000e03') $$,
  '对已到点但未被扫到的订单催单不报错'
);
select is(
  (select ready_at from public.orders where id = '00000000-0000-4000-8000-000000000e03'),
  now() - interval '5 seconds',
  '已到点的订单：催单按 min 取原定时刻，不改动也不报错'
);

select lives_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-000000000e06') $$,
  '第二门店的订单可以催单'
);
select is(
  (select ready_at from public.orders where id = '00000000-0000-4000-8000-000000000e06'),
  now() + interval '20 seconds',
  '提前量按订单所属门店读取：第二门店是 20 秒'
);

-- ── 催单不推进；到点后的状态变更仍由推进机制完成（AD-6）─────────────────────

reset role;

select is(
  public.advance_due_orders(),
  1,
  '兜底推进只带走已到点的那一张：被催单的订单仍在制作中，推进机制不提前动手'
);
select is(
  (select status::text from public.orders where id = '00000000-0000-4000-8000-000000000e01'),
  'cooking',
  '被催单的订单不会因为催单本身变成待取餐'
);
select ok(
  (select status = 'pickup' and pickup_code = 'Z-0005'
      and pickup_code_date = (now() at time zone 'Asia/Shanghai')::date
     from public.orders where id = '00000000-0000-4000-8000-000000000e03'),
  '已到点的订单由推进机制照常推进：只改状态、不改写下单时的取杯号'
);

-- ── 拒绝语义：他人与不存在同结果；本人状态不可催给明确结果（AD-13）──────────

set local role authenticated;

select throws_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-000000000e07') $$,
  'P0001', 'order_not_found',
  '催他人的订单被拒绝'
);
select throws_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-0000000000ff') $$,
  'P0001', 'order_not_found',
  '催不存在的订单被拒绝'
);
select is(
  public.test_catch_error($$ select public.urge_order('00000000-0000-4000-8000-000000000e07') $$),
  public.test_catch_error($$ select public.urge_order('00000000-0000-4000-8000-0000000000ff') $$),
  '「他人的单」与「不存在的单」返回完全相同的拒绝，不泄露存在性'
);
select throws_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-000000000e04') $$,
  'P0001', 'invalid_status',
  '本人的已待取餐订单：明确的「当前状态不可催单」'
);
select throws_ok(
  $$ select public.urge_order('00000000-0000-4000-8000-000000000e05') $$,
  'P0001', 'invalid_status',
  '本人的已完成订单：明确的「当前状态不可催单」'
);
select throws_ok(
  $$ select public.urge_order(null) $$,
  'P0001', 'invalid_request',
  '订单 id 为空被拒绝'
);

-- 拒绝后的数据检查以库所有者身份读：以本人身份读他人的单会先被 RLS 挡住（Story 5.3 的边界）
reset role;

select is(
  (select ready_at from public.orders where id = '00000000-0000-4000-8000-000000000e07'),
  now() + interval '1 hour',
  '被拒绝时他人的订单没有任何改动（无部分写入）'
);
select ok(
  (select status = 'pickup' and pickup_code = 'Z-0001'
      and ready_at = now() - interval '1 hour'
     from public.orders where id = '00000000-0000-4000-8000-000000000e04'),
  '状态不可催的拒绝不改变订单：状态、取杯号与推进时刻都原样'
);

select * from finish();

rollback;
