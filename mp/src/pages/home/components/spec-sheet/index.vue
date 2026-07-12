<script setup lang="ts">
/**
 * 规格选择弹窗（底部弹出）— 纯展示层
 *
 * 遵循 AD-3：组件仅接收 props 渲染 UI，通过 emit 通知父组件。
 * 所有表单状态（selections、count）与价格计算均由 useSpecSheet Composable 持有。
 *
 * 两种展示模式：
 *   - 有规格（hasSpecs）：显示规格组 + 浓缩份数步进器
 *   - 无规格（!hasSpecs）：仅显示数量步进器
 */
import { computed, ref } from 'vue'
import type { Product } from '@/types/product'

const props = defineProps<{
  visible: boolean
  product: Product | null
  /** 各规格组的选中值: { groupId: optionId | optionId[] } */
  selections: Record<string, string | string[]>
  /** 步进器数值 */
  count: number
  /** 最终价格 */
  totalPrice: number
  /** 价格旁摘要文案 */
  priceLabel: string
  /** 步进器标签 */
  stepperLabel: string
  /** 是否有规格组 */
  hasSpecs: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'confirm'): void
  (e: 'toggle-option', groupId: string, optionId: string): void
  (e: 'update-count', delta: number): void
}>()

defineOptions({
  options: {
    styleIsolation: 'shared',
  },
})

/** 判断某个规格选项是否被选中（纯 UI 显示逻辑，不涉及业务规则） */
const isActive = (groupId: string, optionId: string) => {
  const val = props.selections[groupId]
  if (Array.isArray(val)) return val.includes(optionId)
  return val === optionId
}

/** 关闭弹窗（点击 X 按钮或遮罩） */
const handleClose = () => {
  emit('update:visible', false)
}

/** 确认选择 */
const handleConfirm = () => {
  if (!props.product) return
  emit('confirm')
}

/** 代理 props.visible，桥接 t-popup 的 v-model:visible 到父组件 */
const popupVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

/** 底部安全区高度，确保结算栏不被刘海或底部横条遮挡 */
const safeBottom = ref(0)
const info = uni.getWindowInfo()
safeBottom.value = info.safeAreaInsets?.bottom || 8
</script>

<template>
  <t-popup v-model:visible="popupVisible" placement="bottom" :prevent-scroll-through="false">
    <template #close-btn>
      <t-icon
        name="close-circle"
        size="60rpx"
        custom-style="color: var(--mp-color-bg-ceramic);"
        @click="handleClose"
      />
    </template>

    <view v-if="product" class="spec-content">
      <view class="spec-header">
        <view class="spec-product-img" />
        <view class="spec-product-info">
          <text class="spec-product-name">{{ product.name }}</text>
          <text class="spec-product-desc">{{ product.desc }}</text>
        </view>
      </view>

      <view class="spec-scroll-wrapper">
        <view class="spec-scroll-inner">
          <template v-if="hasSpecs">
            <view v-for="group in product.specGroups" :key="group.id" class="spec-group">
              <text class="spec-group-title">{{ group.title }}</text>
              <view class="spec-pills-row">
                <view
                  v-for="opt in group.options"
                  :key="opt.id"
                  class="spec-pill"
                  :class="{ 'spec-pill--active': isActive(group.id, opt.id) }"
                  @click="$emit('toggle-option', group.id, opt.id)"
                >
                  <text class="spec-pill-label">{{ opt.label }}</text>
                  <text v-if="opt.priceExtra > 0" class="spec-pill-extra"
                    >+¥{{ opt.priceExtra }}</text
                  >
                </view>
              </view>
            </view>
          </template>

          <view class="spec-group spec-shots-row">
            <text class="spec-shots-label">{{ stepperLabel }}</text>
            <view class="spec-stepper">
              <view class="spec-stepper-btn" @click="$emit('update-count', -1)">
                <text class="spec-stepper-symbol translate-y-[-7%]">-</text>
              </view>
              <text class="spec-stepper-val">{{ count }}</text>
              <view class="spec-stepper-btn" @click="$emit('update-count', 1)">
                <text class="spec-stepper-symbol">+</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view class="spec-footer">
        <view class="spec-footer__inner" :style="{ paddingBottom: safeBottom + 'px' }">
          <view class="spec-price-section">
            <view class="spec-price">
              <text class="spec-price-symbol">¥</text>
              <text class="spec-price-value">{{ totalPrice }}</text>
            </view>
            <text class="spec-price-details">{{ priceLabel }}</text>
          </view>
          <view class="spec-add-btn" @click="handleConfirm">
            <text class="spec-add-btn-text">加入购物袋</text>
          </view>
        </view>
      </view>
    </view>
  </t-popup>
</template>

<style>
/* 直接使用同名的选择器覆盖默认样式 */
.t-popup {
  /* 去掉组件自带的安全区，该用safeBottom，和分包组件checkout-bar保持高度一致 */
  padding-bottom: 0 !important;
  border-radius: 32rpx 32rpx 0 0 !important;

  /* 调整自定义关闭按钮到合适位置 */
  .t-popup__close {
    top: -110rpx;
    right: 16rpx;
  }
}
</style>

<style scoped>
.spec-content {
  display: flex;
  flex-direction: column;
  max-height: 75vh;
  overflow: hidden;
  background-color: #ffffff;
  border-radius: 40rpx 40rpx 0 0;
}

.spec-header {
  display: flex;
  align-items: flex-start;
  padding: 32rpx;
  border-bottom: 2rpx solid var(--mp-color-border-hairline);
  flex-shrink: 0;
}

.spec-product-img {
  width: 144rpx;
  height: 144rpx;
  border-radius: 24rpx;
  background-color: var(--mp-color-bg-ceramic);
  flex-shrink: 0;
  margin-right: 24rpx;
}

.spec-product-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-top: 8rpx;
}

.spec-product-name {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--mp-color-text);
  line-height: 1.3;
}

.spec-product-desc {
  font-size: 22rpx;
  color: var(--mp-color-text-soft);
  line-height: 1.4;
}

.spec-scroll-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.spec-scroll-wrapper::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.spec-scroll-inner {
  padding: 28rpx 32rpx 48rpx;
}

.spec-group {
  margin-bottom: 36rpx;
}

.spec-group:last-child {
  margin-bottom: 0;
}

.spec-group-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--mp-color-text);
  display: block;
  margin-bottom: 16rpx;
}

.spec-pills-row {
  display: flex;
  flex-wrap: wrap;
}

.spec-pill {
  border: 2rpx solid var(--mp-color-border);
  padding: 12rpx 28rpx;
  border-radius: var(--mp-radius-button);
  font-size: 24rpx;
  font-weight: 500;
  color: var(--mp-color-text-soft);
  display: flex;
  align-items: center;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
}

.spec-pill--active {
  background-color: var(--mp-color-green-accent);
  border-color: var(--mp-color-green-accent);
  color: #ffffff;
  font-weight: 600;
}

.spec-pill-label {
  line-height: 1;
  margin-right: 8rpx;
}

.spec-pill-extra {
  font-size: 20rpx;
  opacity: 0.8;
}

.spec-shots-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0;
}

.spec-shots-label {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--mp-color-text);
  flex-shrink: 0;
}

.spec-stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--mp-color-bg-ceramic);
  padding: 8rpx 10rpx;
  border-radius: var(--mp-radius-button);
}

.spec-stepper-btn {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  border: 2rpx solid var(--mp-color-border);
  background-color: var(--mp-color-bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
}

.spec-stepper-symbol {
  font-size: 32rpx;
  font-weight: 500;
  color: var(--mp-color-text-soft);
  line-height: 1;
}

.spec-stepper-val {
  font-size: 26rpx;
  font-weight: 600;
  min-width: 70rpx;
  text-align: center;
}

.spec-footer {
  border-top: 2rpx solid var(--mp-color-border-hairline);
  flex-shrink: 0;
  background-color: #ffffff;
}

.spec-footer__inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 120rpx;
  padding: 16rpx 32rpx 0;
}

.spec-price-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  margin-right: 24rpx;
  overflow: hidden;
}

.spec-price {
  display: flex;
  align-items: baseline;
  margin-bottom: 4rpx;
}

.spec-price-symbol {
  font-size: 26rpx;
  color: var(--mp-color-text);
  margin-right: 2rpx;
}

.spec-price-value {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--mp-color-text);
  line-height: 1;
}

.spec-price-details {
  font-size: 18rpx;
  color: var(--mp-color-text-soft);
}

.spec-add-btn {
  background-color: var(--mp-color-green-accent);
  padding: 20rpx 48rpx;
  border-radius: var(--mp-radius-button);
  flex-shrink: 0;
}

.spec-add-btn-text {
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 600;
}
</style>
