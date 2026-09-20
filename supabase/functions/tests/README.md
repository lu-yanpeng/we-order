# supabase/functions/tests

边缘函数（Deno）的测试：与业务代码分开（业务代码在 `functions/<function-name>/`），也与数据库测试分开（数据库测试在 `supabase/tests/`，用 pgTAP）。

- 一条命令：`cd supabase && deno task test`（等价于 `deno test supabase/functions/tests/`）
- 离线且确定：外部调用通过注入假 fetch、假身份解析与假会话签发模拟，不需要网络与真实凭证
- 类别断言以数据库类型 `login_error_code` 为准；文案不是契约，不断言措辞

| 文件 | 覆盖 |
| --- | --- |
| `wechat-login/wechat-login.test.ts` | wechat-login：微信错误码 → `login_error_code` 映射（含未知码）、请求形状（官方地址与参数）、入参校验、连不上微信/非 JSON/HTTP 5xx、AppSecret 不外泄、成功时返回平台会话形状（两凭证 + 过期信息 + 主体）且不泄露 openid/session_key、身份解析失败 → `identity_failed`、会话签发失败 → `session_failed` 且不泄露内部细节 |

本地链路验证（需要 `supabase start`，不在 `deno task test` 内）：

- `cd supabase && deno task verify:login` → `scripts/verify-login.ts`：驱动真实 `handleRequest`
  （只把微信那一跳注入为受控响应）与真实平台会话，覆盖并发首登收敛、重登复用、映射丢失自愈、
  响应契约、会话主体一致、access token 可用、续期可用、平台令牌单次消费；结束后清理测试用户。
- 函数自身的 HTTP 契约（请求 / 响应 / 错误类别）见 `functions/wechat-login/README.md`。
