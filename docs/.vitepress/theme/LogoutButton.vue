<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { withBase } from 'vitepress'

// 本地开发（localhost）免登录，不显示退出按钮
const show = ref(false)
onMounted(() => (show.value = !['localhost', '127.0.0.1'].includes(location.hostname)))
// 用整页跳转而不是 <a>，避免被 VitePress 路由当作站内页面拦截
const logout = () => (location.href = withBase('/__logout'))
</script>

<template>
  <button v-if="show" class="logout" title="退出登录" @click="logout">退出</button>
</template>

<style scoped>
.logout { margin-left: 12px; padding: 2px 10px; font-size: 13px; color: var(--vp-c-text-2); border: 1px solid var(--vp-c-divider); border-radius: 999px; }
.logout:hover { color: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); }
</style>
