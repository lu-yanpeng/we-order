<template>
  <view class="content">
    <image class="logo" src="/static/logo.png" />
    <view class="text-area">
      <text class="title text-blue-600">{{ title }}</text>
    </view>
    <view>
      <text class="text-3xl font-bold underline text-blue-600">测试</text>
    </view>

    <view>
      <button type="default" @click="goto">跳转到订单页</button>
      <button type="default" @click="goto2">跳转到详情页</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const title = ref('Hello')

const goto = () => {
  console.log('跳转')
  uni.navigateTo({
    url: '/sub-order-confirm/order-confirm/index',
  })
}
const goto2 = () => {
  console.log('跳转')
  uni.navigateTo({
    url: '/sub-order-detail/order-detail/index',
  })
}
</script>

<style>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.logo {
  height: 200rpx;
  width: 200rpx;
  margin-top: 200rpx;
  margin-left: auto;
  margin-right: auto;
  margin-bottom: 50rpx;
}

.text-area {
  display: flex;
  justify-content: center;
}

.title {
  font-size: 36rpx;
}
</style>
