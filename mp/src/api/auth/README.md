# api/auth — 登录链路与会话（Story 2.4 / 2.5 / 2.6）

小程序端唯一接触会话的地方。上层（composable / 页面）只需要 `getSessionUser()`；
token、持久化、过期判断、续期与失败回退全部封在本目录内（AR-9、AD-14）。

## 文件

| 文件         | 职责                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `index.ts`   | 对外出口：`getSessionUser()`、`authErrorMessage()`；需要身份时内部保证存在有效会话             |
| `config.ts`  | 构建变量 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`，缺失快速失败                   |
| `http.ts`    | `uni.request` 封装；**唯一构造请求头的地方**（apikey 恒带、Authorization 仅按需）；`AuthError` |
| `errors.ts`  | **唯一**的「类别 → 文案」翻译函数；类别取值集合来自数据库枚举 `login_error_code`               |
| `login.ts`   | `uni.login` 取一次性凭证 → 调边缘函数 `wechat-login` → 平台会话                                |
| `session.ts` | 会话状态机：存储恢复、过期判断、单飞续期、刷新凭证失效后的回退重登                             |

## 关键行为

- **惰性登录**：启动时不登录；第一次需要身份时由 `ensureSession()` 静默完成。
- **持久化**：会话 JSON 存在 `uni` 本地存储 `weorder_session`，重启即恢复；每次读取都从存储读，便于开发期在 Storage 面板直接篡改验证。
- **透明续期**：剩余有效期 < 60 秒就先续期（`POST /auth/v1/token?grant_type=refresh_token`），再发原请求；不出现「先失败再重试」。平台开启 refresh token 轮换，续期后保存新的 refresh token。
- **单飞**：同一时刻只有一条「取有效会话」链在飞（模块级 `acquiring`），并发调用等待并复用结果；回退重登也在同一条链上，避免并发触发多次登录。
- **回退重登**：只有刷新凭证失效（平台返回 400 / 401）才清会话并重新静默登录；网络不可达、5xx 等原样上抛，不用登录掩盖。同一 openid 映射同一用户，不会产生第二个身份。
- **错误**：统一抛 `AuthError { code, status, requestId }`；`authErrorMessage()` 是客户端唯一的翻译函数（类别取值来自数据库枚举，未知类别兜底），失败提示只输出文案，不透传服务端 message、堆栈或数据库细节。
- **受保护请求**：`GET /auth/v1/user`（平台当前用户查询），只返回 `{ id }`，不回传完整 user（其中 synthetic email 由 openid 派生）。

## 验证（模拟器，Story 2.4 / 2.5 / 2.6）

前置：本地栈在跑（`supabase start`），`mp/.env.local` 指向本地栈，开发者工具打开「不校验合法域名」。

| #   | 操作                                                                                   | 预期                                                                                    |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | 打开小程序（启动页为身份链路验证）→ 点【验证身份链路】                                 | 显示当前用户 id；Storage 出现 `weorder_session`                                         |
| 2   | 重启小程序（重新编译 / 杀掉重开）→ 再点【验证身份链路】                                | 网络面板**不出现** `wechat-login`（会话已恢复）；返回的用户 id 与步骤 1 相同            |
| 3   | 在 Storage 面板把 `weorder_session` 的 `expiresAt` 改成过去的秒数 → 点【验证身份链路】 | 先出现 1 次 `token?grant_type=refresh_token`，再 1 次 `/auth/v1/user`，成功且无失败请求 |
| 4   | 保持过期状态 → 点【并发验证 ×3】                                                       | 网络面板只有 **1 次**续期，3 次 `/auth/v1/user` 全部成功（单飞）                        |
| 5   | 把 `weorder_session` 的 `refreshToken` 改成无效值 → 点【验证身份链路】                 | 续期失败（400）后自动 `wechat-login` 重新登录，成功且用户 id 与步骤 1 相同              |
| 6   | 真机：同上 1–2（需要真机能访问到本机 Supabase）                                        | 会话在真机本地存储同样持久化                                                            |
| 7   | 点【三类失败文案自检】                                                                 | 三行文案互不相同：网络不可用 / 操作太频繁 / 登录凭证已失效                              |
| 8   | 清掉 `weorder_session` → `supabase stop` → 点【验证身份链路】                          | 显示「网络不可用，请检查网络后重试」+ 类别 `network_unreachable`；**没有请求标识**（请求没到服务端） |
| 9   | `supabase start` → 再点【验证身份链路】                                                | 重试成功；用户 id 与步骤 1 相同（不产生第二个身份，不留半登录状态）                     |
| 10  | 服务端日志（`invalid_code`）：见 `supabase/functions/wechat-login/README.md` 的日志一节  | curl 一个假 code 得到 400，页面/终端拿到的请求标识能在 `docker logs` 里对到同一条记录   |

> 注意：`supabase stop` 会重建容器，旧日志随容器消失；`network_unreachable` 永远不会到服务端，服务端日志只覆盖请求到达后的失败。

## 验证记录

> 只做简单记录；Phase 2 结束后验证页（`pages/auth-check/`）会删除，本 README 的验证部分一并清理。

- 2026-09-21 模拟器（微信开发者工具）：通过（步骤 1–5：登录、重启恢复、透明续期、单飞、回退重登）
- 2026-09-21 真机：通过（登录与会话恢复；本机需 Windows 端口转发，见当日环境配置）
- 2026-09-21 模拟器（微信开发者工具）：通过（Story 2.6 步骤 7–9：三类失败文案互不相同、断网提示「网络不可用」、重启后重试成功且用户 id 不变）
- 2026-09-21 服务端日志：通过（`deno task test` 20/20；curl 假 code 得到 400 `invalid_code`，响应头请求标识与 `docker logs` 记录一致）

## Phase 3 收口

- 其他 `api/` 模块的受保护请求接入本目录（请求头只在这里构造）。
- 提示界面（toast/弹窗）按 Phase 3 设计接入 `authErrorMessage()`；文案表调整只改 `errors.ts`。
- 已知边界：本地判定未过期、但服务端拒绝访问凭证（401）时，现有实现会复用该会话、重试不恢复；Phase 3 会话层一并处理。
- 临时验证页 `pages/auth-check/` 与本 README 的验证步骤一并清理。
