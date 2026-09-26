/**
 * 会话模块的内部形状（P3 AD-2 / AD-4）
 *
 * - `PlatformSession`：平台会话响应（`wechat-login` 与平台 token 端点同构，
 *   见 `supabase/functions/wechat-login/README.md`），只在本模块内消费；
 * - `Session`：模块内部会话形状，同时是 `weorder_session` 的持久化形状——
 *   字段名与 Phase 2 完全一致（升级不强制重登；Story 1.4 的存量清理 gate
 *   保留 `weorder_session`、有效会话直接复用）。
 *
 * 对上层（api/ 及以上）不暴露本文件的类型；「凭证」一词不出 core/session。
 */

/** 平台会话响应（登录与续期同构） */
export type PlatformSession = {
  access_token: string
  refresh_token: string
  token_type?: string
  /** 平台通常同时返回 expires_in / expires_at；至少需要一个用于过期判断 */
  expires_in?: number
  /** Unix 秒 */
  expires_at?: number
  /** 只用到主体 id；完整 user 对象不外传 */
  user?: { id?: string }
}

/** 内部会话形状；存储 key `weorder_session` 的唯一承载 */
export type Session = {
  accessToken: string
  refreshToken: string
  /** Unix 秒 */
  expiresAt: number
  userId: string
}
