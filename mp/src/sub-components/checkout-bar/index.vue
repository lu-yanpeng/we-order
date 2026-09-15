<script setup lang="ts">
import { getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue'
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
  ready: []
}>()

/** 购物车面板显隐受控：再来一单需要从外部命令展开（use-checkout-bar） */
const detailVisible = defineModel<boolean>('detailVisible', { default: false })

const barHeight = ref(0)
const cartDetailMounted = ref(false)
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
  // 关闭页面侧触发的 loading，见 composables/use-checkout-bar.ts
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

    setTimeout(() => {
      slideUpReady.value = true
      // 滑入过渡（300ms，见 .checkout-bar-root 的 transition）结束后再通知页面：
      // 面板在结算栏内部展开，两者同时播放动画会互相打架
      setTimeout(() => {
        emit('ready')
      }, 300)
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

/** 两段式过渡的定时器：新指令到来时取消未执行的旧阶段，避免两个动画打架 */
let detailTransitionTimer: ReturnType<typeof setTimeout> | undefined

/** 面板显隐受控：指令变化时播放两段式过渡（先挂载 DOM / 先移除 active class） */
watch(
  detailVisible,
  (visible) => {
    // 每次播放动画前先清空之前动画状态，防止手速太快出现BUG
    clearTimeout(detailTransitionTimer)
    if (visible) {
      // 展开：先挂载 DOM，下一帧添加 active class 触发 CSS transition
      // 人话就是先让小程序把面板节点绘制在屏幕上，20ms后播放展开动画，否则直接播放动画可能会瞬移
      // 因为translateY(100%)的原因，即使面板已经绘制了也看不见
      // 等待20ms后修改cartDetailAnimated，开始播放展开动画
      cartDetailMounted.value = true
      detailTransitionTimer = setTimeout(() => {
        cartDetailAnimated.value = true
        // 20ms约等于一帧动画的时间，这是一个经验值，真机上已验证可行
      }, 20)
    } else {
      // 组件挂载时初始值为 false，此时无需播放收起动画
      if (!cartDetailMounted.value) return
      // 收起：先移除 active class 播放 CSS 过渡动画，动画结束后隐藏 DOM
      // 延时（250ms）与 .cart-detail-panel 的 CSS transition 时长保持一致
      cartDetailAnimated.value = false
      detailTransitionTimer = setTimeout(() => {
        cartDetailMounted.value = false
      }, 250)
    }
  },
  { immediate: true },
)

const toggleCartDetail = () => {
  detailVisible.value = !detailVisible.value
}

const closeCartDetail = () => {
  detailVisible.value = false
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
      v-show="cartDetailMounted"
      class="cart-detail-overlay fixed top-0 right-0 left-0 z-650"
      :class="{ 'cart-detail-overlay--active': cartDetailAnimated }"
      :style="{ bottom: barHeight + 'px' }"
      @click="closeCartDetail"
    />

    <view
      v-show="cartDetailMounted"
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

<style scoped lang="less">
.checkout-bar :deep(.checkout-bar-root) {
  /* 开发者工具里面没有过渡动画，但是真机预览的时候有 */
  transition: transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
  transform: translateY(100%);
  /* 使用bottom-bar组件后，z-700的形式无法转换成样式 */
  z-index: 700;
}

.checkout-bar :deep(.checkout-clear-dialog) {
  --td-dialog-border-radius: 24rpx;
  --td-dialog-width: 520rpx;
  border-radius: 24rpx;
  overflow: hidden;

  .t-dialog__content {
    padding: 52rpx 0;
    .t-dialog__header {
      font-size: 48rpx;
    }
  }

  .t-dialog__footer {
    padding: 0 32rpx 52rpx;
    .t-dialog__button {
      min-width: 150rpx;
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
