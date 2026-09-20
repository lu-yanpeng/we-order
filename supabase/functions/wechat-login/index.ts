// wechat-login 边缘函数入口（Story 2.1）。
// 本故事只做「一次性凭证 → openid 换取」与错误分类：
//   身份映射 / 用户建立属 Story 2.2，会话签发属 Story 2.3。
// 函数被调用时尚无会话：config.toml 已关闭平台前置 JWT 校验，输入由 handler 自行校验（AR-5）。

import { handleRequest } from "./handler.ts";

const appId = Deno.env.get("WECHAT_APP_ID") ?? "";
const appSecret = Deno.env.get("WECHAT_APP_SECRET") ?? "";

Deno.serve((req) => handleRequest(req, { appId, appSecret, fetchFn: fetch }));
