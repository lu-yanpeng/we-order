import { assertEquals } from "jsr:@std/assert@^1.0.0";

import { deriveUserId, ensureIdentity, syntheticEmail } from "../../wechat-login/identity.ts";
import { DERIVED_USER_ID, fakeClient, fakePlatform, WECHAT_OPENID } from "./fake-platform.ts";

Deno.test("占位邮箱由 openid 派生且确定", () => {
  assertEquals(syntheticEmail(WECHAT_OPENID), `wx-${WECHAT_OPENID}@wechat.local`);
  assertEquals(syntheticEmail(WECHAT_OPENID), syntheticEmail(WECHAT_OPENID));
});

Deno.test("用户 id 由 openid 派生：确定、可复现、符合 uuid v5", async () => {
  assertEquals(await deriveUserId(WECHAT_OPENID), DERIVED_USER_ID);
  assertEquals(await deriveUserId(WECHAT_OPENID), await deriveUserId(WECHAT_OPENID));
  assertEquals((await deriveUserId("o-other-openid")) === DERIVED_USER_ID, false);

  // 版本位是 5、变体位是 RFC 4122
  assertEquals(DERIVED_USER_ID[14], "5");
  assertEquals(["8", "9", "a", "b"].includes(DERIVED_USER_ID[19]), true);
});

Deno.test("已有映射：直接复用，不建用户", async () => {
  const platform = fakePlatform({ resolved: "existing-user-id" });

  const result = await ensureIdentity(WECHAT_OPENID, fakeClient(platform.fetchFn));

  assertEquals(result, { ok: true, userId: "existing-user-id" });
  assertEquals(platform.callsTo("/auth/v1/admin/users").length, 0);
  assertEquals(platform.callsTo("/rpc/claim_wechat_identity").length, 0);
  assertEquals(platform.callsTo("/rpc/resolve_wechat_identity").length, 1);
});

Deno.test("首次登录：建用户（带派生 id 与占位邮箱）再落映射", async () => {
  const platform = fakePlatform();

  const result = await ensureIdentity(WECHAT_OPENID, fakeClient(platform.fetchFn));

  assertEquals(result, { ok: true, userId: DERIVED_USER_ID });
  assertEquals(platform.callsTo("/auth/v1/admin/users")[0].body, {
    id: DERIVED_USER_ID,
    email: syntheticEmail(WECHAT_OPENID),
    email_confirm: true,
  });
  assertEquals(platform.callsTo("/rpc/claim_wechat_identity")[0].body, {
    p_openid: WECHAT_OPENID,
    p_user_id: DERIVED_USER_ID,
  });
});

Deno.test("建用户撞车：422 email_exists 与 500/23505 都按「已存在」继续落映射", async (t) => {
  for (const [name, createUser] of [
    ["422 email_exists", { status: 422, body: { code: 422, error_code: "email_exists" } }],
    [
      "500 主键冲突",
      {
        status: 500,
        body: { code: 23505, msg: 'duplicate key value violates unique constraint "users_pkey"' },
      },
    ],
  ] as Array<[string, { status: number; body: unknown }]>) {
    await t.step(name, async () => {
      const platform = fakePlatform({ createUser });

      const result = await ensureIdentity(WECHAT_OPENID, fakeClient(platform.fetchFn));

      assertEquals(result, { ok: true, userId: DERIVED_USER_ID });
      assertEquals(platform.callsTo("/rpc/claim_wechat_identity").length, 1);
    });
  }
});

Deno.test("并发收敛：claim 返回别人的 user_id 时以数据库为准", async () => {
  const platform = fakePlatform({ claimed: "winner-user-id" });

  const result = await ensureIdentity(WECHAT_OPENID, fakeClient(platform.fetchFn));

  assertEquals(result, { ok: true, userId: "winner-user-id" });
});

Deno.test("建用户真实失败（非「已存在」）：不落映射，返回失败", async () => {
  // 401 这类错误不可能是「撞车」：直接失败，不再尝试 claim
  const platform = fakePlatform({ createUser: { status: 401, body: { code: 401, msg: "Invalid API key" } } });

  const result = await ensureIdentity(WECHAT_OPENID, fakeClient(platform.fetchFn));

  assertEquals(result, { ok: false });
  assertEquals(platform.callsTo("/rpc/claim_wechat_identity").length, 0);
});

Deno.test("平台不可达 / RPC 失败：返回失败而不是抛异常", async (t) => {
  await t.step("网络异常", async () => {
    const result = await ensureIdentity(WECHAT_OPENID, fakeClient(() => Promise.reject(new Error("connect timeout"))));
    assertEquals(result, { ok: false });
  });

  await t.step("RPC 非 200", async () => {
    const result = await ensureIdentity(
      WECHAT_OPENID,
      fakeClient(() => Promise.resolve(new Response("boom", { status: 500 }))),
    );
    assertEquals(result, { ok: false });
  });
});
