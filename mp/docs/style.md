## 概览

项目使用[@tdesign/uniapp](https://tdesign.tencent.com/uniapp/getting-started)作为组件库，配置tailwind css v4（由[weapp-tailwindcss](https://weapp-tw.icebreaker.top/docs/intro)提供支持），
可以加快页面开发。

## 设计规范

项目的设计规范`./DESIGN.md`直接来自[opendesign](https://open-design.ai/zh/plugins/design-system-starbucks/)，直接复制过来的没有改动。小程序开发应该尽可能遵守这套规范。

## tdesign

组件库参考官方安装教程中的CLI模式安装，以下是安装步骤
1. 在main.ts中引入基础样式`import '@tdesign/uniapp/theme.less';`，官方推荐使用`.less`文件，它里面使用的`rpx`单位更符合小程序环境。注意这个样式应该在自定义主题的前面导入，不要覆盖自定义主题。
2. 在pages.json中注册组件。使用`easycom`方式注册组件，组件中可以通过`t-[组件名]`的方式直接使用，不需要导入。
3. 在tsconfig.json中添加组件库类型。添加后还需要在env.d.ts中添加对应`<reference>`，否则webstorm可能没有类型提示。

**自定义主题**

根据DESIGN.md的要求，自定义了tdesign组件库的主题，主题文件在`mp/src/styles/tdesign-theme.less`，这里用less文件主要是为了使用rpx单位。自定义主题在main.ts中引入，注意它应该在基础样式之后引入，这样才能覆盖默认样式。

## tailwind css v4

uniapp默认不支持tailwindcss，项目通过`weapp-tailwindcss`提供了支持。tailwindcss基础样式在`src/styles/main.css`，在main.ts中导入样式。

关于`vite.config.ts`的`WeappTailwindcss.cssEntries`，`weapp`官方文档说每个分包都要有自己的入口文件，其实不用，如果分包不需要独立的主题样式，那就不用写独立入口。
所有分包默认继承基础的main.css主题，需要自定义时再考虑在分包中创建独立css。

**自定义主题**

主题文件在`mp/src/styles/theme.css`中，使用rem单位，它会由weapp-tailwindcss自动转换成rpx单位。在main.css中导入。

## uni.scss

这个文件是uniapp提供的默认组件样式，在本项目中大概率用不到，不过我还是让AI根据设计规范修改了它。
