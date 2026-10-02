<script setup lang="ts">
/**
 * 订单列表空态（Story 4.1；spine 最小 UI 规范）
 *
 * 纯展示：读取成功且 0 条时出现（文案 + 引导）；「去点餐」只向外 emit，
 * 由页面切换到点餐 tab。空态不发起重复读取（不轮询）由列表 Composable 保证。
 */
const emit = defineEmits<{
  'go-menu': []
}>()
</script>

<template>
  <view class="flex min-h-[70vh] flex-col items-center justify-center gap-[32rpx]">
    <text class="text-[28rpx] text-ink-soft">还没有订单</text>
    <t-button theme="primary" size="small" @click="emit('go-menu')">去点餐</t-button>
  </view>
</template>
