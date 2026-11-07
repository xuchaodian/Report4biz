<template>
  <el-card class="twofa-card" shadow="never">
    <template #header>
      <div class="twofa-head">
        <span class="twofa-title">
          <el-icon><Lock /></el-icon>
          两步验证
        </span>
        <el-tag v-if="enabled" type="success" size="small" effect="light">已开启</el-tag>
        <el-tag v-else type="info" size="small" effect="light">未开启</el-tag>
      </div>
    </template>

    <div v-if="loading" class="twofa-loading">正在读取状态…</div>

    <!-- ── 已开启 ───────────────────────────────────────────── -->
    <template v-else-if="enabled">
      <p class="twofa-desc">
        登录时除密码外，还需输入身份验证器（Google / 微软 Authenticator、1Password 等）中的 6 位验证码。
      </p>
      <el-alert
        v-if="remainingCodes <= 2"
        type="warning"
        :closable="false"
        show-icon
        class="twofa-alert"
        title="恢复码快用完了"
        :description="`还剩 ${remainingCodes} 张。建议关闭后重新开启以生成一组新的。`"
      />
      <p class="twofa-meta">剩余恢复码：<strong>{{ remainingCodes }}</strong> 张</p>
      <el-button type="danger" plain @click="openDisable">关闭两步验证</el-button>
    </template>

    <!-- ── 未开启：初始 ─────────────────────────────────────── -->
    <template v-else-if="!setupData">
      <p class="twofa-desc">
        开启后，即使密码泄露，对方也无法登录你的账号 —— 这是保护管理后台最有效的一道防线。
      </p>
      <el-button type="primary" :loading="busy" @click="startSetup">开启两步验证</el-button>
    </template>

    <!-- ── 未开启：已生成密钥，等待用户添加并验证 ───────────── -->
    <template v-else>
      <p class="twofa-desc">
        请用身份验证器 App 选择
        <strong>「输入设置密钥」/「手动输入」</strong>，然后粘贴下面的密钥：
      </p>

      <div class="twofa-secret">
        <code>{{ setupData.secretGrouped }}</code>
        <el-button size="small" text @click="copySecret">复制</el-button>
      </div>

      <p class="twofa-hint">
        也可以复制这条链接在支持 otpauth 的 App 里打开：
      </p>
      <el-input :model-value="setupData.otpauthUri" readonly size="small" class="twofa-uri" />

      <el-form class="twofa-verify" @submit.prevent="confirmEnable">
        <el-form-item label="验证码">
          <el-input
            v-model="code"
            maxlength="6"
            placeholder="输入 App 上显示的 6 位数字"
            aria-label="两步验证码"
            autocomplete="one-time-code"
            class="twofa-code"
            @keyup.enter="confirmEnable"
          />
        </el-form-item>
        <el-button type="primary" :loading="busy" @click="confirmEnable">确认开启</el-button>
        <el-button text @click="cancelSetup">取消</el-button>
      </el-form>
    </template>

    <!-- 恢复码（只显示这一次） -->
    <el-dialog
      v-model="recoveryVisible"
      title="请保存你的恢复码"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      append-to-body
    >
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="这些恢复码只会显示这一次"
        description="手机丢失或更换设备时，用它们可以登录。请打印或存进密码管理器，每张只能用一次。"
      />
      <div class="recovery-grid">
        <code v-for="c in recoveryCodes" :key="c">{{ c }}</code>
      </div>
      <template #footer>
        <el-button @click="copyRecovery">复制全部</el-button>
        <el-button type="primary" @click="recoveryVisible = false">我已保存</el-button>
      </template>
    </el-dialog>

    <!-- 关闭确认（必须同时验密码 + 验证码） -->
    <el-dialog v-model="disableVisible" title="关闭两步验证" width="460px" append-to-body>
      <p class="twofa-desc">
        关闭后，登录只需要密码，<strong>安全强度会下降</strong>。请输入密码和当前验证码确认。
      </p>
      <el-form label-width="72px">
        <el-form-item label="密码">
          <el-input
            v-model="disableForm.password"
            type="password"
            show-password
            autocomplete="current-password"
            aria-label="登录密码"
          />
        </el-form-item>
        <el-form-item label="验证码">
          <el-input
            v-model="disableForm.code"
            maxlength="6"
            placeholder="App 上的 6 位数字"
            aria-label="两步验证码"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="disableVisible = false">取消</el-button>
        <el-button type="danger" :loading="busy" @click="confirmDisable">确认关闭</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
/**
 * 两步验证（TOTP）设置卡片 —— v1.13.321
 *
 * ⚠️ 刻意做成独立组件而不是塞进 MyAccountView.vue（那个文件已 5000+ 行）：
 *    在那种体量里插业务逻辑，改动风险和 review 成本都不划算。
 *
 * 🔴 三条与后端约定死的规则（改这里前先读）：
 *   ① 密钥只在 setup 响应里出现一次，**开启后前端不再有办法拿到** ——
 *      所以「已开启」状态只显示恢复码数量，不显示密钥（后端也不返回）。
 *   ② 关闭必须同时提交密码与验证码（后端强制），前端不给"只填验证码"的捷径。
 *   ③ 恢复码只在 enable 成功时返回一次，弹窗禁止点遮罩/ESC 关闭 ——
 *      误关就再也看不到了（只剩"关闭再重开"一条路）。
 */
import { ref, reactive, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { Lock } from '@element-plus/icons-vue'

const enabled = ref(false)
const remainingCodes = ref(0)
const loading = ref(true)
const busy = ref(false)

const setupData = ref(null)   // { secret, secretGrouped, otpauthUri }
const code = ref('')

const recoveryVisible = ref(false)
const recoveryCodes = ref([])

const disableVisible = ref(false)
const disableForm = reactive({ password: '', code: '' })

const loadStatus = async () => {
  loading.value = true
  try {
    const { data } = await axios.get('/api/auth/2fa/status')
    enabled.value = !!data.enabled
    remainingCodes.value = data.remainingRecoveryCodes ?? 0
  } catch (e) {
    // 401 由全局拦截器处理；这里只在其它错误时提示，避免重复弹窗
    if (e.response?.status !== 401) ElMessage.error('读取两步验证状态失败')
  } finally {
    loading.value = false
  }
}

const startSetup = async () => {
  busy.value = true
  try {
    const { data } = await axios.post('/api/auth/2fa/setup')
    setupData.value = data
    code.value = ''
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '生成密钥失败')
  } finally {
    busy.value = false
  }
}

const cancelSetup = () => {
  setupData.value = null
  code.value = ''
}

const confirmEnable = async () => {
  const c = String(code.value || '').trim()
  if (!/^\d{6}$/.test(c)) {
    ElMessage.warning('请输入 6 位数字验证码')
    return
  }
  busy.value = true
  try {
    const { data } = await axios.post('/api/auth/2fa/enable', { code: c })
    recoveryCodes.value = data.recoveryCodes || []
    setupData.value = null
    code.value = ''
    enabled.value = true
    remainingCodes.value = recoveryCodes.value.length
    recoveryVisible.value = true
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '开启失败')
  } finally {
    busy.value = false
  }
}

const openDisable = () => {
  disableForm.password = ''
  disableForm.code = ''
  disableVisible.value = true
}

const confirmDisable = async () => {
  if (!disableForm.password || !disableForm.code) {
    ElMessage.warning('请填写密码和验证码')
    return
  }
  busy.value = true
  try {
    const { data } = await axios.post('/api/auth/2fa/disable', {
      password: disableForm.password,
      code: disableForm.code,
    })
    // 后端在关闭后会回签一枚新 token（关闭动作本身不动 token_version，
    // 但回签能保证本地 token 一定是最新的角色/版本快照）
    if (data?.token) {
      sessionStorage.setItem('token', data.token)
      axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
    }
    enabled.value = false
    remainingCodes.value = 0
    disableVisible.value = false
    ElMessage.success('已关闭两步验证')
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '关闭失败')
  } finally {
    busy.value = false
  }
}

const copySecret = async () => {
  try {
    await navigator.clipboard.writeText(setupData.value?.secret || '')
    ElMessage.success('密钥已复制')
  } catch (e) {
    ElMessage.warning('复制失败，请手动选中密钥复制')
  }
}

const copyRecovery = async () => {
  try {
    await navigator.clipboard.writeText(recoveryCodes.value.join('\n'))
    ElMessage.success('恢复码已复制')
  } catch (e) {
    ElMessage.warning('复制失败，请手动抄写')
  }
}

onMounted(loadStatus)
</script>

<style scoped>
.twofa-card {
  /* v1.13.328：与账户页其它卡片对齐。
     原先只有 margin-bottom ⇒ 这张卡撑满内容区（实测 1234px），而 account-card / quota-card
     都是 max-width:600px 居中 ⇒ 一排卡里它宽出一倍，很突兀。
     ⚠️ 数值要与 MyAccountView 的 `.account-card` 保持一致，改一处要改两处。 */
  max-width: 600px;
  margin: 0 auto 20px auto;
}
.twofa-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.twofa-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #1f2d3d;
}
.twofa-loading {
  color: #909399;
  font-size: 13px;
}
.twofa-desc {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.7;
  color: #5a6b80;
}
.twofa-alert {
  margin-bottom: 12px;
}
.twofa-meta {
  margin: 0 0 12px;
  font-size: 13px;
  color: #5a6b80;
}
/* 密钥要便于人眼分组抄写：等宽字体 + 字间距，避免 0/O 看混 */
.twofa-secret {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.twofa-secret code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 15px;
  letter-spacing: 1.5px;
  color: #1f2d3d;
  word-break: break-all;
}
.twofa-hint {
  margin: 0 0 6px;
  font-size: 12px;
  color: #909399;
}
.twofa-uri {
  margin-bottom: 16px;
}
.twofa-verify {
  margin-top: 4px;
}
.twofa-code {
  max-width: 220px;
}
.recovery-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 16px 0 4px;
}
.recovery-grid code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  letter-spacing: 1px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 7px 10px;
  text-align: center;
  color: #1f2d3d;
}
</style>
