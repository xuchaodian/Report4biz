<template>
  <el-dialog
    :model-value="modelValue"
    width="560px"
    class="quota-apply-dialog dialog-fancy"
    :close-on-click-modal="false"
    @update:model-value="(v) => emit('update:modelValue', v)"
    @closed="onClosed"
  >
    <template #header>
      <div class="dialog-header-fancy">
        <span class="dhf-icon" style="background:#faeeda;color:#916012;"><AppIcon><ShoppingCart /></AppIcon></span>
        <div>
          <div class="dhf-title">申请采购配额</div>
          <div class="dhf-sub">联通人口数据配额 · 采购意向单</div>
        </div>
      </div>
    </template>

    <div class="qad-body">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="104px"
        class="qad-form"
      >
        <el-form-item label="公司名" prop="company">
          <el-input v-model="form.company" placeholder="请输入公司名称" maxlength="100" />
        </el-form-item>
        <el-form-item label="所在部门" prop="department">
          <el-input v-model="form.department" placeholder="如：拓展部 / 运营部 / 市场部" maxlength="100" />
        </el-form-item>
        <el-form-item label="联系人" prop="contact_name">
          <el-input v-model="form.contact_name" placeholder="请输入联系人姓名" maxlength="60" />
        </el-form-item>
        <el-form-item label="电子邮箱" prop="contact_email">
          <el-input v-model="form.contact_email" placeholder="name@company.com" maxlength="120" />
        </el-form-item>
        <el-form-item label="联系电话" prop="contact_phone">
          <el-input v-model="form.contact_phone" placeholder="如：13800138000 / 021-12345678" maxlength="30" />
        </el-form-item>
        <el-form-item label="期望采购次数" prop="want_amount">
          <el-input-number
            v-model="form.want_amount"
            :min="1"
            :step="50"
            :precision="0"
            controls-position="right"
            style="width: 200px;"
          />
          <span class="qad-unit">次</span>
        </el-form-item>
        <el-form-item label="用途说明" prop="purpose">
          <el-input
            v-model="form.purpose"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="选填。如：2026 Q4 门店选址评估"
          />
        </el-form-item>
        <el-form-item label="期望到货日期" prop="expect_date">
          <el-date-picker
            v-model="form.expect_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选填"
            style="width: 200px;"
          />
        </el-form-item>
      </el-form>

      <!-- 一句明示：低饱和说明文字（决策 1/3/4 的对外口径） -->
      <p class="qad-note">
        提交后我方将与您联系确认<b>合同与付款事宜</b>；本申请仅为采购意向，<b>不产生任何费用</b>。
      </p>
      <!-- 联系方式行：⛔ 不就地拼串，统一走 quotaContactText()（单一落点） -->
      <p class="qad-contact">
        <el-icon><PhoneFilled /></el-icon>
        也可直接联系：<b>{{ contactText }}</b>
      </p>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">提交申请</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { ShoppingCart, PhoneFilled } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import api from '@/utils/api'
import { quotaContactText } from '@/utils/quotaContact'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 预填（公司名 / 邮箱优先用账号已有信息，用户仍可改） */
  prefill: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:modelValue', 'submitted'])

const contactText = quotaContactText()

const formRef = ref(null)
const submitting = ref(false)

function blank() {
  return {
    company: props.prefill?.company || '',
    department: '',
    contact_name: '',
    contact_email: props.prefill?.email || '',
    contact_phone: '',
    want_amount: 100,
    purpose: '',
    expect_date: ''
  }
}
const form = reactive(blank())

// 与服务端 routes/quotaRequests.js 的校验同口径（前端先拦一道，减少无谓往返）
const rules = {
  company: [{ required: true, message: '请输入公司名', trigger: 'blur' }],
  department: [{ required: true, message: '请输入所在部门', trigger: 'blur' }],
  contact_name: [{ required: true, message: '请输入联系人', trigger: 'blur' }],
  contact_email: [
    { required: true, message: '请输入电子邮箱', trigger: 'blur' },
    { type: 'email', message: '电子邮箱格式不正确', trigger: 'blur' }
  ],
  contact_phone: [
    { required: true, message: '请输入联系电话', trigger: 'blur' },
    { pattern: /^[0-9+\-() #转ext.]{6,24}$/i, message: '联系电话格式不正确', trigger: 'blur' }
  ],
  want_amount: [{
    required: true,
    trigger: 'change',
    validator: (_rule, value, cb) => {
      if (value === undefined || value === null || value === '') return cb(new Error('请输入期望采购次数'))
      if (!Number.isInteger(Number(value)) || Number(value) < 1) return cb(new Error('期望采购次数必须为不小于 1 的整数'))
      cb()
    }
  }]
}

function onClosed() {
  formRef.value?.clearValidate()
}

async function submit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch (e) {
    return // 表单校验未通过，界面上已有逐项提示
  }
  submitting.value = true
  try {
    const data = await api.post('/quota-requests', { ...form })
    ElMessage.success(data?.message || '申请已提交，我方将与您联系')
    emit('submitted', data?.request || { status: 'pending' })
    emit('update:modelValue', false)
  } catch (error) {
    ElMessage.error(error?.response?.data?.message || '提交申请失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped lang="scss">
/* ⚠️ 以下元素由本组件模板直写进 el-dialog 内容区 ⇒ 自带 data-v-*，用单类选择器即可命中。
   ⛔ 不要写成 .quota-apply-dialog .qad-note —— el-dialog 的 class 落在 .el-dialog 上、
      不继承父组件 scopeId，会**静默失效**（铁律 §6.35）。 */
.qad-unit {
  margin-left: 8px;
  font-size: 13px;
  color: #909399;
}

.qad-note {
  margin: 4px 0 10px;
  font-size: 12px;
  line-height: 1.7;
  color: #909399;

  b {
    color: #606266;
    font-weight: 600;
  }
}

.qad-contact {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: #606266;

  b {
    color: #0d579c;
  }
}
</style>
