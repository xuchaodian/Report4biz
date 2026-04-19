<template>
  <div class="detail-content">
    <div class="detail-info">
      <p><strong>订单ID:</strong> {{ detail.id }}</p>
      <p><strong>查询时间:</strong> {{ formatDate(detail.created_at) }}</p>
      <p><strong>位置:</strong> {{ detail.center_lat?.toFixed(6) }}, {{ detail.center_lng?.toFixed(6) }}</p>
      <p><strong>半径:</strong> {{ detail.radii?.join(', ') }}米</p>
      <p><strong>数据年月:</strong> {{ detail.city_month }}</p>
    </div>
    <div class="detail-result" v-if="resultData">
      <h4>📊 人口概览</h4>
      <div class="result-grid" v-html="formatResultData(resultData)"></div>
    </div>
    <div v-else class="no-result">
      <p>暂无数据（该订单配额已返还）</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  detail: {
    type: Object,
    required: true
  }
})

// 计算属性：解析 result_data
const resultData = computed(() => {
  if (!props.detail?.result_data) return null
  
  let data = props.detail.result_data
  
  // 如果是字符串，尝试解析
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch (e) {
      console.error('JSON解析失败:', e)
      return null
    }
  }
  
  // 如果 data 是 { apiResult: {...} } 格式
  if (data && data.apiResult) {
    data = data.apiResult
  }
  
  return data
})

// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 服务名称映射
const serviceNames = {
  '1001': '人口基础属性',
  '1002': '常驻人口画像',
  '1003': '工作人口画像',
  '1004': '居住人口画像',
  '1005': '到访人口时间段分布',
  '1006': '到访频次分析',
  '1007': '人口消费水平',
  '1008': '到访交通方式',
  '1009': '人口年龄段',
  '1010': '消费业态偏好',
  '1011': '人口婚姻状态',
  '1012': '人口学历分析',
  '1013': '综合消费能力预测',
  '1014': '网购能力预测',
  '1015': '资产预测',
  '1017': '消费品牌偏好',
  '1018': '餐饮消费偏好',
  '1019': '连锁店偏好',
  '1020': '年龄段收入',
  '1021': '人口行业分布',
  '1022': '消费档次分布',
  '1023': '家庭汽车情况'
}

// 排除的服务列表
const excludeServices = ['1016']

// 获取服务名称
function getServiceName(code) {
  return serviceNames[code] || `服务${code}`
}

// 格式化结果显示
function formatResultData(data) {
  if (!data) return '<p>暂无数据</p>'
  
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch (e) {
      return '<p>暂无数据</p>'
    }
  }
  
  if (data && data.apiResult) {
    data = data.apiResult
  }
  
  if (!data || typeof data !== 'object') return '<p>暂无数据</p>'
  if (data.error) return `<p style="color:red;">❌ ${data.error}</p>`

  let html = ''
  
  for (const [key, value] of Object.entries(data)) {
    if (key === 'error') continue
    if (excludeServices.includes(key)) continue
    
    const serviceName = getServiceName(key)
    
    // 1001 服务特殊处理
    if (key === '1001' && typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result-item">
        ${formatP0SData(value)}
      </div>`
      continue
    }
    
    // 数组格式数据
    if (Array.isArray(value)) {
      html += `<div class="detail-result-item">
        <h4>📊 ${serviceName}</h4>
        ${formatArrayData(value, key)}
      </div>`
      continue
    }
    
    // 其他服务
    if (typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result-item">
        <h4>📊 ${serviceName}</h4>
        ${formatOtherData(value, key)}
      </div>`
    } else if (typeof value === 'number') {
      html += `<div class="result-item-simple">
        <span class="result-label">${serviceName}</span>
        <span class="result-value">${value.toLocaleString()}</span>
      </div>`
    }
  }
  
  return html || '<p>暂无数据</p>'
}

// 1001服务数据格式化
function formatP0SData(data) {
  if (!data || typeof data !== 'object') return '<p>数据格式错误</p>'
  
  const popuTypes = ['到访', '居住', '工作']
  const metrics = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']
  const metricLabels = ['未知', '儿童/青少年', '青年', '中年', '老年', '学生', '家庭', '商务']
  
  const tableData = []
  for (const metric of metrics) {
    const row = { metric: metricLabels[metrics.indexOf(metric)] }
    for (let i = 0; i < popuTypes.length; i++) {
      row[popuTypes[i]] = 0
    }
    tableData.push(row)
  }
  
  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('_')
    if (parts.length !== 2) continue
    const metricIdx = parseInt(parts[0].substring(1))
    const typeIdx = parseInt(parts[1])
    if (metricIdx >= 0 && metricIdx < metrics.length && typeIdx >= 0 && typeIdx < popuTypes.length) {
      tableData[metricIdx][popuTypes[typeIdx]] = value || 0
    }
  }
  
  let html = `<table class="data-table"><thead><tr><th>年龄段</th>`
  for (const type of popuTypes) {
    html += `<th>${type}人口</th>`
  }
  html += `</tr></thead><tbody>`
  
  for (const row of tableData) {
    html += `<tr><td>${row.metric}</td>`
    for (const type of popuTypes) {
      html += `<td class="num">${row[type].toLocaleString()}</td>`
    }
    html += '</tr>'
  }
  html += '</tbody></table>'
  
  return html
}

// 格式化数组数据
function formatArrayData(data, serviceCode) {
  if (!Array.isArray(data) || data.length === 0) return '<p>暂无数据</p>'
  
  const firstItem = data[0]
  
  // 1002: 居住/工作人口画像
  if (firstItem.popu_type !== undefined && firstItem.pop_dwell !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    let totalDwell = 0, totalWork = 0
    
    let html = `<table class="data-table"><thead><tr><th>人群类型</th><th>居住人口</th><th>工作人口</th></tr></thead><tbody>`
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const typeName = typeNames[typeIdx] || `类型${item.popu_type}`
      const dwell = item.pop_dwell || 0
      const work = item.pop_work || 0
      totalDwell += dwell
      totalWork += work
      html += `<tr><td>${typeName}</td><td class="num">${dwell.toLocaleString()}</td><td class="num">${work.toLocaleString()}</td></tr>`
    }
    html += `<tr style="font-weight:bold;background:#f5f7fa;"><td>合计</td><td class="num">${totalDwell.toLocaleString()}</td><td class="num">${totalWork.toLocaleString()}</td></tr>`
    html += '</tbody></table>'
    return html
  }
  
  // 默认表格
  let html = `<table class="data-table"><thead><tr>`
  const headers = Object.keys(firstItem)
  for (const h of headers) {
    html += `<th>${h}</th>`
  }
  html += `</tr></thead><tbody>`
  
  for (const item of data.slice(0, 20)) {
    html += '<tr>'
    for (const h of headers) {
      const val = item[h]
      const display = typeof val === 'number' ? val.toLocaleString() : (val ?? '-')
      html += `<td class="num">${display}</td>`
    }
    html += '</tr>'
  }
  html += '</tbody></table>'
  return html
}

// 格式化其他服务数据
function formatOtherData(data, serviceCode) {
  const groups = { '到访': {}, '居住': {}, '工作': {}, '其他': {} }
  
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'number') continue
    const type = getPopTypeLabel(key)
    if (type && groups[type]) {
      groups[type][key] = val
    } else {
      groups['其他'][key] = val
    }
  }
  
  let html = ''
  for (const [type, items] of Object.entries(groups)) {
    if (Object.keys(items).length === 0) continue
    const total = Object.values(items).reduce((a, b) => a + b, 0)
    const sortedItems = Object.entries(items).sort((a, b) => a[0].localeCompare(b[0]))
    
    html += `<div class="pop-group">
      <div class="group-header">${type}人口 <span class="group-total">${total.toLocaleString()}</span></div>
      <table class="data-table"><thead><tr><th>指标名称</th><th>数值</th></tr></thead><tbody>`
    for (const [key, val] of sortedItems) {
      const label = getFieldLabel(serviceCode, key)
      html += `<tr><td>${label}</td><td class="num">${val.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
  }
  return html
}

// 获取人群类型标签
function getPopTypeLabel(key) {
  const suffix = key.slice(-1)
  const map = { '0': '到访', '1': '居住', '2': '工作' }
  return map[suffix]
}

// 获取字段中文标签
function getFieldLabel(serviceCode, key) {
  const baseLabels = {
    's0': '未知年龄', 's1': '儿童/青少年', 's2': '青年', 's3': '中年', 's4': '老年', 's5': '学生', 's6': '家庭', 's7': '商务',
    'm0': '未知性别', 'm1': '男性', 'm2': '女性',
    'pop_dwell': '居住人口', 'pop_work': '工作人口', 'visit_count': '到访人次'
  }
  
  if (baseLabels[key]) return baseLabels[key]
  
  const serviceLabels = {
    '1007': { 'p1': '低消费', 'p2': '中低消费', 'p3': '中消费', 'p4': '中高消费', 'p5': '高消费' },
    '1009': { 's0': '0-17岁', 's1': '18-24岁', 's2': '25-34岁', 's3': '35-44岁', 's4': '45-54岁', 's5': '55-64岁', 's6': '65岁以上' },
    '1011': { 'p1': '未婚', 'p2': '已婚' },
    '1012': { 'p1': '初中及以下', 'p2': '高中/中专', 'p3': '大专', 'p4': '本科', 'p5': '硕士', 'p6': '博士' },
    '1022': { 'p1': '低档', 'p2': '中低档', 'p3': '中档', 'p4': '中高档', 'p5': '高档' },
    '1023': { 'p1': '无车', 'p2': '有车' }
  }
  
  const labels = serviceLabels[serviceCode]
  if (labels && labels[key]) return labels[key]
  
  return key
}
</script>

<style scoped>
.detail-content {
  max-height: 70vh;
  overflow-y: auto;
}

.detail-info {
  padding: 15px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 20px;
}

.detail-info p {
  margin: 5px 0;
  font-size: 13px;
}

.detail-result h4 {
  margin: 15px 0 10px 0;
  color: #333;
  font-size: 14px;
}

.detail-result .result-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-result-item {
  margin-bottom: 15px;
}

.detail-result-item h4 {
  margin: 10px 0;
  color: #333;
  font-size: 14px;
}

.result-item-simple {
  display: flex;
  justify-content: space-between;
  padding: 10px 12px;
  background: white;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
}

.result-label {
  color: #666;
  font-size: 13px;
}

.result-value {
  font-weight: bold;
  color: #333;
  font-size: 14px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 10px;
}

.data-table th,
.data-table td {
  padding: 8px 10px;
  border: 1px solid #e8e8e8;
  text-align: left;
}

.data-table th {
  background: #f5f7fa;
  font-weight: 600;
  color: #333;
}

.data-table td.num {
  text-align: right;
  font-family: 'Monaco', 'Menlo', monospace;
}

.pop-group {
  margin-bottom: 15px;
}

.group-header {
  font-weight: 600;
  padding: 5px 0;
  color: #333;
  border-bottom: 2px solid #764ba2;
  margin-bottom: 8px;
}

.group-total {
  float: right;
  color: #764ba2;
}

.no-result {
  text-align: center;
  padding: 30px;
  color: #999;
}
</style>
