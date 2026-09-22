-- 下单服务端函数：唯一写路径、金额重算、严格规格校验、幂等重放与整单拒绝
-- （Story 3.3；FR-P2-9、FR-P2-10、NFR2；AD-2、AD-3、AD-8、AD-9、AD-10、AD-11、AD-12、AD-22）
-- 断言描述都带对象名，失败时输出形如 "# Failed test 1: ..."，可定位到具体函数或策略。
-- 自带数据（事务内清空订单与门店后插入样例），结束回滚；不依赖种子，在重建后的空库上直接通过。
begin;

create extension if not exists pgtap with schema extensions;

-- 测试辅助：一份「带完整规格」的请求体，避免在断言里重复长 JSON（随事务回滚）
create function public.test_spec_items() returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'product_id', '00000000-0000-4000-8000-00000000e031',
      'quantity', 2,
      'selections', jsonb_build_object(
        '00000000-0000-4000-8000-00000000e041', '00000000-0000-4000-8000-00000000e052',
        '00000000-0000-4000-8000-00000000e042', '00000000-0000-4000-8000-00000000e053',
        '00000000-0000-4000-8000-00000000e043',
          jsonb_build_array('00000000-0000-4000-8000-00000000e055',
                            '00000000-0000-4000-8000-00000000e056')
      )
    )
  );
$$;
grant execute on function public.test_spec_items() to authenticated;

select plan(93);

-- ── 函数属性与权限：唯一写入口，参数无金额/用户入口 ─────────────────────────

select ok(
  (select prosecdef from pg_proc
    where oid = 'public.create_order(jsonb, public.dining_mode, text, text)'::regprocedure),
  'create_order 是 security definer'
);
select ok(
  (select 'search_path=""' = any(coalesce(proconfig, '{}')) from pg_proc
    where oid = 'public.create_order(jsonb, public.dining_mode, text, text)'::regprocedure),
  'create_order 使用空 search_path'
);
select is(
  (select proargnames::text from pg_proc
    where oid = 'public.create_order(jsonb, public.dining_mode, text, text)'::regprocedure),
  '{p_items,p_dining_mode,p_notes,p_idempotency_key}',
  'create_order 的参数只有商品、就餐方式、备注与幂等键——没有金额、用户与订单号入口'
);
select ok(
  not has_function_privilege('anon', 'public.create_order(jsonb, public.dining_mode, text, text)', 'EXECUTE'),
  '未认证不能执行 create_order'
);
select ok(
  has_function_privilege('authenticated', 'public.create_order(jsonb, public.dining_mode, text, text)', 'EXECUTE'),
  '已登录身份可以执行 create_order'
);
select ok(
  not has_function_privilege('anon', 'public.order_result_json(public.orders, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.order_result_json(public.orders, text)', 'EXECUTE'),
  'order_result_json 是内部映射实现，客户端不可执行'
);
select ok(
  not has_table_privilege('authenticated', 'public.orders', 'INSERT')
  and not has_table_privilege('authenticated', 'public.orders', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.orders', 'DELETE')
  and not has_table_privilege('authenticated', 'public.order_items', 'INSERT')
  and not has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.order_items', 'DELETE'),
  '下单函数不附带额外表权限：客户端对订单与明细仍不可写'
);
select is(
  (select array_agg(enumlabel::text order by enumsortorder) from pg_enum
    where enumtypid = 'public.order_error_code'::regtype),
  array['invalid_request', 'invalid_quantity', 'invalid_selection',
        'product_unavailable', 'not_authenticated', 'store_unavailable',
        'invalid_transition', 'order_not_found', 'invalid_status'],
  'order_error_code 的取值集合只有数据库里的这一份定义'
);

-- ── 测试数据：唯一门店 + 平台用户 + 商品与规格 ────────────────────────────────

delete from public.order_items;
delete from public.orders;
delete from public.stores;

insert into public.stores (
  id, name, address, phone, timezone,
  takeout_packaging_fee, ready_delay_seconds, urge_lead_seconds
)
values (
  '00000000-0000-4000-8000-00000000e001', '测试门店', '测试地址 1 号', '000-00000000', 'Asia/Shanghai',
  2.00, 15, 3
);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values (
  '00000000-0000-4000-8000-00000000e011', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'create-order@wechat.local', now()
);

insert into public.categories (id, name)
values ('00000000-0000-4000-8000-00000000e021', '测试分类');

insert into public.products (id, category_id, name, price, availability) values
  ('00000000-0000-4000-8000-00000000e031', '00000000-0000-4000-8000-00000000e021', '测试拿铁', 32.00, 'on_sale'),
  ('00000000-0000-4000-8000-00000000e032', '00000000-0000-4000-8000-00000000e021', '测试气泡水', 22.00, 'on_sale'),
  ('00000000-0000-4000-8000-00000000e033', '00000000-0000-4000-8000-00000000e021', '售罄商品', 30.00, 'sold_out'),
  ('00000000-0000-4000-8000-00000000e034', '00000000-0000-4000-8000-00000000e021', '下架商品', 30.00, 'delisted');

insert into public.spec_groups (id, title, multi) values
  ('00000000-0000-4000-8000-00000000e041', '杯型', false),
  ('00000000-0000-4000-8000-00000000e042', '温度', false),
  ('00000000-0000-4000-8000-00000000e043', '加料', true),
  ('00000000-0000-4000-8000-00000000e044', '未挂到商品的组', false);

insert into public.spec_options (id, group_id, label, price_extra, sort_order) values
  ('00000000-0000-4000-8000-00000000e051', '00000000-0000-4000-8000-00000000e041', '中杯', 0.00, 1),
  ('00000000-0000-4000-8000-00000000e052', '00000000-0000-4000-8000-00000000e041', '大杯', 3.00, 2),
  ('00000000-0000-4000-8000-00000000e053', '00000000-0000-4000-8000-00000000e042', '冰', 0.00, 1),
  ('00000000-0000-4000-8000-00000000e054', '00000000-0000-4000-8000-00000000e042', '热', 0.00, 2),
  ('00000000-0000-4000-8000-00000000e055', '00000000-0000-4000-8000-00000000e043', '焦糖', 3.00, 1),
  ('00000000-0000-4000-8000-00000000e056', '00000000-0000-4000-8000-00000000e043', '可可碎片', 4.00, 2),
  ('00000000-0000-4000-8000-00000000e057', '00000000-0000-4000-8000-00000000e044', '孤组选项', 1.00, 1);

insert into public.product_spec_groups (product_id, group_id, sort_order) values
  ('00000000-0000-4000-8000-00000000e031', '00000000-0000-4000-8000-00000000e041', 1),
  ('00000000-0000-4000-8000-00000000e031', '00000000-0000-4000-8000-00000000e042', 2),
  ('00000000-0000-4000-8000-00000000e031', '00000000-0000-4000-8000-00000000e043', 3);

-- ── 会话身份：未认证连入口都没有；无身份则明确拒绝 ───────────────────────────

set local role anon;

select throws_ok(
  $$ select public.create_order(public.test_spec_items(), 'takeout', null, 'key-anon') $$,
  '42501', null, '未认证不能执行 create_order'
);

set local role authenticated;

select throws_ok(
  $$ select public.create_order(public.test_spec_items(), 'takeout', null, 'key-noauth') $$,
  'P0001', 'not_authenticated', '没有会话身份时拒绝下单（归属没有来源）'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e011"}';

select is(
  (select auth.uid()),
  '00000000-0000-4000-8000-00000000e011'::uuid,
  '会话身份注入生效：auth.uid() 指向测试用户'
);

-- ── 非法输入：整单拒绝且不留下任何数据（FR-P2-9） ────────────────────────────

select throws_ok(
  $$ select public.create_order('"nope"'::jsonb, 'dinein', null, 'key-1') $$,
  'P0001', 'invalid_request', '商品清单不是数组被拒绝'
);
select throws_ok(
  $$ select public.create_order('[]'::jsonb, 'dinein', null, 'key-2') $$,
  'P0001', 'invalid_request', '商品清单为空被拒绝'
);
select throws_ok(
  $$ select public.create_order('[1]'::jsonb, 'dinein', null, 'key-3') $$,
  'P0001', 'invalid_request', '商品条目不是对象被拒绝'
);
select throws_ok(
  $$ select public.create_order('[{"quantity":1,"selections":{}}]'::jsonb, 'dinein', null, 'key-4') $$,
  'P0001', 'invalid_request', '缺少商品引用被拒绝'
);
select throws_ok(
  $$ select public.create_order('[{"product_id":"nope","quantity":1,"selections":{}}]'::jsonb, 'dinein', null, 'key-5') $$,
  'P0001', 'invalid_request', '商品引用不是合法标识被拒绝'
);
select throws_ok(
  $$ select public.create_order(public.test_spec_items(), 'dinein', null, '') $$,
  'P0001', 'invalid_request', '缺少幂等键被拒绝（必填，AD-11）'
);
select throws_ok(
  $$ select public.create_order(public.test_spec_items(), 'dinein', null, '   ') $$,
  'P0001', 'invalid_request', '幂等键只有空白被拒绝'
);
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":1,"selections":[]}]'::jsonb,
       'dinein', null, 'key-8') $$,
  'P0001', 'invalid_request', '规格选择不是对象被拒绝'
);
select throws_ok(
  $$ select public.create_order(public.test_spec_items(), 'dinein', repeat('备', 31), 'key-9') $$,
  'P0001', 'invalid_request', '备注超过 30 字被拒绝'
);
select throws_ok(
  $$ select public.create_order('[{"product_id":"00000000-0000-4000-8000-00000000e032","selections":{}}]'::jsonb, 'dinein', null, 'key-10') $$,
  'P0001', 'invalid_quantity', '缺少数量被拒绝'
);
select throws_ok(
  $$ select public.create_order('[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":0,"selections":{}}]'::jsonb, 'dinein', null, 'key-11') $$,
  'P0001', 'invalid_quantity', '数量为零被拒绝'
);
select throws_ok(
  $$ select public.create_order('[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":-1,"selections":{}}]'::jsonb, 'dinein', null, 'key-12') $$,
  'P0001', 'invalid_quantity', '数量为负被拒绝'
);
select throws_ok(
  $$ select public.create_order('[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":2.5,"selections":{}}]'::jsonb, 'dinein', null, 'key-13') $$,
  'P0001', 'invalid_quantity', '数量不是整数被拒绝'
);
select throws_ok(
  $$ select public.create_order('[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":3000000000,"selections":{}}]'::jsonb, 'dinein', null, 'key-14') $$,
  'P0001', 'invalid_quantity', '数量超出可存储范围被拒绝（不会写错金额）'
);
select throws_ok(
  $$ select public.create_order('[{"product_id":"00000000-0000-4000-8000-00000000ee99","quantity":1,"selections":{}}]'::jsonb, 'dinein', null, 'key-15') $$,
  'P0001', 'product_unavailable', '商品不存在被拒绝'
);
select throws_ok(
  $$ select public.create_order('[{"product_id":"00000000-0000-4000-8000-00000000e033","quantity":1,"selections":{}}]'::jsonb, 'dinein', null, 'key-16') $$,
  'P0001', 'product_unavailable', '售罄商品被拒绝'
);
select throws_ok(
  $$ select public.create_order('[{"product_id":"00000000-0000-4000-8000-00000000e034","quantity":1,"selections":{}}]'::jsonb, 'dinein', null, 'key-17') $$,
  'P0001', 'product_unavailable', '下架商品被拒绝'
);
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e031","quantity":1,"selections":{}}]'::jsonb,
       'dinein', null, 'key-18') $$,
  'P0001', 'invalid_selection', '漏掉商品挂的规格组被拒绝（严格校验）'
);
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":1,"selections":{"00000000-0000-4000-8000-00000000e041":"00000000-0000-4000-8000-00000000e051"}}]'::jsonb,
       'dinein', null, 'key-19') $$,
  'P0001', 'invalid_selection', '提交了商品没有挂的规格组被拒绝'
);
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e031","quantity":1,"selections":{"00000000-0000-4000-8000-00000000e041":["00000000-0000-4000-8000-00000000e052"],"00000000-0000-4000-8000-00000000e042":"00000000-0000-4000-8000-00000000e053","00000000-0000-4000-8000-00000000e043":[]}}]'::jsonb,
       'dinein', null, 'key-20') $$,
  'P0001', 'invalid_selection', '单选组给了数组被拒绝（形状必须与组的多选标记一致）'
);
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e031","quantity":1,"selections":{"00000000-0000-4000-8000-00000000e041":"00000000-0000-4000-8000-00000000e052","00000000-0000-4000-8000-00000000e042":"00000000-0000-4000-8000-00000000e053","00000000-0000-4000-8000-00000000e043":"00000000-0000-4000-8000-00000000e055"}}]'::jsonb,
       'dinein', null, 'key-21') $$,
  'P0001', 'invalid_selection', '多选组给了字符串被拒绝'
);
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e031","quantity":1,"selections":{"00000000-0000-4000-8000-00000000e041":"00000000-0000-4000-8000-00000000e052","00000000-0000-4000-8000-00000000e042":"00000000-0000-4000-8000-00000000e053","00000000-0000-4000-8000-00000000e043":["00000000-0000-4000-8000-00000000e057"]}}]'::jsonb,
       'dinein', null, 'key-22') $$,
  'P0001', 'invalid_selection', '选项不属于所提交的规格组被拒绝'
);
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e031","quantity":1,"selections":{"00000000-0000-4000-8000-00000000e041":"00000000-0000-4000-8000-00000000e052","00000000-0000-4000-8000-00000000e042":"00000000-0000-4000-8000-00000000e053","00000000-0000-4000-8000-00000000e043":["00000000-0000-4000-8000-00000000e055","00000000-0000-4000-8000-00000000e055"]}}]'::jsonb,
       'dinein', null, 'key-23') $$,
  'P0001', 'invalid_selection', '多选组里重复选同一个选项被拒绝'
);
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e031","quantity":1,"selections":{"00000000-0000-4000-8000-00000000e041":"00000000-0000-4000-8000-00000000e999","00000000-0000-4000-8000-00000000e042":"00000000-0000-4000-8000-00000000e053","00000000-0000-4000-8000-00000000e043":[]}}]'::jsonb,
       'dinein', null, 'key-24') $$,
  'P0001', 'invalid_selection', '不存在的选项被拒绝'
);
select throws_ok(
  $$ select public.create_order(public.test_spec_items(), 'eat', null, 'key-25') $$,
  '22P02', null, '就餐方式取值非法由类型层拒绝（进不了函数）'
);

select is(
  (select count(*)::int from public.orders),
  0,
  '非法输入之后没有任何订单写入'
);
select is(
  (select count(*)::int from public.order_items),
  0,
  '非法输入之后没有任何明细写入'
);

-- ── 成功路径：金额、快照、订单号、门店快照与推进时刻 ──────────────────────────

select is(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'status'),
  'cooking',
  '首次下单返回新订单：状态为 cooking'
);
select matches(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'order_number'),
  '^[0-9]{18}$',
  '订单号是 18 位纯数字（门店本地时间 + 随机尾号，FR-P2-9）'
);
select matches(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'pickup_code'),
  '^[A-Z]-[0-9]{4}$',
  '新订单在下单时即取得取杯号：外形为字母前缀 + 四位数字（Story 4.4）'
);
select is(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'total_amount'),
  '86.00',
  '返回的总额 = 行小计（32 + 10）× 2 + 外带包装费 2'
);
select is(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'packaging_fee'),
  '2.00',
  '返回的包装费来自门店配置'
);
select is(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'dining_mode'),
  'takeout',
  '返回的就餐方式与提交一致'
);
select is(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'notes'),
  '少冰',
  '返回的备注与提交一致'
);
select is(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'created_at'),
  to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'),
  '创建时间取服务端时钟并按门店时区格式化（AD-10）'
);
select matches(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'id'),
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  '返回的订单标识可用于后续按 id 读取'
);
select is(
  (select count(*)::int from public.orders),
  1,
  '重复提交同一幂等键只落一张订单'
);
select is(
  (select user_id from public.orders),
  '00000000-0000-4000-8000-00000000e011'::uuid,
  '归属取自会话身份，而不是任何入参'
);
select is(
  (select status::text from public.orders),
  'cooking',
  '新订单落库状态为 cooking'
);
select matches(
  (select pickup_code from public.orders where idempotency_key = 'key-specs'),
  '^[A-Z]-[0-9]{4}$',
  '新订单落库即带取杯号（下单即发号，Story 4.4）'
);
select is(
  (select pickup_code_date from public.orders where idempotency_key = 'key-specs'),
  (now() at time zone 'Asia/Shanghai')::date,
  '发号日期取下单时刻的门店本地自然日（AD-10）'
);

-- 计数器是内部表（客户端不可读）：以下读操作以库所有者身份执行
reset role;

select is(
  (select counter from public.pickup_code_counters
    where store_id = '00000000-0000-4000-8000-00000000e001'
      and local_date = (now() at time zone 'Asia/Shanghai')::date),
  1,
  '下单消耗「门店 + 当日」计数器一次：取号与建单在同一条 INSERT 内'
);

set local role authenticated;

select is(
  (select notes from public.orders),
  '少冰',
  '备注原样落库'
);
select is(
  (select packaging_fee from public.orders),
  2.00::numeric,
  '落库包装费 = 外带 2.00'
);
select is(
  (select total_amount from public.orders),
  86.00::numeric,
  '落库总额等于服务端重算结果'
);
select is(
  (select ready_at - created_at from public.orders),
  '15 seconds'::interval,
  '推进时刻 = 服务端时钟 + 门店配置的推进时长（默认 15 秒）'
);
select is(
  (select store_id from public.orders),
  '00000000-0000-4000-8000-00000000e001'::uuid,
  '订单记录门店引用'
);
select is(
  (select store_name from public.orders),
  '测试门店',
  '订单保存门店名称快照'
);
select is(
  (select store_address from public.orders),
  '测试地址 1 号',
  '订单保存门店地址快照'
);
select is(
  (select store_phone from public.orders),
  '000-00000000',
  '订单保存门店电话快照'
);
select is(
  (select dining_mode::text from public.orders),
  'takeout',
  '就餐方式原样落库'
);
select is(
  (select idempotency_key from public.orders),
  'key-specs',
  '幂等键落库供后续重放'
);
select is(
  (select count(*)::int from public.order_items),
  1,
  '订单与明细同事务写入，不存在有单无明细'
);
select is(
  (select unit_price from public.order_items),
  42.00::numeric,
  '明细单价 = 基础价 32 + 规格加价 3 + 3 + 4'
);
select is(
  (select quantity from public.order_items),
  2,
  '明细数量原样落库'
);
select is(
  (select product_name from public.order_items),
  '测试拿铁',
  '明细保存商品名快照'
);
select is(
  (select spec_summary from public.order_items),
  '大杯 / 冰 / 焦糖 / 可可碎片',
  '规格摘要由服务端按规格组与选项的 sort_order 生成'
);
select is(
  (select selections from public.order_items),
  '{"00000000-0000-4000-8000-00000000e041":"00000000-0000-4000-8000-00000000e052","00000000-0000-4000-8000-00000000e042":"00000000-0000-4000-8000-00000000e053","00000000-0000-4000-8000-00000000e043":["00000000-0000-4000-8000-00000000e055","00000000-0000-4000-8000-00000000e056"]}'::jsonb,
  '规格选择快照：单选为选项 id、多选为选项 id 数组（AD-22）'
);
select is(
  (select product_id from public.order_items),
  '00000000-0000-4000-8000-00000000e031'::uuid,
  '明细保存商品引用供「再来一单」使用'
);
select is(
  (select public.create_order(public.test_spec_items(), 'takeout', '少冰', 'key-specs')->>'order_number'),
  (select order_number from public.orders),
  '同一幂等键重放返回同一张订单（不重复写入）'
);
select is(
  (select count(*)::int from public.order_items),
  1,
  '重放之后明细没有增加'
);

-- ── 无规格商品、堂食、备注默认与「金额字段被忽略」 ──────────────────────────

select is(
  (select public.create_order(
     '[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":1,"selections":{},
        "unit_price":0.01,"total_amount":0.01,"price":0.01}]'::jsonb,
     'dinein', null, 'key-plain')->>'total_amount'),
  '22.00',
  '请求里携带的金额字段被忽略：落库金额等于重算结果'
);
select is(
  (select public.create_order(
     '[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":1,"selections":{}}]'::jsonb,
     'dinein', null, 'key-plain')->>'packaging_fee'),
  '0.00',
  '堂食不收包装费'
);
select is(
  (select notes from public.orders where idempotency_key = 'key-plain'),
  '无备注要求',
  '备注未传时落库为「无备注要求」'
);
select is(
  (select unit_price from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'key-plain')),
  22.00::numeric,
  '无规格商品的单价等于基础价'
);
select is(
  (select selections from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'key-plain')),
  '{}'::jsonb,
  '无规格商品的规格选择快照为空对象'
);
select is(
  (select spec_summary from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'key-plain')),
  '',
  '无规格商品的摘要为空串'
);
select is(
  (select count(*)::int from public.orders),
  2,
  '不同幂等键产生两张订单'
);
select isnt(
  (select pickup_code from public.orders where idempotency_key = 'key-specs'),
  (select pickup_code from public.orders where idempotency_key = 'key-plain'),
  '同一自然日内的两张订单取杯号不同（计数器依次发号，不重号）'
);

-- 计数器是内部表（客户端不可读）：以库所有者身份读
reset role;

select is(
  (select counter from public.pickup_code_counters
    where store_id = '00000000-0000-4000-8000-00000000e001'
      and local_date = (now() at time zone 'Asia/Shanghai')::date),
  2,
  '计数器记录当日已发出的序号数'
);

-- ── 快照隔离：商品改名改价不影响历史订单（AD-9） ─────────────────────────────

update public.products set name = '改名后的拿铁', price = 1.00
 where id = '00000000-0000-4000-8000-00000000e031';

set local role authenticated;

select is(
  (select product_name from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'key-specs')),
  '测试拿铁',
  '商品改名后历史订单仍是下单时的商品名'
);
select is(
  (select unit_price from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'key-specs')),
  42.00::numeric,
  '商品改价后历史订单仍是下单时的单价'
);
select is(
  (select total_amount from public.orders where idempotency_key = 'key-specs'),
  86.00::numeric,
  '商品改价后历史订单总额不变'
);

-- ── 配置驱动：改门店配置后按新值计算（AD-6、AD-8） ───────────────────────────

reset role;

update public.stores set takeout_packaging_fee = 5.00, ready_delay_seconds = 7;

set local role authenticated;

select is(
  (select public.create_order(
     '[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":1,"selections":{}}]'::jsonb,
     'takeout', null, 'key-config')->>'packaging_fee'),
  '5.00',
  '包装费按门店配置收取，不是写死的 2.00'
);
select is(
  (select total_amount from public.orders where idempotency_key = 'key-config'),
  27.00::numeric,
  '总额 = 行小计 22 + 配置后的包装费 5'
);
select is(
  (select ready_at - created_at from public.orders where idempotency_key = 'key-config'),
  '7 seconds'::interval,
  '推进时刻读取门店配置的推进时长（Story 4.1 共用同一处配置）'
);
select is(
  (select count(*)::int from public.orders),
  3,
  '三次不同幂等键的下单共三张订单'
);

-- ── 故障注入：订单号撞号时换号重试（唯一约束 + 冲突重试，FR-P2-9） ────────────

reset role;

-- 第一次插入强制报唯一冲突（模拟撞号），重试必须成功；序列号不随子事务回滚，适合做一次性开关
create sequence public.test_collision_seq;

create function public.test_order_number_collision() returns trigger
language plpgsql
as $$
begin
  if nextval('public.test_collision_seq') = 1 then
    raise exception 'simulated order number collision' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger test_order_number_collision before insert on public.orders
for each row execute function public.test_order_number_collision();

set local role authenticated;

select lives_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":1,"selections":{}}]'::jsonb,
       'dinein', null, 'key-collision') $$,
  '订单号撞号时换号重试：下单仍然成功'
);

reset role;

drop trigger test_order_number_collision on public.orders;
drop function public.test_order_number_collision();
drop sequence public.test_collision_seq;

select matches(
  (select order_number from public.orders where idempotency_key = 'key-collision'),
  '^[0-9]{18}$',
  '换号后的订单号仍是 18 位纯数字'
);
select is(
  (select count(*)::int from public.orders where idempotency_key = 'key-collision'),
  1,
  '换号重试不会产生第二张订单'
);

-- ── 门店唯一性：Phase 2 只有一家，不"猜"门店 ────────────────────────────────

reset role;

insert into public.stores (id, name, address, phone, timezone)
values ('00000000-0000-4000-8000-00000000e002', '第二家门店', '测试地址 2 号', '000-00000001', 'Asia/Shanghai');

set local role authenticated;

select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-4000-8000-00000000e032","quantity":1,"selections":{}}]'::jsonb,
       'dinein', null, 'key-two-stores') $$,
  'P0001', 'store_unavailable', '门店不止一家时拒绝下单（FR-P2-8）'
);
select is(
  (select count(*)::int from public.orders),
  4,
  '门店不唯一时被拒绝且不留下新订单'
);

reset role;

select * from finish();

rollback;
