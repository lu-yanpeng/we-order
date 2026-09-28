// pay-order 的请求契约：类型与运行时校验的**唯一来源**（P3 Story 3.2；AD-11、AD-17）。
//
// 这里是「请求体长什么样」的一等公民：读 schema 即可知道该传什么（与客户端镜像
// `mp/src/types/api-contracts.ts` 的 `CreateOrderRequest` 是同一份 wire 形状的两端）。
// 校验用 zod：schema 即类型（`z.infer`）即运行时校验，风格对齐 FastAPI 的请求体模型。
//
// 语义（与 Ly 2026-09-28 收敛一致）：
//   - 未知字段：默认剥离（zod object 的默认行为）——不参与任何判定、也不会转发给数据库；
//   - 必填缺失 / 类型不对 → invalid_request；数量不是正整数 → invalid_quantity（按首个失败字段定类别）；
//   - 不做类型强转（"2" 不是数字）；长度、可售、规格有效性与金额等业务规则不在这里——内核是唯一权威。

import { z } from "npm:zod@4";
import type { Database } from "../../types/database.types.ts";

/** 服务端类别：取值集合唯一来源是数据库枚举（客户端按类别翻自己的文案） */
export type OrderErrorCode = Database["public"]["Enums"]["order_error_code"];

type DiningMode = Database["public"]["Enums"]["dining_mode"];

/** 规格选择（P2 AD-22 唯一形状）：规格组 id → 选项 id（单选）/ 选项 id 数组（多选） */
export type SpecSelections = Record<string, string | string[]>;

const DINING_MODES = ["dinein", "takeout"] as const;

// 数据库枚举新增取值时这里编译报错（与 mp 的 ContractDriftChecks 同一思路）
type MissingDiningMode = Exclude<DiningMode, (typeof DINING_MODES)[number]>;
const _diningModesExhaustive: MissingDiningMode extends never ? true : never =
  true;

const specSelectionsSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]),
);

const payOrderItemSchema = z.object({
  product_id: z.string().min(1),
  // 契约是数字：不做类型强转（"2" 不接受）；内核会认字符串，但边界只认一种真相
  quantity: z.number().int().positive(),
  /** 省略 = 该商品没有规格组（内核按空选择处理） */
  selections: specSelectionsSchema.optional(),
});

const payOrderRequestSchema = z.object({
  items: z.array(payOrderItemSchema).min(1),
  dining_mode: z.enum(DINING_MODES),
  /** 省略 / null = 无备注（内核会归一为「无备注要求」） */
  notes: z.string().nullish(),
  /** 必填（AD-10）；trim 与内核的 btrim 对齐 */
  idempotency_key: z.string().trim().min(1),
});

/** 请求条目：只有商品引用、数量与规格选择（不含展示字段与任何金额字段） */
export type PayOrderItem = z.infer<typeof payOrderItemSchema>;

/** 请求体（wire）：pay-order 接受的唯一形状 */
export type PayOrderRequest = z.infer<typeof payOrderRequestSchema>;

/** 解析结果：成功给出类型化的请求体；失败给出稳定类别（不是 zod 的错误文案） */
export type PayOrderParseResult =
  | { ok: true; request: PayOrderRequest }
  | { ok: false; code: OrderErrorCode };

/**
 * 解析并校验请求体（边界唯一实现）。
 * 类别映射：首个失败字段是 quantity → invalid_quantity；其余 → invalid_request。
 * zod 的 issues 顺序确定，同一请求同一结果（不用文案做判定）。
 */
export function parsePayOrderRequest(body: unknown): PayOrderParseResult {
  const parsed = payOrderRequestSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssuePath = parsed.error.issues[0]?.path ?? [];
    const code = firstIssuePath.at(-1) === "quantity"
      ? "invalid_quantity"
      : "invalid_request";
    return { ok: false, code };
  }
  return { ok: true, request: parsed.data };
}
