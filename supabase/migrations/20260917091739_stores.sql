-- 门店：名称、地址、电话与全库唯一时区来源（Story 1.3；AD-10、AD-20）
-- 默认拒绝：启用 RLS 并撤销客户端授权，只开公开读策略。
-- 不提供门店列表、切换与定位。门店表只是方便后台修改门店数据，避免在前端写死，不好修改。

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  phone text not null,
  timezone text not null
);

comment on column public.stores.timezone is 'IANA 时区名：对外时间格式化与取杯号自然日切分的唯一来源（AD-10）';

alter table public.stores enable row level security;

revoke all on public.stores from anon, authenticated;
grant select on public.stores to anon, authenticated;

create policy stores_public_read on public.stores
  for select to anon, authenticated using (true);
