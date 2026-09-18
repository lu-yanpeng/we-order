import { createWechatLoginHandler } from "./handler.ts";

// AppSecret 只来自服务端运行环境（平台 secret），不进仓库、不进客户端（AD-16）
const handler = createWechatLoginHandler({
  appId: Deno.env.get("WECHAT_APP_ID"),
  appSecret: Deno.env.get("WECHAT_APP_SECRET"),
});

Deno.serve(handler);
