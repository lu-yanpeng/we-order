<script setup lang="ts">
const { max = 100, min = 0 } = defineProps<{
  max?: number
  min?: number
}>()

const count = defineModel<number>({ default: 0, required: true, type: Number })

const reduce = () => {
  if (count.value <= min) {
    return
  }
  count.value -= 1
}
const addTo = () => {
  if (count.value >= max) {
    return
  }
  count.value += 1
}
</script>

<template>
  <view
    class="flex items-center justify-between rounded-button bg-surface-ceramic px-[10rpx] py-[8rpx]"
  >
    <view
      class="flex h-[48rpx] w-[48rpx] items-center justify-center rounded-full border border-border bg-surface-card"
      @click="reduce"
    >
      <text class="translate-y-[-7%] leading-none font-medium text-[32rpx] text-ink-soft">-</text>
    </view>
    <text class="min-w-[70rpx] text-center font-semibold text-[26rpx]">{{ count }}</text>
    <view
      class="flex h-[48rpx] w-[48rpx] items-center justify-center rounded-full border border-border bg-surface-card"
      @click="addTo"
    >
      <text class="leading-none font-medium text-[32rpx] text-ink-soft">+</text>
    </view>
  </view>
</template>
