<template>
  <!-- 悬浮按钮 -->
  <div class="ai-fab" :class="{ active: visible }" @click="visible = !visible" title="AI 助手">
    <el-icon v-if="!visible" class="fab-icon"><ChatDotRound /></el-icon>
    <el-icon v-else class="fab-icon"><Close /></el-icon>
    <span class="fab-label">AI</span>
  </div>

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
          <div class="quick-actions">
            <div
              v-for="q in quickQuestions"
              :key="q"
              class="quick-chip"
              @click="sendMessage(q)"
            >{{ q }}</div>
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
          <div class="msg-bubble">
            <div class="msg-text" v-html="formatContent(msg.content)"></div>
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
import { ref, nextTick, watch } from 'vue'
import { ChatDotRound, Close, MagicStick, Delete, Position } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import { getActionDescription } from '@/utils/aiExecutor'

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

const quickQuestions = [
  '显示北京的已开业门店',
  '对比星巴克国贸店和望京店的人口',
  '开启热力图',
  '清除所有筛选条件',
  '隐藏竞品门店图层',
  '定位到上海'
]

// 格式化消息内容（简单换行处理）
function formatContent(text) {
  if (!text) return ''
  return text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
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
}

// 发送消息
async function sendMessage(text) {
  if (!text.trim()) return
  inputText.value = ''

  messages.value.push({ role: 'user', content: text })
  loading.value = true

  try {
    // 构建历史消息（最多保留最近8条）
    const historyMessages = messages.value
      .slice(-9, -1)
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }))

    historyMessages.push({ role: 'user', content: text })

    const token = userStore.token
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: historyMessages,
        context: props.context
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
