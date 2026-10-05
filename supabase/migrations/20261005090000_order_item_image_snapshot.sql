-- 订单明细图片快照列与读取形状增量（Story 4.7；FR-P3-7 缺图占位、FR-P3-10 / FR-P3-11 展示增量；AD-9、AD-22）
-- 加法型迁移：order_items 新增 image_path（下单时刻的商品图片路径快照，可空）；
-- create_order 写入快照（历史订单不回填——图片路径为 null 时客户端以色块占位）；
-- get_my_orders 列表项新增 item_images（按明细行顺序，元素 { image_path }，image_path 可空），
--   并退役 item_summary（2026-10-05 范围修订：4.7 卡片图片化后它已无消费方，
--   删除返回字段与生成逻辑，属显式减法型修订——全仓唯一消费者是 4.7 之前的卡片）；
-- get_my_order_detail 明细新增 image_path。
-- 图片展示路径由客户端用目录图片的同一构造（api/catalog.ts 的 productImageUrl）拼出，
-- 本迁移不做图片入仓与上传；商品换图 / 删图不影响历史订单快照（AD-9）。
-- 三个函数均为整段替换：签名、security definer、search_path 与既有实现一致，
-- ACL 由 create or replace 保留，不重发授权（仅为新增列与形状增量，不改权限）。

-- ── 图片快照列：下单时刻拍照存档（AD-9）────────────────────────────────────

alter table public.order_items add column image_path text;

comment on column public.order_items.image_path is
  '下单时刻商品图片路径快照（形状同 products.image_path，可空）：商品换图 / 删图不影响历史订单；为空或对象缺失时客户端以色块占位（Story 4.7）';

-- ── 下单：把商品当时的图片路径写入明细快照（除 image_path 外与既有实现一致）──

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

    -- 商品必须存在且在售（售罄与下架都不可下单）；图片路径只在此时读取一次，随快照落库
    v_product_id := v_product_id_text::uuid;
    select p.id, p.name, p.price, p.availability, p.image_path
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

    -- 行金额与快照：单价与摘要都由服务端生成，客户端只提供选择；
    -- 图片路径是下单时刻的商品快照（Story 4.7），商品之后换图 / 删图都不影响本行。
    v_unit_price := public.calculate_unit_price(v_product.price, v_extras);
    v_line_amounts := v_line_amounts || public.calculate_line_amount(v_unit_price, v_quantity);
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product_id,
      'product_name', v_product.name,
      'unit_price', v_unit_price,
      'quantity', v_quantity,
      'selections', v_selections,
      'spec_summary', public.build_spec_summary(v_labels),
      'image_path', v_product.image_path
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
    order_id, product_id, product_name, spec_summary, selections, unit_price, quantity, image_path
  )
  select
    v_order.id,
    (line ->> 'product_id')::uuid,
    line ->> 'product_name',
    line ->> 'spec_summary',
    line -> 'selections',
    (line ->> 'unit_price')::numeric(10, 2),
    (line ->> 'quantity')::integer,
    line ->> 'image_path'
  from jsonb_array_elements(v_lines) as line;

  return public.order_result_json(v_order, v_store.timezone);
end;
$$;

comment on function public.create_order(jsonb, public.dining_mode, text, text) is
  '下单内核（AD-2、AD-12）：校验输入、按库内价格重算金额、服务端生成订单号、取杯号与建单在同一条 INSERT 内完成（AD-7）、同一事务写入订单与明细（含商品当时的图片路径快照，Story 4.7）；归属取请求上下文身份（AD-3）；客户端无执行权，唯一可达路径是服务端接缝 create_order_for_user；同一 (user_id, 幂等键) 只落一单（AD-11）';

-- ── 列表：条目形状增加图片行（除 item_images 外与既有实现一致）───────────────

create or replace function public.get_my_orders(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_order public.orders%rowtype;
  v_count integer := 0;
  v_last_created_at timestamptz;
  v_last_id uuid;
  v_next_cursor jsonb;
begin
  -- 归属的唯一来源：会话身份（参数里没有用户标识的入口）
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception '%', 'not_authenticated'::public.order_error_code;
  end if;

  -- 分页参数（AD-23）：默认每页 20、上限 50；游标两个参数必须成对出现。
  -- 非法参数明确拒绝（invalid_request），不静默修正——调用方能知道参数不对（NFR3）。
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception '%', 'invalid_request'::public.order_error_code;
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception '%', 'invalid_request'::public.order_error_code;
  end if;

  -- 读时判定：先推进调用者自己到点的订单，再自动完成自己超时的订单（AD-6、Story 4.5）
  perform public.advance_due_orders(v_user_id);
  perform public.complete_due_orders(v_user_id);

  -- 键集分页：从游标之后（更早）继续取，多取 1 条判断还有没有下一页。
  -- 行比较 (created_at, id) < (游标) 与 order by created_at desc, id desc 同向：
  -- 创建时间相同的两张单靠 id 区分先后，翻页边界不重不漏。
  for v_row in
    select
      o,
      st.timezone,
      s.item_images
    from public.orders o
    join public.stores st on st.id = o.store_id
    left join lateral (
      select
        -- 图片行（Story 4.7）：按明细行顺序，每行一个 { image_path }；
        -- 路径来自下单时刻快照，可空（历史订单 / 商品当时无图 → 客户端色块占位）
        jsonb_agg(
          jsonb_build_object('image_path', oi.image_path)
          order by oi.id
        ) as item_images
      from public.order_items oi
     where oi.order_id = o.id
    ) s on true
    where o.user_id = v_user_id
      and (p_before_created_at is null
           or (o.created_at, o.id) < (p_before_created_at, p_before_id))
    order by o.created_at desc, o.id desc
    limit p_limit + 1
  loop
    v_count := v_count + 1;
    exit when v_count > p_limit; -- 第 limit + 1 条只说明「还有下一页」，本身不返回

    v_order := v_row.o;
    v_items := v_items || (
      public.order_result_json(v_order, v_row.timezone)
      || jsonb_build_object('item_images', coalesce(v_row.item_images, '[]'::jsonb))
    );
    v_last_created_at := v_order.created_at;
    v_last_id := v_order.id;
  end loop;

  -- 出现过第 limit + 1 条 → 还有下一页：游标 = 本页最后一条的位置
  if v_count > p_limit then
    v_next_cursor := jsonb_build_object('created_at', v_last_created_at, 'id', v_last_id);
  end if;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next_cursor);
end;
$$;

comment on function public.get_my_orders(integer, timestamptz, uuid) is
  '我的订单列表（FR-P2-14、FR-P3-10）：分页读取本人订单，创建时间倒序；返回信封 { items, next_cursor }（分页信封的唯一来源，AD-22/AD-23）；读取前先推进调用者自己到点/超时的订单（AD-6、Story 4.5）；列表项 = order_result_json + item_images（图片行：按明细行顺序，元素 { image_path }，Story 4.7；item_summary 已于 Story 4.7 退役，不再返回）；未登录抛 not_authenticated，非法分页参数抛 invalid_request';

-- ── 详情：明细形状增加图片快照列（除 image_path 外与既有实现一致）────────────

create or replace function public.get_my_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_row record;
  v_order public.orders%rowtype;
begin
  -- 归属的唯一来源：会话身份（参数里没有用户标识的入口）
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception '%', 'not_authenticated'::public.order_error_code;
  end if;

  if p_order_id is null then
    raise exception '%', 'invalid_request'::public.order_error_code;
  end if;

  -- 读时判定：先推进调用者自己到点的订单，再自动完成自己超时的订单（AD-5、Story 4.5）
  perform public.advance_due_orders(v_user_id);
  perform public.complete_due_orders(v_user_id);

  -- 一条带归属谓词的查询：不是本人的单与不存在的单在这里都查不到，随后抛同一个结果（AD-13）。
  select o, st.timezone
    into v_row
    from public.orders o
    join public.stores st on st.id = o.store_id
   where o.id = p_order_id
     and o.user_id = v_user_id;

  if not found then
    raise exception '%', 'order_not_found'::public.order_error_code;
  end if;

  v_order := v_row.o;

  -- 详情形状 = 订单对外形状（唯一映射）+ 门店快照 + 明细快照（含图片路径快照，Story 4.7）
  return public.order_result_json(v_order, v_row.timezone)
    || jsonb_build_object(
         'store_name', v_order.store_name,
         'store_address', v_order.store_address,
         'store_phone', v_order.store_phone,
         'items', coalesce(
           (
             select jsonb_agg(
                      jsonb_build_object(
                        'product_id', oi.product_id,
                        'product_name', oi.product_name,
                        'spec_summary', oi.spec_summary,
                        'selections', oi.selections,
                        'unit_price', oi.unit_price,
                        'quantity', oi.quantity,
                        'image_path', oi.image_path
                      )
                      order by oi.id
                    )
               from public.order_items oi
              where oi.order_id = v_order.id
           ),
           '[]'::jsonb
         )
       );
end;
$$;

comment on function public.get_my_order_detail(uuid) is
  '我的订单详情（FR-P2-15、FR-P3-11）：订单对外形状来自 order_result_json（与列表同一映射，AD-22）、门店快照三列与商品明细快照数组（AD-9；含图片路径快照 image_path，Story 4.7）；读取前先推进调用者自己到点/超时的订单（AD-5）；非本人与不存在返回同一结果 order_not_found（AD-13）；未登录抛 not_authenticated、空 id 抛 invalid_request';
