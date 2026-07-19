<script setup lang="ts">
import type { Product } from '@/types/product'

defineProps<{
  product: Product
}>()

const emit = defineEmits<{
  (e: 'add-to-cart', product: Product): void
}>()

const handleAddToCart = (product: Product) => {
  emit('add-to-cart', product)
}
</script>

<template>
  <view class="flex items-center gap-[24rpx] border-border-hairline border-b-[2rpx] py-[28rpx]">
    <view class="h-[144rpx] w-[144rpx] shrink-0 rounded-[24rpx] bg-surface-ceramic" />
    <view class="flex min-w-0 flex-1 flex-col gap-[4rpx]">
      <text class="leading-[1.3] font-semibold text-[28rpx] text-ink">{{ product.name }}</text>
      <text class="line-clamp-2 leading-[1.4] text-[22rpx] text-ink-soft">{{ product.desc }}</text>
      <text v-if="product.sales > 0" class="mt-[2rpx] text-[22rpx] text-ink-soft"
        >月售{{ product.sales }}</text
      >
      <view v-if="product.tags.length > 0" class="mt-[4rpx] flex gap-[8rpx]">
        <text
          v-for="tag in product.tags"
          :key="tag"
          class="rounded-[4rpx] bg-green-light px-[8rpx] py-[2rpx] leading-[1.4] font-semibold text-[18rpx] text-green-accent"
          >{{ tag }}</text
        >
      </view>
      <view class="mt-[8rpx] flex items-center justify-between">
        <view class="flex items-baseline">
          <text class="mr-[2rpx] leading-none text-[22rpx] text-ink">¥</text>
          <text class="leading-none font-bold text-[30rpx] text-ink">{{ product.price }}</text>
        </view>
        <t-icon
          name="add-circle-filled"
          size="52rpx"
          color="#00754a"
          @click="handleAddToCart(product)"
        />
      </view>
    </view>
  </view>
</template>
