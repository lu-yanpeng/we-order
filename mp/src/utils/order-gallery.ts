/**
 * 订单卡片图片行的纯函数（Story 4.7；FR-P3-10 展示增量）
 *
 * 图片行只占一行：每个明细行一格（不按数量展开）；放不下时前 k−1 格为商品图，
 * 第 k 格为渐变遮罩格（可垫下一张商品图）并显示 `+N`，
 * N = 未展示的明细行数 = 总行数 − (k−1)。
 *
 * 这里只做布局算术：容量 k 由 `order-card` 按实际宽度（rpx 设计常量）决定后传入；
 * 不做任何网络 / 状态 / 渲染逻辑（纯函数可单测）。
 */
export type GallerySlots = {
  /** 直接展示的图片格数（不含溢出格） */
  visibleCount: number
  /** 溢出格上的 +N；不溢出为 null */
  overflowCount: number | null
}

/**
 * 计算图片行的可见格数与溢出数。
 *
 * - `total <= capacity`：全部展示，无溢出格；
 * - `total > capacity`：展示 `capacity - 1` 张图 + 1 个溢出格（`+N`）。
 *
 * 容量下限收紧为 2（1 格宽的图片行没有意义）：容量异常时退化为「1 图 + 溢出格」。
 */
export function gallerySlots(total: number, capacity: number): GallerySlots {
  const k = Math.max(2, Math.floor(capacity))
  if (total <= 0) return { visibleCount: 0, overflowCount: null }
  if (total <= k) return { visibleCount: total, overflowCount: null }
  return { visibleCount: k - 1, overflowCount: total - (k - 1) }
}
