-- 我的订单列表（Story 5.1；FR-P2-14；AD-5、AD-6、AD-10、AD-13、AD-22、AD-23；AR-16、NFR1）
-- 已登录身份分页读取本人订单：创建时间倒序、键集（游标）分页、读时先推进。
--   * 归属写在函数内（等价于 user_id = (select auth.uid())，与 orders 的 RLS 策略同构，AD-3/AD-4）；
--     security definer + search_path = ''，不附带任何额外的表权限（AD-5）。
--   * 读取前先触发两个既有机制（「读时判定」那一半，AD-6）：
--       - advance_due_orders(我)：到点订单 → 待取餐；
--       - complete_due_orders(我)：超时订单 → 已完成（Story 4.5）。
--     只调用、不复制判定逻辑。now() 在同一事务内固定，「先推进再查询」之间不存在时间窗口，
--     因此返回结果里不会出现「已到点却仍制作中」或「已超时却仍待取餐」。
--   * 分页是键集（游标）分页：排序键 (created_at desc, id desc)，直接走 orders_user_created_idx；
--     翻页期间新下的单不会造成重复或遗漏（offset 分页会）。游标 = 上一页最后一条的
--     (created_at, id)，由服务端随信封返回、客户端原样回传；多取 1 条判断「还有没有下一页」。
--   * 形状（AD-22）：列表项 = order_result_json（订单对外形状的唯一映射）+ item_summary；
--     时间按门店时区输出为 YYYY-MM-DD HH:mm:ss（AD-10）；取杯号恒有值（Story 4.4）。
--   * 分页信封：{ items: [...], next_cursor: { created_at, id } | null }，null 表示到底。

create function public.get_my_orders(
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
      coalesce(s.item_summary, '') as item_summary
    from public.orders o
    join public.stores st on st.id = o.store_id
    left join lateral (
      select string_agg(
               oi.product_name || ' ×' || oi.quantity::text,
               '、' order by oi.id
             ) as item_summary
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
      || jsonb_build_object('item_summary', v_row.item_summary)
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
  '我的订单列表（FR-P2-14）：分页读取本人订单，创建时间倒序；返回信封 { items, next_cursor }（分页信封的唯一来源，AD-22/AD-23）；读取前先推进调用者自己到点/超时的订单（AD-6、Story 4.5）；列表项 = order_result_json + item_summary（商品名 ×数量，顿号连接）；未登录抛 not_authenticated，非法分页参数抛 invalid_request';

-- 权限：只允许已登录身份执行；内部机制与映射不对客户端开放（AD-5、AD-21）
revoke execute on function public.get_my_orders(integer, timestamptz, uuid) from public, anon;
grant execute on function public.get_my_orders(integer, timestamptz, uuid) to authenticated;
