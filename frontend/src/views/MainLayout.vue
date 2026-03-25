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
          <span>地图</span>
        </router-link>
        <router-link to="/data" class="nav-item" :class="{ active: $route.path === '/data' }">
          <el-icon><DataAnalysis /></el-icon>
          <span>数据</span>
        </router-link>
        <router-link v-if="userStore.isAdmin" to="/users" class="nav-item" :class="{ active: $route.path === '/users' }">
          <el-icon><User /></el-icon>
          <span>用户</span>
        </router-link>
      </nav>
      
      <div class="header-right">
        <el-dropdown @command="handleCommand">
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
              <el-dropdown-item command="logout" divided>
                <el-icon><SwitchButton /></el-icon>退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>
    
    <!-- 主体内容区 -->
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { MapLocation, DataAnalysis, User, UserFilled, SwitchButton, ArrowDown } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

onMounted(() => {
  userStore.fetchUser()
})

const handleCommand = async (command) => {
  if (command === 'logout') {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      type: 'warning'
    })
    userStore.logout()
    router.push('/login')
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
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      color: #666;
      font-size: 14px;
      transition: all 0.3s;
      
      &:hover {
        background: #f5f7fa;
        color: #409eff;
      }
      
      &.active {
        background: #ecf5ff;
        color: #409eff;
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
</style>
