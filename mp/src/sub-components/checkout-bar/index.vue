<script setup lang="ts">
import { getCurrentInstance, nextTick, onMounted, ref } from 'vue'
import type { CartItem } from '@/types/product'

defineProps<{
  totalCount?: number
  totalPrice?: number
  items: CartItem[]
}>()

const emit = defineEmits<{
  (e: 'clear-cart'): void
  (e: 'update-qty', item: CartItem, delta: number): void
}>()

const safeBottom = ref(0)
const barHeight = ref(0)
const cartDetailVisible = ref(false)
const cartDetailAnimated = ref(false)

const instance = getCurrentInstance()

onMounted(() => {
  const info = uni.getWindowInfo()
  safeBottom.value = info.safeAreaInsets?.bottom || 8

  nextTick(() => {
    const query = uni.createSelectorQuery().in(instance?.proxy)
    query
      .select('.checkout-bar-root')
      .boundingClientRect((rect) => {
        if (rect && !Array.isArray(rect) && rect.height != null) {
          barHeight.value = rect.height
        }
      })
      .exec()
  })
})

const toggleCartDetail = () => {
  if (cartDetailVisible.value) {
    closeCartDetail()
  } else {
    openCartDetail()
  }
}

const openCartDetail = () => {
  cartDetailVisible.value = true
  setTimeout(() => {
    cartDetailAnimated.value = true
  }, 20)
}

const closeCartDetail = () => {
  cartDetailAnimated.value = false
  setTimeout(() => {
    cartDetailVisible.value = false
  }, 250)
}
</script>

<template>
  <view>
    <view
      class="checkout-bar-root relative z-700 border-t border-border-hairline bg-surface-card"
      :style="{ paddingBottom: safeBottom + 'px' }"
    >
      <view class="flex min-h-(--mp-frap-size) items-center justify-between px-[32rpx] pt-[16rpx]">
        <view class="flex h-full flex-1 flex-col justify-center" @click="toggleCartDetail">
          <view class="flex items-baseline">
            <text class="font-medium text-[22rpx] text-ink-soft">合计：</text>
            <text class="ml-[4rpx] font-bold text-[22rpx] text-green">¥</text>
            <text class="font-bold text-[36rpx] text-green">{{ totalPrice ?? 0 }}</text>
          </view>
          <view class="mt-[2rpx] flex items-center gap-[4rpx]">
            <text class="text-[20rpx] text-ink-soft">明细</text>
            <t-icon
              name="chevron-up"
              size="24rpx"
              color="rgba(0,0,0,0.58)"
              :class="{ 'rotate-180': cartDetailAnimated }"
              custom-style="transition: transform 250ms ease;"
            />
          </view>
        </view>
        <view class="shrink-0">
          <view
            class="flex h-[76rpx] items-center justify-center rounded-button bg-gold px-[40rpx] shadow-[0_4rpx_12rpx_rgba(203,162,88,0.2)]"
          >
            <text class="font-bold text-[26rpx] text-surface-dark"
              >结算({{ totalCount ?? 0 }})</text
            >
          </view>
        </view>
      </view>
    </view>

    <view
      v-show="cartDetailVisible"
      class="cart-detail-overlay fixed top-0 right-0 left-0 z-650"
      :class="{ 'cart-detail-overlay--active': cartDetailAnimated }"
      :style="{ bottom: barHeight + 'px' }"
      @click="closeCartDetail"
    />

    <view
      v-show="cartDetailVisible"
      class="cart-detail-panel fixed right-0 left-0 z-651 flex max-h-[60vh] flex-col overflow-hidden rounded-t-[32rpx] bg-surface-card"
      :class="{ 'cart-detail-panel--active': cartDetailAnimated }"
      :style="{ bottom: barHeight + 'px' }"
    >
      <view
        class="flex shrink-0 items-center justify-between border-b border-border-hairline px-[40rpx] py-[28rpx]"
      >
        <text class="font-semibold text-[26rpx] text-ink">已购商品</text>
        <view class="flex items-center gap-[8rpx]" @click="emit('clear-cart')">
          <t-icon name="delete" size="28rpx" color="rgba(0,0,0,0.58)" />
          <text class="text-[24rpx] text-ink-soft">清空购物袋</text>
        </view>
      </view>

      <view class="spec-scroll-wrapper min-h-0 flex-1 overflow-y-auto">
        <view v-if="items.length === 0" class="flex items-center justify-center py-[80rpx]">
          <text class="text-[24rpx] text-ink-soft">购物袋是空的</text>
        </view>
        <view v-else class="px-[40rpx]">
          <view
            v-for="item in items"
            :key="item.productId + '-' + item.specSummary"
            class="flex items-center justify-between border-b border-border-hairline py-[28rpx]"
          >
            <view class="mr-[24rpx] flex min-w-0 flex-1 flex-col gap-[6rpx]">
              <text class="truncate font-semibold text-[26rpx] text-ink">{{
                item.productName
              }}</text>
              <text v-if="item.specSummary" class="truncate text-[20rpx] text-ink-soft">{{
                item.specSummary
              }}</text>
            </view>
            <view class="flex shrink-0 items-center gap-[32rpx]">
              <text class="font-bold text-[28rpx] text-ink"
                >¥{{ item.unitPrice * item.quantity }}</text
              >
              <view
                class="flex items-center gap-[16rpx] rounded-button bg-surface-ceramic px-[8rpx] py-[6rpx]"
              >
                <view
                  class="flex h-[48rpx] w-[48rpx] items-center justify-center rounded-full border border-border bg-surface-card"
                  @click="emit('update-qty', item, -1)"
                >
                  <text
                    class="translate-y-[-7%] leading-none font-medium text-[32rpx] text-ink-soft"
                    >-</text
                  >
                </view>
                <text class="min-w-[28rpx] text-center font-semibold text-[26rpx]">{{
                  item.quantity
                }}</text>
                <view
                  class="flex h-[48rpx] w-[48rpx] items-center justify-center rounded-full border border-border bg-surface-card"
                  @click="emit('update-qty', item, 1)"
                >
                  <text class="leading-none font-medium text-[32rpx] text-ink-soft">+</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.cart-detail-overlay {
  background-color: rgba(0, 0, 0, 0);
  transition: background-color 250ms ease;
}

.cart-detail-overlay--active {
  background-color: rgba(0, 0, 0, 0.4);
}

.cart-detail-panel {
  transform: translateY(100%);
  transition: transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.cart-detail-panel--active {
  transform: translateY(0);
}

.spec-scroll-wrapper {
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.spec-scroll-wrapper::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
</style>
