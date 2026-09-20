// Story 2.2 + 2.3 本地链路验证：并发首登收敛、重登复用、映射丢失自愈，
// 以及登录返回的真实平台会话（主体一致、单次消费、可续期）。
//
// 需要本地栈在跑（supabase start），且数据库已应用全部迁移。
// 运行：cd supabase && deno task verify:login
// 密钥不落仓库：优先读环境变量，否则自己执行 `supabase status -o env` 取本地服务端配置。
// 脚本只创建带 verify- 前缀的测试 openid，结束（含失败）时清理对应的平台用户与映射。
//
// 微信那一跳注入为受控响应（不联网、不需要真实 AppSecret）；其余全是真的：
// 真实 handleRequest、真实身份解析、真实 generateLink / verifyOtp、真实平台会话。

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  handleRequest,
  type WechatLoginDeps,
} from "../functions/wechat-login/handler.ts";
import {
  createServiceClient,
  resolveWechatIdentity,
  wechatEmail,
} from "../functions/wechat-login/identity.ts";
import {
  createSessionIssuer,
  createVerifyClient,
  type LoginSession,
} from "../functions/wechat-login/session.ts";

const ROUNDS = 3;

async function loadLocalConfig(): Promise<
  { url: string; serviceRoleKey: string; anonKey: string }
> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (url !== "" && serviceRoleKey !== "" && anonKey !== "") {
    return { url, serviceRoleKey, anonKey };
  }

  const output = await new Deno.Command("supabase", {
    args: ["status", "-o", "env"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!output.success) {
    throw new Error(
      "拿不到本地配置：请先 `supabase start`，或手动设置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY",
    );
  }

  const env: Record<string, string> = {};
  for (const line of new TextDecoder().decode(output.stdout).split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match !== null) env[match[1]] = match[2];
  }
  const apiUrl = env.API_URL ?? "";
  const serviceKey = env.SERVICE_ROLE_KEY ?? "";
  const anon = env.ANON_KEY ?? "";
  if (apiUrl === "" || serviceKey === "" || anon === "") {
    throw new Error(
      "`supabase status -o env` 中缺少 API_URL / SERVICE_ROLE_KEY / ANON_KEY",
    );
  }
  return { url: apiUrl, serviceRoleKey: serviceKey, anonKey: anon };
}

const { url, serviceRoleKey, anonKey } = await loadLocalConfig();
const serviceClient = createServiceClient(url, serviceRoleKey);
// 与 index.ts 相同的接线：兑换用独立公开客户端，避免把会话写到服务端密钥客户端上。
const verifyClient = createVerifyClient(url, anonKey);
// 模拟客户端身份的公开客户端：只用来验证会话与续期，不参与签发。
const userClient = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const checks: string[] = [];
function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
}

/** 受控微信响应：不联网，直接返回指定 openid（微信错误分类由离线单元测试覆盖）。 */
function wechatFetch(openid: string): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify({ openid }), { status: 200 }),
    )) as typeof fetch;
}

const loginDeps: Omit<WechatLoginDeps, "fetchFn"> = {
  appId: "verify-app-id",
  appSecret: "verify-app-secret",
  resolveIdentity: (openid) => resolveWechatIdentity(openid, serviceClient),
  issueSession: createSessionIssuer(serviceClient, verifyClient),
};

type LoginOutcome =
  | { ok: true; session: LoginSession }
  | { ok: false; code: string; message: string };

async function login(openid: string): Promise<LoginOutcome> {
  const response = await handleRequest(
    new Request("http://verify.local/functions/v1/wechat-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: `verify-code-${openid}` }),
    }),
    { ...loginDeps, fetchFn: wechatFetch(openid) },
  );
  const body = await response.json();
  if (response.status === 200) {
    return { ok: true, session: body as LoginSession };
  }
  return {
    ok: false,
    code: String(body.code),
    message: String(body.message),
  };
}

async function listAllUsers() {
  const users = [];
  for (let page = 1;; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function countUsersByEmail(email: string): Promise<number> {
  return (await listAllUsers()).filter(
    (user) => user.email?.toLowerCase() === email,
  ).length;
}

async function countMappings(openid: string): Promise<number> {
  const { count, error } = await serviceClient
    .from("wechat_identities")
    .select("openid", { count: "exact", head: true })
    .eq("openid", openid);
  if (error) throw error;
  return count ?? 0;
}

async function cleanup(emails: Set<string>): Promise<number> {
  let deleted = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const matches = (await listAllUsers()).filter((user) =>
      emails.has(user.email?.toLowerCase() ?? "")
    );
    if (matches.length === 0) break;
    for (const user of matches) {
      const { error } = await serviceClient.auth.admin.deleteUser(user.id);
      if (error) throw error;
      deleted += 1;
    }
  }
  return deleted;
}

const openids: string[] = [];
const emails = new Set<string>();
const userIds = new Map<string, string>();

try {
  // 1) 并发首登 + 会话签发：每轮两个同时发出的登录请求争抢同一个全新 openid。
  //    平台唯一约束决定赢家；输家允许拿到可重试类别，重试后必须回到同一个用户。
  //    两个请求都可能通过身份阶段，然后在会话签发处撞车：新生成的令牌会让先发的
  //    那个作废，先发者得到 session_failed——平台设计如此，失败重试即可（见 session.ts）。
  for (let round = 1; round <= ROUNDS; round += 1) {
    const openid = `verify-${round}-${crypto.randomUUID().replaceAll("-", "")}`;
    const email = wechatEmail(openid);
    openids.push(openid);
    emails.add(email);

    const settled = await Promise.all([login(openid), login(openid)]);
    const successes = settled.filter(
      (result): result is Extract<LoginOutcome, { ok: true }> => result.ok,
    );
    check(successes.length >= 1, `第 ${round} 轮：并发首登至少一个请求成功`);

    for (const failed of settled.filter((result) => !result.ok)) {
      check(
        failed.code === "identity_failed" || failed.code === "session_failed",
        `第 ${round} 轮：并发输家返回可重试类别（${failed.code}）`,
      );
      const retried = await login(openid);
      check(retried.ok, `第 ${round} 轮：并发输家重试成功`);
      if (retried.ok) successes.push(retried);
    }

    const userId = successes[0].session.user.id;
    userIds.set(openid, userId);
    check(
      successes.every((result) => result.session.user.id === userId),
      `第 ${round} 轮：所有会话的主体都是同一个用户`,
    );
    check(
      (await countUsersByEmail(email)) === 1,
      `第 ${round} 轮：同一 email 只产生一个平台用户`,
    );
    check(
      (await countMappings(openid)) === 1,
      `第 ${round} 轮：同一 openid 只产生一条映射`,
    );

    // 响应形状固定：两个凭证 + 过期信息 + 主体；openid 不外泄。
    const session = successes[0].session;
    check(
      Object.keys(session).sort().join(",") ===
        "access_token,expires_at,expires_in,refresh_token,token_type,user",
      `第 ${round} 轮：响应字段与契约一致`,
    );
    check(
      JSON.stringify(session.user) === JSON.stringify({ id: userId }),
      `第 ${round} 轮：响应主体只含 id`,
    );

    // 会话可用性：凭 access token 查询平台当前用户（需要身份，且主体必须一致）
    const { data: current, error: currentError } = await userClient.auth
      .getUser(
        session.access_token,
      );
    check(
      currentError === null && current.user?.id === userId,
      `第 ${round} 轮：access token 可用于平台当前用户查询，且主体一致`,
    );
  }

  // 2) 重登：映射命中，复用既有身份，并再次拿到可用会话
  const firstOpenid = openids[0];
  const firstEmail = wechatEmail(firstOpenid);
  const userId = userIds.get(firstOpenid) ?? "";
  const again = await login(firstOpenid);
  check(again.ok, "重登成功");
  if (!again.ok) throw new Error("FAIL: 重登未返回会话");
  check(again.session.user.id === userId, "重登复用同一身份");
  check((await countUsersByEmail(firstEmail)) === 1, "重登不新增平台用户");
  check((await countMappings(firstOpenid)) === 1, "重登不新增映射");

  // 3) 续期：refresh token 换回新会话（平台标准机制，客户端 2.4 依赖此行为）
  const { data: refreshed, error: refreshError } = await userClient.auth
    .refreshSession({ refresh_token: again.session.refresh_token });
  check(refreshError === null, "refresh token 换新会话成功");
  check(refreshed.session?.user.id === userId, "续期后的会话主体不变");

  // 4) 自愈：映射丢失但平台用户仍在 → 下一次登录找回同一用户并补写映射
  const { error: deleteError } = await serviceClient
    .from("wechat_identities")
    .delete()
    .eq("openid", firstOpenid);
  if (deleteError) throw deleteError;
  check(
    (await countMappings(firstOpenid)) === 0,
    "测试前映射已删除（模拟半登录残留）",
  );

  const healed = await login(firstOpenid);
  check(healed.ok, "映射丢失后自愈登录成功");
  if (!healed.ok) throw new Error("FAIL: 自愈登录未返回会话");
  check(
    healed.session.user.id === userId,
    "映射丢失后自愈到同一用户，不产生第二个身份",
  );
  check((await countUsersByEmail(firstEmail)) === 1, "自愈路径不新增平台用户");
  check((await countMappings(firstOpenid)) === 1, "自愈路径补写映射");

  // 5) 平台一次性令牌保证（函数内部依赖的机制，旁路验证一次）：
  //    登录函数从不把令牌交给客户端，令牌在同一请求内被消费，客户端无法重放。
  const { data: link, error: linkError } = await serviceClient.auth.admin
    .generateLink({ type: "magiclink", email: firstEmail });
  if (linkError) throw linkError;
  const tokenHash = link.properties.hashed_token;
  const firstVerify = await userClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  check(
    firstVerify.error === null && firstVerify.data.session?.user.id === userId,
    "一次性登录令牌首次兑换成功，且主体一致",
  );
  const secondVerify = await userClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  check(
    secondVerify.error !== null && secondVerify.data.session === null,
    "同一令牌第二次兑换被平台拒绝（单次消费）",
  );
  console.log(
    `  单次消费的拒绝类别：${secondVerify.error?.code ?? "n/a"}` +
      "（平台漂移点，不做断言；有效期由 config.toml 的 auth.email.otp_expiry 决定）",
  );

  console.log(
    `PASS：${checks.length} 项断言全部通过（${ROUNDS} 轮并发首登 + 重登 + 续期 + 自愈 + 令牌单次消费，openid 前缀 verify-）`,
  );
  for (const label of checks) console.log(`  ✓ ${label}`);
} finally {
  const deleted = await cleanup(emails);
  const leftover: string[] = [];
  for (const openid of openids) {
    if ((await countMappings(openid)) !== 0) leftover.push(openid);
  }
  console.log(`清理：删除 ${deleted} 个测试平台用户与级联映射`);
  if (leftover.length > 0) {
    console.error(`WARN: 清理后仍残留映射：${leftover.join(", ")}`);
  }
}
