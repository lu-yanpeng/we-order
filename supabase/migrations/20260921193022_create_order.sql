-- 下单服务端函数（Story 3.3；FR-P2-9、FR-P2-10、NFR2；AD-1、AD-2、AD-3、AD-8、AD-9、AD-10、AD-11、AD-12、AD-22）
-- 唯一写路径：orders / order_items 对客户端不可写，下单只能经本函数（AD-2）。
-- 归属取自会话身份（AD-3）；金额由库内价格经 Story 3.2 的纯函数重算（AD-8）；
-- 订单号、门店快照、创建时间与推进时刻都由服务端写入（AD-9、AD-10）。
-- 客户端提交内容只有：商品引用、规格选择、数量、就餐方式、备注、幂等键——
-- 没有金额、用户、订单号、门店的入口，而不是"传了再被忽略"。
-- 配置（外带包装费、推进时长、催单提前量）来自门店行，不写死在本函数里（AD-6、AD-17）。

-- ── 门店运营参数：配置的唯一来源（Story 3.3 / 4.1 / 4.3） ────────────────────

alter table public.stores
  add column takeout_packaging_fee numeric(10, 2) not null default 2.00
    check (takeout_packaging_fee >= 0),
  add column ready_delay_seconds integer not null default 15
    check (ready_delay_seconds > 0),
  add column urge_lead_seconds integer not null default 3
    check (urge_lead_seconds >= 0);

comment on column public.stores.takeout_packaging_fee is
  '外带包装费（按单收；堂食恒为 0 是规则、费率是数值）：下单函数读它（AD-8、Story 3.3），Phase 4 由商家后台配置';
comment on column public.stores.ready_delay_seconds is
  '推进时长（秒）：下单函数用它算 ready_at（Story 3.3）、推进判断用它判定到点（Story 4.1），同一处配置（AD-6）；演示参数，Phase 4 改为商家出餐后随机制替换';
comment on column public.stores.urge_lead_seconds is
  '催单提前量（秒）：ready_at 取「原定时刻」与「催单时刻 + 本值」的较早者（Story 4.3）；演示参数，Phase 4 随出餐机制替换';

-- ── 错误类别：取值集合只有这一处来源（AD-12、NFR3） ─────────────────────────
-- 下单失败以异常抛出，异常 message 就是类别值，随平台标准错误载荷返回（AD-22）。
-- Epic 4/5 的催单、确认取杯、订单读取用 alter type 往同一个枚举追加取值，不另起一套。

create type public.order_error_code as enum (
  'invalid_request',
  'invalid_quantity',
  'invalid_selection',
  'product_unavailable',
  'not_authenticated',
  'store_unavailable'
);

comment on type public.order_error_code is
  '下单与订单操作的失败类别；类别是稳定契约、文案不是（AD-12）';

-- ── 下单结果的对外形状：只有这一处定义（AD-22） ─────────────────────────────
-- 字段名沿用库中列名，金额是定点 JSON 数字，时间为门店本地时区的文本（AD-10）。
-- 明细与门店快照属 Epic 5 的订单读取形状，届时在此加法补充。

create function public.order_result_json(
  p_order public.orders,
  p_timezone text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'order_number', p_order.order_number,
    'status', p_order.status,
    'dining_mode', p_order.dining_mode,
    'packaging_fee', p_order.packaging_fee,
    'total_amount', p_order.total_amount,
    'notes', p_order.notes,
    'pickup_code', p_order.pickup_code,
    'created_at', to_char(p_order.created_at at time zone p_timezone, 'YYYY-MM-DD HH24:MI:SS')
  );
$$;

comment on function public.order_result_json(public.orders, text) is
  '下单结果的对外形状：字段名沿用列名、金额为定点 JSON 数字、时间按门店时区格式化（AD-10、AD-22）';

-- ── 下单函数：唯一写路径（AD-2） ────────────────────────────────────────────

create function public.create_order(
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

  -- 订单与明细在同一事务内写入（NFR2）：任何一步失败整单回滚，不存在「有单无明细」
  for v_attempt in 1..10 loop
    begin
      insert into public.orders (
        order_number, user_id, store_id, store_name, store_address, store_phone,
        dining_mode, packaging_fee, total_amount, notes, idempotency_key, ready_at
      )
      values (
        -- 订单号：18 位纯数字 = 门店本地时间 YYYYMMDDHHmmss + 4 位随机尾号；冲突时换号重试（FR-P2-9）
        to_char(now() at time zone v_store.timezone, 'YYYYMMDDHH24MISS')
          || lpad((floor(random() * 10000))::integer::text, 4, '0'),
        v_user_id, v_store.id, v_store.name, v_store.address, v_store.phone,
        p_dining_mode, v_packaging_fee, v_total, v_notes, v_key,
        -- 推进时刻：服务端时钟 + 门店配置的推进时长（AD-6）
        now() + make_interval(secs => v_store.ready_delay_seconds)
      )
      returning * into v_order;
      exit;
    exception when unique_violation then
      -- 唯一约束只有两处：并发下同一幂等键已落库（返回它），或订单号撞号（换号重试）
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
  '下单唯一入口（AD-2）：校验输入、按库内价格重算金额、服务端生成订单号并在同一事务写入订单与明细；归属取会话身份（AD-3）；同一 (user_id, 幂等键) 只落一单（AD-11）';

-- 权限：只允许已登录身份执行；结果映射是内部实现，客户端不可执行（AD-5、AD-21）
revoke execute on function public.order_result_json(public.orders, text) from public, anon, authenticated;
revoke execute on function public.create_order(jsonb, public.dining_mode, text, text) from public, anon;
grant execute on function public.create_order(jsonb, public.dining_mode, text, text) to authenticated;
