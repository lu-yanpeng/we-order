<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import type { Product } from '@/types/product'
import ProductCard from './components/product-card/index.vue'

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

interface Category {
  id: string
  name: string
  products: Product[]
}

const categories: Category[] = [
  {
    id: 'section-coffee',
    name: '推荐今日咖啡',
    products: [
      {
        id: 'prod-001',
        name: '美式咖啡',
        desc: '经典美式，精选阿拉比卡豆',
        price: 28,
        tags: ['新品'],
        sales: 128,
      },
      {
        id: 'prod-002',
        name: '拿铁',
        desc: '浓缩咖啡与丝滑牛奶的完美融合',
        price: 32,
        tags: [],
        sales: 256,
      },
      {
        id: 'prod-003',
        name: '卡布奇诺',
        desc: '意式经典，浓缩咖啡与蒸汽牛奶的完美配比，奶泡绵密丰厚',
        price: 32,
        tags: [],
        sales: 189,
      },
      {
        id: 'prod-004',
        name: '摩卡',
        desc: '巧克力与咖啡的双重享受',
        price: 35,
        tags: ['热门'],
        sales: 312,
      },
      {
        id: 'prod-005',
        name: '焦糖玛奇朵',
        desc: '香甜焦糖酱淋在醇厚浓缩咖啡与丝滑蒸奶之上，层次丰富',
        price: 35,
        tags: ['热门'],
        sales: 278,
      },
      {
        id: 'prod-006',
        name: '浓缩咖啡',
        desc: '浓郁纯粹的咖啡本味',
        price: 22,
        tags: [],
        sales: 95,
      },
      {
        id: 'prod-007',
        name: '馥芮白',
        desc: '精萃浓缩咖啡融合丝滑奶泡',
        price: 33,
        tags: [],
        sales: 167,
      },
      {
        id: 'prod-008',
        name: '冷萃冰咖啡',
        desc: '低温冷水长时间慢萃，减少酸涩感，口感格外顺滑并带有自然回甘',
        price: 36,
        tags: ['新品', '热门'],
        sales: 203,
      },
    ],
  },
  {
    id: 'section-tea',
    name: '茶饮',
    products: [
      {
        id: 'prod-101',
        name: '抹茶拿铁',
        desc: '日式抹茶与鲜奶的清新搭配',
        price: 32,
        tags: [],
        sales: 143,
      },
      {
        id: 'prod-102',
        name: '红茶拿铁',
        desc: '经典红茶融入丝滑热牛奶',
        price: 30,
        tags: [],
        sales: 118,
      },
      {
        id: 'prod-103',
        name: '冰摇柠檬茶',
        desc: '鲜榨柠檬汁搭配清爽红茶底，手工摇制，酸甜冰爽夏日首选',
        price: 28,
        tags: ['热门'],
        sales: 356,
      },
      {
        id: 'prod-104',
        name: '冰摇红梅黑加仑',
        desc: '酸甜莓果风味清爽解暑',
        price: 30,
        tags: [],
        sales: 234,
      },
      {
        id: 'prod-105',
        name: '芒果西番莲果茶',
        desc: '热带水果与茶的清新碰撞',
        price: 29,
        tags: ['新品'],
        sales: 89,
      },
      {
        id: 'prod-106',
        name: '蜜桃乌龙茶',
        desc: '蜜桃清甜搭配乌龙茶香',
        price: 28,
        tags: [],
        sales: 156,
      },
      {
        id: 'prod-107',
        name: '热巧克力',
        desc: '香浓可可，温暖治愈',
        price: 30,
        tags: [],
        sales: 198,
      },
      {
        id: 'prod-108',
        name: '经典巧克力',
        desc: '比利时黑巧融入蒸汽牛奶',
        price: 32,
        tags: [],
        sales: 145,
      },
    ],
  },
  {
    id: 'section-frappuccino',
    name: '星冰乐',
    products: [
      {
        id: 'prod-201',
        name: '抹茶星冰乐',
        desc: '日式抹茶与奶霜的冰爽融合',
        price: 36,
        tags: ['热门'],
        sales: 423,
      },
      {
        id: 'prod-202',
        name: '摩卡星冰乐',
        desc: '巧克力咖啡冰沙配奶油顶',
        price: 36,
        tags: [],
        sales: 387,
      },
      {
        id: 'prod-203',
        name: '焦糖星冰乐',
        desc: '焦糖酱与奶霜的甜蜜组合',
        price: 36,
        tags: [],
        sales: 345,
      },
      {
        id: 'prod-204',
        name: '香草星冰乐',
        desc: '经典香草风味融合奶香冰沙，顶部覆盖轻盈奶油，口感绵密甜蜜',
        price: 34,
        tags: [],
        sales: 298,
      },
      {
        id: 'prod-205',
        name: '芒果西番莲星冰乐',
        desc: '热带水果冰沙清爽宜人',
        price: 36,
        tags: [],
        sales: 267,
      },
      {
        id: 'prod-206',
        name: '草莓星冰乐',
        desc: '酸甜草莓与奶霜的少女心',
        price: 36,
        tags: ['新品'],
        sales: 156,
      },
      {
        id: 'prod-207',
        name: '浓缩星冰乐',
        desc: '浓郁咖啡冰沙，提神醒脑',
        price: 38,
        tags: [],
        sales: 234,
      },
    ],
  },
  {
    id: 'section-bakery',
    name: '烘焙',
    products: [
      {
        id: 'prod-301',
        name: '经典可颂',
        desc: '法式黄油可颂，外酥内软',
        price: 18,
        tags: [],
        sales: 178,
      },
      {
        id: 'prod-302',
        name: '巧克力麦芬',
        desc: '浓郁巧克力麦芬蛋糕',
        price: 22,
        tags: [],
        sales: 234,
      },
      {
        id: 'prod-303',
        name: '蓝莓麦芬',
        desc: '满满的蓝莓果粒烘焙',
        price: 22,
        tags: ['热门'],
        sales: 312,
      },
      {
        id: 'prod-304',
        name: '法式焦糖酥',
        desc: '酥脆千层包裹焦糖内馅',
        price: 20,
        tags: ['新品'],
        sales: 67,
      },
      {
        id: 'prod-305',
        name: '提子干司康',
        desc: '英式经典，提子干点缀',
        price: 16,
        tags: [],
        sales: 145,
      },
      {
        id: 'prod-306',
        name: '芝士蛋糕',
        desc: '纽约风格浓郁芝士蛋糕，口感绵密醇厚，每一口都是经典享受',
        price: 28,
        tags: ['热门'],
        sales: 289,
      },
      {
        id: 'prod-307',
        name: '纽约芝士蛋糕',
        desc: '经典纽约芝士蛋糕绵密醇香',
        price: 30,
        tags: [],
        sales: 234,
      },
      {
        id: 'prod-308',
        name: '抹茶蛋糕',
        desc: '日式抹茶风味蛋糕',
        price: 28,
        tags: [],
        sales: 167,
      },
      {
        id: 'prod-309',
        name: '瑞士卷',
        desc: '松软蛋糕卷配鲜奶油',
        price: 22,
        tags: [],
        sales: 198,
      },
    ],
  },
  {
    id: 'section-dessert',
    name: '甜品',
    products: [
      {
        id: 'prod-401',
        name: '提拉米苏',
        desc: '意式经典，马斯卡彭与咖啡的邂逅',
        price: 32,
        tags: [],
        sales: 256,
      },
      {
        id: 'prod-402',
        name: '巧克力熔岩蛋糕',
        desc: '切开即享温热巧克力流心，外层松软蛋糕与浓郁内馅完美搭配',
        price: 35,
        tags: ['热门'],
        sales: 178,
      },
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

// 加购按钮占位，后续对接购物车
const handleAddToCart = (product: Product) => {
  // TODO: Phase 4 - 对接购物车
  console.log('add-to-cart', product.name)
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
                <text class="sidebar-item-text">{{ cat.name }}</text>
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
              <!-- 分类标题：sticky 吸顶 + 毛玻璃效果，全宽，文字对齐商品图片 -->
              <view class="category-title">
                {{ cat.name }}
              </view>
              <view class="pl-4 pr-5">
                <view v-for="product in cat.products" :key="product.id">
                  <ProductCard :product="product" @add-to-cart="handleAddToCart" />
                </view>
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
  height: 96rpx;
  padding: 0 16rpx;
  font-size: 24rpx;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.58);
  transition: all 150ms ease;
}

.sidebar-item-text {
  max-width: 96rpx;
  word-break: break-all;
  line-height: 28rpx;
  text-align: center;
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
  padding: 24rpx 0 24rpx 32rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.58);
  letter-spacing: 0.05em;
  background-color: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12rpx);
  -webkit-backdrop-filter: blur(12rpx);
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
