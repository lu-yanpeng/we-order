<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Product } from '@/types/product'

interface SpecOption {
  id: string
  label: string
  priceExtra: number
}

interface SpecGroup {
  id: string
  title: string
  options: SpecOption[]
  multi: boolean
}

const props = defineProps<{
  product: Product
}>()

defineOptions({
  options: {
    // 修改t-popup组件的默认样式
    styleIsolation: 'shared',
  },
})

const specGroups: SpecGroup[] = [
  {
    id: 'size',
    title: '选择杯型',
    multi: false,
    options: [
      { id: 'tall', label: '中杯 Tall', priceExtra: 0 },
      { id: 'grande', label: '大杯 Grande', priceExtra: 3 },
      { id: 'venti', label: '超大杯 Venti', priceExtra: 6 },
    ],
  },
  {
    id: 'temp',
    title: '温度',
    multi: false,
    options: [
      { id: 'ice', label: '冰饮推荐', priceExtra: 0 },
      { id: 'hot', label: '热饮', priceExtra: 0 },
      { id: 'warm', label: '温饮', priceExtra: 0 },
    ],
  },
  {
    id: 'milk',
    title: '牛奶选择',
    multi: false,
    options: [
      { id: 'oat', label: '燕麦奶', priceExtra: 2 },
      { id: 'whole', label: '全脂牛奶', priceExtra: 0 },
      { id: 'soy', label: '椰乳', priceExtra: 2 },
      { id: 'skim', label: '脱脂牛奶', priceExtra: 0 },
      { id: 'coconut', label: '生椰奶', priceExtra: 3 },
    ],
  },
  {
    id: 'addons',
    title: '加料选择（可多选）',
    multi: true,
    options: [
      { id: 'caramel', label: '焦糖淋酱', priceExtra: 3 },
      { id: 'cream', label: '稀奶油', priceExtra: 4 },
      { id: 'chips', label: '可可碎片', priceExtra: 4 },
      { id: 'pearls', label: '黑糖珍珠', priceExtra: 3 },
      { id: 'jelly', label: '椰果', priceExtra: 2 },
      { id: 'red_bean', label: '红豆', priceExtra: 2 },
    ],
  },
  {
    id: 'sweetness',
    title: '甜度',
    multi: false,
    options: [
      { id: 'full', label: '正常糖', priceExtra: 0 },
      { id: 'less', label: '少糖', priceExtra: 0 },
      { id: 'half', label: '半糖', priceExtra: 0 },
      { id: 'none', label: '无糖', priceExtra: 0 },
    ],
  },
  {
    id: 'ice_level',
    title: '冰量',
    multi: false,
    options: [
      { id: 'normal', label: '正常冰', priceExtra: 0 },
      { id: 'less_ice', label: '少冰', priceExtra: 0 },
      { id: 'no_ice', label: '去冰', priceExtra: 0 },
    ],
  },
]

const selections = reactive({
  size: 'grande',
  temp: 'ice',
  milk: 'oat',
  addons: [] as string[],
  sweetness: 'full',
  ice_level: 'normal',
  shotCount: 1,
})

const isActive = (groupId: string, optionId: string) => {
  if (groupId === 'addons') {
    return selections.addons.includes(optionId)
  }
  return selections[groupId as keyof typeof selections] === optionId
}

const toggleOption = (groupId: string, optionId: string) => {
  const group = specGroups.find((g) => g.id === groupId)
  if (!group) return

  if (group.multi) {
    const idx = selections.addons.indexOf(optionId)
    if (idx > -1) {
      selections.addons.splice(idx, 1)
    } else {
      selections.addons.push(optionId)
    }
  } else {
    ;(selections as Record<string, unknown>)[groupId] = optionId
  }
}

const updateShots = (delta: number) => {
  selections.shotCount = Math.max(1, selections.shotCount + delta)
}

const totalPrice = computed(() => {
  let price = props.product.price

  for (const group of specGroups) {
    if (group.id === 'addons') continue
    const opt = group.options.find((o) => o.id === selections[group.id as keyof typeof selections])
    if (opt) price += opt.priceExtra
  }

  const addonGroup = specGroups.find((g) => g.id === 'addons')
  if (addonGroup) {
    for (const id of selections.addons) {
      const opt = addonGroup.options.find((o) => o.id === id)
      if (opt) price += opt.priceExtra
    }
  }

  if (selections.shotCount > 1) {
    price += (selections.shotCount - 1) * 4
  }

  return price
})

const specSummary = computed(() => {
  const parts: string[] = []

  for (const group of specGroups) {
    if (group.id === 'addons') continue
    const selId = selections[group.id as keyof typeof selections]
    const label = group.options.find((o) => o.id === selId)?.label || ''
    parts.push(label)
  }

  parts.push(`${selections.shotCount}份浓缩`)

  const addonLabels = selections.addons
    .map(
      (id) =>
        specGroups.find((g) => g.id === 'addons')?.options.find((o) => o.id === id)?.label || '',
    )
    .filter(Boolean)

  return parts.join(' / ') + (addonLabels.length > 0 ? ' / ' + addonLabels.join(' / ') : '')
})

const visible = ref(true)

const safeBottom = ref(0)
const info = uni.getWindowInfo()
safeBottom.value = info.safeAreaInsets?.bottom || 8

const handleUpdateVisible = () => {
  visible.value = true
}
</script>

<template>
  <t-popup
    :visible="visible"
    placement="bottom"
    :close-on-overlay-click="false"
    :prevent-scroll-through="false"
    @update:visible="handleUpdateVisible"
  >
    <template #close-btn>
      <t-icon name="close-circle" size="60rpx" custom-style="color: var(--mp-color-bg-ceramic);" />
    </template>

    <view class="spec-content">
      <view class="spec-header">
        <view class="spec-product-img" />
        <view class="spec-product-info">
          <text class="spec-product-name">{{ product.name }}</text>
          <text class="spec-product-desc">{{ product.desc }}</text>
        </view>
      </view>

      <view class="spec-scroll-wrapper">
        <view class="spec-scroll-inner">
          <view v-for="group in specGroups" :key="group.id" class="spec-group">
            <text class="spec-group-title">{{ group.title }}</text>
            <view class="spec-pills-row">
              <view
                v-for="opt in group.options"
                :key="opt.id"
                class="spec-pill"
                :class="{ 'spec-pill--active': isActive(group.id, opt.id) }"
                @click="toggleOption(group.id, opt.id)"
              >
                <text class="spec-pill-label">{{ opt.label }}</text>
                <text v-if="opt.priceExtra > 0" class="spec-pill-extra"
                  >+¥{{ opt.priceExtra }}</text
                >
              </view>
            </view>
          </view>

          <view class="spec-group spec-shots-row">
            <text class="spec-shots-label">浓缩份数</text>
            <view class="spec-stepper">
              <view class="spec-stepper-btn" @click="updateShots(-1)">
                <!-- 微调`-`号否则视觉上会偏下一点点 -->
                <text class="spec-stepper-symbol translate-y-[-7%]">-</text>
              </view>
              <text class="spec-stepper-val">{{ selections.shotCount }}</text>
              <view class="spec-stepper-btn" @click="updateShots(1)">
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
            <text class="spec-price-details">{{ specSummary }}</text>
          </view>
          <view class="spec-add-btn">
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
    top: -10%;
    right: 3%;
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
