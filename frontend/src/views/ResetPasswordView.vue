<template>
  <div class="auth-container">
    <AuthBackground />

    <AuthCard title="设置新密码" subtitle="请设置一个新的登录密码">
      <!-- 校验中 -->
      <div v-if="state === 'checking'" class="reset-tip">正在校验链接…</div>

      <!-- 链接无效 / 已使用 / 已过期 -->
      <div v-else-if="state === 'invalid'" class="reset-invalid">
        <el-alert type="warning" :closable="false" show-icon>
          <template #title>链接不可用</template>
          <div class="reset-invalid-body">{{ invalidMessage }}</div>
        </el-alert>
        <el-button type="primary" size="large" class="auth-submit reset-state-btn" @click="goForgot">
          重新申请重置
        </el-button>
      </div>

      <!-- 设置新密码 -->
      <el-form
        v-else-if="state === 'ready'"
        ref="formRef"
        :model="form"
        :rules="rules"
        class="reset-form"
        @submit.prevent="handleSubmit"
      >
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            :type="pwdShow.password ? 'text' : 'password'"
            placeholder="请输入新密码（至少 6 位）"
            aria-label="新密码（至少 6 位）"
            name="password"
            autocomplete="new-password"
            size="large"
            :prefix-icon="Lock"
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

        <el-form-item prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            :type="pwdShow.confirmPassword ? 'text' : 'password'"
            placeholder="请再次输入新密码"
            aria-label="确认新密码"
            name="confirmPassword"
            autocomplete="new-password"
            size="large"
            :prefix-icon="Lock"
            @keyup.enter="handleSubmit"
          >
            <template #suffix>
              <button
                type="button"
                class="pwd-toggle"
                :aria-label="pwdShow.confirmPassword ? $t('common.hidePassword') : $t('common.showPassword')"
                :aria-pressed="pwdShow.confirmPassword"
                :title="pwdShow.confirmPassword ? $t('common.hidePassword') : $t('common.showPassword')"
                @click="pwdShow.confirmPassword = !pwdShow.confirmPassword"
              >
                <el-icon><View v-if="!pwdShow.confirmPassword" /><Hide v-else /></el-icon>
              </button>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            class="auth-submit"
            @click="handleSubmit"
          >
            确认修改
          </el-button>
        </el-form-item>
      </el-form>

      <!-- 修改成功 -->
      <div v-else class="reset-done">
        <el-alert type="success" :closable="false" show-icon>
          <template #title>密码已重置</template>
          <div class="reset-done-body">正在跳转到登录页…</div>
        </el-alert>
      </div>

      <template #footer>
        <router-link to="/login">返回登录</router-link>
      </template>
    </AuthCard>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/utils/api'
import AuthBackground from '@/components/AuthBackground.vue'
import AuthCard from '@/components/AuthCard.vue'

const route = useRoute()
const router = useRouter()

const formRef = ref(null)
const loading = ref(false)
// checking | invalid | ready | done
const state = ref('checking')
const invalidMessage = ref('')

// v1.13.133：密码显隐开关状态（替代 EP 的 show-password，详见 assets/main.scss .pwd-toggle）
const pwdShow = reactive({ password: false, confirmPassword: false })

const form = reactive({ password: '', confirmPassword: '' })

const validateConfirm = (rule, value, callback) => {
  if (value !== form.password) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const rules = {
  password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 个字符', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' }
  ]
}

const token = String(route.query.token || '')

onMounted(async () => {
  if (!token) {
    invalidMessage.value = '链接不完整，请重新申请密码重置。'
    state.value = 'invalid'
    return
  }
  try {
    const res = await api.get('/auth/reset-password/check', { params: { token } })
    if (res?.valid) {
      state.value = 'ready'
    } else {
      invalidMessage.value = res?.message || '链接无效或已过期，请重新申请。'
      state.value = 'invalid'
    }
  } catch (e) {
    invalidMessage.value = e?.response?.data?.message || '校验链接失败，请稍后重试。'
    state.value = 'invalid'
  }
})

const handleSubmit = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    await api.post('/auth/reset-password', { token, password: form.password })
    state.value = 'done'
    ElMessage.success('密码已重置，请使用新密码登录')
    setTimeout(() => router.push('/login'), 1500)
  } catch (e) {
    const msg = e?.response?.data?.message || '重置失败，请稍后重试'
    ElMessage.error(msg)
    // 令牌类错误（无效/已用/过期）直接把页面切到不可用态，避免用户反复试
    if (e?.response?.status === 400 && /链接/.test(msg)) {
      invalidMessage.value = msg
      state.value = 'invalid'
    }
  } finally {
    loading.value = false
  }
}

const goForgot = () => router.push('/forgot-password')
</script>

<style lang="scss" scoped>
/* 容器（.auth-container）、卡片（AuthCard.vue）、主按钮（.auth-submit）均为共用样式 */

.reset-tip {
  text-align: center;
  color: #999;
  font-size: 14px;
  padding: 16px 0;
}

.reset-invalid,
.reset-done {
  .reset-invalid-body,
  .reset-done-body {
    font-size: 13px;
    line-height: 1.7;
    margin-top: 4px;
  }

  .reset-state-btn {
    margin-top: 18px;
  }
}
</style>
