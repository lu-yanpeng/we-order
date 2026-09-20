// wechat-login 边缘函数入口（Story 2.1 / 2.2）。
// 2.1：一次性凭证 → openid 换取与错误分类；2.2：openid → 平台用户与身份映射。
// 会话签发属 Story 2.3。
// 函数被调用时尚无会话：config.toml 已关闭平台前置 JWT 校验，输入由 handler 自行校验（AR-5）。

import { handleRequest } from "./handler.ts";
import { createServiceClient, resolveWechatIdentity } from "./identity.ts";

const appId = Deno.env.get("WECHAT_APP_ID") ?? "";
const appSecret = Deno.env.get("WECHAT_APP_SECRET") ?? "";

// SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY 由平台注入；服务端密钥不入仓、不到客户端（AR-5）。
const serviceClient = createServiceClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve((req) =>
  handleRequest(req, {
    appId,
    appSecret,
    fetchFn: fetch,
    resolveIdentity: (openid) => resolveWechatIdentity(openid, serviceClient),
  })
);
