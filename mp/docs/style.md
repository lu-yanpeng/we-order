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

## tailwind css v4

uniapp默认不支持tailwindcss，项目通过`weapp-tailwindcss`提供了支持。tailwindcss基础样式在`src/styles/main.css`，在main.ts中导入样式。

关于`vite.config.ts`的`WeappTailwindcss.cssEntries`，`weapp`官方文档说每个分包都要有自己的入口文件，其实不用，如果分包不需要独立的主题样式，那就不用写独立入口。
所有分包默认继承基础的main.css主题，需要自定义时再考虑在分包中创建独立css。

**自定义主题**

应该在main.css创建扩展官方主题主题，但是因为`weapp-tailwindcss`还有一些[问题](https://github.com/sonofmagic/weapp-tailwindcss/issues/978)，
现在只能先手写css，等待官方修复好后再考虑tailwindcss。

## uni.scss

这个文件是uniapp提供的默认组件样式，在本项目中大概率用不到，不过我还是让AI根据设计规范修改了它。
