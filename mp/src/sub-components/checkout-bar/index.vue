<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  totalCount?: number
  totalPrice?: number
}>()

const safeBottom = ref(0)
const info = uni.getWindowInfo()
safeBottom.value = info.safeAreaInsets?.bottom || 8
</script>

<template>
  <view
    class="border-t border-border-hairline bg-surface-card"
    :style="{ paddingBottom: safeBottom + 'px' }"
  >
    <view class="flex min-h-(--mp-frap-size) items-center justify-between px-[32rpx] pt-[16rpx]">
      <view class="flex h-full flex-1 flex-col justify-center">
        <view class="flex items-baseline">
          <text class="font-medium text-[22rpx] text-ink-soft">合计：</text>
          <text class="ml-[4rpx] font-bold text-[22rpx] text-green">¥</text>
          <text class="font-bold text-[36rpx] text-green">{{ totalPrice ?? 0 }}</text>
        </view>
        <view class="mt-[2rpx] flex items-center gap-[4rpx]">
          <text class="text-[20rpx] text-ink-soft">明细</text>
          <t-icon name="chevron-up" size="24rpx" color="rgba(0,0,0,0.58)" />
        </view>
      </view>
      <view class="shrink-0">
        <view
          class="flex h-[76rpx] items-center justify-center rounded-button bg-gold px-[40rpx] shadow-[0_4rpx_12rpx_rgba(203,162,88,0.2)]"
        >
          <text class="font-bold text-[26rpx] text-surface-dark">结算({{ totalCount ?? 0 }})</text>
        </view>
      </view>
    </view>
  </view>
</template>
