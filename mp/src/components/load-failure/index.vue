<script setup lang="ts">
/**
 * 页面级加载失败态（P1 AD-5；主包首页与订单详情分包共用 → 根 components/，AD-9）
 *
 * 纯展示：文案由场景 Composable 经 `utils/error-copy.ts` 翻译后传入；
 * 重试形态 = 按钮 loading + 禁用（防重复提交），事件由页面转给加载方法。
 * 形态基准：spine「最小 UI 规范」——页面内失败态（文案 + 「重试」）。
 */
const { message = '', loading = false } = defineProps<{
  /** 失败文案（唯一来源 utils/error-copy.ts，由调用方翻译） */
  message?: string
  /** 重试进行中：按钮呈 loading 且不可点 */
  loading?: boolean
}>()

const emit = defineEmits<{
  retry: []
}>()

const handleRetry = () => {
  emit('retry')
}
</script>

<template>
  <view class="flex h-full flex-col items-center justify-center gap-[32rpx] px-[64rpx]">
    <text class="text-center leading-[38rpx] text-[26rpx] text-ink-soft">{{ message }}</text>
    <t-button theme="primary" :loading="loading" :disabled="loading" @click="handleRetry">
      重试
    </t-button>
  </view>
</template>
