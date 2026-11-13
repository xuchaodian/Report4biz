<template>
  <div class="auth-container">
    <AuthBackground />

    <AuthCard title="找回密码" subtitle="输入注册邮箱，我们将发送重置链接">
      <!-- 未提交：输入邮箱 -->
      <el-form
        v-if="!sent"
        ref="formRef"
        :model="form"
        :rules="rules"
        class="forgot-form"
        @submit.prevent="handleSubmit"
        @validate="onValidate"
      >
        <!-- v1.13.361：字段级校验的主动播报活区（见 utils/useFormErrorA11y.js）。
             ⚠️ 提交成功后的「已发送」态**不需要**额外播报：el-alert 自带 role="alert"
                （alert.vue…lang.mjs:44），v-if 切换插入节点即可被读屏念到。 -->
        <div class="sr-only" role="alert" aria-live="assertive">{{ liveErr }}</div>

        <el-form-item prop="email">
          <el-input
            v-model="form.email"
            placeholder="请输入注册邮箱"
            aria-label="注册邮箱"
            v-bind="fieldAria('email')"
            name="email"
            autocomplete="email"
            size="large"
            :prefix-icon="Message"
            @keyup.enter="handleSubmit"
          />
          <template #error="{ error }">
            <div :id="errId('email')" class="el-form-item__error">{{ error }}</div>
          </template>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            class="auth-submit"
            @click="handleSubmit"
          >
            发送重置链接
          </el-button>
        </el-form-item>
      </el-form>

      <!-- 已提交：统一回执（不透露该邮箱是否已注册） -->
      <div v-else class="forgot-done">
        <el-alert type="success" :closable="false" show-icon>
          <template #title>重置链接已发送</template>
          <div class="forgot-done-body">{{ sentMessage }}</div>
        </el-alert>

        <el-button
          size="large"
          :loading="loading"
          class="auth-submit forgot-done-btn"
          @click="retry"
        >
          没收到？重新发送
        </el-button>
      </div>

      <template #footer>
        <router-link to="/login">返回登录</router-link>
      </template>
    </AuthCard>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { Message } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/utils/api'
import AuthBackground from '@/components/AuthBackground.vue'
import AuthCard from '@/components/AuthCard.vue'
import { useFormErrorA11y } from '@/utils/useFormErrorA11y'

/* v1.13.361：字段级校验的可访问性。prop 名必须与 el-form-item 的 prop 逐字一致。 */
const { liveErr, onValidate, errId, fieldAria } = useFormErrorA11y(['email'], 'forgot')

const formRef = ref(null)
const loading = ref(false)
const sent = ref(false)
const sentMessage = ref('')

const form = reactive({ email: '' })

const rules = {
  email: [
    { required: true, message: '请输入注册邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ]
}

const handleSubmit = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const res = await api.post('/auth/forgot-password', { email: form.email.trim() })
    sentMessage.value = res?.message || '如果该邮箱已注册，我们已发送密码重置链接，请查收邮件。'
    sent.value = true
  } catch (e) {
    // 400 格式错误 / 429 过于频繁 / 503 邮件未配置 —— 均为「与账号无关」的提示，可安全展示
    ElMessage.error(e?.response?.data?.message || '发送失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

// 重新发送：回到表单（需先通过限流窗口）
const retry = () => {
  sent.value = false
}
</script>

<style lang="scss" scoped>
/* 容器（.auth-container）、卡片（AuthCard.vue）、主按钮（.auth-submit）均为共用样式 */

.forgot-done {
  .forgot-done-body {
    font-size: 13px;
    line-height: 1.7;
    margin-top: 4px;
  }

  .forgot-done-btn {
    margin-top: 18px;
  }
}
</style>
