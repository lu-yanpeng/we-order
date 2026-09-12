<script setup lang="ts">
/**
 * 通用底部栏容器 — 结算栏 / 规格加购栏 / 支付栏的共同骨架
 *
 * 高度统一由 --mp-frap-size token 控制（见 styles/main.css），
 * 底部安全区统一由 getSafeBottom 设置。
 * 定位方式（fixed / 页面流式贴底）由使用方决定，本组件不做定位。
 */
import { getSafeBottom } from '@/utils/platform'
import type { CSSProperties } from 'vue'

withDefaults(
  defineProps<{
    customClass?: string
    customStyle?: CSSProperties
  }>(),
  {
    customClass: '',
    customStyle: () => ({}),
  },
)

defineOptions({
  options: {
    // https://developers.weixin.qq.com/miniprogram/dev/framework/component-framework/virtual-host.html
    // 启用虚拟节点，渲染后将不会出现<bottom-bar>这样的根节点
    // 会直接用一个普通的view作为根节点，通过控制台选中这个组件可以看到具体情况
    // 如果用<bottom-bar>作为根节点，很多样式设置会失效，非常麻烦
    virtualHost: true,
  },
  // 自定义组件样式不需要设置externalClasses，用customClass代替
  // 也不需要styleIsolation，只需要调用方设置
})

const safeBottom = getSafeBottom()
</script>

<template>
  <view
    :class="[customClass, 'border-t border-border-hairline bg-surface-card']"
    :style="{ paddingBottom: safeBottom + 'px', ...customStyle }"
  >
    <view class="flex min-h-(--mp-frap-size) items-center justify-between px-[32rpx] pt-[16rpx]">
      <slot name="left" />
      <slot name="right" />
    </view>
  </view>
</template>
