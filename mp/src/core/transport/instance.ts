/**
 * 通道实例：业务通道 + 裸通道（P3 AD-2、AD-5、AD-6）
 *
 * - alova 实例与全部拦截器只存在于本文件（`core/transport` 内）；
 * - 实例级关闭响应缓存与请求共享（`cacheFor: null`、`shareRequest: false`），
 *   方法作者不得依赖默认值或逐方法覆盖；
 * - 业务通道：请求前构造唯一请求头（apikey 恒带、按 meta.auth 附 Authorization），
 *   非 2xx / 传输失败统一归一为 `AppError`；会话类失败（401 / PGRST301 / not_authenticated）
 *   经 provider 续期后**只重放一次**，恢复失败 → `client.session_expired`；
 * - 裸通道：不挂续期 / 重登逻辑，凭证经 `meta.accessToken` 显式传入，
 *   仅供 `core/session` 调平台 auth 端点与 `wechat-login` 使用。
 *
 * 实现细节：alova 的 `responded.onSuccess` 会收到非 2xx 响应（uni 的 success 回调
 * 对 4xx/5xx 也触发），`responded.onError` 只收网络类失败；重放用 `await method`
 * （alova 的 Method 是 Promise，await 即重新发送），`meta.sessionRetried` 保证只重放一次。
 */
import { createAlova, type Method } from 'alova'
import AdapterUniapp from '@alova/adapter-uniapp'
import { buildHeaders } from './headers'
import type { RawTransportMeta, TransportMeta } from './meta'
import {
  isSessionFailure,
  normalizeFailure,
  readResponseData,
  routeOfUrl,
  sessionExpiredError,
  toHttpFailure,
  toTransportFailure,
  type HttpFailure,
} from './normalize'
import { getSessionProvider } from './provider'

export type TransportOptions = {
  /** Supabase 项目地址（末尾无斜杠） */
  baseURL: string
  /** 发布密钥（可公开，恒放 apikey） */
  publishableKey: string
  /** 全局请求超时（毫秒）；方法级 config.timeout 可覆盖 */
  timeoutMs?: number
}

/** 默认请求超时：本地演示不出现长挂起；超时归入 client.timeout（FR-P3-9 的结果不明类别） */
const DEFAULT_TIMEOUT_MS = 10000

/**
 * 会话类失败的处理：续期 / 重登后**重放一次**。
 * - provider 未注册（测试或裸用通道）→ 直接归一为 client.session_expired；
 * - 已有重放标记（重放后的响应仍是会话类）→ 归一为 client.session_expired；
 * - 恢复本身失败 → 归一为 client.session_expired（不把登录域错误上浮给消费方）。
 */
async function replayOnceOrThrow(method: Method, failure: HttpFailure): Promise<unknown> {
  if (!isSessionFailure(failure)) throw normalizeFailure(failure)

  const provider = getSessionProvider()
  const meta = method.meta as TransportMeta | undefined
  if (provider === null || meta === undefined || meta.sessionRetried === true) {
    throw sessionExpiredError(failure)
  }

  meta.sessionRetried = true
  try {
    try {
      await provider.ensureSession(true)
    } catch {
      throw sessionExpiredError(failure)
    }
    // await Method === 重新发送；beforeRequest 会重新取最新凭证
    return await method
  } finally {
    delete meta.sessionRetried
  }
}

export function createTransport(options: TransportOptions) {
  const adapter = AdapterUniapp()
  const sharedOptions = {
    baseURL: options.baseURL,
    ...adapter,
    cacheFor: null,
    shareRequest: false,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }

  /** 业务通道：唯一请求头构造 + 错误归一 + 会话续期重放 */
  const business = createAlova({
    ...sharedOptions,
    beforeRequest: async (method) => {
      const meta = method.meta as TransportMeta | undefined
      const provider = getSessionProvider()
      const needsSession = meta?.auth === 'session-required'

      if (needsSession && provider !== null) {
        try {
          await provider.ensureSession()
        } catch {
          throw sessionExpiredError()
        }
      }

      Object.assign(
        method.config.headers,
        buildHeaders({
          publishableKey: options.publishableKey,
          accessToken: needsSession ? provider?.getAccessToken() : undefined,
          hasBody: method.data !== undefined,
        }),
      )
    },
    responded: {
      onSuccess: (response, method) => {
        const failure = toHttpFailure(response, routeOfUrl(method.url))
        if (failure === null) return readResponseData(response)
        return replayOnceOrThrow(method, failure)
      },
      onError: (error) => {
        throw normalizeFailure(toTransportFailure(error))
      },
    },
  })

  /** 裸通道：平台 auth 端点用；不等待会话、不续期、不重放 */
  const raw = createAlova({
    ...sharedOptions,
    beforeRequest: (method) => {
      const meta = method.meta as RawTransportMeta | undefined
      Object.assign(
        method.config.headers,
        buildHeaders({
          publishableKey: options.publishableKey,
          accessToken: meta?.accessToken,
          hasBody: method.data !== undefined,
        }),
      )
    },
    responded: {
      onSuccess: (response, method) => {
        const failure = toHttpFailure(response, routeOfUrl(method.url))
        if (failure === null) return readResponseData(response)
        throw normalizeFailure(failure)
      },
      onError: (error) => {
        throw normalizeFailure(toTransportFailure(error))
      },
    },
  })

  return { business, raw }
}
