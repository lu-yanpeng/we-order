-- 确认取杯与超时自动完成（Story 4.5；FR-P2-13；AD-5、AD-6、AD-13、AR-13、AR-17）
-- 机制与触发分离（AD-6）：transition_order 仍是全库唯一写 orders.status 的地方，
-- 本迁移只增加两个触发源，不新增第二处状态写入：
--   * 用户确认：complete_order——只授权已登录身份，自带归属谓词（AD-5）；
--   * 超时兜底：complete_due_orders——与 advance_due_orders 同构：不传用户 = 全部超时订单
--     （周期扫描兜底），传用户 = 只处理该用户的超时订单（读取时即时完成，Epic 5 调用）。
-- 自动完成时刻在订单进入「待取餐」的那条原子更新里、按门店配置（stores.auto_complete_seconds）
-- 算出并落库：与状态迁移同一条语句，不存在「待取餐却没有自动完成时刻」的中间态；
-- 之后改配置不影响已出的单。
-- Phase 4 的商家扫杯是第三个触发源（本阶段不实现）：同样只调 pickup→completed，不改变状态机。
-- 数据清理：结构约束要求既有行满足「不在制作中 ⇔ 有自动完成时刻」——旧单没有这个时刻，
-- 补一个等于伪造历史，因此同 Story 4.4 清空既有订单（Phase 2 不上云，本地只有测试数据；
-- 明细随外键级联删除）。

-- ── 门店配置：自动完成等待时长（Story 4.5）────────────────────────────────────

alter table public.stores
  add column auto_complete_seconds integer not null default 30
    check (auto_complete_seconds > 0);

comment on column public.stores.auto_complete_seconds is
  '自动完成等待时长（秒）：订单进入「待取餐」时用它算自动完成时刻（Story 4.5）；之后改本值不影响已进入「待取餐」的订单；演示参数（默认 30 秒），Phase 4 由商家后台配置';

-- ── 订单：自动完成时刻（Story 4.5、AD-6）─────────────────────────────────────

alter table public.orders
  add column auto_complete_at timestamptz;

comment on column public.orders.auto_complete_at is
  '自动完成时刻：进入「待取餐」时按门店配置算出并落库（Story 4.5），之后不再改动；到点后由超时兜底置为「已完成」；「制作中」恒为空值';

-- 旧订单没有这个时刻，无法在结构约束收紧后继续存在（与 Story 4.4 收紧取杯号同样的理由）。
delete from public.orders;

alter table public.orders
  add constraint orders_auto_complete_check
    check ((status = 'cooking') = (auto_complete_at is null));

comment on constraint orders_auto_complete_check on public.orders is
  '「不在制作中 ⇔ 有自动完成时刻」：待取餐的单不可能没有自动完成时刻（不会永久挂在待取餐），制作中的单也不携带无意义的时刻（Story 4.5）';

-- 超时扫描只挑「待取餐」的到点判定（与 orders_due_idx 同构）。
create index orders_auto_complete_idx on public.orders (auto_complete_at)
  where status = 'pickup';

comment on index public.orders_auto_complete_idx is
  '超时自动完成扫描：只索引「待取餐」的到点判定（Story 4.5）';

comment on column public.orders.completed_at is
  '完成时间：确认取杯或超时自动完成（pickup→completed）时由服务端记录（FR-P2-13）；一经写入不再改动（重复确认幂等）';

-- 取杯号不参与状态表达：确认取杯与自动完成都不写它（与推进、催单一致）。
comment on column public.orders.pickup_code is
  '取杯号：下单时分配、恒有值（字母前缀 + 四位数字，A-0001–Z-9999，同一前缀用尽后进入下一个字母）；门店 + 门店本地自然日唯一，允许跳号不允许重号（AD-7）；一经分配不可变——推进、催单、确认取杯与超时自动完成都不写它（Story 4.4、4.5）';

-- ── 状态迁移引擎：进入「待取餐」时算好自动完成时刻（AD-6、Story 4.5）──────────
-- 签名与实现只在此处更新（create or replace 保留既有权限，不需要重新 revoke）：
--   * cooking→pickup：在同一条 UPDATE 里写状态并从门店配置算出 auto_complete_at——
--     状态与时刻要么一起落库、要么都不落，不存在中间态；
--   * pickup→completed：completed_at 取服务端时钟，auto_complete_at 保持进入待取餐时的值
--     （之后改配置不影响已出的单）。

create or replace function public.transition_order(
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
  -- (cooking,pickup) 由 advance_due_orders 调用；(pickup,completed) 由确认取杯与超时自动完成调用。
  if p_from is null or p_to is null
     or not ((p_from = 'cooking' and p_to = 'pickup')
             or (p_from = 'pickup' and p_to = 'completed')) then
    raise exception '%', 'invalid_transition'::public.order_error_code;
  end if;

  update public.orders o
     set status = p_to,
         auto_complete_at = case
           when p_to = 'pickup'
             then now() + make_interval(secs => s.auto_complete_seconds)
           else o.auto_complete_at
         end,
         completed_at = case when p_to = 'completed' then now() else o.completed_at end
    from public.stores s
   where s.id = o.store_id
     and o.id = p_order_id
     and o.status = p_from
     and (p_user_id is null or o.user_id = p_user_id)
  returning o.* into v_order;

  return v_order;
end;
$$;

comment on function public.transition_order(uuid, public.order_status, public.order_status, uuid) is
  '状态迁移的唯一实现（AD-6）：带状态谓词的原子更新；状态不匹配时返回空值、不改变任何数据；非法迁移抛 invalid_transition；cooking→pickup 在同一条语句里按门店配置写入自动完成时刻（Story 4.5），pickup→completed 记录完成时间、不改写自动完成时刻；p_user_id 供确认取杯的归属校验（Story 4.5），推进与超时兜底调用不传';

-- ── 用户确认取杯（FR-P2-13；AD-5、AD-13）────────────────────────────────────
-- 结果语义（AD-13）：
--   * 本人待取餐 → 完成（走 pickup→completed 同一迁移实现），返回与下单/催单共用的形状；
--   * 本人已完成（重复确认 / 已由超时自动完成）→ 成功且不改写完成时间（目标状态已达成）；
--   * 本人制作中 → 明确的 invalid_status；
--   * 非本人 / 不存在 → 同一结果 order_not_found（不泄露存在性）；
--   * 未登录 → not_authenticated。
-- 并发：状态判断与写入是同一条原子更新，同一行上的两次更新由行锁串行化——
--   * 与推进并发时：确认语句读到「待取餐」则成功完成，读到「制作中」则明确拒绝
--     invalid_status；两种结果都由提交顺序决定，不产生中间态；
--   * 与超时自动完成（或重复确认）并发时：没改到数据的一方读到「已完成」，
--     按 AD-13「目标状态已达成」返回成功，不改写完成时间。

create function public.complete_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_existing public.orders%rowtype;
  v_timezone text;
begin
  -- 归属的唯一来源：会话身份（参数里没有用户标识的入口）
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception '%', 'not_authenticated'::public.order_error_code;
  end if;

  if p_order_id is null then
    raise exception '%', 'invalid_request'::public.order_error_code;
  end if;

  -- 与推进/超时自动完成共用同一处迁移实现（AD-6）
  v_order := public.transition_order(p_order_id, 'pickup', 'completed', v_user_id);

  if v_order.id is not null then
    select s.timezone into v_timezone from public.stores s where s.id = v_order.store_id;
    return public.order_result_json(v_order, v_timezone);
  end if;

  -- 更新没命中，只为了选结果再读一次（读的结果不参与任何写入决策）：
  -- 是本人的单 → 已完成则目标已达成、制作中则状态不允许；不是 → 与「不存在」返回同一结果。
  select * into v_existing
    from public.orders o
   where o.id = p_order_id
     and o.user_id = v_user_id;

  if not found then
    raise exception '%', 'order_not_found'::public.order_error_code;
  end if;

  if v_existing.status = 'completed' then
    select s.timezone into v_timezone from public.stores s where s.id = v_existing.store_id;
    return public.order_result_json(v_existing, v_timezone);
  end if;

  raise exception '%', 'invalid_status'::public.order_error_code;
end;
$$;

comment on function public.complete_order(uuid) is
  '确认取杯（FR-P2-13）：把本人「待取餐」的订单置为「已完成」，完成时间由服务端记录；与推进、超时自动完成共用 transition_order 的 pickup→completed（AD-6）；重复确认与确认已自动完成的订单返回成功且不改写完成时间；非本人/不存在返回同一结果 order_not_found，本人未到待取餐返回 invalid_status（AD-13）；不需要额外凭证（不做取餐码核销）';

-- ── 超时兜底：自动完成到点的「待取餐」订单（FR-P2-13；AD-6）──────────────────
-- 与 advance_due_orders 同构：
--   * p_user_id 为空 = 全部超时订单（周期扫描兜底）；
--   * p_user_id 非空 = 只处理这个用户的超时订单（读取时即时完成，Epic 5 的读取函数调用）。
-- 只挑「待取餐」且 auto_complete_at 已到的订单；归属作用域由本函数的过滤决定，
-- 迁移调用不绑定归属（与 advance_due_orders 同，AD-6），也不向客户端暴露（AD-21）。
-- 幂等：重复执行时已完成的订单不再是 pickup，选中不到 / 更新 0 行，不改写完成时间。

create function public.complete_due_orders(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due record;
  v_completed public.orders%rowtype;
  v_completed_count integer := 0;
begin
  for v_due in
    select o.id
      from public.orders o
     where o.status = 'pickup'
       and o.auto_complete_at <= now()
       and (p_user_id is null or o.user_id = p_user_id)
     order by o.auto_complete_at, o.id
  loop
    v_completed := public.transition_order(v_due.id, 'pickup', 'completed');
    if v_completed.id is not null then
      v_completed_count := v_completed_count + 1;
    end if;
  end loop;
  return v_completed_count;
end;
$$;

comment on function public.complete_due_orders(uuid) is
  '超时兜底：把到点的「待取餐」订单自动置为「已完成」；不传用户 = 全部（周期扫描），传用户 = 只处理该用户（读取时即时完成）；返回实际完成条数；幂等、可重跑（Story 4.5、AD-6）';

-- ── 权限：只授权用户入口；兜底机制不向客户端暴露（AD-5、AD-21）────────────────

revoke execute on function public.complete_order(uuid) from public, anon;
grant execute on function public.complete_order(uuid) to authenticated;

revoke execute on function public.complete_due_orders(uuid) from public, anon, authenticated;

-- ── 周期扫描：一次扫描兜底两个触发源（Story 4.2 + 4.5；AR-6、AR-13、AR-19）────
-- 任务命令从「只调推进」改为「一条语句里同时调用两个机制」：一次执行 = 一个事务，
-- 任一机制失败整体回滚（NFR2），下次扫描照常重试；两个机制都幂等、可重跑。
-- 任务名从 advance-due-orders 改为 order-sweep——它现在不只做推进；先按名字安全移除旧任务
-- （不存在则跳过），本地 db reset 重放与任何环境都不会留下第二个任务。
-- 周期 15 秒是演示参数；平台只支持周期任务（AR-19），本任务即「周期兜底」那一半。
-- 注意：migration squash 会丢弃 cron 任务，使用前须知会丢什么（AR-6）。

select cron.unschedule(jobname)
  from cron.job
 where jobname = 'advance-due-orders';

select cron.schedule(
  'order-sweep',
  '15 seconds',
  'select public.advance_due_orders(), public.complete_due_orders()'
);
