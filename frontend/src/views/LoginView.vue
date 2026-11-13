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
        v-if="!needTotp"
        ref="formRef"
        :model="form"
        :rules="rules"
        class="login-form"
        @submit.prevent="handleLogin"
        @validate="onValidate"
      >
        <!-- E1（v1.13.358）：EP 2.13.7 的 form-item 不写 role，校验错误对读屏完全不可感知
             （实测：.el-form-item__error 无 role/aria-live，input 无 aria-invalid/aria-describedby）。
             role 是属性、不能用 CSS 补，只能在 Vue 侧自己加：
               · role="alert" 活区负责「出错瞬间主动播报」
               · aria-describedby 指向每字段的隐藏错误文本，负责「聚焦时能听到原因」
             ⚠️ 活区必须用 clip 隐藏，⛔ 不能用 display:none / visibility:hidden
                （把元素移出无障碍树 = 活区失效，loginA11yGuard 钉住）。 -->
        <div class="login-sr-only" role="alert" aria-live="assertive">{{ liveErr }}</div>

        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            :placeholder="$t('login.username')"
            :aria-label="$t('login.usernameLabel')"
            :aria-invalid="fieldErr.username ? 'true' : undefined"
            :aria-describedby="fieldErr.username ? 'login-err-username' : undefined"
            name="username"
            autocomplete="username"
            size="large"
            :prefix-icon="User"
          />
          <!-- ⭐ 用 #error 插槽接管 EP 的默认错误节点：给了插槽 EP 就不再渲染自己那个
               <div class="el-form-item__error">（form-item...lang.mjs:271-274），
               所以文案只有**一份**，且我们能给它 id 供 aria-describedby 指过去。
               ⛔ 两个都留 = 读屏把同一句错误念两遍（实测踩过）。 -->
          <template #error="{ error }">
            <div id="login-err-username" class="el-form-item__error">{{ error }}</div>
          </template>
        </el-form-item>

        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            :type="pwdShow.password ? 'text' : 'password'"
            :placeholder="$t('login.password')"
            :aria-label="$t('login.passwordLabel')"
            :aria-invalid="fieldErr.password ? 'true' : undefined"
            :aria-describedby="fieldErr.password ? 'login-err-password' : undefined"
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
          <template #error="{ error }">
            <div id="login-err-password" class="el-form-item__error">{{ error }}</div>
          </template>
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

      <!-- 两步验证第二步（v1.13.321）
           ⚠️ v-if / v-else 必须**紧邻**：中间插任何元素都会让 v-else 失配。 -->
      <el-form v-else class="login-form" @submit.prevent="handleTotp">
        <p class="totp-hint">{{ $t('login.totpHint') }}</p>
        <el-form-item>
          <el-input
            v-model="totpCode"
            size="large"
            maxlength="10"
            :placeholder="$t('login.totpPlaceholder')"
            :aria-label="$t('login.totpLabel')"
            autocomplete="one-time-code"
            :prefix-icon="Key"
            @keyup.enter="handleTotp"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="userStore.loading"
            class="auth-submit"
            @click="handleTotp"
          >
            {{ $t('login.totpSubmit') }}
          </el-button>
        </el-form-item>
        <div class="totp-back">
          <el-button link @click="backToPassword">{{ $t('login.totpBack') }}</el-button>
        </div>
      </el-form>

      <template #footer>
        <span>{{ $t('login.noAccount') }}</span>
        <router-link to="/register">{{ $t('login.register') }}</router-link>
        <a href="/help/" target="_blank" rel="noopener" style="margin-left:14px;color:#0d579c;text-decoration:none;">使用手册</a>
      </template>
    </AuthCard>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { User, Lock, ChatLineRound, Key } from '@element-plus/icons-vue'
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

/* ===== 校验错误的可访问性（E1 / v1.13.358）=====
   EP 的 form-item 只把错误渲染成一个无 role 的 div，读屏既不会主动播报、
   聚焦时也拿不到原因。这里接 @validate 把 EP 自己的校验消息收下来复用：
     · ⛔ 不自己编文案（两套文案必然与 EP 可视错误漂移）
     · 消息本身已走 rules 里的 t()，语言切换自动跟随 */
const fieldErr = reactive({ username: '', password: '' })

/** 主动播报用：多字段同时错时给一句合并文案（同一 tick 内 EP 会连续 emit，Vue 会批到一次 DOM 更新）。 */
const liveErr = computed(() => {
  const list = [fieldErr.username, fieldErr.password].filter(Boolean)
  if (!list.length) return ''
  const sep = locale.value === 'ja' ? '。' : locale.value === 'en' ? '; ' : '；'
  return list.join(sep)
})

/** EP @validate 签名：(prop, isValid, message)。此处只认本表单的两个字段。 */
const onValidate = (prop, isValid, message) => {
  if (prop !== 'username' && prop !== 'password') return
  fieldErr[prop] = isValid ? '' : message || ''
}

// 背景轮播逻辑已抽到 components/AuthBackground.vue（v1.13.151），四页共用

// 两步验证第二步（v1.13.321）
// needTotp 为真时密码已验过，但**还没登录**（后端只发了 5 分钟票据）
const needTotp = ref(false)
const totpCode = ref('')
const totpTicket = ref('')
const totpUsername = ref('')

const handleLogin = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  const result = await userStore.login(form.username, form.password)
  if (result.success) {
    ElMessage.success(t('login.success'))
    // 管理员账号定位为运维入口（用户管理），登录后直接落地「用户管理」
    router.push(userStore.isAdmin ? '/users' : '/')
    return
  }
  // 🔴 开了两步验证：不是失败，是「还差一步」。绝不能在这里提示"登录失败"把人劝退。
  if (result.needTotp) {
    totpTicket.value = result.ticket
    totpUsername.value = result.username || form.username
    totpCode.value = ''
    needTotp.value = true
    return
  }
  ElMessage.error(result.message)
}

const handleTotp = async () => {
  const code = totpCode.value.trim()
  if (!code) {
    ElMessage.warning(t('login.totpPlaceholder'))
    return
  }

  const result = await userStore.loginTotp(totpTicket.value, code)
  if (result.success) {
    ElMessage.success(result.message || t('login.success'))
    // 用恢复码登录 ⇒ 提醒立刻补一组（这是 Telegram/Google 一致的提示口径）
    if (result.usedRecovery) {
      ElMessage.warning(`该恢复码已作废，还剩 ${result.remainingRecoveryCodes ?? 0} 张，建议尽快重新生成`)
    }
    router.push(userStore.isAdmin ? '/users' : '/')
    return
  }
  // 票据过期（5 分钟）⇒ 退回第一步，让用户重新输密码换票
  if (/超时|重新登录/.test(result.message || '')) {
    needTotp.value = false
    totpCode.value = ''
    ElMessage.warning(result.message)
    return
  }
  ElMessage.error(result.message)
}

const backToPassword = () => {
  needTotp.value = false
  totpCode.value = ''
  totpTicket.value = ''
}
</script>

<style lang="scss" scoped>
/* 容器（.auth-container）与主按钮（.auth-submit）样式在 assets/main.scss —— 四页共用 */

/* E1（v1.13.358）：视觉隐藏但**留在无障碍树里**。
   🔴 绝不能用 display:none / visibility:hidden —— 那样 role="alert" 活区会一起失效，
      比不加还糟（读屏什么都不播，而代码看着"已经修了"）。 */
.login-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

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

/* 两步验证（v1.13.321）：提示文案要压在验证码输入框上方，说明"为什么突然要输码" */
.totp-hint {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
  color: #5a6b80;
  background: #f2f7fd;
  border-left: 3px solid var(--brand-primary);
  border-radius: 4px;
  padding: 9px 12px;
}
.totp-back {
  text-align: center;
  margin-top: -6px;
}

.login-forgot {
  text-align: right;
  margin: -6px 0 14px;

  a {
    color: var(--brand-primary);
    font-size: 13px;
    /* v1.13.173（WCAG 1.4.1 不能仅靠颜色区分）：原静置态 text-decoration:none，
       与周围内容仅靠颜色区分 ⇒ 改为常显 1px 下划线 + 3px 偏移；悬停加粗到 2px 作反馈。
       与 AuthCard.vue 页脚链接同规格（.auth-card__footer :deep(a)）。 */
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;

    &:hover {
      text-decoration-thickness: 2px;
    }
  }
}
</style>
