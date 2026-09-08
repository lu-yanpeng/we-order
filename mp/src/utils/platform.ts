/**
 * 平台能力查询工具（只读查询，不涉及业务数据）
 *
 * 这些函数直接调用 uni 平台 API 获取设备/系统信息，
 * 性质类似 Date.now()，属于只读工具函数。
 */

/** 获取底部安全区高度（刘海屏 / 底部横条避让），默认 8px */
export function getSafeBottom(): number {
  return uni.getWindowInfo().safeAreaInsets?.bottom || 8
}
