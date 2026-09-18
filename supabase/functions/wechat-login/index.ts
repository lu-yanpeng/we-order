import { createWechatLoginHandler } from "./handler.ts";

// AppSecret 只来自服务端运行环境（平台 secret），不进仓库、不进客户端（AD-16）
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台注入，用于建平台用户与读写身份映射
const handler = createWechatLoginHandler({
  appId: Deno.env.get("WECHAT_APP_ID"),
  appSecret: Deno.env.get("WECHAT_APP_SECRET"),
  supabaseUrl: Deno.env.get("SUPABASE_URL"),
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
});

Deno.serve(handler);
