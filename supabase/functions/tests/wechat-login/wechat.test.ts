import { assertEquals } from "jsr:@std/assert@^1.0.0";

import type { ServerLoginErrorCode } from "../../wechat-login/errors.ts";
import { exchangeCode, type FetchLike } from "../../wechat-login/wechat.ts";

const CONFIG = { appId: "wx-test-app", appSecret: "test-secret" };

function fetchReturning(payload: unknown): FetchLike {
  return () => Promise.resolve(Response.json(payload));
}

Deno.test("微信错误码 → 错误类别", async (t) => {
  const cases: Array<[number, ServerLoginErrorCode]> = [
    [40013, "invalid_app_id"],
    [40125, "invalid_app_secret"],
    [40029, "invalid_code"],
    [40163, "code_expired_or_used"],
    [42003, "code_expired_or_used"],
    [40226, "risky_user_blocked"],
    [45011, "rate_limited"],
    [45009, "rate_limited"],
    [-1, "wechat_unavailable"],
  ];

  for (const [errcode, expected] of cases) {
    await t.step(`errcode ${errcode} → ${expected}`, async () => {
      const result = await exchangeCode("code-1", {
        ...CONFIG,
        fetchFn: fetchReturning({ errcode, errmsg: "微信错误原文" }),
      });
      assertEquals(result, { ok: false, code: expected });
    });
  }
});

Deno.test("未映射的错误码落到 unknown", async () => {
  const result = await exchangeCode("code-1", {
    ...CONFIG,
    fetchFn: fetchReturning({ errcode: 99999, errmsg: "微信错误原文" }),
  });
  assertEquals(result, { ok: false, code: "unknown" });
});

Deno.test("换取成功返回 openid，不回传 session_key", async () => {
  const result = await exchangeCode("code-1", {
    ...CONFIG,
    fetchFn: fetchReturning({ openid: "o-abc", session_key: "session-key" }),
  });
  assertEquals(result, { ok: true, openid: "o-abc" });
});

Deno.test("errcode 为 0 且有 openid 时按成功处理", async () => {
  const result = await exchangeCode("code-1", {
    ...CONFIG,
    fetchFn: fetchReturning({ errcode: 0, openid: "o-abc" }),
  });
  assertEquals(result, { ok: true, openid: "o-abc" });
});

Deno.test("请求形状：appid / secret / js_code / grant_type", async () => {
  let capturedUrl = "";
  const fetchFn: FetchLike = (input) => {
    capturedUrl = String(input);
    return Promise.resolve(Response.json({ openid: "o-abc" }));
  };

  await exchangeCode("code-1", { ...CONFIG, fetchFn });

  const requested = new URL(capturedUrl);
  assertEquals(requested.origin, "https://api.weixin.qq.com");
  assertEquals(requested.pathname, "/sns/jscode2session");
  assertEquals(requested.searchParams.get("appid"), CONFIG.appId);
  assertEquals(requested.searchParams.get("secret"), CONFIG.appSecret);
  assertEquals(requested.searchParams.get("js_code"), "code-1");
  assertEquals(requested.searchParams.get("grant_type"), "authorization_code");
});

Deno.test("微信不可达 → wechat_unavailable", async () => {
  const result = await exchangeCode("code-1", {
    ...CONFIG,
    fetchFn: () => Promise.reject(new Error("connect timeout")),
  });
  assertEquals(result, { ok: false, code: "wechat_unavailable" });
});

Deno.test("微信返回非 JSON → unknown", async () => {
  const result = await exchangeCode("code-1", {
    ...CONFIG,
    fetchFn: () => Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502 })),
  });
  assertEquals(result, { ok: false, code: "unknown" });
});
