/**
 * 联通查询结果 → ECharts 配置（单一真源，v1.13.429）
 *
 * 与 utils/purchaseResultHtml.js 配套：表格走前者、图表走这里，
 * 「购买履历 → 查询结果详情」与「地图 → 门店 → 联通人口 → 已购报表」共用。
 *
 * - buildChartListFrom(resultData)：图表卡片清单（API 宽表 / 导入记录两种输入）
 * - buildChartOption(code, data, chartKey)：ECharts option
 * - buildImportBarOption(item)：认不出结构的码，横条图兜底
 *
 * ⚠️ 纯函数；echarts 仅用于渐变，不在此初始化实例。
 */
import * as echarts from 'echarts'
import { pick1001 } from './smartsteps1001.js'
import { getServiceName, excludeServices } from './purchaseResultHtml.js'
import {
  splitReportBlocks, groupRowsByCode, shortBlockTitle, cleanGroupTitle, buildCompatMap
} from './reportRows.js'

// 1001 年龄图复用：分组定义与取值（v1.13.429 随图表一并迁入）
const ageGroups = [
  { label: '6-15岁', keys: ['0006', '0612', '1215'] },
  { label: '16-18岁', keys: ['1518'] },
  { label: '19-24岁', keys: ['1924'] },
  { label: '25-29岁', keys: ['2529'] },
  { label: '30-34岁', keys: ['3034'] },
  { label: '35-39岁', keys: ['3539'] },
  { label: '40-44岁', keys: ['4044'] },
  { label: '45-49岁', keys: ['4549'] },
  { label: '50-54岁', keys: ['5054'] },
  { label: '55-59岁', keys: ['5559'] },
  { label: '60-64岁', keys: ['6064'] },
  { label: '65-69岁', keys: ['6569'] },
  { label: '70岁以上', keys: ['70up'] }
]

const getAgeValue = (data, prefix, suffix) => {
  const pattern = new RegExp(`^AGE${prefix}_${suffix}$`, 'i')
  return findFieldValue(data, pattern)
}

const buildChartOption = (code, data, chartKey) => {
  // 1001 子图分发
  if (code === '1001') {
    if (chartKey === '1001-a') return buildOption1001_Totals(data)
    if (chartKey === '1001-b') return buildOption1001_AgeLW(data)
    if (chartKey === '1001-c') return buildOption1001_AgeV(data)
    if (chartKey === '1001-d') return buildOption1001_Gender(data)
    return null
  }
  // 1005 子图分发
  if (code === '1005') {
    if (chartKey === '1005-a') return buildOption1005_Visit(data)
    if (chartKey === '1005-b') return buildOption1005_All(data)
    return null
  }
  // 1006 子图分发
  if (code === '1006') {
    if (chartKey === '1006-a') return buildOption1006_Daily(data)
    if (chartKey === '1006-b') return buildOption1006_Monthly(data)
    return null
  }
  // 1009 子图分发
  if (code === '1009') {
    if (chartKey === '1009-a') return buildOption1009_LW(data)
    if (chartKey === '1009-b') return buildOption1009_V(data)
    return null
  }
  // 1010 子图分发
  if (code === '1010') {
    if (chartKey === '1010-a') return buildOption1010_LW(data)
    if (chartKey === '1010-b') return buildOption1010_V(data)
    return null
  }
  // 1011 子图分发
  if (code === '1011') {
    if (chartKey === '1011-a') return buildOption1011_LW(data)
    if (chartKey === '1011-b') return buildOption1011_V(data)
    return null
  }
  // 1015 子图分发
  if (code === '1015') {
    if (chartKey === '1015-a') return buildOption1015_Pop(data, 0, '到访')
    if (chartKey === '1015-b') return buildOption1015_Pop(data, 1, '居住')
    if (chartKey === '1015-c') return buildOption1015_Pop(data, 2, '工作')
    return null
  }
  switch (code) {
    case '1001': return null // 已在上面通过子图分发
    case '1002': return buildOption1002ByPop(data, chartKey)
    case '1005': return null // 已在上面通过子图分发
    case '1006': return null // 已在上面通过子图分发
    case '1007': return buildOption1007(data)
    case '1009': return null // 已在上面通过子图分发
    case '1010': return null // 已在上面通过子图分发
    case '1011': return null // 已在上面通过子图分发
    case '1012': return buildOption1012(data)
    case '1013': return buildOption1013(data)
    case '1014': return null // 已隐藏
    case '1015': return null // 已在上面通过子图分发
    default: return null
  }
}

const findFieldValue = (data, pattern) => pick1001(data, pattern)

const buildOption1001_Totals = (data) => {
  if (!data || typeof data !== 'object') return null
  const items = [
    { label: '到访人口数', pattern: /^P0_SUM\d*$/i },
    { label: '居住人口数', pattern: /^P1_SUM\d*$/i },
    { label: '工作人口数', pattern: /^P2_SUM\d*$/i },
    { label: '外省到访人口数', pattern: /^P3_SUM\d*$/i },
    { label: '娱乐人数', pattern: /^P4_SUM\d*$/i }
  ]
  const values = items.map(item => findFieldValue(data, item.pattern))
  if (values.every(v => v === 0)) return null
  
  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de']
  const labels = items.map(i => i.label)
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels.reverse(), axisLabel: { fontSize: 12 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar',
      data: values.reverse().map((v, i) => ({ 
        value: v, 
        itemStyle: { color: colors[labels.length - 1 - i] } 
      })),
      barMaxWidth: 36,
      label: { 
        show: true, position: 'right', 
        formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(),
        fontSize: 11, fontWeight: 'bold'
      }
    }]
  }
}

const buildOption1001_AgeLW = (data) => {
  if (!data || typeof data !== 'object') return null
  const calcAge = (prefix) => ageGroups.map(g => {
    return g.keys.reduce((sum, k) => sum + getAgeValue(data, prefix, k), 0)
  })
  const liveData = calcAge('1')
  const workData = calcAge('2')
  const labels = ageGroups.map(g => g.label)
  if (liveData.every(v => v === 0) && workData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['居住', '工作'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '16%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '居住', type: 'bar', data: liveData, itemStyle: { color: '#5470c6' }, barMaxWidth: 24 },
      { name: '工作', type: 'bar', data: workData, itemStyle: { color: '#91cc75' }, barMaxWidth: 24 }
    ]
  }
}

const buildOption1001_AgeV = (data) => {
  if (!data || typeof data !== 'object') return null
  const visitData = ageGroups.map(g => {
    return g.keys.reduce((sum, k) => sum + getAgeValue(data, '0', k), 0)
  })
  const labels = ageGroups.map(g => g.label)
  if (visitData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '12%', bottom: '8%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      name: '到访', type: 'bar', data: visitData,
      itemStyle: { color: '#fac858' }, barMaxWidth: 40,
      label: { show: true, position: 'top', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 9, rotate: 0 }
    }]
  }
}

const buildOption1001_Gender = (data) => {
  if (!data || typeof data !== 'object') return null
  const maleLive = findFieldValue(data, /^MALE1_SUM\d*$/i)
  const maleWork = findFieldValue(data, /^MALE2_SUM\d*$/i)
  const femaleLive = findFieldValue(data, /^FEMALE1_SUM\d*$/i)
  const femaleWork = findFieldValue(data, /^FEMALE2_SUM\d*$/i)
  if (maleLive === 0 && maleWork === 0 && femaleLive === 0 && femaleWork === 0) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['男', '女'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '14%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: ['居住', '工作'], axisLabel: { fontSize: 12 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '男', type: 'bar', data: [maleLive, maleWork], itemStyle: { color: '#5470c6' }, barMaxWidth: 36,
        label: { show: true, position: 'top', formatter: (p) => p.value.toLocaleString(), fontSize: 10 } },
      { name: '女', type: 'bar', data: [femaleLive, femaleWork], itemStyle: { color: '#ee6666' }, barMaxWidth: 36,
        label: { show: true, position: 'top', formatter: (p) => p.value.toLocaleString(), fontSize: 10 } }
    ]
  }
}

const buildOption1002ByPop = (data, chartKey) => {
  if (!Array.isArray(data) || data.length === 0) return null
  // chartKey: 1002-a=到访(0) 1002-b=居住(1) 1002-c=工作(2)
  const popMap = { '1002-a': 0, '1002-b': 1, '1002-c': 2 }
  const popType = popMap[chartKey]
  if (popType === undefined) return null
  const filtered = data.filter(d => d && d.popu_type === popType && d.tag_name !== undefined)
  if (filtered.length === 0) return null
  const sorted = [...filtered].sort((a, b) => (b.tag_value || 0) - (a.tag_value || 0)).slice(0, 10)
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '8%', bottom: '3%', top: '3%', containLabel: true },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: sorted.map(d => d.tag_name || '').reverse(), axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: sorted.map(d => d.tag_value || 0).reverse(),
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
        { offset: 0, color: '#667eea' },
        { offset: 1, color: '#764ba2' }
      ]) }
    }]
  }
}

const buildOption1005_Visit = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const weekdays = data.filter(d => d.day_type === 0)
  const weekends = data.filter(d => d.day_type === 1)
  const periods = [...new Set(data.map(d => d.hour_period))].sort((a, b) => Number(a) - Number(b))
  const getData = (arr) => periods.map(p => {
    const found = arr.find(d => d.hour_period === p)
    return found ? (found.hour_visit || 0) : 0
  })
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['工作日到访', '周末到访'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '18%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: periods.map(p => p + '点'), axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value' },
    series: [
      { name: '工作日到访', type: 'line', smooth: true, data: getData(weekdays), itemStyle: { color: '#5470c6' }, areaStyle: { color: 'rgba(84,112,198,0.1)' } },
      { name: '周末到访', type: 'line', smooth: true, data: getData(weekends), itemStyle: { color: '#91cc75' }, areaStyle: { color: 'rgba(145,204,117,0.1)' } }
    ]
  }
}

const buildOption1005_All = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const weekdays = data.filter(d => d.day_type === 0)
  const weekends = data.filter(d => d.day_type === 1)
  const periods = [...new Set(data.map(d => d.hour_period))].sort((a, b) => Number(a) - Number(b))
  const getData = (arr) => periods.map(p => {
    const found = arr.find(d => d.hour_period === p)
    return found ? (found.hour_all || 0) : 0
  })
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['工作日全量', '周末全量'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '18%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: periods.map(p => p + '点'), axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value' },
    series: [
      { name: '工作日全量', type: 'line', smooth: true, data: getData(weekdays), itemStyle: { color: '#ee6666' }, areaStyle: { color: 'rgba(238,102,102,0.1)' } },
      { name: '周末全量', type: 'line', smooth: true, data: getData(weekends), itemStyle: { color: '#73c0de' }, areaStyle: { color: 'rgba(115,192,222,0.1)' } }
    ]
  }
}

const buildOption1006_Daily = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const dayCount = data.length
  // 计算汇总
  let totalDayVisit = 0, totalDayAll = 0;
  let totalStay1 = 0, totalStay2 = 0, totalStay3 = 0, totalStay4 = 0, totalStay5 = 0;
  data.forEach(item => {
    totalDayVisit += item.day_visit || 0;
    totalDayAll += item.day_all || 0;
    totalStay1 += item.stay1 || 0;
    totalStay2 += item.stay2 || 0;
    totalStay3 += item.stay3 || 0;
    totalStay4 += item.stay4 || 0;
    totalStay5 += item.stay5 || 0;
  });
  const avgData = {
    '日均到访人次': Math.round(totalDayVisit / dayCount),
    '日均全量人次': Math.round(totalDayAll / dayCount),
    '日均停留<30分钟': Math.round(totalStay1 / dayCount),
    '日均停留30-60分钟': Math.round(totalStay2 / dayCount),
    '日均停留1-2小时': Math.round(totalStay3 / dayCount),
    '日均停留2-4小时': Math.round(totalStay4 / dayCount),
    '日均停留4小时以上': Math.round(totalStay5 / dayCount)
  };
  if (Object.values(avgData).every(v => v === 0)) return null
  
  const labels = Object.keys(avgData).reverse()
  const values = Object.values(avgData).reverse()
  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452']
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i % colors.length] } })),
      barMaxWidth: 30,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 10 }
    }]
  }
}

const buildOption1006_Monthly = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  let totalDayVisit = 0, totalDayAll = 0;
  let totalStay1 = 0, totalStay2 = 0, totalStay3 = 0, totalStay4 = 0, totalStay5 = 0;
  data.forEach(item => {
    totalDayVisit += item.day_visit || 0;
    totalDayAll += item.day_all || 0;
    totalStay1 += item.stay1 || 0;
    totalStay2 += item.stay2 || 0;
    totalStay3 += item.stay3 || 0;
    totalStay4 += item.stay4 || 0;
    totalStay5 += item.stay5 || 0;
  });
  const monthData = {
    '月度到访人次': totalDayVisit,
    '月度全量人次': totalDayAll,
    '停留<30分钟': totalStay1,
    '停留30-60分钟': totalStay2,
    '停留1-2小时': totalStay3,
    '停留2-4小时': totalStay4,
    '停留4小时以上': totalStay5
  };
  if (Object.values(monthData).every(v => v === 0)) return null
  
  const labels = Object.keys(monthData)
  const values = Object.values(monthData)
  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452']
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '4%', bottom: '14%', top: '5%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 25, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i % colors.length] } })),
      barMaxWidth: 40,
      label: { show: true, position: 'top', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 9 }
    }]
  }
}

const buildOption1007 = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  // 按数字排序 reach 字段
  const reachKeys = Object.keys(data[0])
    .filter(k => /^reach\d+$/i.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.match(/reach(\d+)/i)[1])
      const numB = parseInt(b.match(/reach(\d+)/i)[1])
      return numA - numB
    })
  if (reachKeys.length === 0) return null
  
  // reach 标签映射（与 formatArrayData 一致）
  const reachLabels = {
    1: '月驻留1次', 2: '月驻留2-4次', 3: '月驻留5-10次',
    4: '月驻留11-20次', 5: '月驻留20次以上'
  }
  const categories = reachKeys.map(k => {
    const num = parseInt(k.match(/reach(\d+)/i)[1])
    return reachLabels[num] || k
  })
  const values = reachKeys.map(k => data.reduce((s, d) => s + (d[k] || 0), 0))
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '18%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: categories.reverse(), axisLabel: { fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar', data: values.reverse(),
      barMaxWidth: 30,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 10 },
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
        { offset: 0, color: '#667eea' },
        { offset: 1, color: '#764ba2' }
      ]) }
    }]
  }
}

const buildOption1009_LW = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  // popu_type: 0=到访, 1=居住, 2=工作（formatArrayData 第820-821行）
  const spendLabels = { 1: '极低', 2: '低', 3: '中低', 4: '中等', 5: '中高', 6: '高', 7: '极高', 8: '超高' }
  const levels = [...new Set(data.map(d => d.spendpower))].filter(v => v != null).sort((a, b) => a - b)
  const getPopData = (popType) => levels.map(level => {
    const found = data.find(d => d.popu_type === popType && d.spendpower === level)
    return found ? (found.spendpower_value || 0) : 0
  })
  const liveData = getPopData(1) // 居住
  const workData = getPopData(2) // 工作
  const labels = levels.map(l => spendLabels[l] || `等级${l}`)
  if (liveData.every(v => v === 0) && workData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['居住', '工作'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '16%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '居住', type: 'bar', data: liveData, itemStyle: { color: '#5470c6' }, barMaxWidth: 24 },
      { name: '工作', type: 'bar', data: workData, itemStyle: { color: '#91cc75' }, barMaxWidth: 24 }
    ]
  }
}

const buildOption1009_V = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const spendLabels = { 1: '极低', 2: '低', 3: '中低', 4: '中等', 5: '中高', 6: '高', 7: '极高', 8: '超高' }
  const visitItems = data.filter(d => d.popu_type === 0).sort((a, b) => (a.spendpower || 0) - (b.spendpower || 0))
  if (visitItems.length === 0) return null
  
  const reversed = [...visitItems].reverse()
  const labels = reversed.map(d => spendLabels[d.spendpower] || `等级${d.spendpower}`)
  const values = reversed.map(d => d.spendpower_value || 0)
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar', data: values.map(v => ({ value: v })),
      itemStyle: { color: '#e8a838' },
      barMaxWidth: 30,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 10 }
    }]
  }
}

const buildOption1010_LW = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  // popu_type: 0=到访, 1=居住, 2=工作
  const eduKeys = ['p0', 'p1', 'p2', 'p3', 'p4']
  const eduLabels = ['高中及以下', '大专', '本科', '硕士', '博士']
  const getPopData = (popType) => eduKeys.map(k => {
    const found = data.find(d => d.popu_type === popType)
    return found ? (found[k] || 0) : 0
  })
  const liveData = getPopData(1)
  const workData = getPopData(2)
  if (liveData.every(v => v === 0) && workData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['居住', '工作'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '16%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: eduLabels, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '居住', type: 'bar', data: liveData, itemStyle: { color: '#5470c6' }, barMaxWidth: 28 },
      { name: '工作', type: 'bar', data: workData, itemStyle: { color: '#91cc75' }, barMaxWidth: 28 }
    ]
  }
}

const buildOption1010_V = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const eduKeys = ['p0', 'p1', 'p2', 'p3', 'p4']
  const eduLabels = ['高中及以下', '大专', '本科', '硕士', '博士']
  const visitItem = data.find(d => d.popu_type === 0)
  if (!visitItem) return null
  const values = eduKeys.map(k => visitItem[k] || 0).reverse()
  const labels = [...eduLabels].reverse()
  if (values.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar', data: values.map(v => ({ value: v })),
      itemStyle: { color: '#f08080' },
      barMaxWidth: 30,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 10 }
    }]
  }
}

const buildOption1011_LW = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const pLabels = { p1:'金融从业者', p2:'医务人员', p3:'公务员&事业单位', p4:'白领及一般职员',
    p5:'工人及服务业人员', p6:'教师', p7:'农民及其他', p8:'网约车司机', p9:'外卖员', p10:'快递员' }
  const pKeys = ['p1','p2','p3','p4','p5','p6','p7','p8','p9','p10']
  const labels = pKeys.map(k => pLabels[k])
  const calcPop = (popType) => pKeys.map(k => {
    return data.filter(d => d.popu_type === popType).reduce((s, d) => s + (d[k] || 0), 0)
  })
  const liveData = calcPop(1)
  const workData = calcPop(2)
  if (liveData.every(v => v === 0) && workData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['居住', '工作'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '16%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 25, fontSize: 9 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '居住', type: 'bar', data: liveData, itemStyle: { color: '#5470c6' }, barMaxWidth: 20 },
      { name: '工作', type: 'bar', data: workData, itemStyle: { color: '#91cc75' }, barMaxWidth: 20 }
    ]
  }
}

const buildOption1011_V = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const pLabels = { p1:'金融从业者', p2:'医务人员', p3:'公务员&事业单位', p4:'白领及一般职员',
    p5:'工人及服务业人员', p6:'教师', p7:'农民及其他', p8:'网约车司机', p9:'外卖员', p10:'快递员' }
  const pKeys = ['p1','p2','p3','p4','p5','p6','p7','p8','p9','p10']
  const values = pKeys.map(k => data.filter(d => d.popu_type === 0).reduce((s, d) => s + (d[k] || 0), 0))
  const labels = pKeys.map(k => pLabels[k]).reverse()
  if (values.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels.reverse(), axisLabel: { fontSize: 10 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar', data: values.reverse().map(v => ({ value: v })),
      itemStyle: { color: '#ff8c69' },
      barMaxWidth: 24,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 9 }
    }]
  }
}

const buildOption1012 = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const stageLabels = ['未婚单身', '未婚恋爱', '已婚']
  const stageKeys = ['p1', 'p2', 'p3']
  const colors = ['#5470c6', '#91cc75', '#fac858']
  const typeLabels = ['到访', '居住', '工作']
  
  const getPieData = (popType) => {
    const item = data.find(d => d.popu_type === popType)
    if (!item) return null
    const vals = stageKeys.map(k => item[k] || 0)
    if (vals.every(v => v === 0)) return null
    return stageKeys.map((k, i) => ({ name: stageLabels[i], value: item[k] || 0, itemStyle: { color: colors[i] } }))
  }
  const validTypes = [0, 1, 2].filter(pt => getPieData(pt) !== null)
  if (validTypes.length === 0) return null
  
  // 根据有效饼图数量动态分配位置
  const positions = validTypes.length === 1 ? [['50%', '50%']] :
    validTypes.length === 2 ? [['30%', '50%'], ['70%', '50%']] :
    [['18%', '50%'], ['50%', '50%'], ['82%', '50%']]
  
  return {
    tooltip: { trigger: 'item', formatter: (p) => `${p.seriesName}<br/>${p.name}: ${p.value} (${(p.percent || 0).toFixed(1)}%)` },
    title: validTypes.map((pt, idx) => ({
      text: typeLabels[pt],
      left: positions[idx][0],
      top: '6%',
      textAlign: 'center',
      textStyle: { fontSize: 13, fontWeight: 'bold', color: '#333' }
    })),
    series: validTypes.map((pt, idx) => ({
      name: typeLabels[pt],
      type: 'pie', radius: ['20%', '40%'], center: positions[idx],
      data: getPieData(pt),
      label: { fontSize: 10, formatter: (p) => `${p.name}\n${(p.percent || 0).toFixed(1)}%` },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } }
    }))
  }
}

const buildOption1013 = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const consumeLabels = ['低', '中', '高']
  const consumeKeys = ['p1', 'p2', 'p3']
  const colors = ['#ee6666', '#fac858', '#91cc75']
  const typeLabels = ['到访', '居住', '工作']
  
  const getPieData = (popType) => {
    const item = data.find(d => d.popu_type === popType)
    if (!item) return null
    const vals = consumeKeys.map(k => item[k] || 0)
    if (vals.every(v => v === 0)) return null
    return consumeKeys.map((k, i) => ({ name: consumeLabels[i], value: item[k] || 0, itemStyle: { color: colors[i] } }))
  }
  const validTypes = [0, 1, 2].filter(pt => getPieData(pt) !== null)
  if (validTypes.length === 0) return null
  
  const positions = validTypes.length === 1 ? [['50%', '50%']] :
    validTypes.length === 2 ? [['30%', '50%'], ['70%', '50%']] :
    [['18%', '50%'], ['50%', '50%'], ['82%', '50%']]
  
  return {
    tooltip: { trigger: 'item', formatter: (p) => `${p.seriesName}<br/>${p.name}: ${p.value} (${(p.percent || 0).toFixed(1)}%)` },
    title: validTypes.map((pt, idx) => ({
      text: typeLabels[pt],
      left: positions[idx][0],
      top: '6%',
      textAlign: 'center',
      textStyle: { fontSize: 13, fontWeight: 'bold', color: '#333' }
    })),
    series: validTypes.map((pt, idx) => ({
      name: typeLabels[pt],
      type: 'pie', radius: ['20%', '40%'], center: positions[idx],
      data: getPieData(pt),
      label: { fontSize: 10, formatter: (p) => `${p.name}\n${(p.percent || 0).toFixed(1)}%` },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } }
    }))
  }
}

const buildOption1015_Pop = (data, popType, popLabel) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const pLabels = { p1: '预测概率高', p2: '预测概率中高', p3: '预测概率中', p4: '预测概率中低', p5: '预测概率低' }
  const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5']
  const assetLabels = ['收入预测', '有车预测', '有房预测']
  
  // 获取该人群的 fname 数据
  const popItems = data.filter(d => d.popu_type === popType)
  if (popItems.length === 0) return null
  const fnames = [...new Set(popItems.map(d => d.fname))].filter(Boolean)
  // 按标准顺序排列
  const orderedFnames = assetLabels.filter(l => fnames.includes(l))
  if (orderedFnames.length === 0) return null
  
  const series = orderedFnames.map((fname, idx) => {
    const colors = ['#5470c6', '#91cc75', '#fac858']
    const found = popItems.find(d => d.fname === fname)
    return {
      name: fname,
      type: 'bar',
      data: pKeys.map(k => (found ? (found[k] || 0) : 0)),
      itemStyle: { color: colors[idx % colors.length] }
    }
  })
  const xLabels = pKeys.map(k => pLabels[k])
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: orderedFnames, bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '18%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: xLabels, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series
  }
}

// 导入记录不出图的码（业主 2026-11-27：上网标签分布只留表）
const IMPORT_NO_CHART_CODES = ['1002']

const buildImportChartList = (rows, apiResult) => {
  const list = []
  // 1001 的四张图读 apiResult，口径没变 ⇒ 保留（顺序也与原来一致，排在最前）
  if (apiResult && apiResult['1001']) {
    list.push({ serviceCode: '1001', chartKey: '1001-a', title: '全量人口 - 人口总数' })
    list.push({ serviceCode: '1001', chartKey: '1001-b', title: '全量人口 - 居住+工作年龄分布' })
    list.push({ serviceCode: '1001', chartKey: '1001-c', title: '全量人口 - 到访年龄分布' })
    list.push({ serviceCode: '1001', chartKey: '1001-d', title: '全量人口 - 居住+工作性别分布' })
  }
  const compatBySource = new Map()
  for (const c of buildCompatMap(rows, excludeServices)) {
    for (const s of c.sources) compatBySource.set(s, c)
  }
  const placed = new Set()
  for (const { code, rows: codeRows } of groupRowsByCode(rows, excludeServices)) {
    if (code === '1001') continue
    const compat = compatBySource.get(code)
    if (compat) {
      if (placed.has(compat.code)) continue
      placed.add(compat.code)
      for (const ch of compat.charts) {
        // 业主 2026-11-27 拍板：导入记录不显示「上网标签分布」的 3 张图（表照常保留）。
        // ⚠️ 只作用于导入记录；普通购买记录仍按设计出这 3 张图（见 reportRows.js::chartsFor）
        if (IMPORT_NO_CHART_CODES.includes(ch.serviceCode)) continue
        list.push({ ...ch, compatData: compat.data })
      }
      continue
    }
    const codeName = getServiceName(code)
    splitReportBlocks(codeRows).forEach((b, i) => {
      if (b.items.length < 2) return // 单条不成图，留表格里看
      const sub = shortBlockTitle(codeName, b.title)
      list.push({
        serviceCode: code,
        chartKey: `imp-${code}-${i}`,
        title: sub && sub !== cleanGroupTitle(codeName) ? `${codeName} · ${sub}` : codeName,
        importBars: b.items.map((it) => ({ name: it.label, value: it.value }))
      })
    })
  }
  return list
}

const buildImportBarOption = (item) => {
  const bars = item.importBars || []
  const fmt = (v) => (v >= 10000 ? (v / 10000).toFixed(1) + '万' : Number(v).toLocaleString())
  return {
    grid: { left: 4, right: 56, top: 10, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? v / 10000 + '万' : v) } },
    yAxis: {
      type: 'category',
      inverse: true,
      data: bars.map((b) => b.name),
      axisLabel: { fontSize: 11, width: 130, overflow: 'truncate' }
    },
    series: [{
      type: 'bar',
      data: bars.map((b) => b.value),
      barMaxWidth: 16,
      itemStyle: { color: '#4f7ef7', borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: 'right', fontSize: 10, formatter: (p) => fmt(p.value) }
    }]
  }
}

function buildChartListFrom(data) {
  if (!data) return []
  let apiResult = data
  if (typeof apiResult === 'string') {
    try { apiResult = JSON.parse(data) } catch (e) { return [] }
  }
  // v1.13.427：导入记录按报表中文出图（原按服务码硬拆的那套对不上导入结构，
  // 会出现「有卡片标题、画不出图形」的空图框）
  const reportRows = Array.isArray(apiResult?.reportRows) ? apiResult.reportRows : null
  if (apiResult && apiResult.apiResult) {
    apiResult = apiResult.apiResult
  }
  if (reportRows && reportRows.length) {
    return buildImportChartList(reportRows, apiResult)
  }
  if (!apiResult || typeof apiResult !== 'object') return []
  
  const list = []
  for (const [key, value] of Object.entries(apiResult)) {
    if (key === 'error') continue
    if (excludeServices.includes(key)) continue
    // 跳过空数据
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    
    // 1001 全量人口拆分为3张子图表
    if (key === '1001') {
      list.push({ serviceCode: '1001', chartKey: '1001-a', title: '全量人口 - 人口总数' })
      list.push({ serviceCode: '1001', chartKey: '1001-b', title: '全量人口 - 居住+工作年龄分布' })
      list.push({ serviceCode: '1001', chartKey: '1001-c', title: '全量人口 - 到访年龄分布' })
      list.push({ serviceCode: '1001', chartKey: '1001-d', title: '全量人口 - 居住+工作性别分布' })
    } else if (key === '1005') {
      // 1005 每小时段流量拆分为2张子图表
      list.push({ serviceCode: '1005', chartKey: '1005-a', title: '每小时段流量 - 到访' })
      list.push({ serviceCode: '1005', chartKey: '1005-b', title: '每小时段流量 - 全量' })
    } else if (key === '1006') {
      // 1006 每日人流量拆分为2张子图表
      list.push({ serviceCode: '1006', chartKey: '1006-a', title: '每日人流量 - 日均值' })
      list.push({ serviceCode: '1006', chartKey: '1006-b', title: '每日人流量 - 月度累计' })
    } else if (key === '1009') {
      // 1009 消费水平拆分为2张子图表
      list.push({ serviceCode: '1009', chartKey: '1009-a', title: '消费水平 - 居住+工作' })
      list.push({ serviceCode: '1009', chartKey: '1009-b', title: '消费水平 - 到访' })
    } else if (key === '1010') {
      // 1010 教育水平拆分为2张子图表
      list.push({ serviceCode: '1010', chartKey: '1010-a', title: '教育水平 - 居住+工作' })
      list.push({ serviceCode: '1010', chartKey: '1010-b', title: '教育水平 - 到访' })
    } else if (key === '1011') {
      // 1011 行业分布拆分为2张子图表
      list.push({ serviceCode: '1011', chartKey: '1011-a', title: '行业分布 - 居住+工作' })
      list.push({ serviceCode: '1011', chartKey: '1011-b', title: '行业分布 - 到访' })
    } else if (key === '1014') {
      // 1014 网购能力预测 - 隐藏
      continue
    } else if (key === '1015') {
      // 1015 资产预测拆分为3张子图表（到访/居住/工作）
      list.push({ serviceCode: '1015', chartKey: '1015-a', title: '资产预测 - 到访' })
      list.push({ serviceCode: '1015', chartKey: '1015-b', title: '资产预测 - 居住' })
      list.push({ serviceCode: '1015', chartKey: '1015-c', title: '资产预测 - 工作' })
    } else if (key === '1002') {
      // 1002 上网标签分布拆分为3张子图表（到访/居住/工作）
      list.push({ serviceCode: '1002', chartKey: '1002-a', title: '上网标签分布 - 到访' })
      list.push({ serviceCode: '1002', chartKey: '1002-b', title: '上网标签分布 - 居住' })
      list.push({ serviceCode: '1002', chartKey: '1002-c', title: '上网标签分布 - 工作' })
    } else {
      list.push({ serviceCode: key, chartKey: key, title: getServiceName(key) })
    }
  }
  return list
}

export { buildChartListFrom, buildChartOption, buildImportBarOption, findFieldValue }
