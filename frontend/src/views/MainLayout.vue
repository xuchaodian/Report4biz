<template>
  <div class="main-layout">
    <!-- 顶部导航栏 -->
    <header class="header">
      <div class="header-left">
        <img src="@/assets/logo.png" alt="Logo" class="header-logo">
        <h1 class="logo-text">选址赢家Online</h1>
      </div>
      
      <nav class="nav-menu">
        <router-link to="/" class="nav-item" :class="{ active: $route.path === '/' }">
          <el-icon><MapLocation /></el-icon>
          <span>{{ $t('nav.map') }}</span>
        </router-link>
        <router-link to="/data" class="nav-item" :class="{ active: $route.path === '/data' }">
          <el-icon><DataAnalysis /></el-icon>
          <span>{{ $t('nav.myStores') }}</span>
        </router-link>
        <router-link to="/competitors" class="nav-item" :class="{ active: $route.path === '/competitors' }">
          <el-icon><DataLine /></el-icon>
          <span>{{ $t('nav.competitors') }}</span>
        </router-link>
        <router-link v-if="userStore.isAdmin" to="/brand-stores" class="nav-item" :class="{ active: $route.path === '/brand-stores' }">
          <el-icon><MapLocation /></el-icon>
          <span>{{ $t('nav.brandStores') }}</span>
        </router-link>
        <router-link to="/shopping-centers" class="nav-item" :class="{ active: $route.path === '/shopping-centers' }">
          <el-icon><Shop /></el-icon>
          <span>{{ $t('nav.shoppingCenters') }}</span>
        </router-link>
        <router-link to="/shapefiles" class="nav-item" :class="{ active: $route.path === '/shapefiles' }">
          <el-icon><Document /></el-icon>
          <span>{{ $t('nav.statistics') }}</span>
        </router-link>
        <el-dropdown trigger="hover" class="nav-item nav-dropdown" :class="{ active: $route.path.startsWith('/market-map') }">
          <span class="nav-dropdown-trigger">
            <el-icon><Compass /></el-icon>
            <span>{{ $t('nav.siteWorkbench') }}</span>
            <el-icon class="nav-dropdown-arrow"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item :class="{ 'dd-active': $route.path === '/market-map' }" @click="$router.push('/market-map')">
                <el-icon><LocationInformation /></el-icon>城市洞察
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <router-link v-if="userStore.isAdmin" to="/users" class="nav-item" :class="{ active: $route.path === '/users' }">
          <el-icon><User /></el-icon>
          <span>{{ $t('nav.users') }}</span>
        </router-link>
        <router-link v-if="userStore.isAdmin" to="/resale" class="nav-item" :class="{ active: $route.path === '/resale' }">
          <el-icon><Key /></el-icon>
          <span>{{ $t('nav.apiOpen') }}</span>
        </router-link>
        <router-link to="/dashboard" class="nav-item nav-item-right dashboard-nav" :class="{ active: $route.path === '/dashboard' }">
          <el-icon><DataBoard /></el-icon>
          <span>{{ $t('nav.dashboard') }}</span>
        </router-link>
      </nav>

      <div class="header-right">
        <!-- 语言切换 -->
        <el-dropdown trigger="click" @command="(lang) => setAppLocale(lang)" class="lang-switch">
          <span class="lang-trigger">
            <el-icon><ChatLineRound /></el-icon>
            <span>{{ locale === 'ja' ? '日本語' : '中文' }}</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="zh">中文</el-dropdown-item>
              <el-dropdown-item command="ja">日本語</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown @command="handleCommand" @visible-change="handleDropdownVisible">
          <span class="user-info">
            <el-avatar :size="32" :icon="UserFilled" />
            <span class="username">{{ userStore.username }}</span>
            <el-icon class="arrow"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="profile">
                <el-icon><User /></el-icon>个人中心
              </el-dropdown-item>
              <el-dropdown-item command="brands">
                <el-icon><Setting /></el-icon>设置图标
              </el-dropdown-item>
              <el-dropdown-item v-if="userStore.isAdmin" command="template">
                <el-icon><Upload /></el-icon>设置模板
              </el-dropdown-item>
              <el-dropdown-item command="purchase">
                <el-icon><Document /></el-icon>购买履历
              </el-dropdown-item>
              <el-dropdown-item command="export">
                <el-icon><Download /></el-icon>导出报表
              </el-dropdown-item>
              <li class="quota-dropdown-item" @click.stop>
                <div class="quota-dropdown-row">
                  <el-icon style="color:#409eff;"><Odometer /></el-icon>
                  <span v-if="quotaLoading" class="quota-value" style="color:#909399;">加载中...</span>
                  <span v-else-if="userStore.quota" class="quota-value">剩余 <b style="color:#409eff;">{{ userStore.availableQuota }}</b> 次</span>
                  <span v-else class="quota-value" style="color:#f56c6c;">--</span>
                </div>
              </li>
              <el-dropdown-item command="logout" divided>
                <el-icon><SwitchButton /></el-icon>退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>
    
    <!-- 新手引导（顶部引导条 + 首次使用向导） -->
    <OnboardingGuide />

    <!-- 主体内容区 -->
    <main class="main-content">
      <router-view />
    </main>

    <!-- 上传模板对话框 -->
    <el-dialog v-model="templateDialogVisible" title="上传Excel报表模板" width="500px">
      <div class="template-upload-tips">
        <p>请上传 .xlsx 格式的Excel报表模板文件，该模板将用于门店购买数据的Excel导出。</p>
        <p style="margin-top:8px;color:#999;font-size:12px;">上传后将覆盖现有模板，建议先下载当前模板备份。</p>
      </div>
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".xlsx"
        :on-change="handleTemplateFileChange"
        drag
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">仅支持 .xlsx 格式，最大10MB</div>
        </template>
      </el-upload>
      <template #footer>
        <el-button :loading="templateDownloading" @click="handleTemplateDownload">
          <el-icon style="margin-right:4px;"><Download /></el-icon>下载当前模板
        </el-button>
        <el-button @click="templateDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="templateUploading" @click="handleTemplateUpload">确定上传</el-button>
      </template>
    </el-dialog>

    <!-- 导出报表对话框 -->
    <el-dialog v-model="exportDialogVisible" title="📊 导出报表" width="900px" :close-on-click-modal="false">
      <div class="export-dialog-tips" style="margin-bottom:10px;font-size:12px;color:#909399;">
        勾选要导出的购买记录（可多选），然后选择导出格式
      </div>
      <el-table
        ref="exportTableRef"
        :data="exportList"
        stripe
        border
        style="width:100%"
        max-height="420"
        @selection-change="handleExportSelectionChange"
      >
        <el-table-column type="selection" width="45" fixed />
        <el-table-column label="订单ID" width="170" fixed>
          <template #default="{ row }">
            <span style="font-size:12px;white-space:nowrap;">{{ row.order_no || row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="门店名称" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="white-space:nowrap;">{{ row.store_name || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="购买时间" width="150">
          <template #default="{ row }">
            <span style="white-space:nowrap;">{{ row.created_at ? String(row.created_at).slice(0, 16) : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="城市" width="100">
          <template #default="{ row }">
            <span style="white-space:nowrap;">{{ row.city || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="数据年月" width="100">
          <template #default="{ row }">
            <span style="white-space:nowrap;">{{ row.city_month || '-' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div style="margin-top:10px;font-size:12px;color:#606266;">
        已选 <b style="color:#409eff;">{{ exportSelected.length }}</b> 条记录
      </div>
      <template #footer>
        <el-button @click="exportDialogVisible = false">取消</el-button>
        <el-button type="success" :loading="exportLoading" @click="doExport('excel')">📊 导出Excel</el-button>
        <el-button type="danger" :loading="exportLoading" @click="doExport('pdf')">📄 导出PDF</el-button>
        <el-button type="primary" :loading="exportLoading" @click="doExport('both')">导出Excel+PDF</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { captureMapToCanvas, captureMapOnlyCanvas, captureShoppingCenterMap } from '@/utils/mapCapture'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { setAppLocale } from '@/i18n'
import { MapLocation, DataAnalysis, DataLine, Shop, User, UserFilled, SwitchButton, ArrowDown, Setting, Document, Upload, Odometer, Download, Key, DataBoard, ChatLineRound } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

const { locale } = useI18n()
import OnboardingGuide from '@/components/guide/OnboardingGuide.vue'
import axios from 'axios'

const router = useRouter()
const userStore = useUserStore()

// 配额显示
const quotaLoading = ref(false)
const handleDropdownVisible = (visible) => {
  if (visible) refreshQuota()
}
const refreshQuota = async () => {
  quotaLoading.value = true
  try {
    await userStore.fetchQuota()
  } catch (_) {} finally {
    quotaLoading.value = false
  }
}

// 模板上传
const templateDialogVisible = ref(false)
const templateUploading = ref(false)
const templateDownloading = ref(false)
const uploadRef = ref(null)
const templateFile = ref(null)

const handleTemplateFileChange = (file) => {
  templateFile.value = file.raw
}

// 下载当前系统里的模板
const handleTemplateDownload = async () => {
  templateDownloading.value = true
  try {
    const res = await axios.get('/api/template/download', { responseType: 'blob' })
    // 后端返回 JSON 错误（模板不存在时）
    if (res.data.type === 'application/json') {
      const text = await res.data.text()
      let msg = '模板不存在'
      try { msg = JSON.parse(text).message || msg } catch (_) {}
      ElMessage.error(msg)
      return
    }
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'report_template.xlsx'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    ElMessage.success('模板下载成功')
  } catch (e) {
    ElMessage.error('下载失败，请确认系统已上传模板')
  } finally {
    templateDownloading.value = false
  }
}

const handleTemplateUpload = async () => {
  if (!templateFile.value) {
    ElMessage.warning('请选择文件')
    return
  }
  templateUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', templateFile.value)
    const { data } = await axios.post('/api/template/upload', formData)
    ElMessage.success(data.message || '模板上传成功')
    templateDialogVisible.value = false
    templateFile.value = null
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '上传失败')
  } finally {
    templateUploading.value = false
  }
}

onMounted(() => {
  userStore.fetchUser()
})

const handleCommand = async (command) => {
  if (command === 'profile') {
    router.push('/account')
  } else if (command === 'brands') {
    router.push('/brands')
  } else if (command === 'template') {
    templateDialogVisible.value = true
  } else if (command === 'purchase') {
    // 跳转到个人中心并自动打开购买履历
    router.push('/account?openHistory=true')
  } else if (command === 'export') {
    openExportDialog()
  } else if (command === 'logout') {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      type: 'warning'
    })
    userStore.logout()
    router.push('/login')
  }
}

// ===== 导出报表对话框 =====
const exportDialogVisible = ref(false)
const exportList = ref([])
const exportSelected = ref([])
const exportLoading = ref(false)
const exportTableRef = ref(null)

const openExportDialog = async () => {
  exportDialogVisible.value = true
  exportList.value = []
  exportSelected.value = []
  try {
    const { data } = await axios.get('/api/purchase/history')
    exportList.value = data.purchases || []
  } catch (e) {
    console.error('加载购买记录失败:', e)
    ElMessage.error('加载购买记录失败')
  }
}

const handleExportSelectionChange = (selection) => {
  exportSelected.value = selection
}

// 下载 blob 文件
const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(new Blob([blob]))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

// 获取导出文件名（优先从 content-disposition 解析）
const parseFileName = (response, fallback) => {
  const disposition = response.headers['content-disposition']
  if (disposition) {
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
    if (match) return decodeURIComponent(match[1])
  }
  return fallback
}

// 导出单条记录（type: excel / pdf / both）
const exportOneRecord = async (row, type) => {
  const id = row.id
  // 拉取详情
  const detail = (await axios.get(`/api/purchase/${id}`)).data

  // 截图（复用个人中心挂载的截图函数，未挂载时回退无截图导出）
  let competitorScreenshot = null
  let shoppingCenterScreenshot = null
  let mapScreenshot = null
  try {
    const [compResp, shopResp] = await Promise.all([
      axios.get(`/api/purchase/${id}/competitors-for-map`),
      axios.get(`/api/purchase/${id}/shopping-centers-for-map`)
    ])
    const mapData = compResp.data
    const centerLat = mapData.center.lat
    const centerLng = mapData.center.lng
    competitorScreenshot = await captureMapToCanvas(centerLat, centerLng, 3000, mapData.competitors || [], 14)
    try {
      const centerList = (shopResp.data.centers && Array.isArray(shopResp.data.centers)) ? shopResp.data.centers : []
      shoppingCenterScreenshot = await captureShoppingCenterMap(centerLat, centerLng, centerList, 14)
    } catch (scErr) { console.warn('购物中心截图失败:', scErr) }
    try {
      const actualRadius = Array.isArray(detail.radii) ? detail.radii[0] : 3000
      mapScreenshot = await captureMapOnlyCanvas(centerLat, centerLng, actualRadius)
    } catch (mErr) { console.warn('地图截图失败:', mErr) }
  } catch (mapErr) {
    console.warn('地图数据获取失败:', mapErr)
  }

  const radiiStr = Array.isArray(detail.radii) ? detail.radii.join('_') + '米' : (detail.radii || '未知') + '米'
  const baseName = `${detail.store_name || '门店'}_${radiiStr}_${detail.city_month || ''}`

  // Excel
  if (type === 'excel' || type === 'both') {
    let response
    if (competitorScreenshot || shoppingCenterScreenshot) {
      response = await axios.post(`/api/purchase/${id}/export-map-excel`, {
        competitorScreenshot, shoppingCenterScreenshot, mapScreenshot
      }, { responseType: 'blob' })
    } else {
      response = await axios.get(`/api/purchase/${id}/export-excel`, { responseType: 'blob' })
    }
    downloadBlob(response.data, parseFileName(response, `${baseName}_商圈数据.xlsx`))
  }

  // PDF
  if (type === 'pdf' || type === 'both') {
    const response = await axios.post(`/api/purchase/${id}/export-pdf-report`, {
      competitorScreenshot, shoppingCenterScreenshot, mapScreenshot,
      filename: `${baseName}_报表`
    }, { responseType: 'blob' })
    downloadBlob(response.data, parseFileName(response, `${baseName}_报表.pdf`))
  }
}

const doExport = async (type) => {
  if (exportSelected.value.length === 0) {
    ElMessage.warning('请先勾选要导出的记录')
    return
  }
  exportLoading.value = true
  try {
    ElMessage.info(`正在导出 ${exportSelected.value.length} 条记录，请稍候...`)
    for (const row of exportSelected.value) {
      await exportOneRecord(row, type)
    }
    ElMessage.success(`导出完成，共 ${exportSelected.value.length} 条${type === 'both' ? '（每条含Excel+PDF）' : ''}`)
  } catch (e) {
    console.error('导出失败:', e)
    ElMessage.error('导出失败: ' + (e.response?.data?.message || e.message))
  } finally {
    exportLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.main-layout {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.header {
  height: var(--header-height);
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  padding: 0 20px;
  z-index: 100;
  
  .header-left {
    width: var(--sidebar-width);
    display: flex;
    align-items: center;

    .header-logo {
      width: auto;
      height: 30px;
      margin-right: 8px;
    }
    
    .logo-text {
      font-size: 14px;
      font-weight: 600;
      color: #333;
      white-space: nowrap;
    }
  }
  
  .nav-menu {
    flex: 1;
    display: flex;
    gap: 10px;
    
    .nav-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;  /* 原 16px，左右各缩 4px，给加粗的数据大屏留空间 */
      border-radius: 6px;
      text-decoration: none;
      color: #666;
      font-size: 14px;
      transition: all 0.3s;
      white-space: nowrap;
      
      &:hover {
        background: #f5f7fa;
        color: #409eff;
      }
      
      &.active {
        background: #ecf5ff;
        color: #409eff;
      }

      &.nav-item-right {
        margin-left: auto;  /* 数据大屏单独靠右，作为「决策/展示」类放最右 */
      }

      /* 数据大屏：默认透明（与普通导航项一致），hover 才显示暗色胶囊 */
      &.dashboard-nav {
        color: #666;
        font-weight: 600;  /* 加粗，突出数据大屏入口 */
        padding: 7px 12px;  /* 横向与普通项一致(12px) */
        border: 1px solid transparent;
        background: transparent;
      }
      &.dashboard-nav:hover {
        color: #d6e6ff;
        border-color: rgba(64, 196, 255, 0.5);
        background: linear-gradient(160deg, #1a2f4d 0%, #12233d 100%);
      }
      &.dashboard-nav.active {
        color: #ffffff;
        border-color: #40c4ff;
        background: linear-gradient(160deg, #1e3a5f 0%, #16304d 100%);
        box-shadow: 0 0 10px rgba(64, 196, 255, 0.25);
      }
      &.dashboard-nav .el-icon {
        color: #40c4ff;
        font-size: 17px;  /* 图标放大(普通14px)更显眼，但 18px 会让 admin 视角溢出 */
      }
    }

    .nav-dropdown {
      display: flex;
      align-items: center;
      cursor: pointer;

      .nav-dropdown-trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        border-radius: 6px;
        color: #666;
        font-size: 14px;
        transition: all 0.3s;
      }

      &:hover .nav-dropdown-trigger {
        background: #f5f7fa;
        color: #409eff;
      }

      &.active .nav-dropdown-trigger {
        background: #ecf5ff;
        color: #409eff;
      }

      .nav-dropdown-arrow {
        font-size: 12px;
        margin-left: -2px;
      }
    }
  }
  
  .header-right {
    .lang-switch {
      margin-right: 8px;
    }
    .lang-trigger {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 13px;
      color: #606266;
      border: 1px solid #dcdfe6;
      border-radius: 6px;
      padding: 5px 10px;
      cursor: pointer;
      transition: all 0.2s;
      &:hover {
        color: #409eff;
        border-color: #409eff;
      }
    }
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      
      &:hover {
        background: #f5f7fa;
      }
      
      .username {
        font-size: 14px;
        color: #333;
      }
      
      .arrow {
        font-size: 12px;
        color: #999;
      }
    }
  }
}

.main-content {
  flex: 1;
  overflow: hidden;
}

/* 配额显示项（下拉菜单渲染在body下，需全局样式） */
.quota-dropdown-item {
  padding: 8px 16px;
  cursor: default;
  border-bottom: 1px solid #f0f2f5;
  background: #fff;
  list-style: none;
}
.quota-dropdown-item:hover {
  background: #f5f7fa;
}
.quota-dropdown-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.quota-label {
  font-size: 12px;
  color: #606266;
  font-weight: 600;
}
.quota-value {
  font-size: 13px;
  color: #333;
}

.template-upload-tips {
  margin-bottom: 20px;
  padding: 15px;
  background: #f5f7fa;
  border-radius: 4px;
  p { margin: 0; font-size: 14px; color: #666; }
}
</style>
