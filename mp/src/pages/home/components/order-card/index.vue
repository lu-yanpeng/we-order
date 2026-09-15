<script setup lang="ts">
/**
 * 订单卡片（FR-11 / FR-12）
 *
 * 纯展示组件：按订单状态渲染状态标签、取杯提示块与底部操作按钮，
 * 操作只向外 emit，不涉及数据读写（AD-2：组件不依赖 composable / store）。
 */
import { computed } from 'vue'
import type { Order, OrderStatus } from '@/types/order'

const { order } = defineProps<{
  order: Order
}>()

const emit = defineEmits<{
  click: []
  urge: []
  'confirm-pickup': []
  reorder: []
}>()

/** 状态文案与状态色（FR-11：制作中-蓝 / 待取餐-金 / 已完成-绿） */
const STATUS_META: Record<OrderStatus, { label: string; textClass: string }> = {
  cooking: { label: '制作中', textClass: 'text-[#3b82f6]' },
  pickup: { label: '待取餐', textClass: 'text-gold' },
  completed: { label: '已完成', textClass: 'text-green-accent' },
}

/** 底部操作按钮（原型 .btn-reorder 三态变体） */
const ACTION_META: Record<OrderStatus, { label: string; class: string }> = {
  cooking: { label: '催单', class: 'border-ink-soft text-ink-soft' },
  pickup: { label: '确认取杯', class: 'border-gold text-gold' },
  completed: { label: '再来一单', class: 'border-green-accent text-green-accent' },
}

const statusMeta = computed(() => STATUS_META[order.status])
const actionMeta = computed(() => ACTION_META[order.status])

/** 就餐方式文案 */
const modeLabel = computed(() => (order.diningMode === 'takeout' ? '打包外带' : '店内堂食'))

/** 商品标题：[就餐方式] 商品名、商品名 */
const goodsTitle = computed(
  () => `[${modeLabel.value}] ${order.items.map((it) => it.productName).join('、')}`,
)

/** 规格摘要 */
const goodsDesc = computed(() => order.items.map((it) => it.specSummary).join(' | '))

/** 备注，「无备注要求」视为未填写 */
const goodsNotes = computed(() =>
  order.notes && order.notes !== '无备注要求' ? `备注: ${order.notes}` : '',
)

/** 底部按钮按状态派发对应操作 */
const handleAction = () => {
  if (order.status === 'cooking') emit('urge')
  else if (order.status === 'pickup') emit('confirm-pickup')
  else emit('reorder')
}
</script>

<template>
  <view
    class="mb-[24rpx] flex flex-col gap-[24rpx] rounded-[24rpx] bg-surface-card p-[32rpx] shadow-card"
    @click="emit('click')"
  >
    <!-- 卡头：订单编号 + 状态标签 -->
    <view class="flex items-center justify-between border-b border-border-hairline pb-[16rpx]">
      <text class="text-[24rpx] text-ink-soft">订单编号: {{ order.id }}</text>
      <text class="font-bold text-[24rpx]" :class="statusMeta.textClass">
        {{ statusMeta.label }}
      </text>
    </view>

    <!-- 卡身：商品信息 + 金额 -->
    <view class="flex items-center justify-between">
      <view class="flex min-w-0 flex-1 flex-col gap-[8rpx] pr-[24rpx]">
        <text class="line-clamp-1 font-semibold text-[28rpx] text-ink">{{ goodsTitle }}</text>
        <text class="line-clamp-2 leading-[1.3] text-[22rpx] text-ink-soft">{{ goodsDesc }}</text>
        <text v-if="goodsNotes" class="line-clamp-2 leading-[1.3] text-[22rpx] text-ink-soft">{{
          goodsNotes
        }}</text>
      </view>
      <view class="flex shrink-0 items-baseline">
        <text class="font-bold text-[22rpx] text-ink">¥</text>
        <text class="font-bold text-[32rpx] text-ink">{{ order.totalPrice }}</text>
      </view>
    </view>

    <!-- 待取餐：取杯号提示 -->
    <view
      v-if="order.status === 'pickup'"
      class="rounded-[8rpx] border border-dashed border-gold bg-[rgba(203,162,88,0.05)] px-[24rpx] py-[20rpx]"
    >
      <view class="flex justify-between font-semibold text-[22rpx] text-gold">
        <text>凭取杯号 {{ order.pickupCode }} 到柜台取杯</text>
        <text>待取餐</text>
      </view>
    </view>

    <!-- 卡尾：状态操作 -->
    <view class="flex justify-end border-t border-dashed border-border-hairline pt-[20rpx]">
      <view
        class="flex h-[52rpx] items-center justify-center rounded-full border px-[32rpx] text-[24rpx]"
        :class="actionMeta.class"
        @click.stop="handleAction"
      >
        <text class="leading-[1] font-semibold">{{ actionMeta.label }}</text>
      </view>
    </view>
  </view>
</template>
