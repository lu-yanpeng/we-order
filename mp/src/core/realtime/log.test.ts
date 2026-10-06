/**
 * 日志脱敏单元测试（P3 Story 5.1；AR-P3-25 / NFR-P3-3「日志不含密钥」）
 */
import { describe, expect, it } from 'vitest'
import { redactLogMessage } from './log'

describe('redactLogMessage', () => {
  it('脱敏 apikey 查询参数（大小写不敏感），保留其余参数', () => {
    expect(
      redactLogMessage('connected to ws://h/realtime/v1/websocket?apikey=abc123&vsn=2.0.0'),
    ).toBe('connected to ws://h/realtime/v1/websocket?apikey=***&vsn=2.0.0')
    expect(redactLogMessage('x?APIKEY=secret')).toBe('x?APIKEY=***')
  })

  it('不含 apikey 的消息原样输出', () => {
    expect(redactLogMessage('phx_join (6, 6)')).toBe('phx_join (6, 6)')
  })
})
