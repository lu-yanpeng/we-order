// 调用者身份读取（P3 Story 3.2；FR-P3-8；AD-11）。
//
// pay-order 由平台先验签（config.toml 的 verify_jwt = true）：能进到函数的请求，
// 其 Authorization 头已被平台用项目密钥校验过签名与有效期。这里的职责只有一件事：
// 把「已验签 JWT」里的用户 id（sub）读出来交给下游——不重复验签、不请求 auth 服务。
//
// fail-closed：读不出合法用户身份（缺失 / 形状不对 / 角色不是用户 / sub 不是 UUID）
// 一律返回 null，由 handler 以 not_authenticated（401）拒绝且不触碰数据库。
// 注意：发布密钥（anon key）也是平台认可的有效 JWT，但它没有 sub、角色是 anon，会被这里挡住。

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Authorization 头 → 用户 id；任何一步不成立都返回 null（fail-closed）。 */
export function callerUserId(authorization: string | null): string | null {
  if (authorization === null) return null;

  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (match === null) return null;

  const payload = decodeJwtPayload(match[1]);
  if (payload === null) return null;

  if (payload.role !== "authenticated") return null;
  const sub = payload.sub;
  if (typeof sub !== "string" || !UUID_RE.test(sub)) return null;
  return sub;
}

/** 只读取 JWT 的 payload 段（base64url）：验签由平台负责，这里只取声明。 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(segments[1]));
    const payload = JSON.parse(json) as unknown;
    if (
      payload === null || typeof payload !== "object" || Array.isArray(payload)
    ) {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function base64UrlToBytes(segment: string): Uint8Array {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64.padEnd(base64.length + padding, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
