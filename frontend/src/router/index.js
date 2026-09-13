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

export default router
