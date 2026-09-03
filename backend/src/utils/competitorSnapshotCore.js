/**
 * 竞品期次快照 · 纯函数核心（无 DB / 无 HTTP，可单测）
 * P0-1(上传解析/识别/收编) + P0-2(diff) 的算法层，路由文件只做编排。
 * 设计依据：竞品季度开关店监测-实施计划 v2.2
 */
import crypto from 'crypto'

/* ================= status 文本 ⇄ 枚举（§4） ================= */
export const STATUS_TEXT = {
  open: '正常',
  paused: '暂停营业',
  closed: '已闭店',
  pending: '未开业',
  unknown: ''
}
const STATUS_EXACT = [
  { enum: 'open', texts: ['营业中', '营业', '正常', '在营', '开业', '正常营业', 'open', '营业状态正常'] },
  { enum: 'paused', texts: ['暂停营业', '休息', '装修', '暂停', '装修中', 'paused', '临时停业'] },
  { enum: 'closed', texts: ['已闭店', '闭店', '关店', '歇业', '关闭', '停止营业', '已关闭', '停业', 'closed'] },
  { enum: 'pending', texts: ['未开业', '筹备', '即将开业', 'pending'] }
]
// 包含匹配（按 优先级 从特异到泛化，避免 '暂停营业' 被 '营业'/'停业' 误伤）
const STATUS_CONTAINS = [
  { enum: 'paused', needles: ['暂停', '装修', '休息'] },
  { enum: 'pending', needles: ['筹备中', '新店筹备', '即将开业', '未开业'] },
  { enum: 'closed', needles: ['闭店', '关店', '歇业', '停业'] },
  { enum: 'open', needles: ['在营', '正常营业', '营业中'] }
]
/** 上传文本 → 枚举；不认识/空 → unknown（精确优先，再按特征包含，杜绝子串串组） */
export function textToStatus(text) {
  const t = String(text || '').trim().toLowerCase()
  if (!t) return 'unknown'
  for (const group of STATUS_EXACT) {
    if (group.texts.map(x => x.toLowerCase()).includes(t)) return group.enum
  }
  for (const group of STATUS_CONTAINS) {
    if (group.needles.some(n => t.includes(n.toLowerCase()))) return group.enum
  }
  return 'unknown'
}
/** 枚举 → competitors 展示文本 */
export function enumToDisplayText(status) {
  return STATUS_TEXT[status] ?? ''
}

/* ================= 期次解析（§5：月/季双粒度） ================= */
/** '2026Q3' | '2026-09' | '2026-9' → {valid, seq(YYYYMM 代表月), label, year, month} */
export function parsePeriod(period) {
  const p = String(period || '').trim()
  let m = p.match(/^(\d{4})[Qq]([1-4])$/)
  if (m) {
    const year = +m[1]; const q = +m[2]
    return { valid: true, year, month: q * 3, seq: year * 100 + q * 3, label: `${year}Q${q}`, kind: 'quarter' }
  }
  m = p.match(/^(\d{4})-(\d{1,2})$/)
  if (m) {
    const year = +m[1]; const month = +m[2]
    if (month >= 1 && month <= 12) return { valid: true, year, month, seq: year * 100 + month, label: `${year}-${String(month).padStart(2, '0')}`, kind: 'month' }
  }
  return { valid: false, seq: 0, label: p || '', kind: 'unknown' }
}
/** 年月 → 默认月度期次 '2026-09' */
export function toMonthPeriod(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}
/** 校验某月是否可用季度写法（3/6/9/12），返回季度标签；不可则返回 null */
export function monthToQuarterIfEdge(year, month) {
  if ([3, 6, 9, 12].includes(month)) return `${year}Q${month / 3}`
  return null
}

/* ================= 文本归一化 / 相似度（名址对齐用） ================= */
/** 门店名归一化：小写、全半角、去标点、去括号字符(保留内容——分店名常含括号)、去尾部店缀词 */
export function normalizeStoreName(name) {
  let s = String(name || '').trim()
  s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) // 全角→半角
  s = s.toLowerCase()
  s = s.replace(/[()（）【】\[\]{}<>「」『』]/g, '') // 只删括号符，保留括号内分店名
  s = s.replace(/[\s\-—_·,，。.．:：/\\|"'`~！@#$%^&*+=<>?]/g, '')
  s = s.replace(/(店|分店|直营店|加盟店|旗舰店|体验店|门店)$/g, '')
  return s
}
/** 编辑距离（Levenshtein），小字符串够用 */
export function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (!m) return n; if (!n) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[m][n]
}
/** 归一化名相似度 0..1：相等=1；包含=短名/长名；否则 1 - lev/max */
export function nameSimilarity(a, b) {
  const na = normalizeStoreName(a), nb = normalizeStoreName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb)) return nb.length / na.length
  if (nb.includes(na)) return na.length / nb.length
  const max = Math.max(na.length, nb.length)
  return max > 0 ? 1 - levenshtein(na, nb) / max : 0
}

/* ================= 坐标距离（Haversine，米） ================= */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === null || v === undefined || isNaN(v))) return Infinity
  const R = 6371000
  const rad = d => d * Math.PI / 180
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/* ================= 表头宽松匹配 ================= */
const COLUMN_ALIASES = {
  store_key: ['store_id', 'storeid', 'shopid', 'shop_id', 'id', 'code', '门店id', '门店编号', '编号', '门店ID', '门店id'],
  name: ['name', '门店名称', '店名', '名称', 'store_name', 'title'],
  brand: ['brand', '品牌', '品牌名', 'chain_name'],
  city: ['city', '城市', '市', '所在城市'],
  district: ['district', '区县', '行政区', '区', '县'],
  address: ['address', '地址', '详细地址', '门店地址'],
  lat: ['latitude', 'lat', '纬度', 'y', 'wgs84_lat', 'gcj02_lat'],
  lng: ['longitude', 'lng', 'lon', '经度', 'x', 'wgs84_lng', 'gcj02_lng'],
  status: ['status', '营业状态', '经营状态', '门店状态', '状态'],
  category: ['store_category', 'category', '门店分类', '分类', '业态'],
  store_type: ['store_type', 'type', '门店类型', '类型'],
  industry: ['industry', '行业', '行业分类', '品类'],
  trading_area: ['trading_area', 'trade_area', '商圈', '商圈名', '所属商圈'],
  price: ['price', '价格', '人均', '客单价'],
  rating: ['rating', '星级', '评分', 'score'],
  reviews: ['reviews', '评论数', '评论', '点评数'],
  description: ['description', '备注', 'desc', 'note'],
  data_version: ['data_version', 'dataversion', 'year_month', 'source_date', '数据年月', '数据版本', '版本', 'source_month', 'month']
}
const HEADER_NORM_CACHE = new Map()
function normalizeHeader(h) {
  if (HEADER_NORM_CACHE.has(h)) return HEADER_NORM_CACHE.get(h)
  let s = String(h || '').trim().toLowerCase()
  s = s.replace(/[\s\-_·]+/g, '').replace(/[()（）[\]]/g, '')
  if (HEADER_NORM_CACHE.size > 500) HEADER_NORM_CACHE.clear() // 防止不同表头长期驻留
  HEADER_NORM_CACHE.set(h, s)
  return s
}
/** 在 CSV row 的 header→value 对象上按别名取第一个存在的值；返回 {value, header} */
export function pickCsvField(row, field) {
  const headers = Object.keys(row)
  if (!headers.length) return { value: undefined, header: null }
  const aliases = COLUMN_ALIASES[field] || []
  // 先精确/归一化匹配别名
  for (const alias of aliases) {
    const an = normalizeHeader(alias)
    for (const h of headers) {
      if (normalizeHeader(h) === an) return { value: row[h], header: h }
    }
  }
  return { value: undefined, header: null }
}

/* ================= 数据版本识别（§5：字段→文件名→默认） ================= */
/**
 * @param rows PapaParse 原始行数组
 * @param fileName 原文件名
 * @returns {dataVersion, versionSource:'column'|'filename'|'', versionInconsistent, suggestedPeriod(YYYY-MM|'')}
 */
export function detectDataVersion(rows, fileName) {
  if (!rows || !rows.length) return { dataVersion: '', versionSource: '', versionInconsistent: false, suggestedPeriod: '' }
  // ① CSV 列（宽松匹配）—— 取首行非空并校验全列一致
  const headers = Object.keys(rows[0])
  let versionColHeader = null
  const aliasKeys = COLUMN_ALIASES.data_version.map(normalizeHeader)
  for (const h of headers) {
    if (aliasKeys.includes(normalizeHeader(h))) { versionColHeader = h; break }
  }
  if (versionColHeader) {
    const nonEmpty = []
    for (const r of rows) {
      const v = String(r[versionColHeader] ?? '').trim()
      if (v) nonEmpty.push(v)
    }
    if (nonEmpty.length) {
      const distinct = [...new Set(nonEmpty)]
      const val = distinct[0]
      const ym = parseYearMonthLabel(val)
      return {
        dataVersion: val,
        versionSource: 'column',
        versionInconsistent: distinct.length > 1,
        versionColumn: versionColHeader,
        suggestedPeriod: ym ? toMonthPeriod(ym.year, ym.month) : ''
      }
    }
  }
  // ② 文件名模式：2026年9月 / 2026-09 / 202609 / 2026Q3
  const ym = parseYearMonthLabel(fileName || '')
  if (ym) {
    const quarter = monthToQuarterIfEdge(ym.year, ym.month)
    const label = quarter ? `${ym.year}年${ym.month}月版` : `${ym.year}年${ym.month}月版`
    return {
      dataVersion: label,
      versionSource: 'filename',
      versionInconsistent: false,
      suggestedPeriod: toMonthPeriod(ym.year, ym.month)
    }
  }
  return { dataVersion: '', versionSource: '', versionInconsistent: false, suggestedPeriod: '' }
}
/** 从任意文本提取年月 → {year, month} | null */
export function parseYearMonthLabel(text) {
  const t = String(text || '')
  let m = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/)
  if (m) return { year: +m[1], month: +m[2] }
  m = t.match(/(\d{4})[-\/](\d{1,2})/)
  if (m) return { year: +m[1], month: +m[2] }
  m = t.match(/^(\d{4})Q([1-4])$/i)
  if (m) return { year: +m[1], month: +m[2] * 3 }
  return null
}

/* ================= 文件行归一化（核心校验） ================= */
/**
 * 把 PapaParse 原始行数组 → 归一化行
 * 校验策略（§5/§10-6）：缺 store_key → 拒绝整批（防 diff 误判 closed）；同文件重复 key → 保留首行并告警计数
 * @returns {{rows: [], noKeyCount, dupKeyCount, missingCoordCount, missingNameCount}}
 *   row: {store_key,name,brand,city,district,address,latitude,longitude,status,store_type,category,industry,trading_area,price,rating,reviews,description,extra}
 */
export function normalizeRows(parsedRows) {
  const out = []
  const seenKeys = new Set()
  let noKeyCount = 0, dupKeyCount = 0, missingCoordCount = 0, missingNameCount = 0
  for (const raw of parsedRows) {
    if (!raw || typeof raw !== 'object') continue
    const { value: sk } = pickCsvField(raw, 'store_key')
    const { value: nm } = pickCsvField(raw, 'name')
    if (!nm) { missingNameCount++; continue }
    const key = String(sk ?? '').trim()
    if (!key) { noKeyCount++; continue } // 由调用方决定整批拒绝 or 跳过
    if (seenKeys.has(key)) { dupKeyCount++; continue }
    seenKeys.add(key)
    const { value: latV } = pickCsvField(raw, 'lat')
    const { value: lngV } = pickCsvField(raw, 'lng')
    const lat = latV === undefined || latV === '' ? null : parseFloat(latV)
    const lng = lngV === undefined || lngV === '' ? null : parseFloat(lngV)
    if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) missingCoordCount++
    const { value: statusV } = pickCsvField(raw, 'status')
    const { value: brandV } = pickCsvField(raw, 'brand')
    const { value: cityV } = pickCsvField(raw, 'city')
    const { value: districtV } = pickCsvField(raw, 'district')
    const { value: addrV } = pickCsvField(raw, 'address')
    const { value: catV } = pickCsvField(raw, 'category')
    const { value: typeV } = pickCsvField(raw, 'store_type')
    const { value: indV } = pickCsvField(raw, 'industry')
    const { value: taV } = pickCsvField(raw, 'trading_area')
    const { value: priceV } = pickCsvField(raw, 'price')
    const { value: ratingV } = pickCsvField(raw, 'rating')
    const { value: reviewsV } = pickCsvField(raw, 'reviews')
    const { value: descV } = pickCsvField(raw, 'description')
    const display = enumToDisplayText(textToStatus(statusV))
    out.push({
      store_key: key,
      name: String(nm).trim(),
      brand: String(brandV ?? '').trim(),
      city: String(cityV ?? '').trim(),
      district: String(districtV ?? '').trim(),
      address: String(addrV ?? '').trim(),
      latitude: lat, longitude: lng,
      status: textToStatus(statusV),
      status_display: display || '',
      status_raw: statusV !== undefined ? String(statusV).trim() : '',
      store_type: String(typeV ?? '').trim(),
      category: String(catV ?? '').trim(),
      industry: String(indV ?? '').trim(),
      trading_area: String(taV ?? '').trim(),
      price: priceV === undefined || priceV === '' ? 0 : parseFloat(priceV) || 0,
      rating: ratingV === undefined || ratingV === '' ? 0 : parseFloat(ratingV) || 0,
      reviews: reviewsV === undefined || reviewsV === '' ? 0 : parseInt(reviewsV) || 0,
      description: String(descV ?? '').trim(),
      extra: JSON.stringify({ category: String(catV ?? '').trim(), store_type: String(typeV ?? '').trim(), industry: String(indV ?? '').trim(), trading_area: String(taV ?? '').trim(), status_raw: String(statusV ?? '').trim() })
    })
  }
  return { rows: out, noKeyCount, dupKeyCount, missingCoordCount, missingNameCount }
}

/* ================= B+ 实体收编预判（§6：手工店 vs 新 CSV） ================= */
/**
 * @param manualRows competitors 手工行 [{id,name,city,district,latitude,longitude,description}]
 * @param csvRows 归一化后 CSV 行
 * @returns {summary:{total,autoCount,maybeCount,keepCount}, items:[{manualId, manualName, level:'auto'|'maybe'|'keep', csvMatch:{...}|null, dist, nameSim, csvCandidateCount}]}
 * auto：同城(或城空) 且 dist≤200 且 名相似≥0.85
 * maybe：dist≤800 且 (dist>200 或 名相似<0.85)
 * keep：其余
 */
export function estimateManualAdoptions(manualRows, csvRows) {
  const items = []
  const cityOf = c => normalizeStoreName(c?.city || '')
  for (const mn of manualRows) {
    const mCity = cityOf(mn)
    let best = { level: 'keep', csvMatch: null, dist: Infinity, nameSim: 0, csvCandidateCount: 0 }
    // 候选域：同城优先；手工城空 → 全量坐标比
    for (const cr of csvRows) {
      const cCity = cityOf(cr)
      if (mCity && cCity && mCity !== cCity) continue
      const d = haversineMeters(mn.latitude, mn.longitude, cr.latitude, cr.longitude)
      if (d > 800) continue
      const sim = nameSimilarity(mn.name, cr.name)
      best.csvCandidateCount++
      let level
      if (d <= 200 && sim >= 0.85) level = 'auto'
      else if (d <= 800) level = 'maybe'
      else continue
      // 同距离取更优匹配（auto > maybe > keep；同级取距离更近）
      const rank = { keep: 0, maybe: 1, auto: 2 }[level]
      const curRank = { keep: 0, maybe: 1, auto: 2 }[best.level]
      if (rank > curRank || (rank === curRank && d < best.dist)) {
        best = { level, csvMatch: cr, dist: d, nameSim: sim, csvCandidateCount: best.csvCandidateCount }
      }
    }
    items.push({
      manualId: mn.id,
      manualName: mn.name,
      level: best.level,
      csvMatch: best.csvMatch ? {
        store_key: best.csvMatch.store_key, name: best.csvMatch.name,
        city: best.csvMatch.city, district: best.csvMatch.district, address: best.csvMatch.address
      } : null,
      dist: Math.round(best.dist),
      nameSim: Math.round(best.nameSim * 100) / 100,
      candidateCount: best.csvCandidateCount
    })
  }
  const autoCount = items.filter(i => i.level === 'auto').length
  const maybeCount = items.filter(i => i.level === 'maybe').length
  return { summary: { total: manualRows.length, autoCount, maybeCount, keepCount: manualRows.length - autoCount - maybeCount }, items }
}

/* ================= P0-2 diff（快照在营子集按 store_key 对齐） ================= */
/**
 * @param baseRows [{store_key,name,city,status,...}]（旧期，全量行含 closed）
 * @param targetRows 新期全量行
 * @returns {opened:[], closed:[], keptCount, openedCount, closedCount, netChange, statusChanged:[], baseOpenCount, targetOpenCount, selfCheck:{pass, msg}}
 */
export function diffSnapshots(baseRows, targetRows) {
  const baseOpen = new Map(baseRows.filter(r => r.status === 'open').map(r => [r.store_key, r]))
  const targetOpen = new Map(targetRows.filter(r => r.status === 'open').map(r => [r.store_key, r]))
  const targetAll = new Map(targetRows.map(r => [r.store_key, r]))
  const opened = [], closed = [], statusChanged = []
  for (const [key, tr] of targetOpen) {
    const br = baseOpen.get(key)
    if (!br) opened.push(tr)
  }
  for (const [key, br] of baseOpen) {
    const tr = targetAll.get(key)
    if (!tr || tr.status !== 'open') {
      closed.push({ ...(tr || br), _baseName: br.name, _baseStatus: br.status, _closed: !tr })
    }
    if (tr && tr.status !== br.status) {
      statusChanged.push({ store_key: key, name: tr.name, city: tr.city, from: br.status, to: tr.status, _displayFrom: enumToDisplayText(br.status), _displayTo: enumToDisplayText(tr.status) })
    }
  }
  const openedCount = opened.length, closedCount = closed.length
  const keptCount = targetOpen.size - openedCount
  const baseOpenCount = baseOpen.size, targetOpenCount = targetOpen.size
  // 自洽校验
  const selfMsg1 = `opened−closed(${openedCount}−${closedCount}=${openedCount - closedCount}) == targetOpen−baseOpen(${targetOpenCount}−${baseOpenCount}=${targetOpenCount - baseOpenCount})`
  const pass1 = openedCount - closedCount === targetOpenCount - baseOpenCount
  const selfMsg2 = `kept+opened(${keptCount}+${openedCount}=${keptCount + openedCount}) == targetOpen(${targetOpenCount})`
  const pass2 = keptCount + openedCount === targetOpenCount
  return {
    opened, closed, keptCount, openedCount, closedCount,
    netChange: openedCount - closedCount,
    statusChanged, baseOpenCount, targetOpenCount,
    selfCheck: { pass: pass1 && pass2, msg: `${selfMsg1} | ${selfMsg2}` }
  }
}
/** 合理性体检：整城抓取缺失警告（某城 closed≈上期 open 且本期该城 open=0） */
export function cityMissingCheck(baseRows, targetRows) {
  const cityOpen = rows => {
    const m = new Map()
    for (const r of rows) if (r.status === 'open' && r.city) m.set(r.city, (m.get(r.city) || 0) + 1)
    return m
  }
  const b = cityOpen(baseRows), t = cityOpen(targetRows)
  const warns = []
  for (const [city, n] of b) {
    const tn = t.get(city) || 0
    if (tn === 0 && n >= 3) warns.push({ city, baseOpen: n, targetOpen: tn, reason: '上期在营>=3 家且本期为 0，疑似整城抓取缺失而非集体闭店' })
  }
  return warns
}

/** 文件内容 MD5（同 brand+period 重传识别用） */
export function md5OfBuffer(buf) {
  return crypto.createHash('md5').update(buf).digest('hex')
}
