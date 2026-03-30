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
        path: 'account',
        name: 'Account',
        component: () => import('@/views/MyAccountView.vue')
      },
      {
        path: 'shapefiles',
        name: 'Shapefiles',
        component: () => import('@/views/ShapefileView.vue')
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
