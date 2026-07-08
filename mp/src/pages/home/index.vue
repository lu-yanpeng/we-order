<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

// 顶栏 Tab ↔ swiper 双向同步
const activeTab = ref('menu')
const swiperIndex = ref(0)

const onTabChange = (e: { value: string | number }) => {
  activeTab.value = String(e.value)
  swiperIndex.value = e.value === 'menu' ? 0 : 1
}

const onSwiperChange = (e: { detail: { current: number } }) => {
  activeTab.value = e.detail.current === 0 ? 'menu' : 'orders'
}

interface Product {
  name: string
  price: number
}

interface Category {
  id: string
  name: string
  products: Product[]
}

// Phase 1 Mock 数据
const categories: Category[] = [
  {
    id: 'section-coffee',
    name: '今日咖啡',
    products: [
      { name: '美式咖啡', price: 28 },
      { name: '拿铁', price: 32 },
      { name: '卡布奇诺', price: 32 },
      { name: '摩卡', price: 35 },
      { name: '焦糖玛奇朵', price: 35 },
      { name: '浓缩咖啡', price: 22 },
      { name: '馥芮白', price: 33 },
      { name: '冷萃冰咖啡', price: 36 },
    ],
  },
  {
    id: 'section-tea',
    name: '茶饮',
    products: [
      { name: '抹茶拿铁', price: 32 },
      { name: '红茶拿铁', price: 30 },
      { name: '冰摇柠檬茶', price: 28 },
      { name: '冰摇红梅黑加仑', price: 30 },
      { name: '芒果西番莲果茶', price: 29 },
      { name: '蜜桃乌龙茶', price: 28 },
      { name: '热巧克力', price: 30 },
      { name: '经典巧克力', price: 32 },
    ],
  },
  {
    id: 'section-frappuccino',
    name: '星冰乐',
    products: [
      { name: '抹茶星冰乐', price: 36 },
      { name: '摩卡星冰乐', price: 36 },
      { name: '焦糖星冰乐', price: 36 },
      { name: '香草星冰乐', price: 34 },
      { name: '芒果西番莲星冰乐', price: 36 },
      { name: '草莓星冰乐', price: 36 },
      { name: '浓缩星冰乐', price: 38 },
    ],
  },
  {
    id: 'section-bakery',
    name: '烘焙',
    products: [
      { name: '经典可颂', price: 18 },
      { name: '巧克力麦芬', price: 22 },
      { name: '蓝莓麦芬', price: 22 },
      { name: '法式焦糖酥', price: 20 },
      { name: '提子干司康', price: 16 },
      { name: '芝士蛋糕', price: 28 },
      { name: '纽约芝士蛋糕', price: 30 },
      { name: '抹茶蛋糕', price: 28 },
      { name: '瑞士卷', price: 22 },
    ],
  },
  {
    id: 'section-dessert',
    name: '甜品',
    products: [
      { name: '提拉米苏', price: 32 },
      { name: '巧克力熔岩蛋糕', price: 35 },
    ],
  },
]

// 分类侧边栏 ↔ 商品列表联动
const activeCategory = ref('section-coffee')
const scrollIntoViewId = ref('')
const sectionPositions = ref<{ id: string; top: number }[]>([])
const isProgrammaticScroll = ref(false)

// 点击侧边栏：scroll-into-view 先清空再赋值，触发小程序滚动
const handleSidebarClick = (categoryId: string) => {
  activeCategory.value = categoryId
  isProgrammaticScroll.value = true
  scrollIntoViewId.value = ''
  nextTick(() => {
    scrollIntoViewId.value = categoryId
    setTimeout(() => {
      isProgrammaticScroll.value = false
    }, 400)
  })
}

// 滚动商品列表：对比预计算的各分类 top 位置，更新侧边栏高亮
const handleContentScroll = (e: { detail: { scrollTop: number } }) => {
  if (isProgrammaticScroll.value) return

  const { scrollTop } = e.detail
  const positions = sectionPositions.value
  if (positions.length === 0) return

  for (let i = positions.length - 1; i >= 0; i--) {
    if (scrollTop >= positions[i].top) {
      if (activeCategory.value !== positions[i].id) {
        activeCategory.value = positions[i].id
      }
      return
    }
  }
}

// 预计算各分类区块在 scroll-view 内的 top 位置，用于滚动联动
const computeSectionPositions = () => {
  const query = uni.createSelectorQuery()
  query.select('.content-area').boundingClientRect()
  categories.forEach((cat) => {
    query.select(`#${cat.id}`).boundingClientRect()
  })
  query.exec((res: UniApp.NodeInfo[]) => {
    const scrollViewRect = res[0]
    if (!scrollViewRect) return

    const offset = scrollViewRect.top || 0
    sectionPositions.value = categories.map((cat, i) => ({
      id: cat.id,
      top: (res[i + 1]?.top || 0) - offset,
    }))
  })
}

onMounted(() => {
  // 延迟预计算分类位置，确保 DOM 布局完成
  setTimeout(() => {
    computeSectionPositions()
  }, 400)
  // TDesign tabs 受控模式下首屏不渲染激活态指示器的 workaround
  setTimeout(() => {
    const current = activeTab.value
    activeTab.value = ''
    nextTick(() => {
      activeTab.value = current
    })
  }, 100)
})
</script>

<template>
  <view class="flex h-screen flex-col bg-sb-warm">
    <!-- 顶栏：TDesign tabs，custom-style 对齐侧边栏文字并调整间距 -->
    <t-tabs
      :value="activeTab"
      :space-evenly="false"
      :show-bottom-line="true"
      :split="false"
      theme="line"
      custom-style="--td-spacer-2: 27rpx; padding-left: 20rpx"
      @change="onTabChange"
    >
      <t-tab-panel label="点餐" value="menu" />
      <t-tab-panel label="订单" value="orders" />
    </t-tabs>

    <!-- swiper 支持左右滑切换 tab -->
    <swiper class="flex-1" :current="swiperIndex" :duration="250" @change="onSwiperChange">
      <swiper-item>
        <view class="flex h-full overflow-hidden">
          <!-- 左侧分类导航：w-1/5 按比例分配宽度，适配不同设备 -->
          <view class="sidebar w-1/5 shrink-0 flex-col bg-[#f7f8fa]">
            <scroll-view class="flex-1" scroll-y :enhanced="true" :show-scrollbar="false">
              <view
                v-for="cat in categories"
                :key="cat.id"
                class="sidebar-item"
                :class="{ 'sidebar-item--active': activeCategory === cat.id }"
                @click="handleSidebarClick(cat.id)"
              >
                {{ cat.name }}
              </view>
              <view class="flex-1 bg-[#f7f8fa]" />
            </scroll-view>
          </view>

          <!-- 右侧商品列表：scroll-into-view 联动侧边栏，@scroll 反向联动 -->
          <scroll-view
            class="content-area"
            scroll-y
            :enhanced="true"
            :show-scrollbar="false"
            :scroll-into-view="scrollIntoViewId"
            :scroll-with-animation="true"
            @scroll="handleContentScroll"
          >
            <view v-for="cat in categories" :key="cat.id" :id="cat.id" class="category-section">
              <!-- 分类标题：sticky 吸顶 + 毛玻璃效果 -->
              <view class="category-title">
                {{ cat.name }}
              </view>
              <view v-for="product in cat.products" :key="product.name" class="product-item">
                <text class="text-sm font-semibold text-sb-text">{{ product.name }}</text>
              </view>
            </view>
            <view class="list-footer">
              <text class="list-footer-text">--- 到底了 ---</text>
            </view>
          </scroll-view>
        </view>
      </swiper-item>
      <swiper-item>
        <view class="flex h-full items-center justify-center">
          <text class="text-base text-sb-text-soft">订单 - 待开发</text>
        </view>
      </swiper-item>
    </swiper>
  </view>
</template>

<style scoped>
.sidebar-item {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 36rpx 16rpx;
  font-size: 24rpx;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.58);
  word-break: break-all;
  transition: all 150ms ease;
}

.sidebar-item--active {
  background-color: #ffffff;
  color: #006241;
  font-weight: 700;
}

.category-title {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 24rpx 32rpx 16rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.58);
  letter-spacing: 0.05em;
  background-color: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12rpx);
  -webkit-backdrop-filter: blur(12rpx);
}

.product-item {
  padding: 28rpx 32rpx;
  border-bottom: 2rpx solid #e7e7e7;
}

.list-footer {
  display: flex;
  justify-content: center;
  padding: 48rpx 0 96rpx;
}

.list-footer-text {
  font-size: 22rpx;
  color: rgba(0, 0, 0, 0.2);
}
</style>
