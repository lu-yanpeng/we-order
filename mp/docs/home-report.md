# 首页开发报告

## 完成内容

### pages/home/index.vue
- **顶栏 Tabs**（t-tabs）：点餐 / 订单两个 Tab，支持点击和左右滑切换（swiper）
- **左侧分类导航**：自定义侧边栏，w-1/5 比例宽度，激活态高亮（白底星巴克绿）
- **右侧商品列表**（scroll-view）：按分类分区，sticky 吸顶标题（毛玻璃效果），底部"到底了"提示
- **双向联动**：点击侧边栏 → 商品列表滚动到对应分类；滚动商品列表 → 侧边栏高亮跟随
- **Mock 数据**：5 个分类 × 7~9 个商品，Phase 1 阶段使用

### 技术要点
- TDesign tabs 用 `:value` 受控模式 + `onMounted` 延迟刷新修复首屏激活态不渲染
- sidebar ↔ 内容区联动通过预计算各分类区块 top 坐标 + `scroll-into-view` 实现
- 分类标题毛玻璃效果：`backdrop-filter: blur(12rpx)` + 半透明白底
- 商品列表无滚动条：`:enhanced="true"` + `:show-scrollbar="false"`
- tabs 文字与侧边栏居中对齐：`custom-style` 设置 CSS 变量 `--td-spacer-2` + `padding-left`

## 2026-07-10 购物栏分包组件

### 完成内容

#### sub-components/checkout-bar/index.vue
- 创建分包组件，使用 `componentPlaceholder` + `lazyCodeLoading` 实现按需加载
- UI 结构：左侧合计价格 + 明细箭头（t-icon），右侧金色结算按钮
- 底部安全区适配：通过 `uni.getWindowInfo().safeAreaInsets.bottom` 动态设置 padding-bottom，兼容 iOS/Android

#### 配置变更
- `pages.json`：新增 `sub-components` 分包（`pages: []`），首页 style 添加 `componentPlaceholder` 映射
- `manifest.json`：`mp-weixin` 添加 `lazyCodeLoading: "requiredComponents"`
- `pages/home/index.vue`：引入并使用 `<checkout-bar />`

### 分包组件创建步骤（备忘）

1. `src/sub-components/<name>/index.vue` 创建组件
2. `pages.json` → `subPackages` 添加 `{ "root": "sub-components", "pages": [] }`
3. `pages.json` → 页面 style 添加 `"componentPlaceholder": { "<component-name>": "view" }`
4. `manifest.json` → `mp-weixin` 添加 `"lazyCodeLoading": "requiredComponents"`
5. 页面中正常 import 使用

### 参考文档
- [uniapp 分包异步化](https://uniapp.dcloud.net.cn/tutorial/miniprogram-subcontract-asynchrony.html)
- [微信占位组件](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/placeholder.html)
- [微信用时注入](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/lazyload.html)
- [组件级 componentPlaceholder 插件](https://ask.dcloud.net.cn/article/42114)

### 验证方式
- 编译产物中 `sub-components/` 目录独立存在，代码未打入主包 vendor.js
- 微信开发者工具 Console 对比 `[home] mounted` 和 `[checkout-bar] mounted` 时序
- Network 面板观察分包下载时机

## 未完成
- 购物车数据对接（Pinia store + composable）
- 结算栏显隐逻辑（首次加购滑入、购物车清空不销毁）
- 购物车抽屉（点击明细展开）
- 结算按钮跳转确认订单页
- 订单 Tab 内容
- 与后端对接（Phase 3）
