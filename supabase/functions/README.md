# supabase/functions

| 函数 | 作用 |
| --- | --- |
| `wechat-login/` | 登录换取：用 `wx.login` 的一次性凭证向微信换取 OpenID（Story 2.1 只返回 openid，不创建用户） |

## 密钥

AppSecret 只来自服务端运行环境，仓库与客户端里都不出现（AR-5）。

```shell
cd supabase/functions
cp .env.example .env   # 填 WECHAT_APP_ID / WECHAT_APP_SECRET；.env 已被 gitignore
```

云端用平台 secret：`supabase secrets set WECHAT_APP_ID=... WECHAT_APP_SECRET=...`（名字不以 `SUPABASE_` 开头）。

## 本地运行与冒烟

```shell
cd supabase
supabase functions serve wechat-login --env-file functions/.env
```

另开一个终端：

```shell
# 凭证无效：AppID / AppSecret 正确，code 随便给
curl -i -X POST http://127.0.0.1:54321/functions/v1/wechat-login \
  -H 'Content-Type: application/json' -d '{"code":"whatever"}'
# → 400 {"code":"invalid_code","message":"登录凭证无效"}

# AppID 无效 / 密钥无效：把 env 文件里的值故意改错，重启服务后同样调用
# → 500 {"code":"invalid_app_id",...} / 500 {"code":"invalid_app_secret",...}
```

「凭证过期或已用」（40163 / 42003）需要真实的一次性凭证用两次才能构造，留到真机验证（Story 2.5）。

## 单测

一条命令，不需要网络、不需要密钥：

```shell
deno test supabase/functions/tests/
```

测试放 `functions/tests/<函数名>/`（Supabase 官方推荐布局，函数目录只留参与部署的代码），覆盖：微信错误码 → 类别映射（含无法真实构造的 40226 / 45011 / 45009 / -1）、请求体边界、非 POST、缺少服务端配置、响应不泄露密钥与微信原文、类别 → 状态码。

## 约定

- 错误类别的取值集合以迁移 `migrations/*_login_error_code.sql` 为唯一来源；微信错误码 → 类别的映射只存在 `wechat-login/wechat.ts`
- 错误响应 `{ code, message }`，状态码：400 客户端凭证问题 / 403 高风险拦截 / 429 限流 / 500 服务端配置或未知 / 502 微信不可用
- 函数关闭平台前置 JWT 校验（`config.toml` 的 `[functions.wechat-login]`），输入由函数内自行校验
