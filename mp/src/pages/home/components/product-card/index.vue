<script setup lang="ts">
import { ref } from 'vue'
import type { MenuProduct } from '@/types/api-contracts'

const { product, imageUrl = '' } = defineProps<{
  product: MenuProduct
  /** 图片地址（经 api/ 出口构造）；空串或加载失败时以色块占位 */
  imageUrl?: string
}>()

const emit = defineEmits<{
  'add-to-cart': [product: MenuProduct]
}>()

/** 图片加载失败标记：回退色块占位，不阻塞列表渲染（AD-17） */
const imageFailed = ref(false)

const handleAddToCart = (product: MenuProduct) => {
  emit('add-to-cart', product)
}
</script>

<template>
  <view class="flex items-center gap-[24rpx] border-border-hairline border-b-[2rpx] py-[28rpx]">
    <view class="h-[144rpx] w-[144rpx] shrink-0 overflow-hidden rounded-[24rpx] bg-surface-ceramic">
      <image
        v-if="imageUrl && !imageFailed"
        class="h-full w-full"
        :src="imageUrl"
        mode="aspectFill"
        lazy-load
        @error="imageFailed = true"
      />
    </view>
    <view class="flex min-w-0 flex-1 flex-col gap-[4rpx]">
      <text class="leading-[1.3] font-semibold text-[28rpx] text-ink">{{ product.name }}</text>
      <text class="line-clamp-2 leading-[1.4] text-[22rpx] text-ink-soft">{{
        product.description
      }}</text>
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
