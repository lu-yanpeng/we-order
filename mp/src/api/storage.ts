/**
 * 存量清理 gate：`migrateStorageOnce()`（P3 AD-15 / AR-P3-19）
 *
 * 唯一职责：在 `onLaunch` 第一步**同步**执行一次本地存储版本迁移——
 * 数据世代低于当前版本的设备，按版本清单清空不再兼容的存量数据并写入
 * `weorder_schema_version = 3`；`weorder_session` 按约定保留（有效会话直接复用）。
 *
 * 设计要点：
 * - 只做「丢弃 + 盖章」，不做数据搬运：v3 退役的旧购物车引用的商品是 Mock 数据，
 *   在真实目录中不存在，跨版本复用会取回旧订单 / 引发「加购成功、下单报商品不存在」；
 * - 清理清单**按版本分组**：每代只清自己列出的 key，当前世代（= 3）的启动一律空转，
 *   因此真实购物车不会被反复清空；将来新增版本时新增一组、不改旧组，
 *   也不要把仍然有效的活数据（如当前购物车）列进去；
 * - 全部同步读写：保证完成前页面不会读取存储（启动时序 gate）；
 * - 任何存储异常都不得阻塞启动：清不干净就不写版本戳，下次启动自动重试（删除幂等）。
 *
 * 唯一调用方：`composables/use-app-bootstrap.ts`（启动编排第一步）。
 */

/** 本地存储的数据世代：低于它的设备在启动时执行对应版本的清理 */
const SCHEMA_VERSION = 3

const VERSION_KEY = 'weorder_schema_version'

/**
 * 按目标版本分组的「退役 key」清单；迁移时只执行 `当前版本 < version` 的组。
 * v3 = Mock 时代存量数据（订单 / 购物车 / 结算意图）。
 */
const RETIRED_KEYS_BY_VERSION: ReadonlyArray<{ version: number; keys: readonly string[] }> = [
  { version: 3, keys: ['weorder_orders', 'weorder_cart', 'weorder_checkout_intent'] },
]

/** 读取当前数据版本；缺失 / 非数字按 0（从未迁移） */
function readSchemaVersion(): number {
  const raw: unknown = uni.getStorageSync(VERSION_KEY)
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

/** 数据世代低于当前版本时执行对应清理并写入版本戳；重复调用幂等 */
export function migrateStorageOnce(): void {
  try {
    const current = readSchemaVersion()
    if (current >= SCHEMA_VERSION) return

    for (const step of RETIRED_KEYS_BY_VERSION) {
      if (current < step.version) {
        for (const key of step.keys) {
          uni.removeStorageSync(key)
        }
      }
    }
    uni.setStorageSync(VERSION_KEY, SCHEMA_VERSION)
  } catch {
    // 存储异常不阻塞启动；版本戳未写入，下次启动自动重试（删除操作幂等）
  }
}
