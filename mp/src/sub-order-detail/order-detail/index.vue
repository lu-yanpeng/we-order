<script setup lang="ts">
/**
 * 订单详情页（FR-13；Story 4.2 切真实读取）
 *
 * 订单经 api/orders 按 id 读取服务端快照（门店信息来自订单快照），
 * 业务逻辑由 useOrderDetail（数据加载与状态卡操作）与 useReorder（再来一单）承载（AD-3）。
 * 状态判定顺序为「加载 → 失败 → 内容」：首读期间全屏遮罩（延迟约 250ms），
 * 失败进页面内失败态（文案 + 重试），不展示缓存数据；支持页面级下拉刷新。
 * 三种状态共用同一套卡片，仅顶部状态卡不同：
 * 制作中显示取杯号与催单，待取餐显示取杯号与确认取餐，已完成显示再来一单。
 */
import { computed } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import { useOrderDetail } from '@/sub-order-detail/composables/use-order-detail'
import { useReorder } from '@/composables/use-reorder'
import LoadFailure from '@/components/load-failure/index.vue'
import type { OrderStatus } from '@/types/api-contracts'

defineOptions({
  options: {
    styleIsolation: 'shared',
  },
})

const {
  order,
  error,
  loading,
  overlayVisible,
  modeLabel,
  initOrderDetail,
  retryOrderDetail,
  refreshOrderDetail,
  urgeOrder,
  confirmPickup,
} = useOrderDetail()

const { reorder } = useReorder()

/** 状态卡文案与状态色（FR-13：制作中-蓝 / 待取餐-金 / 已完成-绿） */
const STATUS_VIEW: Record<OrderStatus, { title: string; titleClass: string; desc: string }> = {
  cooking: {
    title: '正在制作中',
    titleClass: 'text-[#3b82f6]',
    desc: '自提店吧台正在为您精心调制，请耐心等待',
  },
  pickup: {
    title: '请凭号自提',
    titleClass: 'text-gold',
    desc: '您的饮品已调制完毕，请前往吧台凭号取杯',
  },
  completed: {
    title: '订单已完成',
    titleClass: 'text-green-accent',
    desc: '订单已完成，祝您用餐愉快',
  },
}

const statusView = computed(() => (order.value ? STATUS_VIEW[order.value.status] : null))

onLoad((query) => {
  initOrderDetail(String(query?.id ?? ''))
})

/** 页面级下拉刷新：立即读取一次（失败口径由 Composable 决定），读完收起指示器 */
onPullDownRefresh(async () => {
  try {
    await refreshOrderDetail()
  } finally {
    uni.stopPullDownRefresh()
  }
})
</script>

<template>
  <view class="flex min-h-screen flex-col bg-surface-page">
    <view v-if="order" class="flex flex-col gap-[24rpx] px-[28rpx] py-[28rpx]">
      <!-- 订单状态卡片 -->
      <view
        class="flex flex-col items-center gap-[20rpx] rounded-card bg-surface-card px-[32rpx] py-[40rpx] shadow-card"
      >
        <!-- 已完成：标题位置显示取餐码（参考蜜雪冰城；三态详情页待重新设计，暂用占位样式） -->
        <template v-if="order.status === 'completed'">
          <text class="text-[20rpx] text-ink-soft">取餐码</text>
          <text class="font-bold tracking-[2rpx] text-[52rpx] text-green-accent">
            {{ order.pickup_code }}
          </text>
        </template>
        <text v-else class="font-bold text-[36rpx]" :class="statusView?.titleClass">
          {{ statusView?.title }}
        </text>
        <text class="max-w-[480rpx] text-center leading-[1.4] text-[24rpx] text-ink-soft">
          {{ statusView?.desc }}
        </text>

        <!-- 制作中 / 待取餐：取杯号（付款后即出号，制作中即展示） -->
        <view
          v-if="order.status !== 'completed'"
          class="flex w-full flex-col items-center gap-[8rpx] rounded-card border border-dashed border-gold bg-surface-ceramic px-[40rpx] py-[28rpx]"
        >
          <text class="text-[20rpx] text-ink-soft">取杯号</text>
          <text class="font-bold tracking-[2rpx] text-[52rpx] text-gold">
            {{ order.pickup_code }}
          </text>
        </view>

        <!-- 状态操作（Phase 1 仅轻提示，功能待实现） -->
        <view
          v-if="order.status === 'cooking'"
          class="flex h-[76rpx] w-full items-center justify-center rounded-button border border-ink-soft"
          @click="urgeOrder"
        >
          <text class="leading-[1] font-bold text-[26rpx] text-ink-soft">催单</text>
        </view>
        <view
          v-else-if="order.status === 'pickup'"
          class="flex h-[76rpx] w-full items-center justify-center rounded-button bg-gold"
          @click="confirmPickup"
        >
          <text class="leading-[1] font-bold text-[26rpx] text-black">确认取餐</text>
        </view>
        <view
          v-else-if="order.status === 'completed'"
          class="flex h-[76rpx] w-full items-center justify-center rounded-button border border-green-accent"
          @click="reorder(order)"
        >
          <text class="leading-[1] font-bold text-[26rpx] text-green-accent">再来一单</text>
        </view>
      </view>

      <!-- 门店信息卡片：取订单上的门店快照（AD-9），不读当前门店 -->
      <view class="flex flex-col gap-[8rpx] rounded-card bg-surface-card p-[28rpx] shadow-card">
        <view class="mb-[4rpx] flex items-center justify-between">
          <text class="font-bold text-[26rpx] text-ink">{{ order.store_name }}</text>
          <text
            class="rounded-full bg-surface-ceramic px-[16rpx] py-[4rpx] font-bold text-[20rpx] text-green-accent"
          >
            {{ modeLabel }}
          </text>
        </view>
        <text class="text-[20rpx] text-ink-soft">{{ order.store_address }}</text>
        <text class="text-[20rpx] text-ink-soft">联系电话：{{ order.store_phone }}</text>
      </view>

      <!-- 商品明细卡片：与确认订单页结构相近，后续两页需要同时调整时可考虑抽成共享组件（AD-5） -->
      <view class="flex flex-col gap-[20rpx] rounded-card bg-surface-card p-[28rpx] shadow-card">
        <text class="border-b border-border-hairline pb-[12rpx] font-bold text-[24rpx] text-ink">
          商品明细
        </text>

        <view class="flex flex-col gap-[20rpx]">
          <view
            v-for="item in order.items"
            :key="item.product_id + item.spec_summary"
            class="flex items-start justify-between gap-[20rpx]"
          >
            <view class="flex min-w-0 flex-1 flex-col gap-[4rpx]">
              <text class="font-semibold text-[24rpx] text-ink">{{ item.product_name }}</text>
              <text class="leading-[1.3] text-[20rpx] text-ink-soft">{{ item.spec_summary }}</text>
            </view>
            <view class="flex shrink-0 flex-col items-end gap-[2rpx]">
              <view class="flex items-baseline">
                <text class="font-bold text-[18rpx] text-ink">¥</text>
                <text class="font-bold text-[24rpx] text-ink">{{
                  item.unit_price * item.quantity
                }}</text>
              </view>
              <text class="text-[18rpx] text-ink-soft">x{{ item.quantity }}</text>
            </view>
          </view>
        </view>

        <view
          v-if="order.packaging_fee > 0"
          class="flex items-baseline justify-between border-t border-dashed border-border-hairline pt-[12rpx] text-[22rpx] text-ink-rewards"
        >
          <text>外带包装费</text>
          <view class="flex items-baseline">
            <text class="font-bold text-[18rpx]">¥</text>
            <text class="font-bold text-[22rpx]">{{ order.packaging_fee }}</text>
          </view>
        </view>

        <view class="flex items-baseline justify-end gap-[8rpx] pt-[12rpx]">
          <text class="font-semibold text-[22rpx] text-ink">合计，实付</text>
          <view class="flex items-baseline">
            <text class="font-bold text-[20rpx] text-green">¥</text>
            <text class="font-bold text-[30rpx] text-green">{{ order.total_amount }}</text>
          </view>
        </view>
      </view>

      <!-- 订单信息卡片 -->
      <view class="flex flex-col gap-[20rpx] rounded-card bg-surface-card p-[28rpx] shadow-card">
        <view
          class="flex items-center justify-between border-b border-border-hairline pb-[20rpx] text-[22rpx]"
        >
          <text class="font-semibold text-ink">订单编号</text>
          <text class="text-ink-soft">{{ order.order_number }}</text>
        </view>
        <view
          class="flex items-center justify-between border-b border-border-hairline pb-[20rpx] text-[22rpx]"
        >
          <text class="font-semibold text-ink">下单时间</text>
          <text class="text-ink-soft">{{ order.created_at }}</text>
        </view>
        <view
          class="flex items-center justify-between border-b border-border-hairline pb-[20rpx] text-[22rpx]"
        >
          <text class="font-semibold text-ink">支付方式</text>
          <view class="flex items-center gap-[8rpx]">
            <t-icon name="logo-wechatpay" size="28rpx" color="#09bb07" />
            <text class="font-semibold text-[#09bb07]">微信支付</text>
          </view>
        </view>
        <view class="flex items-center justify-between text-[22rpx]">
          <text class="font-semibold text-ink">备注偏好</text>
          <text class="text-ink-soft">{{ order.notes }}</text>
        </view>
      </view>
    </view>

    <!-- 订单不存在 / 加载失败：页面内失败态（文案 + 重试），不展示任何缓存数据 -->
    <view v-else-if="error" class="h-screen">
      <load-failure :message="error" :loading="loading" @retry="retryOrderDetail" />
    </view>

    <!-- 首读加载中且尚未出结果：内容为空（遮罩延迟出现前保持页面底色） -->
    <view v-else class="min-h-screen" />

    <!-- 首读遮罩：读取期间覆盖整页（延迟约 250ms 防闪烁），完成 / 失败即撤 -->
    <t-overlay :visible="overlayVisible">
      <view class="detail-loading flex h-full items-center justify-center">
        <t-loading theme="spinner" text="加载中..." />
      </view>
    </t-overlay>
  </view>
</template>

<style scoped>
/* 详情首读遮罩：文案与指示器白色（深色遮罩上可读；变量继承进 t-loading） */
.detail-loading {
  --td-loading-color: #ffffff;
  --td-loading-text-color: #ffffff;
}
</style>
