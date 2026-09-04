/**
 * unicomSummaryValues.js — 联通购买履历 result_data → 按「成品服务码」分区的精确取值引擎
 *
 * 背景（v1.13.97）：
 * - 批量购买合并导出宽表的 343 列定义见 unicomSummaryCols.js（report_Unicom.xlsx「商圈数据」行固化，
 *   行 = {c: 请求编码归属, f: 字段名, m: 字段含义}）。
 * - 取值镜像 backend/export_excel.py 的商圈数据填充语义，但修正其历史 BUG：
 *   export_excel.py 用全局 field_map（键=字段名小写）导致 1009/1010/1011/1012/1013 五服务区
 *   的同名桶键 pop{群}_p{档} 互相覆盖（后遍历的 1013 覆盖前面所有区，四区数值错误）。
 *   本引擎按「成品服务码」分区返回 byCode[code][fieldLower] = value，模板行按 (code, field) 精确取值。
 *
 * 真实 API 结构要点：
 * - 1001 = 小写 dict（键即字段名小写）
 * - 1005/1006/1007/1009/1010~1013 = 数组；1015 数组元素带 fname 区分 收入预测/有车预测/有房预测
 * - 1009 元素键为 spendpower('1'..'8') + spendpower_value（非 p{n}）
 * - 1007 元素无 popu_type、直接含 reach1~5（export_excel.py 的 popu_type==0 判断漏配 → 已去）
 * - income/car/house 三主题打包在 code=1015 → 分别挂成品区 1014/1015/1016（与模板行 code 对齐）
 */
export function buildSummaryValues(resultDataJson) {
  let api = resultDataJson
  if (typeof resultDataJson === 'string') {
    try { api = JSON.parse(resultDataJson) } catch { api = {} }
  }
  api = api || {}
  const src = (api.apiResult && typeof api.apiResult === 'object') ? api.apiResult : api
  const out = {}
  const seg = (code) => (out[code] = out[code] || {})
  const num = (v) => (typeof v === 'number' ? v : (v === null || v === undefined || v === '' ? null : Number(v)))

  // 1001 人口汇总对象 dict
  if (src['1001'] && typeof src['1001'] === 'object' && !Array.isArray(src['1001'])) {
    const m = seg('1001')
    for (const [k, v] of Object.entries(src['1001'])) {
      const n = num(v)
      if (n !== null) m[k.toLowerCase()] = n
    }
  }

  // 1002 上网标签分布（真实返回多无此 code → 该区留空，与成品单店报表一致）
  if (Array.isArray(src['1002'])) {
    const tagNames = ['网上购物', '时政要闻', '商务办公', '金融理财', '手机游戏', '旅游出行', '外卖送餐', '餐饮美食', '求职招聘']
    const m = seg('1002')
    for (const it of src['1002']) {
      const name = String(it.tag_name || '')
      const pop = it.popu_type ?? 0
      const val = num(it.tag_value)
      if (val === null) continue
      const ei = tagNames.indexOf(name)
      if (ei >= 0) { m[`webtag${pop}_${ei + 1}`] = val; continue }
      for (let i = 0; i < tagNames.length; i++) {
        const key = `webtag${pop}_${i + 1}`
        if ((tagNames[i].includes(name) || name.includes(tagNames[i])) && m[key] === undefined) {
          m[key] = val
          break
        }
      }
    }
  }

  // 1005 每小时段人口流量（hour{day_type}_{hour_period}_{visit|all}）
  if (Array.isArray(src['1005'])) {
    const m = seg('1005')
    for (const it of src['1005']) {
      const dt = it.day_type ?? 0
      const hp = it.hour_period
      if (hp === null || hp === undefined) continue
      const vv = num(it.hour_visit)
      const aa = num(it.hour_all)
      if (vv !== null) m[`hour${dt}_${hp}_visit`] = vv
      if (aa !== null) m[`hour${dt}_${hp}_all`] = aa
    }
  }

  // 1006 每日人流量及停留时长 → 7 个日均键
  if (Array.isArray(src['1006']) && src['1006'].length) {
    const days = src['1006']
    const n = days.length
    const keys = ['day_visit', 'day_all', 'stay1', 'stay2', 'stay3', 'stay4', 'stay5']
    const tot = { day_visit: 0, day_all: 0, stay1: 0, stay2: 0, stay3: 0, stay4: 0, stay5: 0 }
    for (const dd of days) for (const k of keys) tot[k] += Number(dd[k]) || 0
    const m = seg('1006')
    m.day_avg_visit = Math.round(tot.day_visit / n)
    m.day_avg_total = Math.round(tot.day_all / n)
    m.stay_30 = Math.round(tot.stay1 / n)
    m.stay_60 = Math.round(tot.stay2 / n)
    m.stay_120 = Math.round(tot.stay3 / n)
    m.stay_240 = Math.round(tot.stay4 / n)
    m.stay_480 = Math.round(tot.stay5 / n)
  }

  // 1007 每月到达次数分布：找含 reach 键的元素（真实数据元素无 popu_type）
  if (Array.isArray(src['1007'])) {
    const m = seg('1007')
    const item = src['1007'].find((e) => e && Object.keys(e).some((k) => String(k).includes('reach')))
    if (item) {
      for (let i = 1; i <= 5; i++) {
        const v = num(item[`reach${i}`])
        if (v !== null) m[`reach${i}`] = v
      }
    }
  }

  // 1009 消费水平（富裕指数）：元素 spendpower='1'..'8' + spendpower_value（模板 pop{群}_p{档}）
  if (Array.isArray(src['1009'])) {
    const m = seg('1009')
    for (const it of src['1009']) {
      const pt = it.popu_type ?? 0
      const sp = it.spendpower
      if (sp === null || sp === undefined) continue
      const v = num(it.spendpower_value)
      if (v !== null) m[`pop${pt}_p${sp}`] = v
    }
  }

  // 1010 教育 / 1011 行业 / 1012 人生阶段 / 1013 综合消费能力：pop{群}_p{档}（元素 p0/p1.. 键）
  for (const svc of ['1010', '1011', '1012', '1013']) {
    if (!Array.isArray(src[svc])) continue
    const m = seg(svc)
    for (const it of src[svc]) {
      const pt = it.popu_type ?? 0
      for (const [k, v] of Object.entries(it)) {
        if (k === 'popu_type' || !/^p\d+$/.test(k)) continue
        const n = num(v)
        if (n !== null) m[`pop${pt}_${k}`] = n
      }
    }
  }

  // 1015 资产预测数组：fname 分流 → 收入预测挂成品区 1014(income_) / 有车预测 1015(car_) / 有房预测 1016(house_)
  if (Array.isArray(src['1015'])) {
    const fnameMap = { '收入预测': ['1014', 'income'], '有车预测': ['1015', 'car'], '有房预测': ['1016', 'house'] }
    for (const it of src['1015']) {
      const fnKey = fnameMap[String(it.fname || '')]
      if (!fnKey) continue
      const [dstCode, prefix] = fnKey
      const m = seg(dstCode)
      const pt = it.popu_type ?? 0
      for (const [k, v] of Object.entries(it)) {
        if (k === 'popu_type' || !/^p\d+$/.test(k)) continue
        const n = num(v)
        if (n !== null) m[`${prefix}_pop${pt}_${k}`] = n
      }
    }
  }

  return out
}

/**
 * 按模板行 (code, field) 取精确值（字段名大小写不敏感）。无数据返回 null（导出时留空格）
 */
export function summaryValue(byCode, code, field) {
  const m = byCode[code]
  if (!m) return null
  const v = m[String(field).toLowerCase()]
  return v === undefined ? null : v
}
