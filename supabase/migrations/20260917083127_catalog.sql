-- 目录结构：分类、商品、规格组、规格选项与商品↔规格组关联（Story 1.2）
-- 全部表默认拒绝：启用 RLS 并撤销客户端授权，只开公开读策略（AD-20、AD-21）。
-- 写入路径留给 Phase 4，本阶段不存在任何客户端写策略。

create type public.product_availability as enum ('on_sale', 'sold_out', 'delisted');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  name text not null,
  description text not null default '',
  price numeric(10, 2) not null check (price >= 0),
  tags text[] not null default '{}',
  sales integer not null default 0 check (sales >= 0),
  availability public.product_availability not null default 'on_sale',
  image_path text,
  sort_order integer not null default 0
);

create index products_category_id_idx on public.products (category_id);

create table public.spec_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  multi boolean not null default false
);

create table public.spec_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.spec_groups (id) on delete cascade,
  label text not null,
  price_extra numeric(10, 2) not null default 0 check (price_extra >= 0),
  sort_order integer not null default 0
);

create index spec_options_group_id_idx on public.spec_options (group_id);

create table public.product_spec_groups (
  product_id uuid not null references public.products (id) on delete cascade,
  group_id uuid not null references public.spec_groups (id),
  sort_order integer not null default 0,
  primary key (product_id, group_id)
);

comment on column public.products.sales is '月销量展示值：种子维护的静态值，不随订单聚合（FR-P2-6）';
comment on column public.products.image_path is '存储中的对象路径（非完整 URL）；桶与对象见 Story 1.4';

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.spec_groups enable row level security;
alter table public.spec_options enable row level security;
alter table public.product_spec_groups enable row level security;

revoke all on public.categories from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.spec_groups from anon, authenticated;
revoke all on public.spec_options from anon, authenticated;
revoke all on public.product_spec_groups from anon, authenticated;

grant select on public.categories to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.spec_groups to anon, authenticated;
grant select on public.spec_options to anon, authenticated;
grant select on public.product_spec_groups to anon, authenticated;

create policy categories_public_read on public.categories
  for select to anon, authenticated using (true);

create policy products_public_read on public.products
  for select to anon, authenticated using (true);

create policy spec_groups_public_read on public.spec_groups
  for select to anon, authenticated using (true);

create policy spec_options_public_read on public.spec_options
  for select to anon, authenticated using (true);

create policy product_spec_groups_public_read on public.product_spec_groups
  for select to anon, authenticated using (true);
