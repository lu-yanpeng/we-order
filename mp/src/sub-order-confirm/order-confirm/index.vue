<script setup lang="ts">
/**
 * 确认订单页
 *
 * 数据来自购物车 cart store（跨页面共享状态，FR-9/AD-6），
 * 业务逻辑与状态封装在 useOrderConfirm composable（AD-3）。
 * 「立即支付」经 `pay-order` 真实建单（模拟支付，Story 3.5）：成功后清空购物车、
 * 重置备注与就餐方式，并返回首页订单 tab；门店首读期间显示全屏遮罩（延迟防闪烁）。
 */
import { onMounted, onUnmounted, watch } from 'vue'
import BottomBar from '@/components/bottom-bar/index.vue'
import { useOrderConfirm } from '@/sub-order-confirm/composables/use-order-confirm'
import { useCart } from '@/composables/use-cart'
import { HOME_TAB_SWITCH_EVENT } from '@/composables/use-home-tabs'

defineOptions({
  options: {
    styleIsolation: 'shared',
  },
})

const {
  items,
  diningMode,
  notes,
  store,
  storeError,
  storeLoading,
  storeOverlayVisible,
  totalCount: totalQty,
  packagingFee,
  payAmount,
  selectDiningMode,
  initStore,
  retryStore,
  paymentPhase,
  paying,
  resetOrderDraft,
  startPay,
} = useOrderConfirm()

const { clearCart } = useCart()

/** 门店信息经 API 层加载（AD-1），页面挂载时读取一次（带全屏遮罩） */
onMounted(initStore)

/** 支付成功展示后的收尾定时器（清空购物车 + 回首页订单 tab），页面卸载时清理 */
let payDoneTimer: ReturnType<typeof setTimeout> | null = null

/** 成功反馈展示时长：真实网络已承担等待，这里只留可见的成功反馈 */
const PAY_SUCCESS_DISPLAY_MS = 800

watch(paymentPhase, (phase) => {
  if (phase !== 'success') return
  payDoneTimer = setTimeout(() => {
    clearCart()
    resetOrderDraft()
    uni.$emit(HOME_TAB_SWITCH_EVENT, 'orders')
    uni.navigateBack()
  }, PAY_SUCCESS_DISPLAY_MS)
})

onUnmounted(() => {
  if (payDoneTimer) clearTimeout(payDoneTimer)
})
</script>

<template>
  <view class="flex h-screen flex-col bg-surface-page">
    <scroll-view
      class="scrollbar-hide min-h-0 flex-1"
      scroll-y
      :enhanced="true"
      :show-scrollbar="false"
    >
      <view class="flex flex-col gap-[24rpx] px-[28rpx] py-[28rpx]">
        <!-- 堂食/外带选择卡片 -->
        <view class="flex flex-col gap-[24rpx] rounded-card bg-surface-card p-[28rpx] shadow-card">
          <view class="flex rounded-button bg-surface-ceramic">
            <view
              class="flex flex-1 items-center justify-center gap-[8rpx] rounded-full py-[18rpx] font-semibold text-[24rpx]"
              :class="diningMode === 'dinein' ? 'bg-green-accent text-white' : 'text-ink-soft'"
              @click="selectDiningMode('dinein')"
            >
              <t-icon name="shop" size="28rpx" />
              <text>店内堂食</text>
            </view>
            <view
              class="flex flex-1 items-center justify-center gap-[8rpx] rounded-full py-[18rpx] font-semibold text-[24rpx]"
              :class="diningMode === 'takeout' ? 'bg-green-accent text-white' : 'text-ink-soft'"
              @click="selectDiningMode('takeout')"
            >
              <t-icon name="undertake-delivery" size="28rpx" />
              <text>打包外带</text>
            </view>
          </view>

          <view class="flex flex-col gap-[6rpx]">
            <!-- 门店卡失败态：文案 + 内联重试；不阻断支付、重试不弹全屏遮罩（Story 3.5） -->
            <template v-if="storeError">
              <text class="text-[20rpx] text-ink-soft">{{ storeError }}</text>
              <view class="mt-[4rpx] self-start">
                <t-button
                  theme="primary"
                  size="small"
                  :loading="storeLoading"
                  :disabled="storeLoading"
                  @click="retryStore"
                >
                  重试
                </t-button>
              </view>
            </template>
            <template v-else>
              <text class="font-bold text-[26rpx] text-ink">{{ store?.name }}</text>
              <text class="text-[20rpx] text-ink-soft">{{ store?.address }}</text>
            </template>
          </view>
        </view>

        <!-- 商品明细卡片 -->
        <view class="flex flex-col gap-[20rpx] rounded-card bg-surface-card p-[28rpx] shadow-card">
          <text class="border-b border-border-hairline pb-[12rpx] font-bold text-[24rpx] text-ink">
            商品明细
          </text>

          <view class="flex flex-col gap-[20rpx]">
            <view
              v-for="item in items"
              :key="item.productId + item.specSummary"
              class="flex items-start justify-between gap-[20rpx]"
            >
              <view class="flex min-w-0 flex-1 flex-col gap-[4rpx]">
                <text class="font-semibold text-[24rpx] text-ink">{{ item.productName }}</text>
                <text class="leading-[1.3] text-[20rpx] text-ink-soft">{{ item.specSummary }}</text>
              </view>
              <view class="flex shrink-0 flex-col items-end gap-[2rpx]">
                <view class="flex items-baseline">
                  <text class="font-bold text-[18rpx] text-ink">¥</text>
                  <text class="font-bold text-[24rpx] text-ink">{{
                    item.unitPrice * item.quantity
                  }}</text>
                </view>
                <text class="text-[18rpx] text-ink-soft">x{{ item.quantity }}</text>
              </view>
            </view>
          </view>

          <view
            v-if="packagingFee > 0"
            class="flex items-baseline justify-between border-t border-dashed border-border-hairline pt-[12rpx] text-[22rpx] text-ink-rewards"
          >
            <text>外带包装费</text>
            <view class="flex items-baseline">
              <text class="font-bold text-[18rpx]">¥</text>
              <text class="font-bold text-[22rpx]">{{ packagingFee }}</text>
            </view>
          </view>

          <view class="flex items-baseline justify-end gap-[8rpx] pt-[12rpx]">
            <text class="font-semibold text-[22rpx] text-ink">共 {{ totalQty }} 件商品，实付</text>
            <view class="flex items-baseline">
              <text class="font-bold text-[20rpx] text-green">¥</text>
              <text class="font-bold text-[30rpx] text-green">{{ payAmount }}</text>
            </view>
          </view>
        </view>

        <!-- 备注和支付方式卡片 -->
        <view class="flex flex-col gap-[20rpx] rounded-card bg-surface-card p-[28rpx] shadow-card">
          <view
            class="flex items-center justify-between border-b border-border-hairline pb-[20rpx]"
          >
            <text class="font-semibold text-[22rpx] text-ink">支付方式</text>
            <view class="flex items-center gap-[8rpx]">
              <t-icon name="logo-wechatpay" size="28rpx" color="#09bb07" />
              <text class="font-semibold text-[#09bb07] text-[22rpx]">微信支付</text>
            </view>
          </view>

          <view class="notes-container flex flex-col gap-[12rpx]">
            <text class="font-semibold text-[22rpx] text-ink">备注偏好</text>
            <t-textarea
              v-model:value="notes"
              :autosize="true"
              :maxlength="30"
              placeholder="输入备注"
              t-class-textarea="notes-input"
              custom-style="padding: 16rpx 24rpx; background-color: #f9f9f9; border-radius: 12rpx;"
            />
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 底部支付栏 -->
    <bottom-bar>
      <template #left>
        <view class="flex items-baseline">
          <text class="font-medium text-[22rpx] text-ink-soft">应付金额：</text>
          <text class="ml-[4rpx] font-bold text-[22rpx] text-green">¥</text>
          <text class="font-bold text-[36rpx] text-green">{{ payAmount }}</text>
        </view>
      </template>
      <template #right>
        <view
          class="pay-btn flex h-[76rpx] items-center justify-center rounded-button bg-green-accent px-[48rpx]"
          hover-class="pay-btn--pressed"
          @click="startPay"
        >
          <text class="font-bold text-[26rpx] text-white">立即支付</text>
        </view>
      </template>
    </bottom-bar>

    <!-- 模拟支付弹层（FR-10；渠道为模拟，建单经 pay-order 真实完成） -->
    <view
      v-if="paying"
      class="fixed top-0 right-0 bottom-0 left-0 z-[2000] flex items-center justify-center bg-black-40 px-[48rpx]"
    >
      <view
        class="flex w-full max-w-[640rpx] flex-col items-center rounded-[32rpx] bg-surface-card px-[48rpx] py-[48rpx] text-center shadow-[0_20rpx_50rpx_rgba(0,0,0,0.25)]"
      >
        <view v-if="paymentPhase === 'verifying'" class="payment-spinner" />
        <view v-else class="mb-[30rpx]">
          <t-icon name="check-circle" color="#00754a" size="100rpx" />
        </view>
        <text class="font-semibold text-[32rpx] text-ink">
          {{ paymentPhase === 'verifying' ? '模拟支付中' : '模拟支付成功' }}
        </text>
      </view>
    </view>

    <!-- 门店首读遮罩（Story 3.5；延迟约 250ms 防闪烁，不与支付弹层同时出现） -->
    <t-overlay :visible="storeOverlayVisible && !paying">
      <view class="store-loading flex h-full items-center justify-center">
        <t-loading theme="spinner" text="加载中..." />
      </view>
    </t-overlay>
  </view>
</template>

<style scoped>
/*
 * 占位符与输入文字统一 24rpx。
 */
.notes-container :deep(.notes-input) {
  font-size: 24rpx;
  line-height: 34rpx;
}

/* 门店首读遮罩：文案与指示器白色（深色遮罩上可读；变量继承进 t-loading） */
.store-loading {
  --td-loading-color: #ffffff;
  --td-loading-text-color: #ffffff;
}

/* 模拟支付弹层：spinner 旋转圈（设计稿 .payment-spinner） */
.payment-spinner {
  width: 96rpx;
  height: 96rpx;
  margin-bottom: 32rpx;
  border: 8rpx solid var(--color-border);
  border-top-color: var(--color-green-accent);
  border-radius: 50%;
  animation: payment-spin 1s linear infinite;
}

@keyframes payment-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* 立即支付按钮按压反馈（设计稿 .btn-pay-now:active） */
.pay-btn {
  transition: all 0.2s ease;
}

.pay-btn--pressed {
  transform: scale(0.95);
}
</style>
