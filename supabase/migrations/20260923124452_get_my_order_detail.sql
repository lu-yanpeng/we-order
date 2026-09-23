-- 我的订单详情（Story 5.2；FR-P2-15；AD-5、AD-9、AD-10、AD-13、AD-22；AR-15、AR-17）
-- 已登录身份按订单 id 读取本人订单的完整信息：
--   * 订单对外形状直接复用 order_result_json（与列表、下单共用同一映射，字段名、空值规则、
--     时间与金额格式不可能漂移，AD-22/AD-10）；
--   * 门店信息读订单行上的快照列（名称、地址、电话），不 join stores 取当前值（AD-9）；
--   * items 为 order_items 的下单时刻快照：商品引用、商品名、规格摘要、结构化规格选择、
--     单价、数量（AD-9）。每行小计与商品摘要是列表页的便利字段，不属于详情形状。
-- 归属与拒绝语义：
--   * 归属来自会话身份，参数里没有用户入口；查询谓词与 orders 的 RLS 策略同构（AD-3/AD-4）；
--   * 非本人 / 不存在走同一条带归属谓词的查询、抛同一个结果 order_not_found，
--     调用方无法靠错误差异探测订单是否存在（AD-13）；未登录抛 not_authenticated、空 id 抛 invalid_request；
--   * security definer + search_path = ''，不附带任何额外的表权限（AD-5）。
-- 读取前的推进（AD-5）：与 get_my_orders 同构，先触发 advance_due_orders(我) 与 complete_due_orders(我)，
--   只调用既有机制、不复制判定逻辑；now() 在同一事务内固定，返回的详情不会出现
--   「已到点却仍制作中」或「已超时却仍待取餐」。
-- 明细顺序：按明细行的 id 排——确定但非提交顺序；提交顺序不在数据模型中，也不作为契约
--   （有意不加行号列，理由见验收记录）。

create function public.get_my_order_detail(p_order_id uuid)
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

  -- 详情形状 = 订单对外形状（唯一映射）+ 门店快照 + 明细快照
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
                        'quantity', oi.quantity
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
  '我的订单详情（FR-P2-15）：订单对外形状来自 order_result_json（与列表同一映射，AD-22）、门店快照三列与商品明细快照数组（AD-9）；读取前先推进调用者自己到点/超时的订单（AD-5）；非本人与不存在返回同一结果 order_not_found（AD-13）；未登录抛 not_authenticated、空 id 抛 invalid_request';

-- 权限：只允许已登录身份执行；未认证连入口都没有（AD-5、AD-21）
revoke execute on function public.get_my_order_detail(uuid) from public, anon;
grant execute on function public.get_my_order_detail(uuid) to authenticated;
