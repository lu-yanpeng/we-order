-- 订单结构与写路径封闭：RLS 已启用、写权限不授予客户端、本人读作纵深防御（Story 3.1；FR-P2-9、FR-P2-18、AD-2、AD-3、AD-4、AD-21）
-- 断言描述都带对象名，失败时输出形如 "# Failed test 1: ..."，可定位到具体策略或约束。
-- 测试自带数据（门店、平台用户、商品），结束回滚；在重建后的空库上直接通过。
begin;

create extension if not exists pgtap with schema extensions;

select plan(52);

-- ── 结构：RLS 与策略 ───────────────────────────────────────────────────────

select ok(
  (select relrowsecurity from pg_class where oid = 'public.orders'::regclass),
  'orders 已启用 RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.order_items'::regclass),
  'order_items 已启用 RLS'
);
select is(
  (select policyname from pg_policies where schemaname = 'public' and tablename = 'orders'),
  'orders_own_read',
  'orders 只携带一条本人读策略'
);
select is(
  (select cmd from pg_policies where schemaname = 'public' and tablename = 'orders'),
  'SELECT',
  'orders 的唯一策略是 SELECT——不存在任何面向客户端的写策略'
);
select is(
  (select policyname from pg_policies where schemaname = 'public' and tablename = 'order_items'),
  'order_items_own_read',
  'order_items 只携带一条跟随订单的读策略'
);
select is(
  (select cmd from pg_policies where schemaname = 'public' and tablename = 'order_items'),
  'SELECT',
  'order_items 的唯一策略是 SELECT——不存在任何面向客户端的写策略'
);

-- ── 结构：列集合与类型 ─────────────────────────────────────────────────────

select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'),
  array['completed_at', 'created_at', 'dining_mode', 'id', 'idempotency_key', 'notes',
        'order_number', 'packaging_fee', 'pickup_code', 'ready_at', 'status',
        'store_address', 'store_id', 'store_name', 'store_phone', 'total_amount', 'user_id'],
  'orders 的列集合固定：归属、门店快照、金额、幂等标识与时间戳'
);
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'order_items'),
  array['id', 'order_id', 'product_id', 'product_name', 'quantity', 'selections',
        'spec_summary', 'unit_price'],
  'order_items 的列集合固定且不携带归属字段（AD-4）'
);
select is(
  (select array_agg(enumlabel::text order by enumsortorder) from pg_enum
    where enumtypid = 'public.order_status'::regtype),
  array['cooking', 'pickup', 'completed'],
  'order_status 取值只有 cooking/pickup/completed'
);
select is(
  (select array_agg(enumlabel::text order by enumsortorder) from pg_enum
    where enumtypid = 'public.dining_mode'::regtype),
  array['dinein', 'takeout'],
  'dining_mode 取值只有 dinein/takeout'
);
select is(
  (select array_agg(attname::text order by attname) from pg_attribute
    where attrelid = 'public.orders'::regclass
      and attname in ('packaging_fee', 'total_amount')
      and format_type(atttypid, atttypmod) = 'numeric(10,2)'),
  array['packaging_fee', 'total_amount'],
  '订单金额列都是 numeric(10,2)（AD-8）'
);
select is(
  (select format_type(atttypid, atttypmod) from pg_attribute
    where attrelid = 'public.order_items'::regclass and attname = 'unit_price'),
  'numeric(10,2)',
  'order_items.unit_price 是 numeric(10,2)'
);
select is(
  (select array_agg(attname::text order by attname) from pg_attribute
    where attrelid = 'public.orders'::regclass
      and attname in ('completed_at', 'created_at', 'ready_at')
      and format_type(atttypid, atttypmod) = 'timestamp with time zone'),
  array['completed_at', 'created_at', 'ready_at'],
  '订单时间列都是 timestamptz（AD-10）'
);
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id, idempotency_key)'),
  1,
  '幂等唯一域是 (user_id, idempotency_key)（AD-11）'
);
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (order_number)'),
  1,
  '订单号全局唯一（FR-P2-9）'
);
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'f'
      and confrelid = 'auth.users'::regclass),
  'c',
  '平台用户被删除时订单级联删除'
);

-- ── 结构：约束行为（作为表所有者写入，验证不变量真实生效）──────────────────

insert into public.stores (id, name, address, phone, timezone)
values ('00000000-0000-4000-8000-000000000f01', '测试门店', '测试地址 1 号', '000-00000000', 'Asia/Shanghai');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000f11', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'order-fixture-1@wechat.local', now()),
  ('00000000-0000-4000-8000-000000000f12', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'order-fixture-2@wechat.local', now());

insert into public.categories (id, name)
values ('00000000-0000-4000-8000-000000000f21', '测试分类');

insert into public.products (id, category_id, name, price)
values ('00000000-0000-4000-8000-000000000f22', '00000000-0000-4000-8000-000000000f21', '测试商品', 30.00);

select lives_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, idempotency_key, ready_at)
     values
       ('SG00000001', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'takeout', 2.00, 44.00, 'key-1', now()) $$,
  '下层服务端函数可写入的订单形状：合法行写入成功'
);
select is(
  (select status from public.orders where order_number = 'SG00000001'),
  'cooking'::public.order_status,
  '新订单默认状态为 cooking'
);
select is(
  (select pickup_code from public.orders where order_number = 'SG00000001'),
  null::text,
  '未进入待取餐时取杯号为空值而不是空串'
);
select is(
  (select notes from public.orders where order_number = 'SG00000001'),
  '无备注要求',
  '未传备注时落库为「无备注要求」'
);
select lives_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        status, dining_mode, packaging_fee, total_amount, idempotency_key, pickup_code, ready_at)
     values
       ('SG00000002', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'pickup', 'dinein', 0.00, 30.00, 'key-2', 'A-0008', now()) $$,
  '字母 + 四位数字的取杯号可写入（A-0008）'
);
select lives_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, notes, idempotency_key, ready_at)
     values
       ('SG00000003', '00000000-0000-4000-8000-000000000f12', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'takeout', 2.00, 32.00, '不要糖', 'key-1', now()) $$,
  '幂等标识按用户区分：其他用户可用同一标识'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        status, dining_mode, packaging_fee, total_amount, idempotency_key, pickup_code, ready_at)
     values
       ('SG00000004', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'cooking', 'takeout', 2.00, 32.00, 'key-4', 'A-0001', now()) $$,
  '23514', null, '制作中的订单不能携带取杯号'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        status, dining_mode, packaging_fee, total_amount, idempotency_key, ready_at)
     values
       ('SG00000005', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'pickup', 'takeout', 2.00, 32.00, 'key-5', now()) $$,
  '23514', null, '待取餐的订单必须有取杯号'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        status, dining_mode, packaging_fee, total_amount, idempotency_key, pickup_code, ready_at)
     values
       ('SG00000006', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'completed', 'takeout', 2.00, 32.00, 'key-6', 'A-0002', now()) $$,
  '23514', null, '已完成的订单必须有完成时间'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, idempotency_key, ready_at, completed_at)
     values
       ('SG00000007', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'takeout', 2.00, 32.00, 'key-7', now(), now()) $$,
  '23514', null, '制作中的订单不能有完成时间'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        status, dining_mode, packaging_fee, total_amount, idempotency_key, pickup_code, ready_at)
     values
       ('SG00000008', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'pickup', 'takeout', 2.00, 32.00, 'key-8', 'A-08', now()) $$,
  '23514', null, '两位数字的取杯号被拒绝（外形为字母 + 四位数字）'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, idempotency_key, ready_at)
     values
       ('SG1234', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'takeout', 2.00, 32.00, 'key-9', now()) $$,
  '23514', null, '订单号必须形如 SG + 8 位数字'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, notes, idempotency_key, ready_at)
     values
       ('SG00000010', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'takeout', 2.00, 32.00, '', 'key-10', now()) $$,
  '23514', null, '备注不能是空串'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, idempotency_key, ready_at)
     values
       ('SG00000001', '00000000-0000-4000-8000-000000000f12', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'takeout', 2.00, 32.00, 'key-11', now()) $$,
  '23505', null, '订单号全局唯一'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, idempotency_key, ready_at)
     values
       ('SG00000012', '00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f01',
        '测试门店', '测试地址 1 号', '000-00000000',
        'takeout', 2.00, 32.00, 'key-1', now()) $$,
  '23505', null, '同一用户的幂等标识只能落一张订单（AD-11）'
);
select lives_ok(
  $$ insert into public.order_items
       (order_id, product_id, product_name, spec_summary, selections, unit_price, quantity)
     values
       ((select id from public.orders where order_number = 'SG00000001'),
        '00000000-0000-4000-8000-000000000f22', '测试商品', '大杯 / 冰', '{"g1":"o1"}'::jsonb, 30.00, 1) $$,
  '合法明细写入成功'
);
select throws_ok(
  $$ insert into public.order_items
       (order_id, product_id, product_name, spec_summary, selections, unit_price, quantity)
     values
       ((select id from public.orders where order_number = 'SG00000001'),
        '00000000-0000-4000-8000-000000000f22', '测试商品', '大杯 / 冰', '{"g1":"o1"}'::jsonb, 30.00, 0) $$,
  '23514', null, '明细数量必须为正整数'
);
select throws_ok(
  $$ insert into public.order_items
       (order_id, product_id, product_name, spec_summary, selections, unit_price, quantity)
     values
       ((select id from public.orders where order_number = 'SG00000001'),
        '00000000-0000-4000-8000-000000000f22', '测试商品', '大杯 / 冰', '[]'::jsonb, 30.00, 1) $$,
  '23514', null, '规格选择快照必须是 JSON 对象（AD-22）'
);
select throws_ok(
  $$ insert into public.order_items
       (order_id, product_id, product_name, spec_summary, selections, unit_price, quantity)
     values
       ('00000000-0000-4000-8000-000000000fff',
        '00000000-0000-4000-8000-000000000f22', '测试商品', '大杯 / 冰', '{}'::jsonb, 30.00, 1) $$,
  '23503', null, '明细必须挂在存在的订单上'
);

-- ── 客户端边界：未认证完全不可达 ───────────────────────────────────────────

set local role anon;

select throws_ok(
  'select * from public.orders',
  '42501', null, '未认证不能读取 orders'
);
select throws_ok(
  'select * from public.order_items',
  '42501', null, '未认证不能读取 order_items'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, dining_mode, ready_at)
     values ('SG99999999', gen_random_uuid(), gen_random_uuid(), 'dinein', now()) $$,
  '42501', null, '未认证不能写入 orders'
);
select throws_ok(
  'update public.orders set total_amount = 0',
  '42501', null, '未认证不能修改 orders'
);
select throws_ok(
  'delete from public.orders',
  '42501', null, '未认证不能删除 orders'
);
select throws_ok(
  $$ insert into public.order_items
       (order_id, product_id, product_name, spec_summary, selections, unit_price, quantity)
     values (gen_random_uuid(), gen_random_uuid(), 'x', 'x', '{}'::jsonb, 1.00, 1) $$,
  '42501', null, '未认证不能写入 order_items'
);

-- ── 客户端边界：已登录可读本人、不可写 ─────────────────────────────────────

set local role authenticated;

select lives_ok(
  'select * from public.orders',
  '已登录身份可以执行 orders 查询（可见范围由策略决定）'
);
select is(
  (select count(*)::int from public.orders),
  0,
  '无会话身份时看不到任何订单（策略默认拒绝，claim 注入见 Epic 5）'
);
select lives_ok(
  'select * from public.order_items',
  '已登录身份可以执行 order_items 查询（策略随所属订单）'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, dining_mode, ready_at)
     values ('SG99999998', gen_random_uuid(), gen_random_uuid(), 'dinein', now()) $$,
  '42501', null, '已登录身份不能写入 orders'
);
select throws_ok(
  'update public.orders set total_amount = 0',
  '42501', null, '已登录身份不能修改 orders'
);
select throws_ok(
  'delete from public.orders',
  '42501', null, '已登录身份不能删除 orders'
);
select throws_ok(
  $$ insert into public.order_items
       (order_id, product_id, product_name, spec_summary, selections, unit_price, quantity)
     values (gen_random_uuid(), gen_random_uuid(), 'x', 'x', '{}'::jsonb, 1.00, 1) $$,
  '42501', null, '已登录身份不能写入 order_items'
);
select throws_ok(
  'update public.order_items set unit_price = 0',
  '42501', null, '已登录身份不能修改 order_items'
);
select throws_ok(
  'delete from public.order_items',
  '42501', null, '已登录身份不能删除 order_items'
);

reset role;

-- ── 级联删除：订单删除时明细不残留 ─────────────────────────────────────────

select lives_ok(
  $$ insert into public.order_items
       (order_id, product_id, product_name, spec_summary, selections, unit_price, quantity)
     values
       ((select id from public.orders where order_number = 'SG00000002'),
        '00000000-0000-4000-8000-000000000f22', '测试商品', '标准', '{}'::jsonb, 30.00, 1) $$,
  '明细可以挂在订单上（级联删除的前置）'
);
select lives_ok(
  $$ delete from public.orders where order_number = 'SG00000002' $$,
  '删除订单时明细级联删除（不存在孤儿明细）'
);

select * from finish();

rollback;
