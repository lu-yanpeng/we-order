import { createSSRApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
import './styles/tdesign.less'

export function createApp() {
  const app = createSSRApp(App)
  return {
    app,
  }
}
