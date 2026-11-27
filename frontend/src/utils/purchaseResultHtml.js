/**
 * 联通查询结果 → 表格 HTML（单一真源，v1.13.429）
 *
 * 背景：同一份结果在两处展示 ——「购买履历 → 查询结果详情」与「地图 → 门店 → 联通人口 →
 * 已购报表」。原先两处各一份渲染器，已经漂移（门店那份不认识导入记录、还默认排除 1002）。
 * 业主 2026-11-27 要求两处「同一个设计」⇒ 只保留这一份实现，两处 import 同一模块。
 *
 * 支持三种输入：
 *   1. 联通 API 宽表        { apiResult: { '1001': {...}, '1005': [...] } }
 *   2. Excel 导入记录        { apiResult: {...}, reportRows: [...] }（按报表键名还原后再渲染）
 *   3. 已解析的 apiResult    直接传对象
 *
 * ⚠️ 纯函数（不碰组件状态），返回 HTML 字符串；调用方负责 sanitizeHtml。
 */
import { FIELD_LABELS } from '../views/field_labels.js'
import {
  splitReportBlocks, groupRowsByCode, shortBlockTitle, cleanGroupTitle, buildCompatMap
} from './reportRows.js'

const excludeServices = ['1003', '1004', '1008', '1016', '1017', '1018', '1019', '1020', '1021', '1022', '1023']

const getServiceName = (code) => {
  const names = {
    '1001': '全量人口',
    '1002': '上网标签分布',
    '1003': '手机品牌分布',
    '1005': '每小时段人口流量',
    '1006': '每日人流量及停留时长',
    '1007': '每月到达次数分布',
    '1008': 'APP使用人数分布',
    '1009': '消费水平（富裕指数）',
    '1010': '人口教育水平',
    '1011': '人口行业分布',
    '1012': '人生阶段分布',
    '1013': '综合消费能力预测',
    '1014': '网购能力预测',
    '1015': '资产预测（收入/有车/有房）',

  }
  return names[code] || code
}

const getFieldLabel = (serviceCode, fieldName) => {
  if (!FIELD_LABELS[serviceCode]) return fieldName
  const serviceFields = FIELD_LABELS[serviceCode]
  // 1. 精确匹配（区分大小写）
  if (serviceFields[fieldName]) {
    return serviceFields[fieldName]
  }
  // 2. 大小写不敏感匹配
  const upperField = fieldName.toUpperCase()
  const lowerField = fieldName.toLowerCase()
  for (const [key, label] of Object.entries(serviceFields)) {
    if (key.toUpperCase() === upperField || key.toLowerCase() === lowerField) {
      return label
    }
  }
  return fieldName // 返回原始字段名
}

const getPopTypeLabel = (key) => {
  if (key.includes('_0') || key.startsWith('P0') || key.includes('Visit')) return '到访'
  if (key.includes('_1') || key.startsWith('P1') || key.includes('Live')) return '居住'
  if (key.includes('_2') || key.startsWith('P2') || key.includes('Work')) return '工作'
  if (key.includes('_3')) return '外省到访'
  if (key.includes('_4')) return '娱乐'
  if (key.includes('_5')) return '重合'
  return ''
}

const formatP0SData = (data) => {
  // 字段名格式: prefix + digit + _ + suffix
  // 如 AGE0_0006, AGE1_6569, AGE2_70up
  // digit: 0=到访, 1=居住, 2=工作
  const typeNames = ['到访', '居住', '工作']
  
  // 定义指标排序顺序
  const sortOrder = [
    'PALL_SUM', 'P0_SUM', 'P1_SUM', 'P2_SUM', 'P3_SUM', 'P4_SUM', 'P5_SUM',
    '总人口规模', '到访人口数', '居住人口数', '工作人口数', '外省到访人口数', '娱乐人数', '居住工作重合人数',
    'MALE_SUM', 'FEMALE_SUM', '男性人数', '女性人数',
    'AGE_0006', 'AGE_0612', 'AGE_1215', 'AGE_1518', 'AGE_1924',
    '6岁以下人数', '7-12岁人数', '13-15岁人数', '16-18岁人数', '19-24岁人数',
    'AGE_2529', 'AGE_3034', 'AGE_3539', 'AGE_4044', 'AGE_4549',
    '25-29岁人数', '30-34岁人数', '35-39岁人数', '40-44岁人数', '45-49岁人数',
    'AGE_5054', 'AGE_5559', 'AGE_6064', 'AGE_6569', 'AGE_70up',
    '50-54岁人数', '55-59岁人数', '60-64岁人数', '65-69岁人数', '70岁以上人数',
    'consume_1', 'consume_2', 'consume_3',
    '月出帐金额50元以下人数', '月出帐金额50-100元人数', '月出帐金额100-150元人数',
    '月出帐金额150-200元人数', '月出帐金额200-250元人数', '月出帐金额250元以上人数'
  ]
  
  // P+数字+SUM 字段的映射（可能带数字后缀，如 P0_SUM0）
  const pSumFields = {
    'PALL_SUM': { label: '总人口规模', isSingleColumn: true },
    'P0_SUM': { label: '到访人口数', showIn: '到访' },
    'P1_SUM': { label: '居住人口数', showIn: '居住' },
    'P2_SUM': { label: '工作人口数', showIn: '工作' },
    'P3_SUM': { label: '外省到访人口数', showIn: '到访' },
    'P4_SUM': { label: '娱乐人数', showIn: '到访' },
    'P5_SUM': { label: '居住工作重合人数', isSingleColumn: true }
  }
  
  // 存储所有行: [{ baseKey, label, values: {到访, 居住, 工作}, isSingleColumn, singleValue }]
  const allRows = []
  const rowMap = new Map()  // 用于快速查找已存在的行
  
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'number') continue
    
    // 检查是否是 P+数字+SUM 字段（可能带后缀数字，如 P0_SUM0）
    const pSumMatch = key.match(/^(P\d_SUM)\d*$/i)
    if (pSumMatch) {
      const baseName = pSumMatch[1].toUpperCase()
      const fieldInfo = pSumFields[baseName]
      if (fieldInfo) {
        let row = rowMap.get(baseName)
        if (!row) {
          row = {
            baseKey: baseName,
            label: fieldInfo.label,
            values: { '到访': null, '居住': null, '工作': null },
            isSingleColumn: fieldInfo.isSingleColumn || false,
            singleValue: fieldInfo.isSingleColumn ? 0 : null
          }
          rowMap.set(baseName, row)
          allRows.push(row)
        }
        if (fieldInfo.isSingleColumn) {
          row.singleValue = val  // 更新为真实值
        } else {
          row.values[fieldInfo.showIn] = val  // 更新为真实值
        }
        continue
      }
    }
    
    // 检查是否是单列字段（如 PALL_SUM）
    if (key.toUpperCase() === 'PALL_SUM' || key.toUpperCase().startsWith('PALL_SUM')) {
      let row = rowMap.get('PALL_SUM')
      if (!row) {
        const label = getFieldLabel('1001', key)
        row = { 
          baseKey: 'PALL_SUM', 
          label, 
          values: { '到访': null, '居住': null, '工作': null }, 
          isSingleColumn: true,
          singleValue: val
        }
        rowMap.set('PALL_SUM', row)
        allRows.push(row)
      } else {
        row.singleValue = val
      }
      continue
    }
    
    // 直接用正则匹配 prefix + digit + _ + suffix
    const match = key.match(/^([a-zA-Z]+)(\d)_(.+)$/)
    if (match) {
      const [, prefix, digitStr, suffix] = match
      const digit = parseInt(digitStr)
      const typeName = typeNames[digit]
      if (!typeName) continue
      
      const baseKey = `${prefix}_${suffix}`
      // 查找是否已存在该 baseKey
      let row = rowMap.get(baseKey)
      if (!row) {
        const fullLabel = getFieldLabel('1001', key)
        // 去掉人群类型前缀
        let label = fullLabel
          .replace(/^(到访|居住|工作)人口/, '')
          .replace(/^(到访|居住|工作)/, '')
        if (label === '数') continue  // 过滤掉单个"数"字
        
        row = { baseKey, label, values: { '到访': null, '居住': null, '工作': null }, isSingleColumn: false }
        rowMap.set(baseKey, row)
        allRows.push(row)
      }
      row.values[typeName] = val
    } else {
      // 不是 prefix+digit+suffix 格式的字段
      let row = rowMap.get(key)
      if (!row) {
        const label = getFieldLabel('1001', key)
        if (label === key || label === '数') continue
        
        row = { baseKey: key, label, values: { '到访': null, '居住': null, '工作': null }, isSingleColumn: false }
        rowMap.set(key, row)
        allRows.push(row)
      }
      row.values['到访'] = val
    }
  }
  
  // 补充必填字段（如果API没有返回）
  for (const [key, fieldInfo] of Object.entries(pSumFields)) {
    if (!rowMap.has(key)) {
      const row = {
        baseKey: key,
        label: fieldInfo.label,
        values: { '到访': null, '居住': null, '工作': null },
        isSingleColumn: fieldInfo.isSingleColumn || false,
        singleValue: fieldInfo.isSingleColumn ? 0 : null
      }
      if (!fieldInfo.isSingleColumn) {
        row.values[fieldInfo.showIn] = 0
      }
      allRows.push(row)
      rowMap.set(key, row)
    }
  }
  
  // 按 sortOrder 排序
  const sortedRows = allRows.sort((a, b) => {
    let idxA = sortOrder.indexOf(a.baseKey)
    let idxB = sortOrder.indexOf(b.baseKey)
    if (idxA === -1) idxA = sortOrder.indexOf(a.label)
    if (idxB === -1) idxB = sortOrder.indexOf(b.label)
    if (idxA === -1 && idxB === -1) return 0
    if (idxA === -1) return 1
    if (idxB === -1) return -1
    return idxA - idxB
  })
  
  // 生成表格
  let html = `<table class="data-table cross-table">
    <thead>
      <tr>
        <th>指标名称</th>
        <th>到访</th>
        <th>居住</th>
        <th>工作</th>
      </tr>
    </thead>
    <tbody>`
  
  for (const row of sortedRows) {
    if (row.isSingleColumn) {
      // 单列显示：合并三个单元格
      html += `<tr>
        <td>${row.label}</td>
        <td colspan="3" class="num single-value">${row.singleValue !== null ? row.singleValue.toLocaleString() : '-'}</td>
      </tr>`
    } else {
      html += `<tr>
        <td>${row.label}</td>
        <td class="num">${row.values['到访'] !== null ? row.values['到访'].toLocaleString() : '-'}</td>
        <td class="num">${row.values['居住'] !== null ? row.values['居住'].toLocaleString() : '-'}</td>
        <td class="num">${row.values['工作'] !== null ? row.values['工作'].toLocaleString() : '-'}</td>
      </tr>`
    }
  }
  
  html += '</tbody></table>'
  return html
}

const formatArrayData = (data, serviceCode) => {
  if (!data) return '<p>暂无数据</p>'
  if (!Array.isArray(data) || data.length === 0) return '<p>暂无数据</p>'
  
  const firstItem = data[0]
  if (!firstItem || typeof firstItem !== 'object') return '<p>暂无数据</p>'
  
  // 如果是消费水平格式 {popu_type, spendpower, spendpower_value} - 合并为交叉表
  if (firstItem.popu_type !== undefined && firstItem.spendpower !== undefined && firstItem.spendpower_value !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    
    // 创建 spendpower 到数值的映射，按 popu_type 分列
    const spendMap = new Map()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const spendLevel = item.spendpower
      if (!spendMap.has(spendLevel)) {
        spendMap.set(spendLevel, { '到访': 0, '居住': 0, '工作': 0 })
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        spendMap.get(spendLevel)[type] = item.spendpower_value || 0
      }
    }
    
    // 按消费力等级排序
    const sortedSpend = [...spendMap.entries()].sort((a, b) => a[0] - b[0])
    
    // 消费力等级标签
    const spendLabels = {
      1: '消费力指数1（最低）',
      2: '消费力指数2',
      3: '消费力指数3',
      4: '消费力指数4',
      5: '消费力指数5',
      6: '消费力指数6',
      7: '消费力指数7',
      8: '消费力指数8（最高）'
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>消费力指数</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const [level, values] of sortedSpend) {
      const label = spendLabels[level] || `消费力指数${level}`
      html += `<tr><td>${label}</td><td class="num">${values['到访'].toLocaleString()}</td><td class="num">${values['居住'].toLocaleString()}</td><td class="num">${values['工作'].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 如果是人口教育水平格式 {popu_type, fname, p0, p1, p2, p3, p4} - 合并为交叉表
  if (firstItem.popu_type !== undefined && firstItem.p0 !== undefined && firstItem.fname !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p0': '高中及以下', 'p1': '大专', 'p2': '本科', 'p3': '硕士', 'p4': '博士' }
    const pKeys = ['p0', 'p1', 'p2', 'p3', 'p4']
    
    // 创建 fname 到数值的映射，按 popu_type 分列
    const eduMap = new Map()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const fname = item.fname || '-'
      if (!eduMap.has(fname)) {
        eduMap.set(fname, { '到访': {}, '居住': {}, '工作': {} })
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            eduMap.get(fname)[type][pKey] = item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>学历</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    
    // 遍历所有教育等级
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      let toVisit = 0, residence = 0, work = 0
      
      // 汇总所有 fname 下的该教育等级数据
      for (const [fname, values] of eduMap) {
        toVisit += values['到访'][pKey] || 0
        residence += values['居住'][pKey] || 0
        work += values['工作'][pKey] || 0
      }
      
      html += `<tr><td>${label}</td><td class="num">${toVisit.toLocaleString()}</td><td class="num">${residence.toLocaleString()}</td><td class="num">${work.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 根据 serviceCode 精确匹配各服务的数据格式
  // 1012: 人生阶段分布 {popu_type, p1, p2, p3}
  if (serviceCode === '1012' && firstItem.popu_type !== undefined && firstItem.p1 !== undefined && firstItem.p3 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '已婚已育', 'p2': '已婚未育', 'p3': '未婚未育' }
    const pKeys = ['p1', 'p2', 'p3']
    
    const totals = { '到访': {}, '居住': {}, '工作': {} }
    for (const pKey of pKeys) {
      totals['到访'][pKey] = 0
      totals['居住'][pKey] = 0
      totals['工作'][pKey] = 0
    }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            totals[type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>人生阶段</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      html += `<tr><td>${label}</td><td class="num">${totals['到访'][pKey].toLocaleString()}</td><td class="num">${totals['居住'][pKey].toLocaleString()}</td><td class="num">${totals['工作'][pKey].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 1013: 综合消费能力预测 {popu_type, p1, p2, p3}
  if (serviceCode === '1013' && firstItem.popu_type !== undefined && firstItem.p1 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '消费水平高', 'p2': '消费水平中', 'p3': '消费水平低' }
    const pKeys = ['p1', 'p2', 'p3']
    
    const totals = { '到访': {}, '居住': {}, '工作': {} }
    for (const pKey of pKeys) {
      totals['到访'][pKey] = 0
      totals['居住'][pKey] = 0
      totals['工作'][pKey] = 0
    }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            totals[type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>消费能力</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      html += `<tr><td>${label}</td><td class="num">${totals['到访'][pKey].toLocaleString()}</td><td class="num">${totals['居住'][pKey].toLocaleString()}</td><td class="num">${totals['工作'][pKey].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 1014: 网购能力预测 {popu_type, p1, p2, p3, p4, p5}
  if (serviceCode === '1014' && firstItem.popu_type !== undefined && firstItem.p1 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '网购能力高', 'p2': '网购能力中高', 'p3': '网购能力中', 'p4': '网购能力中低', 'p5': '网购能力低' }
    const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5']
    
    const totals = { '到访': {}, '居住': {}, '工作': {} }
    for (const pKey of pKeys) {
      totals['到访'][pKey] = 0
      totals['居住'][pKey] = 0
      totals['工作'][pKey] = 0
    }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            totals[type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>网购能力</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      html += `<tr><td>${label}</td><td class="num">${totals['到访'][pKey].toLocaleString()}</td><td class="num">${totals['居住'][pKey].toLocaleString()}</td><td class="num">${totals['工作'][pKey].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 1015: 资产预测（收入/有车/有房）{popu_type, fname, p1, p2, p3, p4, p5}
  if (serviceCode === '1015' && firstItem.popu_type !== undefined && firstItem.fname !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '预测概率高', 'p2': '预测概率中高', 'p3': '预测概率中', 'p4': '预测概率中低', 'p5': '预测概率低' }
    const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5']
    
    const fnameGroups = {}
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const fname = item.fname || '-'
      if (!fnameGroups[fname]) {
        fnameGroups[fname] = { '到访': {}, '居住': {}, '工作': {} }
        for (const pKey of pKeys) {
          fnameGroups[fname]['到访'][pKey] = 0
          fnameGroups[fname]['居住'][pKey] = 0
          fnameGroups[fname]['工作'][pKey] = 0
        }
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            fnameGroups[fname][type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    const fnameConfig = {
      '收入预测': { title: '收入预测', bgClass: 'asset-income' },
      '有车预测': { title: '有车预测', bgClass: 'asset-car' },
      '有房预测': { title: '有房预测', bgClass: 'asset-house' }
    }
    
    let html = `<div class="pop-group">`
    for (const [fname, values] of Object.entries(fnameGroups)) {
      const config = fnameConfig[fname] || { title: fname, bgClass: '' }
      html += `<div class="asset-section ${config.bgClass}">
        <div class="group-header">${config.title}</div>
        <table class="data-table cross-table"><thead><tr><th>概率等级</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
      for (const pKey of pKeys) {
        const label = pLabels[pKey] || pKey
        html += `<tr><td>${label}</td><td class="num">${values['到访'][pKey].toLocaleString()}</td><td class="num">${values['居住'][pKey].toLocaleString()}</td><td class="num">${values['工作'][pKey].toLocaleString()}</td></tr>`
      }
      html += '</tbody></table></div>'
    }
    html += '</div>'
    return html
  }
  
  // 如果是人口行业分布格式 {popu_type, fname, p1, p2, ..., p10} - 合并为交叉表
  if (firstItem.popu_type !== undefined && firstItem.p1 !== undefined && firstItem.p10 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = {
      'p1': '金融从业者',
      'p2': '医务人员',
      'p3': '公务员&事业单位',
      'p4': '白领及一般职员',
      'p5': '工人及服务业人员',
      'p6': '教师',
      'p7': '农民及其他',
      'p8': '网约车司机',
      'p9': '外卖员',
      'p10': '快递员'
    }
    const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']
    
    // 创建 fname 到数值的映射，按 popu_type 分列
    const jobMap = new Map()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const fname = item.fname || '-'
      if (!jobMap.has(fname)) {
        jobMap.set(fname, { '到访': {}, '居住': {}, '工作': {} })
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            jobMap.get(fname)[type][pKey] = item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>行业</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    
    // 遍历所有行业
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      let toVisit = 0, residence = 0, work = 0
      
      // 汇总所有 fname 下的该行业数据
      for (const [fname, values] of jobMap) {
        toVisit += values['到访'][pKey] || 0
        residence += values['居住'][pKey] || 0
        work += values['工作'][pKey] || 0
      }
      
      html += `<tr><td>${label}</td><td class="num">${toVisit.toLocaleString()}</td><td class="num">${residence.toLocaleString()}</td><td class="num">${work.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
    // 1002: 上网标签分布格式 {popu_type, tag_value, tag_name} - 按人群类型分别显示前10
  if (firstItem.tag_value !== undefined && firstItem.tag_name !== undefined) {
    // 按 popu_type 分组（0=到访 1=居住 2=工作）
    const byPop = { 0: {}, 1: {}, 2: {} }
    for (const item of data) {
      if (item && typeof item === 'object' && item.tag_name && item.tag_value !== undefined && byPop[item.popu_type]) {
        byPop[item.popu_type][item.tag_name] = Number(item.tag_value)
      }
    }
    // 标签并集，按"到访"值降序取前10
    const tagNames = [...new Set(data.filter(d => d && d.tag_name).map(d => d.tag_name))]
    const rows = tagNames
      .map(name => ({ name, v0: byPop[0][name] || 0, v1: byPop[1][name] || 0, v2: byPop[2][name] || 0 }))
      .sort((a, b) => b.v0 - a.v0)
      .slice(0, 10)

    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>标签</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const row of rows) {
      html += `<tr><td>${row.name}</td><td class="num">${row.v0.toLocaleString()}</td><td class="num">${row.v1.toLocaleString()}</td><td class="num">${row.v2.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  // 如果是每日人流量及停留时长格式 {day_type, day_visit, day_all, stay1, stay2, ...}
  if (firstItem.day_visit !== undefined && firstItem.day_all !== undefined && firstItem.stay1 !== undefined) {
    const dayTypes = { 0: '工作日', 1: '周末' }
    const groups = { '工作日': [], '周末': [], '其他': [] }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const dayType = dayTypes[item.day_type] || '其他'
      if (!groups[dayType]) groups[dayType] = []
      groups[dayType].push(item)
    }
    
    // 定义正确的字段顺序
    const fieldOrder = ['day_visit', 'day_all', 'stay1', 'stay2', 'stay3', 'stay4', 'stay5', 'stay6']
    const fieldLabels = {
      'day_visit': '日均到访人次',
      'day_all': '日均全量人次',
      'stay1': '停留<30分钟',
      'stay2': '停留30-60分钟',
      'stay3': '停留1-2小时',
      'stay4': '停留2-4小时',
      'stay5': '停留4-8小时',
      'stay6': '停留>8小时'
    }
    
    let html = ''
    for (const [dayType, items] of Object.entries(groups)) {
      // 跳过空数据
      if (items.length === 0) continue
      
      // 只显示工作日和周末，不显示"其他"的标题
      const showHeader = dayType !== '其他'
      
      const totalVisit = items.reduce((sum, item) => sum + (item.day_visit || 0), 0)
      const totalAll = items.reduce((sum, item) => sum + (item.day_all || 0), 0)
      
      html += `<div class="pop-group">`
      if (showHeader) {
        html += `<div class="group-header">${dayType} <span class="group-total">到访${totalVisit.toLocaleString()} / 全量${totalAll.toLocaleString()}</span></div>`
      }
      html += `<table class="data-table"><thead><tr><th>指标</th><th>数值</th></tr></thead><tbody>`
      
      for (const field of fieldOrder) {
        if (field in items[0]) {
          const values = items.map(item => item[field] || 0)
          const total = values.reduce((a, b) => a + b, 0)
          html += `<tr><td>${fieldLabels[field] || field}</td><td class="num">${total.toLocaleString()}</td></tr>`
        }
      }
      html += '</tbody></table></div>'
    }
    return html || '<p>暂无数据</p>'
  }
  
  // 如果是每月到达次数分布格式 {month, reach1/reach6, ...}
  // 检测：month 字段 + reach 开头的数字字段
  const hasReachFields = (obj) => {
    if (!obj || typeof obj !== 'object') return false
    const keys = Object.keys(obj)
    // 检查是否有 reach1-6 或 Reach1-6 等变体
    const reachNums = []
    for (const key of keys) {
      const match = key.match(/^reach(\d+)$/i)
      if (match) reachNums.push(parseInt(match[1]))
    }
    return reachNums.length > 0
  }
  
  if (hasReachFields(firstItem)) {
    // 动态检测 reach 字段并按数字排序
    const reachFields = []
    for (const key of Object.keys(firstItem)) {
      const match = key.match(/^reach(\d+)$/i)
      if (match) {
        reachFields.push({ key, num: parseInt(match[1]) })
      }
    }
    reachFields.sort((a, b) => a.num - b.num)
    
    // reach 字段名称映射（按序号）
    const reachLabels = {
      1: '月驻留1次',
      2: '月驻留2-4次',
      3: '月驻留5-10次',
      4: '月驻留11-20次',
      5: '月驻留20次以上'
    }
    
    // 按月排序（如果有 month 字段）
    const hasMonth = data.some(item => item.month !== undefined)
    const sorted = hasMonth ? [...data].sort((a, b) => (a.month || '').localeCompare(b.month || '')) : data
    
    let html = `<div class="pop-group">
      <table class="data-table"><thead><tr>`
    if (hasMonth) {
      html += `<th>月份</th>`
    }
    for (const { key, num } of reachFields) {
      html += `<th>${reachLabels[num] || key}</th>`
    }
    html += `</tr></thead><tbody>`
    
    for (const item of sorted) {
      if (hasMonth) {
        html += `<tr><td>${item.month || '-'}</td>`
      } else {
        html += `<tr>`
      }
      for (const { key } of reachFields) {
        html += `<td class="num">${(item[key] || 0).toLocaleString()}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 如果是小时段格式 {day_type, hour_period, hour_all, hour_visit} - 合并工作日和周末
  if (firstItem.day_type !== undefined && firstItem.hour_period !== undefined) {
    // 按小时分组
    const hourMap = new Map()
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const hour = item.hour_period
      if (!hourMap.has(hour)) {
        hourMap.set(hour, { 工作日: null, 周末: null })
      }
      const entry = hourMap.get(hour)
      if (item.day_type === 0) {
        entry.工作日 = item
      } else if (item.day_type === 1) {
        entry.周末 = item
      }
    }
    
    // 按小时排序
    const sortedHours = [...hourMap.entries()].sort((a, b) => a[0] - b[0])
    
    let html = `<div class="pop-group">
      <table class="data-table"><thead><tr><th>时段</th><th>工作日到访人次</th><th>周末到访人次</th><th>工作日全量人次</th><th>周末全量人次</th></tr></thead><tbody>`
    for (const [hour, entries] of sortedHours) {
      const weekday = entries.工作日
      const weekend = entries.周末
      html += `<tr>
        <td>${hour}点</td>
        <td class="num">${(weekday?.hour_visit || 0).toLocaleString()}</td>
        <td class="num">${(weekend?.hour_visit || 0).toLocaleString()}</td>
        <td class="num">${(weekday?.hour_all || 0).toLocaleString()}</td>
        <td class="num">${(weekend?.hour_all || 0).toLocaleString()}</td>
      </tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 默认数组格式 - 直接显示表格
  let html = `<table class="data-table"><thead><tr>`
  const headers = Object.keys(firstItem)
  for (const h of headers) {
    html += `<th>${h}</th>`
  }
  html += `</tr></thead><tbody>`
  
  for (const item of data.slice(0, 20)) {  // 限制前20行
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

const formatOtherData = (data, serviceCode) => {
  // 按人群类型分组
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
  // 显示每个分组
  for (const [type, items] of Object.entries(groups)) {
    if (Object.keys(items).length === 0) continue
    const total = Object.values(items).reduce((a, b) => a + b, 0)
    
    // 按字段名排序
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

const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const formatReportRows = (rows, apiResult) => {
  const compatBySource = new Map()
  for (const c of buildCompatMap(rows, excludeServices)) {
    for (const s of c.sources) compatBySource.set(s, c)
  }

  let html = ''
  const rendered = new Set()
  for (const { code, rows: codeRows } of groupRowsByCode(rows, excludeServices)) {
    // 1001 已有「指标名称 / 到访 / 居住 / 工作」四列透视，比长表更好读 ⇒ 保持原渲染
    if (code === '1001' && apiResult && apiResult['1001']) {
      html += `<div class="detail-result">${formatP0SData(apiResult['1001'])}</div>`
      continue
    }
    // ① 标准结构：与普通记录同一套表格渲染
    const compat = compatBySource.get(code)
    if (compat) {
      if (rendered.has(compat.code)) continue // 老导出把资产拆成 1014/1015/1016 ⇒ 只出一段
      rendered.add(compat.code)
      html += `<div class="detail-result">
        <h4>📊 ${escHtml(getServiceName(compat.code))}</h4>
        ${formatArrayData(compat.data, compat.code)}
      </div>`
      continue
    }
    // ② 兜底：报表中文两列表
    const blocks = splitReportBlocks(codeRows)
    if (!blocks.length) continue // 报表里该码全部无数值
    const codeName = getServiceName(code)
    html += `<div class="detail-result"><h4>📊 ${escHtml(codeName)}</h4>`
    for (const b of blocks) {
      const t = shortBlockTitle(codeName, b.title)
      // 只有一个块、且块名与段名相同 ⇒ 不再重复印一遍块头
      const head = (blocks.length === 1 && (!t || t === cleanGroupTitle(codeName)))
        ? ''
        : `<div class="group-header">${escHtml(t)}</div>`
      html += `<div class="pop-group">
        ${head}
        <table class="data-table"><thead><tr><th>指标名称</th><th>数值</th></tr></thead><tbody>`
      for (const it of b.items) {
        html += `<tr><td>${escHtml(it.label)}</td><td class="num">${it.value.toLocaleString()}</td></tr>`
      }
      html += '</tbody></table></div>'
    }
    html += '</div>'
  }
  return html || '<p>暂无数据</p>'
}

const formatResultData = (data) => {
  if (!data) return '<p>暂无数据</p>'
  
  // 如果 data 是字符串，尝试解析
  let apiResult = data
  if (typeof data === 'string') {
    try {
      apiResult = JSON.parse(data)
    } catch (e) {
      console.error('JSON解析失败:', e)
      return '<p>暂无数据</p>'
    }
  }
  
  // 如果 data 是 { apiResult: {...} } 格式
  // v1.13.427：导入记录多带一份报表原生长表（reportRows）⇒ 先取出来，走中文渲染
  const reportRows = Array.isArray(apiResult?.reportRows) ? apiResult.reportRows : null
  if (apiResult && apiResult.apiResult) {
    apiResult = apiResult.apiResult
  }
  if (reportRows && reportRows.length) return formatReportRows(reportRows, apiResult)
  
  if (!apiResult || typeof apiResult !== 'object') return '<p>暂无数据</p>'
  if (apiResult.error) return `<p style="color:red;">❌ ${apiResult.error}</p>`

  let html = ''
  
  for (const [key, value] of Object.entries(apiResult)) {
    if (key === 'error') continue
    // 跳过排除列表中的服务
    if (excludeServices.includes(key)) continue
    const serviceName = getServiceName(key)
    
    // 1001 服务特殊处理 - 分列对比表格
    if (key === '1001' && typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result">
        ${formatP0SData(value)}
      </div>`
      continue
    }
    
    // 1006 每日人流量及停留时长 - 数组格式处理
    if (key === '1006' && Array.isArray(value)) {
      const stayLabelMap = {
        'stay1': '停留<30分钟',
        'stay2': '停留30-60分钟',
        'stay3': '停留1-2小时',
        'stay4': '停留2-4小时',
        'stay5': '停留4小时以上'
      };
      
      // 计算汇总数据
      let totalDayVisit = 0, totalDayAll = 0;
      let totalStay1 = 0, totalStay2 = 0, totalStay3 = 0, totalStay4 = 0, totalStay5 = 0;
      let dayCount = value.length;
      
      value.forEach(item => {
        totalDayVisit += item.day_visit || 0;
        totalDayAll += item.day_all || 0;
        totalStay1 += item.stay1 || 0;
        totalStay2 += item.stay2 || 0;
        totalStay3 += item.stay3 || 0;
        totalStay4 += item.stay4 || 0;
        totalStay5 += item.stay5 || 0;
      });
      
      const avgLabelMap = {
        'day_visit': '日均到访人次',
        'day_all': '日均全量人次',
        'stay1': '日均停留<30分钟',
        'stay2': '日均停留30-60分钟',
        'stay3': '日均停留1-2小时',
        'stay4': '日均停留2-4小时',
        'stay5': '日均停留4小时以上'
      };
      
      const avgData = {
        'day_visit': Math.round(totalDayVisit / dayCount),
        'day_all': Math.round(totalDayAll / dayCount),
        'stay1': Math.round(totalStay1 / dayCount),
        'stay2': Math.round(totalStay2 / dayCount),
        'stay3': Math.round(totalStay3 / dayCount),
        'stay4': Math.round(totalStay4 / dayCount),
        'stay5': Math.round(totalStay5 / dayCount)
      };
      
      let summaryHtml = '<table class="data-table"><thead><tr><th>指标</th><th class="num">日均值</th><th class="num">月度累计</th></tr></thead><tbody>';
      for (const [k, v] of Object.entries(avgData)) {
        const label = avgLabelMap[k] || k;
        const total = k === 'day_visit' ? totalDayVisit : 
                      k === 'day_all' ? totalDayAll :
                      k === 'stay1' ? totalStay1 :
                      k === 'stay2' ? totalStay2 :
                      k === 'stay3' ? totalStay3 :
                      k === 'stay4' ? totalStay4 : totalStay5;
        summaryHtml += `<tr><td>${label}</td><td class="num">${v.toLocaleString()}</td><td class="num">${total.toLocaleString()}</td></tr>`;
      }
      summaryHtml += '</tbody></table>';
      
      let detailHtml = '<table class="data-table" style="margin-top:10px;"><thead><tr><th>日期</th><th class="num">到访人次</th><th class="num">全量人次</th><th class="num">停留&lt;30m</th><th class="num">30-60m</th><th class="num">1-2h</th><th class="num">2-4h</th><th class="num">4h+</th></tr></thead><tbody>';
      value.forEach(item => {
        const dateStr = item.date ? `${item.date.slice(0,4)}-${item.date.slice(4,6)}-${item.date.slice(6,8)}` : '';
        detailHtml += `<tr>
          <td>${dateStr}</td>
          <td class="num">${(item.day_visit || 0).toLocaleString()}</td>
          <td class="num">${(item.day_all || 0).toLocaleString()}</td>
          <td class="num">${(item.stay1 || 0).toLocaleString()}</td>
          <td class="num">${(item.stay2 || 0).toLocaleString()}</td>
          <td class="num">${(item.stay3 || 0).toLocaleString()}</td>
          <td class="num">${(item.stay4 || 0).toLocaleString()}</td>
          <td class="num">${(item.stay5 || 0).toLocaleString()}</td>
        </tr>`;
      });
      detailHtml += '</tbody></table>';
      
      html += `<div class="detail-result">
        <h4>📊 ${serviceName}（${dayCount}天）</h4>
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">数据范围：${value[0]?.date?.slice(0,4)}-${value[0]?.date?.slice(4,6)}-${value[0]?.date?.slice(6,8)} 至 ${value[value.length-1]?.date?.slice(0,4)}-${value[value.length-1]?.date?.slice(4,6)}-${value[value.length-1]?.date?.slice(6,8)}</div>
        <h5 style="margin:8px 0 4px;">📈 日均汇总</h5>
        ${summaryHtml}
        <h5 style="margin:12px 0 4px;">📅 每日明细</h5>
        ${detailHtml}
      </div>`
      continue
    }
    
    // 数组格式数据（如 1002, 1005 等）
    if (Array.isArray(value)) {
      html += `<div class="detail-result">
        <h4>📊 ${serviceName}</h4>
        ${formatArrayData(value, key)}
      </div>`
      continue
    }
    
    // 其他服务 - 传递服务代码以获取正确的中文标签
    if (typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result">
        <h4>📊 ${serviceName}</h4>
        ${formatOtherData(value, key)}
      </div>`
    } else if (typeof value === 'number') {
      html += `<div class="result-item">
        <span class="result-label">${serviceName}</span>
        <span class="result-value">${value.toLocaleString()}</span>
      </div>`
    }
  }
  
  return html || '<p>暂无数据</p>'
}

export {
  excludeServices, getServiceName, formatP0SData, formatArrayData, formatOtherData,
  formatResultData, formatReportRows
}
