/**
 * 本地端到端：只把微信接口换成假的，平台（Auth Admin API + Auth + PostgREST + 数据库）全是真的。
 * 覆盖：
 *   - Story 2.2：首次建用户与映射、再次复用、并发首登只产生一个用户；
 *   - Story 2.3：一次性令牌换取平台会话（主体一致、凭会话可访问）、令牌只能用一次、伪造令牌被拒。
 *
 * 运行（需要本地栈已启动；若 CLI 输出的是 PUBLISHABLE_KEY 等新名字，按实际输出替换 ANON_KEY）：
 *   cd supabase && eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' \
 *     | sed 's/^API_URL=/SUPABASE_URL=/; s/^ANON_KEY=/SUPABASE_ANON_KEY=/; s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/')" && cd ..
 *   export SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
 *   deno test --allow-net --allow-env supabase/functions/tests/e2e/wechat-login.e2e.ts
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";

import { createWechatLoginHandler } from "../../wechat-login/handler.ts";
import { deriveUserId, syntheticEmail } from "../../wechat-login/identity.ts";
import type { FetchLike } from "../../wechat-login/wechat.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const APP_ID = "wx-e2e-fake";
const APP_SECRET = "e2e-fake-secret";

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  throw new Error("需要 SUPABASE_URL、SUPABASE_ANON_KEY 与 SUPABASE_SERVICE_ROLE_KEY（见文件头的运行命令）");
}

const AUTH_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

type CreateCall = { status: number; code: string | null };
type SessionBody = { access_token?: string; refresh_token?: string; user?: { id?: string } };

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

/**
 * verify 的 type 取值是平台漂移点（当前文档推荐 email，magiclink 已废弃）：
 * 这里按文档取值，由本地实测钉住，结论记录在 functions/README.md。
 */
const VERIFY_TYPE = "email";

/** 客户端视角：只带发布密钥，拿一次性令牌去平台换会话 */
function verify(tokenHash: string): Promise<Response> {
  return fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: VERIFY_TYPE, token_hash: tokenHash }),
  });
}

/** 从访问凭证里取主体（JWT payload 的 sub），证明「会话是谁的」 */
function jwtSubject(token: string): string {
  const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const decoded = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))) as { sub: string };
  return decoded.sub;
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

Deno.test("首次登录：建出平台用户与身份映射，并签发一次性令牌", async () => {
  const openid = uniqueOpenid("first");
  const expectedUserId = await deriveUserId(openid);

  const response = await makeHandler(openid)(login());
  const body = (await response.json()) as { token_hash: string };

  assertEquals(response.status, 200);
  // 响应只有令牌：openid / user_id 是服务端内部信息，不下发
  assertEquals(Object.keys(body), ["token_hash"]);
  assertEquals(typeof body.token_hash, "string");
  assertEquals(body.token_hash !== "", true);
  assertEquals(await platformUsers(openid), [expectedUserId]);
  assertEquals(await mappingUserIds(openid), [expectedUserId]);
  assertEquals(await deriveUserId(openid), expectedUserId);

  await cleanup(expectedUserId);
  assertEquals(await platformUsers(openid), []);
  assertEquals(await mappingUserIds(openid), []);
});

Deno.test("再次登录：复用既有用户，不再调建用户接口，仍签发新令牌", async () => {
  const openid = uniqueOpenid("reuse");
  const expectedUserId = await deriveUserId(openid);
  const first = await makeHandler(openid)(login());
  const firstBody = (await first.json()) as { token_hash: string };

  const createCalls: CreateCall[] = [];
  const second = await makeHandler(openid, createCalls)(login());
  const secondBody = (await second.json()) as { token_hash: string };

  assertEquals(second.status, 200);
  assertEquals(typeof firstBody.token_hash, "string");
  assertEquals(typeof secondBody.token_hash, "string");
  assertEquals(createCalls.length, 0);
  assertEquals(await platformUsers(openid), [expectedUserId]);

  await cleanup(expectedUserId);
});

Deno.test("并发首登：三个请求只产生一个用户", async () => {
  const openid = uniqueOpenid("race");
  const expectedUserId = await deriveUserId(openid);
  const createCalls: CreateCall[] = [];
  const handler = makeHandler(openid, createCalls);

  const responses = await Promise.all([handler(login()), handler(login()), handler(login())]);
  const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
    token_hash: string;
  }>;

  assertEquals(responses.map((response) => response.status), [200, 200, 200]);
  assertEquals(bodies.every((body) => typeof body.token_hash === "string" && body.token_hash !== ""), true);
  assertEquals(await platformUsers(openid), [expectedUserId]);
  assertEquals(await mappingUserIds(openid), [expectedUserId]);

  console.log("并发首登时建用户接口的实际结果：", JSON.stringify(createCalls));

  await cleanup(expectedUserId);
});

Deno.test("换取会话：令牌换到平台会话，主体与映射用户一致", async () => {
  const openid = uniqueOpenid("session");
  const expectedUserId = await deriveUserId(openid);

  const loginResponse = await makeHandler(openid)(login());
  const { token_hash } = (await loginResponse.json()) as { token_hash: string };

  const response = await verify(token_hash);
  const body = (await response.json()) as SessionBody;
  const accessToken = body.access_token ?? "";
  const refreshToken = body.refresh_token ?? "";

  assertEquals(response.status, 200);
  assertEquals(accessToken !== "", true);
  assertEquals(refreshToken !== "", true);
  // 会话所标识的主体与 openid 映射到的用户一致
  assertEquals(jwtSubject(accessToken), expectedUserId);
  assertEquals(body.user?.id, expectedUserId);

  // 凭该会话即可访问（只带发布密钥 + Authorization，无其他凭证）
  const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  assertEquals(me.status, 200);
  assertEquals(((await me.json()) as { id: string }).id, expectedUserId);

  await cleanup(expectedUserId);
});

Deno.test("一次性：同一令牌第二次换取被拒", async () => {
  const openid = uniqueOpenid("oneshot");
  const expectedUserId = await deriveUserId(openid);

  const loginResponse = await makeHandler(openid)(login());
  const { token_hash } = (await loginResponse.json()) as { token_hash: string };

  const first = await verify(token_hash);
  const second = await verify(token_hash);
  const secondBody = (await second.json()) as SessionBody;

  assertEquals(first.status, 200);
  assertEquals(second.ok, false);
  assertEquals(secondBody.access_token, undefined);

  await cleanup(expectedUserId);
});

Deno.test("伪造令牌被拒", async () => {
  const response = await verify("not-a-real-token-hash");

  assertEquals(response.ok, false);
  assertEquals(((await response.json()) as SessionBody).access_token, undefined);
});
