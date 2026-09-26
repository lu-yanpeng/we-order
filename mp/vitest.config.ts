import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 单元测试配置（P3 Story 1.2）
 *
 * 独立于 `vite.config.ts`：vitest 优先读取本文件，因此不会加载 uni / tailwind 插件链，
 * 也就不会影响小程序构建所用的 vite（项目根 vite 固定 5.2.8，不做升级）。
 * 只跑纯 TS 单测（错误归一、文案、通道拦截），`environment: 'node'`，不依赖 uni 运行时。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 让 vitest 用包的 ESM 构建（其 CJS 构建的 default 导出指向自身，require 互操作下不是函数）
    server: {
      deps: {
        inline: ['@alova/adapter-uniapp'],
      },
    },
  },
})
