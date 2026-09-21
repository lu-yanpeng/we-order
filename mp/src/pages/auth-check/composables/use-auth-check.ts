/**
 * 身份链路验证 Composable（Story 2.4 / 2.5 / 2.6 的临时入口）
 *
 * 职责：调用 api/auth 的对外出口，把结果整理成页面可展示的状态。
 * 页面只做编排；本 composable 仅本页面使用，按 AD-9 放在页面目录内。
 * Phase 2 结束后整个验证页（含本文件）删除。
 */
import { ref } from 'vue'
import { AuthError, authErrorMessage, getSessionUser, type LoginErrorCode } from '@/api/auth'

/** 单条验证结果 */
export type CheckResult = {
  ok: boolean
  detail: string
}

/** 失败展示：类别 + 文案（+ 请求标识，便于与服务端日志对账） */
function describeFailure(error: unknown): string {
  if (error instanceof AuthError) {
    const requestId = error.requestId === undefined ? '' : `（请求标识 ${error.requestId}）`
    return `[${error.code}] ${authErrorMessage(error)}${requestId}`
  }
  return authErrorMessage(error)
}

/** 发起一次受保护请求并收集结果 */
async function checkOnce(index: number): Promise<CheckResult> {
  try {
    const user = await getSessionUser()
    return { ok: true, detail: `#${index} 成功：${user.id}` }
  } catch (error) {
    return { ok: false, detail: `#${index} ${describeFailure(error)}` }
  }
}

/** Story 2.6：三类关键失败的类别（文案自检用，渲染仍走唯一的翻译函数） */
const SELF_CHECK_CODES: LoginErrorCode[] = [
  'network_unreachable',
  'rate_limited',
  'code_expired_or_used',
]

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

  /** 【错误文案自检】三类关键失败的文案是否互不相同（喂给同一个翻译函数） */
  const selfCheck = () => {
    results.value = SELF_CHECK_CODES.map((code) => ({
      ok: false,
      detail: `[${code}] ${authErrorMessage(new AuthError(code, ''))}`,
    }))
  }

  return { verifying, verifyingConcurrent, results, verify, verifyConcurrent, selfCheck }
}
