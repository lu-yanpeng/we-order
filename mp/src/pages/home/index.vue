<script setup lang="ts">
/**
 * 首页 — 点餐与订单双 Tab 页面
 *
 * 遵循 AD-3：页面仅负责组件编排和布局，
 * 业务逻辑由 useProducts / useSpecSheet / useOrders / useUrge / useCart / useReorder / useCheckoutBar / useHomeTabs 八个 Composable 承载。
 * 遵循 AD-8：订单可见域 = 订单 tab 激活 且页面可见；经 useOrders 的 setActive 接入
 * 刷新编排（进入立即读一次 + 5s 轮询，离开停表；Story 4.3）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import type { MenuProduct, OrderListItem } from '@/types/api-contracts'
import type { CartItem } from '@/types/cart'
import { useProducts } from './composables/use-products'
import { useSpecSheet } from './composables/use-spec-sheet'
import { useOrders } from './composables/use-orders'
import { useCart } from '@/composables/use-cart'
import { useReorder } from '@/composables/use-reorder'
import { useUrge } from '@/composables/use-urge'
import { useConfirmPickup } from '@/composables/use-confirm-pickup'
import { useCheckoutBar } from '@/composables/use-checkout-bar'
import { useHomeTabs } from '@/composables/use-home-tabs'
import ProductCard from './components/product-card/index.vue'
import SpecSheet from './components/spec-sheet/index.vue'
import OrderCard from './components/order-card/index.vue'
import LoadFailure from '@/components/load-failure/index.vue'
import CatalogSkeleton from './components/catalog-skeleton/index.vue'
import OrderCardSkeleton from './components/order-card-skeleton/index.vue'
import OrdersEmpty from './components/orders-empty/index.vue'
import CheckoutBar from '@/sub-components/checkout-bar/index.vue'

const {
  categories,
  activeCategory,
  scrollIntoViewId,
  handleSidebarClick,
  handleContentScroll,
  handleContentTouchStart,
  footerHeight,
  init: initProducts,
  anchorId,
  productImageUrl,
  loading: productsLoading,
  error: productsError,
  skeletonVisible: productsSkeletonVisible,
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
  cartDetailVisible,
  initCheckoutBar,
  showCheckoutBar,
  onBarReady,
  goToCheckout,
  sidebarHeight,
  onBarHeightChange,
} = useCheckoutBar(cartItems)

const { activeTab, swiperIndex, onTabChange, onSwiperChange, switchTab } = useHomeTabs()

const {
  orders,
  error: ordersError,
  loading: ordersLoading,
  loadingMore: ordersLoadingMore,
  loadMoreError: ordersLoadMoreError,
  hasMore: ordersHasMore,
  hasOrders: ordersHasOrders,
  isEmpty: ordersIsEmpty,
  skeletonVisible: ordersSkeletonVisible,
  refreshing: ordersRefreshing,
  setActive: setOrdersActive,
  refreshOrders,
  refreshAfterAction,
  loadMoreOrders,
  goToOrderDetail,
} = useOrders()

const { reorder } = useReorder()

/** 催单（Story 4.4）：模块级共享标记——列表与详情一致，已催过显示「已催单」、再点只提示 */
const { isUrged, urge: urgeOrder } = useUrge()

/** 确认取餐（Story 4.5）：模块级共享在飞状态；成功后立即读取一次（auto 语义）再清 loading */
const { isConfirming, confirmPickup } = useConfirmPickup()

/**
 * 订单卡片图片行 URL（Story 4.7）：快照路径 → 对象存储 URL，复用目录图片的同一构造；
 * 空路径返回空串 → 卡片以色块占位。数组顺序与 `order.item_images` 一一对应。
 */
const orderImageUrls = (order: OrderListItem) =>
  order.item_images.map((image) => productImageUrl(image.image_path))

/** 点击商品加号 → 打开规格弹窗 */
const handleAddToCart = (product: MenuProduct) => {
  openSpecSheet(product)
}

/** 规格弹窗确认 → 构建 CartItem 写入购物车 */
const handleSpecConfirm = () => {
  const product = currentProduct.value
  if (!product) return

  const item: CartItem = {
    productId: product.id,
    productName: product.name,
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

// initProducts / initCheckoutBar 由页面 onMounted 调用（数据加载属于页面级初始化编排）
onMounted(() => {
  initProducts()
  initCheckoutBar()
})

// 订单可见域（AD-8）：订单 tab 激活 且页面可见；进入（含切回 tab、从详情返回、回到前台）
// 立即读一次并重置轮询计时，离开 / 页面隐藏即停止轮询（Story 4.3 的 setActive 编排）。
// 页面隐藏 / 离开订单 tab 不发请求；支付成功后的「切到订单 tab」也经此入口读取。
const pageVisible = ref(false)
const ordersInDomain = computed(() => activeTab.value === 'orders' && pageVisible.value)

watch(ordersInDomain, (inDomain) => {
  void setOrdersActive(inDomain)
})

onShow(() => {
  pageVisible.value = true
})

onHide(() => {
  pageVisible.value = false
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
        <!-- 首屏加载：延迟 250ms 显示目录双栏骨架（快网不闪烁；刷新 / 重试不回骨架） -->
        <catalog-skeleton v-if="productsSkeletonVisible" />

        <!-- 首屏失败：失败态 + 重试，不渲染半截目录（Story 2.2） -->
        <load-failure
          v-else-if="productsError && categories.length === 0"
          :message="productsError"
          :loading="productsLoading"
          @retry="initProducts"
        />
        <view v-else class="flex h-full overflow-hidden">
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
            @touchstart="handleContentTouchStart"
          >
            <view
              v-for="cat in categories"
              :key="cat.id"
              :id="anchorId(cat.id)"
              class="category-section"
            >
              <view
                class="category-title sticky top-0 z-10 bg-[rgba(255,255,255,0.85)] py-[24rpx] pl-[32rpx] font-semibold tracking-[0.05em] text-[26rpx] text-ink-soft backdrop-blur-[12rpx]"
              >
                {{ cat.name }}
              </view>
              <view class="pr-5 pl-4">
                <view v-for="product in cat.products" :key="product.id">
                  <ProductCard
                    :product="product"
                    :image-url="productImageUrl(product.image_path)"
                    @add-to-cart="handleAddToCart"
                  />
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
          v-model:detail-visible="cartDetailVisible"
          :items="cartItems"
          :total-count="cartTotalCount"
          :total-price="cartTotalPrice"
          @clear-cart="handleClearCart"
          @update-qty="handleUpdateQty"
          @checkout="handleCheckout"
          @height-change="onBarHeightChange"
          @ready="onBarReady"
        />
      </swiper-item>
      <swiper-item>
        <!-- 首屏加载：延迟 250ms 显示订单卡片骨架（快网不闪烁；刷新不回骨架） -->
        <view v-if="ordersSkeletonVisible" class="h-full bg-surface-page px-[32rpx] pt-[32rpx]">
          <order-card-skeleton />
        </view>

        <!-- 首屏失败：失败态 + 重试；不展示任何订单数据（含本地缓存）、不以空列表伪装 -->
        <load-failure
          v-else-if="ordersError"
          :message="ordersError"
          :loading="ordersLoading"
          @retry="refreshOrders"
        />

        <scroll-view
          v-else
          class="h-full bg-surface-page"
          scroll-y
          :enhanced="true"
          :show-scrollbar="false"
          :refresher-enabled="true"
          :refresher-triggered="ordersRefreshing"
          refresher-background="#f2f0eb"
          :lower-threshold="120"
          @refresherrefresh="refreshOrders"
          @scrolltolower="loadMoreOrders"
        >
          <view class="px-[32rpx] pt-[32rpx] pb-[92rpx]">
            <!-- 空态：读取成功且 0 条；「去点餐」引导（不发起无意义读取） -->
            <orders-empty v-if="ordersIsEmpty" @go-menu="switchTab('menu')" />

            <template v-else>
              <order-card
                v-for="order in orders"
                :key="order.id"
                :order="order"
                :image-urls="orderImageUrls(order)"
                :urged="isUrged(order.id)"
                :confirming="isConfirming(order.id)"
                @click="goToOrderDetail(order)"
                @urge="urgeOrder(order.id)"
                @confirm-pickup="confirmPickup(order.id, refreshAfterAction)"
                @reorder="reorder(order)"
              />

              <!-- 分页页脚（2026-09-30 范围修订）：加载中 / 加载失败可点击重试 / 没有更多 -->
              <view
                v-if="
                  ordersHasOrders && (ordersLoadingMore || ordersLoadMoreError || !ordersHasMore)
                "
                class="flex items-center justify-center gap-[16rpx] py-[24rpx]"
                @click="loadMoreOrders"
              >
                <template v-if="ordersLoadMoreError">
                  <text class="text-[22rpx] text-ink-soft">{{ ordersLoadMoreError }}</text>
                  <text class="font-semibold text-[22rpx] text-green">重试</text>
                </template>
                <text v-else class="text-[22rpx] text-ink-soft">
                  {{ ordersLoadingMore ? '加载中…' : '--- 没有更多了 ---' }}
                </text>
              </view>
            </template>
          </view>
        </scroll-view>
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
      :image-url="productImageUrl(currentProduct?.image_path ?? null)"
    />
  </view>
</template>
