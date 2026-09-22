-- 推进机制与取杯号分配（Story 4.1；FR-P2-11；AD-6、AD-7、AD-10、AD-13、AD-21）
-- 机制与触发策略分离（AD-6）：
--   * transition_order 是全库唯一写 orders.status 的地方——合法迁移只有 cooking→pickup 与
--     pickup→completed 两条，实现是「带状态谓词的原子更新」，不先读后写；
--   * advance_due_orders 只负责「挑出到点的订单」——读时推进只挑调用者自己的，周期兜底挑全部，
--     两者调用同一个实现；本函数不向客户端暴露（AD-21）。
-- 取杯号唯一域 = 门店 + 门店本地自然日（AD-7）：号码文本不含日期，因此把「发号当天的本地日期」
-- 落成一列 pickup_code_date，唯一约束才有对象；跨日重复合法，同日同店重号写不进去。
-- 计数器的键与行上的日期是同一次计算的结果（advance_due_orders 算一次、两处共用），
-- 且取号与状态迁移在同一条 UPDATE 内完成——不存在「待取餐却没有号/日期」的中间态。

-- ── 订单：取杯号的发号日期（唯一约束的组成部分）──────────────────────────────

alter table public.orders
  add column pickup_code_date date;

comment on column public.orders.pickup_code_date is
  '取杯号的发号日期（门店本地自然日）：唯一域「门店 + 本列 + 取杯号」的组成部分（AD-7）；与取杯号在同一条 UPDATE 写入，未进入「待取餐」时为空值';

alter table public.orders
  add constraint orders_pickup_code_pair
    check ((pickup_code is null) = (pickup_code_date is null)),
  add constraint orders_pickup_code_unique
    unique (store_id, pickup_code_date, pickup_code);

comment on constraint orders_pickup_code_pair on public.orders is
  '取杯号与发号日期成对出现：未进入「待取餐」时都是空值，进入后都有值（AD-7）';
comment on constraint orders_pickup_code_unique on public.orders is
  '取杯号在「门店 + 门店本地自然日」内唯一、跨日允许重复（AD-7）：允许跳号、不允许重号';

-- ── 取杯号计数器：发号序号的唯一来源（AD-7）──────────────────────────────────

create table public.pickup_code_counters (
  store_id uuid not null references public.stores (id) on delete cascade,
  local_date date not null,
  counter integer not null check (counter between 1 and 259974),
  primary key (store_id, local_date)
);

comment on table public.pickup_code_counters is
  '取杯号计数器（内部表）：唯一域「门店 + 门店本地自然日」的发号序号来源；零策略、客户端不可达（AD-21）';
comment on column public.pickup_code_counters.local_date is
  '门店本地自然日（stores.timezone 是唯一时区来源，AD-10）；日期滚动后从 A-0001 重新开始';
comment on column public.pickup_code_counters.counter is
  '当日已发出的序号数：1 → A-0001，9999 → A-9999，10000 → B-0001，259974 → Z-9999（26 × 9999）';

alter table public.pickup_code_counters enable row level security;

revoke all on public.pickup_code_counters from anon, authenticated;
-- 不建任何策略：内部表对客户端完全不可达（AD-21）。

-- ── 错误类别：非法状态迁移（NFR3、AD-12）────────────────────────────────────

alter type public.order_error_code add value if not exists 'invalid_transition';

comment on type public.order_error_code is
  '下单与订单操作的失败类别；类别是稳定契约、文案不是（AD-12）；invalid_transition = 不存在的状态迁移';

-- ── 纯映射：序号 → 取杯号文本（AD-7）─────────────────────────────────────────
-- 无表访问、同输入必同输出（AD-1），可单独断言。
-- 1 → A-0001 ... 9999 → A-9999；同一字母用尽后进入下一个字母（A-9999 → B-0001）；
-- 26 × 9999 = 259974 → Z-9999，再往后是超容量（演示场景不可达，直接报错）。

create function public.pickup_code_from_counter(p_counter integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_letter text;
  v_number integer;
begin
  if p_counter is null or p_counter < 1 or p_counter > 26 * 9999 then
    raise exception '取杯号序号超出当日容量（1..259974）：%', p_counter;
  end if;
  v_letter := chr(64 + (p_counter - 1) / 9999 + 1);
  v_number := (p_counter - 1) % 9999 + 1;
  return v_letter || '-' || lpad(v_number::text, 4, '0');
end;
$$;

comment on function public.pickup_code_from_counter(integer) is
  '序号 → 取杯号文本的纯映射：1→A-0001、9999→A-9999、10000→B-0001、259974→Z-9999；越界报错（AD-7）';

-- ── 发号：计数器原子递增（AD-7）──────────────────────────────────────────────
-- 一次「插入或递增并返回」：并发对同一 (门店, 日期) 的更新由数据库排队，
-- 每个调用拿到不同的序号——不是「查最大值加一」（那样并发会读到同一个值）。
-- 日期由调用方传入（advance_due_orders 用门店时区算一次），保证计数器键与行上的日期一致。

create function public.allocate_pickup_code(p_store_id uuid, p_local_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counter integer;
begin
  insert into public.pickup_code_counters (store_id, local_date, counter)
  values (p_store_id, p_local_date, 1)
  on conflict (store_id, local_date) do update
    set counter = public.pickup_code_counters.counter + 1
  returning counter into v_counter;

  return public.pickup_code_from_counter(v_counter);
end;
$$;

comment on function public.allocate_pickup_code(uuid, date) is
  '取杯号发号：计数器以「冲突即递增并返回」的方式分配序号，允许跳号、不允许重号（AD-7）';

-- ── 状态迁移引擎：全库唯一写 orders.status 的地方（AD-6）────────────────────
-- 合法迁移只有两条：cooking→pickup、pickup→completed。
-- 写入是「带状态谓词的原子更新」：只有当前状态仍等于 p_from 才生效；
-- 状态已被并发操作改过时更新 0 行、返回空值——调用方按「没推进」处理，不报错、不覆盖。
-- cooking→pickup 必须在同一条 UPDATE 里带上号与日期（表上的成对约束兜底）。

create function public.transition_order(
  p_order_id uuid,
  p_from public.order_status,
  p_to public.order_status,
  p_pickup_code text default null,
  p_pickup_code_date date default null,
  p_user_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  -- 两条合法迁移之外的组合是调用方的编程错误（不是并发竞争），直接拒绝。
  -- (cooking,pickup) 由 advance_due_orders 调用；(pickup,completed) 由 Story 4.4 的确认取杯调用。
  if p_from is null or p_to is null
     or not ((p_from = 'cooking' and p_to = 'pickup')
             or (p_from = 'pickup' and p_to = 'completed')) then
    raise exception '%', 'invalid_transition'::public.order_error_code;
  end if;

  update public.orders
     set status = p_to,
         pickup_code = coalesce(p_pickup_code, pickup_code),
         pickup_code_date = coalesce(p_pickup_code_date, pickup_code_date),
         completed_at = case when p_to = 'completed' then now() else completed_at end
   where id = p_order_id
     and status = p_from
     and (p_user_id is null or user_id = p_user_id)
  returning * into v_order;

  return v_order;
end;
$$;

comment on function public.transition_order(uuid, public.order_status, public.order_status, text, date, uuid) is
  '状态迁移的唯一实现（AD-6）：带状态谓词的原子更新；状态不匹配时返回空值、不改变任何数据；非法迁移抛 invalid_transition；p_user_id 供 Story 4.4 的归属校验，推进调用不传（推进不绑定归属）';

-- ── 推进入口：挑出到点的订单，逐单发号并迁移（AD-6）─────────────────────────
-- p_user_id 为空 = 全部到点订单（周期兜底，Story 4.2）；
-- p_user_id 非空 = 只推进这个用户的到点订单（读时推进，Story 5.1）。
-- 两者共用同一个实现；函数不绑定归属，也不向客户端暴露（AD-6、AD-21）。
-- 幂等：重复执行时已推进的订单不再是 cooking，选中不到 / 更新 0 行，不产生第二个号、不跳状态。
-- 时间判定只看 ready_at（下单时由 stores.ready_delay_seconds 写入，Story 3.3），这里没有写死的时长。

create function public.advance_due_orders(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due record;
  v_local_date date;
  v_code text;
  v_updated public.orders%rowtype;
  v_advanced integer := 0;
begin
  for v_due in
    select o.id, o.store_id, s.timezone
      from public.orders o
      join public.stores s on s.id = o.store_id
     where o.status = 'cooking'
       and o.ready_at <= now()
       and (p_user_id is null or o.user_id = p_user_id)
     order by o.ready_at, o.id
  loop
    -- 发号日期在发号时刻按门店时区算一次：计数器的键与写入行上的日期是同一次计算的结果（AD-10）
    v_local_date := (now() at time zone v_due.timezone)::date;
    v_code := public.allocate_pickup_code(v_due.store_id, v_local_date);
    v_updated := public.transition_order(v_due.id, 'cooking', 'pickup', v_code, v_local_date);
    if v_updated.id is not null then
      v_advanced := v_advanced + 1;
    end if;
  end loop;
  return v_advanced;
end;
$$;

comment on function public.advance_due_orders(uuid) is
  '推进到点的「制作中」订单：不传用户 = 全部（周期兜底），传用户 = 只推进该用户（读时推进）；返回实际推进条数；幂等、可重跑（AD-6）';

-- ── 权限：内部机制不向客户端暴露（AD-6、AD-21）──────────────────────────────
-- 测试与周期任务以数据库所有者身份调用；客户端角色（anon / authenticated）不可执行。

revoke execute on function public.pickup_code_from_counter(integer) from public, anon, authenticated;
revoke execute on function public.allocate_pickup_code(uuid, date) from public, anon, authenticated;
revoke execute on function public.transition_order(uuid, public.order_status, public.order_status, text, date, uuid) from public, anon, authenticated;
revoke execute on function public.advance_due_orders(uuid) from public, anon, authenticated;
