## 概览

项目使用[@tdesign/uniapp](https://tdesign.tencent.com/uniapp/getting-started)作为组件库，配置tailwind css v4（由[weapp-tailwindcss](https://weapp-tw.icebreaker.top/docs/intro)提供支持），
可以加快页面开发。

## 设计规范

项目的设计规范`./DESIGN.md`直接来自[opendesign](https://open-design.ai/zh/plugins/design-system-starbucks/)，直接复制过来的没有改动。小程序开发应该尽可能遵守这套规范。

## tdesign

> tdesign官网使用SPA页面，AI无法直接获取文档。可以安装官方[MCP工具](https://tdesign.tencent.com/uniapp/mcp)，让AI调用工具查询文档。

组件库参考官方安装教程中的CLI模式安装，以下是安装步骤
1. 在main.ts中引入`import './styles/tdesign.less';`，这个文件统一导入了TDesign基础样式和自定义主题。官方推荐使用`.less`文件，它里面使用的`rpx`单位更符合小程序环境。
2. 在pages.json中注册组件。使用`easycom`方式注册组件，组件中可以通过`t-[组件名]`的方式直接使用，不需要导入。
3. 在tsconfig.json中添加组件库类型。添加后还需要在env.d.ts中添加对应`<reference>`，否则webstorm可能没有类型提示。

**样式文件结构**

- `src/styles/tdesign.less` — 统一入口，先导入官方基础样式，然后通过自定义主题样式覆盖

自定义主题根据DESIGN.md的要求定制，使用less文件主要是为了使用rpx单位。

**自定义组件样式**

> 参考 `home/components/spec-sheet/index.vue`，这里自定义了t-popup的样式

要[自定义](https://tdesign.tencent.com/uniapp/custom-style)tdesign组件的样式，主要有三种方式：

一、custom-style属性

tdesign组件都支持`custom-style`属性，给组件设置这个属性后，这里的样式会被直接渲染到组件的根节点，打开控制台查看元素就能看到。
这种方式适合调整较少时使用。

```html
<t-popup custom-style="padding: 0;" />
```

二、**同名替换**，推荐

直接使用同名的选择器选中节点，替换需要的样式。这样的方式最灵活，不要类名相同，不止可以修改根节点样式，藏的很深的节点也可以修改。推荐使用

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
  <t-popup />
</template>

<style>
/* 不能加scoped，否则不生效 */
/* 注意！t-popup这里是<t-popup>组件真实渲染出来的节点的类名，不是乱写的，可以打开控制台查看渲染后的类名。
.t-popup会作为全局样式被popup根组件选中 */
.t-popup {
  /* 这里可以替换也可以新增样式，替换的时候可能需要加 !important */
}
</style>
```

三、t-class

这个值是大多数组件都有属性，具体还是要看文档。为组件添加`t-class`属性，可以修改组件的样式。但是很深的子节点很难选中，改起来也麻烦。建议只用来做根节点的修改。具体用法和方法二相同，都需要设置`styleIsolation`。

## tailwind css v4

uniapp默认不支持tailwindcss，项目通过`weapp-tailwindcss`提供了支持。tailwindcss基础样式在`src/styles/main.css`，在`App.vue`的`<style>`中导入。

`main.css` 中包含完整的 Tailwind CSS v4 `@theme` 声明，将所有设计 token（颜色、字体、圆角、阴影等）映射为 Tailwind 工具类。设计 token 来源于 `docs/DESIGN.md`。

在模板中使用时，应该优先使用已定义的主题样式，比如`text-green`。无法直接通过类名使用的工具类样式，比如`--mp-space-1`，可以在<style>中通过手写`var(--mp-space-1)`的方式使用。

整个项目应该优先使用tailwindcss，实在无法完成的再考虑手写css。

关于`vite.config.ts`的`WeappTailwindcss.cssEntries`，`weapp`官方文档说每个分包都要有自己的入口文件，其实不用，如果分包不需要独立的主题样式，那就不用写独立入口。
所有分包默认继承基础的main.css主题，需要自定义时再考虑在分包中创建独立css。

## uni.scss

这个文件是uniapp提供的默认组件样式，在本项目中大概率用不到，不过我还是让AI根据设计规范修改了它。
