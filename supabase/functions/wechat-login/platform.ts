import type { FetchLike } from "./wechat.ts";

/**
 * 平台调用的公共配置与请求构造：service role 的 apikey / Authorization 只在这里拼一次，
 * 身份（identity.ts）与会话（session.ts）共用，避免同一份鉴权头出现两处实现（AR-5）。
 */
export type PlatformConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchFn?: FetchLike;
};

export function request(config: PlatformConfig, url: string, init: RequestInit): Promise<Response> {
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
