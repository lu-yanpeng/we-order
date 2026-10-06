/**
 * 最小 URL 垫片单元测试（P3 Story 5.1；AD-9 的 PoC 第一验证点）
 *
 * 宿主 `URL` 有两种坏形态：不存在、存在但不是构造函数（开发者工具实测）；
 * `withUrlShim` 在构造点临时替换、用完还原。这里直接测垫片类与包装语义。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MinimalUrl, withUrlShim } from './url-shim'

describe('MinimalUrl', () => {
  it('解析 ws 绝对地址：protocol / host / pathname / search / href', () => {
    const url = new MinimalUrl('ws://127.0.0.1:54321/realtime/v1/websocket?apikey=key&vsn=2.0.0')
    expect(url.protocol).toBe('ws:')
    expect(url.host).toBe('127.0.0.1:54321')
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.port).toBe('54321')
    expect(url.pathname).toBe('/realtime/v1/websocket')
    expect(url.search).toBe('?apikey=key&vsn=2.0.0')
    expect(url.href).toBe('ws://127.0.0.1:54321/realtime/v1/websocket?apikey=key&vsn=2.0.0')
  })

  it('protocol / pathname 读写 + href 组合（realtime-js httpEndpointURL 的实际用法）', () => {
    const url = new MinimalUrl('wss://example.com/realtime/v1/websocket?apikey=k')
    url.protocol = url.protocol.replace(/^ws/i, 'http')
    url.pathname = url.pathname.replace(/\/websocket$/i, '') + '/api/broadcast'
    expect(url.href).toBe('https://example.com/realtime/v1/api/broadcast?apikey=k')
  })

  it('赋值容错：protocol 不带冒号、pathname 不带斜杠、search / hash 不带前缀', () => {
    const url = new MinimalUrl('ws://example.com/realtime/v1')
    url.protocol = 'http'
    url.pathname = 'api/broadcast'
    url.search = 'a=1'
    url.hash = 'top'
    expect(url.href).toBe('http://example.com/api/broadcast?a=1#top')
  })

  it('href setter 重新解析', () => {
    const url = new MinimalUrl('ws://a.test/')
    url.href = 'wss://b.test:9443/realtime/v1/websocket?x=1'
    expect(url.href).toBe('wss://b.test:9443/realtime/v1/websocket?x=1')
    expect(url.hostname).toBe('b.test')
    expect(url.port).toBe('9443')
  })

  it('非绝对输入不抛错（按路径处理）', () => {
    const url = new MinimalUrl('/realtime/v1')
    expect(url.pathname).toBe('/realtime/v1')
    expect(url.href).toBe('/realtime/v1')
  })
})

describe('withUrlShim', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('运行期间提供 MinimalUrl，结束后还原宿主原值', () => {
    class Sentinel {}
    vi.stubGlobal('URL', Sentinel)
    const during = withUrlShim(() => (globalThis as unknown as { URL: unknown }).URL)
    expect(during).toBe(MinimalUrl)
    expect((globalThis as unknown as { URL: unknown }).URL).toBe(Sentinel)
  })

  it('宿主「URL 存在但不是构造函数」时同样可构造（开发者工具实测形态）', () => {
    const broken = { createObjectURL: () => '' }
    vi.stubGlobal('URL', broken)
    const href = withUrlShim(() => {
      const Ctor = (globalThis as unknown as { URL: typeof MinimalUrl }).URL
      return new Ctor('ws://a.test/realtime/v1/websocket?q=1').href
    })
    expect(href).toBe('ws://a.test/realtime/v1/websocket?q=1')
    expect((globalThis as unknown as { URL: unknown }).URL).toBe(broken)
  })

  it('宿主原本无 URL（undefined）时：期间可用、结束还原为 undefined', () => {
    vi.stubGlobal('URL', undefined)
    const during = withUrlShim(() => (globalThis as unknown as { URL: unknown }).URL)
    expect(during).toBe(MinimalUrl)
    expect((globalThis as unknown as { URL: unknown }).URL).toBeUndefined()
  })
})
