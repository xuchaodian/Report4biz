<template>
  <div class="shared-purchase">
    <div v-if="loading" class="loading">加载分享数据中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="purchase" class="result">
      <div class="header">
        <h2>📊 联通人口数据分析报告</h2>
        <p class="subtitle">数据来源于 {{ purchase.city_month }}</p>
      </div>
      <div class="info-card">
        <p><strong>门店:</strong> {{ purchase.store_name }}</p>
        <p><strong>查询半径:</strong> {{ purchase.radii?.join(', ') }}米</p>
        <p><strong>查询时间:</strong> {{ formatDate(purchase.created_at) }}</p>
      </div>
      <div class="data-result" v-if="resultData" v-html="formatResult(resultData)"></div>
      <div v-else class="no-data">暂无数据</div>
      <div class="footer">
        <p>由 选址赢家Online 生成</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'

const route = useRoute()
const purchase = ref(null)
const resultData = ref(null)
const loading = ref(true)
const error = ref('')

function formatDate(d) {
  if (!d) return '-'
  return new Date(d).toLocaleString('zh-CN')
}

function formatResult(data) {
  if (!data) return ''
  let html = '<table class="data-table"><tbody>'
  for (const [key, val] of Object.entries(data)) {
    if (typeof val === 'object') {
      html += '<tr><td colspan="2" style="font-weight:600;padding:6px 0;">' + key + '</td></tr>'
      for (const [k2, v2] of Object.entries(val)) {
        html += '<tr><td style="padding:3px 8px;">' + k2 + '</td><td style="padding:3px 8px;">' + (v2 ?? '-') + '</td></tr>'
      }
    } else {
      html += '<tr><td style="padding:3px 8px;">' + key + '</td><td style="padding:3px 8px;">' + (val ?? '-') + '</td></tr>'
    }
  }
  html += '</tbody></table>'
  return html
}

onMounted(async () => {
  const { token, id } = route.query
  if (!token || !id) {
    error.value = '分享链接无效'
    loading.value = false
    return
  }
  try {
    const res = await axios.get('/api/purchase/shared/' + id + '?token=' + token)
    purchase.value = res.data.purchase
    if (purchase.value?.result_data) {
      let d = purchase.value.result_data
      if (typeof d === 'string') d = JSON.parse(d)
      if (d.apiResult) d = d.apiResult
      resultData.value = d
    }
  } catch (e) {
    error.value = '加载失败：' + (e.response?.data?.message || e.message)
  } finally {
    loading.value = false
  }
})
</script>

<style>
body { margin: 0; font-family: 'PingFang SC','Microsoft YaHei',sans-serif; background: #f5f7fa; }
.shared-purchase { max-width: 600px; margin: 0 auto; padding: 20px; }
.header { text-align: center; margin-bottom: 20px; }
.header h2 { margin: 0 0 4px; color: #333; font-size: 18px; }
.subtitle { margin: 0; color: #999; font-size: 13px; }
.loading, .error { text-align: center; padding: 40px; color: #999; font-size: 14px; }
.info-card { background: white; border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; font-size: 13px; line-height: 1.8; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.data-result { background: white; border-radius: 8px; padding: 14px 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table td { border-bottom: 1px solid #f0f0f0; }
.no-data { text-align: center; padding: 30px; color: #999; }
.footer { text-align: center; margin-top: 20px; font-size: 12px; color: #ccc; }
</style>
