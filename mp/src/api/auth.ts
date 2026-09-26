/**
 * 会话门面（P3 AD-2、AR-P3-6）：仅转调 `core/session`，不自建登录请求。
 *
 * 上层（页面 / Composable）只经这里接触会话能力：
 * - `warmUpSession()`：启动预热（Story 1.4 的启动编排调用，验证页也用它）；
 * - `getSessionUser()`：会合会话后返回本人标识（订单、订阅等场景）。
 *
 * 「未登录」不是对外状态：要么成功，要么抛 `AppError`（按类别翻译文案）；
 * 上层代码不出现 token 一词，也不感知凭证的存取与续期。
 */
import { ensureSession, getUserId } from '@/core/session'
import type { AppError } from '@/types/errors'

/** 启动预热：触发静默登录 / 续期；失败静默（在需要身份的动作处再暴露） */
export function warmUpSession(): Promise<void> {
  return ensureSession().catch(() => {
    // 预热失败不弹全局提示、不留下半登录状态；下一次动作会重新会合
  })
}

/** 等待会话就绪并返回本人标识；失败抛 AppError（由调用方翻译文案） */
export async function getSessionUser(): Promise<{ id: string }> {
  await ensureSession()
  const id = getUserId()
  if (id === undefined) {
    // 会合成功后必然有身份；到这里说明状态机被破坏，按登录域 unknown 兜底
    throw { source: 'login', code: 'unknown' } satisfies AppError
  }
  return { id }
}
