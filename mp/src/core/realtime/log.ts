/**
 * Realtime 开发期日志（NFR-P3-5；Story 5.1 AC「固定前缀日志」）
 *
 * 只输出连接 / 订阅 / 退订 / 回退 / 恢复等生命周期事件；
 * 不含访问凭证、本人 id 与消息载荷（不把库的 `data` 透传出来）；
 * 库的 transport 日志会带 apikey 查询参数 → 输出前脱敏（发布密钥非敏感，仍遵循
 * 「日志不含密钥」的约定，AR-P3-25 / NFR-P3-3）。
 */
export const REALTIME_LOG_PREFIX = '[realtime]'

/** 脱敏 `apikey=<值>`（大小写不敏感、保留原参数名大小写；不碰其他参数与消息内容） */
export function redactLogMessage(message: string): string {
  return message.replace(/(apikey)=[^&\s]+/gi, '$1=***')
}

export function realtimeLog(...args: unknown[]): void {
  console.log(REALTIME_LOG_PREFIX, ...args)
}
