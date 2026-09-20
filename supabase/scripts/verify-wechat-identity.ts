// Story 2.2 本地验证：并发首登只产生一个用户、重登复用身份、映射丢失可自愈。
// 并发输家允许拿到可重试错误，但重试必须回到同一个用户。
// 需要本地栈在跑（supabase start）。运行：cd supabase && deno task verify:identity
// 密钥不落仓库：优先读环境变量，否则自己执行 `supabase status -o env` 取本地服务端配置。
// 脚本只创建带 verify- 前缀的测试 openid，结束（含失败）时清理对应的平台用户与映射。

import {
  createServiceClient,
  resolveWechatIdentity,
  wechatEmail,
  type WechatIdentity,
} from "../functions/wechat-login/identity.ts";

const ROUNDS = 5;

async function loadLocalConfig(): Promise<
  { url: string; serviceRoleKey: string }
> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (url !== "" && serviceRoleKey !== "") {
    return { url, serviceRoleKey };
  }

  const output = await new Deno.Command("supabase", {
    args: ["status", "-o", "env"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!output.success) {
    throw new Error(
      "拿不到本地配置：请先 `supabase start`，或手动设置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const env: Record<string, string> = {};
  for (const line of new TextDecoder().decode(output.stdout).split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match !== null) env[match[1]] = match[2];
  }
  const apiUrl = env.API_URL ?? "";
  const key = env.SERVICE_ROLE_KEY ?? "";
  if (apiUrl === "" || key === "") {
    throw new Error(
      "`supabase status -o env` 中缺少 API_URL 或 SERVICE_ROLE_KEY",
    );
  }
  return { url: apiUrl, serviceRoleKey: key };
}

const { url, serviceRoleKey } = await loadLocalConfig();
const client = createServiceClient(url, serviceRoleKey);

const checks: string[] = [];
function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
}

async function listAllUsers() {
  const users = [];
  for (let page = 1;; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
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
  const { count, error } = await client
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
      const { error } = await client.auth.admin.deleteUser(user.id);
      if (error) throw error;
      deleted += 1;
    }
  }
  return deleted;
}

const openids: string[] = [];
const emails = new Set<string>();

try {
  // 1) 并发首登：每一轮用两个同时发出的身份解析请求争抢同一个全新 openid。
  //    平台唯一约束决定赢家；输家可能拿到可重试错误，重试后必须回到同一个用户。
  for (let round = 1; round <= ROUNDS; round += 1) {
    const openid = `verify-${round}-${crypto.randomUUID().replaceAll("-", "")}`;
    const email = wechatEmail(openid);
    openids.push(openid);
    emails.add(email);

    const settled = await Promise.allSettled([
      resolveWechatIdentity(openid, client),
      resolveWechatIdentity(openid, client),
    ]);
    const winners: WechatIdentity[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") winners.push(result.value);
    }
    check(winners.length >= 1, `第 ${round} 轮：并发首登至少一个请求成功`);
    const expected = winners[0];
    check(
      expected.email === email,
      `第 ${round} 轮：email 由 openid 确定性派生`,
    );

    // 输家（平台唯一冲突）重试一次，必须拿到同一个 userId
    for (const result of settled) {
      if (result.status === "rejected") {
        const retried = await resolveWechatIdentity(openid, client);
        check(
          retried.userId === expected.userId,
          `第 ${round} 轮：并发输家重试后得到同一个 userId`,
        );
      }
    }

    check(
      (await countUsersByEmail(email)) === 1,
      `第 ${round} 轮：同一 email 只产生一个平台用户`,
    );
    check(
      (await countMappings(openid)) === 1,
      `第 ${round} 轮：同一 openid 只产生一条映射`,
    );
  }

  // 2) 重登：映射命中，复用既有身份
  const first = openids[0];
  const firstEmail = wechatEmail(first);
  const userId = (
    await client
      .from("wechat_identities")
      .select("user_id")
      .eq("openid", first)
      .single()
  ).data?.user_id;
  const again = await resolveWechatIdentity(first, client);
  check(again.userId === userId, "重登复用同一身份");
  check(
    (await countUsersByEmail(firstEmail)) === 1,
    "重登不新增平台用户",
  );

  // 3) 自愈：映射丢失但平台用户仍在 → 下一次登录找回同一用户并补写映射
  const { error: deleteError } = await client
    .from("wechat_identities")
    .delete()
    .eq("openid", first);
  if (deleteError) throw deleteError;
  check(
    (await countMappings(first)) === 0,
    "测试前映射已删除（模拟半登录残留）",
  );

  const healed = await resolveWechatIdentity(first, client);
  check(healed.userId === userId, "映射丢失后自愈到同一用户，不产生第二个身份");
  check(
    (await countUsersByEmail(firstEmail)) === 1,
    "自愈路径不新增平台用户",
  );
  check((await countMappings(first)) === 1, "自愈路径补写映射");

  console.log(
    `PASS：${checks.length} 项断言全部通过（${ROUNDS} 轮并发 + 重登 + 自愈，openid 前缀 verify-）`,
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
