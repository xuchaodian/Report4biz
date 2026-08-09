<template>
  <div class="login-container">
    <!-- 背景轮播：合作公司 GIS 人流分析可视化截图 -->
    <div class="bg-slideshow">
      <div
        v-for="(img, i) in bgImages"
        :key="i"
        class="bg-slide"
        :class="{ active: currentBg === i }"
        :style="{ backgroundImage: `url(${img})` }"
      />
    </div>
    <div class="bg-overlay" />

    <div class="login-box">
      <div class="login-header">
        <img src="@/assets/logo.png" alt="Logo" class="login-logo">
        <h1>选址赢家Online</h1>
        <p>智能选址分析平台</p>
      </div>
      
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        class="login-form"
        @submit.prevent="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            size="large"
            :prefix-icon="User"
          />
        </el-form-item>
        
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            size="large"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        
        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="userStore.loading"
            class="login-btn"
            @click="handleLogin"
          >
            登 录
          </el-button>
        </el-form-item>
      </el-form>
      
      <div class="login-footer">
        <span>还没有账号？</span>
        <router-link to="/register">立即注册</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref(null)

const form = reactive({
  username: '',
  password: ''
})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

// 登录页背景图
const bgImages = [
  '/bg1.jpg',
  '/bg2.jpg',
  '/bg3.jpg',
  '/bg4.jpg',
  '/bg5.jpg',
]
const currentBg = ref(0)
let bgTimer = null

onMounted(() => {
  bgTimer = setInterval(() => {
    currentBg.value = (currentBg.value + 1) % bgImages.length
  }, 6000)
})

onUnmounted(() => {
  if (bgTimer) clearInterval(bgTimer)
})

const handleLogin = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  
  const result = await userStore.login(form.username, form.password)
  if (result.success) {
    ElMessage.success('登录成功')
    router.push('/')
  } else {
    ElMessage.error(result.message)
  }
}
</script>

<style lang="scss" scoped>
.login-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  background: #1a1a2e;
}

/* 背景轮播 */
.bg-slideshow {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.bg-slide {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0;
  transition: opacity 1.5s ease-in-out;

  &.active {
    opacity: 1;
  }
}

.bg-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(135deg, rgba(26,26,46,0.85) 0%, rgba(22,34,78,0.75) 50%, rgba(26,26,46,0.85) 100%);
}

/* 登录框 */
.login-box {
  position: relative;
  z-index: 2;
  width: 420px;
  padding: 44px 40px 36px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 16px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
  
  .login-logo {
    width: 64px;
    height: auto;
    margin-bottom: 12px;
  }
  
  h1 {
    font-size: 26px;
    font-weight: 600;
    color: #333;
    margin-bottom: 6px;
  }
  
  p {
    color: #999;
    font-size: 14px;
    letter-spacing: 2px;
  }
}

.login-form {
  .login-btn {
    width: 100%;
    height: 44px;
    font-size: 16px;
    letter-spacing: 4px;
  }
}

.login-footer {
  text-align: center;
  margin-top: 20px;
  color: #999;
  font-size: 14px;
  
  a {
    color: #409eff;
    margin-left: 5px;
    text-decoration: none;
    
    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
