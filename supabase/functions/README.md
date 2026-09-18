# supabase/functions

| 函数 | 作用 |
| --- | --- |
| `wechat-login/` | 登录：用 `wx.login` 的一次性凭证换取 OpenID，确保它对应一个平台用户（首登建用户 + 映射，再登复用），并返回平台签发的会话（`access_token` + `refresh_token`）——兑换在函数内完成，客户端只见一个接口 |

## 密钥

AppSecret 只来自服务端运行环境，仓库与客户端里都不出现（AR-5）。

```shell
cd supabase/functions
cp .env.example .env   # 填 WECHAT_APP_ID / WECHAT_APP_SECRET；.env 已被 gitignore
```

云端用平台 secret：`supabase secrets set WECHAT_APP_ID=... WECHAT_APP_SECRET=...`（名字不以 `SUPABASE_` 开头）。
平台自身注入的 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（建平台用户与读写身份映射）与 `SUPABASE_ANON_KEY`（兑换会话用的发布密钥）都由运行时提供，不需要手工配置——本地 `functions serve` 实测会注入这三个。

## 本地运行与冒烟

```shell
cd supabase
supabase functions serve wechat-login --env-file functions/.env
```

另开一个终端：

```shell
curl -i -X POST http://127.0.0.1:54321/functions/v1/wechat-login \
  -H 'Content-Type: application/json' -d '{"code":"whatever"}'
# 凭证无效        → 400 {"code":"invalid_code","message":"登录凭证无效"}
# AppID / 密钥错  → 500 invalid_app_id / 500 invalid_app_secret（把 env 改错再重启服务）
# 成功            → 200 {"access_token":"...","refresh_token":"...","expires_in":3600}
#                   （同一个 openid 重复调用仍是同一个用户，每次签发新会话）
```

客户端拿到响应即可直接用，不需要再调平台接口（`$ANON_KEY` 取 `supabase status -o env` 的 `ANON_KEY`；云端用发布密钥）：

```shell
curl -i http://127.0.0.1:54321/auth/v1/user \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer <上一步的 access_token>"
# 成功 → 200 {"id":"...", ...}，这个 id 就是 wechat_identities 里该 openid 的 user_id
# 刷新凭证同理：POST /auth/v1/token?grant_type=refresh_token，body {"refresh_token":"..."}
```

「凭证过期或已用」（40163 / 42003）需要真实的一次性凭证用两次才能构造，留到真机验证（Story 2.5）。

## 身份：openid ↔ 平台用户（Story 2.2）

- 映射表 `public.wechat_identities`：只存 `openid`、`user_id`、`created_at`、`last_login_at`；内部表，客户端角色零授权、零策略（AR-18、AD-24）。
- 唯一读写入口是两个 RPC（`security definer` + `search_path = ''`，只授权给 `service_role`）：
  - `resolve_wechat_identity(openid)`：有映射则推进最近登录时间并返回 `user_id`，没有返回空值；
  - `claim_wechat_identity(openid, user_id)`：`insert ... on conflict (openid) do update ... returning user_id`，并发时返回既有归属、不覆盖。
- 平台用户走平台 Admin API 创建，不直插 `auth.users`；**用户 id 与占位邮箱都由 openid 派生**（uuid v5 / `wx-<openid>@wechat.local`），这是并发首登只产生一个用户的关键：
  - 第二个请求建用户会撞平台唯一约束——顺序重试是 422 `email_exists`；并发时是 500（SDK 归为可重试错误、拿不到具体 code，按状态码判断），两种都按「已存在」继续，不视为失败；
  - 随后 `claim` 由数据库的 `openid` 主键收敛到同一个 `user_id`。
  - 若这个假设不成立（例如有人手工建了不同 id 的同邮箱用户），外键约束会让登录以 `unknown` 失败，而不是悄悄建立错误身份。
- 平台侧失败（建用户失败、写映射失败）统一归到 `unknown`，不新增错误类别。

## 会话签发（Story 2.3）

路线（addendum §A）：边缘函数生成一次性登录令牌后**在函数内完成兑换**，把**平台标准会话**直接返回给客户端——一个登录接口交出可用凭证，客户端不需要再了解平台的兑换接口。会话仍由平台签发，不存在任何自签 JWT（AD-16）。

- **响应形状**：只有 `access_token` / `refresh_token` / `expires_in` 三个字段。平台多给的（`user`、`token_type`、`expires_at`）不下发；`openid` / `user_id` 与一次性令牌都不出服务端。
- **生成**：官方 Admin API `generate_link`（`type=magiclink`，邮箱用由 openid 派生的占位邮箱 `wx-<openid>@wechat.local`）。它只生成令牌、不发邮件。
- **兑换**：`POST /auth/v1/verify`，body `{ type: "email", token_hash }`，请求头带发布密钥作 `apikey`——客户端本来就会用这个身份，不是服务端密钥。
  - `type` 是平台漂移点：当前文档推荐 `email`（`magiclink` / `signup` 已标记废弃）；本地实测 `email` 直接可用。它现在只存在于服务端：平台改口径时重新部署函数即可，不用发小程序。
- **一次性与时效**：由平台的一次性机制保证（本地 `config.toml` 的 `auth.email.otp_expiry = 3600` 秒；云端为平台默认值）。令牌被消费、过期或伪造时，由平台拒绝，不产生任何会话。
- **并发登录会互相顶掉**：平台把一次性令牌存在 `auth.one_time_tokens` 表里，表上有唯一约束 `(user_id, token_type)`——**同一个用户、同一种令牌同时只有一份**（不同类型可共存，实测确认；magiclink 落在 `recovery_token` 这一种）。所以连发两张只有后一张能兑换，前一张再去兑换得到 403 `otp_expired`。因此兑换被明确拒绝时会重发，上限 3 次（同一 openid 并发登录时每轮至少有一个请求胜出）；平台不可达或响应不可用则直接失败，不重发。注意这是实测出来的平台实现细节、官方文档没有承诺，平台若改行为，重试只会不再触发。
- **失败语义**：生成或兑换失败 → 500 `unknown`（与身份建立失败同类别）；重试幂等——用户与映射已建、令牌重发，不留半登录状态。
- **日志卫生**：响应里带刷新凭证，函数内不要打印响应体。

## 单测（不需要网络与密钥）

```shell
deno test supabase/functions/tests/
```

测试放 `functions/tests/<函数名>/`（Supabase 官方推荐布局，函数目录只留参与部署的代码），覆盖：微信错误码 → 类别映射（含无法真实构造的 40226 / 45011 / 45009 / -1）、请求体与请求方法边界、缺少服务端配置、响应不泄露密钥与微信原文、类别 → 状态码、派生 id/邮箱的确定性、首登建用户、再登复用、并发撞车（422 email_exists / 500 视为可能撞车，由 claim 与外键兜底）分支、令牌生成（调用形状、成功与失败分支）、令牌兑换与会话签发（只取三个字段、「平台明确拒绝」与「平台不可达」的区分、重发上限）。

## 端到端（需要本地栈，只把微信换成假的）

```shell
cd supabase && eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' \
  | sed 's/^API_URL=/SUPABASE_URL=/; s/^ANON_KEY=/SUPABASE_ANON_KEY=/; s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/')" && cd ..
export SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
deno test --allow-net --allow-env supabase/functions/tests/e2e/wechat-login.e2e.ts
```

在真平台（Auth Admin API + Auth + PostgREST + 数据库）上验证：首次登录建出用户与映射、再次登录复用且不再调建用户接口、三个并发首登请求最终只有一个用户与一行映射且都拿到会话；以及 Story 2.3 的登录直接返回可用会话（响应只有三个字段、主体与映射用户一致、凭会话可访问 `/auth/v1/user`、刷新凭证可续期），外加机制依赖的平台性质——一次性令牌只能用一次、伪造令牌被拒（令牌不离开服务端，这两条只能直接向平台取证）。文件名 `*.e2e.ts` 不匹配 `deno test` 的默认扫描，所以单测命令不会误跑它。

## 约定

- 错误类别的取值集合以迁移 `migrations/*_login_error_code.sql` 为唯一来源；微信错误码 → 类别的映射只存在 `wechat-login/wechat.ts`
- 错误响应 `{ code, message }`，状态码：400 客户端凭证问题 / 403 高风险拦截 / 429 限流 / 500 服务端配置或未知 / 502 微信不可用
- 函数关闭平台前置 JWT 校验（`config.toml` 的 `[functions.wechat-login]`），输入由函数内自行校验
- 会话一律由平台签发，禁止自签 JWT；客户端只允许出现发布密钥，需要身份的请求附 `Authorization: Bearer <访问凭证>`（AD-16）
- 平台调用走官方 `@supabase/supabase-js`（平台客户端只在 `handler.ts` 里构造一处：Admin API 用服务端密钥、兑换会话用发布密钥；自定义 fetch 仅用于测试注入）
- 类型引用 `../types/database.types.ts`（生成物，不手工编辑）
