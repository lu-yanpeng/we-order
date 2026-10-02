<script setup lang="ts">
/**
 * 订单卡片骨架（Story 4.1；2026-09-27 加载态范围修订）
 *
 * 纯展示：色块占位、不要求还原细节。只在首屏无数据且读取超过约 250ms 防抖延迟时
 * 由页面渲染；刷新（切 tab / onShow / 下拉）静默更新、不回骨架。
 * 与点餐骨架分开实现（spine 最小 UI 规范）。
 */
</script>

<template>
  <view class="animate-pulse">
    <view
      v-for="i in 2"
      :key="i"
      class="mb-[24rpx] flex flex-col gap-[24rpx] rounded-[24rpx] bg-surface-card p-[32rpx] shadow-card"
    >
      <!-- 卡头：订单编号 + 时间 + 状态 -->
      <view class="flex items-start justify-between border-b border-border-hairline pb-[16rpx]">
        <view class="flex flex-col gap-[8rpx]">
          <view class="h-[24rpx] w-[280rpx] rounded-[8rpx] bg-black-6" />
          <view class="h-[20rpx] w-[220rpx] rounded-[8rpx] bg-black-6" />
        </view>
        <view class="h-[24rpx] w-[88rpx] rounded-[8rpx] bg-black-6" />
      </view>

      <!-- 卡身：商品摘要 + 金额 -->
      <view class="flex items-center justify-between">
        <view class="flex flex-1 flex-col gap-[12rpx] pr-[24rpx]">
          <view class="h-[28rpx] w-[70%] rounded-[8rpx] bg-black-6" />
          <view class="h-[22rpx] w-[45%] rounded-[8rpx] bg-black-6" />
        </view>
        <view class="h-[32rpx] w-[96rpx] rounded-[8rpx] bg-black-6" />
      </view>

      <!-- 卡尾：状态操作 -->
      <view class="flex justify-end border-t border-dashed border-border-hairline pt-[20rpx]">
        <view class="h-[52rpx] w-[132rpx] rounded-full bg-black-6" />
      </view>
    </view>
  </view>
</template>
