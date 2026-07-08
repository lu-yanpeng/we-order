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
  <view class="product-card">
    <view class="product-img" />
    <view class="product-info">
      <text class="product-name">{{ product.name }}</text>
      <text class="product-desc">{{ product.desc }}</text>
      <text v-if="product.sales > 0" class="product-sales">月售{{ product.sales }}</text>
      <view v-if="product.tags.length > 0" class="product-tags">
        <text v-for="tag in product.tags" :key="tag" class="product-tag">{{ tag }}</text>
      </view>
      <view class="product-footer">
        <view class="product-price">
          <text class="price-symbol">¥</text>
          <text class="price-value">{{ product.price }}</text>
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

<style scoped>
.product-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 28rpx 0;
  border-bottom: 2rpx solid #e7e7e7;
}

.product-img {
  width: 144rpx;
  height: 144rpx;
  border-radius: 24rpx;
  background-color: #edebe9;
  flex-shrink: 0;
}

.product-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}

.product-name {
  font-size: 28rpx;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
  line-height: 1.3;
}

.product-desc {
  font-size: 22rpx;
  color: rgba(0, 0, 0, 0.58);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.product-sales {
  font-size: 22rpx;
  color: rgba(0, 0, 0, 0.58);
  margin-top: 2rpx;
}

.product-tags {
  display: flex;
  gap: 8rpx;
  margin-top: 4rpx;
}

.product-tag {
  font-size: 18rpx;
  font-weight: 600;
  color: #00754a;
  background-color: #d4e9e2;
  padding: 2rpx 8rpx;
  border-radius: 4rpx;
  line-height: 1.4;
}

.product-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8rpx;
}

.product-price {
  display: flex;
  align-items: baseline;
}

.price-symbol {
  font-size: 22rpx;
  color: rgba(0, 0, 0, 0.87);
  margin-right: 2rpx;
  line-height: 1;
}

.price-value {
  font-size: 30rpx;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.87);
  line-height: 1;
}
</style>
