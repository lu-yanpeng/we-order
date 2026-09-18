import { assertEquals } from "jsr:@std/assert@^1.0.0";

import { createWechatLoginHandler, type WechatLoginConfig } from "../../wechat-login/handler.ts";
import type { FetchLike } from "../../wechat-login/wechat.ts";
import { DERIVED_USER_ID, fakePlatform, PLATFORM_URL, SERVICE_KEY, WECHAT_OPENID } from "./fake-platform.ts";

const ENDPOINT = "http://127.0.0.1:54321/functions/v1/wechat-login";
const APP_ID = "wx-test-app";
const APP_SECRET = "test-secret";
const CONFIG: WechatLoginConfig = {
  appId: APP_ID,
  appSecret: APP_SECRET,
  supabaseUrl: PLATFORM_URL,
  serviceRoleKey: SERVICE_KEY,
};

function post(body: unknown): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("首次登录：换取身份并返回 openid 与 user_id", async () => {
  const platform = fakePlatform();
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { openid: WECHAT_OPENID, user_id: DERIVED_USER_ID });
});

Deno.test("再次登录：复用既有映射，不调建用户接口", async () => {
  const platform = fakePlatform({ resolved: DERIVED_USER_ID });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { openid: WECHAT_OPENID, user_id: DERIVED_USER_ID });
  assertEquals(platform.callsTo("/auth/v1/admin/users").length, 0);
});

Deno.test("身份建立失败：500 unknown（不泄露内部细节）", async () => {
  const platform = fakePlatform({ createUser: { status: 500, body: { message: "boom" } } });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { code: "unknown", message: "登录服务暂时不可用" });
});

Deno.test("缺少平台配置：500 unknown", async () => {
  const handler = createWechatLoginHandler({ appId: APP_ID, appSecret: APP_SECRET });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 500);
  assertEquals((await response.json()).code, "unknown");
});

Deno.test("凭证无效：微信 40029 → 400 invalid_code", async () => {
  const platform = fakePlatform({ wechat: { errcode: 40029, errmsg: "invalid code" } });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { code: "invalid_code", message: "登录凭证无效" });
});

Deno.test("请求体不合规：一律按 invalid_code 处理", async (t) => {
  const platform = fakePlatform();
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  for (const [name, request] of [
    ["缺少 code", post({})],
    ["code 为空串", post({ code: "" })],
    ["code 只有空白", post({ code: "   " })],
    ["code 不是字符串", post({ code: 123 })],
    ["请求体不是 JSON", new Request(ENDPOINT, { method: "POST", body: "not json" })],
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
  const platform = fakePlatform();
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(new Request(ENDPOINT, { method: "GET" }));

  assertEquals(response.status, 405);
});

Deno.test("未映射的微信错误 → 500 unknown", async () => {
  const platform = fakePlatform({ wechat: { errcode: 88888, errmsg: "未知错误" } });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 500);
  assertEquals((await response.json()).code, "unknown");
});

Deno.test("响应不泄露密钥，也不透传微信原文", async () => {
  const platform = fakePlatform({
    wechat: { errcode: 40029, errmsg: `invalid code, secret=${APP_SECRET}` },
  });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const text = await (await handler(post({ code: "code-1" }))).text();

  assertEquals(text.includes(APP_SECRET), false);
  assertEquals(text.includes(SERVICE_KEY), false);
  assertEquals(Object.keys(JSON.parse(text)).sort(), ["code", "message"]);
});

Deno.test("平台调用都带服务端密钥（apikey + Authorization）", async () => {
  const seen: Array<Record<string, string>> = [];
  const platform = fakePlatform();
  const fetchFn: FetchLike = (input, init) => {
    if (!String(input).startsWith("https://api.weixin.qq.com")) {
      seen.push(init?.headers as Record<string, string>);
    }
    return platform.fetchFn(input, init);
  };

  await createWechatLoginHandler({ ...CONFIG, fetchFn })(post({ code: "code-1" }));

  assertEquals(seen.length > 0, true);
  for (const headers of seen) {
    assertEquals(headers.apikey, SERVICE_KEY);
    assertEquals(headers.Authorization, `Bearer ${SERVICE_KEY}`);
  }
});
