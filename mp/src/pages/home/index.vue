<script setup lang="ts">
/**
 * 首页 — 点餐与订单双 Tab 页面
 *
 * 遵循 AD-3：页面仅负责组件编排和布局，
 * 业务逻辑由 useProducts / useSpecSheet 两个 Composable 承载。
 */
import { nextTick, onMounted, ref } from 'vue'
import type { Product } from '@/types/product'
import { useProducts } from '@/composables/use-products'
import { useSpecSheet } from '@/composables/use-spec-sheet'
import ProductCard from './components/product-card/index.vue'
import SpecSheet from './components/spec-sheet/index.vue'
import CheckoutBar from '@/sub-components/checkout-bar/index.vue'

const {
  categories,
  activeCategory,
  scrollIntoViewId,
  handleSidebarClick,
  handleContentScroll,
  init: initProducts,
} = useProducts()

const { visible, currentProduct, open: openSpecSheet } = useSpecSheet()

/** 点击商品加号 → 打开规格弹窗 */
const handleAddToCart = (product: Product) => {
  openSpecSheet(product)
}

/**
 * 规格弹窗确认回调
 * 目前 Phase 1 仅打印日志，Phase 4 对接购物车 Pinia store。
 */
const handleSpecConfirm = (payload: {
  selections: Record<string, string | string[]>
  count: number
}) => {
  console.log('spec-confirm', currentProduct.value?.name, payload)
  visible.value = false
}

// 顶栏 Tab ↔ swiper 双向同步
const activeTab = ref('menu')
const swiperIndex = ref(0)

const onTabChange = (e: { value: string | number }) => {
  activeTab.value = String(e.value)
  swiperIndex.value = e.value === 'menu' ? 0 : 1
}

const onSwiperChange = (e: { detail: { current: number } }) => {
  activeTab.value = e.detail.current === 0 ? 'menu' : 'orders'
}

onMounted(() => {
  initProducts()
  // TDesign tabs 受控模式下首屏不渲染激活态指示器的 workaround
  setTimeout(() => {
    const current = activeTab.value
    activeTab.value = ''
    nextTick(() => {
      activeTab.value = current
    })
  }, 100)
})
</script>

<template>
  <view class="flex h-screen flex-col bg-sb-warm">
    <t-tabs
      :value="activeTab"
      :space-evenly="false"
      :show-bottom-line="true"
      :split="false"
      theme="line"
      custom-style="--td-spacer-2: 27rpx; padding-left: 20rpx"
      @change="onTabChange"
    >
      <t-tab-panel label="点餐" value="menu" />
      <t-tab-panel label="订单" value="orders" />
    </t-tabs>

    <swiper class="flex-1" :current="swiperIndex" :duration="250" @change="onSwiperChange">
      <swiper-item>
        <view class="flex h-full overflow-hidden">
          <view class="sidebar w-1/5 shrink-0 flex-col bg-[#f7f8fa]">
            <scroll-view class="flex-1" scroll-y :enhanced="true" :show-scrollbar="false">
              <view
                v-for="cat in categories"
                :key="cat.id"
                class="sidebar-item"
                :class="{ 'sidebar-item--active': activeCategory === cat.id }"
                @click="handleSidebarClick(cat.id)"
              >
                <text class="sidebar-item-text">{{ cat.name }}</text>
              </view>
              <view class="flex-1 bg-[#f7f8fa]" />
            </scroll-view>
          </view>

          <scroll-view
            class="content-area"
            scroll-y
            :enhanced="true"
            :show-scrollbar="false"
            :scroll-into-view="scrollIntoViewId"
            :scroll-with-animation="true"
            @scroll="handleContentScroll"
          >
            <view v-for="cat in categories" :key="cat.id" :id="cat.id" class="category-section">
              <view class="category-title">
                {{ cat.name }}
              </view>
              <view class="pl-4 pr-5">
                <view v-for="product in cat.products" :key="product.id">
                  <ProductCard :product="product" @add-to-cart="handleAddToCart" />
                </view>
              </view>
            </view>
            <view class="list-footer">
              <text class="list-footer-text">--- 到底了 ---</text>
            </view>
          </scroll-view>
        </view>
      </swiper-item>
      <swiper-item>
        <view class="flex h-full items-center justify-center">
          <text class="text-base text-sb-text-soft">订单 - 待开发</text>
        </view>
      </swiper-item>
    </swiper>

    <checkout-bar />
    <SpecSheet v-model:visible="visible" :product="currentProduct" @confirm="handleSpecConfirm" />
  </view>
</template>

<style scoped>
.sidebar-item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  padding: 0 16rpx;
  font-size: 24rpx;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.58);
  transition: all 150ms ease;
}

.sidebar-item-text {
  max-width: 96rpx;
  word-break: break-all;
  line-height: 28rpx;
  text-align: center;
}

.sidebar-item--active {
  background-color: #ffffff;
  color: #006241;
  font-weight: 700;
}

.category-title {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 24rpx 0 24rpx 32rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.58);
  letter-spacing: 0.05em;
  background-color: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12rpx);
  -webkit-backdrop-filter: blur(12rpx);
}

.list-footer {
  display: flex;
  justify-content: center;
  padding: 48rpx 0 96rpx;
}

.list-footer-text {
  font-size: 22rpx;
  color: rgba(0, 0, 0, 0.2);
}
</style>
