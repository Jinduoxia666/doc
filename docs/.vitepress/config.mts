import { defineConfig } from 'vitepress'
import { buildNav, buildSidebar } from './sidebar.mts'
import { BASE, sharePlugin } from './share.mjs'

// dev 和 preview 固定同一端口，Cloudflare Tunnel 只需指向 http://localhost:7788
const PORT = 7788

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
    plugins: [sharePlugin()],
  },
})
