/**
 * 请求头构造：全仓**唯一**实现（P3 AD-5、AD-25 / AR-P3-25）
 *
 * - `apikey` 恒带发布密钥；
 * - `Authorization: Bearer <访问凭证>` 仅在有凭证时附；发布密钥不是 JWT、绝不放入 Authorization；
 * - 有请求体时显式声明 `Content-Type: application/json`；
 * - 服务端密钥（service_role）只允许出现在服务端，客户端不提供任何注入入口。
 */
export type HeaderInput = {
  /** 发布密钥（构建变量注入，可公开） */
  publishableKey: string
  /** 访问凭证；anonymous 请求不传 */
  accessToken?: string
  /** 是否携带请求体（决定是否声明 Content-Type） */
  hasBody: boolean
}

export function buildHeaders({
  publishableKey,
  accessToken,
  hasBody,
}: HeaderInput): Record<string, string> {
  const headers: Record<string, string> = { apikey: publishableKey }
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (accessToken !== undefined && accessToken !== '') {
    headers.Authorization = `Bearer ${accessToken}`
  }
  return headers
}
