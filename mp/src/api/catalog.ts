/**
 * 目录与门店 API 层（P3 AR-P3-2、AD-3）
 *
 * 唯一数据出口：页面 / Composable 不得越过本文件访问后端。
 * Story 2.1 起数据源从 Mock 切换为真实后端：
 * - 目录：`public.menu` 视图（REST）——一行 = 一个分类，下架已过滤、售罄带 availability；
 * - 门店：`public.stores` 行（REST）——本阶段只有一家门店，固定顺序取第一行；
 * - 图片：由 `image_path` 构造对象存储公开读 URL（纯地址拼接、不发请求，`<image>` 组件消费）。
 *
 * 身份要求全部为 `anonymous`：不等待会话（登录失败不阻塞目录浏览），请求只带发布密钥。
 * 旧 `api/products.ts` / `api/store.ts` 的 Mock 实现不再被调用，随 Story 2.3 删除。
 */
import { supabaseUrl, transport } from '@/core/transport'
import type { MenuCategory, StoreInfo } from '@/types/api-contracts'

/** 商品图片桶（公开读；对象由演示前人工上传，见 AR-P3-4） */
const PRODUCT_IMAGE_BUCKET = 'product-images'

/**
 * 获取全部分类及其商品列表。
 * 服务端来源：`public.menu` 视图（migrations/20260917103204_menu_view.sql）；
 * 排序由视图保证（分类 / 商品 / 规格组 / 选项各自的 sort_order），客户端不再排序。
 * 返回 alova Method：可 `await`，也可用 `useRequest` 包裹（AD-5）。
 */
export function fetchCategories() {
  return transport.Get<MenuCategory[]>('/rest/v1/menu', { meta: { auth: 'anonymous' } })
}

/**
 * 获取门店信息（本阶段固定取第一行）。
 * 服务端来源：`public.stores` 行（migrations/20260917091739_stores.sql）；
 * 只取目录展示需要的四列（不含 timezone）；无行时返回 null，由调用方兜底。
 */
export async function fetchStore(): Promise<StoreInfo | null> {
  const rows = await transport.Get<StoreInfo[]>('/rest/v1/stores', {
    params: { select: 'id,name,address,phone', order: 'id.asc', limit: 1 },
    meta: { auth: 'anonymous' },
  })
  return rows[0] ?? null
}

/**
 * 由 `products.image_path` 构造对象存储公开读 URL（缺图返回空串 → UI 以色块占位）。
 * 形状：`<项目地址>/storage/v1/object/public/<桶>/<路径>`，
 * 桶见 migrations/20260917094345_product_images_bucket.sql；
 * `image_path` 是存储中的相对路径，不是完整 URL。
 */
export function productImageUrl(imagePath: string | null): string {
  if (!imagePath) return ''
  return `${supabaseUrl()}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${imagePath}`
}
