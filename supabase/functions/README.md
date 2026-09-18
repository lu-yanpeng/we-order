# supabase/functions

| 函数 | 作用 |
| --- | --- |
| `wechat-login/` | 登录：用 `wx.login` 的一次性凭证换取 OpenID，并确保它对应一个平台用户（首登建用户 + 映射，再登复用） |

## 密钥

AppSecret 只来自服务端运行环境，仓库与客户端里都不出现（AR-5）。

```shell
cd supabase/functions
cp .env.example .env   # 填 WECHAT_APP_ID / WECHAT_APP_SECRET；.env 已被 gitignore
```

云端用平台 secret：`supabase secrets set WECHAT_APP_ID=... WECHAT_APP_SECRET=...`（名字不以 `SUPABASE_` 开头）。
平台自身注入的 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 用于建平台用户与读写身份映射，不需要手工配置。

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
# 成功            → 200 {"openid":"o...","user_id":"<uuid>"}（同一个 openid 第二次调用返回同一个 user_id）
```

「凭证过期或已用」（40163 / 42003）需要真实的一次性凭证用两次才能构造，留到真机验证（Story 2.5）。

## 身份：openid ↔ 平台用户（Story 2.2）

- 映射表 `public.wechat_identities`：只存 `openid`、`user_id`、`created_at`、`last_login_at`；内部表，客户端角色零授权、零策略（AR-18、AD-24）。
- 唯一读写入口是两个 RPC（`security definer` + `search_path = ''`，只授权给 `service_role`）：
  - `resolve_wechat_identity(openid)`：有映射则推进最近登录时间并返回 `user_id`，没有返回空值；
  - `claim_wechat_identity(openid, user_id)`：`insert ... on conflict (openid) do update ... returning user_id`，并发时返回既有归属、不覆盖。
- 平台用户走平台 Admin API 创建，不直插 `auth.users`；**用户 id 与占位邮箱都由 openid 派生**（uuid v5 / `wx-<openid>@wechat.local`），这是并发首登只产生一个用户的关键：
  - 第二个请求建用户会撞平台唯一约束——邮箱重复是 422 `email_exists`，id 主键重复是 500 `23505`（实测），两种都按「已存在」继续，不视为失败；
  - 随后 `claim` 由数据库的 `openid` 主键收敛到同一个 `user_id`。
  - 若这个假设不成立（例如有人手工建了不同 id 的同邮箱用户），外键约束会让登录以 `unknown` 失败，而不是悄悄建立错误身份。
- 平台侧失败（建用户失败、写映射失败）统一归到 `unknown`，不新增错误类别。

## 单测（不需要网络与密钥）

```shell
deno test supabase/functions/tests/
```

测试放 `functions/tests/<函数名>/`（Supabase 官方推荐布局，函数目录只留参与部署的代码），覆盖：微信错误码 → 类别映射（含无法真实构造的 40226 / 45011 / 45009 / -1）、请求体与请求方法边界、缺少服务端配置、响应不泄露密钥与微信原文、类别 → 状态码、派生 id/邮箱的确定性、首登建用户、再登复用、并发撞车（422 / 23505）分支。

## 端到端（需要本地栈，只把微信换成假的）

```shell
cd supabase
STATUS=$(supabase status -o env)
URL=$(printf '%s\n' "$STATUS" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
KEY=$(printf '%s\n' "$STATUS" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
cd ..
SUPABASE_URL="$URL" SUPABASE_SERVICE_ROLE_KEY="$KEY" \
  deno test --allow-net --allow-env supabase/functions/tests/e2e/wechat-login.e2e.ts
```

在真平台（Auth Admin API + PostgREST + 数据库）上验证三件事：首次登录建出用户与映射、再次登录复用且不再调建用户接口、三个并发首登请求最终只有一个用户与一行映射。文件名 `*.e2e.ts` 不匹配 `deno test` 的默认扫描，所以单测命令不会误跑它。

## 约定

- 错误类别的取值集合以迁移 `migrations/*_login_error_code.sql` 为唯一来源；微信错误码 → 类别的映射只存在 `wechat-login/wechat.ts`
- 错误响应 `{ code, message }`，状态码：400 客户端凭证问题 / 403 高风险拦截 / 429 限流 / 500 服务端配置或未知 / 502 微信不可用
- 函数关闭平台前置 JWT 校验（`config.toml` 的 `[functions.wechat-login]`），输入由函数内自行校验
- 类型引用 `../types/database.types.ts`（生成物，不手工编辑）
