// 建单内核的服务端调用（P3 Story 3.2；FR-P3-8；AD-11、AD-12）。
//
// pay-order 是客户端创建订单的唯一入口：本文件只做「把已校验的请求交给包装函数
// create_order_for_user，并把数据库类别带回来」，不复制任何金额 / 归属 / 写库逻辑。
//
// 凭证边界：调用使用服务端密钥客户端（apikey 与 Authorization 均为 service_role，见 index.ts），
// 客户端 JWT 不进入这里——handler 从已验签 JWT 读出 sub 后以 p_user_id 传入。

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../../types/database.types.ts";
import type { OrderErrorCode, PayOrderRequest } from "./contract.ts";

/** 建单结果：成功带回订单对外形状；数据库的业务拒绝带回稳定类别 */
export type CreateOrderOutcome =
  | { ok: true; order: Json }
  | { ok: false; code: OrderErrorCode };

/** 建单调用内部的失败（网络、未知 SQLSTATE、返回形状异常）：由 handler 归为 unknown / internal。 */
export class OrderRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderRpcError";
  }
}

/**
 * 建单器：注入服务端密钥客户端，返回「以 p_user_id 建单」的函数。
 * wire 的可选字段在这里做唯一一次规范化（省略 = 空选择 / 无备注），与内核的缺省语义一致；
 * 数据库的业务拒绝按 PostgREST 标准载荷归一：P0001 + message = 类别值（AD-6、AD-22）；
 * 其余（网络、未知 SQLSTATE、返回形状异常）抛 OrderRpcError，由 handler 记 internal 阶段日志并给 500。
 */
export function createOrderCreator(client: SupabaseClient<Database>) {
  return async function createOrder(
    userId: string,
    request: PayOrderRequest,
  ): Promise<CreateOrderOutcome> {
    const { data, error } = await client.rpc("create_order_for_user", {
      p_user_id: userId,
      p_items: request.items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        selections: item.selections ?? {},
      })) as unknown as Json,
      p_dining_mode: request.dining_mode,
      p_notes: request.notes ?? "",
      p_idempotency_key: request.idempotency_key,
    });

    if (error !== null) {
      // PostgREST 把 raise exception '%', '类别'::order_error_code 转成 P0001 + message = 类别
      if (error.code === "P0001" && isOrderErrorCode(error.message)) {
        return { ok: false, code: error.message };
      }
      throw new OrderRpcError(
        `create_order_for_user failed (${error.code || "no-code"})`,
      );
    }
    if (data === null) {
      throw new OrderRpcError("create_order_for_user returned no order");
    }
    return { ok: true, order: data };
  };
}

/** 类别集合唯一来源是生成类型：Record 写全，枚举新增取值时这里编译报错。 */
const ORDER_ERROR_CODES: Record<OrderErrorCode, true> = {
  invalid_request: true,
  invalid_quantity: true,
  invalid_selection: true,
  product_unavailable: true,
  not_authenticated: true,
  store_unavailable: true,
  invalid_transition: true,
  order_not_found: true,
  invalid_status: true,
  unknown: true,
};

function isOrderErrorCode(value: string): value is OrderErrorCode {
  return Object.prototype.hasOwnProperty.call(ORDER_ERROR_CODES, value);
}
