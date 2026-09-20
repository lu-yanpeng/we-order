-- 身份映射：openid ↔ 平台用户（Story 2.2；FR-P2-2、AD-24）。
-- 内部表：客户端完全不可达（AD-21）——启用 RLS、撤销客户端授权、不建任何策略。
-- 除 openid 与时间戳外不存任何个人信息；用户即平台用户，不另建用户表。
-- 平台用户的创建与查找（createUser / generateLink）只在边缘函数 wechat-login，
-- 经服务端密钥触达，不向客户端暴露任何写路径。

-- 登录失败类别新增「身份解析失败」：与微信侧换取失败分开，错误可区分（NFR3）。
alter type public.login_error_code add value if not exists 'identity_failed';

create table public.wechat_identities (
  openid text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

comment on table public.wechat_identities is
  '身份映射：openid ↔ 平台用户；仅服务端可达，不存 openid 与时间戳以外的信息（AD-24）';
comment on column public.wechat_identities.openid is
  '微信 openid；主键唯一约束是并发首登的收敛点（FR-P2-2）';
comment on column public.wechat_identities.user_id is
  '平台用户（auth.users）；唯一约束保证同一平台用户不被第二个 openid 复用';
comment on column public.wechat_identities.last_login_at is
  '最近一次成功登录时间；首次建立时与 created_at 相同';

alter table public.wechat_identities enable row level security;

revoke all on public.wechat_identities from anon, authenticated;
-- 不建任何策略：没有策略的表对客户端完全不可达（AD-21）。

-- 记录一次微信登录：openid → user_id 的映射只建立一次。
-- 重复调用（重复登录、失败重试、并发）只刷新 last_login_at，不新增行；
-- 传入不同的 user_id 也不会覆盖已建立的映射，返回原来的 user_id——
-- 并发首登由 openid 主键在这里收敛，不需要调用方先查后插。
create function public.record_wechat_login(p_openid text, p_user_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.wechat_identities (openid, user_id)
  values (p_openid, p_user_id)
  on conflict (openid) do update
    set last_login_at = now()
  returning user_id;
$$;

comment on function public.record_wechat_login(text, uuid) is
  '登记或复用 openid 映射；并发与重试只留一行，返回最终生效的 user_id（Story 2.2）';

-- 只允许服务端密钥调用；客户端（anon / authenticated）不可执行。
revoke execute on function public.record_wechat_login(text, uuid) from public, anon, authenticated;
