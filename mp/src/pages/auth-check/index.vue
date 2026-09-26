<script setup lang="ts">
/**
 * 身份链路验证页（Phase 2 临时入口；Story 1.3 起验证 core/session）
 *
 * 页面只做编排与展示：调用与状态在 useAuthCheck，会话链路在 api/auth 门面与 core/session。
 * 本页是 Phase 3 会话模块的手动验证入口，随 Story 2.3 的存量清理删除。
 */
import { useAuthCheck } from './composables/use-auth-check'

const { warming, verifyingConcurrent, results, warmUp, verifyConcurrent, selfCheck } =
  useAuthCheck()

const goHome = () => {
  uni.redirectTo({
    url: '/pages/home/index',
  })
}
</script>

<template>
  <view class="flex h-screen flex-col gap-[24rpx] p-[32rpx]">
    <view class="flex flex-col gap-[8rpx]">
      <text class="font-semibold text-[32rpx] text-ink">身份链路验证（临时页面）</text>
      <text class="text-[22rpx] text-ink-soft">
        验证静默登录、会话恢复、透明续期、单飞、回退重登与失败文案；步骤见
        mp/src/core/session/README.md。
      </text>
    </view>

    <view class="flex flex-col gap-[16rpx]">
      <t-button theme="primary" block :loading="warming" @click="warmUp">
        会话预热 / 当前身份
      </t-button>
      <t-button block :loading="verifyingConcurrent" @click="verifyConcurrent">
        并发验证 ×3
      </t-button>
      <t-button block @click="selfCheck"> 失败文案自检 </t-button>
    </view>

    <scroll-view
      class="min-h-0 flex-1 rounded-[16rpx] bg-surface-card p-[24rpx]"
      scroll-y
      :enhanced="true"
      :show-scrollbar="false"
    >
      <view v-for="(item, index) in results" :key="index" class="mb-[16rpx]">
        <text
          class="leading-[36rpx] break-all text-[24rpx]"
          :class="item.ok ? 'text-green' : 'text-error'"
        >
          {{ item.detail }}
        </text>
      </view>
      <view v-if="results.length === 0">
        <text class="text-[24rpx] text-ink-soft">尚无结果</text>
      </view>
    </scroll-view>

    <view>
      <t-button @click="goHome">首页</t-button>
    </view>
  </view>
</template>
