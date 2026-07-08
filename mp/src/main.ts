import { createSSRApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
import '@tdesign/uniapp/theme.less'
import './styles/tdesign-theme.less'

export function createApp() {
  const app = createSSRApp(App)
  return {
    app,
  }
}
