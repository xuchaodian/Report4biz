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
      // 选址评估（v1.11.x 曾上线，因与现有功能重叠已隐藏，代码保留可随时恢复）
      // {
      //   path: 'site-evaluation',
      //   name: 'SiteEvaluation',
      //   component: () => import('@/views/SiteEvaluationView.vue')
      // },
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
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  
  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    next('/login')
  } else if (to.meta.requiresAdmin && !userStore.isAdmin) {
    next('/')
  } else if ((to.path === '/login' || to.path === '/register') && userStore.isLoggedIn) {
    next('/')
  } else {
    next()
  }
})

export default router
