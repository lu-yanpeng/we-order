# core/realtime — Realtime 订阅适配（Story 5.1）

Supabase Realtime 自适配的客户端基础设施：基于公开的 Phoenix 协议，用 `uni.connectSocket`
提供传输层，只订阅本人订单的 `INSERT` / `UPDATE`，断线自动重连（退避 + 上限），订阅失败
对用户静默。**唯一 SDK 例外**：单独使用 `@supabase/realtime-js` 的 transport 扩展点
（不引 `supabase-js` 与社区适配库，FR-P3-15 / NFR-P3-4）。

## 文件

| 文件                | 职责                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`          | 对外出口：`openChannel(spec)`；只允许 `api/` 引用（AD-1）                                                                                                                                 |
| `url-shim.ts`       | 最小 `URL` 垫片与 `withUrlShim()`：在客户端 / channel 构造点临时替换宿主 `URL`（只读写 `protocol` / `pathname` / `href`）；微信宿主拒绝改写全局，实际修复由依赖补丁承担（见「依赖说明」） |
| `socket-adapter.ts` | `uni.connectSocket` → `WebSocketLike` 适配器：事件映射、`readyState`、`send` / `close`，建连 error 无 close 时补发                                                                        |
| `client.ts`         | 唯一接触 realtime-js 的文件：构造客户端、注入适配器、收窄为 `RealtimeClientPort`                                                                                                          |
| `subscription.ts`   | 编排：单客户端 + 单活跃 channel、幂等订阅 / 退订、会话等待与凭证同步、重连上限与看门狗                                                                                                    |
| `types.ts`          | 内部类型与端口（测试注入假件用；不对外）                                                                                                                                                  |
| `log.ts`            | 固定前缀 `[realtime]` 开发期日志（不含凭证与载荷）                                                                                                                                        |

## 用法（api/ 层）

```ts
// api/orders.ts（无状态工厂；形状见 AD-9；onEvent 为 Story 5.2 的加法型扩展）
export function subscribeOrders(options: OrderSubscriptionOptions): RealtimeSubscriptionHandle {
  return openChannel({
    key: 'orders:list', // 或 `orders:<id>`（同键幂等复用）
    topic: 'orders',
    resolveUserId: getUserId, // 本人 id 取值：经 api/ 传入（core 不自己发明身份）
    bindingFor: (userId) => [
      { event: 'INSERT', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
    ],
    onEvent: options.onEvent, // 推送只作触发信号：由刷新编排触发一次服务端读取（AD-7）
  })
}
```

页面 / Composable 只消费句柄：`unsubscribe()`（幂等）与 `onStatus(cb)`（注册时立即回调当前
状态、之后只在转移时回调）；推送触发回调经订阅入口的可选 `onEvent` 传入、不携带原始行。
**推送只作触发信号**：使用方（`composables/use-order-status.ts` 的 `bindSubscription`）
把订阅状态翻译为刷新策略——`subscribed` → 先补读一次再停轮询、其余状态回退 5s 轮询；
推送 → 立即读取一次，与轮询共享同一状态应用路径（AD-7；Story 5.2）。

## 关键行为

- **依赖方向**：`core/realtime → core/session`（凭证、本人标识、凭证变更通知）与
  `core/realtime → core/transport`（项目地址 / 发布密钥的配置读取，不发请求）；
  上层不可直接 import 本目录。
- **单活跃**：同一时刻只允许一个订阅（列表与详情互斥的兜底）；同键重复 `openChannel` 幂等复用，
  不同键会替换旧订阅并移除旧 channel。
- **会话**：订阅前 `ensureSession()` 等待（不阻塞页面）；会话未就绪 → 状态 `unavailable`，
  登录 / 重登成功后自动补订；续期成功后 `setAuth` 同步最新凭证（连接与心跳也经 `accessToken`
  回调取最新值，双保险）。
- **连接**：`supabaseUrl()` 的 http(s) 换 ws(s) + `/realtime/v1`；`apikey` 走查询参数，
  `access_token` 走 `phx_join` 载荷；心跳 25s；断线由 realtime-js 退避重连（1/2/5/10s，之后每 10s）。
- **上限**：连续失败 5 次（约 20~30s 无一次成功；挂起的重连尝试由 20s 看门狗兜底计一次失败）
  即放弃、状态 `unavailable`、断开客户端；下次进入可见域重新订阅。看门狗 20s：状态停在
  `connecting` 时计一次失败并重建 channel。
- **状态**：`connecting | subscribed | unavailable`（`types/realtime.ts`）；订阅失败不抛异常、
  不产出错误类别、对用户静默；开发期看 `[realtime]` 前缀日志观察连接 / 订阅 / 退订 / 回退 / 恢复。
- **归属**：filter 不构成归属判定，RLS 是唯一裁决（两个身份隔离验证属 Story 5.3）。

## 真机注意（PoC 第一验证点）

开发者工具与真机的宿主 `URL` 形态都可能不兼容（实测：工具里抛 `URL is not a constructor`）；
库内 `new URL` 调用已由依赖补丁移除（见「依赖说明」），`withUrlShim()` 作为构造点兼容层保留。
真机冒烟仍要做——宿主形态与网络路径不一定相同。
真机需开发版打开调试模式（域名校验绕过方式见 `docs/phase-3/addendum.md` §A / §F）。
订阅能成功还要求 `public.orders` 已加入 `supabase_realtime` publication（Story 5.3 正式入仓；
5.1 冒烟前可临时执行 `alter publication supabase_realtime add table public.orders;`，
**应用后需重启 `supabase_realtime` 容器**才会拾取变更流）。

## 依赖说明

- `@supabase/realtime-js@2.117.1`：唯一 SDK 例外（只用 transport 扩展点）。
- `@supabase/phoenix@0.4.5`：**显式直依赖**——uni 构建链固定 `preserveSymlinks: true`
  （`@dcloudio/uni-cli-shared/dist/resolve.js`），pnpm 隔离布局下 realtime-js 的该传递依赖
  无法被 Rollup 解析；版本与其要求一致、pnpm 去重为单实例，移除会重新出现构建失败。
- **pnpm patch**（`mp/patches/@supabase__realtime-js@2.117.1.patch`，登记在 `pnpm-workspace.yaml`
  的 `patchedDependencies`）：把库内 `httpEndpointURL` 的 `new URL` 调用改为内联解析（语义一致；
  该函数只服务 broadcast 端点，但会在客户端 / channel 构造时执行）。微信宿主既不提供可构造的
  `URL`、也拒绝改写全局（实测 `URL is not a constructor`），构造点的 `withUrlShim()` 垫片在该宿主
  无效——**补丁才是实际修复**；升级该依赖时必须重做 / 验证补丁，否则构建或真机会再次失败。

## 测试

`cd mp && pnpm test`：URL 垫片解析与安装条件、适配器事件映射与 close 兜底、
编排的幂等 / 单活跃 / 失败上限 / 会话等待 / 凭证同步 / 看门狗（全部注入假件，不依赖网络）。
