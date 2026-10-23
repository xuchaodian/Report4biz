<template>
  <el-dialog
    :model-value="modelValue"
    title="意见反馈"
    width="440px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- 类型：只两种。⛔ 不做五级分类，用户分不清 -->
    <div class="fb-types">
      <div class="fb-type" :class="{ 'is-active': type === 'bug' }" role="button" tabindex="0"
           @click="type = 'bug'" @keydown.enter="type = 'bug'">用着有问题</div>
      <div class="fb-type" :class="{ 'is-active': type === 'idea' }" role="button" tabindex="0"
           @click="type = 'idea'" @keydown.enter="type = 'idea'">有改进建议</div>
    </div>

    <el-input
      v-model="content"
      type="textarea"
      :rows="6"
      maxlength="2000"
      show-word-limit
      resize="none"
      placeholder="说说你遇到的情况：&#10;· 你在做什么（比如「在看浦东的竞争强度」）&#10;· 你期望是什么&#10;· 实际发生了什么"
    />

    <!-- ⚠️ 这两行要让用户看到"我们自动记了什么"，既是知情也是免责 -->
    <p class="fb-hint">会自动带上：当前页面 · 账号 · 浏览器 · 屏幕尺寸<template v-if="sceneStepText"> · 引导位置（{{ sceneStepText }}）</template></p>
    <p v-if="email" class="fb-hint">如需回复，我们会发到 {{ email }}</p>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 若从场景引导里发起，带上场景与步骤 —— 这是本功能最有价值的上下文 */
  sceneKey: { type: String, default: '' },
  sceneStep: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const userStore = useUserStore()
const type = ref('bug')
const content = ref('')
const submitting = ref(false)

const email = computed(() => userStore.user?.email || '')
const sceneStepText = computed(() => {
  if (!props.sceneKey) return ''
  return props.sceneStep ? `${props.sceneKey} / ${props.sceneStep}` : props.sceneKey
})

const submit = async () => {
  const text = content.value.trim()
  if (!text) {
    ElMessage.warning('请先写点内容再提交')
    return
  }
  if (submitting.value) return
  submitting.value = true
  try {
    await axios.post('/api/feedbacks', {
      type: type.value,
      content: text,
      // 以下全部自动采集 —— 用户不用填，也不该被要求填
      page_path: window.location.pathname,
      scene_key: props.sceneKey || '',
      scene_step: props.sceneStep || '',
      user_agent: navigator.userAgent.slice(0, 300),
      screen: `${window.screen.width}x${window.screen.height}`
    }, {
      headers: { Authorization: `Bearer ${userStore.token}` },
      timeout: 15000
    })
    ElMessage.success('反馈已提交，谢谢！')
    content.value = ''
    type.value = 'bug'
    emit('update:modelValue', false)
  } catch (e) {
    // 429 是限流，要把服务端的话原样给用户（"反馈太频繁了"比"提交失败"有用）
    const msg = e?.response?.data?.message || '提交失败，请稍后重试'
    ElMessage.error(msg)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
/* ⚠️ 只用单类选择器：el-dialog 带 append-to-body，嵌套写法容易踩 scopeId 的坑 */
.fb-types {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.fb-type {
  flex: 1;
  padding: 9px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  text-align: center;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.fb-type:hover {
  border-color: #a0cfff;
}
.fb-type.is-active {
  border-color: #409eff;
  background: #f4f8fe;
  color: #1677d2;
  font-weight: 500;
}
.fb-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
</style>
