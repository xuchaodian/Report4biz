/**
 * unicomDetailSheets.js — 联通智慧足迹「查询结果详情」等价渲染器（Node 版）
 *
 * 镜像来源：frontend/src/components/StoreSmartstepsDialog.vue 的详情渲染逻辑
 *   formatResultData (~L720) / formatP0SData (~L834) / formatArrayData (~L929) / formatOtherData (~L1711)
 * ⚠️ 同步契约：前端详情页展示逻辑改动时，本文件必须同步修改（输出 = 详情页内容）
 *
 * 输出模型：blocks[] = 平铺的"详情页内容"，每项：
 *   { t:'sec',  s:'人口基础属性' }             —— 服务节标题（详情页 h4）
 *   { t:'kv',   label:'到访人数', value:170881 } —— 单值行（详情页大数字卡片/简单值）
 *   { t:'table', title:'年龄段分布', headers:[...], rows:[[...]] } —— 表格（详情页 data-table）
 * 调用方把 blocks 依次写入 Excel 单元格（表间/节间加空行）即可与详情页同构。
 */

// 排除的服务列表 —— 与 StoreSmartstepsDialog.vue L696 excludeServices 完全一致
const excludeServices = ['1004', '1016', '1003', '1008', '1019', '1002', '1017', '1018', '1021', '1022', '1023', '1020']

// 服务名称映射 —— 与 StoreSmartstepsDialog.vue L700-715 一致
const serviceNames = {
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
  '1015': '资产预测（收入/有车/有房）'
}

const getServiceName = (code) => serviceNames[code] || `服务${code}`

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 剥壳：字符串 / {apiResult:{...}} → 原始 data 对象 */
function unwrapResult(resultData) {
  if (!resultData) return null
  let data = resultData
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch (e) { return null }
  }
  if (data && typeof data === 'object' && data.apiResult && typeof data.apiResult === 'object') {
    data = data.apiResult
  }
  if (!data || typeof data !== 'object' || data.error) return data || null
  return data
}

/* ================= 1001 全量人口（formatP0SData 镜像，L834-925） ================= */
function render1001(data, out) {
  const visitTotal = num(data.p0_sum)
  const grandTotal = num(data.pall_sum)
  const dwellTotal = num(data.male1_sum) + num(data.female1_sum)
  const workTotal = num(data.male2_sum) + num(data.female2_sum)

  out.push({ t: 'kv', label: '到访人数', value: visitTotal })
  out.push({ t: 'kv', label: '居住人数', value: dwellTotal })
  out.push({ t: 'kv', label: '工作人数', value: workTotal })

  // 其他人口（P层级去 P1/P2）
  const pRows = [
    ['总人口规模', grandTotal],
    ['外省到访人数', num(data.p3_sum)],
    ['娱乐人数', num(data.p4_sum)],
    ['居住工作重合人数', num(data.p5_sum)]
  ].filter(([, v]) => v > 0)
  if (pRows.length) out.push({ t: 'table', title: '其他人口', headers: ['其他人口', '人数'], rows: pRows })

  // 性别分布
  const gRows = []
  const male0 = num(data.male0_sum), female0 = num(data.female0_sum)
  const male1 = num(data.male1_sum), female1 = num(data.female1_sum)
  const male2 = num(data.male2_sum), female2 = num(data.female2_sum)
  if (male0 + female0 + male1 + female1 + male2 + female2 > 0) {
    gRows.push(['男性人数', male0, male1, male2])
    gRows.push(['女性人数', female0, female1, female2])
    out.push({ t: 'table', title: '性别分布', headers: ['性别', '到访', '居住', '工作'], rows: gRows })
  }

  // 年龄段分布
  const ageGroups = [
    ['0-6岁', '0006'], ['6-12岁', '0612'], ['12-15岁', '1215'], ['15-18岁', '1518'],
    ['19-24岁', '1924'], ['25-29岁', '2529'], ['30-34岁', '3034'], ['35-39岁', '3539'],
    ['40-44岁', '4044'], ['45-49岁', '4549'], ['50-54岁', '5054'], ['55-59岁', '5559'],
    ['60-64岁', '6064'], ['65-69岁', '6569'], ['70岁+', '70up']
  ]
  const ageRows = []
  for (const [label, code] of ageGroups) {
    const v0 = num(data[`age0_${code}`])
    const v1 = num(data[`age1_${code}`])
    const v2 = num(data[`age2_${code}`])
    if (v0 + v1 + v2 === 0) continue
    ageRows.push([label, v0, v1, v2])
  }
  if (ageRows.length) out.push({ t: 'table', title: '年龄段分布', headers: ['年龄段', '到访', '居住', '工作'], rows: ageRows })

  // 月出账金额
  const arpuGroups = [
    ['50元以下', '50'], ['50-100元', '100'], ['100-150元', '150'],
    ['150-200元', '200'], ['200-250元', '250'], ['250元以上', 'up']
  ]
  const arpuRows = []
  for (const [label, suffix] of arpuGroups) {
    const v0 = num(data[`arpu0_${suffix}`])
    const v1 = num(data[`arpu1_${suffix}`])
    const v2 = num(data[`arpu2_${suffix}`])
    if (v0 + v1 + v2 === 0) continue
    arpuRows.push([label, v0, v1, v2])
  }
  if (arpuRows.length) out.push({ t: 'table', title: '月出账金额', headers: ['话费区间', '到访', '居住', '工作'], rows: arpuRows })
}

/* ================= 数组型服务（formatArrayData 镜像，L929-1708） ================= */
function renderArray(data, serviceCode, out) {
  if (!Array.isArray(data) || data.length === 0) return
  const firstItem = data[0]
  const typeNames = ['到访', '居住', '工作']
  const typeLabel = (t) => typeNames[Number(t)] || `类型${t}`

  // 1005 每小时段人口流量 {day_type, hour_period, hour_all, hour_visit}
  if (firstItem && firstItem.day_type !== undefined && firstItem.hour_period !== undefined) {
    const dataMap = {}
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const hour = item.hour_period
      const dayType = Number(item.day_type)
      if (hour === undefined) continue
      if (!dataMap[hour]) dataMap[hour] = { 0: { visit: 0, all: 0 }, 1: { visit: 0, all: 0 } }
      dataMap[hour][dayType] = { visit: num(item.hour_visit), all: num(item.hour_all) }
    }
    const hours = Object.keys(dataMap).map(Number).sort((a, b) => a - b)
    const rows = hours.map(hour => {
      const wd = dataMap[hour][0] || { visit: 0, all: 0 }
      const we = dataMap[hour][1] || { visit: 0, all: 0 }
      return [`${hour}点`, wd.visit, we.visit, wd.all, we.all]
    })
    out.push({ t: 'table', title: '每小时段人口流量', headers: ['时段', '工作日到访人次', '周末到访人次', '工作日全量人次', '周末全量人次'], rows })
    return
  }

  // 1006 每日人流量及停留时长 {date, day_visit, day_all, stay1-5}
  if (firstItem && firstItem.date !== undefined && firstItem.day_visit !== undefined) {
    const columnOrder = [
      { key: 'day_visit', label: '到访人次' },
      { key: 'day_all', label: '全量人次' },
      { key: 'stay1', label: '停留<30m' },
      { key: 'stay2', label: '停留30-60m' },
      { key: 'stay3', label: '停留1-2h' },
      { key: 'stay4', label: '停留2-4h' },
      { key: 'stay5', label: '停留4h+' }
    ]
    const days = data.length
    const totals = {}
    for (const col of columnOrder) totals[col.key] = 0
    for (const item of data) {
      for (const col of columnOrder) totals[col.key] += num(item[col.key])
    }
    const dates = data.map(d => d.date).filter(Boolean).sort()
    const dateRange = dates.length > 0 ? `${dates[0]} 至 ${dates[dates.length - 1]}` : ''
    const avgRows = columnOrder.map(col => [col.label, Math.round(totals[col.key] / days), totals[col.key]])
    out.push({ t: 'table', title: '每日人流量及停留时长 · 日均汇总' + (dateRange ? `（${dateRange}）` : ''), headers: ['指标', '日均值', '月度累计'], rows: avgRows })
    const detailLabels = ['日期', '到访人次', '全量人次', '停留<30m', '30-60m', '1-2h', '2-4h', '4h+']
    const detailRows = data.map(item => [
      item.date || '-',
      num(item.day_visit), num(item.day_all),
      num(item.stay1), num(item.stay2), num(item.stay3), num(item.stay4), num(item.stay5)
    ])
    out.push({ t: 'table', title: '每日明细', headers: detailLabels, rows: detailRows })
    return
  }

  // 1006' 到访频次分析 {popu_type, freq, visit_count}
  if (firstItem && firstItem.freq !== undefined) {
    const freqLabels = {
      '1': '月均1次以下', '2': '月均1-2次', '3': '月均3-4次', '4': '月均5-8次',
      '5': '月均8次以上', '6': '周均1次以下', '7': '周均1-3次', '8': '周均3-5次', '9': '周均5次以上'
    }
    const freqs = [...new Set(data.map(d => d.freq))].sort()
    const types = [...new Set(data.map(d => d.popu_type))].sort()
    const rows = freqs.map(freq => {
      const row = [freqLabels[freq] || `频次${freq}`]
      for (const typeIdx of types) {
        const item = data.find(d => d.freq === freq && d.popu_type === typeIdx)
        row.push(item ? num(item.visit_count) : 0)
      }
      return row
    })
    out.push({ t: 'table', title: '到访频次分析', headers: ['到访频次', ...types.map(typeLabel)], rows })
    return
  }

  // 1007 每月到达次数分布 {popu_type?, reach1-5}
  const hasReachField = Object.keys(firstItem || {}).some(k => String(k).includes('reach'))
  if (hasReachField) {
    const reachLabelMap = {
      reach1: '月驻留1次', reach2: '月驻留2-4次', reach3: '月驻留5-10次',
      reach4: '月驻留11-20次', reach5: '月驻留20次以上'
    }
    const reachKeys = Object.keys(firstItem).filter(k => String(k).includes('reach'))
      .sort((a, b) => parseInt(a.replace('reach', '')) - parseInt(b.replace('reach', '')))
    const hasPopuType = firstItem.popu_type !== undefined
    if (hasPopuType) {
      const types = [...new Set(data.map(d => d.popu_type))].sort()
      const rows = reachKeys.map(key => {
        const row = [reachLabelMap[key] || key]
        for (const t of types) {
          const item = data.find(d => d.popu_type === t)
          row.push(item ? num(item[key]) : 0)
        }
        return row
      })
      out.push({ t: 'table', title: '每月到达次数分布', headers: ['指标', ...types.map(typeLabel)], rows })
    } else {
      const rows = reachKeys.map(key => [reachLabelMap[key] || key, num(firstItem[key])])
      out.push({ t: 'table', title: '每月到达次数分布', headers: ['指标', '数值'], rows })
    }
    return
  }

  // 1009 消费水平（富裕指数）{popu_type, level|spendpower, pop_value|spendpower_value}
  if (serviceCode === '1009') {
    const levelField = firstItem.level !== undefined ? 'level' : firstItem.spendpower !== undefined ? 'spendpower' : null
    const valueField = firstItem.pop_value !== undefined ? 'pop_value' : firstItem.spendpower_value !== undefined ? 'spendpower_value' : null
    const typeField = firstItem.popu_type !== undefined ? 'popu_type' : null
    if (levelField && valueField && typeField) {
      const spendMap = {}
      for (const item of data) {
        const level = Number(item[levelField])
        const popuType = Number(item[typeField])
        if (!spendMap[level]) spendMap[level] = { '到访': 0, '居住': 0, '工作': 0 }
        const popValue = num(item[valueField])
        const key = popuType === 0 ? '到访' : popuType === 1 ? '居住' : '工作'
        spendMap[level][key] = popValue
      }
      const spendLabels = {
        1: '消费力指数1（最低）', 2: '消费力指数2', 3: '消费力指数3', 4: '消费力指数4',
        5: '消费力指数5', 6: '消费力指数6', 7: '消费力指数7', 8: '消费力指数8（最高）'
      }
      const rows = []
      for (let level = 1; level <= 8; level++) {
        const d = spendMap[level] || { '到访': 0, '居住': 0, '工作': 0 }
        rows.push([spendLabels[level] || `消费力指数${level}`, d['到访'], d['居住'], d['工作']])
      }
      out.push({ t: 'table', title: '消费水平（富裕指数）', headers: ['消费力指数', '到访', '居住', '工作'], rows })
      return
    }
  }

  // 1010 人口教育水平 {popu_type?, fname, p0-p4}
  if (serviceCode === '1010') {
    const hasAll = ['p0', 'p1', 'p2', 'p3', 'p4'].every(k => firstItem[k] !== undefined)
    if (hasAll) {
      const columnOrder = [
        { key: 'p0', label: '高中及以下' }, { key: 'p1', label: '大专' }, { key: 'p2', label: '本科' },
        { key: 'p3', label: '硕士' }, { key: 'p4', label: '博士' }
      ]
      const hasPopuType = firstItem.popu_type !== undefined
      if (hasPopuType) {
        const eduMap = {}
        for (const item of data) {
          const popuTypeLabel = typeLabel(item.popu_type)
          for (const col of columnOrder) {
            if (!eduMap[col.label]) eduMap[col.label] = { '到访': 0, '居住': 0, '工作': 0 }
            eduMap[col.label][popuTypeLabel] = num(item[col.key])
          }
        }
        const rows = columnOrder.map(col => {
          const d = eduMap[col.label] || { '到访': 0, '居住': 0, '工作': 0 }
          return [col.label, d['到访'], d['居住'], d['工作']]
        })
        out.push({ t: 'table', title: '人口教育水平', headers: ['学历', '到访', '居住', '工作'], rows })
      } else {
        const rows = columnOrder.map(col => {
          const item = data.find(d => d[col.key] !== undefined)
          return [col.label, item ? num(item[col.key]) : 0, 0, 0]
        })
        out.push({ t: 'table', title: '人口教育水平', headers: ['学历', '到访', '居住', '工作'], rows })
      }
      return
    }
  }

  // 1011 人口行业分布 {popu_type?, p1-p10}
  if (serviceCode === '1011') {
    const hasAll = Array.from({ length: 10 }, (_, i) => `p${i + 1}`).every(k => firstItem[k] !== undefined)
    if (hasAll) {
      const industryLabels = {
        p1: '金融从业者', p2: '医务人员', p3: '公务员&事业单位', p4: '白领及一般职员', p5: '工人及服务业人员',
        p6: '教师', p7: '农民及其他', p8: '网约车司机', p9: '外卖员', p10: '快递员'
      }
      const displayOrder = ['金融从业者', '医务人员', '公务员&事业单位', '白领及一般职员', '工人及服务业人员', '教师', '农民及其他', '网约车司机', '外卖员', '快递员']
      const hasPopuType = firstItem.popu_type !== undefined
      const rows = []
      if (hasPopuType) {
        const industryMap = {}
        for (const name of displayOrder) industryMap[name] = { '到访': 0, '居住': 0, '工作': 0 }
        for (const item of data) {
          const popuTypeLabel = typeLabel(item.popu_type)
          for (let i = 1; i <= 10; i++) {
            const pKey = `p${i}`
            industryMap[industryLabels[pKey]][popuTypeLabel] = num(item[pKey])
          }
        }
        for (const name of displayOrder) {
          const d = industryMap[name] || { '到访': 0, '居住': 0, '工作': 0 }
          rows.push([name, d['到访'], d['居住'], d['工作']])
        }
      } else {
        for (let i = 1; i <= 10; i++) {
          const pKey = `p${i}`
          const item = data.find(d => d[pKey] !== undefined)
          rows.push([industryLabels[pKey], item ? num(item[pKey]) : 0, 0, 0])
        }
      }
      out.push({ t: 'table', title: '人口行业分布', headers: ['行业', '到访', '居住', '工作'], rows })
      return
    }
  }

  // 1012 人生阶段分布 / 1013 综合消费能力预测（同构：labels 3 项 p1-p3）
  if (serviceCode === '1012' || serviceCode === '1013') {
    const labelMap = serviceCode === '1012'
      ? { p1: '已婚已育', p2: '已婚未育', p3: '未婚未育' }
      : { p1: '消费水平高', p2: '消费水平中', p3: '消费水平低' }
    const title = serviceCode === '1012' ? '人生阶段分布' : '综合消费能力预测'
    const dimName = serviceCode === '1012' ? '人生阶段' : '消费能力'
    const hasAll = ['p1', 'p2', 'p3'].every(k => firstItem[k] !== undefined)
    if (hasAll) {
      const displayOrder = Object.values(labelMap)
      const hasPopuType = firstItem.popu_type !== undefined
      const rows = []
      if (hasPopuType) {
        const map = {}
        for (const name of displayOrder) map[name] = { '到访': 0, '居住': 0, '工作': 0 }
        for (const item of data) {
          const popuTypeLabel = typeLabel(item.popu_type)
          for (const [pKey, name] of Object.entries(labelMap)) map[name][popuTypeLabel] = num(item[pKey])
        }
        for (const name of displayOrder) {
          const d = map[name] || { '到访': 0, '居住': 0, '工作': 0 }
          rows.push([name, d['到访'], d['居住'], d['工作']])
        }
      } else {
        for (const [pKey, name] of Object.entries(labelMap)) {
          const item = data.find(d => d[pKey] !== undefined)
          rows.push([name, item ? num(item[pKey]) : 0, 0, 0])
        }
      }
      out.push({ t: 'table', title, headers: [dimName, '到访', '居住', '工作'], rows })
      return
    }
  }

  // 1014 网购能力预测 {popu_type?, p1-p5}
  if (serviceCode === '1014') {
    const labelMap = { p1: '网购能力高', p2: '网购能力中高', p3: '网购能力中', p4: '网购能力中低', p5: '网购能力低' }
    const displayOrder = ['网购能力高', '网购能力中高', '网购能力中', '网购能力中低', '网购能力低']
    const hasAll = ['p1', 'p2', 'p3', 'p4', 'p5'].every(k => firstItem[k] !== undefined)
    if (hasAll) {
      const hasPopuType = firstItem.popu_type !== undefined
      const rows = []
      if (hasPopuType) {
        const map = {}
        for (const name of displayOrder) map[name] = { '到访': 0, '居住': 0, '工作': 0 }
        for (const item of data) {
          const popuTypeLabel = typeLabel(item.popu_type)
          for (const [pKey, name] of Object.entries(labelMap)) map[name][popuTypeLabel] = num(item[pKey])
        }
        for (const name of displayOrder) {
          const d = map[name] || { '到访': 0, '居住': 0, '工作': 0 }
          rows.push([name, d['到访'], d['居住'], d['工作']])
        }
      } else {
        for (const [pKey, name] of Object.entries(labelMap)) {
          const item = data.find(d => d[pKey] !== undefined)
          rows.push([name, item ? num(item[pKey]) : 0, 0, 0])
        }
      }
      out.push({ t: 'table', title: '网购能力预测', headers: ['网购能力', '到访', '居住', '工作'], rows })
      return
    }
  }

  // 1015 资产预测 {fname?, popu_type?, p1-p5} — 按 fname 拆收入/有车/有房
  if (serviceCode === '1015') {
    const probabilityLabels = { p1: '预测概率高', p2: '预测概率中高', p3: '预测概率中', p4: '预测概率中低', p5: '预测概率低' }
    const probOrder = ['预测概率高', '预测概率中高', '预测概率中', '预测概率中低', '预测概率低']
    const predictionTypeLabels = { income: '收入预测', car: '有车预测', house: '有房预测' }
    const hasP1toP5 = ['p1', 'p2', 'p3', 'p4', 'p5'].every(k => firstItem[k] !== undefined)
    const hasPopuType = firstItem.popu_type !== undefined
    if (hasP1toP5 && hasPopuType) {
      const hasFname = firstItem.fname !== undefined
      let predictionGroups = {}
      if (hasFname) {
        for (const item of data) {
          const fname = item.fname
          if (!predictionGroups[fname]) predictionGroups[fname] = []
          predictionGroups[fname].push(item)
        }
      } else if (data.length >= 3) {
        predictionGroups = { income: [data[0]], car: [data[1]], house: [data[2]] }
      } else {
        predictionGroups = { default: data }
      }
      const displayOrder = hasFname ? Object.keys(predictionGroups).sort() : ['income', 'car', 'house']
      for (const groupKey of displayOrder) {
        const groupItems = predictionGroups[groupKey] || []
        if (groupItems.length === 0) continue
        const predictionName = predictionTypeLabels[groupKey] || groupKey
        const probMap = {}
        for (const name of probOrder) probMap[name] = { '到访': 0, '居住': 0, '工作': 0 }
        for (const item of groupItems) {
          const popuTypeLabel = typeLabel(item.popu_type)
          for (const [pKey, name] of Object.entries(probabilityLabels)) probMap[name][popuTypeLabel] = num(item[pKey])
        }
        const rows = probOrder.map(prob => {
          const d = probMap[prob] || { '到访': 0, '居住': 0, '工作': 0 }
          return [prob, d['到访'], d['居住'], d['工作']]
        })
        out.push({ t: 'table', title: predictionName, headers: ['概率等级', '到访', '居住', '工作'], rows })
      }
      return
    }
  }

  // 默认：直接显示表格（限制前 20 行）
  const headers = Object.keys(firstItem || {})
  if (!headers.length) return
  const rows = data.slice(0, 20).map(item => headers.map(h => {
    const val = item[h]
    return typeof val === 'number' ? val : (val ?? '-')
  }))
  out.push({ t: 'table', title: getServiceName(serviceCode), headers, rows })
}

/* ================= 其它 dict 服务（formatOtherData 镜像，L1711-1744） ================= */
const fieldBaseLabels = {
  s0: '未知年龄', s1: '儿童/青少年', s2: '青年', s3: '中年', s4: '老年', s5: '学生', s6: '家庭', s7: '商务',
  m0: '未知性别', m1: '男性', m2: '女性',
  pop_dwell: '居住人口', pop_work: '工作人口', visit_count: '到访人次'
}
const fieldServiceLabels = {
  '1007': { p1: '低消费', p2: '中低消费', p3: '中消费', p4: '中高消费', p5: '高消费' },
  '1009': { p1: '消费力指数1（最低）', p2: '消费力指数2', p3: '消费力指数3', p4: '消费力指数4', p5: '消费力指数5', p6: '消费力指数6', p7: '消费力指数7', p8: '消费力指数8（最高）' },
  '1011': { p1: '未婚', p2: '已婚' },
  '1012': { p1: '已婚已育', p2: '已婚未育', p3: '未婚未育' },
  '1013': { p1: '消费水平高', p2: '消费水平中', p3: '消费水平低' },
  '1014': { p1: '网购能力高', p2: '网购能力中高', p3: '网购能力中', p4: '网购能力中低', p5: '网购能力低' },
  '1015': { p1: '预测概率高', p2: '预测概率中高', p3: '预测概率中', p4: '预测概率中低', p5: '预测概率低' },
  '1022': { p1: '低档', p2: '中低档', p3: '中档', p4: '中高档', p5: '高档' },
  '1023': { p1: '无车', p2: '有车' }
}
function getFieldLabel(serviceCode, key) {
  if (fieldBaseLabels[key]) return fieldBaseLabels[key]
  const labels = fieldServiceLabels[serviceCode]
  if (labels && labels[key]) return labels[key]
  return key
}
function getPopTypeLabel(key) {
  const map = { '0': '到访', '1': '居住', '2': '工作' }
  return map[String(key).slice(-1)]
}
function renderOtherDict(data, serviceCode, out) {
  const groups = { '到访': {}, '居住': {}, '工作': {}, '其他': {} }
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'number') continue
    const type = getPopTypeLabel(key)
    if (type && groups[type]) groups[type][key] = val
    else groups['其他'][key] = val
  }
  for (const [type, items] of Object.entries(groups)) {
    const entries = Object.entries(items)
    if (entries.length === 0) continue
    const total = entries.reduce((a, [, v]) => a + v, 0)
    const sorted = entries.sort((a, b) => a[0].localeCompare(b[0]))
    const rows = sorted.map(([key, val]) => [getFieldLabel(serviceCode, key), val])
    out.push({ t: 'table', title: `${type}人口（合计 ${total.toLocaleString()}）`, headers: ['指标名称', '数值'], rows })
  }
}

/**
 * 主入口：把一条购买记录 result_data 渲染成详情页等价 blocks
 * @param {string|object} resultData purchases.result_data
 * @returns {Array<{t:'sec'|'kv'|'table', ...}>}
 */
export function renderPurchaseBlocks(resultData) {
  const data = unwrapResult(resultData)
  const out = []
  if (!data || typeof data !== 'object') return out
  if (data.error) return [{ t: 'sec', s: `❌ ${data.error}` }]

  for (const [key, value] of Object.entries(data)) {
    if (key === 'error') continue
    if (excludeServices.includes(key)) continue
    const serviceName = getServiceName(key)

    // 1001 dict → 多表
    if (key === '1001' && typeof value === 'object' && !Array.isArray(value)) {
      out.push({ t: 'sec', s: `${serviceName}（${key}）` })
      render1001(value, out)
      continue
    }
    // 1006 dict（day_avg_visit/stay_* 单对象形态）
    if (key === '1006' && typeof value === 'object' && !Array.isArray(value)) {
      const labelMap = {
        day_avg_visit: '日均到访人次', day_avg_total: '日均全量人次',
        stay_30: '停留<30分钟', stay_60: '停留30-60分钟', stay_120: '停留1-2小时',
        stay_240: '停留2-4小时', stay_480: '停留4-8小时'
      }
      const rows = Object.entries(value).map(([k, v]) => [labelMap[k] || k, num(v)])
      out.push({ t: 'sec', s: `${serviceName}（${key}）` })
      out.push({ t: 'table', title: serviceName, headers: ['指标', '数值'], rows })
      continue
    }
    // array
    if (Array.isArray(value)) {
      out.push({ t: 'sec', s: `${serviceName}（${key}）` })
      renderArray(value, key, out)
      continue
    }
    // dict / number
    if (typeof value === 'object') {
      out.push({ t: 'sec', s: `${serviceName}（${key}）` })
      renderOtherDict(value, key, out)
    } else if (typeof value === 'number') {
      out.push({ t: 'kv', label: serviceName, value })
    }
  }
  return out
}
