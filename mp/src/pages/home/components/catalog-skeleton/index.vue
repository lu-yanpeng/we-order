<script setup lang="ts">
/**
 * 点餐 tab 目录骨架（Story 4.1；2026-09-27 加载态范围修订）
 *
 * 纯展示：左栏分类、右栏分类标题 + 商品卡的色块占位，不要求还原细节、不阻塞交互。
 * 只在首屏无数据且读取超过约 250ms 防抖延迟时由页面渲染；刷新不回骨架。
 * 与订单骨架分开实现（spine 最小 UI 规范）。
 */
</script>

<template>
  <view class="flex h-full animate-pulse overflow-hidden">
    <!-- 左栏：分类 -->
    <view class="flex w-1/5 shrink-0 flex-col gap-[48rpx] bg-[#f7f8fa] pt-[32rpx]">
      <view v-for="i in 6" :key="i" class="flex justify-center">
        <view class="h-[28rpx] w-[76rpx] rounded-[8rpx] bg-black-6" />
      </view>
    </view>

    <!-- 右栏：分类标题 + 商品卡 -->
    <view class="min-w-0 flex-1 pr-5 pl-4">
      <view class="py-[24rpx] pl-[32rpx]">
        <view class="h-[26rpx] w-[140rpx] rounded-[8rpx] bg-black-6" />
      </view>
      <view
        v-for="i in 3"
        :key="i"
        class="flex items-center gap-[24rpx] border-border-hairline border-b-[2rpx] py-[28rpx]"
      >
        <view class="h-[144rpx] w-[144rpx] shrink-0 rounded-[24rpx] bg-black-6" />
        <view class="flex min-w-0 flex-1 flex-col gap-[12rpx]">
          <view class="h-[28rpx] w-[60%] rounded-[8rpx] bg-black-6" />
          <view class="h-[22rpx] w-[85%] rounded-[8rpx] bg-black-6" />
          <view class="mt-[8rpx] h-[30rpx] w-[120rpx] rounded-[8rpx] bg-black-6" />
        </view>
      </view>
    </view>
  </view>
</template>
