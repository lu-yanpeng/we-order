# supabase/functions/tests

边缘函数（Deno）的测试：与业务代码分开（业务代码在 `functions/<function-name>/`），也与数据库测试分开（数据库测试在 `supabase/tests/`，用 pgTAP）。

- 一条命令：`cd supabase && deno task test`（等价于 `deno test supabase/functions/tests/`）
- 离线且确定：外部调用通过注入假 fetch 与假身份解析模拟，不需要网络与真实凭证
- 类别断言以数据库类型 `login_error_code` 为准；文案不是契约，不断言措辞

| 文件 | 覆盖 |
| --- | --- |
| `wechat-login/wechat-login.test.ts` | wechat-login：微信错误码 → `login_error_code` 映射（含未知码）、请求形状（官方地址与参数）、入参校验、连不上微信/非 JSON/HTTP 5xx、AppSecret 不外泄、成功时调用一次身份解析、身份解析失败 → `identity_failed` 且不泄露内部细节 |

本地集成验证（需要 `supabase start`，不在 `deno task test` 内）：

- `cd supabase && deno task verify:identity` → `scripts/verify-wechat-identity.ts`：并发首登收敛、重登复用、映射丢失自愈；结束后清理测试用户
