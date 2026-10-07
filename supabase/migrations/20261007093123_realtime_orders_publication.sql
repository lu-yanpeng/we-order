-- Realtime 订阅配套：把 public.orders 加入 supabase_realtime publication（Story 5.3；FR-P3-17；AR-P3-14 / AD-13）
--
-- 分工：publication 决定「什么能进日志流」，RLS 决定「谁能看到哪一行」——发布本身不构成授权放开：
-- 他人数据（含列级数据）不会因为发布而可达，隔离由 orders 的本人 SELECT 策略裁决；
-- 现场证据见验证矩阵 #6 与 scripts/verify-realtime-isolation.ts（两身份真实 WebSocket，A 订阅 / B 变更）。
--
-- 只加这一张表：public schema 的成员清单恰为 public.orders（98_realtime_publication 把它钉住，
-- 将来新增发布表必须到测试处登记）；不收紧 publish 操作类型（保持平台默认 insert/update/delete/truncate）——
-- 客户端只订阅 INSERT / UPDATE，其余操作进入流内没有订阅者，属有意保留的最少改动（AR-P3-14）。
--
-- 幂等：Story 5.1 已在本地栈手工把 orders 加过（当时约定正式入仓归本 story），干净重建（db reset）
-- 与既有环境（migration up）都可能「已是成员」——先查 pg_publication_tables，只在缺失时添加；
-- 重复应用（migration up / 手工重放）不报错。publication 由平台在栈初始化时创建；若不存在，
-- 本迁移会失败得响亮（而不是静默跳过：那会让订阅「迁移过了却收不到事件」）。
--
-- 运维提示（Story 5.1 实测发现）：publication 变更后，运行中的 realtime 容器不会自动拾取——
-- 应用本迁移（或 db reset）后需重启 supabase_realtime 容器（docker restart supabase_realtime_we-order
-- 或 supabase stop && supabase start），订阅才可能收到事件；演示预检清单（addendum §F）已登记。

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end
$$;
