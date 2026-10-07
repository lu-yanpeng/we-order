-- Realtime 发布配套（Story 5.3；FR-P3-17；AR-P3-14 / AD-13）
-- 覆盖：supabase_realtime publication 的声明（存在、非全表发布、public 成员恰为 orders 一张）与
--       订阅前置（orders 的 SELECT 权限与本人 SELECT 策略只面向 authenticated）。
-- 边界：pgTAP 钉得住「声明」，钉不住「WAL 事件是否按 RLS 过滤后投递」——事件投递的隔离证据由
--       scripts/verify-realtime-isolation.ts 的真实 WebSocket 两身份脚本给出（验证矩阵 #6）。
-- 不依赖种子与数据，只做目录级断言；结束回滚。

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select is(
  (select puballtables from pg_publication where pubname = 'supabase_realtime'),
  false,
  'supabase_realtime 是选择性发布（不是「所有表自动进流」）'
);

select ok(
  exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'orders'
  ),
  'public.orders 已加入 supabase_realtime publication'
);

select is(
  (select array_agg(tablename::text order by tablename)
     from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'),
  array['orders'],
  'publication 的 public 成员恰为 orders 一张（新增发布表必须来此处登记）'
);

select ok(
  has_table_privilege('authenticated', 'public.orders', 'select')
    and not has_table_privilege('anon', 'public.orders', 'select'),
  'orders 的 SELECT 权限只给 authenticated（订阅前置：匿名连裸表都读不到）'
);

select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies
    where schemaname = 'public' and tablename = 'orders'
      and cmd = 'SELECT' and roles = '{authenticated}'),
  array['orders_own_read'],
  'orders 携带且只携带一条面向 authenticated 的本人 SELECT 策略（订阅 RLS 的执行依据）'
);

select * from finish();

rollback;
