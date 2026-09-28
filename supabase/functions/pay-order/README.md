# pay-order 边缘函数

客户端创建订单的**唯一入口**（P3 Story 3.2；FR-P3-8；AD-11、AD-12）。一次调用完成：

```
平台先验签（verify_jwt = true；凭证无效直接 401）
  → 从已验签 JWT 读出用户 id（sub）
  → 校验请求形状（解构取值 + 校验合法性；多余字段忽略且不转发）
  → 模拟支付（本阶段恒成功；真实微信支付的单一替换接缝）
  → 服务端密钥调用 create_order_for_user（归属 = sub；金额 / 订单号 / 取杯号全由服务端产出）
  → 创建成功才返回支付成功（订单对外形状原样）；失败返回稳定类别
```

- 客户端没有任何绕过本接口的建单路径：`create_order` 与 `create_order_for_user` 均对客户端角色
  收回 EXECUTE（直呼 → `42501`，见 Story 3.1）。
- 不建立支付记录实体与支付状态机；不含任何真实支付渠道代码。将来接真实微信支付时，
  只替换 `handler.ts` 的 `simulatePayment()` 及其后续编排（预下单 / 客户端二次授权 / 回调），
  下游建单路径不变。
- 本函数不 import 其他边缘函数：部署只打包函数自身目录，跨目录相对导入会在部署时失效。

## 请求

```
POST /functions/v1/pay-order
apikey: <发布密钥>
Authorization: Bearer <当前会话访问凭证>
Content-Type: application/json

{
  "items": [
    { "product_id": "<商品 uuid>", "quantity": 1, "selections": { "<规格组 id>": "<选项 id>" } }
  ],
  "dining_mode": "dinein",
  "notes": "",
  "idempotency_key": "<一次结算意图的幂等键>"
}
```

- 请求形状与校验的**唯一来源**是 [`contract.ts`](./contract.ts)（zod schema 即类型，导出 `PayOrderRequest` /
  `PayOrderItem`，解析函数 `parsePayOrderRequest`）；下面的说明是它的文字版，契约以代码为准。
  读 schema 即可知道要传什么参数（对齐 FastAPI 的请求体模型）。
- `selections` 形状 = 规格组 id → 选项 id（单选）/ 选项 id 数组（多选）；没有规格组的商品传 `{}`。
- 幂等键必填，且必须由客户端在「一次结算意图」内保持稳定（重试复用同一键；生命周期见 AR-P3-15）。
- **不接受 camelCase**：字段名以本契约为准，`diningMode` 这类键读不到值，等同于缺少必填字段（400）。
- **金额与用户标识没有入口**：`total_amount` / `unit_price` / `user_id` 等字段一律忽略，
  不参与任何判定、也不会发给数据库；金额以服务端按库内价格重算为准，归属恒取自会话身份。
- 多余字段忽略不报错（zod object 默认剥离，即 FastAPI 式的 `extra="ignore"`）：请求里混入展示字段不影响结果。

## 成功响应（200）

体 = `create_order_for_user` 返回的订单对外形状（`order_result_json`）**原样**，不加信封、不改字段名：

```json
{
  "id": "<订单 uuid>",
  "order_number": "<18 位订单号>",
  "status": "cooking",
  "dining_mode": "dinein",
  "packaging_fee": 0,
  "total_amount": 28.00,
  "notes": "无备注要求",
  "pickup_code": "A-0001",
  "created_at": "2026-09-28 12:00:00"
}
```

- 语义 = **创建成功才返回支付成功**；客户端以 HTTP 状态判别成功 / 失败。
- 所有响应（含成功）都带 `x-request-id` 响应头。

## 失败响应（非 2xx）

```json
{ "code": "<order_error_code>", "message": "<给人看的文案>" }
```

`code` 取值以数据库枚举 `public.order_error_code` 为唯一来源（随类型契约生成到客户端）；
文案不是契约。业务拒绝 4xx、内部故障 5xx：

| code | HTTP | 含义 |
| --- | --- | --- |
| `invalid_request` | 400 / 405 | 请求形状不合法（缺必填、类型不对；405 = 非 POST） |
| `invalid_quantity` | 400 | 数量不是正整数 |
| `invalid_selection` | 409 | 规格选择与当前目录不一致 |
| `product_unavailable` | 409 | 商品售罄 / 下架 / 不存在 |
| `not_authenticated` | 401 | 身份缺失（正常不该出现：平台已验签；出现即 fail-closed） |
| `store_unavailable` | 503 | 门店配置异常（服务端问题） |
| `order_not_found` / `invalid_status` / `invalid_transition` | 404 / 409 | 本接口不产生，为枚举完备保留 |
| `unknown` | 500 | 未归类错误、数据库不可达、返回形状异常 |

平台层的 401（未提交任何凭证 / 凭证无效，函数不执行）发生在函数之前，不经过本函数、也不产生订单。
实测补充：只带 `apikey`（发布密钥）而不带会话时，平台会以该 JWT 放行到函数，由函数 fail-closed 返回
401 `not_authenticated`（发布密钥不是用户会话）——两种情况都不产生订单。

## 身份与凭证边界

- 用户 id 只来自**平台已验签 JWT 的 `sub`**：函数内不重复验签、不请求 auth 服务；
  `role` 必须是 `authenticated` 且 `sub` 是合法 UUID，否则 401 且不触碰数据库（发布密钥
  `anon key` 也是有效 JWT，但没有 sub、角色是 anon，同样被拒）。
- 调 `create_order_for_user` 使用**服务端密钥**（`apikey` 与 `Authorization` 都是 `service_role`）；
  客户端 JWT 绝不转发给包装函数调用，请求体不存在用户标识参数。
- 服务端密钥只在边缘函数运行环境（平台注入），不入仓、不到客户端。

## 请求标识与日志

- 每个请求生成请求标识（UUID），所有响应随响应头 `x-request-id` 返回；客户端把它挂在
  `AppError.requestId` 上，失败提示可带它用于对账。
- 每个非 2xx 输出一行结构化日志（只含类别、状态、阶段与请求标识，不含密钥、堆栈、数据库细节）：

  ```json
  {"event":"pay_order_failed","requestId":"...","code":"product_unavailable","status":409,"stage":"order"}
  ```

  `stage` 取 `request` / `auth` / `order` / `internal`，用于定位失败发生在哪一步。
- 本地查看：`docker logs -f supabase_edge_runtime_we-order`。

## 测试与本地验证

- 离线单元测试：`cd supabase && deno task test`（假建单器 / 假 fetch，不需要网络与本地栈）。
- 现场链路验证（需要 `supabase start`，边缘函数由本地栈统一服务）：
  `cd supabase && deno task verify:pay-order`。

  手动冒烟（本地栈在跑）：

  ```bash
  # 无会话 → 平台 401，函数不执行
  curl -i -X POST http://127.0.0.1:54321/functions/v1/pay-order \
    -H 'Content-Type: application/json' -d '{}'
  ```

  带真实会话的完整请求构造见 `supabase/scripts/verify-pay-order.ts`（含测试用户创建与清理）。
