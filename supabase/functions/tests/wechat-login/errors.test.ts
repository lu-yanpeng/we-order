import { assertEquals } from "jsr:@std/assert@^1.0.0";

import { errorResponse, type ServerLoginErrorCode } from "../../wechat-login/errors.ts";

// 服务端会返回的每一个类别 → 约定的 HTTP 状态码
const CASES: Array<[ServerLoginErrorCode, number]> = [
  ["invalid_app_id", 500],
  ["invalid_app_secret", 500],
  ["invalid_code", 400],
  ["code_expired_or_used", 400],
  ["risky_user_blocked", 403],
  ["rate_limited", 429],
  ["wechat_unavailable", 502],
  ["unknown", 500],
];

Deno.test("类别 → 状态码与响应形状（{ code, message }）", async (t) => {
  for (const [code, status] of CASES) {
    await t.step(`${code} → ${status}`, async () => {
      const response = errorResponse(code);

      assertEquals(response.status, status);

      const body = await response.json();
      assertEquals(Object.keys(body).sort(), ["code", "message"]);
      assertEquals(body.code, code);
      assertEquals(typeof body.message, "string");
    });
  }
});
