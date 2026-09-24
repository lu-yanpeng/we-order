/**
 * 静默登录：取微信一次性凭证 → 边缘函数换取平台会话（FR-P2-1 ~ FR-P2-3）。
 *
 * - 换取只在服务端发生，AppSecret 不进入客户端（AD-16）
 * - 身份映射与用户建立由边缘函数完成：同一 openid 始终映射到同一用户
 * - 失败抛 AuthError，类别来自服务端；凭证失效等类别由 Story 2.6 翻译成文案
 */
import { AuthError, supabaseRequest } from './http'

/** 登录边缘函数路径；本模块内部共用（含验证用的凭证重放） */
export const LOGIN_PATH = '/functions/v1/wechat-login'

/** 平台会话响应：登录与续期同构（见 supabase/functions/wechat-login/README.md） */
export type PlatformSession = {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  /** 平台通常返回；缺失时由 session 层按 expires_in 估算 */
  expires_at?: number
  /** 只用到主体 id；不读取完整 user（其中 synthetic email 由 openid 派生） */
  user?: { id: string }
}

/** 取微信一次性凭证；失败与「拿不到凭证」都归为可重试的类别 */
export function loginCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (result) => {
        if (typeof result.code === 'string' && result.code !== '') {
          resolve(result.code)
          return
        }
        reject(new AuthError('unknown', 'wx.login 未返回一次性凭证'))
      },
      fail: (error) => {
        reject(new AuthError('network_unreachable', `wx.login 失败：${error.errMsg}`))
      },
    })
  })
}

/** 静默登录一次，返回平台会话；失败时按服务端类别抛 AuthError */
export async function silentLogin(): Promise<PlatformSession> {
  const code = await loginCode()
  return supabaseRequest<PlatformSession>({
    path: LOGIN_PATH,
    method: 'POST',
    body: { code },
  })
}
