<template>
  <el-dialog
    :model-value="modelValue"
    title="分享给同事及领导"
    width="560px"
    append-to-body
    class="share-dlg"
    @update:model-value="$emit('update:modelValue', $event)"
    @opened="onOpened"
  >
    <div v-loading="loading">
      <!-- 说明：把"这条链接意味着什么"说在前面，⛔ 不要让用户点了才知道 -->
      <p class="sd-lead">
        链接<strong>免登录</strong>即可查看这份立项报告（含人口结构与商圈画像），
        有效期 <strong>30 天</strong>，可随时撤销。
      </p>

      <!-- 未生成 -->
      <div v-if="!share" class="sd-empty">
        <p>生成后可以复制链接发给对方，也可以直接填邮箱由系统发送。</p>
        <el-button type="primary" :loading="creating" @click="createShare">
          {{ creating ? '生成中…' : '生成分享链接' }}
        </el-button>
      </div>

      <!-- 已生成 -->
      <template v-else>
        <div class="sd-link">
          <el-input :model-value="share.url" readonly size="default" />
          <el-button type="primary" plain @click="copyLink">{{ copied ? '已复制' : '复制链接' }}</el-button>
        </div>

        <div class="sd-meta">
          <span :class="['sd-state', share.state]">{{ stateText }}</span>
          <span v-if="share.state === 'ok'">
            到期 {{ fmtDay(share.expiresAt) }}
            <template v-if="share.viewCount > 0"> · 已查看 {{ share.viewCount }} 次</template>
          </span>
        </div>

        <!-- 🔴 把"再次更新会覆盖同一条链接"说清楚：否则用户以为点了会多出一条，
             而同事手里那条还是旧内容 —— 这是本功能最容易让人误解的地方 -->
        <div class="sd-tip">
          <strong>报告更新了怎么办？</strong>
          点「更新链接内容」即可把这条链接换成当前报告（<strong>链接地址不变</strong>，
          已经发出去的照样能打开，看到的就是最新内容）。
        </div>

        <div class="sd-actions">
          <el-button size="small" :loading="updating" @click="updateShare">更新链接内容</el-button>
          <el-button size="small" type="danger" plain :loading="revoking" @click="revoke">撤销链接</el-button>
        </div>

        <el-divider class="sd-divider" />

        <!-- 邮件：只发链接，⛔ 不发附件（服务端出 PDF 附件要另起无头浏览器，成本不成比例） -->
        <div class="sd-mail">
          <div class="sd-mail-t">邮件发送</div>
          <el-input
            v-model="emailInput"
            type="textarea"
            :rows="2"
            maxlength="300"
            placeholder="收件人邮箱，多个用逗号或空格分隔（最多 10 位）"
          />
          <el-input
            v-model="note"
            size="small"
            maxlength="200"
            show-word-limit
            placeholder="附言（可选，例：南京西路这个点位，帮忙看下值不值得立项）"
            class="sd-note"
          />
          <div class="sd-mail-f">
            <span class="sd-mail-hint">邮件只含链接与有效期，不带任何账号或额度信息</span>
            <el-button type="primary" size="small" :loading="sending" @click="sendMail">发送邮件</el-button>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * 立项报告分享面板（v1.13.392）
 *
 * 业主 2026-11-20 定的交付形态：**链接 + 邮件发链接**（⛔ 不做 PDF 附件）。
 * 有效期 30 天，撤销入口就放在这里（报告弹窗内），不另开"我的分享"列表页。
 *
 * 🔴 三件事必须让用户在点之前就知道（文案已写死在模板里，⛔ 别为了简洁删掉）：
 *   ① 链接是**免登录**的 ⇒ 谁拿到都能看，含联通人口与商圈数据；
 *   ② 有效期 30 天，到期自动失效；可随时撤销，撤销后立即打不开；
 *   ③ 「更新链接内容」是**覆盖同一条链接**，不是再生成一条 ——
 *      这是「快照为主、可切最新」的落点：同事手里的链接不变，内容跟着刷新。
 *
 * ⚠️ 请求走 `utils/api.js`（自动带 token、响应已解包）；
 *    ⛔ 不要在这里用裸 axios —— 那会漏掉 Authorization，401 还要自己处理。
 */
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/utils/api.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  candidateId: { type: [Number, String], default: null },
  /** buildReportModel() 的结果 —— 原样存成快照 */
  model: { type: Object, default: null },
  mapImg: { type: String, default: '' },
  aiText: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

/** 有效期（天）——与后端 DEFAULT_DAYS 一致，业主定 30 */
const DAYS = 30

const loading = ref(false)
const creating = ref(false)
const updating = ref(false)
const revoking = ref(false)
const sending = ref(false)
const copied = ref(false)
const share = ref(null)
const emailInput = ref('')
const note = ref('')

const stateText = computed(() => {
  const s = share.value?.state
  if (s === 'revoked') return '已撤销'
  if (s === 'expired') return '已过期'
  return '链接有效'
})

function fmtDay(s) {
  const t = String(s || '').slice(0, 10)
  return t || '—'
}

function errMsg(e, fallback) {
  return e?.response?.data?.message || fallback
}

/** 打开时拉一次"这条点位现有的有效链接"（没有就显示"生成"） */
async function onOpened() {
  copied.value = false
  emailInput.value = ''
  note.value = ''
  if (!props.candidateId) { share.value = null; return }
  loading.value = true
  try {
    const data = await api.get('/report-shares', { params: { candidateId: props.candidateId } })
    const live = (data?.shares || []).find((s) => s.state === 'ok')
    share.value = live || null
  } catch (e) {
    share.value = null
  } finally {
    loading.value = false
  }
}

/** 组装快照请求体 —— 🔴 快照只放"纸面上看得见的东西"，⛔ 不放配额、账号、请求日志 */
function payload() {
  const m = props.model || {}
  return {
    candidateId: props.candidateId || null,
    title: String(m.projectName || '').slice(0, 120),
    snapshot: m,
    mapImg: props.mapImg || '',
    aiText: props.aiText || '',
    days: DAYS
  }
}

async function createShare() {
  if (creating.value) return
  if (!props.model) return ElMessage.warning('报告尚未生成，请稍后再试')
  creating.value = true
  try {
    const data = await api.post('/report-shares', payload())
    share.value = data.share
    ElMessage.success(data.message || '分享链接已生成')
  } catch (e) {
    ElMessage.error(errMsg(e, '生成分享链接失败'))
  } finally {
    creating.value = false
  }
}

async function updateShare() {
  if (updating.value) return
  try {
    await ElMessageBox.confirm(
      '将把这条链接的内容换成当前报告（链接地址不变）。\n\n' +
      '已经发出去的链接照样能打开，对方看到的就是更新后的内容。',
      '更新链接内容',
      { confirmButtonText: '更新', cancelButtonText: '取消', type: 'info' }
    )
  } catch { return }

  updating.value = true
  try {
    const data = await api.post('/report-shares', payload())
    share.value = data.share
    ElMessage.success('链接内容已更新，地址未变')
  } catch (e) {
    ElMessage.error(errMsg(e, '更新失败'))
  } finally {
    updating.value = false
  }
}

async function revoke() {
  if (revoking.value || !share.value) return
  try {
    await ElMessageBox.confirm(
      '撤销后这条链接立即打不开（对方会看到「已被发起人撤销」），且不可恢复。\n\n' +
      '如需继续分享，请重新生成一条新链接。',
      '撤销分享链接',
      { confirmButtonText: '确认撤销', cancelButtonText: '保留', type: 'warning' }
    )
  } catch { return }

  revoking.value = true
  try {
    await api.delete(`/report-shares/${share.value.id}`)
    ElMessage.success('已撤销，链接立即失效')
    share.value = null
  } catch (e) {
    ElMessage.error(errMsg(e, '撤销失败'))
  } finally {
    revoking.value = false
  }
}

/**
 * 复制链接。
 * 🔴 `navigator.clipboard` 只在 https / localhost 可用；线上是 https，没问题，
 *    但本地 http 调试会静默失败 ⇒ 必须留 execCommand 兜底，否则"点了没反应"。
 */
async function copyLink() {
  const url = share.value?.url
  if (!url) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
    } else {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copied.value = true
    ElMessage.success('链接已复制，可直接粘贴发送')
    setTimeout(() => { copied.value = false }, 2500)
  } catch {
    ElMessage.warning('复制失败，请手动选中链接复制')
  }
}

async function sendMail() {
  if (sending.value || !share.value) return
  const to = String(emailInput.value || '').split(/[,;，；\s]+/).map(s => s.trim()).filter(Boolean)
  if (!to.length) return ElMessage.warning('请填写收件人邮箱')
  if (to.length > 10) return ElMessage.warning('一次最多发送给 10 位收件人')

  sending.value = true
  try {
    const data = await api.post(`/report-shares/${share.value.id}/email`, { to, note: note.value.trim() })
    ElMessage.success(data?.message || '邮件已进入发送队列')
    note.value = ''
  } catch (e) {
    ElMessage.error(errMsg(e, '发送失败'))
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.sd-lead { margin: 0 0 14px; font-size: 13px; line-height: 1.7; color: var(--text-regular); }
.sd-lead strong { color: var(--text-primary); }

.sd-empty { padding: 8px 0 4px; }
.sd-empty p { margin: 0 0 12px; font-size: 13px; color: var(--text-secondary); }

.sd-link { display: flex; gap: 8px; align-items: center; }
.sd-link .el-input { flex: 1; }

.sd-meta { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--text-secondary); }
.sd-state { padding: 1px 7px; border-radius: 9px; font-size: 11px; }
.sd-state.ok { color: #16794a; background: #e8f6ee; }
.sd-state.expired { color: #b26a00; background: #fff6e5; }
.sd-state.revoked { color: #b42318; background: #fdecea; }

.sd-tip {
  margin-top: 12px; padding: 10px 12px; border-radius: 6px;
  background: #f4f8ff; border: 1px solid #d9e6fb;
  font-size: 12px; line-height: 1.7; color: var(--text-regular);
}
.sd-tip strong { color: var(--text-primary); }

.sd-actions { display: flex; gap: 8px; margin-top: 10px; }

.sd-divider { margin: 16px 0; }
.sd-mail-t { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }
.sd-note { margin-top: 8px; }
.sd-mail-f { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
.sd-mail-hint { font-size: 11.5px; color: var(--text-secondary); line-height: 1.5; }
</style>

<style>

/* 🔴 这段必须是**非 scoped**：el-dialog 的 class 落在被 teleport 到 body 的根节点上，
   scoped 的 [data-v-xxx] 属性不在那个节点，写在 scoped 块里等于没写。
   作用：小屏/笔记本（视口 577px 实测）时弹窗内容比视口高，没有内部滚动就够不到
   「发送邮件」按钮 —— 第一次真机验证就是这样把按钮裁掉了。 */
.share-dlg .el-dialog__body {
  max-height: 62vh;
  overflow-y: auto;
}
</style>
