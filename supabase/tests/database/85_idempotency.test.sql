-- 重复提交防护：幂等重放、标识与用户绑定、重放先于校验（Story 3.4；FR-P2-10；AD-11）
-- 「同一标识只落一张订单」的最终保证是 (user_id, idempotency_key) 唯一约束；下单函数插入冲突的
-- 捕获分支只在真并发时走到，单连接的 pgTAP 覆盖不到——按 FR-P2-19，该行为以「实现方式说明 +
-- 人工验证记录」为证据：scripts/verify-idempotency.ts（deno task verify:idempotency）。
-- 自带数据（事务内清空订单与门店后插入两个用户与样例商品），结束回滚；不依赖种子。
-- 断言描述都带对象名，失败时输出形如 "# Failed test 1: ..."，可定位到具体函数或约束。
begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

-- ── 测试数据：唯一门店 + 两个平台用户 + 两个在售商品（无规格组，selections 为空对象） ──

delete from public.order_items;
delete from public.orders;
delete from public.stores;

insert into public.stores (
  id, name, address, phone, timezone,
  takeout_packaging_fee, ready_delay_seconds, urge_lead_seconds
)
values (
  '00000000-0000-4000-8000-00000000f001', '幂等测试门店', '测试地址 9 号', '000-00000009',
  'Asia/Shanghai', 2.00, 15, 3
);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-00000000f011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'idempotency-a@wechat.local', now()),
  ('00000000-0000-4000-8000-00000000f012', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'idempotency-b@wechat.local', now());

insert into public.categories (id, name)
values ('00000000-0000-4000-8000-00000000f021', '幂等测试分类');

insert into public.products (id, category_id, name, price, availability) values
  ('00000000-0000-4000-8000-00000000f031', '00000000-0000-4000-8000-00000000f021',
   '幂等拿铁', 32.00, 'on_sale'),
  ('00000000-0000-4000-8000-00000000f032', '00000000-0000-4000-8000-00000000f021',
   '幂等气泡水', 22.00, 'on_sale');

-- ── 顺序重放：同一标识重复提交返回同一张订单，且不重复写入、不覆盖原内容 ─────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f011"}';

-- 首次下单：作为后续重放的基准，同时断言订单真的落下了（32 × 2 + 外带包装费 2 = 66）
select is(
  (select public.create_order(
     '[{"product_id":"00000000-0000-4000-8000-00000000f031","quantity":2,"selections":{}}]'::jsonb,
     'takeout', '第一次备注', 'idem-replay')->>'total_amount'),
  '66.00',
  '首次下单成功：总额 = 32 × 2 + 外带包装费 2'
);

-- 重放：故意换商品、数量、就餐方式与备注（同一个幂等标识）
select is(
  (select public.create_order(
     '[{"product_id":"00000000-0000-4000-8000-00000000f032","quantity":1,"selections":{}}]'::jsonb,
     'dinein', '换了内容', 'idem-replay')->>'id'),
  (select id::text from public.orders where idempotency_key = 'idem-replay'),
  '同一标识重放返回同一张订单（请求内容不同也一样）'
);
select is(
  (select public.create_order(
     '[{"product_id":"00000000-0000-4000-8000-00000000f032","quantity":1,"selections":{}}]'::jsonb,
     'dinein', '换了内容', 'idem-replay')->>'order_number'),
  (select order_number from public.orders where idempotency_key = 'idem-replay'),
  '重放返回的订单号与首次一致'
);
select is(
  (select count(*)::int from public.orders),
  1,
  '重放不写入第二张订单'
);
select is(
  (select count(*)::int from public.order_items),
  1,
  '重放不写入第二条明细'
);
select is(
  (select total_amount from public.orders where idempotency_key = 'idem-replay'),
  66.00::numeric,
  '重放不重算金额：仍是首次的 32 × 2 + 外带包装费 2'
);
select is(
  (select dining_mode::text from public.orders where idempotency_key = 'idem-replay'),
  'takeout',
  '重放不覆盖就餐方式'
);
select is(
  (select notes from public.orders where idempotency_key = 'idem-replay'),
  '第一次备注',
  '重放不覆盖备注'
);
select is(
  (select i.unit_price
     from public.order_items i
     join public.orders o on o.id = i.order_id
    where o.idempotency_key = 'idem-replay'),
  32.00::numeric,
  '重放不覆盖明细单价'
);
select is(
  (select i.quantity
     from public.order_items i
     join public.orders o on o.id = i.order_id
    where o.idempotency_key = 'idem-replay'),
  2,
  '重放不覆盖明细数量'
);

-- ── 重放先于校验：商品下架后重放仍拿回原单；新标识则照常被拒 ─────────────────────

reset role;

update public.products set availability = 'delisted'
 where id = '00000000-0000-4000-8000-00000000f031';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f011"}';

select is(
  (select public.create_order(
     '[{"product_id":"00000000-0000-4000-8000-00000000f031","quantity":2,"selections":{}}]'::jsonb,
     'takeout', null, 'idem-replay')->>'order_number'),
  (select order_number from public.orders where idempotency_key = 'idem-replay'),
  '商品下架后重放仍返回原单（重放发生在商品校验之前）'
);
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000f031","quantity":1,"selections":{}}]'::jsonb,
       'takeout', null, 'idem-after-delist') $$,
  'P0001', 'product_unavailable',
  '下架商品用新标识下单仍被拒绝（重放语义只对同一标识生效）'
);

reset role;

update public.products set availability = 'on_sale'
 where id = '00000000-0000-4000-8000-00000000f031';

-- ── 不同标识：两次提交产生两张订单 ─────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f011"}';

select public.create_order(
  '[{"product_id":"00000000-0000-4000-8000-00000000f032","quantity":1,"selections":{}}]'::jsonb,
  'dinein', null, 'idem-other'
);

select is(
  (select count(*)::int from public.orders),
  2,
  '不同标识产生第二张订单'
);

-- ── 标识与用户绑定：B 用 A 的标识只会得到属于自己的新订单 ──────────────────────

-- 先把 A 那张单的标识记下来（后面用 B 的身份读它，验证跨用户读不到）
reset role;

do $$ begin
  perform set_config(
    'weorder_test.a_order_id',
    (select id::text from public.orders
      where user_id = '00000000-0000-4000-8000-00000000f011'
        and idempotency_key = 'idem-replay'),
    true
  );
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f012"}';

-- 先下单并记下返回的订单标识（放在独立语句里：同一条语句内的子查询看不到刚插入的行）
do $$ begin
  perform set_config(
    'weorder_test.b_order_id',
    (public.create_order(
      '[{"product_id":"00000000-0000-4000-8000-00000000f032","quantity":1,"selections":{}}]'::jsonb,
      'dinein', null, 'idem-replay'))->>'id',
    true
  );
end $$;

select is(
  current_setting('weorder_test.b_order_id'),
  (select id::text from public.orders
    where user_id = '00000000-0000-4000-8000-00000000f012'
      and idempotency_key = 'idem-replay'),
  'B 用 A 的标识下单，拿到的是属于自己的新订单'
);
select ok(
  (select id::text from public.orders
    where user_id = '00000000-0000-4000-8000-00000000f012'
      and idempotency_key = 'idem-replay')
  is distinct from
  current_setting('weorder_test.a_order_id'),
  '两个用户使用同一标识得到两张不同的订单'
);
select is(
  (select count(*)::int from public.orders),
  1,
  'B 只看得见自己的订单（标识不跨用户取回）'
);
select is(
  (select count(*)::int from public.orders
    where id = current_setting('weorder_test.a_order_id')::uuid),
  0,
  'B 拿着 A 的订单标识也读不到那张单'
);

reset role;

select is(
  (select count(*)::int from public.orders),
  3,
  '库里共三张订单（A 两张、B 一张）'
);
select is(
  (select notes from public.orders
    where user_id = '00000000-0000-4000-8000-00000000f011'
      and idempotency_key = 'idem-replay'),
  '第一次备注',
  'B 下单后 A 的原单内容未被改动'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f011"}';

select is(
  (select public.create_order(
     '[{"product_id":"00000000-0000-4000-8000-00000000f032","quantity":3,"selections":{}}]'::jsonb,
     'dinein', null, 'idem-replay')->>'id'),
  current_setting('weorder_test.a_order_id'),
  'B 插入之后 A 再用同一标识，仍拿回 A 自己那张单'
);

-- ── 被拒的请求不占用标识：整单拒绝不留数据，同一标识可以再次使用 ───────────────

select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000f099","quantity":1,"selections":{}}]'::jsonb,
       'dinein', null, 'idem-after-fail') $$,
  'P0001', 'product_unavailable',
  '商品不存在时整单被拒（标识 idem-after-fail 未被占用）'
);
select is(
  (select public.create_order(
     '[{"product_id":"00000000-0000-4000-8000-00000000f032","quantity":1,"selections":{}}]'::jsonb,
     'dinein', null, 'idem-after-fail')->>'status'),
  'cooking',
  '被拒之后用同一标识重新提交成功（失败不留半张单）'
);

reset role;

select is(
  (select count(*)::int from public.orders where idempotency_key = 'idem-after-fail'),
  1,
  '被拒的请求没有留下数据：同一标识最终只有成功的那一张'
);
select is(
  (select count(*)::int from public.orders),
  4,
  '全部场景结束后共四张订单（A 三张、B 一张）'
);

reset role;

select * from finish();

rollback;
