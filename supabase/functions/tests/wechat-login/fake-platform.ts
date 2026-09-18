import type { FetchLike } from "../../wechat-login/wechat.ts";

export const PLATFORM_URL = "http://platform.test";
export const SERVICE_KEY = "service-role-key";
export const WECHAT_OPENID = "o-test-openid";
/** 由 o-test-openid 派生的用户 id（钉住：改动派生规则会让既有映射对不上，必须是有意为之） */
export const DERIVED_USER_ID = "3ca3964a-bd2c-504f-afb7-69a38b4e061d";

export type RecordedCall = { url: string; body: unknown };

export type FakePlatformOptions = {
  /** 微信 jscode2session 的返回，默认 {"openid": WECHAT_OPENID} */
  wechat?: unknown;
  /** resolve RPC 的返回，默认 null（没有映射） */
  resolved?: string | null;
  /** claim RPC 的返回，默认 DERIVED_USER_ID */
  claimed?: string | null;
  /** 建用户接口的返回，默认 200 */
  createUser?: { status: number; body?: unknown };
};

/** 把微信接口、平台 Admin API、两个身份 RPC 都按 URL 路由的假 fetch（其余请求 404） */
export function fakePlatform(options: FakePlatformOptions = {}) {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchLike = (input, init) => {
    const url = String(input);
    calls.push({ url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });

    if (url.startsWith("https://api.weixin.qq.com")) {
      return Promise.resolve(Response.json(options.wechat ?? { openid: WECHAT_OPENID }));
    }
    if (url === `${PLATFORM_URL}/rest/v1/rpc/resolve_wechat_identity`) {
      return Promise.resolve(Response.json(options.resolved ?? null));
    }
    if (url === `${PLATFORM_URL}/rest/v1/rpc/claim_wechat_identity`) {
      return Promise.resolve(Response.json(options.claimed ?? DERIVED_USER_ID));
    }
    if (url === `${PLATFORM_URL}/auth/v1/admin/users`) {
      const response = options.createUser ?? { status: 200 };
      return Promise.resolve(Response.json(response.body ?? { id: DERIVED_USER_ID }, { status: response.status }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };

  return {
    fetchFn,
    calls,
    callsTo: (suffix: string) => calls.filter((call) => call.url.endsWith(suffix)),
  };
}
