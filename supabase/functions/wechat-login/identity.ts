import type { FetchLike } from "./wechat.ts";

/**
 * 由 openid 派生用户 id 的固定命名空间（uuid v5）。
 * 同一个 openid 永远算出同一个用户 id —— 并发首登时，第二个请求即使建用户撞车，
 * 也已经知道既有用户的 id，不需要再查一次。
 *
 * 不可改动：namespace 与 name 的编码属于持久化格式的一部分，改掉等于给同一个 openid 换一个
 * 新用户 id，与既有用户对不上（claim 撞外键、登录以 unknown 失败），要改必须先迁移数据。
 */
const USER_ID_NAMESPACE = "6f1a5b3c-9d2e-4a7b-8c1f-2e5d8a4b7c30";

/** 平台要求用户必须有邮箱或手机号；我们不收集个人信息，用 openid 派生一个占位邮箱 */
export function syntheticEmail(openid: string): string {
  return `wx-${openid}@wechat.local`;
}

/** uuid v5（SHA-1）：确定性，同输入同输出 */
export async function deriveUserId(openid: string): Promise<string> {
  const namespace = hexToBytes(USER_ID_NAMESPACE);
  const name = new TextEncoder().encode(openid);
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace, 0);
  input.set(name, namespace.length);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // 版本 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 变体
  return formatUuid(bytes);
}

export type PlatformConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchFn?: FetchLike;
};

export type EnsureIdentityResult = { ok: true; userId: string } | { ok: false };

/**
 * 确保 openid 对应一个平台用户：已有映射直接复用（顺带推进最近登录时间），
 * 没有就建平台用户再落映射。并发首登由 openid 主键与邮箱唯一约束收敛。
 */
export async function ensureIdentity(openid: string, config: PlatformConfig): Promise<EnsureIdentityResult> {
  try {
    const existing = await callRpc<string | null>("resolve_wechat_identity", { p_openid: openid }, config);
    if (isUserId(existing)) {
      return { ok: true, userId: existing };
    }

    // 并发首登时，两个请求算出的是同一个 userId，所以先到和后到都会走到 claim：
    // createPlatformUser的作用就是id不存在时创建对应用户，存在时判断是不是主键冲突，是的话也返回true
    //   先到：建用户成功；后到：建用户回「邮箱已存在 / 主键冲突」，由 createPlatformUser 视为成功。
    // 输家不需要查询就知道赢家的 id —— 这就是 deriveUserId 存在的理由。
    const userId = await deriveUserId(openid);
    if (!(await createPlatformUser(userId, syntheticEmail(openid), config))) {
      // 只有真正的失败（网络断开、平台报别的错）才走到这里：此时用户建没建成都不知道，
      // 绝不能写映射，只能整体失败；客户端重试时会先命中上面那次 resolve（若赢家已写完映射）。
      return { ok: false };
    }

    // 竞态分析，当两个请求同时请求创建用户时，会出现下面情况
    // 第一个到达的请求会根据对应的userID创建一条wechat_identities表的数据
    // 第二个请求会直接得到对应的wechat_identities.user_id
    // 因为相同的openID通过deriveUserId总是能得到相同的userID
    // 调用claim_wechat_identity创建wechat_identities时
    // 第一个请求会创建成功，第二个请求只会返回已经创建成功的那条数据的user_id
    // 这样做的好处就是，第二个请求不需要返回“用户已存在”这样的错误信息来提示前端
    // 而且也不用查询已经存在的那条数据，claim_wechat_identity已经把那条数据直接返回了
    // 如果没有deriveUserId创建的userID，第二个请求就无法查询userID对应的那条数据，只知道这个用户已经存在了
    const claimed = await callRpc<string | null>(
      "claim_wechat_identity",
      { p_openid: openid, p_user_id: userId },
      config,
    );
    return isUserId(claimed) ? { ok: true, userId: claimed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * 建平台用户（走平台 Admin API，不直插 auth.users）。
 * 已经存在视为成功：同一个 openid 必然派生同一个邮箱与同一个 id，谁来建都一样。
 *   - 422 email_exists：邮箱已存在（通常是并发或历史遗留）
 *   - 500 code 23505：并发下主键撞车（实测平台在 id 冲突时返回这个）
 * 若这两个假设不成立（例如有人手工建了不同 id 的同邮箱用户），后面的 claim 会被
 * 外键约束挡下，登录以 unknown 失败，不会悄悄建立错误身份。
 */
async function createPlatformUser(userId: string, email: string, config: PlatformConfig): Promise<boolean> {
  const response = await request(config, `${config.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    body: JSON.stringify({ id: userId, email, email_confirm: true }),
  });
  if (response.ok) {
    return true;
  }

  const payload = (await response.json().catch(() => null)) as { code?: string; error_code?: string } | null;
  // 「已存在」不是失败，而是「另一个请求刚建好了同一个用户」的信号，所以返回 true 让调用方继续写映射，
  // 两个并发请求因此都能登录成功。若这里返回 false，调用方会整体失败（用户得重试一次），
  // 而且「用户已存在但映射缺失」（赢家中途挂了、映射行被清掉）这种状态将永远补不回来。
  return payload?.error_code === "email_exists" || payload?.code === "23505";
}

async function callRpc<T>(name: string, args: Record<string, unknown>, config: PlatformConfig): Promise<T> {
  const response = await request(config, `${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`rpc ${name} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

function request(config: PlatformConfig, url: string, init: RequestInit): Promise<Response> {
  const fetchFn = config.fetchFn ?? fetch;
  return fetchFn(url, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  });
}

function isUserId(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
