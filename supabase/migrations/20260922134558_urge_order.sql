-- 催单加速（Story 4.3；FR-P2-12；AD-5、AD-6、AD-12、AD-13、AD-21、AD-22）
-- 催单只写 ready_at、不写 status：把推进时刻提前到「催单时刻 + 门店配置的提前量」，
-- 并与「原定时刻」取较早者（least）——重复催单因此幂等：既不更早、也不更晚。
-- 写入是一条带状态谓词的原子更新（AD-6）：条件（本人的单 + 仍制作中）与赋值在同一条语句内完成，
-- 不先读后写；与推进并发时，谁先落库由两条原子更新的先后顺序收敛。
-- 拒绝语义（AD-13）：非本人与不存在返回同一结果（order_not_found，不泄露存在性）；
-- 本人但状态非「制作中」返回明确的 invalid_status。
-- 权限模型（AD-5、AD-21）：security definer + search_path = ''，自带归属谓词，只授权已登录身份。

-- ── 错误类别：追加两个取值（AD-12：取值集合只有这一处来源） ──────────────────
-- order_not_found 覆盖「不是我的单」与「不存在」两种情况：两者返回同一结果（AD-13）。
-- invalid_status 表示「是我本人的单，但当前状态不允许这个操作」（催单要求仍制作中；
-- Story 4.4 的确认取杯复用同一取值，要求仍待取餐）。

alter type public.order_error_code add value if not exists 'order_not_found';
alter type public.order_error_code add value if not exists 'invalid_status';

comment on type public.order_error_code is
  '下单与订单操作的失败类别；类别是稳定契约、文案不是（AD-12）；invalid_transition = 不存在的状态迁移；order_not_found = 订单不存在或不属于调用者（两种情况的同一结果，不泄露存在性）；invalid_status = 本人的单但当前状态不允许该操作';

-- ── 对外形状：下单与催单共用同一映射（AD-22） ────────────────────────────────
-- 不新增第二套形状：催单返回的订单与下单返回的订单出自同一个 order_result_json。

comment on function public.order_result_json(public.orders, text) is
  '订单写操作的对外形状（下单、催单共用；后续订单写操作沿用同一映射）：字段名沿用列名、金额为定点 JSON 数字、时间按门店时区格式化（AD-10、AD-22）';

-- ── 催单（FR-P2-12） ────────────────────────────────────────────────────────
-- 函数不接收时间、用户与金额：推进时刻由服务端时钟与门店配置算出，归属取自会话身份。

create function public.urge_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_order public.orders%rowtype;
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

  -- 带状态谓词的原子更新（AD-6）：判断与赋值在同一条语句里完成，不先读后写。
  -- least = min(原定时刻, 催单时刻 + 门店配置的提前量)：
  --   * 重复催单时右边的值只会更晚，取小后与第一次相同——「催得越多不会越快，也不会更晚」；
  --   * 原定时刻已经更早（例如已到点但还没被扫到）时不做改动；
  --   * 推进先赢时状态已不是 cooking，这条更新匹配 0 行，什么都不改（不会把已推进的单拨回来）。
  update public.orders o
     set ready_at = least(o.ready_at, now() + make_interval(secs => s.urge_lead_seconds))
    from public.stores s
   where s.id = o.store_id
     and o.id = p_order_id
     and o.user_id = v_user_id
     and o.status = 'cooking'
  returning o.* into v_order;

  if v_order.id is not null then
    select s.timezone into v_timezone from public.stores s where s.id = v_order.store_id;
    return public.order_result_json(v_order, v_timezone);
  end if;

  -- 更新没命中，只为了选错误文案再读一次（读的结果不参与任何写入决策）：
  -- 是本人的单 → 状态已不可催（明确结果）；不是 → 与「不存在」返回同一结果。
  if exists (
    select 1
      from public.orders o
     where o.id = p_order_id
       and o.user_id = v_user_id
  ) then
    raise exception '%', 'invalid_status'::public.order_error_code;
  end if;

  raise exception '%', 'order_not_found'::public.order_error_code;
end;
$$;

comment on function public.urge_order(uuid) is
  '催单（FR-P2-12）：把本人「制作中」订单的推进时刻提前到 min(原定时刻, 服务端时钟 + stores.urge_lead_seconds)；不写状态（推进仍由 advance_due_orders 完成，AD-6）；重复催单幂等（返回成功且不改动）；非本人/不存在返回同一结果 order_not_found，本人非制作中返回 invalid_status（AD-13）';

-- 权限：只允许已登录身份执行；内部映射仍不对客户端开放（AD-5、AD-21）
revoke execute on function public.urge_order(uuid) from public, anon;
grant execute on function public.urge_order(uuid) to authenticated;
