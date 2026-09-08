<script setup lang="ts">
/**
 * 首页 — 点餐与订单双 Tab 页面
 *
 * 遵循 AD-3：页面仅负责组件编排和布局，
 * 业务逻辑由 useProducts / useSpecSheet / useCart / useHomeTabs / useCheckoutBar 五个 Composable 承载。
 */
import { onMounted } from 'vue'
import type { Product, CartItem } from '@/types/product'
import { useProducts } from '@/composables/use-products'
import { useSpecSheet } from '@/composables/use-spec-sheet'
import { useCart } from '@/composables/use-cart'
import { useCheckoutBar } from '@/composables/use-checkout-bar'
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
  footerHeight,
  init: initProducts,
} = useProducts()

const {
  visible,
  currentProduct,
  open: openSpecSheet,
  confirm: closeSpecSheet,
  selections,
  count,
  hasSpecs,
  stepperLabel,
  unitPrice,
  totalPrice,
  priceLabel,
  specSummary,
  toggleOption,
  updateCount,
} = useSpecSheet()

const {
  items: cartItems,
  totalCount: cartTotalCount,
  totalPrice: cartTotalPrice,
  addItem,
  setItemQuantity,
  clearCart,
} = useCart()

const {
  checkoutBarVisible,
  initCheckoutBar,
  showCheckoutBar,
  goToCheckout,
  sidebarHeight,
  onBarHeightChange,
} = useCheckoutBar(cartItems)

const { activeTab, swiperIndex, onTabChange, onSwiperChange } = useHomeTabs()

/** 点击商品加号 → 打开规格弹窗 */
const handleAddToCart = (product: Product) => {
  openSpecSheet(product)
}

/** 规格弹窗确认 → 构建 CartItem 写入购物车 */
const handleSpecConfirm = () => {
  const product = currentProduct.value
  if (!product) return

  const item: CartItem = {
    productId: product.id,
    productName: product.name,
    productDesc: product.desc,
    basePrice: product.price,
    selections: { ...selections },
    quantity: count.value,
    unitPrice: unitPrice.value,
    specSummary: specSummary.value,
  }

  addItem(item)
  showCheckoutBar()
  closeSpecSheet()
}

/** 清空购物袋 */
const handleClearCart = () => {
  clearCart()
}

/** 更新购物车商品数量 */
const handleUpdateQty = (item: CartItem, qty: number) => {
  setItemQuantity(item, qty)
}

/** 点击结算 → 跳转确认订单页 */
const handleCheckout = () => {
  goToCheckout()
}

// initProducts 由页面 onMounted 调用（数据加载属于页面级初始化编排）
onMounted(() => {
  initProducts()
  initCheckoutBar()
})
</script>

<template>
  <view class="flex h-screen flex-col">
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

    <swiper class="swiper flex-1" :current="swiperIndex" :duration="250" @change="onSwiperChange">
      <swiper-item>
        <view class="flex h-full overflow-hidden">
          <view class="sidebar flex w-1/5 shrink-0 flex-col bg-[#f7f8fa]">
            <scroll-view class="min-h-0 flex-1" scroll-y :enhanced="true" :show-scrollbar="false">
              <view
                v-for="cat in categories"
                :key="cat.id"
                class="flex h-[96rpx] items-center justify-center px-[16rpx] font-medium text-[24rpx] text-ink-soft transition-all duration-150"
                :class="{
                  'bg-surface-card !font-bold !text-green': activeCategory === cat.id,
                }"
                @click="handleSidebarClick(cat.id)"
              >
                <text class="max-w-[96rpx] text-center leading-[28rpx] break-all">{{
                  cat.name
                }}</text>
              </view>
              <view :style="{ height: sidebarHeight }" />
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
              <view
                class="category-title sticky top-0 z-10 bg-[rgba(255,255,255,0.85)] py-[24rpx] pl-[32rpx] font-semibold tracking-[0.05em] text-[26rpx] text-ink-soft backdrop-blur-[12rpx]"
              >
                {{ cat.name }}
              </view>
              <view class="pr-5 pl-4">
                <view v-for="product in cat.products" :key="product.id">
                  <ProductCard :product="product" @add-to-cart="handleAddToCart" />
                </view>
              </view>
            </view>
            <view class="flex justify-center" :style="{ height: footerHeight }">
              <text class="mt-[48rpx] text-[22rpx] text-[rgba(0,0,0,0.2)]">--- 没有更多了 ---</text>
            </view>
          </scroll-view>
        </view>

        <checkout-bar
          v-if="checkoutBarVisible"
          :items="cartItems"
          :total-count="cartTotalCount"
          :total-price="cartTotalPrice"
          @clear-cart="handleClearCart"
          @update-qty="handleUpdateQty"
          @checkout="handleCheckout"
          @height-change="onBarHeightChange"
        />
      </swiper-item>
      <swiper-item>
        <view class="flex h-full items-center justify-center">
          <text class="text-sb-text-soft text-base">订单 - 待开发</text>
        </view>
      </swiper-item>
    </swiper>

    <spec-sheet
      v-model:visible="visible"
      :product="currentProduct"
      :selections="selections"
      :count="count"
      :has-specs="hasSpecs"
      :total-price="totalPrice"
      :price-label="priceLabel"
      :stepper-label="stepperLabel"
      @confirm="handleSpecConfirm"
      @toggle-option="toggleOption"
      @update-count="updateCount"
    />
  </view>
</template>
