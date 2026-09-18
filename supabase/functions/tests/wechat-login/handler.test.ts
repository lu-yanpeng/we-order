import { assertEquals } from "jsr:@std/assert@^1.0.0";

import { createWechatLoginHandler, type WechatLoginConfig } from "../../wechat-login/handler.ts";
import type { FetchLike } from "../../wechat-login/wechat.ts";
import {
  ANON_KEY,
  DERIVED_USER_ID,
  fakePlatform,
  PLATFORM_URL,
  SERVICE_KEY,
  TEST_ACCESS_TOKEN,
  TEST_EXPIRES_IN,
  TEST_REFRESH_TOKEN,
} from "./fake-platform.ts";

const ENDPOINT = "http://127.0.0.1:54321/functions/v1/wechat-login";
const APP_ID = "wx-test-app";
const APP_SECRET = "test-secret";
const CONFIG: WechatLoginConfig = {
  appId: APP_ID,
  appSecret: APP_SECRET,
  supabaseUrl: PLATFORM_URL,
  serviceRoleKey: SERVICE_KEY,
  anonKey: ANON_KEY,
};

function post(body: unknown): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("首次登录：换取身份并直接返回可用会话", async () => {
  const platform = fakePlatform();
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 200);
  // 响应只有会话材料：openid / user_id 是服务端内部信息，一次性令牌也不出服务端
  assertEquals(await response.json(), {
    access_token: TEST_ACCESS_TOKEN,
    refresh_token: TEST_REFRESH_TOKEN,
    expires_in: TEST_EXPIRES_IN,
  });
  assertEquals(platform.callsTo("/auth/v1/admin/users").length, 1);
  assertEquals(platform.callsTo("/auth/v1/admin/generate_link").length, 1);
  assertEquals(platform.callsTo("/auth/v1/verify").length, 1);
});

Deno.test("再次登录：复用既有映射，不调建用户接口，仍签发新会话", async () => {
  const platform = fakePlatform({ resolved: DERIVED_USER_ID });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 200);
  assertEquals((await response.json()).access_token, TEST_ACCESS_TOKEN);
  assertEquals(platform.callsTo("/auth/v1/admin/users").length, 0);
  assertEquals(platform.callsTo("/auth/v1/admin/generate_link").length, 1);
});

Deno.test("身份建立失败：500 unknown（不泄露内部细节）", async () => {
  // 401 这类错误不可能是「撞车」（5xx 会继续交给 claim 定胜负），直接整体失败
  const platform = fakePlatform({ createUser: { status: 401, body: { code: 401, msg: "Invalid API key" } } });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { code: "unknown", message: "登录服务暂时不可用" });
});

Deno.test("生成令牌失败：500 unknown，不返回半截结果", async () => {
  const platform = fakePlatform({ generateLink: { status: 500, body: { message: "boom" } } });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { code: "unknown", message: "登录服务暂时不可用" });
});

Deno.test("兑换会话失败：500 unknown，不返回半截会话", async () => {
  const platform = fakePlatform({ verify: { status: 403, body: { error_code: "otp_expired" } } });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { code: "unknown", message: "登录服务暂时不可用" });
});

Deno.test("会话材料不完整：500 unknown，不把残缺会话下发", async () => {
  const platform = fakePlatform({ verify: { status: 200, body: { access_token: TEST_ACCESS_TOKEN } } });
  const handler = createWechatLoginHandler({ ...CONFIG, fetchFn: platform.fetchFn });

  const response = await handler(post({ code: "code-1" }));

  assertEquals(response.status, 500);
  assertEquals((await response.json()).code, "unknown");
});

Deno.test("缺少平台配置：500 unknown", async (t) => {
  const cases: Array<[string, WechatLoginConfig]> = [
    ["三个都没有", {}],
    ["缺服务端密钥", { supabaseUrl: PLATFORM_URL, anonKey: ANON_KEY }],
    ["缺发布密钥", { supabaseUrl: PLATFORM_URL, serviceRoleKey: SERVICE_KEY }],
  ];

  for (const [name, config] of cases) {
    await t.step(name, async () => {
      const handler = createWechatLoginHandler({ appId: APP_ID, appSecret: APP_SECRET, ...config });
      const response = await handler(post({ code: "code-1" }));
      assertEquals(response.status, 500);
      assertEquals((await response.json()).code, "unknown");
    });
  }
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

Deno.test("平台调用的密钥：Admin API 与 RPC 用服务端密钥，兑换会话用发布密钥", async () => {
  const seen: Array<{ url: string; headers: Headers }> = [];
  const platform = fakePlatform();
  const fetchFn: FetchLike = (input, init) => {
    if (!String(input).startsWith("https://api.weixin.qq.com")) {
      // 不同子客户端交给 fetch 的可能是普通对象或 Headers 实例，统一归一化后再断言
      seen.push({ url: String(input), headers: new Headers(init?.headers) });
    }
    return platform.fetchFn(input, init);
  };

  await createWechatLoginHandler({ ...CONFIG, fetchFn })(post({ code: "code-1" }));

  const verifyCalls = seen.filter((call) => call.url.endsWith("/auth/v1/verify"));
  assertEquals(verifyCalls.length, 1);
  assertEquals(verifyCalls[0].headers.get("apikey"), ANON_KEY);
  assertEquals(verifyCalls[0].headers.get("Authorization"), `Bearer ${ANON_KEY}`);

  const serverCalls = seen.filter((call) => !call.url.endsWith("/auth/v1/verify"));
  assertEquals(serverCalls.length > 0, true);
  for (const call of serverCalls) {
    assertEquals(call.headers.get("apikey"), SERVICE_KEY);
    assertEquals(call.headers.get("Authorization"), `Bearer ${SERVICE_KEY}`);
  }
});
