// wechat-login 的请求契约：类型与运行时校验的**唯一来源**（P2 Story 2.1；P3 维护改造 2026-09-28）。
//
// 与 `pay-order/contract.ts` 同形：zod schema 即类型（`z.infer`）即运行时校验。
// 语义：
//   - `code` 必填字符串；首尾空白在发送给微信前裁掉（2026-09-28 Ly 裁定，方案 B），空白串视为缺参；
//   - 未知字段默认剥离（忽略语义不变）；
//   - 本函数只有一个必填字段、失败类别唯一，解析结果不带类别映射（handler 固定归 invalid_request）。

import { z } from "npm:zod@4";

const wechatLoginRequestSchema = z.object({
  /** 小程序 wx.login 的一次性凭证；首尾空白裁掉后再交给微信（空白串视为缺参） */
  code: z.string().trim().min(1),
});

/** 请求体（wire）：wechat-login 接受的唯一形状 */
export type WechatLoginRequest = z.infer<typeof wechatLoginRequestSchema>;

/** 解析结果：成功给出类型化的请求体；失败由 handler 固定归 invalid_request */
export type WechatLoginParseResult =
  | { ok: true; request: WechatLoginRequest }
  | { ok: false };

/** 解析并校验请求体（边界唯一实现） */
export function parseWechatLoginRequest(body: unknown): WechatLoginParseResult {
  const parsed = wechatLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, request: parsed.data };
}
