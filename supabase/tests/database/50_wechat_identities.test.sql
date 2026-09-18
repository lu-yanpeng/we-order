-- 微信身份映射：内部表零客户端授权 + 并发首登由唯一约束收敛（Story 2.2；FR-P2-2、AR-18、AD-21、AD-24）
begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

-- 结构：只存 openid 与时间戳，不存任何个人信息
select columns_are(
  'public', 'wechat_identities', array['openid', 'user_id', 'created_at', 'last_login_at'],
  'wechat_identities 只有约定的四列'
);
select col_is_pk('public', 'wechat_identities', 'openid', 'openid 是主键');
select col_is_unique('public', 'wechat_identities', 'user_id', 'user_id 唯一：映射不可被另一个 openid 复用');
select fk_ok(
  'public', 'wechat_identities', 'user_id', 'auth', 'users', 'id',
  'user_id 外键指向平台用户'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.wechat_identities'::regclass),
  'wechat_identities 已启用 RLS'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'wechat_identities'),
  0,
  '内部表不携带任何面向客户端的策略'
);

-- 未认证：完全不可达
set local role anon;

select throws_ok('select * from public.wechat_identities', '42501', null, '未认证不能读取身份映射');
select throws_ok(
  $$ insert into public.wechat_identities (openid, user_id) values ('o-x', gen_random_uuid()) $$,
  '42501', null, '未认证不能写入身份映射'
);

-- 已登录身份：同样完全不可达
set local role authenticated;

select throws_ok('select * from public.wechat_identities', '42501', null, '已登录身份不能读取身份映射');
select throws_ok(
  $$ insert into public.wechat_identities (openid, user_id) values ('o-x', gen_random_uuid()) $$,
  '42501', null, '已登录身份不能写入身份映射'
);
select throws_ok(
  $$ update public.wechat_identities set openid = 'o-y' $$,
  '42501', null, '已登录身份不能更新身份映射'
);
select throws_ok('delete from public.wechat_identities', '42501', null, '已登录身份不能删除身份映射');

reset role;

-- 两个 RPC 只对服务端密钥开放
select ok(
  not has_function_privilege('anon', 'public.resolve_wechat_identity(text)', 'execute'),
  'anon 不能调用 resolve_wechat_identity'
);
select ok(
  not has_function_privilege('anon', 'public.claim_wechat_identity(text, uuid)', 'execute'),
  'anon 不能调用 claim_wechat_identity'
);
select ok(
  not has_function_privilege('authenticated', 'public.resolve_wechat_identity(text)', 'execute'),
  '已登录身份不能调用 resolve_wechat_identity'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_wechat_identity(text, uuid)', 'execute'),
  '已登录身份不能调用 claim_wechat_identity'
);
select ok(
  has_function_privilege('service_role', 'public.resolve_wechat_identity(text)', 'execute'),
  'service_role 可以调用 resolve_wechat_identity'
);
select ok(
  has_function_privilege('service_role', 'public.claim_wechat_identity(text, uuid)', 'execute'),
  'service_role 可以调用 claim_wechat_identity'
);

-- 行为：直接造两个平台用户（事务结束回滚）
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pgtap-a@wechat.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pgtap-b@wechat.local');

select is(
  public.resolve_wechat_identity('o-pgtap'),
  null,
  '没有映射时 resolve 返回空值（调用方据此走首次登录）'
);
select is(
  public.claim_wechat_identity('o-pgtap', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '首次 claim 落映射并返回该用户'
);
select is(
  public.claim_wechat_identity('o-pgtap', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '并发/重复 claim 返回既有用户，不覆盖归属'
);
select is(
  (select count(*)::int from public.wechat_identities where openid = 'o-pgtap'),
  1,
  '同一 openid 最终只有一行映射'
);
select is(
  public.resolve_wechat_identity('o-pgtap'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'resolve 返回既有映射'
);

-- 最近登录时间：两个入口都会推进
update public.wechat_identities
   set last_login_at = now() - interval '1 day'
 where openid = 'o-pgtap';
select public.claim_wechat_identity('o-pgtap', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select ok(
  (select last_login_at > now() - interval '1 minute' from public.wechat_identities where openid = 'o-pgtap'),
  'claim 推进最近登录时间'
);

update public.wechat_identities
   set last_login_at = now() - interval '1 day'
 where openid = 'o-pgtap';
select public.resolve_wechat_identity('o-pgtap');
select ok(
  (select last_login_at > now() - interval '1 minute' from public.wechat_identities where openid = 'o-pgtap'),
  'resolve 推进最近登录时间'
);

-- 约束：映射不可复用、不可重复、不可指向不存在的用户
select throws_ok(
  $$ select public.claim_wechat_identity('o-other', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '23505', null, '同一个平台用户不能被另一个 openid 占用'
);
select throws_ok(
  $$ insert into public.wechat_identities (openid, user_id) values ('o-pgtap', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  '23505', null, '同一个 openid 不能落两行映射'
);
select throws_ok(
  $$ select public.claim_wechat_identity('o-ghost', '99999999-9999-4999-8999-999999999999') $$,
  '23503', null, '映射必须指向真实存在的平台用户'
);

select * from finish();

rollback;
