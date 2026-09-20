// Story 2.1 / 2.2 边缘函数测试：离线、注入假 fetch 与假身份解析，不需要网络与真实微信凭证。
// 运行：cd supabase && deno task test（等价于 deno test supabase/functions/tests/）
// 类别断言以数据库类型 login_error_code 为准；文案不是契约，故只断言类别与状态码。

import assert from "node:assert/strict";
import {
  handleRequest,
  type WechatLoginDeps,
} from "../../wechat-login/handler.ts";

const APP_ID = "wx-test-app-id";
const APP_SECRET = "test-app-secret";
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/wechat-login";

type FakePlan = {
  payload?: unknown;
  body?: string;
  status?: number;
  throws?: boolean;
};

type FakeIdentityPlan = {
  userId?: string;
  throws?: boolean;
};

/** 假 fetch：记录被请求的 URL，按计划返回；测试据此断言请求形状与类别。 */
function fakeFetch(plan: FakePlan = {}) {
  const calls: URL[] = [];
  const fetchFn = ((input: RequestInfo | URL) => {
    calls.push(new URL(String(input)));
    if (plan.throws) {
      return Promise.reject(new TypeError("network down"));
    }
    if (plan.body !== undefined) {
      return Promise.resolve(
        new Response(plan.body, { status: plan.status ?? 200 }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(plan.payload ?? {}), {
        status: plan.status ?? 200,
      }),
    );
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** 假身份解析：默认成功；throws 时抛一个带「内部细节」的错误，供泄露断言使用。 */
function fakeIdentity(plan: FakeIdentityPlan = {}) {
  const calls: string[] = [];
  const resolveIdentity = (openid: string) => {
    calls.push(openid);
    if (plan.throws) {
      return Promise.reject(new Error("internal-db-detail"));
    }
    return Promise.resolve({
      userId: plan.userId ?? "user-1",
      email: `wx-${openid}@wechat.local`,
    });
  };
  return { resolveIdentity, calls };
}

function postRequest(body: string): Request {
  return new Request(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function callLogin(
  body: unknown,
  plan?: FakePlan,
  identityPlan?: FakeIdentityPlan,
) {
  const { fetchFn, calls } = fakeFetch(plan);
  const identity = fakeIdentity(identityPlan);
  const deps: WechatLoginDeps = {
    appId: APP_ID,
    appSecret: APP_SECRET,
    fetchFn,
    resolveIdentity: identity.resolveIdentity,
  };
  const request = postRequest(
    typeof body === "string" ? body : JSON.stringify(body),
  );
  const response = await handleRequest(request, deps);
  const payload = await response.json();
  return {
    status: response.status,
    payload,
    calls,
    identityCalls: identity.calls,
  };
}

Deno.test("成功：只返回 openid，不外带 session_key；身份解析被调用一次", async () => {
  const { status, payload, identityCalls } = await callLogin(
    { code: "code-ok" },
    {
      payload: {
        openid: "openid-1",
        session_key: "must-not-leak",
        unionid: "union-1",
      },
    },
  );
  assert.equal(status, 200);
  assert.deepEqual(payload, { openid: "openid-1" });
  assert.deepEqual(identityCalls, ["openid-1"]);
});

Deno.test("请求形状：打微信官方地址，四个参数齐全", async () => {
  const { calls } = await callLogin({ code: "code-ok" }, {
    payload: { openid: "openid-1" },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].origin, "https://api.weixin.qq.com");
  assert.equal(calls[0].pathname, "/sns/jscode2session");
  assert.equal(calls[0].searchParams.get("appid"), APP_ID);
  assert.equal(calls[0].searchParams.get("secret"), APP_SECRET);
  assert.equal(calls[0].searchParams.get("js_code"), "code-ok");
  assert.equal(calls[0].searchParams.get("grant_type"), "authorization_code");
});

const wechatErrcodeCases: Array<{
  errcode: number;
  expectedCode: string;
  expectedStatus: number;
}> = [
  { errcode: 40013, expectedCode: "invalid_app_id", expectedStatus: 500 },
  { errcode: 40125, expectedCode: "invalid_app_secret", expectedStatus: 500 },
  { errcode: 40029, expectedCode: "invalid_code", expectedStatus: 400 },
  { errcode: 40163, expectedCode: "code_expired_or_used", expectedStatus: 400 },
  { errcode: 42003, expectedCode: "code_expired_or_used", expectedStatus: 400 },
  { errcode: 40226, expectedCode: "risky_user_blocked", expectedStatus: 403 },
  { errcode: 45011, expectedCode: "rate_limited", expectedStatus: 429 },
  { errcode: 45009, expectedCode: "rate_limited", expectedStatus: 429 },
  { errcode: -1, expectedCode: "wechat_unavailable", expectedStatus: 503 },
  { errcode: 99999, expectedCode: "unknown", expectedStatus: 502 },
];

for (const { errcode, expectedCode, expectedStatus } of wechatErrcodeCases) {
  Deno.test(`微信错误码 ${errcode} → ${expectedCode}（HTTP ${expectedStatus}）`, async () => {
    const { status, payload, identityCalls } = await callLogin(
      { code: "code-ok" },
      { payload: { errcode, errmsg: "wechat says no" } },
    );
    assert.equal(status, expectedStatus);
    assert.equal(payload.code, expectedCode);
    assert.equal(typeof payload.message, "string");
    assert.ok(
      !JSON.stringify(payload).includes(APP_SECRET),
      "响应体不得出现 AppSecret",
    );
    assert.equal(identityCalls.length, 0, "换取失败时不应解析身份");
  });
}

Deno.test("连不上微信 → wechat_unavailable（503）", async () => {
  const { status, payload } = await callLogin({ code: "code-ok" }, {
    throws: true,
  });
  assert.equal(status, 503);
  assert.equal(payload.code, "wechat_unavailable");
});

Deno.test("微信响应不是 JSON → wechat_unavailable（503）", async () => {
  const { status, payload } = await callLogin(
    { code: "code-ok" },
    { body: "<html>502 Bad Gateway</html>" },
  );
  assert.equal(status, 503);
  assert.equal(payload.code, "wechat_unavailable");
});

Deno.test("微信返回 HTTP 5xx → wechat_unavailable（503）", async () => {
  const { status, payload } = await callLogin({ code: "code-ok" }, {
    status: 502,
    payload: {},
  });
  assert.equal(status, 503);
  assert.equal(payload.code, "wechat_unavailable");
});

Deno.test("身份解析失败 → identity_failed（500），且不泄露内部细节", async () => {
  const { status, payload } = await callLogin(
    { code: "code-ok" },
    { payload: { openid: "openid-1" } },
    { throws: true },
  );
  assert.equal(status, 500);
  assert.equal(payload.code, "identity_failed");
  assert.equal(typeof payload.message, "string");
  assert.ok(
    !JSON.stringify(payload).includes("internal-db-detail"),
    "响应体不得出现内部错误细节",
  );
});

Deno.test("入参不合法 → invalid_request（400），且不调用微信与身份解析", async () => {
  const bodies: unknown[] = ["not-json", {}, { code: "" }, { code: "   " }, {
    code: 123,
  }, []];
  for (const body of bodies) {
    const { status, payload, calls, identityCalls } = await callLogin(body);
    const label = `body=${JSON.stringify(body)}`;
    assert.equal(status, 400, label);
    assert.equal(payload.code, "invalid_request", label);
    assert.equal(calls.length, 0, `${label}：入参不合法时不应调用微信`);
    assert.equal(identityCalls.length, 0, `${label}：入参不合法时不应解析身份`);
  }
});

Deno.test("非 POST → 405 invalid_request", async () => {
  const { fetchFn } = fakeFetch();
  const { resolveIdentity } = fakeIdentity();
  const request = new Request(FUNCTION_URL, { method: "GET" });
  const response = await handleRequest(request, {
    appId: APP_ID,
    appSecret: APP_SECRET,
    fetchFn,
    resolveIdentity,
  });
  assert.equal(response.status, 405);
  assert.equal((await response.json()).code, "invalid_request");
});

Deno.test("服务端缺配置 → 500 unknown，且不调用微信", async () => {
  const { fetchFn, calls } = fakeFetch();
  const { resolveIdentity } = fakeIdentity();
  const response = await handleRequest(
    postRequest(JSON.stringify({ code: "code-ok" })),
    {
      appId: "",
      appSecret: APP_SECRET,
      fetchFn,
      resolveIdentity,
    },
  );
  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.equal(payload.code, "unknown");
  assert.equal(calls.length, 0);
});
