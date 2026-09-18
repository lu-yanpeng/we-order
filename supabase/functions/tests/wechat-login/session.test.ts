import { assertEquals } from "jsr:@std/assert@^1.0.0";

import { syntheticEmail } from "../../wechat-login/identity.ts";
import { exchangeLoginToken, issueLoginToken, issueSession } from "../../wechat-login/session.ts";
import type { FetchLike } from "../../wechat-login/wechat.ts";
import {
  ANON_KEY,
  fakeClient,
  fakePlatform,
  SERVICE_KEY,
  TEST_ACCESS_TOKEN,
  TEST_EXPIRES_IN,
  TEST_REFRESH_TOKEN,
  TEST_TOKEN_HASH,
  WECHAT_OPENID,
} from "./fake-platform.ts";

const EMAIL = syntheticEmail(WECHAT_OPENID);
const EXPECTED_SESSION = {
  access_token: TEST_ACCESS_TOKEN,
  refresh_token: TEST_REFRESH_TOKEN,
  expires_in: TEST_EXPIRES_IN,
};

/** 与 handler 里同样的接线：生成用服务端密钥的客户端，兑换用发布密钥的客户端 */
function clients(platform: ReturnType<typeof fakePlatform>) {
  return { admin: fakeClient(platform.fetchFn), anon: fakeClient(platform.fetchFn, ANON_KEY) };
}

Deno.test("生成令牌：调 generate_link，请求体带 magiclink 与占位邮箱，返回平台给出的一次性令牌", async () => {
  const platform = fakePlatform();

  const result = await issueLoginToken(EMAIL, fakeClient(platform.fetchFn));

  assertEquals(result, { ok: true, tokenHash: TEST_TOKEN_HASH });
  const calls = platform.callsTo("/auth/v1/admin/generate_link");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].body, { type: "magiclink", email: EMAIL });
});

Deno.test("生成令牌失败一律返回 { ok: false }，不抛异常", async (t) => {
  const cases: Array<[string, ReturnType<typeof fakePlatform>]> = [
    ["平台非 200", fakePlatform({ generateLink: { status: 500, body: { message: "boom" } } })],
    ["200 但缺 hashed_token", fakePlatform({ generateLink: { status: 200, body: { id: "u1", email: EMAIL } } })],
    ["200 但令牌是空串", fakePlatform({ generateLink: { status: 200, body: { hashed_token: "" } } })],
  ];

  for (const [name, platform] of cases) {
    await t.step(name, async () => {
      const result = await issueLoginToken(EMAIL, fakeClient(platform.fetchFn));
      assertEquals(result, { ok: false });
    });
  }

  await t.step("平台不可达", async () => {
    const result = await issueLoginToken(EMAIL, fakeClient(() => Promise.reject(new Error("connect timeout"))));
    assertEquals(result, { ok: false });
  });
});

Deno.test("生成令牌请求带服务端密钥（apikey + Authorization）", async () => {
  const platform = fakePlatform();
  const seen: Array<Record<string, string>> = [];
  const fetchFn: FetchLike = (input, init) => {
    seen.push(init?.headers as Record<string, string>);
    return platform.fetchFn(input, init);
  };

  await issueLoginToken(EMAIL, fakeClient(fetchFn));

  assertEquals(seen.length, 1);
  assertEquals(seen[0].apikey, SERVICE_KEY);
  assertEquals(seen[0].Authorization, `Bearer ${SERVICE_KEY}`);
});

Deno.test("兑换会话：调 verify（带一次性令牌），只取会话的三个字段", async () => {
  const platform = fakePlatform();

  const result = await exchangeLoginToken(TEST_TOKEN_HASH, fakeClient(platform.fetchFn, ANON_KEY));

  // 平台响应里还有 user / token_type / expires_at，都不下发
  assertEquals(result, { ok: true, session: EXPECTED_SESSION });
  const calls = platform.callsTo("/auth/v1/verify");
  assertEquals(calls.length, 1);
  // 只钉我们的入参：官方 SDK 还会附加 gotrue_meta_security 之类的自有字段
  const body = calls[0].body as Record<string, unknown>;
  assertEquals(body.type, "email");
  assertEquals(body.token_hash, TEST_TOKEN_HASH);
});

Deno.test("兑换失败：区分「平台明确拒绝」（值得重发）与「平台不可达 / 响应不可用」（重发无意义）", async (t) => {
  const complete = {
    access_token: TEST_ACCESS_TOKEN,
    refresh_token: TEST_REFRESH_TOKEN,
    expires_in: TEST_EXPIRES_IN,
  };

  const rejected: Array<[string, ReturnType<typeof fakePlatform>]> = [
    ["令牌已被并发的另一次登录顶掉", fakePlatform({ verify: { status: 403, body: { error_code: "otp_expired" } } })],
    ["平台 500", fakePlatform({ verify: { status: 500, body: { message: "boom" } } })],
  ];

  for (const [name, platform] of rejected) {
    await t.step(name, async () => {
      const result = await exchangeLoginToken(TEST_TOKEN_HASH, fakeClient(platform.fetchFn, ANON_KEY));
      assertEquals(result, { ok: false, rejected: true });
    });
  }

  const unusable: Array<[string, ReturnType<typeof fakePlatform>]> = [
    ["200 但没有会话材料", fakePlatform({ verify: { status: 200, body: { user: { id: "u1" } } } })],
    ["200 但访问凭证为空串", fakePlatform({ verify: { status: 200, body: { ...complete, access_token: "" } } })],
    ["200 但缺刷新凭证", fakePlatform({ verify: { status: 200, body: { access_token: TEST_ACCESS_TOKEN, expires_in: 3600 } } })],
    ["200 但有效期不是数字", fakePlatform({ verify: { status: 200, body: { ...complete, expires_in: "3600" } } })],
  ];

  for (const [name, platform] of unusable) {
    await t.step(name, async () => {
      const result = await exchangeLoginToken(TEST_TOKEN_HASH, fakeClient(platform.fetchFn, ANON_KEY));
      assertEquals(result, { ok: false, rejected: false });
    });
  }

  await t.step("平台不可达", async () => {
    const result = await exchangeLoginToken(
      TEST_TOKEN_HASH,
      fakeClient(() => Promise.reject(new Error("connect timeout")), ANON_KEY),
    );
    assertEquals(result, { ok: false, rejected: false });
  });
});

Deno.test("兑换请求带发布密钥，不带服务端密钥", async () => {
  const platform = fakePlatform();
  const seen: Array<Record<string, string>> = [];
  const fetchFn: FetchLike = (input, init) => {
    seen.push(init?.headers as Record<string, string>);
    return platform.fetchFn(input, init);
  };

  await exchangeLoginToken(TEST_TOKEN_HASH, fakeClient(fetchFn, ANON_KEY));

  assertEquals(seen.length, 1);
  assertEquals(seen[0].apikey, ANON_KEY);
  assertEquals(seen[0].Authorization, `Bearer ${ANON_KEY}`);
  assertEquals(seen[0].Authorization?.includes(SERVICE_KEY), false);
});

Deno.test("签发会话：生成令牌 + 兑换，一次成功", async () => {
  const platform = fakePlatform();

  const result = await issueSession(EMAIL, clients(platform));

  assertEquals(result, { ok: true, session: EXPECTED_SESSION });
  assertEquals(platform.callsTo("/auth/v1/admin/generate_link").length, 1);
  assertEquals(platform.callsTo("/auth/v1/verify").length, 1);
});

Deno.test("签发会话：令牌被并发的另一次登录顶掉时重发（第一次被拒，第二次成功）", async () => {
  const platform = fakePlatform({
    verify: [{ status: 403, body: { error_code: "otp_expired" } }, { status: 200 }],
  });

  const result = await issueSession(EMAIL, clients(platform));

  assertEquals(result, { ok: true, session: EXPECTED_SESSION });
  assertEquals(platform.callsTo("/auth/v1/admin/generate_link").length, 2);
  assertEquals(platform.callsTo("/auth/v1/verify").length, 2);
});

Deno.test("签发会话：重发有上限，一直不成功就停手", async () => {
  const platform = fakePlatform({ verify: { status: 403, body: { error_code: "otp_expired" } } });

  const result = await issueSession(EMAIL, clients(platform));

  assertEquals(result, { ok: false });
  assertEquals(platform.callsTo("/auth/v1/admin/generate_link").length, 3);
  assertEquals(platform.callsTo("/auth/v1/verify").length, 3);
});

Deno.test("签发会话：平台不可达时不重发（重发没有意义）", async () => {
  const platform = fakePlatform();
  const fetchFn: FetchLike = (input, init) =>
    String(input).endsWith("/auth/v1/verify")
      ? Promise.reject(new Error("connect timeout"))
      : platform.fetchFn(input, init);

  const result = await issueSession(EMAIL, { admin: fakeClient(fetchFn), anon: fakeClient(fetchFn, ANON_KEY) });

  assertEquals(result, { ok: false });
  assertEquals(platform.callsTo("/auth/v1/admin/generate_link").length, 1);
});

Deno.test("签发会话：生成令牌就失败时不兑换，也不重发", async () => {
  const platform = fakePlatform({ generateLink: { status: 500, body: { message: "boom" } } });

  const result = await issueSession(EMAIL, clients(platform));

  assertEquals(result, { ok: false });
  assertEquals(platform.callsTo("/auth/v1/verify").length, 0);
});
