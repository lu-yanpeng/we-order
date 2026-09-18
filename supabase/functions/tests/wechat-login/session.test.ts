import { assertEquals } from "jsr:@std/assert@^1.0.0";

import { syntheticEmail } from "../../wechat-login/identity.ts";
import { issueLoginToken } from "../../wechat-login/session.ts";
import type { FetchLike } from "../../wechat-login/wechat.ts";
import { fakePlatform, PLATFORM_URL, SERVICE_KEY, TEST_TOKEN_HASH, WECHAT_OPENID } from "./fake-platform.ts";

const CONFIG = { supabaseUrl: PLATFORM_URL, serviceRoleKey: SERVICE_KEY };
const EMAIL = syntheticEmail(WECHAT_OPENID);

Deno.test("生成令牌：调 generate_link，请求体带 magiclink 与占位邮箱", async () => {
  const platform = fakePlatform();

  const result = await issueLoginToken(EMAIL, { ...CONFIG, fetchFn: platform.fetchFn });

  assertEquals(result, { ok: true, tokenHash: TEST_TOKEN_HASH });
  const calls = platform.callsTo("/auth/v1/admin/generate_link");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].body, { type: "magiclink", email: EMAIL });
});

Deno.test("响应形状两种都认：properties.hashed_token 与平铺 hashed_token", async (t) => {
  await t.step("新版：嵌在 properties 下", async () => {
    const platform = fakePlatform({
      generateLink: { status: 200, body: { properties: { hashed_token: "nested-hash" } } },
    });

    const result = await issueLoginToken(EMAIL, { ...CONFIG, fetchFn: platform.fetchFn });

    assertEquals(result, { ok: true, tokenHash: "nested-hash" });
  });

  await t.step("旧版：平铺", async () => {
    const platform = fakePlatform({ generateLink: { status: 200, body: { hashed_token: "flat-hash" } } });

    const result = await issueLoginToken(EMAIL, { ...CONFIG, fetchFn: platform.fetchFn });

    assertEquals(result, { ok: true, tokenHash: "flat-hash" });
  });
});

Deno.test("失败一律返回 { ok: false }，不抛异常", async (t) => {
  const cases: Array<[string, ReturnType<typeof fakePlatform>]> = [
    ["平台非 200", fakePlatform({ generateLink: { status: 500, body: { message: "boom" } } })],
    ["200 但缺 hashed_token", fakePlatform({ generateLink: { status: 200, body: { properties: {} } } })],
    ["200 但令牌是空串", fakePlatform({ generateLink: { status: 200, body: { properties: { hashed_token: "" } } } })],
  ];

  for (const [name, platform] of cases) {
    await t.step(name, async () => {
      const result = await issueLoginToken(EMAIL, { ...CONFIG, fetchFn: platform.fetchFn });
      assertEquals(result, { ok: false });
    });
  }

  await t.step("平台不可达", async () => {
    const result = await issueLoginToken(EMAIL, {
      ...CONFIG,
      fetchFn: () => Promise.reject(new Error("connect timeout")),
    });
    assertEquals(result, { ok: false });
  });
});

Deno.test("平台调用带服务端密钥（apikey + Authorization）", async () => {
  const platform = fakePlatform();
  const seen: Array<Record<string, string>> = [];
  const fetchFn: FetchLike = (input, init) => {
    seen.push(init?.headers as Record<string, string>);
    return platform.fetchFn(input, init);
  };

  await issueLoginToken(EMAIL, { ...CONFIG, fetchFn });

  assertEquals(seen.length, 1);
  assertEquals(seen[0].apikey, SERVICE_KEY);
  assertEquals(seen[0].Authorization, `Bearer ${SERVICE_KEY}`);
});
