<script setup lang="ts">
import { onReady } from '@dcloudio/uni-app'

// loading 由 useCheckoutBar.goToCheckout 显示，页面首屏渲染完成后在此取消。
// Phase 3 接入服务器后，把 hideLoading 移到「数据 fetch 完成」之后即可。
onReady(() => {
  uni.hideLoading()
})
</script>

<template>
  <view>
    <text class="text-3xl font-bold text-blue-600 underline">确定订单</text>
  </view>
</template>
