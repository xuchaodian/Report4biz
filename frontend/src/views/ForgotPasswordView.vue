<template>
  <div class="forgot-container">
    <div class="forgot-box">
      <div class="forgot-header">
        <img src="@/assets/logo.png" alt="Logo" class="forgot-logo">
        <h1>找回密码</h1>
        <p>输入注册邮箱，我们将发送重置链接</p>
      </div>

      <!-- 未提交：输入邮箱 -->
      <el-form
        v-if="!sent"
        ref="formRef"
        :model="form"
        :rules="rules"
        class="forgot-form"
        @submit.prevent="handleSubmit"
      >
        <el-form-item prop="email">
          <el-input
            v-model="form.email"
            placeholder="请输入注册邮箱"
            size="large"
            :prefix-icon="Message"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            class="forgot-btn"
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
          class="forgot-btn"
          :loading="loading"
          @click="retry"
        >
          没收到？重新发送
        </el-button>
      </div>

      <div class="forgot-footer">
        <router-link to="/login">返回登录</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { Message } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/utils/api'

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
.forgot-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.forgot-box {
  width: 400px;
  padding: 40px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.forgot-header {
  text-align: center;
  margin-bottom: 30px;

  .forgot-logo {
    width: 64px;
    height: auto;
    margin-bottom: 12px;
  }

  h1 {
    font-size: 28px;
    color: #333;
    margin-bottom: 8px;
  }

  p {
    color: #666;
    font-size: 14px;
  }
}

.forgot-form {
  .forgot-btn {
    width: 100%;
  }
}

.forgot-done {
  .forgot-done-body {
    font-size: 13px;
    line-height: 1.7;
    margin-top: 4px;
  }

  .forgot-btn {
    width: 100%;
    margin-top: 18px;
  }
}

.forgot-footer {
  text-align: center;
  margin-top: 20px;
  color: #666;
  font-size: 14px;

  a {
    color: #409eff;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
