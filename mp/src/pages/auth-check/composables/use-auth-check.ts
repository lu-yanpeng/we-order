/**
 * 身份链路验证 Composable（Story 2.4 / 2.5 的临时入口）
 *
 * 职责：调用 api/auth 的对外出口，把结果整理成页面可展示的状态。
 * 页面只做编排；本 composable 仅本页面使用，按 AD-9 放在页面目录内。
 * Phase 2 结束后整个验证页（含本文件）删除。
 */
import { ref } from 'vue'
import { AuthError, getSessionUser } from '@/api/auth'

/** 单条验证结果 */
export type CheckResult = {
  ok: boolean
  detail: string
}

/** 把异常整理成「类别 + 文案」，便于在页面上定位失败原因 */
function describe(error: unknown): CheckResult {
  if (error instanceof AuthError) {
    return { ok: false, detail: `[${error.code}] ${error.message}` }
  }
  return { ok: false, detail: error instanceof Error ? error.message : String(error) }
}

/** 发起一次受保护请求并收集结果 */
async function checkOnce(index: number): Promise<CheckResult> {
  try {
    const user = await getSessionUser()
    return { ok: true, detail: `#${index} 成功：${user.id}` }
  } catch (error) {
    return { ok: false, detail: `#${index} ${describe(error).detail}` }
  }
}

export function useAuthCheck() {
  const verifying = ref(false)
  const verifyingConcurrent = ref(false)
  const results = ref<CheckResult[]>([])

  /** 【验证身份链路】一次受保护请求 */
  const verify = async () => {
    if (verifying.value) return
    verifying.value = true
    results.value = [await checkOnce(1)]
    verifying.value = false
  }

  /**
   * 【并发验证 ×3】同时发起三个受保护请求。
   * 会话已过期时用于验证单飞：网络面板应只出现一次续期请求。
   */
  const verifyConcurrent = async () => {
    if (verifyingConcurrent.value) return
    verifyingConcurrent.value = true
    results.value = await Promise.all([checkOnce(1), checkOnce(2), checkOnce(3)])
    verifyingConcurrent.value = false
  }

  return { verifying, verifyingConcurrent, results, verify, verifyConcurrent }
}
