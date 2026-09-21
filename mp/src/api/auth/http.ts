/**
 * auth 模块的 HTTP 层：项目中唯一构造请求头的地方（AD-14、AD-16）。
 *
 * - 恒带 `apikey: <发布密钥>`；需要身份时附 `Authorization: Bearer <访问凭证>`
 * - 发布密钥不是 JWT，不得放入 Authorization
 * - 错误归一化为 AuthError：code 是稳定类别、message 只给人看、requestId 供与服务端日志对账
 * - 两类服务端错误载荷都兼容：边缘函数的 { code, message }、
 *   平台 auth 的 { code, error_code, msg }
 */
import { supabasePublishableKey, supabaseUrl } from './config'

export class AuthError extends Error {
  /**
   * 稳定类别：服务端错误类别（见 errors.ts 的 LoginErrorCode），或客户端判定的
   * network_unreachable。平台 auth 端点会返回不属于该枚举的错误码，故按字符串承载，
   * 由 `authErrorMessage` 做白名单翻译。
   */
  readonly code: string
  /** HTTP 状态码；网络不可达时为 undefined */
  readonly status?: number
  /** 服务端请求标识（响应头 x-request-id）；网络不可达时为 undefined */
  readonly requestId?: string

  constructor(code: string, message: string, status?: number, requestId?: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

type RequestOptions = {
  /** 相对 Supabase 项目地址的路径，如 `/auth/v1/user` */
  path: string
  method?: 'GET' | 'POST'
  /** JSON 请求体 */
  body?: Record<string, unknown>
  /** 传入才构造 Authorization；只允许本模块内部调用方使用 */
  accessToken?: string
}

function parseBody(data: string | AnyObject | ArrayBuffer): unknown {
  if (typeof data !== 'string') return data
  if (data === '') return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

/** 从两类错误载荷里提取稳定类别与文案 */
function readError(data: unknown): { code: string; message: string } {
  if (data !== null && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const code =
      typeof record.error_code === 'string'
        ? record.error_code
        : typeof record.code === 'string'
          ? record.code
          : undefined
    if (code !== undefined) {
      const message =
        typeof record.message === 'string'
          ? record.message
          : typeof record.msg === 'string'
            ? record.msg
            : code
      return { code, message }
    }
  }
  return { code: 'unknown', message: '请求被拒绝' }
}

/** 从响应头取服务端请求标识（uni.request 的 header 键为小写） */
function readRequestId(header: unknown): string | undefined {
  if (header === null || typeof header !== 'object') return undefined
  const value = (header as Record<string, unknown>)['x-request-id']
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 发起一次请求；2xx 返回解析后的响应体，其余抛 AuthError */
export function supabaseRequest<T>(options: RequestOptions): Promise<T> {
  const header: Record<string, string> = {
    apikey: supabasePublishableKey(),
    'Content-Type': 'application/json',
  }
  if (options.accessToken !== undefined) {
    header.Authorization = `Bearer ${options.accessToken}`
  }

  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${supabaseUrl()}${options.path}`,
      method: options.method ?? 'GET',
      header,
      data: options.body as AnyObject | undefined,
      success: (result) => {
        const body = parseBody(result.data)
        if (result.statusCode >= 200 && result.statusCode < 300) {
          resolve(body as T)
          return
        }
        const { code, message } = readError(body)
        reject(new AuthError(code, message, result.statusCode, readRequestId(result.header)))
      },
      fail: (error) => {
        // 网络不可达：类别与平台约定一致，供上层翻译（Story 2.6）
        reject(new AuthError('network_unreachable', `请求无法送达：${error.errMsg}`))
      },
    })
  })
}
