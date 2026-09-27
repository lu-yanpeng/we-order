/**
 * 启动编排（P3 AD-4 / AD-15）：`App.vue:onLaunch` 的唯一入口
 *
 * 顺序固定、责任单一：
 * 1. `migrateStorageOnce()`——**同步且第一步**：清空 Mock 时代存量数据并写版本戳。
 *    它先于任何页面 / store 的存储读取（水合只发生在页面 setup，必然更晚），
 *    因此界面不可能读到任何 Mock 内容；
 * 2. `warmUpSession()`——**异步、不阻塞页面**：触发静默登录 / 续期，失败静默
 *    （在需要身份的动作处再按类别暴露），不产生半登录状态。
 *
 * 本 composable 不持有响应式状态；唯一调用方是 App.vue（主包），符合 P1 AD-9。
 */
import { warmUpSession } from '@/api/auth'
import { migrateStorageOnce } from '@/api/storage'

export function useAppBootstrap(): void {
  migrateStorageOnce()
  void warmUpSession()
}
