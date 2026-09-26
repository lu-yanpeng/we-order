/**
 * 登录 / 续期的协议调用（P3 AD-2、AD-4）
 *
 * 三个动作全部经 `core/transport` 的**裸通道**（不等待会话、不续期、不重放）：
 * - `fetchLoginCode`：`uni.login` 取微信一次性凭证；
 * - `loginWithCode`：边缘函数 `wechat-login` 换取平台会话（同一 openid 映射同一身份）；
 * - `refreshWithToken`：平台 token 端点续期（平台会轮换刷新凭证）。
 *
 * 失败：裸通道抛 `AppError`；`uni.login` 自身的失败在此归一为客户端类别。
 * 会话模块据此分类（可重试 / 需回退重登），本文件不做重试与状态。
 */
import { rawTransport } from '@/core/transport'
import type { AppError } from '@/types/errors'
import type { PlatformSession } from './types'

/** 登录边缘函数路径（服务端入口，见 supabase/functions/wechat-login/README.md） */
const LOGIN_PATH = '/functions/v1/wechat-login'

/** 平台续期端点（grant_type=refresh_token，响应与登录同构） */
const REFRESH_PATH = '/auth/v1/token?grant_type=refresh_token'

/** 取微信一次性凭证；失败按客户端类别上抛（属可重试类别） */
export function fetchLoginCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (result) => {
        if (typeof result.code === 'string' && result.code !== '') {
          resolve(result.code)
          return
        }
        // 平台未返回凭证：登录域未知类别（不自动重试，暴露给调用方）
        reject({ source: 'login', code: 'unknown' } satisfies AppError)
      },
      fail: () => {
        // wx.login 失败多为网络 / 运行时问题：可重试的客户端类别
        reject({ source: 'client', code: 'network_unreachable' } satisfies AppError)
      },
    })
  })
}

/** 一次性凭证换平台会话 */
export function loginWithCode(code: string): Promise<PlatformSession> {
  return rawTransport.Post<PlatformSession>(LOGIN_PATH, { code }).send()
}

/** 刷新凭证换新会话 */
export function refreshWithToken(refreshToken: string): Promise<PlatformSession> {
  return rawTransport.Post<PlatformSession>(REFRESH_PATH, { refresh_token: refreshToken }).send()
}
