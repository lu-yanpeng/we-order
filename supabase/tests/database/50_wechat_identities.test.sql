-- 身份映射边界：唯一约束收敛、客户端完全不可达（Story 2.2；FR-P2-2、AD-21、AD-24）
begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

-- 结构：RLS 启用、不携带任何策略（没有策略的表对客户端完全不可达）
select ok(
  (select relrowsecurity from pg_class where oid = 'public.wechat_identities'::regclass),
  'wechat_identities 已启用 RLS'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'wechat_identities'),
  0,
  'wechat_identities 不携带任何面向客户端的策略'
);

-- 列集合固定：只存 openid、平台用户引用与时间戳（AD-24）
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'wechat_identities'),
  array['created_at', 'last_login_at', 'openid', 'user_id'],
  'wechat_identities 只存 openid、user_id 与两个时间戳'
);

-- 登录失败类别含身份解析失败与会话签发失败（Story 2.2 / 2.3 新增）
select ok(
  'identity_failed' = any (enum_range(null::public.login_error_code)::text[]),
  'login_error_code 含 identity_failed 类别'
);
select ok(
  'session_failed' = any (enum_range(null::public.login_error_code)::text[]),
  'login_error_code 含 session_failed 类别'
);

-- 未认证：完全不可达
set local role anon;

select throws_ok(
  'select * from public.wechat_identities',
  '42501', null, '未认证不能读取身份映射'
);
select throws_ok(
  $$ insert into public.wechat_identities (openid, user_id) values ('x', gen_random_uuid()) $$,
  '42501', null, '未认证不能写入身份映射'
);
select throws_ok(
  'update public.wechat_identities set last_login_at = now()',
  '42501', null, '未认证不能更新身份映射'
);
select throws_ok(
  'delete from public.wechat_identities',
  '42501', null, '未认证不能删除身份映射'
);

-- 已登录身份：同样不可达（内部表不携带任何客户端策略）
set local role authenticated;

select throws_ok(
  'select * from public.wechat_identities',
  '42501', null, '已登录身份不能读取身份映射'
);
select throws_ok(
  $$ insert into public.wechat_identities (openid, user_id) values ('x', gen_random_uuid()) $$,
  '42501', null, '已登录身份不能写入身份映射'
);
select throws_ok(
  'update public.wechat_identities set last_login_at = now()',
  '42501', null, '已登录身份不能更新身份映射'
);
select throws_ok(
  'delete from public.wechat_identities',
  '42501', null, '已登录身份不能删除身份映射'
);

reset role;

-- 唯一约束与引用完整性：先放两个临时平台用户（整个测试在事务内回滚）
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'fixture-1@wechat.local',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'fixture-2@wechat.local',
    now()
  );

select lives_ok(
  $$ insert into public.wechat_identities (openid, user_id) values ('openid-a', '00000000-0000-0000-0000-000000000001') $$,
  '首次映射写入成功'
);
select isnt(
  (select created_at from public.wechat_identities where openid = 'openid-a'),
  null,
  '建立时间有默认值'
);
select isnt(
  (select last_login_at from public.wechat_identities where openid = 'openid-a'),
  null,
  '最近登录时间有默认值'
);
select throws_ok(
  $$ insert into public.wechat_identities (openid, user_id) values ('openid-a', '00000000-0000-0000-0000-000000000002') $$,
  '23505', null, '同一 openid 不能映射到第二个用户'
);
select throws_ok(
  $$ insert into public.wechat_identities (openid, user_id) values ('openid-b', '00000000-0000-0000-0000-000000000001') $$,
  '23505', null, '同一平台用户不能被第二个 openid 复用'
);
select throws_ok(
  $$ insert into public.wechat_identities (openid, user_id) values ('openid-c', '00000000-0000-0000-0000-0000000000ff') $$,
  '23503', null, 'user_id 必须指向存在的平台用户'
);
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.wechat_identities'::regclass and contype = 'f'),
  'c',
  '平台用户被删除时映射级联删除'
);

-- record_wechat_login：并发收敛点，只允许服务端密钥执行
select ok(
  not has_function_privilege('anon', 'public.record_wechat_login(text, uuid)', 'EXECUTE'),
  '未认证不能执行 record_wechat_login'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_wechat_login(text, uuid)', 'EXECUTE'),
  '已登录身份不能执行 record_wechat_login'
);
select ok(
  has_function_privilege('service_role', 'public.record_wechat_login(text, uuid)', 'EXECUTE'),
  '服务端密钥可执行 record_wechat_login'
);

-- find_user_by_email：只读查询，客户端完全不可执行（Story 2.2 身份解析辅助；AD-21）
select ok(
  (select prosecdef from pg_proc where oid = 'public.find_user_by_email(text)'::regprocedure),
  'find_user_by_email 是 security definer'
);
select ok(
  (select 'search_path=""' = any(coalesce(proconfig, '{}')) from pg_proc
    where oid = 'public.find_user_by_email(text)'::regprocedure),
  'find_user_by_email 使用空 search_path'
);
select ok(
  not has_function_privilege('anon', 'public.find_user_by_email(text)', 'EXECUTE'),
  '未认证不能执行 find_user_by_email'
);
select ok(
  not has_function_privilege('authenticated', 'public.find_user_by_email(text)', 'EXECUTE'),
  '已登录身份不能执行 find_user_by_email'
);
select ok(
  has_function_privilege('service_role', 'public.find_user_by_email(text)', 'EXECUTE'),
  '服务端密钥可执行 find_user_by_email'
);
select is(
  public.find_user_by_email('fixture-1@wechat.local'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  '按 email 查到平台用户'
);
select is(
  public.find_user_by_email('FIXTURE-1@WECHAT.LOCAL'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'email 大小写不敏感'
);
select ok(
  public.find_user_by_email('nobody@wechat.local') is null,
  '不存在的 email 返回空值'
);
select is(
  public.record_wechat_login('openid-a', '00000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  '重复登记返回原来的 user_id'
);
select is(
  (select user_id from public.wechat_identities where openid = 'openid-a'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  '传入不同 user_id 不覆盖已建立的映射'
);
select is(
  public.record_wechat_login('openid-d', '00000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-000000000002'::uuid,
  '首次登记建立映射'
);
select throws_ok(
  $$ select public.record_wechat_login('openid-e', '00000000-0000-0000-0000-000000000001') $$,
  '23505', null, '同一平台用户不能被第二个 openid 复用（函数同样拒绝）'
);

select * from finish();

rollback;
