/**
 * 最小 URL 垫片（P3 Story 5.1；AD-9 的 PoC 第一验证点）
 *
 * realtime-js 在两处调用 `new URL(...)`：构造客户端时（`httpEndpointURL`）与
 * **构造 channel 时**（`RealtimeChannel` 的 `broadcastEndpointURL`），只读写
 * `protocol` / `pathname` / `href`。微信小程序宿主提供的 `URL` 有两种形态：
 * ① 不存在（真机常见）；② 存在但不是构造函数（开发者工具实测 `URL is not a constructor`）。
 * 因此这里不用「条件安装」，而是在两个构造点用 `withUrlShim()` **临时替换、用完还原**，
 * 既不依赖宿主形态，也不永久污染宿主全局。
 *
 * 实现范围刻意收窄：覆盖上述三个属性 + `host` / `search` / `hash` / `toString`
 * 的常见读写，不追求 WHATWG 全集（不计 `searchParams`、相对路径解析等）。
 */

/** 绝对 URL 解析：scheme://authority/path?query#fragment（authority / path 可空） */
const ABSOLUTE_URL_PATTERN = /^([a-zA-Z][a-zA-Z\d+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/

type AuthorityParts = {
  hostname: string
  port: string
}

/** 拆 authority（容忍 userinfo 与 IPv6 字面量；本项目的地址不含两者，属防御性实现） */
function splitAuthority(authority: string): AuthorityParts {
  const host = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end >= 0) {
      const rest = host.slice(end + 1)
      return { hostname: host.slice(0, end + 1), port: rest.startsWith(':') ? rest.slice(1) : '' }
    }
    return { hostname: host, port: '' }
  }
  const colon = host.lastIndexOf(':')
  if (colon === -1) return { hostname: host, port: '' }
  return { hostname: host.slice(0, colon), port: host.slice(colon + 1) }
}

export class MinimalUrl {
  private scheme = ''
  private authority = ''
  private path = '/'
  private query = ''
  private fragment = ''

  constructor(input: string) {
    this.parse(input)
  }

  private parse(input: string): void {
    const match = ABSOLUTE_URL_PATTERN.exec(input)
    if (match === null) {
      // 非绝对 URL：整体当路径处理（本垫片服务于绝对地址，此处仅保证不抛错）
      this.scheme = ''
      this.authority = ''
      this.path = input === '' ? '/' : input.startsWith('/') ? input : `/${input}`
      this.query = ''
      this.fragment = ''
      return
    }
    this.scheme = match[1] ?? ''
    this.authority = match[2] ?? ''
    this.path = match[3] === undefined || match[3] === '' ? '/' : match[3]
    this.query = match[4] ?? ''
    this.fragment = match[5] ?? ''
  }

  get protocol(): string {
    return this.scheme
  }

  set protocol(value: string) {
    this.scheme = value.endsWith(':') ? value : `${value}:`
  }

  get host(): string {
    return this.authority
  }

  get hostname(): string {
    return splitAuthority(this.authority).hostname
  }

  get port(): string {
    return splitAuthority(this.authority).port
  }

  get pathname(): string {
    return this.path
  }

  set pathname(value: string) {
    this.path = value.startsWith('/') ? value : `/${value}`
  }

  get search(): string {
    return this.query
  }

  set search(value: string) {
    this.query = value === '' || value.startsWith('?') ? value : `?${value}`
  }

  get hash(): string {
    return this.fragment
  }

  set hash(value: string) {
    this.fragment = value === '' || value.startsWith('#') ? value : `#${value}`
  }

  get origin(): string {
    return `${this.scheme}//${this.authority}`
  }

  get href(): string {
    if (this.scheme === '' && this.authority === '') {
      return `${this.path}${this.query}${this.fragment}`
    }
    return `${this.scheme}//${this.authority}${this.path}${this.query}${this.fragment}`
  }

  set href(value: string) {
    this.parse(value)
  }

  toString(): string {
    return this.href
  }
}

/** 把宿主全局上的 `URL` 换成垫片；替换失败（宿主冻结）返回 false */
function replaceUrl(scope: { URL?: unknown }, value: unknown): boolean {
  try {
    scope.URL = value
    if (scope.URL === value) return true
  } catch {
    // 落入 defineProperty 再试
  }
  try {
    Object.defineProperty(scope, 'URL', { value, configurable: true, writable: true })
    return scope.URL === value
  } catch {
    return false
  }
}

/**
 * 在回调执行期间提供 `MinimalUrl`，结束后还原宿主原值（含「原本不存在」的情况）。
 * 覆盖「客户端构造」与「channel 构造」两个 realtime-js 会 `new URL` 的时点。
 */
export function withUrlShim<T>(run: () => T): T {
  const scope = globalThis as unknown as { URL?: unknown }
  const hadOwn = Object.prototype.hasOwnProperty.call(scope, 'URL')
  const previous = scope.URL

  if (!replaceUrl(scope, MinimalUrl)) {
    // 宿主全局不可改写：保持原样执行（若宿主 URL 可用则无碍；不可用则与宿主同因失败）
    return run()
  }

  try {
    return run()
  } finally {
    try {
      if (hadOwn) {
        replaceUrl(scope, previous)
      } else {
        delete scope.URL
      }
    } catch {
      // 还原失败不阻断主流程
    }
  }
}
