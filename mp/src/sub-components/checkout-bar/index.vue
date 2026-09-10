<script setup lang="ts">
import { getCurrentInstance, nextTick, onMounted, ref } from 'vue'
import type { CartItem } from '@/types/product'
import MyStepper from '@/components/stepper/index.vue'
import BottomBar from '@/components/bottom-bar/index.vue'

defineOptions({
  options: {
    styleIsolation: 'shared',
  },
})

const {
  totalCount = 0,
  totalPrice = 0,
  items,
} = defineProps<{
  totalCount?: number
  totalPrice?: number
  items: CartItem[]
}>()

const emit = defineEmits<{
  'clear-cart': []
  'update-qty': [item: CartItem, qty: number]
  checkout: []
  'height-change': [height: number]
}>()

const barHeight = ref(0)
const cartDetailVisible = ref(false)
const cartDetailAnimated = ref(false)
const clearDialogVisible = ref(false)
const slideUpReady = ref(false)

const clearDialogConfirmBtn = {
  content: '确认清空',
  theme: 'danger' as const,
  size: 'small' as const,
  shape: 'round' as const,
}

const clearDialogCancelBtn = {
  content: '取消',
  variant: 'outline' as const,
  size: 'small' as const,
  shape: 'round' as const,
}

const instance = getCurrentInstance()

onMounted(() => {
  uni.hideLoading()

  nextTick(() => {
    const query = uni.createSelectorQuery().in(instance?.proxy)
    query
      .select('.checkout-bar >>> .checkout-bar-root')
      .boundingClientRect((rect) => {
        if (rect && !Array.isArray(rect) && rect.height != null) {
          barHeight.value = rect.height
          emit('height-change', rect.height)
        }
      })
      .exec()

    // 收起：先移除 active class 播放 CSS 过渡动画，动画结束后隐藏 DOM
    // 延时（250ms）与 .cart-detail-panel 的 CSS transition 时长保持一致
    setTimeout(() => {
      slideUpReady.value = true
    }, 50)
  })
})

const openClearDialog = () => {
  clearDialogVisible.value = true
}

const handleConfirmClear = () => {
  clearDialogVisible.value = false
  emit('clear-cart')
}

const toggleCartDetail = () => {
  if (cartDetailVisible.value) {
    closeCartDetail()
  } else {
    openCartDetail()
  }
}
const openCartDetail = () => {
  cartDetailVisible.value = true
  // 展开：先挂载 DOM，下一帧添加 active class 触发 CSS transition
  setTimeout(() => {
    cartDetailAnimated.value = true
  }, 20)
}

const closeCartDetail = () => {
  cartDetailAnimated.value = false
  // 收起：先移除 active class 播放 CSS 过渡动画，动画结束后隐藏 DOM
  // 延时（250ms）与 .cart-detail-panel 的 CSS transition 时长保持一致
  setTimeout(() => {
    cartDetailVisible.value = false
  }, 250)
}
</script>

<template>
  <view class="checkout-bar">
    <bottom-bar
      custom-class="checkout-bar-root fixed right-0 bottom-0 left-0"
      :custom-style="{ transform: slideUpReady ? 'translateY(0)' : 'translateY(100%)' }"
    >
      <template #left>
        <view class="flex h-full flex-1 flex-col justify-center">
          <view class="self-start" @click="toggleCartDetail">
            <view class="flex items-baseline">
              <text class="font-medium text-[22rpx] text-ink-soft">合计：</text>
              <text class="ml-[4rpx] font-bold text-[22rpx] text-green">¥</text>
              <text class="font-bold text-[36rpx] text-green">{{ totalPrice }}</text>
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
        </view>
      </template>

      <template #right>
        <view class="shrink-0">
          <view
            class="flex h-[76rpx] items-center justify-center rounded-button px-[40rpx]"
            :class="
              totalCount > 0 ? 'bg-gold shadow-[0_4rpx_12rpx_rgba(203,162,88,0.2)]' : 'bg-black-14'
            "
            @click="emit('checkout')"
          >
            <text
              class="font-bold text-[26rpx]"
              :class="totalCount > 0 ? 'text-surface-dark' : 'text-black-58'"
            >结算({{ totalCount }})</text
            >
          </view>
        </view>
      </template>
    </bottom-bar>

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
        <view v-if="items.length > 0" class="flex items-center gap-[8rpx]" @click="openClearDialog">
          <t-icon name="delete" size="28rpx" color="rgba(0,0,0,0.58)" />
          <text class="text-[24rpx] text-ink-soft">清空购物车</text>
        </view>
      </view>

      <view class="scrollbar-hide min-h-0 flex-1 overflow-y-auto">
        <view v-if="items.length === 0" class="flex items-center justify-center py-[80rpx]">
          <text class="text-[24rpx] text-ink-soft">购物车是空的</text>
        </view>
        <view v-else class="px-[40rpx]">
          <view
            v-for="item in items"
            :key="item.productId + '-' + item.specSummary"
            class="flex items-center justify-between border-b border-border-hairline py-[28rpx] last:border-b-0"
          >
            <view class="mr-[24rpx] flex min-w-0 flex-1 flex-col gap-[6rpx]">
              <text class="truncate font-semibold text-[26rpx] text-ink">{{
                item.productName
              }}</text>
              <text v-if="item.specSummary" class="text-[20rpx] text-ink-soft">{{
                item.specSummary
              }}</text>
            </view>
            <view class="flex shrink-0 items-center gap-[32rpx]">
              <text class="font-bold text-[28rpx] text-ink"
                >¥{{ item.unitPrice * item.quantity }}</text
              >
              <my-stepper
                :model-value="item.quantity"
                @update:model-value="$emit('update-qty', item, $event)"
              />
            </view>
          </view>
        </view>
      </view>
    </view>

    <t-dialog
      t-class="checkout-clear-dialog"
      :visible="clearDialogVisible"
      title="清空购物车"
      :confirm-btn="clearDialogConfirmBtn"
      :cancel-btn="clearDialogCancelBtn"
      close-on-overlay-click
      @confirm="handleConfirmClear"
      @close="clearDialogVisible = false"
    />
  </view>
</template>

<style scoped>
:deep(.checkout-bar-root) {
  /* 开发者工具里面没有过渡动画，但是真机预览的时候有 */
  transition: transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
  transform: translateY(100%);
  /* 使用bottom-bar组件后，z-700的形式无法转换成样式 */
  z-index: 700;
}

:deep(.t-popup.t-popup--center.t-dialog__wrapper) {
  background-color: transparent;

  .checkout-clear-dialog {
    --td-dialog-border-radius: 24rpx;
    --td-dialog-width: 520rpx;
    border-radius: 24rpx;
    overflow: hidden;

    .t-dialog__content {
      padding: 52rpx 0;

      .t-dialog__header {
        font-size: 30rpx !important;
        font-weight: 600 !important;
        color: rgba(0, 0, 0, 0.87) !important;
      }
    }

    .t-dialog__footer {
      padding: 0 32rpx 32rpx !important;

      .t-dialog__button {
        min-width: 160rpx !important;
      }
    }
  }
}

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
</style>
