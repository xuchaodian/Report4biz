<template>
  <div class="auth-container">
    <!-- 背景轮播：合作公司 GIS 人流分析可视化截图（四页共用组件） -->
    <AuthBackground />

    <!-- 语言切换（右上角） -->
    <div class="login-lang">
      <el-dropdown trigger="click" @command="(lang) => setAppLocale(lang)">
        <span class="login-lang-trigger" :aria-label="$t('common.switchLanguage')">
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

    <AuthCard :title="$t('login.title')" :subtitle="$t('login.subtitle')">
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
            :aria-label="$t('login.usernameLabel')"
            name="username"
            autocomplete="username"
            size="large"
            :prefix-icon="User"
          />
        </el-form-item>

        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            :type="pwdShow.password ? 'text' : 'password'"
            :placeholder="$t('login.password')"
            :aria-label="$t('login.passwordLabel')"
            name="password"
            autocomplete="current-password"
            size="large"
            :prefix-icon="Lock"
            @keyup.enter="handleLogin"
          >
            <template #suffix>
              <button
                type="button"
                class="pwd-toggle"
                :aria-label="pwdShow.password ? $t('common.hidePassword') : $t('common.showPassword')"
                :aria-pressed="pwdShow.password"
                :title="pwdShow.password ? $t('common.hidePassword') : $t('common.showPassword')"
                @click="pwdShow.password = !pwdShow.password"
              >
                <el-icon><View v-if="!pwdShow.password" /><Hide v-else /></el-icon>
              </button>
            </template>
          </el-input>
        </el-form-item>

        <div class="login-forgot">
          <router-link to="/forgot-password">{{ $t('login.forgot') }}</router-link>
        </div>

        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="userStore.loading"
            class="auth-submit"
            @click="handleLogin"
          >
            {{ $t('login.submit') }}
          </el-button>
        </el-form-item>
      </el-form>

      <template #footer>
        <span>{{ $t('login.noAccount') }}</span>
        <router-link to="/register">{{ $t('login.register') }}</router-link>
      </template>
    </AuthCard>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { User, Lock, ChatLineRound } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { setAppLocale } from '@/i18n'
import AuthBackground from '@/components/AuthBackground.vue'
import AuthCard from '@/components/AuthCard.vue'

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

// v1.13.133：密码显隐开关状态 —— 替代 EP 自带的 show-password（其开关是 <i>，无 role/
// tabindex/aria-label，键盘不可达）。详见 assets/main.scss 的 .pwd-toggle 注释。
const pwdShow = reactive({ password: false })

const form = reactive({
  username: '',
  password: ''
})

// 背景轮播逻辑已抽到 components/AuthBackground.vue（v1.13.151），四页共用

const handleLogin = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  const result = await userStore.login(form.username, form.password)
  if (result.success) {
    ElMessage.success(t('login.success'))
    // 管理员账号定位为运维入口（用户管理），登录后直接落地「用户管理」
    router.push(userStore.isAdmin ? '/users' : '/')
  } else {
    ElMessage.error(result.message)
  }
}
</script>

<style lang="scss" scoped>
/* 容器（.auth-container）与主按钮（.auth-submit）样式在 assets/main.scss —— 四页共用 */

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

.login-forgot {
  text-align: right;
  margin: -6px 0 14px;

  a {
    color: #409eff;
    font-size: 13px;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
