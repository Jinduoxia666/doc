<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useData, withBase } from 'vitepress'

interface Share {
  shared: boolean
  url?: string
  password?: string
}

const API = withBase('/__share/api/shares')
const { page } = useData()
const share = ref<Share | null>(null)
const open = ref(false)
const busy = ref(false)
const error = ref('')
const copied = ref('')

async function call(method: string, url: string, body?: object) {
  busy.value = true
  error.value = ''
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
    share.value = await res.json()
  } catch (e) {
    error.value = `分享服务不可用：${(e as Error).message}`
  } finally {
    busy.value = false
  }
}

const path = () => page.value.relativePath
const load = () => call('GET', `${API}?path=${encodeURIComponent(path())}`)
const create = () => call('POST', API, { path: path() })
const reset = () => confirm('重置后旧密码立即失效，已登录的人需要重新输入。确定？') && call('POST', `${API}/reset`, { path: path() })
const revoke = () => confirm('取消分享后链接将失效。确定？') && call('DELETE', `${API}?path=${encodeURIComponent(path())}`)

// navigator.clipboard 只在 HTTPS / localhost 下可用，通过 http 域名访问时退回 execCommand
function legacyCopy(text: string) {
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(el)
  el.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(el)
  if (!ok) throw new Error('copy failed')
}

async function copy(kind: string, text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text)
    else legacyCopy(text)
  } catch {
    // 兜底：弹出可选中的文本框让用户手动复制
    window.prompt('自动复制失败，请手动复制：', text)
    return
  }
  copied.value = kind
  setTimeout(() => (copied.value = ''), 1500)
}

function toggle() {
  open.value = !open.value
  if (open.value && !share.value) load()
}

// 进入页面和切换文档时都查询分享状态，让按钮直接显示「分享中」
onMounted(load)
watch(() => page.value.relativePath, () => {
  open.value = false
  share.value = null
  load()
})
</script>

<template>
  <div class="share">
    <button class="share-toggle" @click="toggle">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
      分享{{ share?.shared ? '中' : '' }}
    </button>
    <div v-if="open" class="share-panel">
      <p v-if="error" class="share-error">{{ error }}</p>
      <template v-else-if="share?.shared">
        <div class="row"><span>链接</span><code>{{ share.url }}</code><button @click="copy('url', share.url!)">{{ copied === 'url' ? '已复制' : '复制' }}</button></div>
        <div class="row"><span>密码</span><code>{{ share.password }}</code><button @click="copy('pw', share.password!)">{{ copied === 'pw' ? '已复制' : '复制' }}</button></div>
        <div class="row actions">
          <button @click="copy('all', `${share.url}\n访问密码：${share.password}`)">{{ copied === 'all' ? '已复制' : '复制链接和密码' }}</button>
          <button :disabled="busy" @click="reset">重置密码</button>
          <button :disabled="busy" class="danger" @click="revoke">取消分享</button>
        </div>
      </template>
      <template v-else-if="share">
        <p class="hint">生成专属链接和访问密码，别人凭密码只能查看这一篇文档。</p>
        <button :disabled="busy" class="primary" @click="create">生成分享链接</button>
      </template>
      <p v-else class="hint">加载中…</p>
    </div>
  </div>
</template>

<style scoped>
.share { position: relative; display: flex; justify-content: flex-end; margin-bottom: 8px; }
.share-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 2px 12px; font-size: 13px; color: var(--vp-c-text-2); border: 1px solid var(--vp-c-divider); border-radius: 999px; }
.share-toggle:hover { color: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); }
.share-panel { position: absolute; top: 34px; right: 0; z-index: 20; width: min(440px, calc(100vw - 32px)); padding: 14px 16px; background: var(--vp-c-bg-elv); border: 1px solid var(--vp-c-divider); border-radius: 12px; box-shadow: var(--vp-shadow-3); font-size: 14px; }
.row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.row > span { flex: none; color: var(--vp-c-text-2); }
.row code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row button, .primary { flex: none; padding: 2px 10px; font-size: 13px; border: 1px solid var(--vp-c-divider); border-radius: 6px; }
.row button:hover { border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); }
.actions { flex-wrap: wrap; margin: 12px 0 0; }
.primary { background: var(--vp-c-brand-3); color: var(--vp-c-white); border-color: transparent; padding: 4px 14px; }
.danger:hover { color: var(--vp-c-danger-1) !important; border-color: var(--vp-c-danger-1) !important; }
.hint { margin: 0 0 12px; color: var(--vp-c-text-2); }
.share-error { margin: 0; color: var(--vp-c-danger-1); }
button:disabled { opacity: .5; cursor: not-allowed; }
</style>
