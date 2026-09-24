<script setup lang="ts">
/**
 * 身份链路验证页（Story 2.4 / 2.5 / 2.6 的临时入口，Phase 2 结束后整个目录删除）
 *
 * 页面只做编排与展示：调用与状态在 useAuthCheck，登录链路与会话在 api/auth。
 * 本页是 Phase 2 的客户端验证入口，全部验证都在这里完成。
 */
import { useAuthCheck } from './composables/use-auth-check'

const {
  verifying,
  verifyingConcurrent,
  replaying,
  results,
  verify,
  verifyConcurrent,
  selfCheck,
  replayUsedCode,
} = useAuthCheck()
</script>

<template>
  <view class="flex h-screen flex-col gap-[24rpx] p-[32rpx]">
    <view class="flex flex-col gap-[8rpx]">
      <text class="font-semibold text-[32rpx] text-ink">身份链路验证（临时页面）</text>
      <text class="text-[22rpx] text-ink-soft">
        验证静默登录、会话恢复、透明续期、单飞、回退重登、失败文案与凭证失效重放；步骤见
        mp/src/api/auth/README.md。
      </text>
    </view>

    <view class="flex flex-col gap-[16rpx]">
      <t-button theme="primary" block :loading="verifying" @click="verify"> 验证身份链路 </t-button>
      <t-button block :loading="verifyingConcurrent" @click="verifyConcurrent">
        并发验证 ×3
      </t-button>
      <t-button block @click="selfCheck"> 三类失败文案自检 </t-button>
      <t-button block :loading="replaying" @click="replayUsedCode">
        凭证失效重放（验证用）
      </t-button>
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
  </view>
</template>
