import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitepress'
import { buildNav, buildSidebar, sections } from './sidebar.mts'
import { BASE, sharePlugin } from './share.mjs'

// dev 和 preview 固定同一端口，Cloudflare Tunnel 只需指向 http://localhost:7788
const PORT = 7788

// 侧边栏只在加载配置时生成一次，新增/删除文档后不会刷新。
// 监听分类目录下 .md 和子目录的增删，touch sidebar.mts 让 VitePress 重新加载配置
function sidebarReloadPlugin(): Plugin {
  const docsRoot = path.resolve(__dirname, '..')
  const sidebarFile = path.join(__dirname, 'sidebar.mts')
  const dirs = Object.keys(sections).map((d) => path.join(docsRoot, d) + path.sep)
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    name: 'sidebar-reload',
    apply: 'serve',
    configureServer(server) {
      const onChange = (file: string, isDir: boolean) => {
        if (!isDir && !file.endsWith('.md')) return
        if (!dirs.some((d) => file.startsWith(d))) return
        // 批量增删（如 git checkout）合并成一次重载
        clearTimeout(timer)
        timer = setTimeout(() => {
          const now = new Date()
          fs.utimesSync(sidebarFile, now, now)
        }, 300)
      }
      server.watcher.on('add', (f) => onChange(f, false))
      server.watcher.on('unlink', (f) => onChange(f, false))
      server.watcher.on('addDir', (f) => onChange(f, true))
      server.watcher.on('unlinkDir', (f) => onChange(f, true))
    },
  }
}

export default defineConfig({
  base: `${BASE}/`,
  lang: 'zh-CN',
  title: '开发文档',
  description: '个人开发文档库',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    // head 里的路径 VitePress 不会自动加 base
    ['link', { rel: 'icon', href: `${BASE}/favicon.ico`, sizes: '48x48' }],
    ['link', { rel: 'icon', href: `${BASE}/favicon.svg`, type: 'image/svg+xml' }],
    ['link', { rel: 'apple-touch-icon', href: `${BASE}/apple-touch-icon.png` }],
  ],

  themeConfig: {
    logo: '/favicon.svg',
    nav: buildNav(),
    sidebar: buildSidebar(),
    outline: { level: [2, 3], label: '本页目录' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清除',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
  },

  vite: {
    // 通过 Tunnel 访问时 Host 是公网域名，需放行；可改成具体域名如 ['doc.example.com']
    // 监听所有网卡供外部 nginx 反代；非本机请求只能访问分享页（见 share.mjs）
    server: { host: '0.0.0.0', port: PORT, strictPort: true, allowedHosts: true },
    plugins: [sharePlugin(), sidebarReloadPlugin()],
  },
})
