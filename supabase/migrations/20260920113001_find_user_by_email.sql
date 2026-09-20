-- 按 email 查平台用户（Story 2.2 身份解析的只读辅助；FR-P2-2、AD-24）。
-- 为什么需要它：createUser 返回 email_exists 时只能知道"用户已存在"，拿不到 user.id；
-- 官方 admin API 没有"按 email 查用户"的方法，唯一能做的是只读查询 auth.users。
-- 不用 admin.generateLink 当反查：它对不存在的 email 会顺手创建未确认用户（实测），
-- 语义里混了写入，容易被后续维护者误用。
-- 只用官方 supabase.rpc 调用；客户端不可达，只有服务端密钥可执行。
-- auth.users 是平台自有 schema，这里只读 id 与 email 两列，依赖由本函数与测试固定在一处。

create function public.find_user_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

comment on function public.find_user_by_email(text) is
  '按 email 查平台用户的只读函数；查不到返回空值，仅服务端密钥可执行（见 migration 注释）';

revoke execute on function public.find_user_by_email(text)
  from public, anon, authenticated;
-- 不授予任何客户端角色：该函数只被边缘函数经服务端密钥调用（AD-21）。
