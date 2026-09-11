<script setup lang="ts">
/**
 * 规格选择弹窗（底部弹出）— 纯展示层
 *
 * 遵循 AD-3：组件仅接收 props 渲染 UI，通过 emit 通知父组件。
 * 所有表单状态（selections、count）与价格计算均由 useSpecSheet Composable 持有。
 *
 * 两种展示模式：
 *   - 有规格（hasSpecs）：显示规格组 + 数量步进器
 *   - 无规格（!hasSpecs）：仅显示数量步进器
 */
import { computed } from 'vue'
import type { Product } from '@/types/product'
import MyStepper from '@/components/stepper/index.vue'
import { getSafeBottom } from '@/utils/platform'

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
  'update:visible': [value: boolean]
  confirm: []
  'toggle-option': [groupId: string, optionId: string]
  'update-count': [delta: number]
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
const safeBottom = getSafeBottom()
</script>

<template>
  <view class="spec-sheet">
    <t-popup v-model:visible="popupVisible" placement="bottom" :prevent-scroll-through="false">
      <template #close-btn>
        <t-icon
          name="close-circle"
          size="60rpx"
          custom-style="color: #edebe9;"
          @click="handleClose"
        />
      </template>

      <view
        v-if="product"
        class="flex max-h-[75vh] flex-col overflow-hidden rounded-t-[40rpx] bg-surface-card"
      >
        <view class="flex shrink-0 items-start border-b border-border-hairline p-[32rpx]">
          <view
            class="mr-[24rpx] h-[144rpx] w-[144rpx] shrink-0 rounded-[24rpx] bg-surface-ceramic"
          />
          <view class="flex min-w-0 flex-1 flex-col pt-[8rpx]">
            <text class="leading-[1.3] font-semibold text-[32rpx] text-ink">{{
              product.name
            }}</text>
            <text class="leading-[1.4] text-[22rpx] text-ink-soft">{{ product.desc }}</text>
          </view>
        </view>

        <view class="scrollbar-hide min-h-0 flex-1 overflow-y-auto">
          <view class="px-[32rpx] pt-[28rpx] pb-[48rpx]">
            <template v-if="hasSpecs">
              <view
                v-for="group in product.specGroups"
                :key="group.id"
                class="mb-[36rpx] last:mb-0"
              >
                <text class="mb-[16rpx] block font-bold text-[24rpx] text-ink">{{
                  group.title
                }}</text>
                <view class="flex flex-wrap">
                  <view
                    v-for="opt in group.options"
                    :key="opt.id"
                    class="mr-[16rpx] mb-[16rpx] flex items-center rounded-button border border-border px-[28rpx] py-[12rpx] font-medium text-[24rpx] text-ink-soft"
                    :class="{
                      '!border-green-accent bg-green-accent !font-semibold !text-ink-inverse':
                        isActive(group.id, opt.id),
                    }"
                    @click="$emit('toggle-option', group.id, opt.id)"
                  >
                    <text class="mr-[8rpx] leading-none">{{ opt.label }}</text>
                    <text v-if="opt.priceExtra > 0" class="text-[20rpx] opacity-80"
                      >+¥{{ opt.priceExtra }}</text
                    >
                  </view>
                </view>
              </view>
            </template>

            <view class="mb-0 flex items-center justify-between">
              <text class="shrink-0 font-bold text-[24rpx] text-ink">{{ stepperLabel }}</text>
              <my-stepper
                :model-value="count"
                @update:model-value="$emit('update-count', $event)"
                :min="1"
              />
            </view>
          </view>
        </view>

        <view
          class="shrink-0 border-t border-border-hairline bg-surface-card"
          :style="{ paddingBottom: safeBottom + 'px' }"
        >
          <view
            class="flex min-h-(--mp-frap-size) items-center justify-between px-[32rpx] pt-[16rpx]"
          >
            <view class="mr-[24rpx] flex flex-1 flex-col overflow-hidden">
              <view class="mb-[4rpx] flex items-baseline">
                <text class="mr-[2rpx] text-[26rpx] text-ink">¥</text>
                <text class="leading-none font-bold text-[40rpx] text-ink">{{ totalPrice }}</text>
              </view>
              <text class="text-[18rpx] text-ink-soft">{{ priceLabel }}</text>
            </view>
            <view
              class="shrink-0 rounded-button bg-green-accent px-[48rpx] py-[20rpx]"
              @click="handleConfirm"
            >
              <text class="font-semibold text-[28rpx] text-ink-inverse">加入购物车</text>
            </view>
          </view>
        </view>
      </view>
    </t-popup>
  </view>
</template>

<style scoped lang="less">
.spec-sheet :deep(.t-popup) {
  padding-bottom: 0;
  border-radius: 32rpx 32rpx 0 0;

  /* 调整自定义关闭按钮到合适位置 */
  .t-popup__close {
    top: -110rpx;
    right: 16rpx;
  }
}
</style>
