// HTTP 层：调用者身份读取、模拟支付、建单与错误归一（P3 Story 3.2；AD-11、AD-17）。
//
// 请求体形状与校验在 `contract.ts`（zod schema 即类型）；本层不再重复分支校验。
// 承载契约：成功 200 + 订单对外形状原样（不加信封、不改字段名）；失败非 2xx + { code, message }
// （类别复用 order_error_code，业务拒绝 4xx、内部故障 5xx），所有响应带 x-request-id。
// 非 2xx 记一条结构化日志：只带类别、状态、阶段与请求标识，不带堆栈、密钥或数据库细节（NFR3）。

import { callerUserId } from "./caller.ts";
import {
  type OrderErrorCode,
  parsePayOrderRequest,
  type PayOrderRequest,
} from "./contract.ts";
import type { CreateOrderOutcome } from "./order.ts";

/** 失败发生在哪一步（日志用，便于定位） */
export type PayOrderFailureStage = "request" | "auth" | "order" | "internal";

/** 关键失败日志：只带类别、状态、阶段与请求标识（NFR3） */
export type PayOrderFailureLog = {
  event: "pay_order_failed";
  requestId: string;
  code: OrderErrorCode;
  status: number;
  stage: PayOrderFailureStage;
};

export type PayOrderDeps = {
  /** 建单：以调用者用户 id 与已校验的请求体调服务端接缝（order.ts） */
  createOrder: (
    userId: string,
    request: PayOrderRequest,
  ) => Promise<CreateOrderOutcome>;
  /** 关键失败日志出口；缺省不记（离线脚本可省略） */
  log?: (record: PayOrderFailureLog) => void;
};

/** 类别 → HTTP 状态：客户端只认 2xx / 非 2xx，状态码是给人看的语义；Record 写全，枚举新增时编译报错。 */
const errorStatus: Record<OrderErrorCode, number> = {
  invalid_request: 400,
  invalid_quantity: 400,
  invalid_selection: 409, // 与当前目录状态冲突（规格已变更）
  product_unavailable: 409, // 售罄 / 下架 / 商品不存在
  not_authenticated: 401, // 正常不该出现（平台已验签）；出现即 fail-closed
  store_unavailable: 503, // 服务端配置问题
  invalid_transition: 409, // 以下三种不会由 pay-order 产生，为枚举完备保留
  order_not_found: 404,
  invalid_status: 409,
  unknown: 500, // 未归类 / 内部故障
};

/** 类别 → 给人看的文案：不是契约（客户端按类别翻自己的文案），不含内部细节 */
const errorMessages: Record<OrderErrorCode, string> = {
  invalid_request: "Request body does not match the pay-order contract",
  invalid_quantity: "Item quantity must be a positive integer",
  invalid_selection: "Spec selections are invalid or out of date",
  product_unavailable: "Product is sold out or delisted",
  not_authenticated: "Session is missing or invalid",
  store_unavailable: "Store is temporarily unable to accept orders",
  invalid_transition: "Operation is not allowed in the current state",
  order_not_found: "Order does not exist",
  invalid_status: "Operation is not supported by the current order status",
  unknown: "Could not create the order",
};

function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
    },
  });
}

export async function handleRequest(
  req: Request,
  deps: PayOrderDeps,
): Promise<Response> {
  // 请求标识：随响应头返回，客户端可用来与服务端日志对账（Story 2.6 同款）
  const requestId = crypto.randomUUID();

  const errorResponse = (
    code: OrderErrorCode,
    stage: PayOrderFailureStage,
    status: number = errorStatus[code],
    message: string = errorMessages[code],
  ): Response => {
    deps.log?.({
      event: "pay_order_failed",
      requestId,
      code,
      status,
      stage,
    });
    return jsonResponse({ code, message }, status, requestId);
  };

  if (req.method !== "POST") {
    return errorResponse("invalid_request", "request", 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_request", "request");
  }

  // 身份：平台已验签（verify_jwt = true），这里只读声明；匿名 key 一类被 callerUserId 挡住
  const userId = callerUserId(req.headers.get("Authorization"));
  if (userId === null) {
    return errorResponse("not_authenticated", "auth");
  }

  // 请求体：契约（zod schema）是唯一形状来源；未知字段被剥离，类别由契约给出
  const parsed = parsePayOrderRequest(body);
  if (!parsed.ok) {
    return errorResponse(parsed.code, "request");
  }

  let outcome: CreateOrderOutcome;
  try {
    // 模拟支付：本阶段恒成功。真实微信支付的单一替换接缝——将来的预下单 / 客户端二次授权
    // / 服务端回调只替换 simulatePayment 及其后续编排，下游建单路径不变。
    await simulatePayment();
    outcome = await deps.createOrder(userId, parsed.request);
  } catch {
    // 连不上数据库、返回形状异常等：只给稳定类别，不带任何内部细节（NFR3）
    return errorResponse("unknown", "internal");
  }

  if (!outcome.ok) {
    return errorResponse(outcome.code, "order");
  }
  // 成功：订单对外形状原样返回（不加信封、不改字段名）；语义 = 创建成功才返回支付成功
  return jsonResponse(outcome.order, 200, requestId);
}

/** 模拟支付：恒成功的空操作（本阶段不接真实支付渠道、不建支付记录实体与状态机）。 */
function simulatePayment(): Promise<void> {
  return Promise.resolve();
}
