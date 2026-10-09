import fs from 'node:fs'
import path from 'node:path'

const DOCS_ROOT = path.resolve(__dirname, '..')

// 分类目录 -> 显示名称，顺序即导航/侧边栏顺序
export const sections: Record<string, string> = {
  projects: '项目文档',
  backend: '后端',
  frontend: '前端',
  ops: '运维部署',
  database: '数据库',
  snippets: '代码片段',
}

// 标题优先级：frontmatter title > 第一个一级标题 > 文件名
function readTitle(file: string): string {
  const content = fs.readFileSync(file, 'utf-8')
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  const fmTitle = fm?.[1].match(/^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1]
  if (fmTitle) return fmTitle
  const h1 = content.match(/^#\s+(.+)$/m)?.[1]
  return h1?.trim() || path.basename(file, '.md')
}

function walk(dir: string, urlBase: string): any[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  const items: any[] = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      const children = walk(full, `${urlBase}${e.name}/`)
      if (children.length) items.push({ text: e.name, collapsed: true, items: children })
    } else if (e.name.endsWith('.md') && e.name !== 'index.md') {
      items.push({ text: readTitle(full), link: `${urlBase}${e.name.replace(/\.md$/, '')}` })
    }
  }
  return items
}

export function buildSidebar() {
  const sidebar: Record<string, any[]> = {}
  for (const [dir, label] of Object.entries(sections)) {
    const abs = path.join(DOCS_ROOT, dir)
    if (!fs.existsSync(abs)) continue
    const hasIndex = fs.existsSync(path.join(abs, 'index.md'))
    sidebar[`/${dir}/`] = [
      { text: label, link: hasIndex ? `/${dir}/` : undefined, items: walk(abs, `/${dir}/`) },
    ]
  }
  return sidebar
}

export function buildNav() {
  return Object.entries(sections).map(([dir, label]) => ({ text: label, link: `/${dir}/` }))
}
