// wechat-login 边缘函数入口（Story 2.1 / 2.2 / 2.3）。
// 2.1：一次性凭证 → openid 换取与错误分类；2.2：openid → 平台用户与身份映射；
// 2.3：生成一次性登录令牌并立即兑换为平台会话，把会话返回客户端（令牌不落客户端）。
// 函数被调用时尚无会话：config.toml 已关闭平台前置 JWT 校验，输入由 handler 自行校验（AR-5）。

import { handleRequest } from "./handler.ts";
import { createServiceClient, resolveWechatIdentity } from "./identity.ts";
import { createSessionIssuer, createVerifyClient } from "./session.ts";

const appId = Deno.env.get("WECHAT_APP_ID") ?? "";
const appSecret = Deno.env.get("WECHAT_APP_SECRET") ?? "";

// 服务端密钥与发布密钥由平台注入；服务端密钥不入仓、不到客户端（AR-5）。
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceClient = createServiceClient(
  supabaseUrl,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);
const verifyClient = createVerifyClient(
  supabaseUrl,
  Deno.env.get("SUPABASE_ANON_KEY") ?? "",
);
const issueSession = createSessionIssuer(serviceClient, verifyClient);

Deno.serve((req) =>
  handleRequest(req, {
    appId,
    appSecret,
    fetchFn: fetch,
    resolveIdentity: (openid) => resolveWechatIdentity(openid, serviceClient),
    issueSession,
    // 关键失败日志：类别 + 请求标识；不含密钥、堆栈或数据库细节（NFR3、Story 2.6）
    log: (record) => console.error(JSON.stringify(record)),
  })
);
