<script setup lang="ts">
/**
 * 通用底部栏容器 — 结算栏 / 规格加购栏 / 支付栏的共同骨架
 *
 * 高度统一由 --mp-frap-size token 控制（见 styles/main.css），
 * 底部安全区避让与 checkout-bar 保持一致。
 * 定位方式（fixed / 页面流式贴底）由使用方决定，本组件不做定位。
 */
import { getSafeBottom } from '@/utils/platform'

const safeBottom = getSafeBottom()
</script>

<template>
  <view
    class="border-t border-border-hairline bg-surface-card"
    :style="{ paddingBottom: safeBottom + 'px' }"
  >
    <view class="flex min-h-(--mp-frap-size) items-center justify-between px-[32rpx] pt-[16rpx]">
      <slot name="left" />
      <slot name="right" />
    </view>
  </view>
</template>
