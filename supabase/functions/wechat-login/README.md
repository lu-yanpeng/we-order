# wechat-login 边缘函数

微信静默登录的唯一服务端入口（Story 2.1 / 2.2 / 2.3）。一次调用完成：

```
一次性凭证（wx.login 的 code）
  → 微信 code2Session 换 openid（AppSecret 只在服务端）
  → openid ↔ 平台用户的身份映射（并发首登由唯一约束收敛）
  → 生成一次性登录令牌并立即兑换为平台会话
  → 返回会话（访问凭证 + 刷新凭证）
```

- 身份映射缺失时，按 email 只读查询平台用户（RPC `find_user_by_email` 查 `auth.users`，
  客户端不可执行）——查到就补写映射（自愈），查不到才 `createUser`。
  不用 `admin.generateLink` 当反查：它对不存在的 email 会顺手创建未确认用户。

- 函数被调用时尚无会话：`config.toml` 已关闭平台前置 JWT 校验（`verify_jwt = false`），
  入参由函数自行校验。
- 会话由平台标准机制签发（`admin.generateLink` → `auth.verifyOtp`），不存在自签 JWT；
  一次性登录令牌在同一请求内被消费，不返回客户端，单次消费与有效期由平台保证。
- `generateLink` 用服务端密钥客户端；兑换用独立的发布密钥客户端——`verifyOtp` 会把会话
  写到所用客户端上，与服务端客户端混用会丢掉后续请求的服务端权限。
- AppSecret 只来自服务端运行环境（`WECHAT_APP_ID` / `WECHAT_APP_SECRET`，见 `functions/.env.example`）；
  服务端密钥与发布密钥由平台注入，均不出现在客户端。

## 请求

```
POST /functions/v1/wechat-login
Content-Type: application/json

{ "code": "<wx.login 返回的一次性凭证>" }
```

## 成功响应（2xx）

与平台 token 端点（登录 / 续期）同构，客户端可对「登录拿到的会话」与「续期换回的会话」
使用同一套形状：

```json
{
  "access_token": "eyJ...",
  "refresh_token": "ybx...",
  "token_type": "bearer",
  "expires_in": 3600,
  "expires_at": 1789903020,
  "user": { "id": "<平台用户 uuid>" }
}
```

- `expires_at` 为 Unix 秒，供客户端判断是否该续期（无需解 JWT）。
- `user` 只含 `id`（会话主体）；完整的平台 user 对象带由 openid 派生的 synthetic email，不外传。
- 不返回 openid；客户端凭会话即可访问受数据访问策略保护的数据，无需额外凭证。

## 失败响应（非 2xx）

```json
{ "code": "<login_error_code>", "message": "<给人看的文案>" }
```

`code` 取值以数据库枚举 `public.login_error_code` 为唯一来源（随类型契约生成到客户端）；
文案不是契约。

| code | HTTP | 含义 |
| --- | --- | --- |
| `invalid_request` | 400 / 405 | 入参不合法（非 POST、非 JSON、缺 code） |
| `invalid_code` | 400 | 微信拒绝该凭证 |
| `code_expired_or_used` | 400 | 凭证已过期或已使用 |
| `risky_user_blocked` | 403 | 微信拦截高风险用户 |
| `rate_limited` | 429 | 微信侧频率超限 |
| `invalid_app_id` / `invalid_app_secret` | 500 | 服务端微信配置错误 |
| `identity_failed` | 500 | 身份映射建立失败（内部故障，可重试） |
| `session_failed` | 500 | 会话签发失败（内部故障，可重试） |
| `wechat_unavailable` | 503 | 微信不可达或应答无效 |
| `unknown` | 500 / 502 | 未识别的微信错误或服务端缺配置 |

失败不留下半登录状态：身份映射与平台用户要么已建立、要么没有；重试会复用同一身份。
错误响应不含 AppSecret、服务端密钥、堆栈或数据库细节。

并发说明：同一身份的两个登录同时进行时，平台会让后生成的一次性令牌作废先生成的，
先发请求可能得到一次可重试的 `session_failed`。这是平台的有意设计，服务端不做重试，
客户端重试即可。

## 测试

- 离线单元测试：`cd supabase && deno task test`（假 fetch / 假身份解析 / 假会话签发）。
- 本地链路验证：`cd supabase && deno task verify:login`（需要本地栈；
  驱动真实 handler 与真实平台会话，只把微信那一跳注入为受控响应）。
