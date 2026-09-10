import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import axios from 'axios'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'

import './assets/main.scss'

// M3（v1.13.107）：为裸 axios 调用统一加超时保护。
// 背景：项目内仍有部分模块直接用默认 axios 实例（stores/user|marker|competitor|brandIcon、
// 各 View 的零散请求），原先无任何超时 → 上游挂起时请求永久 pending、页面卡死。
// 注意：utils/api.js 的 api 实例自带 timeout(30s)，不受此行影响；导入等长任务另有显式 timeout 覆盖。
axios.defaults.timeout = 30000

const app = createApp(App)

// 注册所有图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')
