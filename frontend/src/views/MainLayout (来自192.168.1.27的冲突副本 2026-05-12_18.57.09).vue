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
          <span>我的门店</span>
        </router-link>
        <router-link to="/competitors" class="nav-item" :class="{ active: $route.path === '/competitors' }">
          <el-icon><DataLine /></el-icon>
          <span>竞品门店</span>
        </router-link>
        <router-link to="/brand-stores" class="nav-item" :class="{ active: $route.path === '/brand-stores' }">
          <el-icon><MapLocation /></el-icon>
          <span>品牌门店</span>
        </router-link>
        <router-link to="/shopping-centers" class="nav-item" :class="{ active: $route.path === '/shopping-centers' }">
          <el-icon><Shop /></el-icon>
          <span>购物中心</span>
        </router-link>
        <router-link to="/shapefiles" class="nav-item" :class="{ active: $route.path === '/shapefiles' }">
          <el-icon><Document /></el-icon>
          <span>统计数据</span>
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
              <el-dropdown-item command="brands">
                <el-icon><Setting /></el-icon>设置图标
              </el-dropdown-item>
              <el-dropdown-item v-if="userStore.isAdmin" command="template">
                <el-icon><Upload /></el-icon>设置模板
              </el-dropdown-item>
              <el-dropdown-item command="purchase">
                <el-icon><Document /></el-icon>购买履历
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
        <el-button @click="templateDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="templateUploading" @click="handleTemplateUpload">确定上传</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { MapLocation, DataAnalysis, DataLine, Shop, User, UserFilled, SwitchButton, ArrowDown, Setting, Document, Upload } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import axios from 'axios'

const router = useRouter()
const userStore = useUserStore()

// 模板上传
const templateDialogVisible = ref(false)
const templateUploading = ref(false)
const uploadRef = ref(null)
const templateFile = ref(null)

const handleTemplateFileChange = (file) => {
  templateFile.value = file.raw
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
  } else if (command === 'logout') {
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

.template-upload-tips {
  margin-bottom: 20px;
  padding: 15px;
  background: #f5f7fa;
  border-radius: 4px;
  p { margin: 0; font-size: 14px; color: #666; }
}
</style>
