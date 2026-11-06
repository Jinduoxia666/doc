import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const DOCS_ROOT = path.resolve(__dirname, '..')

// 分类目录 -> 显示名称，顺序即导航/侧边栏顺序
export const sections: Record<string, string> = {
  projects: '项目文档',
  frontend: '前端对接',
  solutions: '方案',
  ops: '运维部署',
  scripts: '脚本工具',
  others: '其他',
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

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// 侧边栏标题单行省略，下方显示创建日期（见 theme/style.css），悬停时用 title 显示完整标题
function itemText(title: string, date: string): string {
  const t = escapeHtml(title)
  return `<span class="sb-title" title="${t}">${t}</span><span class="sb-date">${date}</span>`
}

// 文档创建时间（毫秒）：frontmatter date > git 首次提交时间 > 文件创建时间
// 一次 git log 拿到所有文件的首次提交时间；重命名的文件沿用原文件的时间
function gitCreatedTimes(): Map<string, number> {
  const times = new Map<string, number>()
  let out = ''
  try {
    out = execFileSync(
      'git',
      ['log', '--reverse', '-M', '--diff-filter=AR', '--name-status', '--format=@%at', '--', '.'],
      { cwd: DOCS_ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    return times
  }
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: DOCS_ROOT, encoding: 'utf-8' }).trim()
  let ts = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('@')) {
      ts = Number(line.slice(1)) * 1000
      continue
    }
    const [status, a, b] = line.split('\t')
    if (!status || !a) continue
    if (status === 'A') {
      const abs = path.join(root, a)
      if (!times.has(abs)) times.set(abs, ts)
    } else if (status.startsWith('R') && b) {
      times.set(path.join(root, b), times.get(path.join(root, a)) ?? ts)
    }
  }
  return times
}

function createdTime(file: string, gitTimes: Map<string, number>): number {
  const content = fs.readFileSync(file, 'utf-8')
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  const fmDate = fm?.[1].match(/^date:\s*['"]?(.+?)['"]?\s*$/m)?.[1]
  if (fmDate) {
    const t = Date.parse(fmDate)
    if (!Number.isNaN(t)) return t
  }
  const t = gitTimes.get(file)
  if (t) return t
  const st = fs.statSync(file)
  return st.birthtimeMs || st.mtimeMs
}

// 递归收集分类目录下的文档（不含 index.md）
function collect(dir: string, urlBase: string, out: { file: string; link: string }[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collect(full, `${urlBase}${e.name}/`, out)
    else if (e.name.endsWith('.md') && e.name !== 'index.md')
      out.push({ file: full, link: `${urlBase}${e.name.replace(/\.md$/, '')}` })
  }
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')

// 按创建时间倒序，按月份分组；最新的月份展开，其余折叠
function byMonth(dir: string, urlBase: string, gitTimes: Map<string, number>): any[] {
  const docs = collect(dir, urlBase)
    .map((d) => ({ ...d, time: createdTime(d.file, gitTimes) }))
    .sort((a, b) => b.time - a.time)

  const groups: any[] = []
  for (const d of docs) {
    const date = new Date(d.time)
    const month = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
    const day = `${month}-${pad(date.getDate())}`
    let g = groups[groups.length - 1]
    if (!g || g.text !== month) {
      g = { text: month, collapsed: groups.length > 0, items: [] }
      groups.push(g)
    }
    g.items.push({ text: itemText(readTitle(d.file), day), link: d.link })
  }
  return groups
}

export function buildSidebar() {
  const gitTimes = gitCreatedTimes()
  const sidebar: Record<string, any[]> = {}
  for (const [dir, label] of Object.entries(sections)) {
    const abs = path.join(DOCS_ROOT, dir)
    if (!fs.existsSync(abs)) continue
    const hasIndex = fs.existsSync(path.join(abs, 'index.md'))
    sidebar[`/${dir}/`] = [
      { text: label, link: hasIndex ? `/${dir}/` : undefined, items: byMonth(abs, `/${dir}/`, gitTimes) },
    ]
  }
  return sidebar
}

export function buildNav() {
  return Object.entries(sections).map(([dir, label]) => ({
    text: label,
    link: `/${dir}/`,
    activeMatch: `^/${dir}/`,
  }))
}
