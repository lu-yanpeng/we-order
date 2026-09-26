/**
 * 商品目录 API 层
 *
 * 统一数据入口，负责加载全部分类及其商品（`public.menu` 视图形状）。
 * Phase 3 Epic 1：数据源仍是 Mock，但方法签名与返回形状已对齐服务端契约
 * （types/api-contracts.ts），Epic 2 切换真实数据时只改本文件内部。
 */
import type { MenuCategory } from '@/types/api-contracts'
import { mockCategories } from '@/mock/products'

/**
 * 获取全部分类及其商品列表
 * 模拟 300ms 网络延迟
 */
export async function fetchCategories(): Promise<MenuCategory[]> {
  await new Promise((resolve) => setTimeout(resolve, 300))
  return mockCategories
}
