<script setup lang="ts">
/**
 * 首页 — 点餐与订单双 Tab 页面
 *
 * 遵循 AD-3：页面仅负责组件编排和布局，
 * 业务逻辑由 useProducts / useSpecSheet / useHomeTabs 三个 Composable 承载。
 */
import { onMounted } from 'vue'
import type { Product } from '@/types/product'
import { useProducts } from '@/composables/use-products'
import { useSpecSheet } from '@/composables/use-spec-sheet'
import { useHomeTabs } from '@/composables/use-home-tabs'
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

const {
  visible,
  currentProduct,
  open: openSpecSheet,
  confirm: confirmSpecSheet,
  selections,
  count,
  hasSpecs,
  stepperLabel,
  totalPrice,
  priceLabel,
  toggleOption,
  updateCount,
} = useSpecSheet()
const { activeTab, swiperIndex, onTabChange, onSwiperChange } = useHomeTabs()

/** 点击商品加号 → 打开规格弹窗（薄映射：组件事件 → Composable 动作） */
const handleAddToCart = (product: Product) => {
  openSpecSheet(product)
}

// initProducts 由页面 onMounted 调用（数据加载属于页面级初始化编排）
onMounted(() => {
  initProducts()
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
    <spec-sheet
      v-model:visible="visible"
      :product="currentProduct"
      :selections="selections"
      :count="count"
      :has-specs="hasSpecs"
      :total-price="totalPrice"
      :price-label="priceLabel"
      :stepper-label="stepperLabel"
      @confirm="confirmSpecSheet"
      @toggle-option="toggleOption"
      @update-count="updateCount"
    />
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
