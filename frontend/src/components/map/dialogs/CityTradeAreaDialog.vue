<template>
  <el-dialog
    :model-value="visible"
    title="选择城市商圈"
    width="450px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:visible', $event)"
    @close="$emit('update:visible', false)"
  >
    <div style="padding: 6px 0;">
      <div v-if="loading" style="text-align:center;padding:20px;">
        <el-icon class="is-loading" style="font-size:20px;"><Loading /></el-icon>
        <span style="margin-left:8px;color:#909399;font-size:13px;">加载中...</span>
      </div>
      <div v-else-if="!hasData" style="text-align:center;padding:20px;color:#909399;font-size:13px;">
        暂无城市商圈数据
      </div>
      <template v-else>
        <div v-for="(tierInfo, tierKey) in groupedCities" :key="tierKey">
          <div v-if="tierInfo.length > 0" style="margin-bottom:18px;">
            <h3 style="margin-bottom:10px;display:flex;align-items:center;gap:8px;">
              <el-tag :type="tierTagType(tierKey)" round size="small">{{ tierLabel(tierKey) }}</el-tag>
              <span style="font-size:13px;color:#999;font-weight:normal;">{{ tierInfo.length }}个城市</span>
            </h3>
            <el-checkbox-group v-model="selectedCities">
              <div v-for="city in tierInfo" :key="city.name" style="margin-bottom:6px;">
                <el-checkbox :label="city.name" :value="city.name">
                  <span style="font-size:14px;">{{ city.name }}（{{ city.count }} 个商圈）</span>
                </el-checkbox>
              </div>
            </el-checkbox-group>
          </div>
        </div>
      </template>
    </div>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="loading" :disabled="selectedCities.length === 0" @click="onConfirm">
        显示商圈
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  visible: Boolean,
  loading: Boolean,
  groupedCities: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:visible', 'confirm'])

// 内部管理选中城市
const selectedCities = ref([])

// 每次打开对话框时重置
watch(() => props.visible, (val) => {
  if (val) {
    selectedCities.value = []
  }
})

const hasData = computed(() => {
  return Object.values(props.groupedCities).some(arr => arr.length > 0)
})

const onConfirm = () => {
  emit('confirm', [...selectedCities.value])
}

const tierTagType = (tier) => {
  const map = { '一线城市': 'danger', '新一线城市': 'warning', '二三线城市': 'info' }
  return map[tier] || 'info'
}

const tierLabel = (tier) => tier
</script>
