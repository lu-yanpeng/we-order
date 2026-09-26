/**
 * 会话持久化：`weorder_session` 的**唯一**读写点（P3 AD-3 / AR-P3-7）
 *
 * - 只被 `core/session` 使用；页面 / Composable / `api/` 不得直接读写本 key；
 * - 形状与 Phase 2 一致（camelCase 四字段）：升级不强制重登，Story 1.4 的
 *   存量清理 gate 保留 `weorder_session`、有效会话直接复用；
 * - 内容不是合法 JSON 或缺字段时按「无会话」处理并清掉（自愈），
 *   绝不让半截数据进入状态机；只有完整会话才会被写入。
 */
import type { Session } from './types'

const STORAGE_KEY = 'weorder_session'

function isValidSession(value: unknown): value is Session {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.accessToken === 'string' &&
    record.accessToken !== '' &&
    typeof record.refreshToken === 'string' &&
    record.refreshToken !== '' &&
    typeof record.expiresAt === 'number' &&
    Number.isFinite(record.expiresAt) &&
    typeof record.userId === 'string' &&
    record.userId !== ''
  )
}

/** 启动时恢复会话；缺失 / 损坏时清掉并返回 null */
export function loadStoredSession(): Session | null {
  try {
    const raw: unknown = uni.getStorageSync(STORAGE_KEY)
    if (typeof raw === 'string' && raw !== '') {
      const parsed: unknown = JSON.parse(raw)
      if (isValidSession(parsed)) return parsed
    }
  } catch {
    // 读取失败或内容不是合法 JSON：按无会话处理
  }
  clearStoredSession()
  return null
}

/** 持久化一份完整会话；写入失败时静默（内存会话仍可用，不影响本次运行） */
export function saveStoredSession(session: Session): void {
  try {
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // 忽略：本地存储不是本次会话可用的必要条件
  }
}

/** 清除本地会话（凭证失效 / 内容损坏时调用） */
export function clearStoredSession(): void {
  try {
    uni.removeStorageSync(STORAGE_KEY)
  } catch {
    // 忽略
  }
}
