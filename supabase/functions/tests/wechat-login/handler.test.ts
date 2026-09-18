import { assertEquals } from "jsr:@std/assert@^1.0.0";

import { createWechatLoginHandler, type WechatLoginConfig } from "../../wechat-login/handler.ts";
import type { FetchLike } from "../../wechat-login/wechat.ts";

const ENDPOINT = "http://127.0.0.1:54321/functions/v1/wechat-login";
const APP_ID = "wx-test-app";
const APP_SECRET = "test-secret";
const CONFIG: WechatLoginConfig = { appId: APP_ID, appSecret: APP_SECRET };

function post(body: unknown): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fetchReturning(payload: unknown): FetchLike {
  return () => Promise.resolve(Response.json(payload));
}

Deno.test("换取成功：返回 openid", async () => {
  const handler = createWechatLoginHandler({
    ...CONFIG,
    fetchFn: fetchReturning({ openid: "o-abc", session_key: "session-key" }),
  });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { openid: "o-abc" });
});

Deno.test("凭证无效：微信 40029 → 400 invalid_code", async () => {
  const handler = createWechatLoginHandler({
    ...CONFIG,
    fetchFn: fetchReturning({ errcode: 40029, errmsg: "invalid code" }),
  });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { code: "invalid_code", message: "登录凭证无效" });
});

Deno.test("请求体不合规：一律按 invalid_code 处理", async (t) => {
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: fetchReturning({ openid: "o-abc" }) });

  for (const [name, request] of [
    ["缺少 code", post({})],
    ["code 为空串", post({ code: "" })],
    ["code 只有空白", post({ code: "   " })],
    ["code 不是字符串", post({ code: 123 })],
    [
      "请求体不是 JSON",
      new Request(ENDPOINT, { method: "POST", body: "not json" }),
    ],
  ] as Array<[string, Request]>) {
    await t.step(name, async () => {
      const response = await handler(request);
      assertEquals(response.status, 400);
      assertEquals((await response.json()).code, "invalid_code");
    });
  }
});

Deno.test("缺少服务端配置：AppID → invalid_app_id，AppSecret → invalid_app_secret", async (t) => {
  await t.step("缺少 AppID", async () => {
    const handler = createWechatLoginHandler({ appSecret: APP_SECRET });
    const response = await handler(post({ code: "code-1" }));
    assertEquals(response.status, 500);
    assertEquals((await response.json()).code, "invalid_app_id");
  });

  await t.step("缺少 AppSecret", async () => {
    const handler = createWechatLoginHandler({ appId: APP_ID });
    const response = await handler(post({ code: "code-1" }));
    assertEquals(response.status, 500);
    assertEquals((await response.json()).code, "invalid_app_secret");
  });
});

Deno.test("非 POST 请求 → 405", async () => {
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: fetchReturning({ openid: "o-abc" }) });

  const response = await handler(new Request(ENDPOINT, { method: "GET" }));

  assertEquals(response.status, 405);
});

Deno.test("未映射的微信错误 → 500 unknown", async () => {
  const handler = createWechatLoginHandler({
    ...CONFIG,
    fetchFn: fetchReturning({ errcode: 88888, errmsg: "未知错误" }),
  });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 500);
  assertEquals((await response.json()).code, "unknown");
});

Deno.test("响应不泄露密钥，也不透传微信原文", async () => {
  const handler = createWechatLoginHandler({
    ...CONFIG,
    fetchFn: fetchReturning({ errcode: 40029, errmsg: `invalid code, secret=${APP_SECRET}` }),
  });

  const text = await (await handler(post({ code: "code-1" }))).text();

  assertEquals(text.includes(APP_SECRET), false);
  assertEquals(text.includes("secret="), false);
  assertEquals(Object.keys(JSON.parse(text)).sort(), ["code", "message"]);
});
