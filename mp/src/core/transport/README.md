# core/transport — 唯一请求通道（Story 1.2）

客户端所有业务后端访问（REST / RPC / 边缘函数）的唯一出口。页面与 Composable 不得直接
发起网络请求；`api/` 方法在这里定义 alova Method 并导出（AD-3、AD-5）。

## 文件

| 文件             | 职责                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `index.ts`       | 对外出口：`transport`（业务通道）、`rawTransport`（裸通道）、`registerSessionProvider`；只允许 `api/` 引用 |
| `instance.ts`    | alova 实例与全部拦截器（请求头、错误归一接线、会话续期重放）                                               |
| `headers.ts`     | **全仓唯一**的请求头构造（apikey 恒带、按需 Authorization、有体才带 Content-Type）                         |
| `normalize.ts`   | **全仓唯一**的错误归一表（原始失败 → `AppError`，纯函数、可单测）                                          |
| `error-codes.ts` | 服务端类别的运行时允许清单 + 与生成枚举的编译期穷尽检查                                                    |
| `provider.ts`    | 会话插槽：`SessionProvider` 类型与 `registerSessionProvider()`                                             |
| `meta.ts`        | `TransportMeta`（api/ 方法在 `config.meta` 里声明的身份要求）                                              |
| `config.ts`      | 构建变量 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`                                             |

## 用法（api/ 方法，Story 2.1 起）

```ts
import { transport } from '@/core/transport'

// 目录：anonymous —— 不等待会话、不附 Authorization
export function fetchCategories() {
  return transport.Get<MenuCategory[]>('/rest/v1/menu', { meta: { auth: 'anonymous' } })
}

// 订单 / 支付：session-required —— 先会合会话，再附 Authorization
export function fetchOrders() {
  return transport.Get<OrdersPage>('/rest/v1/rpc/get_my_orders', {
    meta: { auth: 'session-required' },
  })
}
```

- 返回的是 alova Method（Promise）；Composable 可 `await`，也可用 `useRequest` / `useWatcher` 包裹。
- 未声明 `meta` 时按 `anonymous` 处理；订单 / 支付方法**必须**显式声明 `session-required`。
- 失败一律是 `AppError`（`types/errors.ts`）；文案用 `utils/error-copy.ts` 翻译，transport 不做文案。

## 关键行为

- **唯一请求头**：`apikey` 恒带发布密钥（恒不放入 Authorization）；`session-required` 才附访问凭证。
- **实例级强制**：`cacheFor: null`、`shareRequest: false`——不缓存、不共享请求；方法作者不得依赖默认值。
- **错误归一**：非 2xx 与 `uni.request` fail 都归一为 `AppError`；会话类（401 / `PGRST301` /
  `not_authenticated`）先经 provider 续期并**只重放一次**，恢复失败 → `client.session_expired`；
  `42501` 是权限拒绝、不是会话问题（不触发续期）。
- **依赖反转**：transport 不 import `core/session`；session 在装载时用 `registerSessionProvider()`
  注入「取凭证 / 会合会话 / 强制恢复」三个动作（唯一调用方 `core/session`）。
- **裸通道** `rawTransport`：不等待会话、不续期、不重放，凭证经 `meta.accessToken` 显式传入；
  仅供 `core/session` 调平台 auth 端点与 `wechat-login`。
- **超时**：默认 10s（`timeoutMs` 可覆盖），归入 `client.timeout`。

## 会话注册现状（Story 1.3 起）

`core/session` 已落地并在装载时注册 provider：会话持久化、单飞续期、主动续期与回退重登
全部封在会话模块内（见 `core/session/README.md`）；传输侧只做「请求前取凭证、401 时调用
续期并重放一次」。`api/auth.ts` 是会话门面，页面 / Composable 不直接接触本目录。

## 测试

`cd mp && pnpm test`：归一表逐行、文案穷尽与敏感信息、伪 provider 断言「只重放一次 / 二次失败归一」，
并用 stub 的 `uni.request` 跑真实 alova 实例（请求头、401 重放、分域归一、传输失败）。
