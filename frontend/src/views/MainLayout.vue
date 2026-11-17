<template>
  <div class="main-layout" :class="{ 'nav-collapsed': navCollapsed }">
    <!-- L9（v1.13.175 A 档）跳到主内容：键盘/读屏用户按 Tab 的首个焦点即命中，
         一跳跳过顶栏全部导航直达 <main id="main-content">。
         ⛔ 必须是最外层第一个可聚焦元素，插在 <header> 之前 -->
    <a class="skip-link" href="#main-content">跳到主内容</a>

    <!-- 顶部导航栏 -->
    <header class="header">
      <!-- v1.13.368 窄屏导航抽屉的触发器。≥901px 由 CSS 藏起来（display:none），
           桌面端仍用横向导航条，不产生任何视觉变化。
           🔴 aria-controls 指向下面 <nav id="main-nav">，aria-expanded 跟随开关状态 ——
              只写图标不写这两个属性，屏幕阅读器只会念「按钮」。
           🔴 44×44 触控目标（项目 a11y 基线是 24×24，导航主入口按 44 给足）。 -->
      <button
        type="button"
        class="nav-toggle"
        :aria-label="navDrawerOpen ? $t('nav.closeMenu') : $t('nav.openMenu')"
        :aria-expanded="navDrawerOpen ? 'true' : 'false'"
        aria-controls="main-nav"
        ref="navToggleRef"
        @click="toggleNavDrawer"
      >
        <!-- ⚠️ 用两个具名图标而不是 `<component :is="'Menu'">`：`Menu` 不在 main.js 的
             按需图标白名单里（那边是脚本生成的 58 个），字符串解析会失败并静默渲染空白。 -->
        <el-icon v-if="navDrawerOpen"><Close /></el-icon>
        <el-icon v-else><Menu /></el-icon>
      </button>

      <div class="header-left">
        <img src="@/assets/logo.png" alt="Logo" class="header-logo">
        <h1 class="logo-text">选址赢家Online</h1>
      </div>
      
      <nav id="main-nav" class="nav-menu" :class="{ 'nav-menu-open': navDrawerOpen }">
        <!-- 抽屉标题栏：桌面端 display:none，窄屏抽屉里才有内容。
             它是**关闭按钮的常驻位置** —— 只靠遮罩和 Esc 关，触屏用户未必知道能点空白处。 -->
        <div class="nav-drawer-head">
          <span class="nav-drawer-title">{{ $t('nav.menu') }}</span>
          <button
            type="button"
            class="nav-drawer-close"
            :aria-label="$t('nav.closeMenu')"
            @click="closeNavDrawer(true)"
          >
            <el-icon><Close /></el-icon>
          </button>
        </div>
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
          <span>{{ $t('nav.baseData') }}</span>
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
              <!-- v1.13.333：候选点位（P1-6）。全免费、只本人可见，⛔ 不挂 VIP 角标
                   v1.13.343：业主「这个功能还没想好」⇒ 先收紧为**仅管理员可见**。
                   ⛔ 这是 UI 门禁，不是删功能：路由 / 后端 API / 表 / 数据 / 三语词条全保留。
                   ⚠️ 后端 /api/candidates 仍可被已登录用户直接调用（只管「可见」，不管「可用」）。
                   恢复：摘掉下面的 v-if ＋ router 的 meta.requiresAdmin ＋ MapView 的右键项与 case 拦截。 -->
              <el-dropdown-item v-if="userStore.isAdmin" :class="{ 'dd-active': $route.path === '/candidates' }" @click="$router.push('/candidates')">
                <el-icon><Flag /></el-icon>{{ $t('nav.candidates') }}
              </el-dropdown-item>
              <!-- v1.13.369：智能选址。仅管理员（与 candidates 同款 UI 门禁）。
                   🔴 会消耗联通付费配额 ⇒ 门禁必须三处齐落，后端 requireAdmin 已加。 -->
              <el-dropdown-item v-if="userStore.isAdmin" :class="{ 'dd-active': $route.path === '/site-select' }" @click="$router.push('/site-select')">
                <el-icon><Aim /></el-icon>{{ $t('nav.siteSelect') }}
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
              <!-- v1.13.321：操作审计（谁改了配额/角色/删了号） -->
              <el-dropdown-item v-if="userStore.isAdmin" command="audit" class="dd-admin-item">
                <el-icon><Reading /></el-icon>操作审计
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
                  <el-icon style="color: var(--brand-primary);"><Odometer /></el-icon>
                  <span v-if="quotaLoading" class="quota-value" style="color:var(--text-secondary);">加载中...</span>
                  <span v-else-if="userStore.quota" class="quota-value">剩余 <b style="color: var(--brand-primary);">{{ userStore.availableQuota }}</b> 次</span>
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

    <!-- v1.13.368 窄屏抽屉遮罩。⛔ 不能放进 <header>：header 收起（地图页全屏）时
         高度为 0 且 overflow:hidden，遮罩会跟着一起没 —— 而那时抽屉也不该能开。 -->
    <div v-if="navDrawerOpen" class="nav-drawer-backdrop" @click="closeNavDrawer(false)"></div>

    <!-- 新手引导（顶部引导条 + 首次使用向导） -->
    <OnboardingGuide />

    <!-- 主体内容区 -->
    <main id="main-content" class="main-content" tabindex="-1">
      <router-view />
    </main>

    <!-- 地图页「收起导航」切换按钮 v1.13.325 起**不在这里**了。
         🔴 移到 `MapView.vue` 的 `.map-toolbar-rail`（地图工具箱正下方）：
            它必须和工具箱在同一个 flex 列里，工具箱展开（42 → 199）时按钮才能自动跟着下移。
            放在 MainLayout 里只能靠固定 top，面板一展开就被压住。
         🔴 但「收起后顶栏里的我的账户/退出登录/用户管理全都不可达」这条没变
            ⇒ 按钮必须常驻可见，⛔ 不能藏进任何菜单。
         🔴 F 键与状态仍由这里管（stores/ui.js + 全局 keydown），按钮只是触发器。 -->

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

    <!-- 导出报表对话框
         v1.13.318：补 `title` —— 用于**无障碍名**（视觉仍由下面 #header 的 .dlg-title 决定）。
         实测：`role="dialog"` 在**外层** `.el-overlay-dialog` 上，Element Plus 用 `title` prop
         生成它的 aria-label；本弹窗原来只有 #header、没有 title ⇒ 那个 dialog 节点没有名字，
         屏幕阅读器只会念「对话框」。
         ⚠️ 直接给 el-dialog 加 aria-label **无效**（会落到内层 .el-dialog，不是 role=dialog 的节点）。 -->
    <el-dialog v-model="exportDialogVisible" title="导出报表" width="900px" :close-on-click-modal="false">
      <template #header>
        <span class="dlg-title"><AppIcon><Document /></AppIcon>导出报表</span>
      </template>
      <div class="export-dialog-tips" style="margin-bottom:10px;font-size:12px;color:var(--text-secondary);">
        勾选要导出的购买记录（可多选），然后选择导出格式
      </div>
      <!-- v1.13.156 集团可见域：本公司有多个账号时提供「来源」筛选 -->
      <div v-if="exportSourceOptions.length > 1" class="export-source-bar" style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:12px;color:var(--text-regular);">数据来源</span>
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
            <!-- v1.13.342：报告取数只有 1001 人口服务，导出的门店商圈报表其余指标为空 -->
            <el-tooltip v-if="row.is_report" :content="row.source_note" placement="top">
              <el-tag size="small" type="warning" effect="plain" style="margin-left:4px;">报告取数</el-tag>
            </el-tooltip>
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
      <div style="margin-top:10px;font-size:12px;color:var(--text-regular);">
        已选 <b style="color: var(--brand-primary);">{{ exportSelected.length }}</b> 条记录
        <span v-if="exportList.some(r => r.is_report)" style="margin-left:8px;">
          · 标「报告取数」的记录仅含联通 1001 人口服务，导出的其余指标为空属正常
        </span>
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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { captureMapToCanvas, captureMapOnlyCanvas, captureShoppingCenterMap } from '@/utils/mapCapture'
import { useRouter, useRoute } from 'vue-router'
import { MapLocation, DataAnalysis, DataLine, Shop, User, UserFilled, SwitchButton, ArrowDown, Setting, Document, DocumentCopy, Upload, Odometer, Download, Key, DataBoard, TrendCharts, RefreshRight, Reading, ChatDotRound, Flag, Menu, Close, Aim } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
// v1.13.322：地图页「收起导航、全屏看地图」的个人偏好
import { useUiStore } from '@/stores/ui'
import OnboardingGuide from '@/components/guide/OnboardingGuide.vue'
import FeedbackDialog from '@/components/FeedbackDialog.vue'
import axios from 'axios'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const uiStore = useUiStore()

// ── 地图页「收起导航」（v1.13.322）────────────────────────────────────────────
//
// 只有地图页（/）允许收起：表格/管理页收起后只剩一张表，返回入口都没了。
const isMapPage = computed(() => route.path === '/')

/**
 * 实际是否收起 = 「在地图页」AND「偏好为收起」。
 * ⚠️ 两个条件缺一不可：只看偏好会在表格页也收起导航（用户明确要求只在地图页）。
 */
const navCollapsed = computed(() => isMapPage.value && uiStore.navCollapsed)

const toggleNav = () => uiStore.toggleNav()

// ── 窄屏导航抽屉（v1.13.368）──────────────────────────────────────────────────
//
// 背景：顶栏八个导航项是按 ≥910px 排的一横排。390px 手机上实测
//   `header.scrollWidth = 1121`（菜单本体 799），右侧「基础数据 / 选址工作台 /
//   数据大屏」三项直接落在视口外，**点不到也看不见**；因为 body 不横向滚动，
//   用户甚至没有「往右拉」的线索。
//
// 做法：窄屏把**同一份 `<nav>` DOM** 变成左侧抽屉（CSS 定位 + transform），
//   ⛔ 不复制一份导航项 —— 复制就会出现「加了一个菜单项，桌面有、手机没有」，
//   这正是 366 那批改名时最怕的「改一处漏一处」。
//   桌面端（≥901px）CSS 里这条规则不存在，行为与改动前逐像素一致。
//
// ⚠️ 关闭态用 `visibility: hidden` 而不是 `display: none`：
//   前者保留过渡动画，同时**把子元素移出可聚焦序列**（display:none 也行，
//   但宽度过渡会硬跳）。别只写 `transform: translateX(-100%)` ——
//   那样元素只是「看不见」，Tab 键仍会把焦点送进屏幕外的链接里。
const navDrawerOpen = ref(false)
const navToggleRef = ref(null)

/**
 * 抽屉断点。**刻意不等于** 367 地图浮层用的 900px：
 * 这两个数字回答的是不同问题 ——
 *   · 900  = 「地图浮层横排还放不放得下」（由面板宽度加起来决定）
 *   · 1240 = 「导航横排还放不放得下」（实测普通用户 1121px、管理员 1231px）
 * 硬凑成一个数，两边总有一侧是错的。
 * ⚠️ 改这里必须同步改 CSS 里的 @media (max-width: 1240px)，否则
 *    「CSS 已切抽屉、JS 还认为在桌面」（或反之），表现为 Esc 关不掉 / 遮罩残留。
 */
const NAV_DRAWER_MQ = '(max-width: 1240px)'

const toggleNavDrawer = () => {
  // ⛔ 这里不要再调 closeNavDrawer：关闭时焦点已经在按钮上（就是点它关的），
  //    而且 closeNavDrawer 进来就 `if (!navDrawerOpen.value) return` —— 恒早退，纯死代码。
  navDrawerOpen.value = !navDrawerOpen.value
}

/**
 * 关闭抽屉。
 * @param {boolean} returnFocus 是否把焦点还给汉堡按钮 —— 键盘/Esc 关闭时必须给，
 *   否则焦点留在已被 `visibility:hidden` 隐藏的链接上，会被浏览器丢到 <body>，
 *   读屏用户下一按 Tab 就从页首重新开始。
 */
const closeNavDrawer = (returnFocus = false) => {
  if (!navDrawerOpen.value) return
  navDrawerOpen.value = false
  if (returnFocus && navToggleRef.value) navToggleRef.value.focus()
}

// 换页即关：抽屉是覆盖层，点了链接还留在上面会挡住新页面首屏
watch(() => route.fullPath, () => closeNavDrawer(false))

// 视口变宽（转屏 / 桌面拉窗口）时关掉：CSS 里桌面态没有抽屉样式，
// 状态若留在 true，遮罩的 v-if 会让人在桌面上看到一层灰。
// ⚠️ 只在这里挂一次监听，卸载要摘（MapLayout 常驻，但热更新/登出重建时会跑 onBeforeUnmount）。
let narrowMq = null
const handleNarrowChange = (e) => { if (!e.matches) closeNavDrawer(false) }

/**
 * F 键切换全屏。
 * ⚠️ 三个排除：
 *   ① 非地图页不响应（别在输入框里按个 f 就把导航收了）
 *   ② 输入框/可编辑区不响应
 *   ③ 带 Ctrl/Cmd/Alt 不响应 —— 地图页已占用 Ctrl+F（聚焦搜索），不能抢
 *   ④ `e.isComposing`：中文输入法候选期间按 f 不该触发
 */
const handleGlobalKey = (e) => {
  // v1.13.368：窄屏导航抽屉的 Esc 关闭。
  // 🔴 必须放在下面的 `!isMapPage` 早退**之前** —— 抽屉在任何页面都能开，
  //    放后面就变成「只有地图页按 Esc 才关」，其余页面按了没反应。
  if (e.key === 'Escape' && navDrawerOpen.value) {
    e.preventDefault()
    closeNavDrawer(true)
    return
  }
  if (!isMapPage.value) return
  if (e.isComposing) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault()
    uiStore.toggleNav()
  }
}

// 偏好按 uid 存 ⇒ 必须等 user 就绪后再读，否则读到的是 `_anon` 键
// （表现：切账号后全屏设置不跟着变）
watch(
  () => userStore.user?.id,
  (id) => { if (id) uiStore.loadNavPref() },
  { immediate: true }
)

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
  document.addEventListener('keydown', handleGlobalKey)
  if (window.matchMedia) {
    narrowMq = window.matchMedia(NAV_DRAWER_MQ)
    narrowMq.addEventListener('change', handleNarrowChange)
  }
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
  document.removeEventListener('keydown', handleGlobalKey)
  if (narrowMq) {
    narrowMq.removeEventListener('change', handleNarrowChange)
    narrowMq = null
  }
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
  } else if (command === 'audit') {
    router.push('/audit-log')
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

/* ── 地图页「收起导航」（v1.13.322）──────────────────────────────────────
   做法：顶栏高度压到 0（不是 display:none）。
   为什么不用 display:none：没有过渡、是硬跳变，而且 Leaflet 在容器尺寸突变时
   更容易出现半帧错位；高度过渡更平滑，地图侧的 invalidateSize 由 MapView 自己跟。
   🔴 overflow:hidden 必须加 —— 否则高度 0 时 logo/导航会溢出盖到地图上。
   🔴 min-height:0 必须加 —— flex 子项默认 min-height:auto，光写 height:0 压不下去。 */
.header {
  transition: height 0.18s ease, padding 0.18s ease, border-bottom-color 0.18s ease, border-bottom-width 0.18s ease;
}
.main-layout.nav-collapsed .header {
  height: 0;
  min-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  border-bottom-color: transparent;
  /* 🔴 border-bottom-width 必须归 0：只设 color:transparent 的话边框仍在，
     收起后 header 实测还有 1px（地图就少 1px，量出来 535 而不是 536）。 */
  border-bottom-width: 0;
  overflow: hidden;
}

/* 全屏切换按钮 v1.13.325 起搬到 `MapView.vue`（.rail-nav-toggle），
   与「地图工具箱」同在一个 flex 列 ⇒ 工具箱展开时按钮自动下移。
   这里不再保留任何 .nav-toggle-fab 样式，避免两套定位各自漂移。 */


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
        color: var(--brand-primary);
      }
      
      &.active {
        background: var(--el-color-primary-light-9);
        color: var(--brand-primary);
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
        color: var(--brand-primary);
      }

      &.active .nav-dropdown-trigger {
        background: var(--el-color-primary-light-9);
        color: var(--brand-primary);
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
        color: var(--text-regular);
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
  color: var(--text-regular);
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

/* ═══════════════════════════════════════════════════════════════════════════
   窄屏导航抽屉（v1.13.368）
   ───────────────────────────────────────────────────────────────────────────
   问题：顶栏八个导航项是一横排且 `white-space: nowrap`。实测顶栏的**最小内容宽度**：
         · 普通用户  **1121px**（`header.scrollWidth`，视口 901 时量到）
         · 管理员    **1231px**（多一个「品牌门店」）
       所以 1024 的 iPad 横屏、窄一点的笔记本窗口都会把右边几项顶到视口外 ——
       既看不见也点不到，而 body 不横向滚动，连「往右拖」的线索都没有。
   做法：把**同一份** `<nav>` 变成左侧抽屉。
   🔴 断点取 **1240px**（＝管理员最小宽 1231 + 余量），而不是沿用地图那套 900px：
      900 只能覆盖手机，901~1230 之间管理员仍然被裁。断点应当由「横排放不放得下」
      决定，不能由别的模块的常量顺手决定。
   🔴 关闭态必须 `visibility: hidden`：只写 translateX(-100%) 的话元素只是「眼睛
      看不到」，Tab 仍会把焦点送进屏幕外的链接。
   🔴 抽屉/遮罩 z-index 要压过地图页浮层（最高 1400），否则手机上会被戳穿。
   ⚠️ 下面每条选择器都写成与原规则**同等特异性**：@media 不加特异性，
      少一层 `.header` 就会被桌面规则反压回去。
   ═══════════════════════════════════════════════════════════════════════════ */

/* 触发器：桌面隐藏（display:none ⇒ 不进可聚焦序列，也不被读屏播报） */
.nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 44px;      /* 项目 a11y 基线 24×24；导航主入口按 WCAG 2.2 AA 给到 44 */
  height: 44px;
  margin-right: 2px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-regular);
  cursor: pointer;

  .el-icon { font-size: 20px; }

  &:hover { background: #f5f7fa; }
  /* 焦点环要有**颜色**，不能只靠默认 outline 的粗细（361~364 批踩过） */
  &:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 2px; }
}

/* 抽屉标题栏 / 遮罩：桌面隐藏 */
.nav-drawer-head { display: none; }
.nav-drawer-backdrop { display: none; }

/* ── ≤1240px：横向放不下 ⇒ 换抽屉 ───────────────────────────────── */
@media (max-width: 1240px) {
  .header {
    /* 🔴🔴 必须抬到比地图浮层更高（那里最高 1400），否则抽屉会被戳穿。
       为什么改 .header 而不是继续调 .nav-menu 的 z-index：
       `.header` 是 `.main-layout`（display:flex）的 **flex item**，按 Flexbox 规范
       「flex item 只要 z-index ≠ auto 就建立层叠上下文，与 position 无关」。
       它原有的 z-index:100 把抽屉的 1500 整块关在 100 这一层里 ——
       实测 elementFromPoint(300,200) 命中的是遮罩、不是抽屉，且「门店工具」按钮
       压在抽屉白底上。把容器抬起来，里面的 1500 才真的算数。 */
    z-index: 1600;
  }

  .nav-toggle { display: flex; }

  /* 🔴 nav 变成 fixed 后脱离文档流，原来靠它的 `flex:1` 把账户区顶到右边的力就没了 ——
     不补 margin-left:auto，头像会立刻贴到产品名右边。 */
  .header .header-right { margin-left: auto; }

  /* ── 抽屉本体 ───────────────────────────────────────────────── */
  .header .nav-menu {
    position: fixed;
    top: var(--header-height);
    left: 0;
    bottom: 0;
    width: min(82vw, 320px);
    z-index: 1500;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 8px;
    background: #fff;
    border-right: 1px solid #e4e7ed;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.12);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    transform: translateX(-100%);
    visibility: hidden;
    transition: transform 0.22s ease, visibility 0.22s ease;
  }

  .header .nav-menu.nav-menu-open {
    transform: translateX(0);
    visibility: visible;
  }

  .header .nav-menu .nav-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 2px 10px 10px;
    margin-bottom: 6px;
    border-bottom: 1px solid #f0f2f5;

    /* ⚠️ 三档文字色必须走 token：364 的 textTierContrastGuard 禁止 color: #909399/#606266
       （旧的次要灰对白底只有 3.08:1，不达 AA）。 */
    .nav-drawer-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); }

    .nav-drawer-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--text-regular);
      cursor: pointer;

      .el-icon { font-size: 18px; }
      &:hover { background: #f5f7fa; }
      &:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 2px; }
    }
  }

  /* 竖排后每项占满一行；44px 触控高度 */
  .header .nav-menu .nav-item {
    width: 100%;
    padding: 12px 14px;
    font-size: 15px;
    gap: 10px;
    box-sizing: border-box;
  }

  /* 原来 `margin-left: auto` 是横向时用来把它顶到最右的 */
  .header .nav-menu .nav-item.nav-item-right { margin-left: 0; }

  /* 数据大屏的深色胶囊是为白底顶栏设计的，放进白色抽屉里太跳 ⇒ 回归浅色高亮 */
  .header .nav-menu .nav-item.dashboard-nav {
    /* 🔴 padding 必须重写：原规则 `.nav-item.dashboard-nav { padding: 7px 12px }`
       特异性 (0,4,0) 高过上面的 `.nav-item { padding: 12px 14px }` (0,3,0)，
       不写就会矮成 37px —— 低于 44 触控基线，手机上极易点空。 */
    padding: 12px 14px;
    color: #666;
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }
  .header .nav-menu .nav-item.dashboard-nav:hover {
    color: var(--brand-primary);
    background: #f5f7fa;
    border-color: transparent;
  }
  .header .nav-menu .nav-item.dashboard-nav.active {
    color: var(--brand-primary);
    background: var(--el-color-primary-light-9);
    border-color: transparent;
    box-shadow: none;
  }
  .header .nav-menu .nav-item.dashboard-nav .el-icon,
  .header .nav-menu .nav-item.dashboard-nav.active .el-icon { color: inherit; }

  /* 「选址工作台」下拉：触发行占满一行，箭头推到右侧 */
  .header .nav-menu .nav-dropdown { width: 100%; }

  .header .nav-menu .nav-dropdown .nav-dropdown-trigger {
    width: 100%;
    padding: 12px 14px;
    font-size: 15px;
    gap: 10px;
    box-sizing: border-box;
  }
  .header .nav-menu .nav-dropdown .nav-dropdown-arrow { margin-left: auto; }

  /* 遮罩从顶栏下沿开始：盖住内容区但保留汉堡按钮可点（再点一次收起） */
  .nav-drawer-backdrop {
    display: block;
    position: fixed;
    top: var(--header-height);
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1490;
    background: rgba(0, 0, 0, 0.38);
  }
}

/* ── ≤900px：手机。顶栏自身也要收窄（与 367 的地图浮层同一条线）──────── */
@media (max-width: 900px) {
  .header {
    padding: 0 10px;
  }

  /* 原来固定占 --sidebar-width(220px)，390 屏上把导航区挤成负空间 */
  .header .header-left {
    width: auto;
    min-width: 0;
    flex: 1;          /* 吃掉中间空白，把头像顶到最右 */
  }

  .header .header-left .logo-text {
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .header .header-right { flex: none; }

  /* 用户名长度不可控，窄屏只留头像 */
  .header .header-right .user-info .username,
  .header .header-right .user-info .arrow { display: none; }
}
</style>
