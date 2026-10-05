<script setup lang="ts">
/**
 * 订单卡片（FR-11 / FR-12；Story 4.7 图片化重排）
 *
 * 纯展示组件：按订单状态渲染状态标签、商品图片行与底部操作按钮，
 * 操作只向外 emit，不涉及数据读写（AD-2：组件不依赖 composable / store）。
 *
 * 卡片只保留：订单编号、状态、商品图片行、下单时间、金额、状态操作按钮（spine 形态表 / Story 4.7）；
 * 商品名、规格摘要、备注、就餐方式与取杯号不再在卡片展示（详情页保留全部快照信息）。
 * 图片行只占一行：每个明细行一张方图（不按数量展开）；放不下时前 k−1 格为商品图，
 * 第 k 格为渐变遮罩格（可垫下一张商品图）并显示 `+N`（布局算术见 `utils/order-gallery.ts`）。
 * 图片 URL 由调用方构造（`api/catalog.ts` 的 productImageUrl；空串或加载失败以色块占位）。
 *
 * 制作中且已催过单时按钮显示「已催单」（弱化样式；再点只提示不发请求，由调用方承接——Story 4.4）；
 * 确认取餐在飞时按钮 loading + 禁用（Story 4.5）。
 */
import { computed, ref } from 'vue'
import type { OrderListItem, OrderStatus } from '@/types/api-contracts'
import { gallerySlots } from '@/utils/order-gallery'

/** 图片行容量：一行放得下的格子数。格子 144rpx + 间距 12rpx × 4 格 = 612rpx ≤ 内容区 622rpx；
 *  具体观感以模拟器实测为准，皮肤级调整记入 Story 4.7 验收记录。 */
const GALLERY_CAPACITY = 4

const props = withDefaults(
  defineProps<{
    order: OrderListItem
    /** 商品图片行 URL（与 order.item_images 一一对应；由调用方经 api/ 出口构造，空串 = 缺图占位） */
    imageUrls?: string[]
    /** 已成功催过单（运行期标记，列表与详情共享；Story 4.4） */
    urged?: boolean
    /** 确认取餐在飞（按钮 loading + 禁用防重复；Story 4.5） */
    confirming?: boolean
  }>(),
  { imageUrls: () => [] },
)

const emit = defineEmits<{
  click: []
  urge: []
  'confirm-pickup': []
  reorder: []
}>()

/**
 * 注意：小程序编译链不会把解构后的 props 变成响应式——脚本侧的 computed / 函数
 * 必须经 `props.xxx` 读取，否则会停留在挂载时快照（2026-10-02 评审修复）。
 */

/** 状态文案与状态色（FR-11：制作中-蓝 / 待取餐-金 / 已完成-绿） */
const STATUS_META: Record<OrderStatus, { label: string; textClass: string }> = {
  cooking: { label: '制作中', textClass: 'text-[#3b82f6]' },
  pickup: { label: '待取餐', textClass: 'text-gold' },
  completed: { label: '已完成', textClass: 'text-green-accent' },
}

/** 底部操作按钮（原型 .btn-reorder 三态变体） */
const ACTION_META: Record<OrderStatus, { label: string; class: string }> = {
  cooking: { label: '催单', class: 'border-ink-soft text-ink-soft' },
  pickup: { label: '确认取餐', class: 'border-gold text-gold' },
  completed: { label: '再来一单', class: 'border-green-accent text-green-accent' },
}

const statusMeta = computed(() => STATUS_META[props.order.status])
/** 按钮元数据：制作中且已催过 → 「已催单」（弱化样式；点击由页面转给 use-urge 的重复提示） */
const actionMeta = computed(() => {
  if (props.order.status === 'cooking' && props.urged) {
    return { label: '已催单', class: 'border-border-hairline text-ink-soft opacity-60' }
  }
  return ACTION_META[props.order.status]
})

/** 确认取餐在飞且按钮仍处「待取餐」：按钮呈现 loading 并禁用（防重复） */
const confirmBusy = computed(() => props.confirming === true && props.order.status === 'pickup')

/** 图片行布局：可见格数与溢出数（容量内不出现溢出格） */
const gallery = computed(() => gallerySlots(props.imageUrls.length, GALLERY_CAPACITY))
/** 直接展示的图片（溢出格的底图单独取第 k 张） */
const visibleImages = computed(() => props.imageUrls.slice(0, gallery.value.visibleCount))
/** 溢出格的底图（「可垫下一张商品图」；无图或空串时以纯色块呈现） */
const overflowImage = computed(() =>
  gallery.value.overflowCount === null ? '' : (props.imageUrls[gallery.value.visibleCount] ?? ''),
)

/** 逐格记录加载失败的图片：回退色块占位、不阻塞列表渲染（AD-17） */
const failedIndexes = ref<Record<number, boolean>>({})
const overflowFailed = ref(false)

const markImageFailed = (index: number) => {
  failedIndexes.value[index] = true
}
const isImageFailed = (index: number) => failedIndexes.value[index] === true

/** 底部按钮按状态派发对应操作（确认取餐在飞期间忽略点击，防重复提交） */
const handleAction = () => {
  if (confirmBusy.value) return
  if (props.order.status === 'cooking') emit('urge')
  else if (props.order.status === 'pickup') emit('confirm-pickup')
  else emit('reorder')
}
</script>

<template>
  <view
    class="mb-[24rpx] flex flex-col gap-[24rpx] rounded-[24rpx] bg-surface-card p-[32rpx] shadow-card"
    @click="emit('click')"
  >
    <!-- 卡头：订单编号 + 状态 -->
    <view class="flex items-center justify-between pb-[4rpx]">
      <text class="text-[24rpx] text-ink-soft">订单编号: {{ order.order_number }}</text>
      <text class="font-bold text-[24rpx]" :class="statusMeta.textClass">
        {{ statusMeta.label }}
      </text>
    </view>

    <!-- 卡身：商品图片行（只占一行；每个明细行一张方图，不按数量展开） -->
    <view
      v-if="imageUrls.length > 0"
      class="flex items-center justify-between gap-[12rpx] border-t border-border-hairline pt-[24rpx]"
    >
      <view
        v-for="(url, index) in visibleImages"
        :key="index"
        class="h-[144rpx] w-[144rpx] shrink-0 overflow-hidden rounded-[16rpx] bg-surface-ceramic"
      >
        <image
          v-if="url && !isImageFailed(index)"
          class="h-full w-full"
          :src="url"
          mode="aspectFill"
          lazy-load
          @error="markImageFailed(index)"
        />
      </view>

      <!-- 溢出格：垫下一张商品图 + 渐变遮罩 + `+N`（N = 未展示的明细行数） -->
      <view
        v-if="gallery.overflowCount !== null"
        class="relative h-[144rpx] w-[144rpx] shrink-0 overflow-hidden rounded-[16rpx] bg-surface-ceramic"
      >
        <image
          v-if="overflowImage && !overflowFailed"
          class="h-full w-full"
          :src="overflowImage"
          mode="aspectFill"
          lazy-load
          @error="overflowFailed = true"
        />
        <view class="gallery-overflow-mask absolute inset-0 flex items-center justify-center">
          <text class="font-bold text-[28rpx] text-white">+{{ gallery.overflowCount }}</text>
        </view>
      </view>
    </view>

    <!-- 卡底信息：下单时间 + 金额 -->
    <view
      class="flex items-baseline justify-between border-t border-dashed border-border-hairline pt-[20rpx]"
    >
      <text class="text-[22rpx] text-ink-soft">{{ order.created_at }}</text>
      <view class="flex items-baseline">
        <text class="font-bold text-[22rpx] text-ink">¥</text>
        <text class="font-bold text-[32rpx] text-ink">{{ order.total_amount }}</text>
      </view>
    </view>

    <!-- 卡尾：状态操作（确认取餐在飞：loading + 禁用，Story 4.5） -->
    <view class="flex justify-end">
      <view
        class="flex h-[52rpx] items-center justify-center gap-[8rpx] rounded-full border px-[32rpx] text-[24rpx]"
        :class="[actionMeta.class, confirmBusy ? 'pointer-events-none opacity-60' : '']"
        @click.stop="handleAction"
      >
        <t-loading v-if="confirmBusy" theme="spinner" size="28rpx" inherit-color />
        <text class="leading-[1] font-semibold">{{ actionMeta.label }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 溢出格遮罩：自上而下的渐变（深色底部保证 +N 可读） */
.gallery-overflow-mask {
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.6) 100%);
}
</style>
