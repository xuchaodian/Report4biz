import { createApp } from 'vue'
import { createPinia } from 'pinia'
// L3（v1.13.108）：图标改为按需命名导入（原为 `import *` 全量 293 个遍历注册 → 无法 tree-shake）。
// 白名单由脚本扫描全部 .vue/.js（含 <el-icon> 跨行写法、:icon 绑定、字符串 icon）生成，共 57 个。
// 注意：命名导入 + 本包 sideEffects:false → Rollup 可剔除未用图标；新增图标时须补入下方白名单。
import {
  Aim, ArrowDown, ArrowLeft, ArrowRight,
  ChatDotRound, ChatLineRound, Check, Close, Collection, Compass, Connection, Coordinate,
  CopyDocument, Crop,
  DataAnalysis, DataBoard, DataLine, Delete, Document, Download,
  Edit, EditPen,
  Flag, FolderAdd, FolderOpened, FullScreen,
  Grid,
  InfoFilled,
  Key,
  Loading, Location, LocationFilled, LocationInformation, Lock,
  MagicStick, MapLocation, Message, Money,
  Odometer,
  Plus, Pointer, Position,
  Refresh, RefreshRight,
  Search, Setting, Shop, Star, SwitchButton,
  TrendCharts,
  Unlock, Upload, UploadFilled, User, UserFilled,
  View, WarningFilled
} from '@element-plus/icons-vue'
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

// 注册白名单图标（按需，见上方 import 注释）
const usedIcons = {
  Aim, ArrowDown, ArrowLeft, ArrowRight,
  ChatDotRound, ChatLineRound, Check, Close, Collection, Compass, Connection, Coordinate,
  CopyDocument, Crop,
  DataAnalysis, DataBoard, DataLine, Delete, Document, Download,
  Edit, EditPen,
  Flag, FolderAdd, FolderOpened, FullScreen,
  Grid,
  InfoFilled,
  Key,
  Loading, Location, LocationFilled, LocationInformation, Lock,
  MagicStick, MapLocation, Message, Money,
  Odometer,
  Plus, Pointer, Position,
  Refresh, RefreshRight,
  Search, Setting, Shop, Star, SwitchButton,
  TrendCharts,
  Unlock, Upload, UploadFilled, User, UserFilled,
  View, WarningFilled
}
for (const [key, component] of Object.entries(usedIcons)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')
