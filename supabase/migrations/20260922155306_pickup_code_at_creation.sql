-- 下单即发取杯号（Story 4.4；FR-P2-11；AD-6、AD-7、AD-10、AD-13、AD-21、AD-22）
-- 发号时机由「推进到待取餐时」前移到「下单时」：取杯号与订单在同一条 INSERT 内产生，
-- 订单在「制作中」就带着号——客户端始终能凭号询问进度，不存在「有单无号」的中间态（AD-7）。
-- 推进只做状态迁移：transition_order 与 advance_due_orders 不再携带发号参数，
-- 取杯号一经分配不可变（推进与催单都不写它）；「有号」不表示已到点，「能否取餐」只由状态表达。
-- 数据清理：号码列收紧为「必填」的前置条件是既有订单全都带号——旧订单没有号，补号等于伪造历史；
-- 本迁移清空既有订单（明细随外键级联删除；Phase 2 本地与云端都只有测试数据）。
-- 计数器 pickup_code_counters 保留不清：跳号无害、重号才是事故（删计数器会让新号撞上已存在订单的号）。

-- ── 清空既有订单：旧订单没有号，无法在「必填」收紧后继续存在 ─────────────────

delete from public.orders;

-- ── 结构收紧：号与发号日期恒有值（Story 4.4、AD-7）──────────────────────────
-- 「制作中 ⇔ 无号」的旧假设随发号时机消失：号不再是「可取的信号」。
-- 保留格式 check（orders_pickup_code_check）与唯一约束 orders_pickup_code_unique——
-- 唯一约束继续承担「允许跳号、不允许重号」的兜底。
-- orders_check 与 orders_pickup_code_pair 是两张建表迁移里未命名 check 的生成名。

alter table public.orders
  drop constraint orders_check,
  drop constraint orders_pickup_code_pair;

alter table public.orders
  alter column pickup_code set not null,
  alter column pickup_code_date set not null;

comment on column public.orders.pickup_code is
  '取杯号：下单时分配、恒有值（字母前缀 + 四位数字，A-0001–Z-9999，同一前缀用尽后进入下一个字母）；门店 + 门店本地自然日唯一，允许跳号不允许重号（AD-7）；一经分配不可变——推进与催单都不写它（Story 4.4）';
comment on column public.orders.pickup_code_date is
  '取杯号的发号日期（下单时刻的门店本地自然日，来自 stores.timezone，AD-10）：唯一域「门店 + 本列 + 取杯号」的组成部分（AD-7）；与取杯号在同一条 INSERT 写入，之后不再改动';

-- ── 下单函数：取号与建单在同一条 INSERT 内完成（Story 4.4、AD-7）────────────
-- 除取号外与 Story 3.3/3.5 的实现完全一致：校验（含就餐方式空值保护）、金额重算、幂等、
-- 订单号、门店快照、推进时刻都不变。
-- 事务性：取号（计数器递增）是下单事务的一部分——整单失败时号一起回滚；幂等重放不消耗号。

create or replace function public.create_order(
  p_items jsonb,
  p_dining_mode public.dining_mode,
  p_notes text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_key text;
  v_notes text;
  v_store public.stores%rowtype;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_group record;
  v_product record;
  v_product_id_text text;
  v_product_id uuid;
  v_quantity_text text;
  v_quantity integer;
  v_raw_selections jsonb;
  v_group_value jsonb;
  v_option_id uuid;
  v_option_label text;
  v_option_extra numeric;
  v_selections jsonb;
  v_selections_value jsonb;
  v_labels text[];
  v_group_labels text[];
  v_extras numeric[];
  v_group_extras numeric[];
  v_lines jsonb := '[]'::jsonb;
  v_line_amounts numeric[] := '{}';
  v_unit_price numeric;
  v_packaging_fee numeric;
  v_total numeric;
  v_local_date date;
  v_attempt integer;
begin
  -- 归属的唯一来源：会话身份（客户端没有传用户标识的入口）
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception '%', 'not_authenticated'::public.order_error_code;
  end if;

  -- 请求形状：商品清单非空
  if p_items is null
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception '%', 'invalid_request'::public.order_error_code;
  end if;

  -- 请求形状：就餐方式必须有取值（null 过不了枚举校验，必须在函数内拒绝，
  -- 否则会漏成数据库 not-null 报错、错误类别丢失——NFR3；保护来自 dining_mode_guard 迁移）
  if p_dining_mode is null then
    raise exception '%', 'invalid_request'::public.order_error_code;
  end if;

  -- 幂等键必填（AD-11）
  v_key := btrim(coalesce(p_idempotency_key, ''));
  if v_key = '' then
    raise exception '%', 'invalid_request'::public.order_error_code;
  end if;

  -- 备注：未传或为空一律落库为「无备注要求」；上限与前端一致（30 字）
  v_notes := btrim(coalesce(p_notes, ''));
  if length(v_notes) > 30 then
    raise exception '%', 'invalid_request'::public.order_error_code;
  end if;
  if v_notes = '' then
    v_notes := '无备注要求';
  end if;

  -- 幂等重放（AD-11）：同一用户 + 同一幂等键已经下过单，原样返回，不重复写入。
  -- 先于商品校验：商品在重试之前下架，重放也必须拿回原来那张单。
  -- 这里的查询只是快速通道；并发下的正确性由 (user_id, idempotency_key) 唯一约束兜住（见下面的插入）。
  select * into v_existing
  from public.orders
  where user_id = v_user_id
    and idempotency_key = v_key;
  if found then
    return public.order_result_json(
      v_existing,
      (select timezone from public.stores where id = v_existing.store_id)
    );
  end if;

  -- 门店：Phase 2 只有一家；数量不为 1 时拒绝，不"猜"门店（FR-P2-8）
  if (select count(*) from public.stores) <> 1 then
    raise exception '%', 'store_unavailable'::public.order_error_code;
  end if;
  select * into v_store from public.stores;

  -- 逐行校验与计价：单价 = 基础价 + 规格加价；金额只来自库内价格（AD-8）
  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item.value) is distinct from 'object' then
      raise exception '%', 'invalid_request'::public.order_error_code;
    end if;

    v_product_id_text := v_item.value ->> 'product_id';
    if v_product_id_text is null
       or not pg_input_is_valid(v_product_id_text, 'uuid') then
      raise exception '%', 'invalid_request'::public.order_error_code;
    end if;

    -- 数量：Phase 2 不限购，但必须是可用的正整数
    v_quantity_text := v_item.value ->> 'quantity';
    if v_quantity_text is null
       or not pg_input_is_valid(v_quantity_text, 'integer') then
      raise exception '%', 'invalid_quantity'::public.order_error_code;
    end if;
    v_quantity := v_quantity_text::integer;
    if v_quantity <= 0 then
      raise exception '%', 'invalid_quantity'::public.order_error_code;
    end if;

    v_raw_selections := v_item.value -> 'selections';
    if v_raw_selections is null then
      v_raw_selections := '{}'::jsonb;
    elsif jsonb_typeof(v_raw_selections) is distinct from 'object' then
      raise exception '%', 'invalid_request'::public.order_error_code;
    end if;

    -- 商品必须存在且在售（售罄与下架都不可下单）
    v_product_id := v_product_id_text::uuid;
    select p.id, p.name, p.price, p.availability
      into v_product
      from public.products p
     where p.id = v_product_id;
    if not found or v_product.availability <> 'on_sale' then
      raise exception '%', 'product_unavailable'::public.order_error_code;
    end if;

    -- 规格选择（严格校验，AD-22 的形状：单选 = 选项 id，多选 = 选项 id 数组）：
    -- 提交的每个组都必须是该商品挂的组，未提交的组一律拒绝——不能靠漏传一组少加价。
    if exists (
      select 1
        from jsonb_object_keys(v_raw_selections) as k(group_id)
       where not exists (
         select 1
           from public.product_spec_groups psg
          where psg.product_id = v_product_id
            and psg.group_id::text = k.group_id
       )
    ) then
      raise exception '%', 'invalid_selection'::public.order_error_code;
    end if;

    v_selections := '{}'::jsonb;
    v_labels := '{}'::text[];
    v_extras := '{}'::numeric[];

    -- 按商品挂的组顺序遍历（psg.sort_order）：缺组、形状不对、选项不属于该组都在这里拒绝
    for v_group in
      select g.id, g.multi
        from public.product_spec_groups psg
        join public.spec_groups g on g.id = psg.group_id
       where psg.product_id = v_product_id
       order by psg.sort_order, g.id
    loop
      v_group_value := v_raw_selections -> v_group.id::text;

      if v_group.multi then
        if jsonb_typeof(v_group_value) is distinct from 'array' then
          raise exception '%', 'invalid_selection'::public.order_error_code;
        end if;
        -- 有效匹配数 = 元素数 才合法：重复选项、不存在的选项、不属于该组的选项都会被拒
        if (select count(*) from jsonb_array_elements_text(v_group_value)) <>
           (select count(distinct o.id)
              from jsonb_array_elements_text(v_group_value) as tag(option_id)
              join public.spec_options o
                on o.id::text = tag.option_id
               and o.group_id = v_group.id)
        then
          raise exception '%', 'invalid_selection'::public.order_error_code;
        end if;
        -- 快照数组按选项 sort_order 规范化；摘要文案与加价同源
        select coalesce(jsonb_agg(o.id order by o.sort_order, o.id), '[]'::jsonb),
               coalesce(array_agg(o.label order by o.sort_order, o.id), '{}'::text[]),
               coalesce(array_agg(o.price_extra order by o.sort_order, o.id), '{}'::numeric[])
          into v_selections_value, v_group_labels, v_group_extras
          from jsonb_array_elements_text(v_group_value) as tag(option_id)
          join public.spec_options o
            on o.id::text = tag.option_id
           and o.group_id = v_group.id;
        v_selections := v_selections || jsonb_build_object(v_group.id::text, v_selections_value);
        v_labels := v_labels || v_group_labels;
        v_extras := v_extras || v_group_extras;
      else
        if jsonb_typeof(v_group_value) is distinct from 'string' then
          raise exception '%', 'invalid_selection'::public.order_error_code;
        end if;
        select o.id, o.label, o.price_extra
          into v_option_id, v_option_label, v_option_extra
          from public.spec_options o
         where o.group_id = v_group.id
           and o.id::text = v_group_value #>> '{}';
        if not found then
          raise exception '%', 'invalid_selection'::public.order_error_code;
        end if;
        v_selections := v_selections || jsonb_build_object(v_group.id::text, v_option_id);
        v_labels := v_labels || v_option_label;
        v_extras := v_extras || v_option_extra;
      end if;
    end loop;

    -- 行金额与快照：单价与摘要都由服务端生成，客户端只提供选择
    v_unit_price := public.calculate_unit_price(v_product.price, v_extras);
    v_line_amounts := v_line_amounts || public.calculate_line_amount(v_unit_price, v_quantity);
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product_id,
      'product_name', v_product.name,
      'unit_price', v_unit_price,
      'quantity', v_quantity,
      'selections', v_selections,
      'spec_summary', public.build_spec_summary(v_labels)
    );
  end loop;

  -- 包装费与总额：规则在 Story 3.2 的纯函数里，费率来自门店配置（AD-8）
  v_packaging_fee := public.calculate_packaging_fee(p_dining_mode, v_store.takeout_packaging_fee);
  v_total := public.calculate_order_total(v_line_amounts, p_dining_mode, v_store.takeout_packaging_fee);

  -- 发号日期：下单时刻的门店本地自然日（AD-10）。计数器的键与订单行上的日期是同一次计算的结果。
  v_local_date := (now() at time zone v_store.timezone)::date;

  -- 订单与明细在同一事务内写入（NFR2）：任何一步失败整单回滚，不存在「有单无明细」
  for v_attempt in 1..10 loop
    begin
      insert into public.orders (
        order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, notes, idempotency_key,
        pickup_code, pickup_code_date, ready_at
      )
      values (
        -- 订单号：18 位纯数字 = 门店本地时间 YYYYMMDDHHmmss + 4 位随机尾号；冲突时换号重试（FR-P2-9）
        to_char(now() at time zone v_store.timezone, 'YYYYMMDDHH24MISS')
          || lpad((floor(random() * 10000))::integer::text, 4, '0'),
        v_user_id, v_store.id, v_store.name, v_store.address, v_store.phone,
        p_dining_mode, v_packaging_fee, v_total, v_notes, v_key,
        -- 取杯号与订单在同一条 INSERT 内产生（AD-7）：失败重试时自动重新取号（允许跳号，不允许重号）
        public.allocate_pickup_code(v_store.id, v_local_date), v_local_date,
        -- 推进时刻：服务端时钟 + 门店配置的推进时长（AD-6）
        now() + make_interval(secs => v_store.ready_delay_seconds)
      )
      returning * into v_order;
      exit;
    exception when unique_violation then
      -- 唯一约束有三处：并发下同一幂等键已落库（返回它）、订单号撞号或取杯号撞号（换号重试）
      select * into v_existing
      from public.orders
      where user_id = v_user_id and idempotency_key = v_key;
      if found then
        return public.order_result_json(
          v_existing,
          (select timezone from public.stores where id = v_existing.store_id)
        );
      end if;
      if v_attempt = 10 then
        raise;
      end if;
    end;
  end loop;

  insert into public.order_items (
    order_id, product_id, product_name, spec_summary, selections, unit_price, quantity
  )
  select
    v_order.id,
    (line ->> 'product_id')::uuid,
    line ->> 'product_name',
    line ->> 'spec_summary',
    line -> 'selections',
    (line ->> 'unit_price')::numeric(10, 2),
    (line ->> 'quantity')::integer
  from jsonb_array_elements(v_lines) as line;

  return public.order_result_json(v_order, v_store.timezone);
end;
$$;

comment on function public.create_order(jsonb, public.dining_mode, text, text) is
  '下单唯一入口（AD-2）：校验输入、按库内价格重算金额、服务端生成订单号、取杯号与建单在同一条 INSERT 内完成（AD-7）、同一事务写入订单与明细；归属取会话身份（AD-3）；同一 (user_id, 幂等键) 只落一单（AD-11）；就餐方式为 null 归类为 invalid_request（Story 3.5、NFR3）';

-- ── 状态迁移引擎：只写状态，不携带发号参数（AD-6、AD-7）────────────────────
-- 合法迁移只有两条：cooking→pickup、pickup→completed。
-- 写入是「带状态谓词的原子更新」：只有当前状态仍等于 p_from 才生效；
-- 状态已被并发操作改过时更新 0 行、返回空值——调用方按「没推进」处理，不报错、不覆盖。
-- 取杯号与发号日期在下单时已写入，本函数不改写它们：参数里没有、源码里也没有（Story 4.4）。

drop function public.transition_order(uuid, public.order_status, public.order_status, text, date, uuid);

create function public.transition_order(
  p_order_id uuid,
  p_from public.order_status,
  p_to public.order_status,
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
  -- (cooking,pickup) 由 advance_due_orders 调用；(pickup,completed) 由确认取杯调用（Story 4.5）。
  if p_from is null or p_to is null
     or not ((p_from = 'cooking' and p_to = 'pickup')
             or (p_from = 'pickup' and p_to = 'completed')) then
    raise exception '%', 'invalid_transition'::public.order_error_code;
  end if;

  update public.orders
     set status = p_to,
         completed_at = case when p_to = 'completed' then now() else completed_at end
   where id = p_order_id
     and status = p_from
     and (p_user_id is null or user_id = p_user_id)
  returning * into v_order;

  return v_order;
end;
$$;

comment on function public.transition_order(uuid, public.order_status, public.order_status, uuid) is
  '状态迁移的唯一实现（AD-6）：带状态谓词的原子更新；状态不匹配时返回空值、不改变任何数据；非法迁移抛 invalid_transition；不携带发号参数——取杯号与发号日期在下单时已定死，本函数不改写它们（Story 4.4）；p_user_id 供确认取杯的归属校验（Story 4.5），推进调用不传';

revoke execute on function public.transition_order(uuid, public.order_status, public.order_status, uuid) from public, anon, authenticated;

-- ── 推进入口：只改状态，不再发号（AD-6、AD-7）───────────────────────────────
-- p_user_id 为空 = 全部到点订单（周期兜底，Story 4.2）；
-- p_user_id 非空 = 只推进这个用户的到点订单（读时推进，Story 5.1）。
-- 取杯号在下单时已分配（Story 4.4），推进不读也不写它：不再 join 门店表算日期、不再调发号。
-- 幂等：重复执行时已推进的订单不再是 cooking，选中不到 / 更新 0 行，不跳状态、不改号。

create or replace function public.advance_due_orders(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due record;
  v_updated public.orders%rowtype;
  v_advanced integer := 0;
begin
  for v_due in
    select o.id
      from public.orders o
     where o.status = 'cooking'
       and o.ready_at <= now()
       and (p_user_id is null or o.user_id = p_user_id)
     order by o.ready_at, o.id
  loop
    v_updated := public.transition_order(v_due.id, 'cooking', 'pickup');
    if v_updated.id is not null then
      v_advanced := v_advanced + 1;
    end if;
  end loop;
  return v_advanced;
end;
$$;

comment on function public.advance_due_orders(uuid) is
  '推进到点的「制作中」订单：不传用户 = 全部（周期兜底），传用户 = 只推进该用户（读时推进）；返回实际推进条数；只做状态迁移，不发号、不改写取杯号（号在下单时已分配，Story 4.4）；幂等、可重跑（AD-6）';
