<script setup lang="ts">
/**
 * 确认订单页
 *
 * 数据来自购物车 cart store（跨页面共享状态，FR-9/AD-6），
 * 业务逻辑封装在 useOrderConfirm composable（AD-3）。
 * 备注为纯 UI 输入状态，保留在页面内。
 * 「立即支付」（FR-10）暂未实现。
 *
 * loading 由 useCheckoutBar.goToCheckout 显示，页面首屏渲染完成后在此取消。
 */
import { ref } from 'vue'
import { onReady } from '@dcloudio/uni-app'
import BottomBar from '@/components/bottom-bar/index.vue'
import { useOrderConfirm } from '@/composables/use-order-confirm'

defineOptions({
  options: {
    styleIsolation: 'shared',
  },
})

const {
  items,
  diningMode,
  totalCount: totalQty,
  packagingFee,
  payAmount,
  etaText,
  selectDiningMode,
} = useOrderConfirm()

const notes = ref('')

onReady(() => {
  uni.hideLoading()
})
</script>

<template>
  <view class="flex h-screen flex-col bg-surface-page">
    <scroll-view
      class="scrollbar-hide min-h-0 flex-1"
      scroll-y
      :enhanced="true"
      :show-scrollbar="false"
    >
      <view class="flex flex-col gap-[24rpx] px-[28rpx] py-[28rpx]">
        <!-- 堂食/外带选择卡片 -->
        <view class="flex flex-col gap-[24rpx] rounded-card bg-surface-card p-[28rpx] shadow-card">
          <view class="flex rounded-button bg-surface-ceramic">
            <view
              class="flex flex-1 items-center justify-center gap-[8rpx] rounded-full py-[18rpx] font-semibold text-[24rpx]"
              :class="diningMode === 'dinein' ? 'bg-green-accent text-white' : 'text-ink-soft'"
              @click="selectDiningMode('dinein')"
            >
              <t-icon name="shop" size="28rpx" />
              <text>店内堂食</text>
            </view>
            <view
              class="flex flex-1 items-center justify-center gap-[8rpx] rounded-full py-[18rpx] font-semibold text-[24rpx]"
              :class="diningMode === 'takeout' ? 'bg-green-accent text-white' : 'text-ink-soft'"
              @click="selectDiningMode('takeout')"
            >
              <t-icon name="undertake-delivery" size="28rpx" />
              <text>打包外带</text>
            </view>
          </view>

          <view class="flex flex-col gap-[6rpx]">
            <text class="font-bold text-[26rpx] text-ink">星巴克 啡快自提店</text>
            <text class="text-[20rpx] text-ink-soft">北京市朝阳区创意产业园 A 座 1 层</text>
            <text class="mt-[4rpx] font-semibold text-[22rpx] text-gold">{{ etaText }}</text>
          </view>
        </view>

        <!-- 商品明细卡片 -->
        <view class="flex flex-col gap-[20rpx] rounded-card bg-surface-card p-[28rpx] shadow-card">
          <text class="border-b border-border-hairline pb-[12rpx] font-bold text-[24rpx] text-ink">
            商品明细
          </text>

          <view class="flex flex-col gap-[20rpx]">
            <view
              v-for="item in items"
              :key="item.productId + item.specSummary"
              class="flex items-start justify-between gap-[20rpx]"
            >
              <view class="flex min-w-0 flex-1 flex-col gap-[4rpx]">
                <text class="font-semibold text-[24rpx] text-ink">{{ item.productName }}</text>
                <text class="leading-[1.3] text-[20rpx] text-ink-soft">{{ item.specSummary }}</text>
              </view>
              <view class="flex shrink-0 flex-col items-end gap-[2rpx]">
                <view class="flex items-baseline">
                  <text class="font-bold text-[18rpx] text-ink">¥</text>
                  <text class="font-bold text-[24rpx] text-ink">{{
                    item.unitPrice * item.quantity
                  }}</text>
                </view>
                <text class="text-[18rpx] text-ink-soft">x{{ item.quantity }}</text>
              </view>
            </view>
          </view>

          <view
            v-if="packagingFee > 0"
            class="flex items-baseline justify-between border-t border-dashed border-border-hairline pt-[12rpx] text-[22rpx] text-ink-rewards"
          >
            <text>外带包装费</text>
            <view class="flex items-baseline">
              <text class="font-bold text-[18rpx]">¥</text>
              <text class="font-bold text-[22rpx]">{{ packagingFee }}</text>
            </view>
          </view>

          <view class="flex items-baseline justify-end gap-[8rpx] pt-[12rpx]">
            <text class="font-semibold text-[22rpx] text-ink">共 {{ totalQty }} 件商品，实付</text>
            <view class="flex items-baseline">
              <text class="font-bold text-[20rpx] text-green">¥</text>
              <text class="font-bold text-[30rpx] text-green">{{ payAmount }}</text>
            </view>
          </view>
        </view>

        <!-- 备注和支付方式卡片 -->
        <view class="flex flex-col gap-[20rpx] rounded-card bg-surface-card p-[28rpx] shadow-card">
          <view
            class="flex items-center justify-between border-b border-border-hairline pb-[20rpx]"
          >
            <text class="font-semibold text-[22rpx] text-ink">支付方式</text>
            <view class="flex items-center gap-[8rpx]">
              <t-icon name="logo-wechatpay" size="28rpx" color="#09bb07" />
              <text class="font-semibold text-[#09bb07] text-[22rpx]">微信支付</text>
            </view>
          </view>

          <view class="flex flex-col gap-[12rpx]">
            <text class="font-semibold text-[22rpx] text-ink">备注偏好</text>
            <t-textarea
              v-model="notes"
              :autosize="true"
              :maxlength="30"
              placeholder="输入备注"
              placeholder-class="notes-placeholder"
              t-class-textarea="notes-input"
              custom-style="padding: 16rpx 24rpx; background-color: #f9f9f9; border-radius: 12rpx;"
            />
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 底部支付栏 -->
    <bottom-bar>
      <template #left>
        <view class="flex items-baseline">
          <text class="font-medium text-[22rpx] text-ink-soft">应付金额：</text>
          <text class="ml-[4rpx] font-bold text-[22rpx] text-green">¥</text>
          <text class="font-bold text-[36rpx] text-green">{{ payAmount }}</text>
        </view>
      </template>
      <template #right>
        <view
          class="flex h-[76rpx] items-center justify-center rounded-button bg-green-accent px-[48rpx]"
        >
          <text class="font-bold text-[26rpx] text-white">立即支付</text>
        </view>
      </template>
    </bottom-bar>
  </view>
</template>

<style>
/*
 * 占位符与输入文字统一 24rpx。
 * 占位符经 placeholder-class 直接作用，输入框经 t-class-textarea 注入；
 * t-textarea 内部 .t-textarea__wrapper-inner 自带 font 简写（32rpx/48rpx）且带
 * data-v scoped 特异性更高，需 !important 才能覆盖（shared 模式下官方推荐做法）。
 */
.notes-placeholder,
.notes-input {
  font-size: 24rpx !important;
  line-height: 34rpx !important;
}
</style>
