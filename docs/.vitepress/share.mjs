// 文档分享（Vite 插件，挂在文档站自身的 dev / preview 服务上）：每篇文档一个固定随机密码，凭密码只能查看该篇文档。
//   - 分享页：<origin><base>/s/<id>，凭该篇的分享密码访问，不需要站点登录
//   - 管理 API：<base>/__share/api/*，需站点登录或本机访问
// 分享页只渲染被分享的那一篇 Markdown，不暴露站点前端资源和搜索索引。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createMarkdownRenderer } from 'vitepress'
import { SESSION_COOKIE, checkPassword, clearSessionCookie, hasPassword, isLoggedIn, sessionCookie } from './auth.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS = path.join(ROOT, 'docs')
const STORE = path.join(ROOT, '.shares.json')
// 本机部署配置 site.json（已 gitignore，参考 site.example.json）：前缀、分享域名等不进仓库
const SITE = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'site.json'), 'utf-8'))
  } catch {
    return {}
  }
})()
// 分享链接对外使用的域名（外部 nginx 反代到本机）；不配置时用当前访问的域名
const SHARE_ORIGIN = SITE.origin?.replace(/\/+$/, '')
// 整站挂在前缀下（VitePress base），同一域名可按前缀分给不同的人反代到各自主机
export const BASE = SITE.base || '/dp'
if (!/^\/[a-z0-9-]+$/.test(BASE)) throw new Error(`site.json 的 base 格式应为 /xxx（小写字母、数字、-），当前：${BASE}`)
// 访问模式（Host 头可伪造，所以免登录还要求连接来自本机）：
//   local —— 本机直接访问 localhost：完整站点，免登录（本地开发）
//   login —— 其他一切（外部 nginx、局域网直连）：需要登录
// 分享页 /s/<id> 在任何模式下都只凭该文档的分享密码访问，不需要登录。
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
function accessMode(req) {
  const hostname = (req.headers.host || '').replace(/:\d+$/, '')
  return LOOPBACK.has(req.socket.remoteAddress) && LOCAL_HOSTS.has(hostname) ? 'local' : 'login'
}

function isHttps(req) {
  // 外部反代用 X-Original-Proto 告知访客实际协议（http 页面上浏览器不接受 Secure cookie）
  const proto = req.headers['x-original-proto'] || (req.headers['cf-visitor']?.includes('https') ? 'https' : req.headers['x-forwarded-proto'])
  return proto === 'https'
}

function clientIp(req) {
  // 经外部 nginx 反代时，cf-connecting-ip 是反代服务器的 IP，再拼上它转来的访客 IP
  return `${req.headers['cf-connecting-ip'] || req.socket.remoteAddress}|${req.headers['x-real-ip'] || ''}`
}
const COOKIE_DAYS = 30
const MAX_FAILS = 10 // 每个 IP 每篇文档 10 分钟内最多输错次数
const FAIL_WINDOW = 10 * 60 * 1000

// ---------- 存储 ----------

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf-8'))
  } catch {
    const init = { secret: crypto.randomBytes(32).toString('hex'), shares: {} }
    save(init)
    return init
  }
}

function save(data) {
  const tmp = `${STORE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, STORE)
}

const PW_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789' // 去掉易混淆的 i l o 0 1
function randomPassword(len = 8) {
  const bytes = crypto.randomBytes(len)
  return Array.from(bytes, (b) => PW_CHARS[b % PW_CHARS.length]).join('')
}

function findById(data, id) {
  for (const [docPath, s] of Object.entries(data.shares)) if (s.id === id) return { docPath, ...s }
  return null
}

function requestOrigin(req) {
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`
}

function shareInfo(req, docPath, s) {
  const origin = SHARE_ORIGIN || requestOrigin(req)
  return { shared: true, path: docPath, id: s.id, password: s.password, public: !!s.public, url: `${origin}${BASE}/s/${s.id}`, createdAt: s.createdAt }
}

// 只允许 docs 目录内已存在的 .md 文件
function resolveDoc(docPath) {
  if (typeof docPath !== 'string' || !docPath.endsWith('.md')) return null
  const abs = path.resolve(DOCS, docPath)
  if (!abs.startsWith(DOCS + path.sep) || abs.includes(`${path.sep}.vitepress${path.sep}`)) return null
  return fs.existsSync(abs) ? abs : null
}

// ---------- 鉴权 ----------

function sign(secret, id, password) {
  return crypto.createHmac('sha256', secret).update(`${id}:${password}`).digest('base64url')
}

function safeEqual(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, v.join('=')]),
  )
}

const fails = new Map()
function tooManyFails(key) {
  const now = Date.now()
  const list = (fails.get(key) || []).filter((t) => now - t < FAIL_WINDOW)
  fails.set(key, list)
  return list.length >= MAX_FAILS
}

// ---------- 渲染 ----------

let mdPromise
function renderer() {
  mdPromise ??= createMarkdownRenderer(DOCS, {}, `${BASE}/`)
  return mdPromise
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// 分享页的访客没有站点登录态，拿不到 public 下的静态资源，把文档引用的图片内联成 data URI
const PUBLIC = path.join(DOCS, 'public')
const IMAGE_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const MAX_INLINE_IMAGE = 2 * 1024 * 1024

function inlineImages(html) {
  return html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/g, (all, pre, src, post) => {
    if (!src.startsWith('/')) return all
    const rel = decodeURIComponent((src.startsWith(`${BASE}/`) ? src.slice(BASE.length) : src).split(/[?#]/)[0])
    const abs = path.resolve(PUBLIC, `.${rel}`)
    const type = IMAGE_TYPES[path.extname(abs).toLowerCase()]
    if (!type || !abs.startsWith(PUBLIC + path.sep) || !fs.existsSync(abs)) return all
    const buf = fs.readFileSync(abs)
    if (buf.length > MAX_INLINE_IMAGE) return all
    return `${pre}data:${type};base64,${buf.toString('base64')}${post}`
  })
}

// 从渲染结果里取 h2 / h3 生成本页目录（标题文本已是转义后的 HTML）
function buildToc(html) {
  const items = []
  for (const m of html.matchAll(/<h([23]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const text = m[3].replace(/<a class="header-anchor"[\s\S]*?<\/a>/g, '').replace(/<[^>]+>/g, '').trim()
    if (text) items.push({ level: Number(m[1]), id: m[2], text })
  }
  return items
}

// ```mermaid 代码块先换成占位段落，渲染后再替换成待前端绘制的容器（源码放 data-code）
const MERMAID_FENCE = /^```mermaid\r?\n([\s\S]*?)^```[ \t]*$/gm
const MERMAID_JS = path.join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js')

function extractMermaid(body) {
  const blocks = []
  const text = body.replace(MERMAID_FENCE, (_, code) => `MERMAIDBLOCK${blocks.push(code) - 1}\n`)
  return { text, blocks }
}

function restoreMermaid(html, blocks) {
  return html.replace(/<p>MERMAIDBLOCK(\d+)<\/p>/g, (_, i) => `<div class="mermaid-block" data-code="${encodeURIComponent(blocks[i])}"></div>`)
}

async function renderDoc(abs) {
  const raw = fs.readFileSync(abs, 'utf-8')
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  const fmTitle = raw.match(/^---\r?\n[\s\S]*?^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1]
  const title = fmTitle || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(abs, '.md')
  const md = await renderer()
  const { text, blocks } = extractMermaid(body)
  const html = restoreMermaid(inlineImages(md.render(text, { path: abs, relativePath: path.relative(DOCS, abs), cleanUrls: true })), blocks)
  return { title, html, toc: buildToc(html), mermaid: blocks.length > 0 }
}

function page(title, content) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>${content}</body>
</html>`
}

function loginPage(title, error) {
  return page(
    `访问受保护的文档`,
    `<main class="login">
  <img src="${BASE}/favicon.svg" alt="" width="48" height="48">
  <h1>${esc(title)}</h1>
  <p class="muted">这篇文档需要访问密码</p>
  <form method="post">
    <input name="password" type="password" placeholder="请输入访问密码" autocomplete="off" autofocus required>
    <button type="submit">访问</button>
  </form>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
</main>`,
  )
}

// 分享页访客拿不到站点前端资源，mermaid 走免登录的 /__share/mermaid.min.js
function mermaidScript() {
  return `<script src="${BASE}/__share/mermaid.min.js"></script>
<script>
(async () => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' })
  let n = 0
  for (const el of document.querySelectorAll('.mermaid-block[data-code]')) {
    try {
      el.innerHTML = (await mermaid.render('mermaid-' + n++, decodeURIComponent(el.dataset.code))).svg
    } catch (e) {
      el.textContent = String(e)
    }
  }
})()
</script>`
}

function tocTree(items) {
  const root = []
  let parent = null
  for (const item of items) {
    if (item.level <= 2 || !parent) {
      parent = { ...item, children: [] }
      root.push(parent)
    } else parent.children.push({ ...item, children: [] })
  }
  return root
}

function tocList(nodes, nested) {
  const lis = nodes.map((n) => `<li><a class="outline-link" href="#${n.id}">${n.text}</a>${n.children?.length ? tocList(n.children, true) : ''}</li>`).join('')
  return `<ul class="${nested ? 'nested' : 'root'}">${lis}</ul>`
}

// 和站内 VPDocAsideOutline 一样：右侧 224px，当前标题有一根青色标记
function outlineScript() {
  return `<script>
(() => {
  const nav = document.querySelector('.toc')
  if (!nav) return
  const marker = nav.querySelector('.outline-marker')
  const heads = [...nav.querySelectorAll('a.outline-link')].flatMap((a) => {
    const el = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))
    return el ? [{ a, el }] : []
  })
  let prev = null
  const activate = (a) => {
    if (prev) prev.classList.remove('active')
    prev = a
    if (!a) { marker.style.opacity = '0'; return }
    a.classList.add('active')
    marker.style.top = (a.offsetTop + 39) + 'px'
    marker.style.opacity = '1'
  }
  const tick = () => {
    const y = window.scrollY
    const atBottom = Math.abs(y + innerHeight - document.body.offsetHeight) < 1
    if (y < 1 || !heads.length) return activate(null)
    if (atBottom) return activate(heads[heads.length - 1].a)
    let active = null
    for (const h of heads) {
      if (h.el.getBoundingClientRect().top + y > y + 112 + 4) break
      active = h.a
    }
    activate(active)
  }
  tick()
  window.addEventListener('scroll', tick, { passive: true })
  window.addEventListener('resize', tick)
})()
</script>`
}

function docPage({ title, html, toc, mermaid }) {
  const tree = tocTree(toc)
  const list = tocList(tree, false)
  const nav = toc.length >= 2
    ? `<details class="toc-m"><summary>本页目录</summary>${list}</details>`
    : ''
  const aside = toc.length >= 2
    ? `<nav class="toc" aria-labelledby="doc-outline-aria-label"><div class="content"><div class="outline-marker"></div><div class="outline-title" id="doc-outline-aria-label">本页目录</div>${list}</div></nav>`
    : ''
  return page(
    title,
    `<header class="bar"><img src="${BASE}/favicon.svg" alt="" width="24" height="24"><span>${esc(title)}</span><span class="tag">分享文档</span></header>
<div class="layout"><main class="doc">${nav}${html}</main>${aside}</div>${toc.length >= 2 ? outlineScript() : ''}${mermaid ? mermaidScript() : ''}`,
  )
}

// ---------- HTTP ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...headers })
  res.end(body)
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' })
}

function readBody(req, limit = 1e5) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

async function handleApi(req, res, url) {
  const data = load()
  const route = url.pathname.slice(BASE.length).replace(/^\/__share\/api/, '')
  const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {}
  const docPath = url.searchParams.get('path') || body.path
  if (route === '/shares' && req.method === 'GET' && !docPath) {
    return json(res, 200, Object.entries(data.shares).map(([p, s]) => shareInfo(req, p, s)))
  }
  if (!resolveDoc(docPath)) return json(res, 404, { error: '文档不存在' })
  const existing = data.shares[docPath]

  if (route === '/shares' && req.method === 'GET') {
    return json(res, 200, existing ? shareInfo(req, docPath, existing) : { shared: false, path: docPath })
  }
  if (route === '/shares' && req.method === 'POST') {
    if (!existing) {
      data.shares[docPath] = { id: crypto.randomBytes(6).toString('base64url'), password: randomPassword(), createdAt: new Date().toISOString() }
      save(data)
    }
    return json(res, 200, shareInfo(req, docPath, data.shares[docPath]))
  }
  if (route === '/shares/reset' && req.method === 'POST') {
    if (!existing) return json(res, 404, { error: '尚未分享' })
    existing.password = randomPassword()
    save(data)
    return json(res, 200, shareInfo(req, docPath, existing))
  }
  // 公开分享：拿到链接即可查看，不用输密码（如给同事看的工具使用说明）
  if (route === '/shares/public' && req.method === 'POST') {
    if (!existing) return json(res, 404, { error: '尚未分享' })
    existing.public = !!body.public
    save(data)
    return json(res, 200, shareInfo(req, docPath, existing))
  }
  if (route === '/shares' && req.method === 'DELETE') {
    delete data.shares[docPath]
    save(data)
    return json(res, 200, { shared: false, path: docPath })
  }
  return json(res, 404, { error: 'not found' })
}

async function handleShare(req, res, id) {
  const data = load()
  const share = findById(data, id)
  const abs = share && resolveDoc(share.docPath)
  if (!abs) return send(res, 404, page('链接无效', '<main class="login"><h1>链接无效</h1><p class="muted">分享已取消或文档不存在</p></main>'))

  const cookieName = `share_${id}`
  const token = sign(data.secret, id, share.password)
  const doc = await renderDoc(abs)
  const { title } = doc

  if (share.public) return req.method === 'POST' ? send(res, 303, '', { Location: `${BASE}/s/${id}` }) : send(res, 200, docPage(doc))

  if (req.method === 'POST') {
    const key = `${clientIp(req)}|${id}`
    if (tooManyFails(key)) return send(res, 429, loginPage(title, '尝试次数过多，请 10 分钟后再试'))
    const password = new URLSearchParams(await readBody(req)).get('password')?.trim() || ''
    if (!safeEqual(password, share.password)) {
      fails.get(key).push(Date.now())
      return send(res, 401, loginPage(title, '密码错误'))
    }
    const secure = isHttps(req) ? '; Secure' : ''
    return send(res, 303, '', {
      Location: `${BASE}/s/${id}`,
      'Set-Cookie': `${cookieName}=${token}; Path=${BASE}/s/${id}; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`,
    })
  }

  if (!safeEqual(parseCookies(req)[cookieName] || '', token)) return send(res, 200, loginPage(title))
  return send(res, 200, docPage(doc))
}

const PUBLIC_FILES = { '/favicon.svg': 'image/svg+xml', '/favicon.ico': 'image/x-icon', '/apple-touch-icon.png': 'image/png' }
// 油猴脚本免登录：同事安装和 Tampermonkey 定时检查更新都拿不到站点登录态
const PUBLIC_SCRIPT = /^\/userscripts\/[A-Za-z0-9_-]+\.user\.js$/

function siteLoginPage(error) {
  return page(
    '登录 · 开发文档',
    `<main class="login">
  <img src="${BASE}/favicon.svg" alt="" width="48" height="48">
  <h1>开发文档</h1>
  <p class="muted">请输入密码登录</p>
  <form method="post">
    <input name="password" type="password" placeholder="密码" autocomplete="current-password" autofocus required>
    <button type="submit">登录</button>
  </form>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
</main>`,
  )
}

// 登录后的响应一律标记为 private，禁止 Cloudflare 等共享缓存缓存。
// 否则 Vite 给 ?v= 模块和构建产物设置的 immutable 长缓存会让 CDN 把需登录的内容（含文档正文、搜索索引）
// 直接返回给未登录的人，也会让新旧模块混用导致页面空白。
function forcePrivateCache(res) {
  const fix = (v) => (/\b(private|no-store)\b/.test(String(v)) ? v : `private, ${v}`)
  const setHeader = res.setHeader.bind(res)
  res.setHeader = (name, value) => setHeader(name, String(name).toLowerCase() === 'cache-control' ? fix(value) : value)
  const writeHead = res.writeHead.bind(res)
  res.writeHead = (status, ...args) => {
    const headers = args.find((a) => a && typeof a === 'object' && !Array.isArray(a))
    for (const k of Object.keys(headers || {})) if (k.toLowerCase() === 'cache-control') headers[k] = fix(headers[k])
    if (!res.getHeader('cache-control') && !Object.keys(headers || {}).some((k) => k.toLowerCase() === 'cache-control')) {
      setHeader('Cache-Control', 'private, no-cache')
    }
    return writeHead(status, ...args)
  }
}

// 只允许站内相对路径，防止登录后被跳到外站
function safeNext(next) {
  return typeof next === 'string' && next.startsWith(`${BASE}/`) && !next.startsWith(`${BASE}/__`) ? next : `${BASE}/`
}

async function handleLogin(req, res, url) {
  if (!hasPassword()) return send(res, 503, page('未设置密码', '<main class="login"><h1>尚未设置登录密码</h1><p class="muted">在文档仓库运行 npm run passwd</p></main>'))
  if (req.method !== 'POST') return send(res, 200, siteLoginPage())
  const key = `${clientIp(req)}|login`
  if (tooManyFails(key)) return send(res, 429, siteLoginPage('尝试次数过多，请 10 分钟后再试'))
  const password = new URLSearchParams(await readBody(req)).get('password') || ''
  if (!checkPassword(password)) {
    fails.get(key).push(Date.now())
    return send(res, 401, siteLoginPage('密码错误'))
  }
  send(res, 303, '', { Location: safeNext(url.searchParams.get('next')), 'Set-Cookie': sessionCookie(isHttps(req)) })
}

async function middleware(req, res, next) {
  try {
    const url = new URL(req.url, 'http://localhost')
    // 前缀外的请求（如旧链接 /s/<id>、根路径）跳到 /dp 下
    if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 404, { error: 'not found' })
      return send(res, 302, '', { Location: `${BASE}${url.pathname}${url.search}` })
    }
    const pathname = url.pathname.slice(BASE.length) || '/'
    const mode = accessMode(req)
    // 开源库文件，不含文档内容，分享页访客免登录可取
    if (pathname === '/__share/mermaid.min.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
      return void fs.createReadStream(MERMAID_JS).pipe(res)
    }
    const m = pathname.match(/^\/s\/([A-Za-z0-9_-]{4,32})\/?$/)
    if (m && (req.method === 'GET' || req.method === 'POST')) return await handleShare(req, res, m[1])

    if (mode === 'login') {
      if (pathname === '/__login') return await handleLogin(req, res, url)
      if (pathname === '/__logout') return send(res, 303, '', { Location: `${BASE}/__login`, 'Set-Cookie': clearSessionCookie() })
      if (!PUBLIC_FILES[pathname] && !PUBLIC_SCRIPT.test(pathname) && !isLoggedIn(parseCookies(req)[SESSION_COOKIE])) {
        const wantsPage = req.method === 'GET' && (req.headers.accept || '').includes('text/html')
        if (wantsPage) return send(res, 302, '', { Location: `${BASE}/__login?next=${encodeURIComponent(url.pathname + url.search)}` })
        return json(res, 401, { error: '未登录' })
      }
      forcePrivateCache(res)
    }

    if (pathname.startsWith('/__share/api/')) return await handleApi(req, res, url)
    if (pathname === '/__logout') return send(res, 303, '', { Location: `${BASE}/` })
    next()
  } catch (e) {
    console.error(e)
    send(res, 500, page('Error', '<main class="login"><h1>服务出错</h1></main>'))
  }
}

export function sharePlugin() {
  return {
    name: 'doc-share',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

const CSS = `
:root{--bg:#f1faee;--fg:#1a2332;--muted:#3a4a5c;--border:#d3e6e4;--soft:#e4f2ef;--brand:#1b6363;--code:#e4f2ef;--err:#b8272c}
@media (prefers-color-scheme:dark){:root{--bg:#1a2332;--fg:#f1faee;--muted:#c5ddd8;--border:#34525a;--soft:#1e2a3a;--brand:#a8dadc;--code:#141c28;--err:#f66f81}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 "DejaVu Sans",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.login{max-width:360px;margin:18vh auto 0;padding:0 16px;text-align:center}
.login h1{font-size:20px;margin:16px 0 4px}
.muted{color:var(--muted);margin:0 0 24px}
.login form{display:flex;gap:8px}
.login input{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--soft);color:var(--fg);font-size:15px}
.login input:focus{outline:2px solid var(--brand);border-color:transparent}
.login button{padding:0 16px;height:36px;border:0;border-radius:8px;background:#a8dadc;color:#1a2332;font-size:14px;font-weight:600;cursor:pointer}
.login button:hover{background:#c5e8ea}
.login button:active{background:#206e6e;color:#f1faee}
.error{color:var(--err);margin-top:12px}
.bar{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg);font-weight:600;z-index:1}
.bar .tag{margin-left:auto;font-size:12px;font-weight:600;color:var(--brand);border:0;border-radius:8px;padding:4px 10px;background:color-mix(in srgb,var(--brand) 16%,transparent);white-space:nowrap}
.doc{max-width:750px;margin:0 auto;padding:32px 16px 96px;overflow-wrap:anywhere}
.doc h1{font-size:30px;line-height:1.3;margin:8px 0 16px}
.doc h2{font-size:23px;margin:40px 0 16px;padding-top:24px;border-top:1px solid var(--border)}
.doc h3{font-size:19px;margin:28px 0 12px}
.doc a{color:var(--brand)}
.doc .header-anchor{display:none}
.doc table{display:block;overflow-x:auto;border-collapse:collapse;margin:16px 0}
.doc th,.doc td{border:1px solid var(--border);padding:8px 14px;text-align:left;vertical-align:top}
.doc th{background:var(--soft)}
.doc tr:nth-child(2n) td{background:var(--soft)}
.doc :not(pre)>code{background:var(--code);border-radius:4px;padding:2px 6px;font-size:.875em}
.doc div[class*=language-]{position:relative;background:var(--code);border-radius:8px;margin:16px 0;overflow-x:auto}
.doc div[class*=language-] .lang,.doc div[class*=language-] .copy{display:none}
.doc pre{margin:0;padding:16px 20px;font-size:14px;line-height:1.6;background:transparent!important}
.doc .shiki span{color:var(--shiki-light)}
@media (prefers-color-scheme:dark){.doc .shiki span{color:var(--shiki-dark)}}
.doc blockquote{margin:16px 0;padding:0 16px;border-left:3px solid var(--border);color:var(--muted)}
.doc .custom-block{border-radius:8px;padding:12px 16px;margin:16px 0;background:var(--soft)}
.doc .custom-block-title{font-weight:600;margin:0}
.doc img{max-width:100%}
.doc .mermaid-block{margin:16px 0;overflow-x:auto;text-align:center}
.doc .mermaid-block foreignObject p,.doc .mermaid-block foreignObject div,.doc .mermaid-block foreignObject span{margin:0;line-height:1.5}
.doc [id]{scroll-margin-top:64px}
.layout{max-width:none;margin:0}
.toc{display:none}
.toc .content{position:relative;border-left:1px solid var(--border);padding-left:16px;font-size:13px;font-weight:500}
.toc .outline-marker{position:absolute;top:32px;left:-1px;z-index:0;opacity:0;width:2px;height:18px;border-radius:2px;background:var(--brand);transition:top .25s cubic-bezier(0,1,.5,1),opacity .25s}
.toc .outline-title{line-height:32px;font-size:14px;font-weight:600;color:var(--fg)}
.toc ul{list-style:none;margin:0;padding:0}
.toc ul.root{position:relative;z-index:1}
.toc ul.nested{padding:0 16px}
.toc a.outline-link{display:block;line-height:32px;font-size:14px;font-weight:400;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none;transition:color .5s}
.toc a.outline-link:hover,.toc a.outline-link.active{color:var(--fg);transition:color .25s}
.toc-m{margin:0 0 16px;padding:8px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px}
.toc-m summary{cursor:pointer;font-weight:600}
.toc-m ul{list-style:none;margin:6px 0 0;padding:0}
.toc-m li{margin:4px 0;line-height:1.5}
.toc-m ul.nested{padding-left:14px}
.toc-m a{color:var(--muted);text-decoration:none}
.toc-m a:hover{color:var(--brand)}
@media (min-width:1280px){
.layout{padding:0}
.doc{width:750px;padding:32px 0 96px}
.toc-m{display:none}
.toc{display:block;position:fixed;top:112px;left:calc(100% - 256px);width:224px;max-height:calc(100vh - 144px);overflow:auto;scrollbar-width:none;margin:0;padding:0;border:0}
.toc::-webkit-scrollbar{display:none}
}
`
