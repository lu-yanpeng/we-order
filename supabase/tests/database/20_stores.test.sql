-- 门店：公开读与不可写（Story 1.3；AD-20、AD-21）
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.stores'::regclass),
  'stores 已启用 RLS'
);

set local role anon;

select lives_ok('select * from public.stores', '未认证可读取 stores');

select throws_ok(
  'insert into public.stores (name, address, phone, timezone) values (''x'', ''y'', ''z'', ''Asia/Shanghai'')',
  '42501', null, '未认证不能写入 stores'
);

set local role authenticated;

select throws_ok(
  'insert into public.stores (name, address, phone, timezone) values (''x'', ''y'', ''z'', ''Asia/Shanghai'')',
  '42501', null, '已登录身份不能写入 stores'
);

reset role;

select * from finish();

rollback;
