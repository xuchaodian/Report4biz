<template>
  <div class="main-layout">
    <!-- L9（v1.13.175 A 档）跳到主内容：键盘/读屏用户按 Tab 的首个焦点即命中，
         一跳跳过顶栏全部导航直达 <main id="main-content">。
         ⛔ 必须是最外层第一个可聚焦元素，插在 <header> 之前 -->
    <a class="skip-link" href="#main-content">跳到主内容</a>

    <!-- 顶部导航栏 -->
    <header class="header">
      <div class="header-left">
        <img src="@/assets/logo.png" alt="Logo" class="header-logo">
        <h1 class="logo-text">选址赢家Online</h1>
      </div>
      
      <nav class="nav-menu">
        <router-link to="/" class="nav-item" :class="{ active: $route.path === '/' }" :aria-current="$route.path === '/' ? 'page' : undefined">
          <el-icon><MapLocation /></el-icon>
          <span>{{ $t('nav.map') }}</span>
        </router-link>
        <router-link to="/data" class="nav-item" :class="{ active: $route.path === '/data' }" :aria-current="$route.path === '/data' ? 'page' : undefined">
          <el-icon><DataAnalysis /></el-icon>
          <span>{{ $t('nav.myStores') }}</span>
        </router-link>
        <router-link to="/competitors" class="nav-item" :class="{ active: $route.path === '/competitors' }" :aria-current="$route.path === '/competitors' ? 'page' : undefined">
          <el-icon><DataLine /></el-icon>
          <span>{{ $t('nav.competitors') }}</span>
        </router-link>
        <router-link v-if="userStore.isAdmin" to="/brand-stores" class="nav-item" :class="{ active: $route.path === '/brand-stores' }" :aria-current="$route.path === '/brand-stores' ? 'page' : undefined">
          <el-icon><MapLocation /></el-icon>
          <span>{{ $t('nav.brandStores') }}</span>
        </router-link>
        <router-link to="/shopping-centers" class="nav-item" :class="{ active: $route.path === '/shopping-centers' }" :aria-current="$route.path === '/shopping-centers' ? 'page' : undefined">
          <el-icon><Shop /></el-icon>
          <span>{{ $t('nav.shoppingCenters') }}</span>
        </router-link>
        <router-link to="/shapefiles" class="nav-item" :class="{ active: $route.path === '/shapefiles' }" :aria-current="$route.path === '/shapefiles' ? 'page' : undefined">
          <el-icon><Document /></el-icon>
          <span>{{ $t('nav.statistics') }}</span>
        </router-link>
        <!-- trigger=click（非默认 hover）：触屏/共享终端上 hover 常需点两次才展开，
             与右上角个人下拉保持一致 -->
        <el-dropdown trigger="click" class="nav-item nav-dropdown" :class="{ active: $route.path.startsWith('/market-map') }">
          <span class="nav-dropdown-trigger" :aria-current="$route.path.startsWith('/market-map') ? 'page' : undefined">
            <el-icon><Compass /></el-icon>
            <span>{{ $t('nav.siteWorkbench') }}</span>
            <el-icon class="nav-dropdown-arrow"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item :class="{ 'dd-active': $route.path === '/market-map' }" @click="$router.push('/market-map')">
                <el-icon><LocationInformation /></el-icon>{{ $t('nav.cityInsight') }}
              </el-dropdown-item>
              <el-dropdown-item :class="{ 'dd-active': $route.path === '/district-insight' }" @click="$router.push('/district-insight')">
                <el-icon><Shop /></el-icon>{{ $t('nav.districtInsight') }}
              </el-dropdown-item>
              <!-- v1.13.209：销售预测升为 VIP 专属。非 VIP 显示 🔒VIP 角标
                   （判据与「AI 选址建议 / 开店余地 / 网点优化」共用 userStore.isVipActive，
                    切勿就地写 role 判等 —— backend/tests/vipGateGuard.test.js 会判红） -->
              <el-dropdown-item :class="{ 'dd-active': $route.path === '/sales-forecast' }" @click="$router.push('/sales-forecast')">
                <el-icon><TrendCharts /></el-icon>{{ $t('nav.salesForecast') }}
                <span v-if="!userStore.isVipActive" class="vip-only-tag">🔒VIP</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <router-link to="/dashboard" class="nav-item nav-item-right dashboard-nav" :class="{ active: $route.path === '/dashboard' }" :aria-current="$route.path === '/dashboard' ? 'page' : undefined">
          <el-icon><DataBoard /></el-icon>
          <span>{{ $t('nav.dashboard') }}</span>
        </router-link>
      </nav>

      <div class="header-right">
        <!-- trigger=click：EP 默认是 hover，触屏/共享终端上「点一下」只会触发 hover 状态、
             需再点一次才展开（用户反馈的现象）；click 模式一次点击即展开，且点击外部关闭由 EP 内置处理 -->
        <el-dropdown trigger="click" @command="handleCommand" @visible-change="handleDropdownVisible">
          <span class="user-info">
            <!-- v1.13.160：走 store 的 effectiveLogo —— 子公司账号无自有 Logo 时
                 自动显示所属集团的品牌 Logo（父级需求：子公司无需重复上传） -->
            <el-avatar v-if="userStore.effectiveLogo" :size="32" :src="userStore.effectiveLogo" alt="" />
            <el-avatar v-else :size="32" :icon="UserFilled" class="avatar-fallback" />
            <span class="username">{{ userStore.username }}</span>
            <el-icon class="arrow"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <!-- 管理员专属入口：置顶 + 蓝色底与下方常规项区分 -->
              <el-dropdown-item v-if="userStore.isAdmin" command="users" class="dd-admin-item">
                <el-icon><User /></el-icon>{{ $t('nav.users') }}
                <!-- v1.13.205：待处理 VIP 试用申请的红点计数（与 /users 页提示条同一接口）
                     v1.13.218：与「配额采购申请」**合并计数**（两者入口都在 /users 页） -->
                <span
                  v-if="pendingDotCount > 0"
                  class="dd-pending-dot"
                  :title="pendingDotTitle"
                >{{ pendingDotCount > 99 ? '99+' : pendingDotCount }}</span>
              </el-dropdown-item>
              <el-dropdown-item v-if="userStore.isAdmin" command="resale" class="dd-admin-item">
                <el-icon><Key /></el-icon>{{ $t('nav.apiOpen') }}
              </el-dropdown-item>
              <el-dropdown-item command="profile" :divided="userStore.isAdmin">
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
              <!-- 用户手册（2026-10-17）：独立静态页 /help/，与 SPA 路由无关。
                   ⛔ 必须走 window.open / 原生跳转，不可 router.push —— 它不在路由表里，
                      会被 catch-all 抓成 404（同 404 页指 /home/ 那次的性质）。 -->
              <el-dropdown-item command="help">
                <el-icon><Reading /></el-icon>使用帮助
              </el-dropdown-item>
              <!-- v1.13.261：意见反馈（常规入口）。另一个入口在场景引导面板里，
                   那个会带上「卡在第几步」的上下文 -->
              <el-dropdown-item command="feedback">
                <el-icon><ChatDotRound /></el-icon>意见反馈
              </el-dropdown-item>
              <!-- 仅集团账号（总部 / 子公司）可见：不属于任何集团时该页只有空态，没必要展示入口 -->
              <el-dropdown-item v-if="userStore.hasOrg" command="dataSync">
                <el-icon><RefreshRight /></el-icon>数据同步
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
    <main id="main-content" class="main-content" tabindex="-1">
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
    <el-dialog v-model="exportDialogVisible" width="900px" :close-on-click-modal="false">
      <template #header>
        <span class="dlg-title"><AppIcon><Document /></AppIcon>导出报表</span>
      </template>
      <div class="export-dialog-tips" style="margin-bottom:10px;font-size:12px;color:#909399;">
        勾选要导出的购买记录（可多选），然后选择导出格式
      </div>
      <!-- v1.13.156 集团可见域：本公司有多个账号时提供「来源」筛选 -->
      <div v-if="exportSourceOptions.length > 1" class="export-source-bar" style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:12px;color:#606266;">数据来源</span>
        <el-select
          v-model="exportSourceFilter"
          size="small"
          style="width:200px"
          aria-label="按数据来源筛选购买记录"
          @change="handleExportSourceChange"
        >
          <el-option label="全部来源" value="all" />
          <el-option
            v-for="s in exportSourceOptions"
            :key="s.userId"
            :label="s.isSelf ? '本账号' : s.name"
            :value="s.userId"
          />
        </el-select>
        <el-tag v-if="exportPullOffNames.length" type="warning" size="small" effect="plain">
          已关闭共享：{{ exportPullOffNames.join('、') }}
        </el-tag>
      </div>
      <el-table
        ref="exportTableRef"
        :data="exportListShown"
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
        <el-table-column v-if="exportSourceOptions.length > 1" label="来源" width="120" fixed>
          <template #default="{ row }">
            <el-tag v-if="row.is_self" size="small" effect="plain" type="info">本账号</el-tag>
            <el-tag v-else size="small" effect="plain" type="success">{{ row.owner_name || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="门店名称" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="white-space:nowrap;">{{ row.store_name || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="购买时间" width="110">
          <template #default="{ row }">
            <span style="white-space:nowrap;">{{ row.created_at ? String(row.created_at).slice(0, 10) : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="城市" width="90">
          <template #default="{ row }">
            <span style="white-space:nowrap;">{{ row.city || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="半径" width="120">
          <template #default="{ row }">
            <span style="white-space:nowrap;">{{ row.radius_display || (row.radius ? row.radius + '米' : '-') }}</span>
          </template>
        </el-table-column>
        <el-table-column label="数据年月" width="90">
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
        <el-button type="success" :loading="exportLoading" @click="doExport('excel')"><AppIcon class="icon-text"><Document /></AppIcon>导出Excel</el-button>
        <el-button type="danger" :loading="exportLoading" @click="doExport('pdf')"><AppIcon class="icon-text"><DocumentCopy /></AppIcon>导出PDF</el-button>
        <el-button type="primary" :loading="exportLoading" @click="doExport('both')">导出Excel+PDF</el-button>
      </template>
    </el-dialog>

    <!-- 意见反馈（v1.13.261）：从用户下拉菜单打开，无场景上下文 -->
    <FeedbackDialog v-model="feedbackVisible" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { captureMapToCanvas, captureMapOnlyCanvas, captureShoppingCenterMap } from '@/utils/mapCapture'
import { useRouter } from 'vue-router'
import { MapLocation, DataAnalysis, DataLine, Shop, User, UserFilled, SwitchButton, ArrowDown, Setting, Document, DocumentCopy, Upload, Odometer, Download, Key, DataBoard, TrendCharts, RefreshRight, Reading, ChatDotRound } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import OnboardingGuide from '@/components/guide/OnboardingGuide.vue'
import FeedbackDialog from '@/components/FeedbackDialog.vue'
import axios from 'axios'

const router = useRouter()
const userStore = useUserStore()

// 配额显示
const quotaLoading = ref(false)
const handleDropdownVisible = (visible) => {
  if (!visible) return
  refreshQuota()
  // 组织归属：首屏已预热，这里再静默复验一次，让「刚被绑定/解绑集团」立刻反映到菜单
  userStore.fetchOrgRole(true)
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

// ===== v1.13.205：VIP 试用申请入口红点（管理端）=====
const vipPendingCount = ref(0)
let vipPendingTimer = null

/**
 * 待处理 VIP 试用申请数量 —— 个人下拉「用户管理」旁的红点。
 * 接口本身已 requireAdmin；此处再守一道，普通账号不必白发一次必然 403 的请求。
 * 读不到就按 0 处理（辅助信息，绝不打断主流程）。
 * ⚠️ 必须等 fetchUser 落地后再判 isAdmin —— 否则此刻 user 还是 null，红点永远拉不到。
 *    （fetchUser 内部已 try/catch，不会 reject，故 .then 必定执行）
 */
const fetchVipPendingCount = async () => {
  if (!userStore.isAdmin) return
  try {
    const { data } = await axios.get('/api/vip-applications/pending-count')
    vipPendingCount.value = Number(data?.pendingCount) || 0
  } catch (e) {
    vipPendingCount.value = 0
  }
}

// ★ v1.13.218：配额采购申请的同款计数（独立接口，独立数据源）。
//   两者入口都在 /users 页，故红点**合并计数**，但 title 分开说清楚分别有几条。
const quotaPendingCount = ref(0)

const fetchQuotaPendingCount = async () => {
  if (!userStore.isAdmin) return
  try {
    const { data } = await axios.get('/api/quota-requests/pending-count')
    quotaPendingCount.value = Number(data?.pendingCount) || 0
  } catch (e) {
    quotaPendingCount.value = 0
  }
}

/** 红点总数 = VIP 试用申请 ＋ 配额采购申请 */
const pendingDotCount = computed(() => vipPendingCount.value + quotaPendingCount.value)
/** 分开描述（避免管理员以为全是同一件事），仅计数 > 0 的项才出现在提示里 */
const pendingDotTitle = computed(() => {
  const parts = []
  if (vipPendingCount.value > 0) parts.push(`${vipPendingCount.value} 条 VIP 试用申请`)
  if (quotaPendingCount.value > 0) parts.push(`${quotaPendingCount.value} 条配额采购申请`)
  return parts.length ? `${parts.join(' + ')}待处理` : '暂无待处理'
})

/** 一次拉两路（onMounted / 轮询 / 可见性补拉 共用） */
const fetchPendingCounts = () => Promise.all([fetchVipPendingCount(), fetchQuotaPendingCount()])

// ★ v1.13.210：刷新时机修复。
//   旧版只在 onMounted 拉一次 ⇒ 用户（别人）提交新申请后，管理员停在页面上**看不到红点**，
//   必须手动刷新整个页面。补两路：
//     ① 每 60s 轮询兜底（`pending-count` 是本地库的轻量 COUNT，无第三方费用、无副作用）；
//     ② 标签页从后台恢复可见时立即补拉一次（避免"刚切回来还要等一个 tick"）。
//   ⛔ 页面隐藏期间不发请求（document.hidden 早退）；组件卸载必须清定时器与监听，防泄漏。
const VIP_PENDING_POLL_MS = 60000

/** visibilitychange 处理器（命名以便卸载时精确移除） */
const handleVisibilityForVip = () => {
  if (!document.hidden) fetchPendingCounts()
}

onMounted(() => {
  userStore.fetchUser().then(fetchPendingCounts)
  // 预热组织归属，决定个人下拉里「数据同步」入口是否显示
  userStore.fetchOrgRole()

  vipPendingTimer = setInterval(() => {
    if (document.hidden) return
    fetchPendingCounts()
  }, VIP_PENDING_POLL_MS)
  document.addEventListener('visibilitychange', handleVisibilityForVip)
})

onBeforeUnmount(() => {
  if (vipPendingTimer) {
    clearInterval(vipPendingTimer)
    vipPendingTimer = null
  }
  document.removeEventListener('visibilitychange', handleVisibilityForVip)
})

const feedbackVisible = ref(false)

const handleCommand = async (command) => {
  if (command === 'users') {
    router.push('/users')
  } else if (command === 'resale') {
    router.push('/resale')
  } else if (command === 'profile') {
    router.push('/account')
  } else if (command === 'brands') {
    router.push('/brands')
  } else if (command === 'template') {
    templateDialogVisible.value = true
  } else if (command === 'purchase') {
    // 跳转到个人中心并自动打开购买履历
    router.push('/account?openHistory=true')
  } else if (command === 'feedback') {
    feedbackVisible.value = true
  } else if (command === 'help') {
    // 打开用户手册静态页（新标签），不走 vue-router
    window.open('/help/', '_blank', 'noopener')
  } else if (command === 'export') {
    openExportDialog()
  } else if (command === 'dataSync') {
    router.push('/data-sync')
  } else if (command === 'logout') {
    // 取消「确认」会 reject（'cancel' / 'close'）——必须吞掉，否则控制台留 unhandled rejection
    try {
      await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
        type: 'warning'
      })
    } catch (e) {
      return
    }
    // v1.13.150：logout 现在会先请求服务端撤销本设备 token（失败也照样清本地），
    // 故必须 await 完再跳转，避免请求还在路上页面就卸载了
    await userStore.logout()
    router.push('/login')
  }
}

// ===== 导出报表对话框 =====
const exportDialogVisible = ref(false)
const exportList = ref([])
const exportSelected = ref([])
const exportLoading = ref(false)
const exportTableRef = ref(null)

/**
 * v1.13.156 集团可见域：集团账号的购买履历里混有**子公司**的记录。
 * · `exportSourceOptions` —— 后端 `GET /api/purchase/history` 回传的 sources（>1 才展示筛选/来源列）
 * · `exportSourceFilter`  —— 'all' 或某个 userId
 * · `exportPullOffNames`  —— 已关闭「允许集团拉取」的子公司（其数据刻意不在可见域内，需明示，
 *                            否则集团会以为"子公司还没买"，而不是"子公司不让看"）
 */
const exportSourceOptions = ref([])
const exportSourceFilter = ref('all')
const exportPullOffNames = ref([])
const exportListShown = computed(() => {
  if (exportSourceFilter.value === 'all') return exportList.value
  return exportList.value.filter(r => Number(r.owner_user_id) === Number(exportSourceFilter.value))
})
const handleExportSourceChange = () => {
  // 筛选变化后原勾选可能已不可见 ⇒ 清空选择，避免导出到"看不见的行"
  exportTableRef.value?.clearSelection?.()
  exportSelected.value = []
}

const openExportDialog = async () => {
  exportDialogVisible.value = true
  exportList.value = []
  exportSelected.value = []
  exportSourceOptions.value = []
  exportSourceFilter.value = 'all'
  exportPullOffNames.value = []
  try {
    const { data } = await axios.get('/api/purchase/history')
    exportList.value = data.purchases || []
    exportSourceOptions.value = Array.isArray(data.sources) ? data.sources : []
    exportPullOffNames.value = Array.isArray(data.blockedByPullOff)
      ? data.blockedByPullOff.map(x => x.name).filter(Boolean)
      : []
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
  // v1.13.156：导出子公司的记录时，文件名带上来源，避免多个子公司同名门店的报表互相覆盖
  const ownerPrefix = (detail.is_self === false && detail.owner_name) ? `${detail.owner_name}_` : ''
  const baseName = `${ownerPrefix}${detail.store_name || '门店'}_${radiiStr}_${detail.city_month || ''}`

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
    if (exportSelected.value.length === 1) {
      // 单条：保留地图截图逻辑（逐条下载）
      ElMessage.info('正在导出 1 条记录，请稍候...')
      await exportOneRecord(exportSelected.value[0], type)
      ElMessage.success('导出完成')
    } else {
      // 批量（≥2）：后端打包为单个 ZIP 一次下载，避免浏览器多下载拦截
      const n = exportSelected.value.length
      ElMessage.info(`正在打包 ${n} 条记录为压缩包，请稍候（可能需数十秒）...`)
      const ids = exportSelected.value.map(r => r.id).join(',')
      const resp = await axios.get('/api/purchase/export-batch', {
        params: { ids, type },
        responseType: 'blob'
      })
      const ts = new Date().toISOString().slice(0, 10)
      downloadBlob(resp.data, `导出报表_${n}条_${ts}.zip`)
      ElMessage.success(`导出完成，共 ${n} 条（已打包为 ZIP）`)
    }
  } catch (e) {
    console.error('导出失败:', e)
    let msg = e.message
    const bd = e.response?.data
    if (bd && typeof bd.text === 'function') {
      try {
        const txt = await bd.text()
        const j = JSON.parse(txt)
        if (j.message) msg = j.message
      } catch (_) { /* ignore */ }
    }
    ElMessage.error('导出失败: ' + msg)
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
      /* h1 自带 margin，会把 30px 的 logo 挤偏 —— 置 0 后由 flex 居中接管 */
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: .2px;
      color: #1f2d3d;
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
      position: relative;  /* v1.13.175：承载下方 .active::after 指示条 */
      
      &:hover {
        background: #f5f7fa;
        color: #409eff;
      }
      
      &.active {
        background: #ecf5ff;
        color: #409eff;
        font-weight: 600;  /* v1.13.175（L8）：当前页除底色外再加「字重」维度 */
      }

      /* 当前页指示条（v1.13.175 · L8）：让「我在哪一页」不再只靠颜色区分。
         ⛔ 不用 border-bottom —— 那会增加元素高度、顶掉顶栏中线对齐
            （174 刚为 .logo-text 调过 margin:0 修过这处），改用 ::after 绝对定位。
         ⛔ 排除 .dashboard-nav：它已有独立的深色胶囊 + 蓝色描边高亮，
            再叠一条蓝条会显脏。
         ⚠️ 条色用 #0d579c（项目「同色系 600 级」蓝）而非 #409eff：
            WCAG 1.4.11 对「表示状态的图形」要求 3:1，
            #409eff on #ecf5ff 仅 2.53:1 ❌；#0d579c on #ecf5ff = 6.67:1 ✅ */
      &.active:not(.dashboard-nav)::after {
        content: '';
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: 4px;
        height: 2px;
        border-radius: 1px;
        background: #0d579c;
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
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      
      .el-avatar {
        background: transparent;  /* 头像背景透明（logo 图时无灰色底） */
      }

      /* v1.13.253：上面那条 transparent 会把「无 logo 时的默认头像」一起坑掉 ——
         Element Plus 的 .el-avatar 默认 color 为 #fff，白图标压在白色导航栏上等于隐形
         （实测：背景 rgba(0,0,0,0) + 图标 rgb(255,255,255)）。
         这里只对 v-else 的默认头像补浅灰底 + 深灰图标。
         #606266 on #e4e7ed = 4.68:1，过 WCAG AA（本项目 a11y 统一按 4.5 口径）。 */
      .el-avatar.avatar-fallback {
        background: #e4e7ed;
        color: #606266;
      }
      
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

/* v1.13.209：销售预测 VIP 角标（位于「选址工作台」下拉菜单内）。
   ⚠️ el-dropdown 的 #dropdown 插槽内容会被 teleport 到 body 下渲染，但元素是在**本组件模板**
      里直写的 ⇒ 编译期已带本组件 scopeId（data-v-*），类名直写即可命中，无需 :deep()。
      （此为推断，上线后须用 getComputedStyle 实测字号/底色确认，见 §6.35 scoped 死样式教训。）
   与 BusinessCirclePanel / StoreControlPanel 的同名类视觉保持一致：紫色胶囊。 */
.vip-only-tag {
  font-size: 9px;
  color: #fff;
  background: #7c3aed;
  border-radius: 8px;
  padding: 1px 5px;
  margin-left: 4px;
  white-space: nowrap;
  line-height: 14px;
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
