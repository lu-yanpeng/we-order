/**
 * 身份链路验证 Composable（Phase 2 临时入口；Story 1.3 起接线 core/session）
 *
 * 职责：调用 api/auth 的对外出口，把结果整理成页面可展示的状态。
 * 页面只做编排；本 composable 仅本页面使用，按 P1 AD-9 放在页面目录内。
 * Phase 3 Story 2.3 随验证页（含本文件）删除。
 */
import { ref } from 'vue'
import { getSessionUser } from '@/api/auth'
import type { AppError } from '@/types/errors'
import { errorCopy, isAppError } from '@/utils/error-copy'

/** 单条验证结果 */
export type CheckResult = {
  ok: boolean
  detail: string
}

/** 失败展示：类别 + 文案（+ 请求标识，便于与服务端日志对账） */
function describeFailure(error: unknown): string {
  if (isAppError(error)) {
    const requestId = error.requestId === undefined ? '' : `（请求标识 ${error.requestId}）`
    return `[${error.code}] ${errorCopy(error)}${requestId}`
  }
  return '未知失败'
}

/** 发起一次身份的会合与读取并收集结果 */
async function checkOnce(index: number): Promise<CheckResult> {
  try {
    const user = await getSessionUser()
    return { ok: true, detail: `#${index} 成功：${user.id}` }
  } catch (error) {
    return { ok: false, detail: `#${index} ${describeFailure(error)}` }
  }
}

/** 文案自检用：三域各取一个类别，喂给唯一的翻译函数（渲染仍走 errorCopy） */
const SELF_CHECK_ERRORS: AppError[] = [
  { source: 'client', code: 'network_unreachable' },
  { source: 'login', code: 'rate_limited' },
  { source: 'order', code: 'product_unavailable' },
]

export function useAuthCheck() {
  const warming = ref(false)
  const verifyingConcurrent = ref(false)
  const results = ref<CheckResult[]>([])

  /** 【会话预热 / 当前身份】触发同一条会合链路（静默登录 / 续期）并读取本人标识 */
  const warmUp = async () => {
    if (warming.value) return
    warming.value = true
    try {
      results.value = [await checkOnce(1)]
    } finally {
      warming.value = false
    }
  }

  /**
   * 【并发验证 ×3】同时发起三个身份读取。
   * 会话已过期时用于验证单飞：网络面板应只出现一次续期请求。
   */
  const verifyConcurrent = async () => {
    if (verifyingConcurrent.value) return
    verifyingConcurrent.value = true
    try {
      results.value = await Promise.all([checkOnce(1), checkOnce(2), checkOnce(3)])
    } finally {
      verifyingConcurrent.value = false
    }
  }

  /** 【失败文案自检】三域类别经同一翻译函数后互不相同、无敏感信息 */
  const selfCheck = () => {
    results.value = SELF_CHECK_ERRORS.map((error) => ({
      ok: false,
      detail: `[${error.code}] ${errorCopy(error)}`,
    }))
  }

  return { warming, verifyingConcurrent, results, warmUp, verifyConcurrent, selfCheck }
}
