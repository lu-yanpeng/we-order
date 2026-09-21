-- 金额重算的纯计算函数（Story 3.2；FR-P2-9、AD-1、AD-8）
-- 四类断言：规则、纯函数性（immutable 与无表访问）、客户端权限、输出精度。
-- 纯函数不需要任何表数据；「无表访问」用「无表权限角色调用成功」作行为证明，结束回滚，可重复运行。
begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

-- ── 规则：单价 = 基础价 + 规格加价总和（AD-8） ─────────────────────────────

select is(
  public.calculate_unit_price(30.00, array[3.00, 0.00]::numeric[]),
  33.00::numeric,
  'calculate_unit_price：单价 = 基础价 + 规格加价总和'
);
select is(
  public.calculate_unit_price(30.00, array[]::numeric[]),
  30.00::numeric,
  'calculate_unit_price：加价为空时单价等于基础价'
);
select is(
  public.calculate_unit_price(12.50, array[0.00, 0.00]::numeric[]),
  12.50::numeric,
  'calculate_unit_price：零加价不改变单价'
);
select is(
  public.calculate_unit_price(0.00, array[6.00]::numeric[]),
  6.00::numeric,
  'calculate_unit_price：基础价为零时单价等于加价'
);
select is(
  public.calculate_unit_price(30.00, array[3.50]::numeric[])::text,
  '33.50',
  'calculate_unit_price：输出保留两位小数'
);

-- ── 规则：行小计 = 单价 × 数量 ─────────────────────────────────────────────

select is(
  public.calculate_line_amount(33.00, 3),
  99.00::numeric,
  'calculate_line_amount：行小计 = 单价 × 数量'
);
select is(
  public.calculate_line_amount(33.00, 1),
  33.00::numeric,
  'calculate_line_amount：数量为 1 时行小计等于单价'
);
select is(
  public.calculate_line_amount(12.50, 4)::text,
  '50.00',
  'calculate_line_amount：输出保留两位小数'
);

-- ── 规则：包装费 = 外带按传入费率、堂食 0（费率是入参，数值来自配置） ───────

select is(
  public.calculate_packaging_fee('takeout'::public.dining_mode, 2.00),
  2.00::numeric,
  'calculate_packaging_fee：外带按传入费率收 2.00'
);
select is(
  public.calculate_packaging_fee('dinein'::public.dining_mode, 2.00),
  0.00::numeric,
  'calculate_packaging_fee：堂食不收包装费'
);
select is(
  public.calculate_packaging_fee('takeout'::public.dining_mode, 5.00),
  5.00::numeric,
  'calculate_packaging_fee：费率是入参——换费率即按新费率收，不是写死的 2.00'
);
select is(
  public.calculate_packaging_fee('dinein'::public.dining_mode, 5.00),
  0.00::numeric,
  'calculate_packaging_fee：费率是入参——堂食仍为 0'
);

-- ── 规则：总额 = 各行小计之和 + 包装费 ─────────────────────────────────────

select is(
  public.calculate_order_total(array[66.00, 20.00]::numeric[], 'takeout'::public.dining_mode, 2.00),
  88.00::numeric,
  'calculate_order_total：总额 = 各行小计之和 + 包装费（外带）'
);
select is(
  public.calculate_order_total(array[66.00, 20.00]::numeric[], 'dinein'::public.dining_mode, 2.00),
  86.00::numeric,
  'calculate_order_total：堂食总额不含包装费'
);
select is(
  public.calculate_order_total(array[]::numeric[], 'takeout'::public.dining_mode, 2.00),
  2.00::numeric,
  'calculate_order_total：空小计数组边界——总额只有包装费'
);
select is(
  public.calculate_order_total(array[]::numeric[], 'dinein'::public.dining_mode, 2.00),
  0.00::numeric,
  'calculate_order_total：空小计数组边界——堂食总额为 0.00'
);
select is(
  public.calculate_order_total(array[66.00]::numeric[], 'takeout'::public.dining_mode, 5.00),
  71.00::numeric,
  'calculate_order_total：总额按传入费率重算（配置换值时不改函数）'
);

-- ── 规则：规格摘要 = 选项文案按传入顺序用 " / " 连接 ───────────────────────

select is(
  public.build_spec_summary(array['大杯', '冰饮推荐', '燕麦奶']),
  '大杯 / 冰饮推荐 / 燕麦奶',
  'build_spec_summary：用 " / " 连接选项文案'
);
select is(
  public.build_spec_summary(array['大杯']),
  '大杯',
  'build_spec_summary：单项摘要不带分隔符'
);
select is(
  public.build_spec_summary(array[]::text[]),
  '',
  'build_spec_summary：无规格（空数组）摘要为空串'
);
select is(
  public.build_spec_summary(array['大杯', '', '  ', null]::text[]),
  '大杯',
  'build_spec_summary：空白与空值项被忽略'
);
select is(
  public.build_spec_summary(array['少糖', '大杯']),
  '少糖 / 大杯',
  'build_spec_summary：保持传入顺序（顺序由 Story 3.3 的解析查询保证）'
);

-- ── 纯函数性：声明 immutable 且不提权 ─────────────────────────────────────

select is(
  (select count(*)::int
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('calculate_unit_price', 'calculate_line_amount', 'calculate_packaging_fee',
                        'calculate_order_total', 'build_spec_summary')
      and p.provolatile = 'i'),
  5,
  '5 个金额函数都声明为 immutable——同输入必同输出'
);
select is(
  (select count(*)::int
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('calculate_unit_price', 'calculate_line_amount', 'calculate_packaging_fee',
                        'calculate_order_total', 'build_spec_summary')
      and not p.prosecdef),
  5,
  '5 个金额函数都不提权（security invoker），不需要额外权限'
);

-- ── 纯函数性：无表权限的角色也能调用（无表访问的行为证明） ─────────────────
-- 建一个只有这 5 个函数执行权、没有任何表权限的对照角色；调用成功即函数没有碰表。
-- 先证明对照角色对 public 下所有表/视图都没有读权限，后面的断言才有约束力。

create role amounts_checker nologin;
grant amounts_checker to current_user;
grant usage on schema extensions to amounts_checker;
grant execute on function public.calculate_unit_price(numeric, numeric[]) to amounts_checker;
grant execute on function public.calculate_line_amount(numeric, integer) to amounts_checker;
grant execute on function public.calculate_packaging_fee(public.dining_mode, numeric) to amounts_checker;
grant execute on function public.calculate_order_total(numeric[], public.dining_mode, numeric) to amounts_checker;
grant execute on function public.build_spec_summary(text[]) to amounts_checker;

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v', 'm', 'p', 'f')
      and pg_catalog.has_table_privilege('amounts_checker', c.oid, 'select')),
  0,
  '对照角色 amounts_checker 对 public 下所有表与视图都没有读权限'
);

set local role amounts_checker;

select lives_ok(
  $$ select public.calculate_unit_price(30.00, array[3.00]::numeric[]) $$,
  '无表权限角色可执行 calculate_unit_price——函数没有表访问'
);
select lives_ok(
  $$ select public.calculate_line_amount(33.00, 2) $$,
  '无表权限角色可执行 calculate_line_amount——函数没有表访问'
);
select lives_ok(
  $$ select public.calculate_packaging_fee('takeout'::public.dining_mode, 2.00) $$,
  '无表权限角色可执行 calculate_packaging_fee——函数没有表访问'
);
select lives_ok(
  $$ select public.calculate_order_total(array[30.00, 12.00]::numeric[], 'takeout'::public.dining_mode, 2.00) $$,
  '无表权限角色可执行 calculate_order_total——函数没有表访问'
);
select lives_ok(
  $$ select public.build_spec_summary(array['大杯', '冰饮推荐']) $$,
  '无表权限角色可执行 build_spec_summary——函数没有表访问'
);

select is(
  public.calculate_order_total(array[30.00, 12.00]::numeric[], 'takeout'::public.dining_mode, 2.00),
  44.00::numeric,
  '无表权限角色调用 calculate_order_total 得到正确总额'
);

reset role;

-- ── 权限：内部计算器，客户端不可执行，所有者可执行 ────────────────────────

select is(
  (select count(*)::int
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('calculate_unit_price', 'calculate_line_amount', 'calculate_packaging_fee',
                        'calculate_order_total', 'build_spec_summary')
      and not pg_catalog.has_function_privilege('anon', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')),
  5,
  '5 个金额函数对 anon 与 authenticated 都不可执行（内部计算器）'
);
select is(
  (select count(*)::int
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('calculate_unit_price', 'calculate_line_amount', 'calculate_packaging_fee',
                        'calculate_order_total', 'build_spec_summary')
      and pg_catalog.has_function_privilege(pg_get_userbyid(p.proowner), p.oid, 'execute')),
  5,
  '5 个金额函数的所有者仍可执行——Story 3.3 的下单函数以所有者身份调用'
);

select * from finish();

rollback;
