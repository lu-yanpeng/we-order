-- 金额、归属与写路径的跨故事不变量（Story 3.5；FR-P2-9、FR-P2-19；AD-8、AD-12、NFR3）
-- 分工（避免重复）：
--   * 结构与客户端写路径封闭（RLS、写权限、列类型、约束）在 60_orders.test.sql；
--   * 金额纯函数自身的规则与精度在 70_amounts.test.sql；
--   * 下单函数的逐项校验、快照与订单号在 80_create_order.test.sql；
--   * 幂等重放与用户绑定在 85_idempotency.test.sql。
-- 本文件只补这些文件没有覆盖的跨故事不变量：
--   1) 归属取自会话身份——请求条目里伪造的 user_id / order_number 被忽略；
--   2) 落库金额 = 用库内价目（商品基础价 + 规格选项加价）重算的结果，按公式交叉验算，
--      而不是只跟硬编码期望值比；
--   3) 非法输入（混合清单、null 就餐方式）整单被拒，且已有订单的行数与金额不被改动；
--   4) 不存在「有单无明细」的行。
-- 断言描述都带对象名，失败时输出形如 "# Failed test 1: ..."，可定位到具体函数或策略。
-- 自带数据（事务内清空订单与门店后插入样例），结束回滚；在重建后的空库上直接通过。
begin;

create extension if not exists pgtap with schema extensions;

-- ── 测试辅助（随事务回滚）────────────────────────────────────────────────────
-- 请求体：条目里故意携带金额字段与伪造的归属字段，用于证明它们被忽略（FR-P2-9）。
create function public.test_inv_payload() returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'product_id', '00000000-0000-4000-8000-00000000c031',
      'quantity', 2,
      'unit_price', 0.01,
      'total_amount', 0.01,
      'price', 0.01,
      'user_id', '00000000-0000-4000-8000-00000000c012',
      'order_number', '000000000000000000',
      'selections', jsonb_build_object(
        '00000000-0000-4000-8000-00000000c041', '00000000-0000-4000-8000-00000000c052',
        '00000000-0000-4000-8000-00000000c042',
          jsonb_build_array('00000000-0000-4000-8000-00000000c053',
                            '00000000-0000-4000-8000-00000000c054')
      )
    )
  );
$$;
grant execute on function public.test_inv_payload() to authenticated;

-- 从规格选择快照（规格组 id → 选项 id 或数组）还原所选选项的加价数组（AD-22）。
create function public.test_selection_extras(p_selections jsonb) returns numeric[]
language sql
stable
as $$
  select coalesce(array_agg(o.price_extra order by o.sort_order, o.id), '{}'::numeric[])
  from jsonb_each(p_selections) as sel(group_id, value)
  cross join lateral (
    select t.option_id
    from (
      select jsonb_array_elements_text(
               case when jsonb_typeof(sel.value) = 'array' then sel.value else '[]'::jsonb end
             ) as option_id
      union all
      select sel.value #>> '{}'
      where jsonb_typeof(sel.value) = 'string'
    ) t
  ) as ids
  join public.spec_options o on o.id::text = ids.option_id;
$$;

-- 用库内价目重算某条明细的单价：商品基础价 + 所选选项加价（AD-8）。
create function public.test_recompute_item_unit_price(p_item_id uuid) returns numeric
language sql
stable
as $$
  select public.calculate_unit_price(p.price, public.test_selection_extras(i.selections))
  from public.order_items i
  join public.products p on p.id = i.product_id
  where i.id = p_item_id;
$$;

-- 用落库的明细与包装费重算某张订单的总额：各行小计之和 + 包装费（AD-8）。
create function public.test_recompute_order_total(p_order_id uuid) returns numeric
language sql
stable
as $$
  select public.calculate_order_total(
           coalesce(
             (select array_agg(public.calculate_line_amount(i.unit_price, i.quantity))
                from public.order_items i
               where i.order_id = o.id),
             '{}'::numeric[]
           ),
           o.dining_mode,
           o.packaging_fee
         )
  from public.orders o
  where o.id = p_order_id;
$$;

select plan(15);

-- ── 测试数据：唯一门店 + 两个平台用户 + 商品与规格 ────────────────────────────

delete from public.order_items;
delete from public.orders;
delete from public.stores;

insert into public.stores (
  id, name, address, phone, timezone,
  takeout_packaging_fee, ready_delay_seconds, urge_lead_seconds
)
values (
  '00000000-0000-4000-8000-00000000c001', '不变量测试门店', '测试地址 7 号', '000-00000007',
  'Asia/Shanghai', 2.00, 15, 3
);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-00000000c011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-a@wechat.local', now()),
  ('00000000-0000-4000-8000-00000000c012', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-b@wechat.local', now());

insert into public.categories (id, name)
values ('00000000-0000-4000-8000-00000000c021', '不变量测试分类');

insert into public.products (id, category_id, name, price, availability) values
  ('00000000-0000-4000-8000-00000000c031', '00000000-0000-4000-8000-00000000c021',
   '规格拿铁', 32.00, 'on_sale'),
  ('00000000-0000-4000-8000-00000000c032', '00000000-0000-4000-8000-00000000c021',
   '无规格气泡水', 22.00, 'on_sale'),
  ('00000000-0000-4000-8000-00000000c033', '00000000-0000-4000-8000-00000000c021',
   '售罄商品', 30.00, 'sold_out');

insert into public.spec_groups (id, title, multi) values
  ('00000000-0000-4000-8000-00000000c041', '杯型', false),
  ('00000000-0000-4000-8000-00000000c042', '加料', true);

insert into public.spec_options (id, group_id, label, price_extra, sort_order) values
  ('00000000-0000-4000-8000-00000000c051', '00000000-0000-4000-8000-00000000c041', '中杯', 0.00, 1),
  ('00000000-0000-4000-8000-00000000c052', '00000000-0000-4000-8000-00000000c041', '大杯', 3.00, 2),
  ('00000000-0000-4000-8000-00000000c053', '00000000-0000-4000-8000-00000000c042', '焦糖', 3.00, 1),
  ('00000000-0000-4000-8000-00000000c054', '00000000-0000-4000-8000-00000000c042', '可可碎片', 4.00, 2);

insert into public.product_spec_groups (product_id, group_id, sort_order) values
  ('00000000-0000-4000-8000-00000000c031', '00000000-0000-4000-8000-00000000c041', 1),
  ('00000000-0000-4000-8000-00000000c031', '00000000-0000-4000-8000-00000000c042', 2);

-- ── 归属：会话身份是唯一来源，入参里的用户标识被忽略（FR-P2-9、AD-3）──────────
-- 两个身份提交完全相同的内容（含伪造的 user_id / order_number），应各归各的。

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c011"}';
select public.create_order(public.test_inv_payload(), 'takeout', null, 'inv-owner-a');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c012"}';
select public.create_order(public.test_inv_payload(), 'takeout', null, 'inv-owner-b');

reset role;

select is(
  (select user_id from public.orders where idempotency_key = 'inv-owner-a'),
  '00000000-0000-4000-8000-00000000c011'::uuid,
  'create_order 归属取自会话身份：条目里伪造的 user_id 被忽略'
);
select ok(
  (select user_id <> '00000000-0000-4000-8000-00000000c012'::uuid
     from public.orders where idempotency_key = 'inv-owner-a'),
  'create_order 落库归属不是请求里伪造的那个用户'
);
select is(
  (select user_id from public.orders where idempotency_key = 'inv-owner-b'),
  '00000000-0000-4000-8000-00000000c012'::uuid,
  '同一份请求由第二个会话提交时归属第二个会话'
);
select is(
  (select count(*)::int from public.orders),
  2,
  '两个身份各自落单：不产生归属不明的订单'
);

-- ── 金额：落库值 = 用库内价目重算的结果，客户端传入的金额被忽略（FR-P2-9、AD-8）──

select is(
  (select i.unit_price
     from public.order_items i
     join public.orders o on o.id = i.order_id
    where o.idempotency_key = 'inv-owner-a'),
  42.00::numeric,
  '明细单价 = 基础价 32 + 大杯 3 + 焦糖 3 + 可可碎片 4（客户端传入的 0.01 未落库）'
);
select is(
  (select o.total_amount from public.orders o where o.idempotency_key = 'inv-owner-a'),
  86.00::numeric,
  '订单总额 = 行小计（42 × 2）+ 外带包装费 2，等于服务端重算结果'
);
select is(
  (select count(*)::int
     from public.order_items i
    where i.unit_price is distinct from public.test_recompute_item_unit_price(i.id)),
  0,
  '库中不存在与「商品基础价 + 所选选项加价」重算不符的明细单价（金额只来自两处定义点）'
);
select is(
  (select count(*)::int
     from public.orders o
    where o.total_amount is distinct from public.test_recompute_order_total(o.id)),
  0,
  '库中不存在「订单头金额 ≠ 明细小计之和 + 包装费」的行'
);

-- ── 非法输入：整单被拒且不留下数据、不改动已有订单（FR-P2-9、NFR3）───────────
-- 混合清单：第一条合法、第二条非法——证明拒绝的是整单，而不是逐条丢弃。

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c011"}';

select throws_ok(
  $$ select public.create_order(
       '[
          {"product_id":"00000000-0000-4000-8000-00000000c032","quantity":1,"selections":{}},
          {"product_id":"00000000-0000-4000-8000-00000000c033","quantity":1,"selections":{}}
        ]'::jsonb,
       'dinein', null, 'inv-mixed-1') $$,
  'P0001', 'product_unavailable',
  '混合清单中第二条售罄：整单被拒（product_unavailable）'
);
select throws_ok(
  $$ select public.create_order(
       '[
          {"product_id":"00000000-0000-4000-8000-00000000c031","quantity":1,"selections":{
             "00000000-0000-4000-8000-00000000c041":"00000000-0000-4000-8000-00000000c052",
             "00000000-0000-4000-8000-00000000c042":["00000000-0000-4000-8000-00000000c053"]}},
          {"product_id":"00000000-0000-4000-8000-00000000c032","quantity":1,"selections":{
             "00000000-0000-4000-8000-00000000c041":"00000000-0000-4000-8000-00000000c052"}}
        ]'::jsonb,
       'dinein', null, 'inv-mixed-2') $$,
  'P0001', 'invalid_selection',
  '混合清单中第二条提交了未挂到商品的规格组：整单被拒（invalid_selection）'
);
select throws_ok(
  $$ select public.create_order(public.test_inv_payload(), null, null, 'inv-null-mode') $$,
  'P0001', 'invalid_request',
  '就餐方式为 null 被归类为 invalid_request（而不是数据库 not-null 报错）'
);

reset role;

select is(
  (select count(*)::int from public.orders),
  2,
  '非法请求整单被拒：订单行数不变，不留半张单'
);
select is(
  (select count(*)::int from public.order_items),
  2,
  '非法请求整单被拒：明细行数不变，不留半条明细'
);
select is(
  (select sum(total_amount) from public.orders),
  172.00::numeric,
  '非法请求不改动已有订单的金额（两张 86.00）'
);

-- ── 无孤儿单：不存在「有单无明细」的行（FR-P2-9、NFR2）───────────────────────

select is(
  (select count(*)::int
     from public.orders o
    where not exists (select 1 from public.order_items i where i.order_id = o.id)),
  0,
  '不存在没有任何明细的订单行（订单与明细同事务写入）'
);

select * from finish();

rollback;
