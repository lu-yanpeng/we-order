## 项目概览

这是点餐小程序的前端子项目，主要用到以下技术

- uniapp
- vue3
- typescript
- pnpm
- [tDesign](https://tdesign.tencent.com/uniapp/overview) 组件库
- tailwind css v4

该项目最终只会部署到微信小程序平台，不需要考虑兼容其他平台。比如h5和其他小程序，只需要考虑微信的语法，不要做其他平台的适配。

## 项目质量

项目配置了eslint和format，可通过下面命令检查代码

- `pnpm type-check`
- `pnpm lint`
- `pnpm format`

## 样式

项目基于uniapp，长度单位需要使用`rpx`。相关文档在`mp/docs/style.md`，包含tdesign和tailwindcss的一些说明

## 可参考文档

以下文档按需读取

- 设计文档`mp/docs/DESIGN.md`；项目设计规范，这些规范已经体现在项目原型html中，文档只保留做参考，一般情况下不需要显示读取或修改文档
