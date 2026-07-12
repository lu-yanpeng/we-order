/**
 * 商品 API 层
 *
 * 统一数据入口，负责从数据源加载商品分类。
 * Phase 1 使用 Mock 数据模拟网络延迟。
 */
import type { Category } from '@/types/product'
import { mockCategories } from '@/mock/products'

/**
 * 获取全部分类及其商品列表
 * 模拟 300ms 网络延迟
 */
export async function fetchCategories(): Promise<Category[]> {
  await new Promise((resolve) => setTimeout(resolve, 300))
  return mockCategories
}
