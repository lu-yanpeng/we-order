import { createPlatformClient } from "../../wechat-login/handler.ts";
import type { FetchLike } from "../../wechat-login/wechat.ts";

export const PLATFORM_URL = "http://platform.test";
export const SERVICE_KEY = "service-role-key";
export const WECHAT_OPENID = "o-test-openid";
/** 由 o-test-openid 派生的用户 id（钉住：改动派生规则会让既有映射对不上，必须是有意为之） */
export const DERIVED_USER_ID = "3ca3964a-bd2c-504f-afb7-69a38b4e061d";
/** generate_link 返回的一次性令牌（假响应取平台真实的平铺形状，由官方 SDK 归一化到 properties） */
export const TEST_TOKEN_HASH = "test-hashed-token";

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
  /** 生成一次性登录令牌接口的返回，默认 200 且带 TEST_TOKEN_HASH */
  generateLink?: { status: number; body?: unknown };
};

/** 建一个走假 fetch 的平台客户端：与函数内部同一条构造路径 */
export function fakeClient(fetchFn: FetchLike) {
  return createPlatformClient({ supabaseUrl: PLATFORM_URL, serviceRoleKey: SERVICE_KEY, fetchFn });
}

/** 把微信接口、平台 Admin API（建用户 / 生成登录令牌）、两个身份 RPC 都按 URL 路由的假 fetch（其余请求 404） */
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
    if (url === `${PLATFORM_URL}/auth/v1/admin/generate_link`) {
      const response = options.generateLink ?? { status: 200 };
      const body = response.body ?? {
        action_link: `http://platform.test/auth/v1/verify?token=${TEST_TOKEN_HASH}&type=magiclink`,
        email_otp: "123456",
        hashed_token: TEST_TOKEN_HASH,
        verification_type: "magiclink",
      };
      return Promise.resolve(Response.json(body, { status: response.status }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };

  return {
    fetchFn,
    calls,
    callsTo: (suffix: string) => calls.filter((call) => call.url.endsWith(suffix)),
  };
}
