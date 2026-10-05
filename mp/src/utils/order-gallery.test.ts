/**
 * 订单卡片图片行纯函数单元测试（Story 4.7）
 *
 * 覆盖：容量内全部展示、正好占满、溢出时前 k−1 图 + `+N`（N = 总数 − (k−1)）、
 * 空数组、容量异常的下限保护。
 */
import { describe, expect, it } from 'vitest'
import { gallerySlots } from './order-gallery'

describe('gallerySlots（图片行：可见格数与溢出数）', () => {
  it('没有明细行：不展示任何格子、无溢出', () => {
    expect(gallerySlots(0, 4)).toEqual({ visibleCount: 0, overflowCount: null })
  })

  it('总数小于容量：全部展示、无溢出', () => {
    expect(gallerySlots(1, 4)).toEqual({ visibleCount: 1, overflowCount: null })
    expect(gallerySlots(3, 4)).toEqual({ visibleCount: 3, overflowCount: null })
  })

  it('总数正好等于容量：全部展示、无溢出', () => {
    expect(gallerySlots(4, 4)).toEqual({ visibleCount: 4, overflowCount: null })
  })

  it('总数超出一格：前 k−1 图 + 溢出格，N = 总数 − (k−1)', () => {
    expect(gallerySlots(5, 4)).toEqual({ visibleCount: 3, overflowCount: 2 })
  })

  it('总数远大于容量：溢出数覆盖所有未展示行', () => {
    expect(gallerySlots(9, 4)).toEqual({ visibleCount: 3, overflowCount: 6 })
  })

  it('容量异常（小于 2）：退化为「1 图 + 溢出格」，不会出现 0 可见格', () => {
    expect(gallerySlots(3, 1)).toEqual({ visibleCount: 1, overflowCount: 2 })
    expect(gallerySlots(2, 0)).toEqual({ visibleCount: 2, overflowCount: null })
  })
})
