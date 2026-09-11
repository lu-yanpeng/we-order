## 项目概览

这是点餐小程序的前端子项目，主要用到以下技术

- uniapp
- vue3.5
- typescript
- pnpm
- [tDesign](https://tdesign.tencent.com/uniapp/overview) 组件库
- tailwind css v4

该项目最终只会部署到微信小程序平台，不需要考虑兼容其他平台。比如h5和其他小程序，只需要考虑微信的语法，不要做其他平台的适配。

## vue相关

### 最新语法

写vue代码时，优先考虑用vue3.5的最新语法。

**响应式解构**，解构props的同时给出默认值

```ts
const { max = 100 } = defineProps<{
  max?: number
}>()
```

**事件标注类型**，优先使用具名元组语法

```ts
const emit = defineEmits<{
  update: [value: string]
}>()
```

## 项目质量

项目配置了eslint和format，可通过下面命令检查代码

- `pnpm type-check`
- `pnpm lint`
- `pnpm format`

## 样式

项目基于uniapp，长度单位需要使用`rpx`。开发任何组件应该优先考虑tdesing的组件，其次考虑手写。相关文档在`mp/docs/style.md`，包含tdesign和tailwindcss的一些说明

输入样式时，优先使用`styles/main.css`中定义的tailwindcss主题，没有对应样式的可以使用任意值语法，实在无法使用tailwindcss的再考虑手写。
手写css时，应该把样式写在`<style scoped>`，尽量避免污染全局样式。对于组件样式可以使用`:deep()`伪类来修改，参考以下代码：

```vue
<script>
defineOptions({
  // 必须设置成这个值才能修改组件内部样式，其他值无效
  options: {
    styleIsolation: "shared",
  }
})
</script>

<template>
  <view class="checkout-bar">
    <t-popup />
  </view>
</template>

<style scoped>
.checkout-bar :deep(.t-popup) {
  /* 使用嵌套css，需要使用 less ，uniapp会把css原样输出给小程序，小程序不支持css原生的嵌套语法 */
  /* 组件直接作为根节点时 :deep() 会失效。可以在组件外层套一个view，让他作为根节点。原理参考我的[笔记](https://lu-yanpeng.github.io/docs/vue/component/css-scope) */
}
</style>
```

关于自己创建的组件，如何接收并设置样式，可以参考 [bottom-bar](mp/src/components/bottom-bar/index.vue)

## 可参考文档

以下文档按需读取

- 设计文档`mp/docs/DESIGN.md`；项目设计规范，这些规范已经体现在项目原型html中，文档只保留做参考，一般情况下不需要显示读取或修改文档
