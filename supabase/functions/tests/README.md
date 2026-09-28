# supabase/functions/tests

边缘函数（Deno）的测试：与业务代码分开（业务代码在 `functions/<function-name>/`），也与数据库测试分开（数据库测试在 `supabase/tests/`，用 pgTAP）。

- 一条命令：`cd supabase && deno task test`（等价于 `deno test supabase/functions/tests/`）
- 离线且确定：外部调用通过注入假 fetch、假身份解析与假会话签发模拟，不需要网络与真实凭证
- 类别断言以数据库类型 `login_error_code` 为准；文案不是契约，不断言措辞

| 文件 | 覆盖 |
| --- | --- |
| `wechat-login/wechat-login.test.ts` | wechat-login：微信错误码 → `login_error_code` 映射（含未知码）、请求形状（官方地址与参数）、入参校验、连不上微信/非 JSON/HTTP 5xx、AppSecret 不外泄、成功时返回平台会话形状（两凭证 + 过期信息 + 主体）且不泄露 openid/session_key、身份解析失败 → `identity_failed`、会话签发失败 → `session_failed` 且不泄露内部细节；契约解析（zod schema）：未知字段剥离、code 首尾空白裁掉（方案 B） |
| `pay-order/pay-order.test.ts` | pay-order：成功响应 = 订单对外形状原样、多余字段（金额 / 用户标识 / camelCase / 展示字段）忽略且不转发、必填与数量校验（缺/非法 → 类别）、身份失败四类均 401 且不触碰数据库、每个 `order_error_code` → 状态码映射、未知 SQLSTATE / 网络失败 → `unknown` 不泄露内部细节、出站 RPC 的 `apikey` 与 `Authorization` 均为服务端密钥且客户端 JWT 不转发；契约解析（zod schema）：未知字段剥离 / 可选字段省略 / selections 值域 / 数量类别映射 |

本地链路验证（需要 `supabase start`，不在 `deno task test` 内）：

- `cd supabase && deno task verify:login` → `scripts/verify-login.ts`：驱动真实 `handleRequest`
  （只把微信那一跳注入为受控响应）与真实平台会话，覆盖并发首登收敛、重登复用、映射丢失自愈、
  响应契约、会话主体一致、access token 可用、续期可用、平台令牌单次消费；结束后清理测试用户。
- `cd supabase && deno task verify:pay-order` → `scripts/verify-pay-order.ts`：真 HTTP 打边缘函数
  （穿过平台 `verify_jwt` 校验），覆盖无凭证 / 发布密钥的 401 与不落数据、camelCase 400、
  真会话 200 落单与归属、金额重算、幂等重放同单、业务拒绝（409 / 400）可区分；结束后清理测试用户。
- 函数自身的 HTTP 契约（请求 / 响应 / 错误类别）见 `functions/wechat-login/README.md` 与
  `functions/pay-order/README.md`。
