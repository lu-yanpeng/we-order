-- 我的订单详情（Story 5.2；FR-P2-15；AD-5、AD-9、AD-10、AD-13、AD-22；AR-15、AR-17）
-- 覆盖：函数属性与权限、入口身份、详情形状（订单对外形状 + 门店快照 + 明细快照、
--       内部列不外泄、金额与时间格式）、规格选择形状、快照不随目录与门店维护变化、
--       与列表同一映射的字段级一致、拒绝语义（非本人与不存在同一结果）、读时推进。
-- 分工（避免重复）：
--   * 订单对外形状本身在 80_create_order / 92_urge / 93_complete；本故事只断言
--     详情里的 9 个订单字段与列表项逐字段相同（同一映射、同一口径）；
--   * 推进与超时机制本身在 90_advance / 93_complete（本故事只断言「读取前的触发」）；
--   * 归属两处表达（RLS 与函数谓词）的等价性收口在 Story 5.3；
--   * 真并发不在数据库层测试范围（FR-P2-19），本故事无并发行为。
-- 自带数据（事务内清空订单、门店、商品、分类后插入样例），结束回滚；不依赖种子。
-- 时间字段显式指定（跨时区断言用固定时刻），订单 id 显式指定。

begin;

create extension if not exists pgtap with schema extensions;

-- 测试辅助：以当前身份从订单列表里取某一单的列表项（用于与详情做字段级比对）。
-- 模拟客户端的「同一条订单」在两处读取，游标不参与（测试数据量小，一页足够）。
create function public.test_list_item(p_order_id uuid) returns jsonb
language sql
as $$
  select value
    from jsonb_array_elements(public.get_my_orders(50) -> 'items')
   where value ->> 'id' = p_order_id::text;
$$;
grant execute on function public.test_list_item(uuid) to authenticated;

select plan(40);

-- ── 测试数据 ────────────────────────────────────────────────────────────────
-- 用户 A（主测）、B（他人的订单）。
-- A：d1 已完成（两条明细，覆盖单选/多选两种规格选择形状）、d2 纽约门店（时区断言）、
--    d6 无明细（防御性空数组）；d3/d4/d5 在读时推进一节插入。
-- B：b1 制作中且已到点（读时推进的作用域用）。

delete from public.order_items;
delete from public.orders;
delete from public.pickup_code_counters;
delete from public.stores;
delete from public.products;
delete from public.categories;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-00000000b011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'order-detail-a@wechat.local', now()),
  ('00000000-0000-4000-8000-00000000b012', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'order-detail-b@wechat.local', now());

insert into public.stores (id, name, address, phone, timezone, ready_delay_seconds, auto_complete_seconds)
values
  ('00000000-0000-4000-8000-0000000e0001', '详情测试门店', '测试地址 A', '000-00000001',
   'Asia/Shanghai', 15, 30),
  ('00000000-0000-4000-8000-0000000e0002', '纽约门店', '测试地址 B', '000-00000002',
   'America/New_York', 15, 30);

insert into public.categories (id, name, sort_order)
values ('00000000-0000-4000-8000-00000000f001', '详情测试分类', 0);

insert into public.products (id, category_id, name, price)
values
  ('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-00000000f001', '拿铁', 30.00),
  ('00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-00000000f001', '美式', 27.00);

-- d1：已完成，两条明细（单选组选择是字符串、多选组是数组）
-- 总额 = 33.00 × 1 + 31.50 × 2 + 0（堂食）= 96.00
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-00000000d001', '202607011000000001',
   '00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-0000000e0001',
   '详情测试门店', '测试地址 A', '000-00000001',
   'completed', 'dinein', 0.00, 96.00, '少冰', 'detail-d1',
   'D-0001', '2026-07-01',
   '2026-07-01 10:00:15+08', '2026-07-01 10:00:45+08', '2026-07-01 10:00:45+08',
   '2026-07-01 10:00:00+08');

insert into public.order_items (
  id, order_id, product_id, product_name, spec_summary, selections, unit_price, quantity
)
values
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d001',
   '00000000-0000-4000-8000-00000000f101', '拿铁', '大杯 Grande / 冰饮',
   '{"00000000-0000-4000-8000-00000000f201": "00000000-0000-4000-8000-00000000f302"}',
   33.00, 1),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d001',
   '00000000-0000-4000-8000-00000000f102', '美式', '中杯 Tall / 燕麦奶 / 2份浓缩',
   '{"00000000-0000-4000-8000-00000000f202": [
      "00000000-0000-4000-8000-00000000f303",
      "00000000-0000-4000-8000-00000000f304"
    ]}',
   31.50, 2);

-- d2：纽约门店，12:00+08 = 当日 00:00 纽约时间（详情时间按订单所属门店的时区输出）
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-00000000d002', '202607011200000002',
   '00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-0000000e0002',
   '纽约门店', '测试地址 B', '000-00000002',
   'completed', 'takeout', 2.00, 35.00, '无备注要求', 'detail-d2',
   'Y-0001', '2026-07-01',
   '2026-07-01 12:00:15+08', '2026-07-01 12:00:45+08', '2026-07-01 12:00:45+08',
   '2026-07-01 12:00:00+08');

-- d6：没有明细的订单（数据库不保证「至少一条明细」，详情应返回空数组而不是报错）
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-00000000d006', '202607010900000006',
   '00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-0000000e0001',
   '详情测试门店', '测试地址 A', '000-00000001',
   'completed', 'dinein', 0.00, 27.00, '无备注要求', 'detail-d6',
   'D-0006', '2026-07-01',
   '2026-07-01 09:00:15+08', '2026-07-01 09:00:45+08', '2026-07-01 09:00:45+08',
   '2026-07-01 09:00:00+08');

-- b1：B 的订单，制作中且已到点（A 的读取不应推进它；B 自己读取时才会被推进）
insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  ('00000000-0000-4000-8000-00000000d101', '202607011000000101',
   '00000000-0000-4000-8000-00000000b012', '00000000-0000-4000-8000-0000000e0001',
   '详情测试门店', '测试地址 A', '000-00000001',
   'cooking', 'dinein', 0.00, 30.00, '无备注要求', 'detail-b1',
   'B-0001', (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 minute',
   null, null, now() - interval '2 minutes');

-- ── 函数属性与权限：唯一入口、内部实现不暴露（AD-5、AD-21、AD-22）────────────

select ok(
  (select prosecdef from pg_proc where oid = 'public.get_my_order_detail(uuid)'::regprocedure),
  'get_my_order_detail 是 security definer'
);
select ok(
  (select 'search_path=""' = any(coalesce(proconfig, '{}')) from pg_proc
    where oid = 'public.get_my_order_detail(uuid)'::regprocedure),
  'get_my_order_detail 使用空 search_path'
);
select is(
  (select proargnames::text from pg_proc
    where oid = 'public.get_my_order_detail(uuid)'::regprocedure),
  '{p_order_id}',
  'get_my_order_detail 的参数只有订单 id——没有用户标识入口（归属不可伪造）'
);
select is(
  (select pg_get_function_result(oid) from pg_proc
    where oid = 'public.get_my_order_detail(uuid)'::regprocedure),
  'jsonb',
  'get_my_order_detail 返回详情对象（jsonb）'
);
select ok(
  (select prosrc ilike '%order_result_json%' from pg_proc
    where oid = 'public.get_my_order_detail(uuid)'::regprocedure),
  'get_my_order_detail 的订单字段来自 order_result_json 同一映射（AD-22）'
);
select ok(
  (select prosrc ilike '%advance_due_orders%' and prosrc ilike '%complete_due_orders%'
     from pg_proc where oid = 'public.get_my_order_detail(uuid)'::regprocedure),
  'get_my_order_detail 读取前触发推进与超时完成两个既有机制，不复制判定逻辑（AD-5）'
);
select ok(
  not has_function_privilege('anon', 'public.get_my_order_detail(uuid)', 'EXECUTE'),
  '未认证没有订单详情入口'
);
select ok(
  has_function_privilege('authenticated', 'public.get_my_order_detail(uuid)', 'EXECUTE'),
  '已登录身份可以读取订单详情'
);

-- ── 入口身份：未认证连入口都没有；已登录但无身份则明确拒绝 ─────────────────────

set local role anon;

select throws_ok(
  $$ select public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') $$,
  '42501', null,
  '未认证不能执行 get_my_order_detail'
);

set local role authenticated;

select throws_ok(
  $$ select public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') $$,
  'P0001', 'not_authenticated',
  '没有会话身份时拒绝读取订单详情'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b011"}';

select throws_ok(
  $$ select public.get_my_order_detail(null) $$,
  'P0001', 'invalid_request',
  '订单 id 为空被明确拒绝'
);

-- ── 详情形状：订单对外形状 + 门店快照 + 明细快照（AD-9、AD-10、AD-22）───────────

select is(
  (select array_agg(k order by k)
     from jsonb_object_keys(public.get_my_order_detail('00000000-0000-4000-8000-00000000d001')) k),
  array['created_at', 'dining_mode', 'id', 'items', 'notes', 'order_number',
        'packaging_fee', 'pickup_code', 'status', 'store_address', 'store_name',
        'store_phone', 'total_amount'],
  '详情顶层字段集合 = 订单对外形状 + 门店快照 + items（内部列不外泄）'
);
select is(
  jsonb_array_length(public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'),
  2,
  '详情包含全部商品明细（d1 有两条）'
);
select is(
  (select array_agg(distinct k order by k)
     from jsonb_array_elements(
            public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
          ) e,
          jsonb_object_keys(e.value) k),
  array['product_id', 'product_name', 'quantity', 'selections', 'spec_summary', 'unit_price'],
  '明细字段集合 = 下单时刻快照六列（含商品引用与结构化规格选择）'
);
select is(
  (select value -> 'selections'
     from jsonb_array_elements(
            public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
          ) e
    where value ->> 'product_name' = '拿铁'),
  '{"00000000-0000-4000-8000-00000000f201": "00000000-0000-4000-8000-00000000f302"}'::jsonb,
  '单选组的规格选择原样返回（规格组 id → 选项 id 字符串）'
);
select is(
  (select value -> 'selections'
     from jsonb_array_elements(
            public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
          ) e
    where value ->> 'product_name' = '美式'),
  '{"00000000-0000-4000-8000-00000000f202": [
      "00000000-0000-4000-8000-00000000f303",
      "00000000-0000-4000-8000-00000000f304"
    ]}'::jsonb,
  '多选组的规格选择原样返回（选项 id 数组，AD-22 的形状）'
);
select ok(
  (select jsonb_typeof(value -> 'selections' -> '00000000-0000-4000-8000-00000000f201')
     from jsonb_array_elements(
            public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
          ) e
    where value ->> 'product_name' = '拿铁') = 'string'
  and
  (select jsonb_typeof(value -> 'selections' -> '00000000-0000-4000-8000-00000000f202')
     from jsonb_array_elements(
            public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
          ) e
    where value ->> 'product_name' = '美式') = 'array',
  '单选组的选择值是字符串、多选组的选择值是数组（形状不被压平或改写）'
);
select is(
  (select value -> 'unit_price'
     from jsonb_array_elements(
            public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
          ) e
    where value ->> 'product_name' = '拿铁'),
  '33.00'::jsonb,
  '明细单价是下单时的快照值'
);
select is(
  (select value -> 'quantity'
     from jsonb_array_elements(
            public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
          ) e
    where value ->> 'product_name' = '拿铁'),
  '1'::jsonb,
  '明细数量来自快照（拿铁 ×1）'
);
select is(
  (select value -> 'quantity'
     from jsonb_array_elements(
            public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
          ) e
    where value ->> 'product_name' = '美式'),
  '2'::jsonb,
  '明细数量来自快照（美式 ×2）'
);
select is(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') ->> 'created_at',
  '2026-07-01 10:00:00',
  '下单时间按订单所属门店的时区输出（上海门店）'
);
select ok(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') ->> 'created_at'
    ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$',
  '详情时间格式与列表一致（YYYY-MM-DD HH:mm:ss 文本）'
);
select is(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d002') ->> 'created_at',
  '2026-07-01 00:00:00',
  '纽约门店的单按门店时区输出（12:00+08 显示为当日 00:00）'
);
select ok(
  jsonb_typeof(public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'total_amount') = 'number'
  and jsonb_typeof(public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'packaging_fee') = 'number'
  and (select bool_and(jsonb_typeof(value -> 'unit_price') = 'number')
         from jsonb_array_elements(
                public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
              )),
  '金额是定点 JSON 数字（数值而非字符串）'
);
select is(
  jsonb_build_object(
    'name', public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') ->> 'store_name',
    'address', public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') ->> 'store_address',
    'phone', public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') ->> 'store_phone'
  ),
  jsonb_build_object('name', '详情测试门店', 'address', '测试地址 A', 'phone', '000-00000001'),
  '门店信息来自订单快照（名称、地址、电话）'
);
select is(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') ->> 'pickup_code',
  'D-0001',
  '详情包含取杯号'
);
select ok(
  (public.get_my_order_detail('00000000-0000-4000-8000-00000000d006') -> 'items') = '[]'::jsonb
  and jsonb_typeof(public.get_my_order_detail('00000000-0000-4000-8000-00000000d006') -> 'items') = 'array',
  '没有明细的订单返回空数组而不是报错（防御性行为）'
);

-- ── 快照不随目录与门店维护变化：详情只读副本字段（AD-9）───────────────────────

reset role;

update public.products
   set name = '拿铁（已改名）', price = 99.00
 where id = '00000000-0000-4000-8000-00000000f101';

update public.stores
   set name = '详情测试门店（已改名）'
 where id = '00000000-0000-4000-8000-0000000e0001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b011"}';

select ok(
  (select value ->> 'product_name' = '拿铁'
      and value ->> 'spec_summary' = '大杯 Grande / 冰饮'
      and value -> 'unit_price' = '33.00'::jsonb
     from jsonb_array_elements(
            public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') -> 'items'
          ) e
    where value ->> 'product_id' = '00000000-0000-4000-8000-00000000f101'),
  '商品改名改价后，详情里的商品名、规格摘要与单价仍是下单时的快照'
);
select is(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d001') ->> 'store_name',
  '详情测试门店',
  '门店改名后，详情里的门店名仍是下单时的快照'
);

-- ── 与列表同一映射：共有订单字段逐字段相同（AD-22）────────────────────────────

select is(
  public.test_list_item('00000000-0000-4000-8000-00000000d001') - 'item_summary',
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d001')
    - 'store_name' - 'store_address' - 'store_phone' - 'items',
  '详情与列表共有的 9 个订单字段逐字段相同（同一映射，不存在两套口径）'
);

-- ── 拒绝语义：非本人与不存在返回同一结果（AD-13）──────────────────────────────

select throws_ok(
  $$ select public.get_my_order_detail('00000000-0000-4000-8000-00000000d101') $$,
  'P0001', 'order_not_found',
  '读他人的订单标识返回 order_not_found（与不存在同一结果）'
);
select throws_ok(
  $$ select public.get_my_order_detail(gen_random_uuid()) $$,
  'P0001', 'order_not_found',
  '不存在的订单标识返回同一结果 order_not_found（不可区分）'
);

-- ── 读时推进：读取详情前先推进调用者自己到点/超时的订单（AD-5）────────────────

reset role;

insert into public.orders (
  id, order_number, user_id, store_id, store_name, store_address, store_phone,
  status, dining_mode, packaging_fee, total_amount, notes, idempotency_key,
  pickup_code, pickup_code_date, ready_at, completed_at, auto_complete_at, created_at
)
values
  -- d3 制作中、已到点：读详情时应被推进
  ('00000000-0000-4000-8000-00000000d003', '202607011000000003',
   '00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-0000000e0001',
   '详情测试门店', '测试地址 A', '000-00000001',
   'cooking', 'dinein', 0.00, 30.00, '无备注要求', 'detail-d3',
   'D-0003', (now() at time zone 'Asia/Shanghai')::date, now() - interval '1 minute',
   null, null, now() - interval '3 minutes'),
  -- d4 制作中、未到点：读取后仍是制作中
  ('00000000-0000-4000-8000-00000000d004', '202607011000000004',
   '00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-0000000e0001',
   '详情测试门店', '测试地址 A', '000-00000001',
   'cooking', 'dinein', 0.00, 30.00, '无备注要求', 'detail-d4',
   'D-0004', (now() at time zone 'Asia/Shanghai')::date, now() + interval '1 hour',
   null, null, now() - interval '4 minutes'),
  -- d5 待取餐、已超时：读详情时应被自动完成
  ('00000000-0000-4000-8000-00000000d005', '202607011000000005',
   '00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-0000000e0001',
   '详情测试门店', '测试地址 A', '000-00000001',
   'pickup', 'takeout', 2.00, 32.00, '无备注要求', 'detail-d5',
   'D-0005', (now() at time zone 'Asia/Shanghai')::date, now() - interval '10 minutes',
   null, now() - interval '1 minute', now() - interval '5 minutes');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b011"}';

select is(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d003') ->> 'status',
  'pickup',
  '读详情时：A 自己到点的「制作中」订单返回时已是「待取餐」'
);
select ok(
  (select status = 'pickup' and auto_complete_at = now() + interval '30 seconds'
     from public.orders where id = '00000000-0000-4000-8000-00000000d003'),
  '读时推进落库：状态与自动完成时刻由同一次迁移写入（门店配置 30 秒）'
);
select is(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d004') ->> 'status',
  'cooking',
  'A 自己未到点的「制作中」订单仍为「制作中」'
);
select is(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d005') ->> 'status',
  'completed',
  '读详情时：A 自己超时的「待取餐」订单返回时已是「已完成」'
);
select ok(
  (select status = 'completed' and completed_at = now()
     from public.orders where id = '00000000-0000-4000-8000-00000000d005'),
  '读时自动完成落库：完成时间取服务端时钟'
);
select is(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d005') ->> 'pickup_code',
  'D-0005',
  '超时自动完成不改写取杯号（号是下单时定死的）'
);
reset role;

select ok(
  (select status = 'cooking' from public.orders where id = '00000000-0000-4000-8000-00000000d101'),
  'A 的读取不推进 B 到点的订单（读时推进只作用于调用者自己）'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b012"}';

select is(
  public.get_my_order_detail('00000000-0000-4000-8000-00000000d101') ->> 'status',
  'pickup',
  'B 读自己的订单时到点订单被推进（每个身份的读时推进互不干扰）'
);

select * from finish();

rollback;
