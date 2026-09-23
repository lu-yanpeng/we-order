-- 我的订单列表（Story 5.1；FR-P2-14；AD-5、AD-6、AD-10、AD-13、AD-22、AD-23；AR-16、NFR1）
-- 覆盖：函数属性与权限、未认证拒绝、分页参数边界、默认 20 条与游标信封、
--       倒序稳定与翻页不重不漏（含翻页期间插入新单、并列时间边界）、列表形状
--       （订单对外形状 + item_summary、取杯号恒有值、门店时区时间）、
--       读时推进/超时自动完成、归属隔离（他人订单不可见）。
-- 分工（避免重复）：
--   * 订单对外形状与写入口共用映射在 80_create_order / 92_urge / 93_complete；
--   * 推进与超时机制本身在 90_advance / 93_complete（本故事只断言「读取前的触发」）；
--   * 归属两处表达（RLS 与函数谓词）的等价性收口在 Story 5.3；
--   * 真并发不在数据库层测试范围（FR-P2-19），本故事的分页稳定性在单事务内用
--     「翻页期间插入新单」现场证明，不需要脚本。
-- 自带数据（事务内清空订单、门店、商品后插入样例），结束回滚；不依赖种子。
-- 时间字段显式指定，使排序与翻页边界可精确断言；订单 id 显式指定，测试自己知道每一行是谁。

begin;

create extension if not exists pgtap with schema extensions;

-- 测试辅助：以当前身份逐页读取订单列表（页大小 p_limit），返回全部列表项。
-- 用途：证明「一直翻到底」不重复、不遗漏；游标由服务端返回、原样回传（模拟客户端的翻页循环）。
create function public.test_collect_order_list(p_limit integer) returns jsonb
language plpgsql
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_page jsonb;
  v_before_created_at timestamptz;
  v_before_id uuid;
  v_guard integer := 0;
begin
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 100; -- 防御：实现有 bug 时不会死循环
    v_page := public.get_my_orders(p_limit, v_before_created_at, v_before_id);
    v_items := v_items || (v_page -> 'items');
    exit when v_page ->> 'next_cursor' is null;
    v_before_created_at := (v_page #>> '{next_cursor,created_at}')::timestamptz;
    v_before_id := (v_page #>> '{next_cursor,id}')::uuid;
  end loop;
  return v_items;
end;
$$;
grant execute on function public.test_collect_order_list(integer) to authenticated;

select plan(46);

-- ── 测试数据 ────────────────────────────────────────────────────────────────
-- 用户 A（主测）、B（他人订单）、C（无订单）。
-- A 有：25 条「2026-09-01」批量订单（i1…i25，i25 最新）、2 条创建时间完全相同的并列订单、
-- 1 条纽约门店的订单；其中 i25 带两条明细，用于断言商品摘要。
-- B 有：1 条已完成 + 1 条到点的制作中（用于归属与读时推进的作用域）。

delete from public.order_items;
delete from public.orders;
delete from public.pickup_code_counters;
delete from public.stores;
delete from public.products;
delete from public.categories;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-00000000a011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'order-list-a@wechat.local', now()),
  ('00000000-0000-4000-8000-00000000a012', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'order-list-b@wechat.local', now()),
  ('00000000-0000-4000-8000-00000000a013', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'order-list-c@wechat.local', now());

insert into public.stores (id, name, address, phone, timezone, ready_delay_seconds, auto_complete_seconds)
values
  ('00000000-0000-4000-8000-0000000b0001', '列表测试门店', '测试地址 A', '000-00000001',
   'Asia/Shanghai', 15, 30),
  ('00000000-0000-4000-8000-0000000b0002', '纽约门店', '测试地址 B', '000-00000002',
   'America/New_York', 15, 30);

insert into public.categories (id, name, sort_order)
values ('00000000-0000-4000-8000-0000000c0001', '列表测试分类', 0);

insert into public.products (id, category_id, name, price)
values
  ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-0000000c0001', '拿铁', 30.00),
  ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-0000000c0001', '美式', 27.00);

-- 批量订单：created_at = '2026-09-01 00:00:00+08' + i 分钟（i=1…25）
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
select
  ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '20260901' || lpad(i::text, 10, '0'),
  '00000000-0000-4000-8000-00000000a011',
  s.id, s.name, s.address, s.phone,
  'completed', 'takeout', 0.00, 30.00, '无备注要求', 'list-bulk-' || i,
  'A-' || lpad(i::text, 4, '0'), '2026-09-01',
  '2026-09-01 00:00:00+08'::timestamptz + (i || ' minutes')::interval + interval '15 seconds',
  '2026-09-01 00:00:00+08'::timestamptz + (i || ' minutes')::interval + interval '1 hour',
  '2026-09-01 00:00:00+08'::timestamptz + (i || ' minutes')::interval + interval '30 seconds',
  '2026-09-01 00:00:00+08'::timestamptz + (i || ' minutes')::interval
from generate_series(1, 25) i
join public.stores s on s.id = '00000000-0000-4000-8000-0000000b0001';

-- i25 的两条明细：摘要应为「拿铁 ×1、美式 ×2」（明细 id 决定摘要顺序）
insert into public.order_items (id, order_id, product_id, product_name, spec_summary, unit_price, quantity)
values
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000025',
   '00000000-0000-4000-8000-0000000d0001', '拿铁', '中杯 Tall / 冰饮推荐', 30.00, 1),
  ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000025',
   '00000000-0000-4000-8000-0000000d0002', '美式', '大杯 Grande / 热饮', 27.00, 2);

-- 并列订单：创建时间完全相同（2026-08-01 10:00:00+08），id 101 < 102
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-000000000101', '202608010000000101',
   '00000000-0000-4000-8000-00000000a011', '00000000-0000-4000-8000-0000000b0001',
   '列表测试门店', '测试地址 A', '000-00000001',
   'completed', 'dinein', 0.00, 30.00, '无备注要求', 'list-tie-1', 'T-0101', '2026-08-01',
   '2026-08-01 10:00:15+08', '2026-08-01 11:00:00+08', '2026-08-01 10:00:30+08', '2026-08-01 10:00:00+08'),
  ('00000000-0000-4000-8000-000000000102', '202608010000000102',
   '00000000-0000-4000-8000-00000000a011', '00000000-0000-4000-8000-0000000b0001',
   '列表测试门店', '测试地址 A', '000-00000001',
   'completed', 'dinein', 0.00, 30.00, '无备注要求', 'list-tie-2', 'T-0102', '2026-08-01',
   '2026-08-01 10:00:15+08', '2026-08-01 11:00:00+08', '2026-08-01 10:00:30+08', '2026-08-01 10:00:00+08');

-- 纽约门店订单：12:00+08 = 当日 00:00 纽约时间，用于断言时间按订单所属门店的时区输出
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-000000000301', '202607010000000301',
   '00000000-0000-4000-8000-00000000a011', '00000000-0000-4000-8000-0000000b0002',
   '纽约门店', '测试地址 B', '000-00000002',
   'completed', 'takeout', 2.00, 32.00, '无备注要求', 'list-tz', 'Z-0001', '2026-07-01',
   '2026-07-01 12:00:15+08', '2026-07-01 13:00:00+08', '2026-07-01 12:00:30+08', '2026-07-01 12:00:00+08');

-- B 的订单：1 条已完成 + 1 条到点的制作中（读时推进的作用域用）
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-000000000401', '202608150000000401',
   '00000000-0000-4000-8000-00000000a012', '00000000-0000-4000-8000-0000000b0001',
   '列表测试门店', '测试地址 A', '000-00000001',
   'completed', 'dinein', 0.00, 27.00, '无备注要求', 'list-b1', 'B-0401', '2026-08-15',
   '2026-08-15 09:00:15+08', '2026-08-15 10:00:00+08', '2026-08-15 09:00:30+08', '2026-08-15 09:00:00+08'),
  ('00000000-0000-4000-8000-000000000402', '202609030000000402',
   '00000000-0000-4000-8000-00000000a012', '00000000-0000-4000-8000-0000000b0001',
   '列表测试门店', '测试地址 A', '000-00000001',
   'cooking', 'takeout', 2.00, 29.00, '无备注要求', 'list-b2', 'B-0402',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 minute', null, null,
   now() - interval '2 minutes');

-- ── 函数属性与权限：唯一入口、内部实现不暴露（AD-5、AD-21、AD-22）────────────

select ok(
  (select prosecdef from pg_proc where oid = 'public.get_my_orders(integer, timestamptz, uuid)'::regprocedure),
  'get_my_orders 是 security definer'
);
select ok(
  (select 'search_path=""' = any(coalesce(proconfig, '{}')) from pg_proc
    where oid = 'public.get_my_orders(integer, timestamptz, uuid)'::regprocedure),
  'get_my_orders 使用空 search_path'
);
select is(
  (select proargnames::text from pg_proc
    where oid = 'public.get_my_orders(integer, timestamptz, uuid)'::regprocedure),
  '{p_limit,p_before_created_at,p_before_id}',
  'get_my_orders 的参数只有分页与游标——没有用户标识入口（归属不可伪造）'
);
select is(
  (select pg_get_function_result(oid) from pg_proc
    where oid = 'public.get_my_orders(integer, timestamptz, uuid)'::regprocedure),
  'jsonb',
  'get_my_orders 返回分页信封（jsonb）'
);
select ok(
  (select prosrc ilike '%advance_due_orders%' and prosrc ilike '%complete_due_orders%'
     from pg_proc where oid = 'public.get_my_orders(integer, timestamptz, uuid)'::regprocedure),
  'get_my_orders 读取前触发推进与超时完成两个既有机制，不复制判定逻辑（AD-6）'
);
select ok(
  (select prosrc ilike '%order_result_json%' from pg_proc
    where oid = 'public.get_my_orders(integer, timestamptz, uuid)'::regprocedure),
  'get_my_orders 的条目形状来自 order_result_json 同一映射（AD-22）'
);
select ok(
  not has_function_privilege('anon', 'public.get_my_orders(integer, timestamptz, uuid)', 'EXECUTE'),
  '未认证没有订单列表入口'
);
select ok(
  has_function_privilege('authenticated', 'public.get_my_orders(integer, timestamptz, uuid)', 'EXECUTE'),
  '已登录身份可以读取订单列表'
);

-- ── 入口身份：未认证连入口都没有；已登录但无身份则明确拒绝（不是空列表）────────

set local role anon;

select throws_ok(
  $$ select public.get_my_orders() $$,
  '42501', null,
  '未认证不能执行 get_my_orders'
);

set local role authenticated;

select throws_ok(
  $$ select public.get_my_orders() $$,
  'P0001', 'not_authenticated',
  '没有会话身份时拒绝读取订单列表（不是返回空列表）'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a011"}';

-- ── 分页参数：默认 20、上限 50、游标成对（AD-23、NFR3）────────────────────────

select throws_ok(
  $$ select public.get_my_orders(0) $$,
  'P0001', 'invalid_request',
  '每页条数为 0 被拒绝'
);
select throws_ok(
  $$ select public.get_my_orders(51) $$,
  'P0001', 'invalid_request',
  '每页条数超过上限 50 被拒绝（分页参数有上限）'
);
select lives_ok(
  $$ select public.get_my_orders(50) $$,
  '每页条数取上限 50 本身可用'
);
select throws_ok(
  $$ select public.get_my_orders(5, now()) $$,
  'P0001', 'invalid_request',
  '游标只给一半（有创建时间、缺 id）被拒绝'
);
select throws_ok(
  $$ select public.get_my_orders(5, null, gen_random_uuid()) $$,
  'P0001', 'invalid_request',
  '游标只给一半（有 id、缺创建时间）被拒绝'
);

-- ── 默认分页与信封形状（AD-22、AD-23）───────────────────────────────────────

select is(
  (select jsonb_array_length(public.get_my_orders() -> 'items')),
  20,
  '默认每页 20 条：A 有 28 条订单时第一页恰为 20 条'
);
select is(
  (select array_agg(k order by k) from public.get_my_orders() r, jsonb_object_keys(r) k),
  array['items', 'next_cursor'],
  '返回信封只有 items 与 next_cursor 两个键'
);
select is(
  (select array_agg(k order by k)
     from jsonb_object_keys(public.get_my_orders() -> 'items' -> 0) k),
  array['created_at', 'dining_mode', 'id', 'item_summary', 'notes', 'order_number',
        'packaging_fee', 'pickup_code', 'status', 'total_amount'],
  '列表项字段集合 = 订单对外形状 + item_summary（内部列不外泄）'
);
select is(
  (select array_agg(value ->> 'order_number')
     from jsonb_array_elements(public.get_my_orders() -> 'items')),
  (select array_agg('20260901' || lpad(i::text, 10, '0')) from generate_series(25, 6, -1) i),
  '第一页按创建时间倒序：最新的 20 条（i25…i6）'
);
select is(
  jsonb_typeof(public.get_my_orders() -> 'next_cursor'),
  'object',
  '还有下一页时 next_cursor 是对象（不是 null）'
);
select ok(
  (select bool_and(value ->> 'created_at' ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$')
     from jsonb_array_elements(public.get_my_orders(50) -> 'items')),
  '所有条目的 created_at 都是 YYYY-MM-DD HH:mm:ss 文本'
);

-- ── 翻页稳定性：翻页期间插入新单，不重复、不遗漏已存在订单（AD-23）───────────

create temporary table test_page1 as
  select public.get_my_orders(5) as page;

select is(
  (select array_agg(value ->> 'order_number')
     from jsonb_array_elements((select page -> 'items' from test_page1))),
  (select array_agg('20260901' || lpad(i::text, 10, '0')) from generate_series(25, 21, -1) i),
  '第 1 页（每页 5）取到当时最新的 i25…i21'
);

-- 翻页期间插入一张更新的订单（比所有既有订单都新）
reset role;

insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-000000000501', '202609050000000501',
   '00000000-0000-4000-8000-00000000a011', '00000000-0000-4000-8000-0000000b0001',
   '列表测试门店', '测试地址 A', '000-00000001',
   'completed', 'dinein', 0.00, 30.00, '无备注要求', 'list-new', 'N-0501',
   (now() at time zone 'Asia/Shanghai')::date, now() + interval '15 seconds',
   now() + interval '1 hour', now() + interval '30 seconds', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a011"}';

select is(
  (select array_agg(value ->> 'order_number')
     from jsonb_array_elements(
       public.get_my_orders(
         5,
         (select (page #>> '{next_cursor,created_at}')::timestamptz from test_page1),
         (select (page #>> '{next_cursor,id}')::uuid from test_page1)
       ) -> 'items'
     )),
  (select array_agg('20260901' || lpad(i::text, 10, '0')) from generate_series(20, 16, -1) i),
  '插入新单后，第 2 页仍精确取到 i20…i16（游标分页定位的是「谁之后」，不是「第几条」）'
);
select is(
  (select count(*)::int
     from jsonb_array_elements((select page -> 'items' from test_page1)) p1
    where (p1.value ->> 'order_number') in (
      select value ->> 'order_number'
        from jsonb_array_elements(
          public.get_my_orders(
            5,
            (select (page #>> '{next_cursor,created_at}')::timestamptz from test_page1),
            (select (page #>> '{next_cursor,id}')::uuid from test_page1)
          ) -> 'items'
        )
    )),
  0,
  '两页之间没有任何重复条目'
);
select ok(
  not exists (
    select 1
      from jsonb_array_elements(
        public.get_my_orders(
          5,
          (select (page #>> '{next_cursor,created_at}')::timestamptz from test_page1),
          (select (page #>> '{next_cursor,id}')::uuid from test_page1)
        ) -> 'items'
      ) e
     where e.value ->> 'order_number' = '202609050000000501'
  ),
  '翻页期间新下的单不会出现在第 2 页（它在该页起点之前，而不是把老单挤走）'
);
select is(
  jsonb_array_length(public.test_collect_order_list(7)),
  29,
  '全量翻页（每页 7）取到 29 条：28 条既有 + 1 条翻页期间的新单'
);
select is(
  (select count(distinct value ->> 'order_number')::int
     from jsonb_array_elements(public.test_collect_order_list(7))),
  29,
  '全量翻页没有重复条目'
);
select ok(
  (select count(*) = 28
     from jsonb_array_elements(public.test_collect_order_list(7)) e
    where (e.value ->> 'order_number') in (
      select '20260901' || lpad(i::text, 10, '0') from generate_series(1, 25) i
      union all select '202608010000000101'
      union all select '202608010000000102'
      union all select '202607010000000301'
    )),
  '全量翻页不遗漏：28 条既有订单（含插入新单之前就已存在的全部）恰好各出现一次'
);

-- ── 并列时间与最后一页（稳定排序键 = created_at desc, id desc）────────────────

select is(
  (select array_agg(value ->> 'id' order by ordinality)
     from jsonb_array_elements(public.test_collect_order_list(7)) with ordinality
    where value ->> 'order_number' in ('202608010000000101', '202608010000000102')),
  array['00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101'],
  '创建时间相同的两张单按 id 倒序稳定排列（102 在 101 之前）'
);
select is(
  (select array_agg(value ->> 'order_number')
     from jsonb_array_elements(
       public.get_my_orders(
         5,
         '2026-08-01 10:00:00+08'::timestamptz,
         '00000000-0000-4000-8000-000000000102'::uuid
       ) -> 'items'
     )),
  array['202608010000000101', '202607010000000301'],
  '游标落在并列中间：只返回 id 更小的那张并列单及其后的老单，不重不漏'
);
select ok(
  jsonb_array_length(public.get_my_orders(50) -> 'items') = 29
  and (public.get_my_orders(50) -> 'next_cursor') = 'null'::jsonb,
  '取满全部 29 条（少于每页上限 50）时 next_cursor 为 null：到底了'
);

-- ── 列表形状：摘要、金额、取杯号、时区（AD-10、AD-22、Story 4.4）─────────────

select ok(
  (select bool_and(value ->> 'pickup_code' ~ '^[A-Z]-[0-9]{4}$')
     from jsonb_array_elements(public.get_my_orders(50) -> 'items')),
  '取杯号恒有值且外形为字母前缀 + 四位数字（下单即分配）'
);
select ok(
  (select bool_and(
            jsonb_typeof(value -> 'total_amount') = 'number'
        and jsonb_typeof(value -> 'packaging_fee') = 'number')
     from jsonb_array_elements(public.get_my_orders(50) -> 'items')),
  '金额是定点 JSON 数字（数值而非字符串）'
);
select is(
  (select value ->> 'item_summary'
     from jsonb_array_elements(public.get_my_orders(50) -> 'items')
    where value ->> 'order_number' = '202609010000000025'),
  '拿铁 ×1、美式 ×2',
  '商品摘要 = 商品名 ×数量、顿号连接（服务端从明细快照生成）'
);
select is(
  (select value ->> 'created_at'
     from jsonb_array_elements(public.get_my_orders(50) -> 'items')
    where value ->> 'order_number' = '202607010000000301'),
  '2026-07-01 00:00:00',
  '时间按订单所属门店的时区输出（纽约门店：12:00+08 显示为当日 00:00）'
);
select ok(
  not exists (
    select 1
      from jsonb_array_elements(public.get_my_orders(50) -> 'items') e
      join public.orders o on o.id::text = e.value ->> 'id'
     where o.order_number <> e.value ->> 'order_number'
  ),
  '每条列表项的 id 与订单号来自同一行（形状来自同一映射，不是拼接）'
);

-- ── 读时推进与超时自动完成：读取前先作用于调用者自己的订单（AD-6、Story 4.5）──
-- 到点/超时的订单在分页断言之后才插入，避免影响翻页计数。

reset role;

insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  -- r1 制作中、已到点：读取时应被推进
  ('00000000-0000-4000-8000-000000000201', '202609020000000201',
   '00000000-0000-4000-8000-00000000a011', '00000000-0000-4000-8000-0000000b0001',
   '列表测试门店', '测试地址 A', '000-00000001',
   'cooking', 'dinein', 0.00, 30.00, '无备注要求', 'list-r1', 'R-0201',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 minute', null, null,
   now() - interval '2 minutes'),
  -- r2 制作中、未到点：读取后仍是制作中
  ('00000000-0000-4000-8000-000000000202', '202609020000000202',
   '00000000-0000-4000-8000-00000000a011', '00000000-0000-4000-8000-0000000b0001',
   '列表测试门店', '测试地址 A', '000-00000001',
   'cooking', 'dinein', 0.00, 30.00, '无备注要求', 'list-r2', 'R-0202',
   (now() at time zone 'Asia/Shanghai')::date, now() + interval '1 hour', null, null,
   now() - interval '3 minutes'),
  -- r3 待取餐、已超时：读取时应被自动完成
  ('00000000-0000-4000-8000-000000000203', '202609020000000203',
   '00000000-0000-4000-8000-00000000a011', '00000000-0000-4000-8000-0000000b0001',
   '列表测试门店', '测试地址 A', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, '无备注要求', 'list-r3', 'R-0203',
   (now() at time zone 'Asia/Shanghai')::date, now() - interval '10 minutes', null,
   now() - interval '1 minute', now() - interval '9 minutes');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a011"}';

select is(
  (select value ->> 'status'
     from jsonb_array_elements(public.get_my_orders(50) -> 'items')
    where value ->> 'id' = '00000000-0000-4000-8000-000000000201'),
  'pickup',
  '读取列表时：A 自己到点的「制作中」订单在结果里已是「待取餐」'
);
select is(
  (select value ->> 'status'
     from jsonb_array_elements(public.get_my_orders(50) -> 'items')
    where value ->> 'id' = '00000000-0000-4000-8000-000000000202'),
  'cooking',
  'A 自己未到点的「制作中」订单仍为「制作中」'
);
select is(
  (select value ->> 'status'
     from jsonb_array_elements(public.get_my_orders(50) -> 'items')
    where value ->> 'id' = '00000000-0000-4000-8000-000000000203'),
  'completed',
  '读取列表时：A 自己超时的「待取餐」订单在结果里已是「已完成」'
);
select ok(
  (select status = 'pickup' and auto_complete_at = now() + interval '30 seconds'
     from public.orders where id = '00000000-0000-4000-8000-000000000201'),
  '读时推进落库：状态与自动完成时刻由同一次迁移写入（门店配置 30 秒）'
);
select ok(
  (select status = 'completed' and completed_at = now()
     from public.orders where id = '00000000-0000-4000-8000-000000000203'),
  '读时自动完成落库：完成时间取服务端时钟'
);
reset role;

select ok(
  (select status = 'cooking' from public.orders where id = '00000000-0000-4000-8000-000000000402'),
  'A 的读取不会推进 B 的到点订单（读时推进只作用于调用者自己）'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a011"}';

-- ── 归属隔离：他人订单不可能出现（FR-P2-14；边界收口见 Story 5.3）───────────

select is(
  (select count(*)::int
     from jsonb_array_elements(public.test_collect_order_list(5)) e
    where (e.value ->> 'order_number') in ('202608150000000401', '202609030000000402')),
  0,
  'A 的全量订单里没有任何一条属于 B 的订单'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a012"}';

select is(
  (select array_agg(value ->> 'order_number')
     from jsonb_array_elements(public.test_collect_order_list(5))),
  array['202609030000000402', '202608150000000401'],
  'B 的列表只有 B 自己的两条订单（b2 更新，排在 b1 之前）'
);
select ok(
  (select status = 'pickup' from public.orders where id = '00000000-0000-4000-8000-000000000402'),
  'B 自己的读取把 B 到点的订单推进（每个身份的读时推进互不干扰）'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a013"}';

select ok(
  jsonb_array_length(public.get_my_orders() -> 'items') = 0
  and (public.get_my_orders() -> 'next_cursor') = 'null'::jsonb,
  '没有订单的用户返回空列表与 null 游标（空列表是正常结果，不是错误）'
);

select * from finish();

rollback;
