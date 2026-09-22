<template>
  <!-- 悬浮按钮 -->
  <div class="ai-fab" :class="{ active: visible }" @click="visible = !visible" title="AI 助手">
    <el-icon v-if="!visible" class="fab-icon"><ChatDotRound /></el-icon>
    <el-icon v-else class="fab-icon"><Close /></el-icon>
    <span class="fab-label">AI</span>
  </div>

  <!-- 语言切换（AI 按钮下方，圆形参照 AI 按钮） -->
  <el-dropdown trigger="click" @command="(lang) => setAppLocale(lang)" class="ai-lang">
    <div class="ai-lang-fab" :title="langTitle" :aria-label="$t('common.switchLanguage')">
      <span class="fab-label">{{ langShort }}</span>
    </div>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="zh">中文</el-dropdown-item>
        <el-dropdown-item command="ja">日本語</el-dropdown-item>
        <el-dropdown-item command="en">English</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>

  <!-- 对话框 -->
  <transition name="ai-slide">
    <div v-if="visible" class="ai-panel">
      <div class="ai-header">
        <div class="ai-header-left">
          <div class="ai-avatar">
            <el-icon><MagicStick /></el-icon>
          </div>
          <div>
            <div class="ai-title">AI 操作助手</div>
          </div>
          <!-- v1.13.163：本机指引命中计数（仅管理员可见）——
               用于判断「操作指引」这条链路接住了多少提问，是否值得扩充 FAQ。
               命中率 = 本计数 ÷ (本计数 + ai_usage 中 endpoint='chat' 的行数)。 -->
          <span
            v-if="userStore.isAdmin && faqHitCount > 0"
            class="faq-hit-counter"
            :title="`本机操作指引已接住 ${faqHitCount} 次提问（未消耗 AI 额度、未调用豆包）`"
          >指引 ×{{ faqHitCount }}</span>
        </div>
        <el-button type="info" link size="small" @click="clearMessages">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>

      <div class="ai-messages" ref="messagesRef">
        <!-- 欢迎消息 -->
        <div v-if="messages.length === 0" class="ai-welcome">
          <div class="welcome-icon"><el-icon><MagicStick /></el-icon></div>
          <div class="welcome-text">你好！我是 AI 操作助手</div>
          <div class="welcome-sub">用自然语言告诉我你想做什么</div>
          <!-- 组①：本机操作指引（零 token）。单独分组并标注「不消耗额度」，
               既让用户敢点，也把使用习惯往这条最省的链路上引。 -->
          <div class="quick-group">
            <div class="quick-group-label">🔧 系统操作指引 · 不消耗额度</div>
            <div class="quick-actions">
              <div
                v-for="q in faqQuickQuestions"
                :key="q"
                class="quick-chip quick-chip--faq"
                @click="sendMessage(q)"
              >{{ q }}</div>
            </div>
          </div>
          <!-- 组②：需要 AI 真正执行的动作示例 -->
          <div class="quick-group">
            <div class="quick-group-label">⚡ 试试直接对我说</div>
            <div class="quick-actions">
              <div
                v-for="q in actionQuickQuestions"
                :key="q"
                class="quick-chip"
                @click="sendMessage(q)"
              >{{ q }}</div>
            </div>
          </div>
        </div>

        <!-- 对话消息 -->
        <div
          v-for="(msg, idx) in messages"
          :key="idx"
          class="ai-message"
          :class="msg.role"
        >
          <div v-if="msg.role === 'assistant'" class="msg-avatar">
            <el-icon><MagicStick /></el-icon>
          </div>
          <div class="msg-bubble" :class="{ 'faq-bubble': msg.faq }">
            <!-- 操作指引卡片：内容来自内置文案（非模型生成），不消耗 AI 额度 -->
            <div v-if="msg.faq" class="msg-faq">
              <div class="msg-faq-head">
                <span class="msg-faq-title">{{ msg.faq.icon }} {{ msg.faq.title }}</span>
                <span class="msg-faq-badge">未消耗 AI 额度</span>
              </div>
              <ol class="msg-faq-steps">
                <li v-for="(s, i) in msg.faq.steps" :key="i" v-html="formatContent(s)"></li>
              </ol>
              <div v-if="msg.faq.note" class="msg-faq-note" v-html="formatContent(msg.faq.note)"></div>
            </div>
            <div v-else class="msg-text" v-html="formatContent(msg.content)"></div>
            <div v-if="msg.actions && msg.actions.length" class="msg-actions">
              <span v-for="a in msg.actions" :key="a" class="action-tag">✓ {{ a }}</span>
            </div>
          </div>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="ai-message assistant">
          <div class="msg-avatar"><el-icon><MagicStick /></el-icon></div>
          <div class="msg-bubble loading">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>

      <div class="ai-input-area">
        <el-input
          v-model="inputText"
          placeholder="输入指令，如：显示北京的已开业门店"
          :disabled="loading"
          size="default"
          @keyup.enter.exact="handleSend"
        >
          <template #suffix>
            <el-button
              type="primary"
              link
              :disabled="!inputText.trim() || loading"
              @click="handleSend"
            >
              <el-icon><Position /></el-icon>
            </el-button>
          </template>
        </el-input>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChatDotRound, Close, MagicStick, Delete, Position } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import { setAppLocale } from '@/i18n'
import { getActionDescription } from '@/utils/aiExecutor'
import { matchFaq, listFaqs } from '@/utils/faqMatch'

const { locale } = useI18n()
// 语言按钮缩写：中 / 日 / EN
const langShort = computed(() => {
  if (locale.value === 'ja') return '日'
  if (locale.value === 'en') return 'EN'
  return '中'
})
const langTitle = computed(() => {
  if (locale.value === 'en') return 'Language'
  if (locale.value === 'ja') return '言語'
  return '语言'
})

const props = defineProps({
  // 当前地图上下文（门店数量统计等）
  context: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['execute'])

const userStore = useUserStore()
const visible = ref(false)
const loading = ref(false)
const inputText = ref('')
const messages = ref([])
const messagesRef = ref(null)

const MAX_HISTORY = 12  // 多轮对话历史条数（v1.7.35 从6提升至12，配合localStorage持久化）
const MAX_TOTAL_MSGS = 24  // 总消息上限

// ===== 对话历史持久化（localStorage，按用户隔离） =====
const HISTORY_KEY = 'aiChatHistory'

const historyStorageKey = () => {
  const uid = localStorage.getItem('userId') || 'anonymous'
  return `${HISTORY_KEY}_${uid}`
}

// ===== 本机操作指引（FAQ）命中计数 =====
// 只存本地（按用户隔离），**不发请求、不写库** ⇒ 保持「命中即零网络」；
// 用途：运营者据此判断这条链路接住了多少提问、是否值得扩充 FAQ。
const FAQ_HIT_KEY = 'aiFaqHits'
const faqHitStorageKey = () => {
  const uid = localStorage.getItem('userId') || 'anonymous'
  return `${FAQ_HIT_KEY}_${uid}`
}
const faqHitCount = ref(0)
const loadFaqHits = () => {
  try {
    faqHitCount.value = Number(localStorage.getItem(faqHitStorageKey())) || 0
  } catch (e) {
    faqHitCount.value = 0
  }
}
const bumpFaqHits = () => {
  faqHitCount.value += 1
  try {
    localStorage.setItem(faqHitStorageKey(), String(faqHitCount.value))
  } catch (e) {}
}

// 加载历史（恢复 user/assistant；操作指引卡片连同 faq 结构一起恢复）
const loadHistory = () => {
  try {
    const raw = localStorage.getItem(historyStorageKey())
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(m => m && (m.role === 'user' || m.role === 'assistant')
        && (typeof m.content === 'string' || (m.faq && Array.isArray(m.faq.steps))))
      .slice(-MAX_TOTAL_MSGS)
  } catch (e) {
    return []
  }
}

// 保存历史（仅 user/assistant，不存 actions/工具调用大对象；
// ⚠️ 但**必须保留 faq 卡片**，否则刷新后指引卡片退化成空气泡 —— v1.13.163）
const saveHistory = () => {
  try {
    const slim = messages.value
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .map(m => (m.faq
        ? { role: m.role, content: '', faq: m.faq }
        : { role: m.role, content: m.content }))
      .filter(m => (typeof m.content === 'string' && m.content) || m.faq)
      .slice(-MAX_TOTAL_MSGS)
    localStorage.setItem(historyStorageKey(), JSON.stringify(slim))
  } catch (e) {
    console.error('保存AI对话历史失败:', e)
  }
}

// 组件挂载时恢复历史
onMounted(() => {
  loadFaqHits()
  const restored = loadHistory()
  if (restored.length > 0) {
    messages.value = restored
  }
})

// 消息变化时自动保存（防抖 500ms）
let saveTimer = null
watch(messages, () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveHistory, 500)
}, { deep: true })


// ===== 欢迎页快捷问句（v1.13.164 分两组） =====
// 组①：本机操作指引 —— **命中即在本地作答、完全不发请求**（零 token、零额度）。
//   问句直接由 FAQ 表派生（`listFaqs()`），这样「新增了一条 FAQ 却忘了加快捷问句」
//   或「问句改了导致点不中自己那条」都会被单测 F 组当场抓住。
// 组②：真正要 AI 执行的动作示例 —— 展示助手的能力面（会花钱，故排在指引之后）。
const faqQuickQuestions = listFaqs().map(f => f.question)

const actionQuickQuestions = [
  '显示北京的已开业门店',
  '对比星巴克国贸店和望京店的人口',
  '开启热力图',
  '清除所有筛选条件',
  '隐藏竞品门店图层',
  '定位到上海'
]

// 格式化消息内容（支持简单Markdown）
function formatContent(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // 代码块 ```code```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  // 行内代码 `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // 加粗 **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  // 无序列表 - item
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  // 有序列表 1. item
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
  // 换行
  html = html.replace(/\n/g, '<br>')
  // 合并连续的<br></li><br>清理
  html = html.replace(/<br><\/(ul|li)>/g, '</$1>')
  html = html.replace(/<\/(ul|li)><br>/g, '</$1>')
  return html
}

// 滚动到底部
async function scrollToBottom() {
  await nextTick()
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
}

watch(messages, () => scrollToBottom(), { deep: true })

// 清空对话
function clearMessages() {
  messages.value = []
  try {
    localStorage.removeItem(historyStorageKey())
  } catch (e) {}
}

// 发送消息
async function sendMessage(text) {
  if (!text.trim()) return
  inputText.value = ''

  messages.value.push({ role: 'user', content: text })
  // 超上限时丢弃最早的消息
  if (messages.value.length > MAX_TOTAL_MSGS) {
    messages.value.splice(0, messages.value.length - MAX_TOTAL_MSGS)
  }

  // ★ 操作指引（FAQ）本机命中 ⇒ 直接作答，**不调用豆包**：
  //   零 token、不写 ai_usage、不占额度；路径来自内置文案，不会像模型那样编出不存在的入口。
  //   判据见 utils/faqMatch.js（原则：宁可漏拦，不可误伤真指令）。
  const faq = matchFaq(text, { orgRole: userStore.orgRole })
  if (faq) {
    messages.value.push({ role: 'assistant', content: '', faq })
    bumpFaqHits()
    return
  }

  loading.value = true

  try {
    // 构建精简历史（最近 MAX_HISTORY 条）
    const recentMsgs = messages.value
      .slice(-MAX_HISTORY - 1, -1)
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }))

    recentMsgs.push({ role: 'user', content: text })

    // 精简 context：只传必要的字段
    const slimContext = {
      storeCount: props.context.storeCount,
      viewport: props.context.viewport,
      currentCity: props.context.currentCity
    }

    const token = userStore.token
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: recentMsgs,
        context: slimContext,
        max_tokens: 800
      })
    })

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.message || 'AI 服务异常')
    }

    if (result.type === 'tool_calls') {
      // 有工具调用，交给父组件（MapView）执行
      const actionDescriptions = []

      for (const tc of result.tool_calls) {
        const desc = getActionDescription(tc.name, tc.args)
        actionDescriptions.push(desc)
        emit('execute', tc)
      }

      messages.value.push({
        role: 'assistant',
        content: '好的，我来帮您操作：',
        actions: actionDescriptions
      })

    } else {
      // 普通文字回复
      messages.value.push({
        role: 'assistant',
        content: result.content
      })
    }

  } catch (error) {
    messages.value.push({
      role: 'assistant',
      content: `抱歉，出现了错误：${error.message}`
    })
  } finally {
    loading.value = false
  }
}

function handleSend() {
  if (inputText.value.trim() && !loading.value) {
    sendMessage(inputText.value.trim())
  }
}

// 对外暴露：接收 AI 执行结果反馈
function addFeedback(text) {
  messages.value.push({ role: 'assistant', content: text })
}

defineExpose({ addFeedback, visible })
</script>

<style scoped>
/* 语言切换（AI 按钮下方，圆形参照 AI 按钮，蓝色系区分） */
.ai-lang {
  position: fixed;
  top: 236px;  /* AI 按钮(180+48) 下方留 8px */
  left: 18px;
  z-index: 1199;
}
.ai-lang-fab {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #06b6d4);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
  transition: all 0.25s;
  user-select: none;
  &:hover {
    transform: scale(1.08);
    box-shadow: 0 6px 18px rgba(59, 130, 246, 0.5);
  }
  .fab-label {
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
  }
}
/* 悬浮按钮 */
.ai-fab {
  position: fixed;
  top: 180px;
  left: 18px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.45);
  z-index: 1200;
  transition: all 0.25s;
  user-select: none;

  &:hover {
    transform: scale(1.08);
    box-shadow: 0 6px 20px rgba(99, 102, 241, 0.55);
  }

  &.active {
    background: linear-gradient(135deg, #4f46e5, #7c3aed);
  }

  .fab-icon {
    font-size: 20px;
  }

  .fab-label {
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    margin-top: 1px;
  }
}

/* 对话面板 */
.ai-panel {
  position: fixed;
  top: 240px;
  left: 18px;
  width: 360px;
  height: 520px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  z-index: 1199;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

.ai-header {
  padding: 14px 16px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;

  .ai-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .ai-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
  }

  .ai-title {
    font-size: 14px;
    font-weight: 600;
  }

  .ai-subtitle {
    font-size: 11px;
    opacity: 0.8;
    margin-top: 1px;
  }

  :deep(.el-button) {
    color: rgba(255, 255, 255, 0.8) !important;
    &:hover { color: #fff !important; }
  }
}

.ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #f9fafb;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 2px;
  }
}

/* 欢迎页 */
.ai-welcome {
  text-align: center;
  padding: 16px 8px;

  .welcome-icon {
    font-size: 36px;
    color: #8b5cf6;
    margin-bottom: 8px;
  }

  .welcome-text {
    font-size: 15px;
    font-weight: 600;
    color: #111827;
    margin-bottom: 4px;
  }

  .welcome-sub {
    font-size: 12px;
    color: #9ca3af;
    margin-bottom: 14px;
  }

  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }

  /* 两组快捷问句的分组容器与标签（v1.13.164） */
  .quick-group {
    margin-bottom: 10px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  .quick-group-label {
    font-size: 11px;
    color: #9ca3af;
    margin-bottom: 6px;
    letter-spacing: 0.2px;
  }

  .quick-chip {
    padding: 5px 10px;
    background: #ede9fe;
    color: #6d28d9;
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: #8b5cf6;
      color: #fff;
    }
  }

  /* 操作指引组：白底 + 淡紫描边，与「要花钱的动作示例」在视觉上区分开（v1.13.164） */
  .quick-chip--faq {
    background: #fff;
    color: #7c3aed;
    border: 1px solid #e9d5ff;
  }
}

/* 消息气泡 */
.ai-message {
  display: flex;
  gap: 8px;
  align-items: flex-start;

  &.user {
    flex-direction: row-reverse;

    .msg-bubble {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      border-radius: 16px 4px 16px 16px;
      max-width: 80%;
    }
  }

  &.assistant {
    .msg-bubble {
      background: #fff;
      color: #111827;
      border-radius: 4px 16px 16px 16px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      max-width: 85%;
    }
  }

  .msg-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }

  .msg-bubble {
    padding: 9px 12px;
    font-size: 13px;
    line-height: 1.6;
    word-break: break-word;

    :deep(code) {
      background: #f3f4f6;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 12px;
      font-family: monospace;
      color: #e11d48;
    }

    :deep(pre) {
      background: #1f2937;
      color: #e5e7eb;
      padding: 10px 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
      margin: 6px 0;

      code {
        background: none;
        color: inherit;
        padding: 0;
        font-size: inherit;
      }
    }

    :deep(ul) {
      margin: 4px 0;
      padding-left: 20px;

      li { margin-bottom: 2px; }
    }

    :deep(strong) { font-weight: 600; }
  }

  /* 本机指引命中计数（仅管理员可见，v1.13.163） */
  .faq-hit-counter {
    margin-left: 6px;
    flex-shrink: 0;
    font-size: 10px;
    line-height: 1.5;
    color: #7c3aed;
    background: #f5f3ff;
    border: 1px solid #ddd6fe;
    border-radius: 999px;
    padding: 1px 6px;
    white-space: nowrap;
    cursor: help;
  }

  /* 操作指引卡片（v1.13.163）—— 内容来自内置文案，不消耗 AI 额度 */
  .msg-bubble.faq-bubble {
    background: #faf5ff;
    border: 1px solid #e9d5ff;
  }

  .msg-faq-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 6px;
    margin-bottom: 7px;
    border-bottom: 1px dashed #ddd6fe;
  }

  .msg-faq-title {
    font-weight: 600;
    font-size: 13px;
    color: #5b21b6;
  }

  .msg-faq-badge {
    flex-shrink: 0;
    font-size: 10px;
    line-height: 1.5;
    color: #047857;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    padding: 1px 6px;
    border-radius: 999px;
  }

  .msg-faq-steps {
    margin: 0;
    padding-left: 18px;
    font-size: 12.5px;
    line-height: 1.75;
    color: #374151;

    li { margin-bottom: 4px; }
    li:last-child { margin-bottom: 0; }
  }

  /* 行内代码（字段名 / 文件名，v1.13.164 起文案里用得更多）——
     默认 monospace 在 12px 正文里太抢，收一点并加淡紫底，读起来才知道是「要照着填的东西」 */
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(124, 58, 237, 0.09);
    color: #6d28d9;
  }

  .msg-faq-note {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px dashed #e5e7eb;
    font-size: 11.5px;
    line-height: 1.6;
    color: #6b7280;
  }

  .msg-actions {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .action-tag {
    font-size: 11px;
    color: #059669;
    background: #ecfdf5;
    padding: 2px 8px;
    border-radius: 4px;
    display: inline-block;
  }
}

/* 加载动画 */
.msg-bubble.loading {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;

  span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8b5cf6;
    animation: bounce 1.2s infinite;

    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

/* 输入区域 */
.ai-input-area {
  padding: 10px 12px;
  border-top: 1px solid #f3f4f6;
  background: #fff;
  flex-shrink: 0;

  :deep(.el-input__wrapper) {
    border-radius: 24px;
    padding: 4px 8px 4px 14px;
  }
}

/* 动画 */
.ai-slide-enter-active,
.ai-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.ai-slide-enter-from,
.ai-slide-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
</style>
