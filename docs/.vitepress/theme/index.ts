import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import LogoutButton from './LogoutButton.vue'
import ShareButton from './ShareButton.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'doc-before': () => h(ShareButton),
      'nav-bar-content-after': () => h(LogoutButton),
    }),
}
