-- 目录公开读边界：未认证可读、客户端不可写、RLS 逐表启用（Story 1.2；AD-20、AD-21）
begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

-- 结构：五张目录表都已启用行级访问控制
select ok(
  (select relrowsecurity from pg_class where oid = 'public.categories'::regclass),
  'categories 已启用 RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.products'::regclass),
  'products 已启用 RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.spec_groups'::regclass),
  'spec_groups 已启用 RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.spec_options'::regclass),
  'spec_options 已启用 RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.product_spec_groups'::regclass),
  'product_spec_groups 已启用 RLS'
);

-- 未认证：五张表都可读
set local role anon;

select lives_ok('select * from public.categories', '未认证可读取 categories');
select lives_ok('select * from public.products', '未认证可读取 products');
select lives_ok('select * from public.spec_groups', '未认证可读取 spec_groups');
select lives_ok('select * from public.spec_options', '未认证可读取 spec_options');
select lives_ok('select * from public.product_spec_groups', '未认证可读取 product_spec_groups');

-- 未认证：五张表都不可写（目录表不存在任何客户端写策略，写路径留给 Phase 4）
select throws_ok(
  'insert into public.categories (name) values (''x'')',
  '42501', null, '未认证不能写入 categories'
);
select throws_ok(
  'insert into public.products (category_id, name, price) values (gen_random_uuid(), ''x'', 1)',
  '42501', null, '未认证不能写入 products'
);
select throws_ok(
  'insert into public.spec_groups (title) values (''x'')',
  '42501', null, '未认证不能写入 spec_groups'
);
select throws_ok(
  'insert into public.spec_options (group_id, label) values (gen_random_uuid(), ''x'')',
  '42501', null, '未认证不能写入 spec_options'
);
select throws_ok(
  'insert into public.product_spec_groups (product_id, group_id) values (gen_random_uuid(), gen_random_uuid())',
  '42501', null, '未认证不能写入 product_spec_groups'
);

-- 已登录身份：同样不可写
set local role authenticated;

select throws_ok(
  'insert into public.categories (name) values (''x'')',
  '42501', null, '已登录身份不能写入 categories'
);
select throws_ok(
  'insert into public.products (category_id, name, price) values (gen_random_uuid(), ''x'', 1)',
  '42501', null, '已登录身份不能写入 products'
);
select throws_ok(
  'insert into public.spec_groups (title) values (''x'')',
  '42501', null, '已登录身份不能写入 spec_groups'
);
select throws_ok(
  'insert into public.spec_options (group_id, label) values (gen_random_uuid(), ''x'')',
  '42501', null, '已登录身份不能写入 spec_options'
);
select throws_ok(
  'insert into public.product_spec_groups (product_id, group_id) values (gen_random_uuid(), gen_random_uuid())',
  '42501', null, '已登录身份不能写入 product_spec_groups'
);

reset role;

select * from finish();

rollback;
