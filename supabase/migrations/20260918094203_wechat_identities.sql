-- 微信身份映射：openid ↔ 平台用户（Story 2.2；FR-P2-2、AR-18、AD-21、AD-24）。
-- 内部表：只存 openid 与时间戳，不携带任何面向客户端的策略；两个 RPC 是它唯一的读写入口。
-- 并发首登由本表的两个唯一约束收敛，不靠调用方先查后插：
--   openid 主键      —— 同一微信身份只会有一行
--   user_id 唯一     —— 同一平台用户只能被一个 openid 占用（映射不可被另一个 openid 复用）

create table public.wechat_identities (
  openid text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

comment on table public.wechat_identities is
  'openid ↔ 平台用户映射；内部表，无客户端策略（AR-18、AD-24）';
comment on column public.wechat_identities.last_login_at is
  '每次登录（包括复用既有映射）由 resolve/claim 推进；不使用平台自带的最近登录时间';

alter table public.wechat_identities enable row level security;

revoke all on public.wechat_identities from anon, authenticated;

-- 读：有映射则推进最近登录时间并返回 user_id；没有映射返回空值，调用方据此走首次登录。
create function public.resolve_wechat_identity(p_openid text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  update public.wechat_identities
     set last_login_at = now()
   where openid = p_openid
  returning user_id;
$$;

-- 写：首次登录落映射；并发时由 openid 主键收敛，返回既有的 user_id（不覆盖既有归属）。
create function public.claim_wechat_identity(p_openid text, p_user_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.wechat_identities (openid, user_id)
  values (p_openid, p_user_id)
  on conflict (openid) do update set last_login_at = now()
  returning user_id;
$$;

revoke all on function public.resolve_wechat_identity(text) from public, anon, authenticated;
revoke all on function public.claim_wechat_identity(text, uuid) from public, anon, authenticated;

grant execute on function public.resolve_wechat_identity(text) to service_role;
grant execute on function public.claim_wechat_identity(text, uuid) to service_role;
