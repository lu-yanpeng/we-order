-- 归属隔离与策略边界（Story 5.3；FR-P2-18、FR-P2-19；AD-2、AD-3、AD-4、AD-21；AR-5、AR-12、AR-18、AR-20）
-- 覆盖：三类边界（他人数据不可见 / 他人数据不可写 / 未认证不可读；两个身份 + 一个未认证身份同场）、
--       归属两处表达（RLS 策略与函数内部谓词）的等价性（订单可见集合逐行相同、明细行数一致）、
--       发布密钥视角（匿名角色）的攻击面：读不到订单、写不进一张金额自定的订单、
--       内部表完全不可达（零策略 + 默认授权已撤销）、全表盘点（逐张确认 RLS 启用）。
-- 分工（避免重复）：
--   * 各对象的深度断言在各自的故事文件：10_catalog / 20_stores / 30_storage / 50_wechat_identities /
--     60_orders / 90_advance / 95_order_list / 96_order_detail；本文件是跨故事收口，
--     把边界串成一条完整证据，并补上「等价性」与「全表盘点」两个此前无人覆盖的缺口。
--   * 客户端交付物中不存在服务端密钥属人工核对（仓库级搜索），不在数据库测试内（Story 5.3 末条）。
-- 自带数据（事务内清空订单、计数器、门店、商品、分类后插入样例），结束回滚；不依赖种子。
-- 模拟身份沿用既有写法：角色切换 + request.jwt.claims 注入（写法不写入契约，见 AD-19）。
-- 发布密钥在数据库测试中的对应物是匿名角色：只有发布密钥的请求以 anon 身份到达 PostgREST（AD-16）。

begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

-- ── 测试数据 ────────────────────────────────────────────────────────────────
-- 身份 A（主测，两条订单、三条明细）、身份 B（他人，一条订单、一条明细）。
-- 订单全部为「已完成」且时间字段固定：本文件的断言只关心可见行集合，不涉及读时推进。

delete from public.order_items;
delete from public.orders;
delete from public.pickup_code_counters;
delete from public.stores;
delete from public.products;
delete from public.categories;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-00000000c011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'isolation-a@wechat.local', now()),
  ('00000000-0000-4000-8000-00000000c012', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'isolation-b@wechat.local', now());

insert into public.stores (id, name, address, phone, timezone, ready_delay_seconds, auto_complete_seconds)
values
  ('00000000-0000-4000-8000-0000000f0001', '隔离测试门店', '测试地址 1 号', '000-00000001',
   'Asia/Shanghai', 15, 30);

insert into public.categories (id, name, sort_order)
values ('00000000-0000-4000-8000-0000000f0002', '隔离测试分类', 0);

insert into public.products (id, category_id, name, price)
values ('00000000-0000-4000-8000-0000000f0003', '00000000-0000-4000-8000-0000000f0002', '拿铁', 30.00);

-- A 的两条订单：a1（两条明细）、a2（一条明细）
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-0000000a0001', '202609010000010001',
   '00000000-0000-4000-8000-00000000c011', '00000000-0000-4000-8000-0000000f0001',
   '隔离测试门店', '测试地址 1 号', '000-00000001',
   'completed', 'dinein', 0.00, 60.00, '无备注要求', 'iso-a1', 'C-0001', '2026-09-01',
   '2026-09-01 10:00:15+08', '2026-09-01 10:00:45+08', '2026-09-01 10:00:45+08',
   '2026-09-01 10:00:00+08'),
  ('00000000-0000-4000-8000-0000000a0002', '202609010000010002',
   '00000000-0000-4000-8000-00000000c011', '00000000-0000-4000-8000-0000000f0001',
   '隔离测试门店', '测试地址 1 号', '000-00000001',
   'completed', 'takeout', 2.00, 62.00, '无备注要求', 'iso-a2', 'C-0002', '2026-09-01',
   '2026-09-01 09:00:15+08', '2026-09-01 09:00:45+08', '2026-09-01 09:00:45+08',
   '2026-09-01 09:00:00+08');

-- B 的一条订单
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-0000000b0001', '202609010000020001',
   '00000000-0000-4000-8000-00000000c012', '00000000-0000-4000-8000-0000000f0001',
   '隔离测试门店', '测试地址 1 号', '000-00000001',
   'completed', 'dinein', 0.00, 30.00, '无备注要求', 'iso-b1', 'D-0001', '2026-09-01',
   '2026-09-01 11:00:15+08', '2026-09-01 11:00:45+08', '2026-09-01 11:00:45+08',
   '2026-09-01 11:00:00+08');

-- 明细：a1 两条（行数 2）、a2 一条（行数 1）、b1 一条——行数故意不同，明细隔离错位即可暴露
insert into public.order_items (
  id, order_id, product_id, product_name, spec_summary, selections, unit_price, quantity
)
values
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000a0001',
   '00000000-0000-4000-8000-0000000f0003', '拿铁', '大杯', '{}'::jsonb, 33.00, 1),
  ('00000000-0000-4000-8000-0000000e0002', '00000000-0000-4000-8000-0000000a0001',
   '00000000-0000-4000-8000-0000000f0003', '美式', '中杯', '{}'::jsonb, 27.00, 1),
  ('00000000-0000-4000-8000-0000000e0003', '00000000-0000-4000-8000-0000000a0002',
   '00000000-0000-4000-8000-0000000f0003', '拿铁', '大杯', '{}'::jsonb, 30.00, 2),
  ('00000000-0000-4000-8000-0000000e0004', '00000000-0000-4000-8000-0000000b0001',
   '00000000-0000-4000-8000-0000000f0003', '拿铁', '大杯', '{}'::jsonb, 30.00, 1);

-- ── 场景一：未认证身份（只有发布密钥）────────────────────────────────────────
-- 发布密钥 = 没有会话的请求 = anon 角色。读不到任何订单数据、写不了任何订单数据；
-- 目录数据本就公开（AD-20），被拒的只有订单域与内部表。

set local role anon;

select throws_ok(
  'select * from public.orders',
  '42501', null,
  '未认证（仅发布密钥）不能读取 orders'
);
select throws_ok(
  'select * from public.order_items',
  '42501', null,
  '未认证（仅发布密钥）不能读取 order_items'
);
select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, idempotency_key,
        pickup_code, pickup_code_date, ready_at)
     values ('202609019999999999', gen_random_uuid(), gen_random_uuid(),
             '假门店', '假地址', '000-00000000', 'dinein', 0.00, 0.01, 'forge-anon',
             'X-0001', '2026-09-01', now()) $$,
  '42501', null,
  '未认证不能插入订单（金额自定 0.01 元没有落点）'
);
select throws_ok(
  'update public.orders set total_amount = 0.01',
  '42501', null,
  '未认证不能修改订单金额'
);
select throws_ok(
  'delete from public.orders',
  '42501', null,
  '未认证不能删除订单'
);
select throws_ok(
  'select * from public.wechat_identities',
  '42501', null,
  '未认证不能读取身份映射（内部表完全不可达）'
);
select throws_ok(
  'select * from public.pickup_code_counters',
  '42501', null,
  '未认证不能读取取杯号计数器（内部表完全不可达）'
);
select throws_ok(
  'select public.get_my_orders()',
  '42501', null,
  '未认证连订单读取函数都没有执行权（不是返回空列表）'
);
select lives_ok(
  'select * from public.menu',
  '对照：未认证仍可读公开目录——被拒的只有订单域与内部表（AD-20）'
);

-- ── 场景二：两个身份，各看各的（他人数据不可见）──────────────────────────────
-- 同一批数据、同一套问题，分别以 A 与 B 的身份问一遍：裸表（RLS 策略）与函数（RPC 谓词）两条路。

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c011"}';

select is(
  (select array_agg(id order by id) from public.orders),
  array['00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000a0002']::uuid[],
  'A 经裸表（RLS 策略）可见的订单恰为 A 自己的两条'
);
select is(
  (select array_agg((e.item ->> 'id')::uuid order by (e.item ->> 'id')::uuid)
     from jsonb_array_elements(public.get_my_orders(50) -> 'items') as e(item)),
  array['00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000a0002']::uuid[],
  'A 经 get_my_orders（RPC 谓词）读到的订单恰为同样两条'
);
select ok(
  not exists (
    select 1
      from jsonb_array_elements(public.get_my_orders(50) -> 'items') as e(item)
     where e.item ->> 'order_number' = '202609010000020001'
  ),
  'A 的订单列表里不可能出现 B 的订单号'
);
select is(
  (select array_agg(id order by id) from public.order_items),
  array['00000000-0000-4000-8000-0000000e0001',
        '00000000-0000-4000-8000-0000000e0002',
        '00000000-0000-4000-8000-0000000e0003']::uuid[],
  'A 经裸表可见的明细恰为 A 自己的三条（B 的明细不可见）'
);
select throws_ok(
  $$ select public.get_my_order_detail('00000000-0000-4000-8000-0000000b0001') $$,
  'P0001', 'order_not_found',
  'A 读取 B 的订单详情被拒绝'
);
select throws_ok(
  $$ select public.get_my_order_detail('00000000-0000-4000-8000-00000000ffff') $$,
  'P0001', 'order_not_found',
  'A 读取不存在的订单返回与上一条完全相同的结果（拒绝方式不泄露存在性）'
);

-- ── 场景三：归属的两处表达等价（AD-3）────────────────────────────────────────
-- 同一身份、同一时刻：经裸表（RLS 策略）与经函数（RPC 谓词）看到的订单集合必须逐行相同。

select is(
  (select array_agg(id order by id) from public.orders),
  (select array_agg((e.item ->> 'id')::uuid order by (e.item ->> 'id')::uuid)
     from jsonb_array_elements(public.get_my_orders(50) -> 'items') as e(item)),
  'A：经裸表与经 get_my_orders 可见的订单集合完全相同'
);
select ok(
  (select bool_and(public.get_my_order_detail(o.id) ->> 'id' = o.id::text)
     from public.orders o),
  'A：裸表可见的每一单都能经 get_my_order_detail 读到同一行（详情谓词与策略同域）'
);
select ok(
  (select bool_and(
            jsonb_array_length(public.get_my_order_detail(o.id) -> 'items')
            = (select count(*)::int from public.order_items oi where oi.order_id = o.id))
     from public.orders o),
  'A：每单的明细行数经详情与经裸表读取一致（明细可见性跟随订单，AD-4）'
);

-- B 的身份再问一遍同样的问题
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c012"}';

select is(
  (select array_agg(id order by id) from public.orders),
  array['00000000-0000-4000-8000-0000000b0001']::uuid[],
  'B 经裸表（RLS 策略）可见的订单恰为 B 自己的一条'
);
select is(
  (select array_agg((e.item ->> 'id')::uuid order by (e.item ->> 'id')::uuid)
     from jsonb_array_elements(public.get_my_orders(50) -> 'items') as e(item)),
  array['00000000-0000-4000-8000-0000000b0001']::uuid[],
  'B 经 get_my_orders 读到的订单恰为同样一条'
);
select is(
  (select array_agg(id order by id) from public.orders),
  (select array_agg((e.item ->> 'id')::uuid order by (e.item ->> 'id')::uuid)
     from jsonb_array_elements(public.get_my_orders(50) -> 'items') as e(item)),
  'B：经裸表与经 get_my_orders 可见的订单集合完全相同（换一个身份同样等价）'
);
select throws_ok(
  $$ select public.get_my_order_detail('00000000-0000-4000-8000-0000000a0001') $$,
  'P0001', 'order_not_found',
  'B 读取 A 的订单详情被拒绝（与不存在同一结果）'
);

-- ── 场景四：他人数据不可写 / 自己没有写路径（AD-2）────────────────────────────
-- 回到 A 的身份。读得通、写无路，这两件事必须同时成立才算边界正确。

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c011"}';

select throws_ok(
  $$ insert into public.orders
       (order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, idempotency_key,
        pickup_code, pickup_code_date, ready_at)
     values ('202609019999999998', '00000000-0000-4000-8000-00000000c011',
             '00000000-0000-4000-8000-0000000f0001', '隔离测试门店', '测试地址 1 号', '000-00000001',
             'dinein', 0.00, 0.01, 'forge-auth', 'X-0002', '2026-09-01', now()) $$,
  '42501', null,
  'A 不能直接插入一张金额自定的订单（给自己也不行）'
);
select throws_ok(
  $$ insert into public.order_items
       (order_id, product_id, product_name, spec_summary, selections, unit_price, quantity)
     values ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000f0003',
             '拿铁', '改价', '{}'::jsonb, 0.01, 1) $$,
  '42501', null,
  'A 不能直接写入订单明细（金额自定没有第二条路径）'
);
select throws_ok(
  $$ update public.orders set total_amount = 0.01
      where id = '00000000-0000-4000-8000-0000000a0001' $$,
  '42501', null,
  'A 不能修改自己订单的金额'
);
select throws_ok(
  $$ update public.orders set total_amount = 0.01
      where id = '00000000-0000-4000-8000-0000000b0001' $$,
  '42501', null,
  'A 不能修改 B 的订单'
);
select throws_ok(
  $$ delete from public.orders where id = '00000000-0000-4000-8000-0000000b0001' $$,
  '42501', null,
  'A 不能删除 B 的订单'
);
select throws_ok(
  $$ update public.order_items set unit_price = 0.01
      where order_id = '00000000-0000-4000-8000-0000000b0001' $$,
  '42501', null,
  'A 不能修改 B 的订单明细'
);
select throws_ok(
  $$ delete from public.order_items where order_id = '00000000-0000-4000-8000-0000000b0001' $$,
  '42501', null,
  'A 不能删除 B 的订单明细'
);
select lives_ok(
  'select public.get_my_orders(50)',
  '对照：A 的订单读取入口照常可用——读有路、写无路（AD-2）'
);

-- ── 场景五：内部表对客户端完全不可达（AD-21、AR-18）──────────────────────────
-- 内部表 = 零策略 + 默认授权已撤销。注意平台默认给 public 新表授予 anon/authenticated
-- 全部权限（auto-expose 行为，本地与云端一致），是迁移里的显式 revoke 把它们收回去的。

reset role;

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'wechat_identities'),
  0,
  'wechat_identities 不携带任何面向客户端的策略（无策略 = 完全不可达）'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'pickup_code_counters'),
  0,
  'pickup_code_counters 不携带任何面向客户端的策略（无策略 = 完全不可达）'
);
select ok(
  not has_table_privilege('anon', 'public.wechat_identities',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'wechat_identities：anon 没有任何表权限（默认授权已撤销）'
);
select ok(
  not has_table_privilege('authenticated', 'public.wechat_identities',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'wechat_identities：authenticated 没有任何表权限（默认授权已撤销）'
);
select ok(
  not has_table_privilege('anon', 'public.pickup_code_counters',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'pickup_code_counters：anon 没有任何表权限（默认授权已撤销）'
);
select ok(
  not has_table_privilege('authenticated', 'public.pickup_code_counters',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'pickup_code_counters：authenticated 没有任何表权限（默认授权已撤销）'
);

-- ── 场景六：所有对外暴露的表逐张盘点（AD-21）──────────────────────────────────
-- 表清单是硬编码的预期值：新增或删除表时这条断言会失败，强制来此处确认新表有 RLS、
-- 该收的授权已收（这正是「逐张确认、无遗漏」的执行方式）。

select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'),
  array['categories', 'order_items', 'orders', 'pickup_code_counters',
        'product_spec_groups', 'products', 'spec_groups', 'spec_options',
        'stores', 'wechat_identities'],
  'public 的表集合 = 预期清单（新增/删除表必须来此处登记，防止盘点遗漏）'
);
select is(
  (select count(*)::int
     from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'
      and not c.relrowsecurity),
  0,
  '没有任何一张 public 表缺少行级访问控制（逐张盘点，无遗漏）'
);
select ok(
  (select 'security_invoker=true' = any(coalesce(reloptions, '{}'::text[]))
     from pg_class where oid = 'public.menu'::regclass),
  'menu 视图 security_invoker=true：经视图读取不绕过底层表的行级策略'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'storage.objects 已启用 RLS（对象读取的行为断言见 30_storage）'
);

select * from finish();

rollback;
