-- 登录失败类别新增「会话签发失败」：与微信侧换取失败（wechat_unavailable 等）、
-- 身份解析失败（identity_failed）分开，错误可定位（Story 2.3；NFR3、AD-12）。
-- 会话签发内部两步：generateLink 生成一次性登录令牌 → verifyOtp 兑换平台会话；
-- 任一步失败都归为 session_failed。客户端只需重试，不留下半登录状态（FR-P2-3）。

alter type public.login_error_code add value if not exists 'session_failed';
