<template>
  <div class="auth-container">
    <AuthBackground />

    <AuthCard title="选址赢家Online" subtitle="创建您的账号">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        class="register-form"
        @submit.prevent="handleRegister"
        @validate="onValidate"
      >
        <!-- v1.13.361：字段级校验的主动播报活区。
             为什么需要它 —— 提交时写的是 `if (!valid) return`，对读屏用户来说
             就是「点了注册什么都没发生」；EP 的 .el-form-item__error 既无 role 也无 aria-live。
             实现与用法见 utils/useFormErrorA11y.js，⛔ 别在这里另写一套状态。 -->
        <div class="sr-only" role="alert" aria-live="assertive">{{ liveErr }}</div>

        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            aria-label="用户名"
            v-bind="fieldAria('username')"
            name="username"
            autocomplete="username"
            size="large"
            :prefix-icon="User"
          />
          <template #error="{ error }">
            <div :id="errId('username')" class="el-form-item__error">{{ error }}</div>
          </template>
        </el-form-item>

        <el-form-item prop="email">
          <el-input
            v-model="form.email"
            placeholder="请输入邮箱"
            aria-label="邮箱"
            v-bind="fieldAria('email')"
            name="email"
            autocomplete="email"
            size="large"
            :prefix-icon="Message"
          />
          <template #error="{ error }">
            <div :id="errId('email')" class="el-form-item__error">{{ error }}</div>
          </template>
        </el-form-item>

        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            :type="pwdShow.password ? 'text' : 'password'"
            placeholder="请输入密码"
            aria-label="密码（至少 6 位）"
            v-bind="fieldAria('password')"
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
          <template #error="{ error }">
            <div :id="errId('password')" class="el-form-item__error">{{ error }}</div>
          </template>
        </el-form-item>

        <el-form-item prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            :type="pwdShow.confirmPassword ? 'text' : 'password'"
            placeholder="请确认密码"
            aria-label="确认密码"
            v-bind="fieldAria('confirmPassword')"
            name="confirmPassword"
            autocomplete="new-password"
            size="large"
            :prefix-icon="Lock"
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
          <template #error="{ error }">
            <div :id="errId('confirmPassword')" class="el-form-item__error">{{ error }}</div>
          </template>
        </el-form-item>

        <!-- 蜜罐（v1.13.149 注册防护）：留在渲染树里让脚本「看得见」，
             但人眼与读屏都接触不到 —— tabindex=-1 不参与 Tab 序，aria-hidden 不进读屏。
             一旦被填 ⇒ 服务端返回假成功且不落库，不给攻击者「被识别」的可迭代反馈。
             定位锚点已由 .register-box 变为 AuthCard 的 .auth-card（同为 position:relative）。 -->
        <div class="hp-field" aria-hidden="true">
          <label for="reg-hp-note">备注</label>
          <input
            id="reg-hp-note"
            v-model="form.hp_note"
            type="text"
            name="hp_note"
            tabindex="-1"
            autocomplete="off"
          />
        </div>

        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="userStore.loading"
            :disabled="!regReady"
            class="auth-submit"
            @click="handleRegister"
          >
            注 册
          </el-button>
        </el-form-item>
      </el-form>

      <template #footer>
        <span>已有账号？</span>
        <router-link to="/login">立即登录</router-link>
      </template>
    </AuthCard>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { User, Lock, Message } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import AuthBackground from '@/components/AuthBackground.vue'
import AuthCard from '@/components/AuthCard.vue'
import { useFormErrorA11y } from '@/utils/useFormErrorA11y'

/* v1.13.361：字段级校验的可访问性（活区 + aria-invalid/aria-describedby）。
   四个 prop 必须与 el-form-item 的 prop 逐字一致，否则 @validate 的事件被静默忽略。
   前缀 'reg' 保证错误节点 id 唯一（同页其他地方不会撞）。 */
const { liveErr, onValidate, errId, fieldAria } = useFormErrorA11y(
  ['username', 'email', 'password', 'confirmPassword'],
  'reg'
)

const router = useRouter()
const userStore = useUserStore()
const formRef = ref(null)

// v1.13.149 注册防护：票据（证明「确实打开过注册页并停留了合理时长」）
// 与 regReady（与服务端最短停留对齐的按钮闸门，正常用户无感）见 utils/registerGuard.js
const regTicket = ref('')
const regReady = ref(true)
let ticketTimer = null

const loadRegisterTicket = async () => {
  try {
    const { data } = await axios.get('/api/auth/register-ticket')
    if (!data?.ticket) return
    regTicket.value = data.ticket
    // 服务端票据的签发时刻早于本端收到时刻 ⇒ 本端计时天然更保守，不会误伤
    regReady.value = false
    clearTimeout(ticketTimer)
    ticketTimer = setTimeout(() => { regReady.value = true }, Number(data.minFillMs) || 1500)
  } catch (e) {
    // 拉票失败**不锁死 UI**：保持可提交，由服务端给出明确提示；下次提交前会再试
    console.warn('[register] 获取注册票据失败:', e?.message || e)
  }
}

onMounted(loadRegisterTicket)
onBeforeUnmount(() => clearTimeout(ticketTimer))

// v1.13.133：密码显隐开关状态（替代 EP 的 show-password，详见 assets/main.scss .pwd-toggle）
const pwdShow = reactive({ password: false, confirmPassword: false })

const form = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  // 蜜罐字段（v1.13.149）：正常用户看不到也不会填；**刻意不参与 el-form rules**
  hp_note: ''
})

const validateConfirmPassword = (rule, value, callback) => {
  if (value !== form.password) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度为 3-20 个字符', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 个字符', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' }
  ]
}

const handleRegister = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  const result = await userStore.register(form.username, form.email, form.password, {
    ticket: regTicket.value,
    hp_note: form.hp_note
  })
  if (result.success) {
    ElMessage.success('注册成功，请登录')
    router.push('/login')
    return
  }

  // 票据类失败（缺失/过快/过期）：静默补一张新票，用户再点一次即可成功
  if (String(result.code || '').startsWith('ticket_')) {
    const expired = result.code === 'ticket_expired'
    await loadRegisterTicket()
    ElMessage.warning(expired
      ? '页面停留过久，凭据已自动续期，请再点一次「注册」'
      : result.message)
    return
  }

  ElMessage.error(result.message)
}
</script>

<style lang="scss" scoped>
/* 容器（.auth-container）、卡片（AuthCard.vue）、主按钮（.auth-submit）均为共用样式 */

// 蜜罐（v1.13.149）：刻意用「移出视口」而非 display:none —— 保持它在渲染树里，
// 让脚本「看得见并去填」，同时对人和读屏完全不可见（配合 tabindex=-1 + aria-hidden）
.hp-field {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
</style>
