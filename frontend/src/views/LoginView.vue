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

    <!-- 语言切换（右上角） -->
    <div class="login-lang">
      <el-dropdown trigger="click" @command="(lang) => setAppLocale(lang)">
        <span class="login-lang-trigger">
          <el-icon><ChatLineRound /></el-icon>
          <span>{{ langShort }}</span>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="zh">中文</el-dropdown-item>
            <el-dropdown-item command="ja">日本語</el-dropdown-item>
            <el-dropdown-item command="en">English</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="login-box">
      <div class="login-header">
        <img src="@/assets/logo.png" alt="Logo" class="login-logo">
        <h1>{{ $t('login.title') }}</h1>
        <p>{{ $t('login.subtitle') }}</p>
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
            :placeholder="$t('login.username')"
            size="large"
            :prefix-icon="User"
          />
        </el-form-item>
        
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="$t('login.password')"
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
            {{ $t('login.submit') }}
          </el-button>
        </el-form-item>
      </el-form>
      
      <div class="login-footer">
        <span>{{ $t('login.noAccount') }}</span>
        <router-link to="/register">{{ $t('login.register') }}</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { User, Lock, ChatLineRound } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { setAppLocale } from '@/i18n'

const { t, locale } = useI18n()
// 语言按钮缩写：中 / 日 / EN
const langShort = computed(() => {
  if (locale.value === 'ja') return '日'
  if (locale.value === 'en') return 'EN'
  return '中'
})
// rules 里的校验消息需要响应语言
const rules = reactive({
  username: [{ required: true, message: () => t('login.username'), trigger: 'blur' }],
  password: [{ required: true, message: () => t('login.password'), trigger: 'blur' }]
})
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref(null)

const form = reactive({
  username: '',
  password: ''
})

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
    ElMessage.success(t('login.success'))
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
.login-lang {
  position: fixed;
  top: 20px;
  right: 24px;
  z-index: 20;
}
.login-lang-trigger {
  display: flex;
  align-items: center;
  gap: 5px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.login-lang-trigger:hover {
  background: rgba(0, 0, 0, 0.4);
  border-color: rgba(255, 255, 255, 0.5);
}
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
