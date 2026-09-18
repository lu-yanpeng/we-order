/**
 * 本地端到端：只把微信接口换成假的，平台（Auth Admin API + PostgREST + 数据库）全是真的。
 * 验证 Story 2.2 的三条验收：首次建用户与映射、再次复用、并发首登只产生一个用户。
 *
 * 运行（需要本地栈已启动）：
 *   cd supabase && eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=' \
 *     | sed 's/^API_URL=/SUPABASE_URL=/; s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/')" && cd ..
 *   deno test --allow-net --allow-env supabase/functions/tests/e2e/wechat-login.e2e.ts
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";

import { createWechatLoginHandler } from "../../wechat-login/handler.ts";
import { deriveUserId, syntheticEmail } from "../../wechat-login/identity.ts";
import type { FetchLike } from "../../wechat-login/wechat.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_ID = "wx-e2e-fake";
const APP_SECRET = "e2e-fake-secret";

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("需要 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY（见文件头的运行命令）");
}

const AUTH_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

type CreateCall = { status: number; code: string | null };

/** 假微信 + 真平台：只拦微信域名，其余请求原样打到本地栈 */
function makeHandler(openid: string, createCalls: CreateCall[] = []) {
  const fetchFn: FetchLike = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.weixin.qq.com")) {
      return Response.json({ openid, session_key: "e2e-session-key" });
    }

    const response = await fetch(input, init);
    if (url.endsWith("/auth/v1/admin/users") && init?.method === "POST") {
      const payload = await response
        .clone()
        .json()
        .catch(() => null) as { code?: string; error_code?: string } | null;
      createCalls.push({
        status: response.status,
        code: payload?.error_code ?? (payload?.code === undefined ? null : String(payload.code)),
      });
    }
    return response;
  };

  return createWechatLoginHandler({
    appId: APP_ID,
    appSecret: APP_SECRET,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchFn,
  });
}

function login(): Request {
  return new Request("http://e2e.local/functions/v1/wechat-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "e2e-code" }),
  });
}

async function mappingUserIds(openid: string): Promise<string[]> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/wechat_identities?openid=eq.${encodeURIComponent(openid)}&select=user_id`,
    { headers: AUTH_HEADERS },
  );
  const rows = (await response.json()) as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}

async function platformUsers(openid: string): Promise<string[]> {
  const email = syntheticEmail(openid);
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=20&filter=${encodeURIComponent(email)}`,
    { headers: AUTH_HEADERS },
  );
  const body = (await response.json()) as { users?: Array<{ id: string; email: string }> };
  return (body.users ?? []).filter((user) => user.email === email).map((user) => user.id);
}

async function cleanup(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: AUTH_HEADERS });
}

const uniqueOpenid = (tag: string) => `o-e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

Deno.test("首次登录：建出平台用户与身份映射", async () => {
  const openid = uniqueOpenid("first");
  const expectedUserId = await deriveUserId(openid);

  const response = await makeHandler(openid)(login());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { openid, user_id: expectedUserId });
  assertEquals(await platformUsers(openid), [expectedUserId]);
  assertEquals(await mappingUserIds(openid), [expectedUserId]);
  assertEquals(await deriveUserId(openid), expectedUserId);

  await cleanup(expectedUserId);
  assertEquals(await platformUsers(openid), []);
  assertEquals(await mappingUserIds(openid), []);
});

Deno.test("再次登录：复用既有用户，不再调建用户接口", async () => {
  const openid = uniqueOpenid("reuse");
  const first = await makeHandler(openid)(login());
  const firstBody = await first.json();

  const createCalls: CreateCall[] = [];
  const second = await makeHandler(openid, createCalls)(login());
  const secondBody = await second.json();

  assertEquals(second.status, 200);
  assertEquals(secondBody, firstBody);
  assertEquals(createCalls.length, 0);
  assertEquals(await platformUsers(openid), [firstBody.user_id]);

  await cleanup(firstBody.user_id);
});

Deno.test("并发首登：三个请求只产生一个用户", async () => {
  const openid = uniqueOpenid("race");
  const expectedUserId = await deriveUserId(openid);
  const createCalls: CreateCall[] = [];
  const handler = makeHandler(openid, createCalls);

  const responses = await Promise.all([handler(login()), handler(login()), handler(login())]);
  const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
    user_id: string;
  }>;

  assertEquals(responses.map((response) => response.status), [200, 200, 200]);
  assertEquals(new Set(bodies.map((body) => body.user_id)).size, 1);
  assertEquals(bodies[0].user_id, expectedUserId);
  assertEquals(await platformUsers(openid), [expectedUserId]);
  assertEquals(await mappingUserIds(openid), [expectedUserId]);

  console.log("并发首登时建用户接口的实际结果：", JSON.stringify(createCalls));

  await cleanup(expectedUserId);
});
