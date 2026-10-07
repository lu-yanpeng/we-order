/**
 * Loading 提示的宿主兼容工具
 *
 * 微信宿主的行为怪癖：`navigateTo` 跳页会触发当前页 `onHide`，宿主自动把 loading 隐藏；
 * 跳转后（`complete`）再调 `uni.hideLoading()` 清理时，真机已没有可隐藏的 loading，
 * 会以 `hideLoading:fail:toast can't be found` 失败（未处理的 Promise 拒绝）。
 * 开发者工具上这句 hide 仍需保留——它能清掉「返回上一页时重新冒出来」的 loading。
 */

/**
 * 静默隐藏 loading：成功照常清理，失败无感（无 loading 可隐藏属预期态）。
 *
 * 传 `fail` 回调让 uni 不走 Promise 分支（从根上避免未处理的拒绝）；
 * 当前 `@dcloudio/types` 尚未声明 hideLoading 的回调重载，按运行时形状收窄调用。
 */
export function hideLoadingQuietly(): void {
  const hideLoading = uni.hideLoading as unknown as (options: { fail: () => void }) => void
  hideLoading({ fail: () => {} })
}
