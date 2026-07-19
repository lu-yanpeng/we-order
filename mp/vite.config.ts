import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResolvedConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { defineConfig } from 'vite'
import { WeappTailwindcss } from 'weapp-tailwindcss/vite'

const projectRoot = dirname(fileURLToPath(import.meta.url))

/**
 * 为所有缺少 .wxss 的页面自动创建空文件。
 *
 * 背景：
 * - 从主包中通过`uni.navigateTo`跳转到分包，会因为分包缺少wxss文件而报错
 * - 使用 Tailwind CSS 时，页面通常无需手写样式，因此 Vue SFC 中不写 <style> 块
 * - @dcloudio/vite-plugin-uni 不会为无 <style> 块的页面生成 .wxss 文件
 * - 微信开发者工具的 Builder Services 编译管线在初始化页面编译环境时
 *   会读取 .wxss 文件（通过 getRootFactory），缺少时直接抛 ENOENT 或
 *   "Not Define Env"，导致分包跳转报错
 * - 即使在分包中不写任何样式，打包结果也不包含wxss的情况下，微信开发者工具
 *   还是会报错
 *
 * 该插件在每次打包写入结束后，从 Vite 解析后的 outDir 读取 app.json，
 * 解析所有页面（含分包）路径，对不存在对应 .wxss 的页面补创建空文件。
 * 一次配置，后续新增分包页面自动覆盖，无需额外维护。
 */
function ensurePageWxss() {
  let outDir: string
  return {
    name: 'ensure-page-wxss',
    enforce: 'post' as const,
    configResolved(config: ResolvedConfig) {
      outDir = config.build.outDir
    },
    writeBundle() {
      const appJsonPath = join(outDir, 'app.json')
      if (!existsSync(appJsonPath)) return

      const appJson = JSON.parse(readFileSync(appJsonPath, 'utf-8'))
      const pages: string[] = [...(appJson.pages || [])]
      for (const subPkg of appJson.subPackages || appJson.subpackages || []) {
        for (const page of subPkg.pages || []) {
          const pagePath = typeof page === 'string' ? page : page.path
          pages.push(`${subPkg.root}/${pagePath}`)
        }
      }

      for (const page of pages) {
        const wxssPath = join(outDir, `${page}.wxss`)
        if (!existsSync(wxssPath)) {
          writeFileSync(wxssPath, '')
        }
      }
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    uni(),
    WeappTailwindcss({
      cssEntries: [
        resolve(projectRoot, 'src/styles/main.css'),
      ],
      cssOptions: {
        rem2rpx: true,
      },
    }),
    ensurePageWxss(),
  ],
});
