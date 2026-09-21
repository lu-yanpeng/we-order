-- 金额重算的纯计算函数（Story 3.2；FR-P2-9、AD-1、AD-8）
-- 无表访问：不查任何表、不读时钟、不依赖会话，同输入必同输出，可单独断言（AD-1）。
-- 价格只来自商品基础价与规格选项加价两处定义（AD-8）；本批函数只做算术——
-- 商品是否存在、选项是否属于该商品、数量是否为正等校验是下单函数（Story 3.3）的职责。
-- 金额一律 numeric(10,2)（十进制定点）：精度由类型保证，不依赖任何客户端计算库。
-- 包装费：规则在此（外带收、堂食免），费率是入参——数值来自配置，配置来源见 Story 3.3。
-- 权限：内部计算器，客户端不可执行（与 record_wechat_login 同）；下单函数以所有者身份调用。

create function public.calculate_unit_price(p_base_price numeric, p_price_extras numeric[])
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (p_base_price + coalesce((select sum(t.extra) from unnest(p_price_extras) as t(extra)), 0))::numeric(10, 2);
$$;

comment on function public.calculate_unit_price(numeric, numeric[]) is
  '单价 = 基础价 + 规格加价总和；加价为空时即基础价；无表访问的纯函数（AD-8、Story 3.2）';

create function public.calculate_line_amount(p_unit_price numeric, p_quantity integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (p_unit_price * p_quantity)::numeric(10, 2);
$$;

comment on function public.calculate_line_amount(numeric, integer) is
  '行小计 = 单价 × 数量；数量为正由下单函数保证（Story 3.3），本函数只做算术';

create function public.calculate_packaging_fee(p_dining_mode public.dining_mode, p_takeout_fee numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (case when p_dining_mode = 'takeout' then p_takeout_fee else 0 end)::numeric(10, 2);
$$;

comment on function public.calculate_packaging_fee(public.dining_mode, numeric) is
  '包装费 = 外带取传入费率、堂食为 0；规则在此、数值来自配置（Story 3.3），费率不写死';

create function public.calculate_order_total(
  p_line_amounts numeric[],
  p_dining_mode public.dining_mode,
  p_takeout_fee numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (coalesce((select sum(t.amount) from unnest(p_line_amounts) as t(amount)), 0)
          + public.calculate_packaging_fee(p_dining_mode, p_takeout_fee))::numeric(10, 2);
$$;

comment on function public.calculate_order_total(numeric[], public.dining_mode, numeric) is
  '总额 = 各行小计之和 + 包装费（费率来自配置，Story 3.3）；无表访问的纯函数（FR-P2-9）';

create function public.build_spec_summary(p_labels text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select string_agg(t.label, ' / ' order by t.ord)
    from unnest(p_labels) with ordinality as t(label, ord)
    where btrim(t.label) <> ''
  ), '');
$$;

comment on function public.build_spec_summary(text[]) is
  '规格摘要 = 选项文案按传入顺序用 " / " 连接，空白与空值项忽略；顺序由调用方保证（Story 3.3），摘要文本不接受客户端提供（FR-P2-9）';

-- 内部计算器：撤销客户端执行权，只由服务端函数（Story 3.3 的下单函数）与数据库所有者调用。
revoke execute on function public.calculate_unit_price(numeric, numeric[]) from public, anon, authenticated;
revoke execute on function public.calculate_line_amount(numeric, integer) from public, anon, authenticated;
revoke execute on function public.calculate_packaging_fee(public.dining_mode, numeric) from public, anon, authenticated;
revoke execute on function public.calculate_order_total(numeric[], public.dining_mode, numeric) from public, anon, authenticated;
revoke execute on function public.build_spec_summary(text[]) from public, anon, authenticated;
