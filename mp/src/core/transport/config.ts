/**
 * transport 的构建变量（环境配置）
 *
 * 两个变量都在构建时注入（见 mp/.env.example，本地复制为 .env.local，不入仓）：
 * - VITE_SUPABASE_URL：Supabase 项目地址（本地栈 = http://127.0.0.1:54321）
 * - VITE_SUPABASE_PUBLISHABLE_KEY：发布密钥
 *
 * 遵循 AD-25：客户端只允许出现发布密钥；服务端密钥与 AppSecret 不进入客户端。
 * Story 1.2 阶段 api/auth/config.ts 仍是同样两个变量的旧读取点（Story 1.3 随会话
 * 重建删除）；过渡期两份并存，取值口径一致。
 */
const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '')

/** Supabase 项目地址（末尾斜杠已去掉） */
export function supabaseUrl(): string {
  if (url === '') throw new Error('缺少构建变量 VITE_SUPABASE_URL')
  return url
}

/** 发布密钥：随请求头传递，不是 JWT、不放入 Authorization（AD-25） */
export function supabasePublishableKey(): string {
  if (publishableKey === '') throw new Error('缺少构建变量 VITE_SUPABASE_PUBLISHABLE_KEY')
  return publishableKey
}
