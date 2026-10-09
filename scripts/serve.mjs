// 以静态方式预览构建产物。用 Vite 的 preview 而不是 vitepress preview，
// 因为后者不加载 Vite 插件，分享功能（sharePlugin）就不可用了。
import { preview } from 'vite'
import { BASE, sharePlugin } from '../docs/.vitepress/share.mjs'

const server = await preview({
  configFile: false,
  base: `${BASE}/`,
  appType: 'mpa',
  build: { outDir: 'docs/.vitepress/dist' },
  preview: { host: '0.0.0.0', port: Number(process.env.PORT || 7788), strictPort: true, allowedHosts: true },
  plugins: [sharePlugin()],
})
server.printUrls()
