<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

const props = defineProps<{ code: string }>()
const { isDark } = useData()
const svg = ref('')
const error = ref('')
let seq = 0

// mermaid only runs in the browser, so load it lazily after mount
async function render() {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, theme: isDark.value ? 'dark' : 'default', securityLevel: 'strict' })
  const id = `mermaid-${Math.random().toString(36).slice(2)}-${seq++}`
  try {
    const result = await mermaid.render(id, decodeURIComponent(props.code))
    svg.value = result.svg
    error.value = ''
  } catch (e) {
    error.value = String(e)
  }
}

onMounted(render)
watch(isDark, render)
</script>

<template>
  <div class="mermaid-block">
    <pre v-if="error" class="mermaid-error">{{ error }}</pre>
    <div v-else v-html="svg" />
  </div>
</template>

<style scoped>
.mermaid-block {
  margin: 16px 0;
  overflow-x: auto;
  text-align: center;
}
/* .vp-doc p 的 margin 和行高会撑开标签，导致 mermaid 量好的节点高度装不下文字 */
.mermaid-block :deep(foreignObject p),
.mermaid-block :deep(foreignObject div),
.mermaid-block :deep(foreignObject span) {
  margin: 0;
  line-height: 1.5;
}
.mermaid-error {
  color: var(--vp-c-danger-1);
  white-space: pre-wrap;
  text-align: left;
}
</style>
