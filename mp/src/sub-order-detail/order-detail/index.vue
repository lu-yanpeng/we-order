<script setup lang="ts">
/**
 * 订单详情页（FR-13 待实现）
 *
 * loading 由 useOrders.goToOrderDetail 显示，页面首屏渲染完成后在此取消（与结算页同构）。
 */
import { onReady } from '@dcloudio/uni-app'

onReady(() => {
  uni.hideLoading()
})
</script>

<template>
  <view>
    <text class="text-3xl font-bold text-blue-600 underline">订单详情</text>
  </view>
</template>
