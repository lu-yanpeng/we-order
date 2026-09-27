-- 下单内核的权限收紧与服务端接缝（P3 Story 3.1；FR-P3-8；AD-12）
-- 目标：客户端不存在任何绕过支付接口的建单路径。
--   * create_order 从 public / anon / authenticated 收回 EXECUTE，成为只有服务端可达的内核
--     （本体签名与逻辑不变，归属仍只由请求上下文 auth.uid() 表达）；
--   * 新增 create_order_for_user：唯一允许声明「我是谁」的服务端接缝（P2 AD-3 的显式例外），
--     只授 service_role；内部以事务局部的 request.jwt.claims 注入 p_user_id 后调用内核。
-- 调用面：pay-order（P3 Story 3.2）以服务端密钥调用本函数；客户端直呼任一函数 → 42501。

create function public.create_order_for_user(
  p_user_id uuid,
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
begin
  -- 身份缺失 fail-closed：与内核的 not_authenticated 同一类别（表现伪装成会话失效）
  if p_user_id is null then
    raise exception '%', 'not_authenticated'::public.order_error_code;
  end if;

  -- 唯一允许声明「我是谁」的服务端接缝：事务局部注入，随事务结束消失；
  -- 内核照旧从 auth.uid() 取归属——不出现第二套归属 / 金额 / 写路径。
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id)::text,
    true
  );

  return public.create_order(p_items, p_dining_mode, p_notes, p_idempotency_key);
end;
$$;

comment on function public.create_order_for_user(uuid, jsonb, public.dining_mode, text, text) is
  '下单的服务端接缝（AD-12）：以事务局部注入 p_user_id 后调用内核；只授 service_role、客户端不可达；注入不生效时由内核以 not_authenticated fail-closed';

comment on function public.create_order(jsonb, public.dining_mode, text, text) is
  '下单内核（AD-2、AD-12）：校验输入、按库内价格重算金额、服务端生成订单号并在同一事务写入订单与明细；归属取请求上下文身份（AD-3）；客户端无执行权，唯一可达路径是服务端接缝 create_order_for_user';

-- ── 权限：语句级固定顺序（先 revoke 再 grant） ───────────────────────────────
-- Postgres 的 create function 默认授 PUBLIC，Supabase 的默认权限还会给
-- anon / authenticated / service_role 各授一份——仅 grant 不 revoke 会遗留客户端入口。

revoke execute on function public.create_order_for_user(uuid, jsonb, public.dining_mode, text, text)
  from public, anon, authenticated;
grant execute on function public.create_order_for_user(uuid, jsonb, public.dining_mode, text, text)
  to service_role;

-- 内核：从客户端角色收回执行权；本体不改，只有服务端可达
revoke execute on function public.create_order(jsonb, public.dining_mode, text, text)
  from public, anon, authenticated;
