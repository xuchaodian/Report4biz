import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { requiresAuth: false }
  },
  {
    // 忘记密码：提交邮箱 → 后端发重置链接（不透露邮箱是否已注册）
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: () => import('@/views/ForgotPasswordView.vue'),
    meta: { requiresAuth: false }
  },
  {
    // 重置密码：邮件链接带着 ?token= 进入（一次性、30 分钟有效）
    path: '/reset-password',
    name: 'ResetPassword',
    component: () => import('@/views/ResetPasswordView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/shared/purchase',
    name: 'SharedPurchase',
    component: () => import('@/views/SharedPurchaseView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/',
    component: () => import('@/views/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Map',
        component: () => import('@/views/MapView.vue')
      },
      {
        path: 'data',
        name: 'Data',
        component: () => import('@/views/DataView.vue')
      },
      {
        path: 'competitors',
        name: 'Competitors',
        component: () => import('@/views/CompetitorView.vue')
      },
      {
        path: 'brand-stores',
        name: 'BrandStores',
        component: () => import('@/views/BrandStoreView.vue')
      },
      {
        path: 'shopping-centers',
        name: 'ShoppingCenters',
        component: () => import('@/views/ShoppingCenterView.vue')
      },
      {
        path: 'brands',
        name: 'Brands',
        component: () => import('@/views/BrandIconView.vue')
      },
      {
        path: 'users',
        name: 'Users',
        component: () => import('@/views/UsersView.vue'),
        meta: { requiresAdmin: true }
      },
      {
        path: 'resale',
        name: 'Resale',
        component: () => import('@/views/ResaleView.vue'),
        meta: { requiresAdmin: true }
      },
      {
        path: 'market-map',
        name: 'MarketMap',
        component: () => import('@/views/MarketMapView.vue')
      },
      {
        path: 'district-insight',
        name: 'DistrictInsight',
        component: () => import('@/views/DistrictInsightView.vue')
      },
      // 选址评估（v1.11.x 曾上线，因与现有功能重叠已隐藏，代码保留可随时恢复）
      // {
      //   path: 'site-evaluation',
      //   name: 'SiteEvaluation',
      //   component: () => import('@/views/SiteEvaluationView.vue')
      // },
      {
        path: 'sales-forecast',
        name: 'SalesForecast',
        component: () => import('@/views/SalesForecastView.vue')
      },
      {
        path: 'account',
        name: 'Account',
        component: () => import('@/views/MyAccountView.vue')
      },
      {
        path: 'shapefiles',
        name: 'Shapefiles',
        component: () => import('@/views/ShapefileView.vue')
      },
      {
        path: 'city-data',
        name: 'CityData',
        component: () => import('@/views/CityDataView.vue')
      },
      {
        // 数据同步（集团/子公司）—— 入口在右上角个人下拉；不属于任何组织的账号
        // 也能进（页面给空态引导），因此不加 requiresAdmin
        path: 'data-sync',
        name: 'DataSync',
        component: () => import('@/views/DataSyncView.vue')
      }
    ]
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

// ===== L13（v1.13.176 B 档）：路由切换后的焦点管理 =====
// 问题：SPA 里点导航切页时，被点的那个 <a> 随旧页面一起卸载 ⇒ document.activeElement
//       掉回 <body>。实测（点顶栏「我的门店」→ /data）确实如此。后果：
//         ① 读屏用户**不会被告知「页面已变化」**（无任何播报）；
//         ② 键盘用户得从页面最顶端重新 Tab 一遍才能到内容区。
//       影响面按「每次导航」计，不是「每次登录」。
// 做法：导航落定后把焦点送到主内容地标 `<main id="main-content" tabindex="-1">`——
//       读屏会播报该地标的 role + 可访问名，等价于宣告「新页面内容在此」。
router.afterEach((to, from) => {
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
