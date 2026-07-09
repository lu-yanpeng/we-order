<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  totalCount?: number
  totalPrice?: number
}>()

const safeBottom = ref(0)
const info = uni.getWindowInfo()
safeBottom.value = info.safeAreaInsets?.bottom || 0
</script>

<template>
  <view class="checkout-bar" :style="{ paddingBottom: safeBottom + 'px' }">
    <view class="checkout-bar__inner">
      <view class="checkout-bar__left">
        <view class="checkout-bar__price">
          <text class="checkout-bar__price-label">合计：</text>
          <text class="checkout-bar__price-symbol">¥</text>
          <text class="checkout-bar__price-value">{{ totalPrice ?? 0 }}</text>
        </view>
        <view class="checkout-bar__detail">
          <text class="checkout-bar__detail-text">明细</text>
          <t-icon name="chevron-up" size="24rpx" color="rgba(0,0,0,0.58)" />
        </view>
      </view>
      <view class="checkout-bar__right">
        <view class="checkout-bar__submit">
          <text class="checkout-bar__submit-text">结算({{ totalCount ?? 0 }})</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.checkout-bar {
  background-color: var(--mp-color-bg-card);
  border-top: 2rpx solid var(--mp-color-border-hairline);
}

.checkout-bar__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 112rpx;
  padding: 0 32rpx;
}

.checkout-bar__left {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  height: 100%;
}

.checkout-bar__price {
  display: flex;
  align-items: baseline;
}

.checkout-bar__price-label {
  font-size: 22rpx;
  color: var(--mp-color-text-soft);
  font-weight: 500;
}

.checkout-bar__price-symbol {
  font-size: 22rpx;
  color: var(--mp-color-green);
  font-weight: 700;
  margin-left: 4rpx;
}

.checkout-bar__price-value {
  font-size: 36rpx;
  color: var(--mp-color-green);
  font-weight: 700;
}

.checkout-bar__detail {
  display: flex;
  align-items: center;
  gap: 4rpx;
  margin-top: 2rpx;
}

.checkout-bar__detail-text {
  font-size: 20rpx;
  color: var(--mp-color-text-soft);
}

.checkout-bar__right {
  flex-shrink: 0;
}

.checkout-bar__submit {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  padding: 0 40rpx;
  background-color: var(--mp-color-gold);
  border-radius: var(--mp-radius-button);
  box-shadow: 0 4rpx 12rpx rgba(203, 162, 88, 0.2);
}

.checkout-bar__submit-text {
  font-size: 26rpx;
  font-weight: 700;
  color: var(--mp-color-bg-dark);
}
</style>
