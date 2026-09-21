-- 订单结构：orders 与 order_items（Story 3.1；FR-P2-9、FR-P2-18）
-- 写路径封闭：两张表不携带任何面向客户端的写策略，写权限不授予 anon/authenticated（AD-2、AD-21）；
-- 下单只能经由服务端函数，金额由服务端重算（Story 3.3）。
-- 读路径保留本人 SELECT 策略作纵深防御（AD-3、AD-4）：orders 只允许本人读，order_items 跟随所属订单；
-- 客户端读取的正式契约仍是服务端函数（AD-5）。
-- 订单号、取杯号、推进时刻与完成时间由服务端函数写入（Epic 3/4），本迁移只定义结构与不变量。

create type public.order_status as enum ('cooking', 'pickup', 'completed');

create type public.dining_mode as enum ('dinein', 'takeout');

comment on type public.order_status is
  '订单状态：制作中 → 待取餐 → 已完成；status 的写入只存在于推进函数一处（AD-6）';
comment on type public.dining_mode is
  '就餐方式：dinein 堂食 / takeout 外带；外带计入包装费 2.00（AD-8）';

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique check (order_number ~ '^[0-9]{18}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  store_id uuid not null references public.stores (id),
  store_name text not null,
  store_address text not null,
  store_phone text not null,
  status public.order_status not null default 'cooking',
  dining_mode public.dining_mode not null,
  packaging_fee numeric(10, 2) not null check (packaging_fee >= 0),
  total_amount numeric(10, 2) not null check (total_amount >= 0),
  notes text not null default '无备注要求' check (btrim(notes) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  pickup_code text check (pickup_code is null or pickup_code ~ '^[A-Z]-[0-9]{4}$'),
  ready_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check ((status = 'cooking') = (pickup_code is null)),
  check ((status = 'completed') = (completed_at is not null))
);

comment on table public.orders is
  '订单主表：归属只在 user_id（AD-4）；写路径只有服务端函数（AD-2）；读取只用副本字段，不 join 目录表取当前值（AD-9）';
comment on column public.orders.order_number is
  '对外订单号：18 位纯数字（门店本地时间 YYYYMMDDHHmmss + 4 位随机数），服务端生成，全局唯一（唯一约束 + 冲突重试，FR-P2-9）';
comment on column public.orders.user_id is
  '归属唯一表达点：RPC 谓词与 RLS 策略都必须等价于 user_id = auth.uid()（AD-3、AD-4）';
comment on column public.orders.store_id is
  '门店引用：订单通过它与门店关联，但读取门店信息只用快照，不 join stores（FR-P2-8、AD-9）';
comment on column public.orders.store_name is '下单时刻门店名称快照（AD-9）';
comment on column public.orders.store_address is '下单时刻门店地址快照（AD-9）';
comment on column public.orders.store_phone is '下单时刻门店电话快照（AD-9）';
comment on column public.orders.status is
  '订单状态：合法迁移只有 cooking→pickup、pickup→completed（AD-6）';
comment on column public.orders.dining_mode is '就餐方式，决定包装费（AD-8）';
comment on column public.orders.packaging_fee is '外带包装费 2.00、堂食 0；服务端重算（FR-P2-9）';
comment on column public.orders.total_amount is
  '实付总额 = 明细小计之和 + 包装费；服务端重算，精度由 numeric(10,2) 保证（AD-8）';
comment on column public.orders.notes is '备注；未传或为空一律落库为「无备注要求」（FR-P2-9）';
comment on column public.orders.idempotency_key is
  '客户端生成的幂等标识；唯一域 (user_id, idempotency_key)，并发重复提交由该约束收敛（AD-11）';
comment on column public.orders.pickup_code is
  '取杯号：字母前缀 + 四位数字（A-0001–Z-9999，同一前缀用尽后进入下一个字母）；门店 + 门店本地自然日唯一，允许跳号不允许重号（AD-7）；未进入「待取餐」时为空值';
comment on column public.orders.ready_at is
  '推进时刻：到点即由推进机制置为待取餐（AD-6）；催单取原定时刻与「催单时刻 + 提前量」的较早者';
comment on column public.orders.completed_at is
  '确认取杯（pickup→completed）时由服务端记录（FR-P2-13）';
comment on column public.orders.created_at is
  '创建时间：服务端时钟；对外按门店本地时区格式化（FR-P2-9、AD-10）';

create index orders_user_created_idx on public.orders (user_id, created_at desc, id desc);
comment on index public.orders_user_created_idx is
  '我的订单列表：按创建时间倒序的稳定分页（AD-23）';

create index orders_due_idx on public.orders (ready_at) where status = 'cooking';
comment on index public.orders_due_idx is
  '推进扫描：只索引「制作中」的到点判定（AD-6）';

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  product_name text not null,
  spec_summary text not null,
  selections jsonb not null default '{}'::jsonb check (jsonb_typeof(selections) = 'object'),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0)
);

comment on table public.order_items is
  '订单明细：下单时刻快照；不携带归属字段，可见性跟随所属订单（AD-4、AD-9）';
comment on column public.order_items.order_id is '所属订单；明细与订单在同一事务内写入（FR-P2-9）';
comment on column public.order_items.product_id is
  '商品引用：供「再来一单」定位商品，读取展示不依赖它（AD-9）';
comment on column public.order_items.product_name is
  '下单时刻商品名快照：商品改名不影响历史订单（AD-9）';
comment on column public.order_items.spec_summary is
  '服务端依据选项文案生成的规格摘要，不接受客户端提供的摘要文本（FR-P2-9）';
comment on column public.order_items.selections is
  '规格选择结构化副本，形状：规格组 id → 选项 id 或选项 id 数组（数组仅出现在多选组，AD-22）';
comment on column public.order_items.unit_price is
  '下单时刻单价 = 基础价 + 规格加价；展示与计价同源（AD-8）';
comment on column public.order_items.quantity is '数量，必须为正整数（FR-P2-9）';

create index order_items_order_id_idx on public.order_items (order_id);

-- 默认拒绝（AD-21）：启用 RLS、撤销客户端授权，然后只补本人读一条策略。
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;

-- 写权限不授予客户端：不存在「客户端直接插入一行订单或明细」的可用路径（AD-2）。
-- 只授予读，且读范围由策略限定为本人；未认证没有读授权（AD-3、FR-P2-18）。
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;

create policy orders_own_read on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy order_items_own_read on public.order_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_id
        and o.user_id = (select auth.uid())
    )
  );
