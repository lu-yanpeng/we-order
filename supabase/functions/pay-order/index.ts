// pay-order 边缘函数入口（P3 Story 3.2；FR-P3-8；AD-11、AD-12）。
// 客户端创建订单的唯一入口：平台先验签（config.toml 的 verify_jwt = true），
// handler 从已验签 JWT 读出声明的 sub，模拟支付后用服务端密钥调用 create_order_for_user。
// 语义 = 创建成功才返回支付成功；不存在第二套金额 / 归属 / 写路径，也不接真实支付渠道。

import { createClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "../../types/database.types.ts";
import { handleRequest } from "./handler.ts";
import { createOrderCreator } from "./order.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// 服务端密钥客户端：apikey 与 Authorization 都用服务端密钥；客户端 JWT 绝不进入这里（AD-11）。
// 密钥由平台注入运行环境（不入仓、不到客户端）。本函数不跨目录 import wechat-login：
// 部署只打包函数自身目录（见 README）。
const serviceClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve((req) =>
  handleRequest(req, {
    createOrder: createOrderCreator(serviceClient),
    // 关键失败日志：类别 + 请求标识；不含密钥、堆栈或数据库细节（NFR3）
    log: (record) => console.error(JSON.stringify(record)),
  })
);
