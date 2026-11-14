import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import { useUserStore } from '@/stores/user'
import { i18n } from '@/i18n'
import { formatTitle } from '@/utils/pageTitle'

// ===== 页面标题（v1.13.360）=====
// 背景：此前**没有任何一处**写 document.title —— 路由表没有 title 元信息、
//   全仓也没有 document.title 赋值 ⇒ 浏览器标签页在 20+ 个页面之间切换时标题恒为
//   index.html 里那句站点标题。后果是多标签页办公时分不清哪个标签是哪个页面，
//   收藏/历史记录也全是同一个名字。
// 做法：每条路由挂 `meta.titleKey`（i18n 键，⛔ 不写中文定值 —— 本站有三语），
//   afterEach 里翻译后拼成 `页面名 - 品牌名`（格式由 utils/pageTitle.js 单点定义）。
// ⚠️ 键名优先复用 `nav.*`：菜单文案与标签页标题必须是同一个来源，否则改一处漏一处。
const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { requiresAuth: false, titleKey: 'pageTitle.login' }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { requiresAuth: false, titleKey: 'pageTitle.register' }
  },
  {
    // 忘记密码：提交邮箱 → 后端发重置链接（不透露邮箱是否已注册）
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: () => import('@/views/ForgotPasswordView.vue'),
    meta: { requiresAuth: false, titleKey: 'pageTitle.forgotPassword' }
  },
  {
    // 重置密码：邮件链接带着 ?token= 进入（一次性、30 分钟有效）
    path: '/reset-password',
    name: 'ResetPassword',
    component: () => import('@/views/ResetPasswordView.vue'),
    meta: { requiresAuth: false, titleKey: 'pageTitle.resetPassword' }
  },
  {
    path: '/shared/purchase',
    name: 'SharedPurchase',
    component: () => import('@/views/SharedPurchaseView.vue'),
    meta: { requiresAuth: false, titleKey: 'pageTitle.sharedPurchase' }
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.dashboard' }
  },
  {
    path: '/',
    component: () => import('@/views/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Map',
        component: () => import('@/views/MapView.vue'),
        meta: { titleKey: 'nav.map' }
      },
      {
        path: 'data',
        name: 'Data',
        component: () => import('@/views/DataView.vue'),
        meta: { titleKey: 'nav.myStores' }
      },
      {
        // 门店体检（v1.13.291 上线，v1.13.296 由「位置体检」更名）：入口在门店管理页工具栏，不占顶部导航。
        // 全免费（纯本地几何 + 一次聚合查询，不消耗联通/高德配额）；仅本人门店。
        path: 'store-checkup',
        name: 'StoreCheckup',
        component: () => import('@/views/StoreCheckupView.vue'),
        meta: { titleKey: 'pageTitle.storeCheckup' }
      },
      {
        path: 'competitors',
        name: 'Competitors',
        component: () => import('@/views/CompetitorView.vue'),
        meta: { titleKey: 'nav.competitors' }
      },
      {
        path: 'brand-stores',
        name: 'BrandStores',
        component: () => import('@/views/BrandStoreView.vue'),
        meta: { titleKey: 'nav.brandStores' }
      },
      {
        path: 'shopping-centers',
        name: 'ShoppingCenters',
        component: () => import('@/views/ShoppingCenterView.vue'),
        meta: { titleKey: 'nav.shoppingCenters' }
      },
      {
        path: 'brands',
        name: 'Brands',
        component: () => import('@/views/BrandIconView.vue'),
        meta: { titleKey: 'pageTitle.brands' }
      },
      {
        path: 'users',
        name: 'Users',
        component: () => import('@/views/UsersView.vue'),
        meta: { requiresAdmin: true, titleKey: 'nav.users' }
      },
      {
        // 操作审计（v1.13.321）—— 仅 admin；后端 /api/audit-log 也是组级 requireAdmin
        path: 'audit-log',
        name: 'AuditLog',
        component: () => import('@/views/AuditLogView.vue'),
        meta: { requiresAdmin: true, titleKey: 'pageTitle.auditLog' }
      },
      {
        path: 'resale',
        name: 'Resale',
        component: () => import('@/views/ResaleView.vue'),
        meta: { requiresAdmin: true, titleKey: 'nav.apiOpen' }
      },
      {
        path: 'candidates',
        name: 'Candidates',
        // v1.13.333（P1-6 轻量工作流）：候选点位独立于门店台账，⛔ 不是 markers 的视图
        // v1.13.343：业主「还没想好」⇒ 收紧为仅管理员可进，全局守卫 next('/') 弹回首页。
        //   ⛔ 只挡 UI 深链；后端 /api/candidates 未加 requireAdmin（见 candidateAdminOnly.test.js 文件头）。
        component: () => import('@/views/CandidateView.vue'),
        meta: { requiresAdmin: true, titleKey: 'nav.candidates' }
      },
      {
        path: 'market-map',
        name: 'MarketMap',
        component: () => import('@/views/MarketMapView.vue'),
        meta: { titleKey: 'nav.cityInsight' }
      },
      {
        path: 'district-insight',
        name: 'DistrictInsight',
        component: () => import('@/views/DistrictInsightView.vue'),
        meta: { titleKey: 'nav.districtInsight' }
      },
      // v1.13.231：选址评估（site-evaluation）已**整体清理**。
      //   沿革：v1.11.x 上线 → c9fba2e(2026-08-19) 因「与现有功能重叠」隐藏（路由注释、代码保留）
      //        → 2026-10-16 完成重叠评审后决定清理（判定重叠 ≈80%：开店余地 + 商圈洞察
      //          已覆盖人口/竞品/配套三面，且该族「从未被真正验证」）。
      //   ⛔ 若将来要恢复：先读 workbuddy过程文件/Report4biz_隐藏资产清理方案_20261016.md
      //      ＋ 记忆附录①§6.61 —— 恢复即重新暴露 R1（score-batch 单请求最坏 ¥1200），
      //      且前端 4 组件 / 后端 2 路由 / 引擎 / 6 张表均需从 git 历史取回。
      {
        path: 'sales-forecast',
        name: 'SalesForecast',
        component: () => import('@/views/SalesForecastView.vue'),
        meta: { titleKey: 'nav.salesForecast' }
      },
      {
        path: 'account',
        name: 'Account',
        component: () => import('@/views/MyAccountView.vue'),
        meta: { titleKey: 'nav.account' }
      },
      {
        // v1.13.366：菜单/标题与页面内容对齐 —— path 仍是 shapefiles（不动地址），
        // 显示名由「统计数据」改为「基础数据」（key 同步 statistics → baseData）。
        path: 'shapefiles',
        name: 'Shapefiles',
        component: () => import('@/views/ShapefileView.vue'),
        meta: { titleKey: 'nav.baseData' }
      },
      {
        path: 'city-data',
        name: 'CityData',
        component: () => import('@/views/CityDataView.vue'),
        meta: { titleKey: 'pageTitle.cityData' }
      },
      {
        // 数据同步（集团/子公司）—— 入口在右上角个人下拉；不属于任何组织的账号
        // 也能进（页面给空态引导），因此不加 requiresAdmin
        path: 'data-sync',
        name: 'DataSync',
        component: () => import('@/views/DataSyncView.vue'),
        meta: { titleKey: 'pageTitle.dataSync' }
      }
    ]
  },
  {
    // ===== 404 catch-all（v1.13.221）=====
    // 背景：nginx 的 `location /` 对未命中的路径一律 try_files 回落 index.html，
    //   而此前路由表**没有** catch-all ⇒ 访问 /abcxyz 时 Vue 找不到匹配路由，
    //   渲染出一片空白、且 HTTP 仍是 200（软 404）。
    // ⚠️ 必须放在路由表**最后**：vue-router 4 在具体度评分相同时按定义顺序匹配，
    //   catch-all 的具体度最低，放末尾可确保上面所有精确路由优先命中。
    // ⚠️ requiresAuth 刻意设 false —— 未知路径不该把访客弹去登录页，否则输错 URL
    //   只会看到一个登录框、永远不知道「404」的存在（这正是本页要修的体验问题）。
    // ⚠️ noindex：由下方 afterEach 负责注入 <meta name="robots">，见 applyRobotsMeta。
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { requiresAuth: false, noindex: true, titleKey: 'pageTitle.notFound' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach(async (to, from, next) => {
  const userStore = useUserStore()

  // 已登录但用户信息尚未加载（刷新页面 / 直接输入 URL）时先补齐：
  // 否则 isAdmin 仍为 false，管理页会被误判为无权限而弹回首页
  if (userStore.isLoggedIn && !userStore.user) {
    await userStore.fetchUser()
  }
  
  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    next('/login')
  } else if (to.meta.requiresAdmin && !userStore.isAdmin) {
    next('/')
  } else if ((to.path === '/login' || to.path === '/register') && userStore.isLoggedIn) {
    // 与登录后落点保持一致：管理员直接进「用户管理」
    next(userStore.isAdmin ? '/users' : '/')
  } else {
    next()
  }
})

// ===== SEO：按路由 meta 切换 <meta name="robots">（v1.13.221）=====
// 用途：catch-all 404 视图必须向爬虫声明 noindex，否则「未知路径 → HTTP 200 + 通用 SPA 壳」
//       会被搜索引擎当成 soft 404 / 重复内容收进索引（这正是本批要修的问题）。
// ⚠️ 只操作「由本函数注入的那个」标签（用 data-r4b-noindex 自我标记）：
//   ⛔ 不去删/改 index.html 或将来可能出现的其它 robots 标签 —— 那属于站点级策略，
//   误删会静默改变全站收录行为（例如把整站 noindex 抹掉）。
function applyRobotsMeta(noindex) {
  const SELECTOR = 'meta[name="robots"][data-r4b-noindex]'
  const existing = document.head.querySelector(SELECTOR)

  if (noindex) {
    if (existing) return // 已在位 ⇒ 幂等，避免重复插入
    const el = document.createElement('meta')
    el.setAttribute('name', 'robots')
    el.setAttribute('content', 'noindex, follow')
    el.setAttribute('data-r4b-noindex', '1')
    document.head.appendChild(el)
  } else if (existing) {
    // 离开 noindex 路由 ⇒ 摘掉，恢复站点默认（可索引）
    document.head.removeChild(existing)
  }
}

// ===== 标签页标题：按路由 meta.titleKey 写入 document.title（v1.13.360）=====
// ⚠️ 不要在页面组件里各自写 document.title —— 那样每页都要重复一遍格式，
//   且漏写一页就是「标题还停在上一个页面」，很难发现。
// ⚠️ titleKey 只放**键**，不放中文：本站有中/日/英三语，写死定值会让日文/英文界面
//   的标签页仍是中文（与品牌锚点铁律同源的问题）。
function applyTitle(to) {
  if (typeof document === 'undefined') return // 守卫测试/SSR 环境下安全跳过
  const key = to && to.meta && to.meta.titleKey
  document.title = formatTitle(key ? i18n.global.t(key) : '')
}

// 切语言时标题要跟着变：否则「日文界面 + 中文标签页」会一直挂到下次导航。
// ⚠️ 用 watch 而不是改 setAppLocale：`i18n/index.js` 不引 router（引了就是循环依赖），
//   由 router 单向监听 locale 是唯一不产生环的做法。
watch(
  () => i18n.global.locale.value,
  () => applyTitle(router.currentRoute.value)
)

// ===== L13（v1.13.176 B 档）：路由切换后的焦点管理 =====
// 问题：SPA 里点导航切页时，被点的那个 <a> 随旧页面一起卸载 ⇒ document.activeElement
//       掉回 <body>。实测（点顶栏「我的门店」→ /data）确实如此。后果：
//         ① 读屏用户**不会被告知「页面已变化」**（无任何播报）；
//         ② 键盘用户得从页面最顶端重新 Tab 一遍才能到内容区。
//       影响面按「每次导航」计，不是「每次登录」。
// 做法：导航落定后把焦点送到主内容地标 `<main id="main-content" tabindex="-1">`——
//       读屏会播报该地标的 role + 可访问名，等价于宣告「新页面内容在此」。
router.afterEach((to, from) => {
  // ===== SEO：路由落定后同步 robots 元信息（v1.13.221）=====
  // ⚠️ 必须排在下文「`!from.name` 提前 return」**之前**：首屏直接输入未知 URL 时
  //   from 即 START_LOCATION（name 为空），若排在其后就永远不会注入 404 的 noindex。
  applyRobotsMeta(to.meta.noindex === true)

  // ===== 标签页标题（v1.13.360）=====
  // ⚠️ 同样必须排在下文「`!from.name` 提前 return」**之前**：首次进入（直接输 URL /
  //   刷新 / 从收藏夹打开）时 from 是 START_LOCATION，若排在其后则**首屏永远拿不到标题**——
  //   而这恰恰是「从收藏夹/历史记录进来」最常见的场景，等于改了个看不见的效果。
  applyTitle(to)

  // ① 首次进入（刷新页面 / 直接输 URL / 从站外跳回）：`from` 是 START_LOCATION，
  //    name 为空。此时浏览器给 <body> 焦点是正常的，抢焦点反而会打断
  //    读屏对整页的首次朗读 ⇒ 直接跳过。
  if (!from.name) return

  // ② 同一路由只变 query / hash（如分页把页码写进 URL）：页面根本没换，
  //    焦点不该跳走，否则用户刚要操作就被拽回顶部地标。
  if (to.path === from.path) return

  // ③ 目标路由组件是懒加载的，`afterEach` 触发时新 DOM 还没挂上
  //    ⇒ 用 rAF 轮询等它出现（30 帧 ≈ 500ms）；拿不到就静默放弃。
  //    ⚠️ 认证页（/login、/register、/forgot-password、/reset-password、
  //       /shared/purchase）目前都没有 <main> 地标 ⇒ 在那些页面之间切换
  //       不会移动焦点。这是「已知且刻意」的现状（那几页不在本次范围），
  //       ⛔ 不是静默失败，将来给它们补 <main> 即可自动生效。
  let tries = 0
  const moveFocus = () => {
    const el = document.getElementById('main-content')
    if (el) {
      // ④ 若此刻有可见弹窗，焦点归 EP 的 focus-trap 管；再抢会打架，
      //    让弹窗自己决定落点（弹窗关闭后的落点由 EP 负责）。
      const overlays = document.querySelectorAll('.el-overlay')
      for (const o of overlays) {
        if (getComputedStyle(o).display !== 'none') return
      }
      // ⑤ preventScroll：本项目**没有**配 scrollBehavior（无滚动补偿/回到顶部逻辑），
      //    传 true 就不会凭空引入「切页自动滚到顶部」这个行为变更。
      //    焦点只是移动，滚动位置保持原样 ＝ 与改动前一致。
      el.focus({ preventScroll: true })
      return
    }
    if (++tries < 30) requestAnimationFrame(moveFocus)
  }
  requestAnimationFrame(moveFocus)
})

export default router
