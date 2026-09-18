-- 登录错误类别：取值集合只有这一处来源（Story 2.1；AD-12、FR-P2-1、NFR3）。
-- 微信错误码 → 类别的映射只存在于边缘函数 wechat-login，本文件只定义类别本身。
-- network_unreachable 不由服务端产生：它是客户端发不出请求时由 api/ 侧判定的类别。

create type public.login_error_code as enum (
  'invalid_app_id',
  'invalid_app_secret',
  'invalid_code',
  'code_expired_or_used',
  'risky_user_blocked',
  'rate_limited',
  'wechat_unavailable',
  'unknown',
  'network_unreachable'
);

comment on type public.login_error_code is
  '登录失败原因；类别是稳定契约，文案不是（AD-12）';
