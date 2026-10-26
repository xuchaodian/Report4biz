import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { execFile } from 'child_process'
import zlib from 'zlib'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import * as turf from '@turf/turf'
import iconv from 'iconv-lite'
import { IN_BUSINESS_SQL, IN_BUSINESS_PARAMS } from '../utils/storeStatus.js'
// ⚠️ 本文件**不再使用 writeGeoText**：上传改由 Python 流式直写 + adoptGeoFile 转正
//    （见 upload 路由与 geoStore::adoptGeoFile 的注释）。writeGeoText 仍供其他模块使用。
import {
  removeGeoFile, getGeoObject, attachGeo,
  adoptGeoFile, geoDir
} from '../models/geoStore.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 数值解析（v1.13.238）
 * ⛔ 不要写成 `parseFloat(x) || dflt` —— 那会把**合法的 0** 吞成默认值。
 *    业主报障：「我的门店数 = 0」被当成 1，结果全是"恰好含 1 家门店"的网格。
 * ✅ 只有真正取不到数字（null/undefined/''/非数字）时才回落默认值。
 */
function numOr(raw, dflt) {
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : dflt
}

const router = express.Router()

// 生成 shapefile 可见性 SQL 片段及参数。
// 语义：管理员(role='admin')可见全部；普通用户可见「本人上传」+「管理员共享」的文件。
// 返回 { clause, params }，clause 可直接拼进 WHERE。
function visibilityClause(user, alias) {
  const p = alias ? alias + '.' : ''
  if (user.role === 'admin') {
    return { clause: '1=1', params: [] }
  }
  return {
    clause: `(${p}user_id = ? OR ${p}user_id IN (SELECT id FROM users WHERE role = 'admin'))`,
    params: [user.id]
  }
}

// ⚠️ v1.13.143：geojson 已外置到文件（见 models/geoStore.js）。
// 本文件的 SQL 一律**不再 SELECT geojson**（它是空串占位），改为用
// attachGeo() / attachGeoAll() 从文件回填，或用 getGeoObject() 取解析对象。
// 原先这里的 shapefileCache / CACHE_TTL_MS 已删除 —— 缓存统一由 geoStore 管理，
// 避免两份缓存各自 1 分钟 / 1 小时 TTL 造成「同一个文件两份 V8 对象」的内存浪费。

// 配置上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/shapefiles')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB 限制
})

// 允许的 shapefile 类别。
// ⛔ 刻意做成白名单而非「任意字符串」：category 决定这份数据会被哪些消费点读到
//    （例如 calculate-potential 只查 category='population'，districts/sales-forecast 只查 'other'），
//    写错一个值就可能让几十万网格混进逐要素求交的计算里，或让新数据被旧逻辑误命中。
// · population     —— 1km 网格人口（七普系，WGS84→GCJ-02）
// · other          —— 城市商圈面（高德坐标，跳过转换）
// · population_hd  —— 高精度人口 250m 网格（v1.13.194 新增；WGS84→GCJ-02）
const ALLOWED_CATEGORIES = new Set(['population', 'other', 'population_hd'])

// 🔴🔴 v1.13.227：`calculate-population` 的**内存 + 并发护栏**（改本路由前必读）
// 背景：「高精度人口」（category='population_hd'，250m 网格）实测单文件 **95MB / 107,960 要素 / 35 字段**，
//   而 geoStore 对 >4MB 不做对象缓存、>64MB 不做文本缓存 ⇒ **每次请求都要重新 JSON.parse 整个文件**。
//   本地实测该文件：JSON.parse 增量 rss ≈ **372MB**（3.6×）、heap ≈ 345MB，parse 本身仅 1.3s。
//   生产机 available 仅 ~518MB（常驻 webgis-backend 已占 ~422MB，used 681MB）
//   ⇒ 单次串行后总占用 ≈ 1053MB（< 1608MB 上限，可行）；
//     但**两个并发请求就会到 ~1425MB ⇒ OOM，而 OOM 波及的是整个后端、所有用户**。
// ⇒ 因此本路由强制三点（详见路由内的护栏①②③）：
//   ① hd 类数据**必须传 shapefileId**（单文件），⛔ 不允许走「全 category 兜底」；
//   ② **同一文件同时只允许 1 个计算在飞**（这是硬要求，不是优化项）；
//   ③ 解析前 RSS 自检，超阈值直接拒绝 —— 宁可返回错误，也不触发 OOM。
const POP_CALC_RSS_LIMIT_MB = 1000      // 解析前 RSS 上限：留 ~600MB 给单次解析峰值
const popCalcInFlight = new Set()        // key: 'id:<shapefileId>' | 'cat:<category>'

// 上传并解析 Shapefile (ZIP格式，仅管理员可上传)
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    // 检查是否为管理员
    if (req.user.role !== 'admin') {
      // 清理已上传的文件
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path)
      }
      return res.status(403).json({ message: '仅管理员可以上传统计数据' })
    }
    if (!req.file) {
      return res.status(400).json({ message: '请上传文件' })
    }

    const filePath = req.file.path
    // 处理文件名编码问题
    let originalName = req.file.originalname

    // 自动检测并修复文件名乱码
    // 策略：尝试多种编码修复方案，选用包含中文的结果
    function hasChinese(s) { return /[\u4e00-\u9fa5]/.test(s) }

    // 场景1：UTF-8 字节被当作 Latin-1 读取（常见 macOS 上传）
    // 特征：字符串中 Latin-1 补充字符（U+0080-00FF）占比高
    const latin1Ratio = [...originalName].filter(c => {
      const code = c.charCodeAt(0)
      return code >= 0x80 && code <= 0xFF
    }).length / originalName.length
    if (latin1Ratio > 0.3) {
      const fixed = Buffer.from(originalName, 'latin1').toString('utf8')
      if (hasChinese(fixed) || !hasChinese(originalName)) {
        originalName = fixed
      }
    }

    // 场景2：UTF-8 字节被 busboy 误当作 GBK 解码（常见中文 Windows Chrome）
    // 修复：将乱码字符串用 GBK 编码还原字节，再用 UTF-8 解码
    if (!hasChinese(originalName)) {
      try {
        const gbkBytes = iconv.encode(originalName, 'gbk')
        const utf8Name = gbkBytes.toString('utf8')
        if (hasChinese(utf8Name)) {
          originalName = utf8Name
        }
      } catch (e) { /* GBK 编码失败，保持原样 */ }
    }

    // 获取当前登录用户ID（来自JWT，安全）
    const userId = req.user.id

    // 获取类别参数（默认 population），放在前面供解析时使用
    const category = req.body.category || 'population'

    // 白名单校验必须在「调用解析脚本」之前：非法类别尽早拒绝，
    // 并顺手清掉 multer 刚落地的临时文件，避免 uploads 目录堆积孤儿 zip
    if (!ALLOWED_CATEGORIES.has(category)) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
      return res.status(400).json({ message: `不支持的类别: ${category}` })
    }

    // 调用 Python 脚本解析 shapefile (使用 execFile，避免 shell 命令注入)
    const pythonScript = path.join(__dirname, '../utils/shapefile_parser.py')

    // 🔴 v1.13.194：让 Python **直接把 geojson 流式写进文件**，stdout 只回元信息。
    // 原因（详见 utils/shapefile_parser.py 与 models/geoStore.js::adoptGeoFile 的头注释）：
    //   250m 网格单城产物 95MiB，若让它走 stdout，Node 侧必须 JSON.parse + JSON.stringify，
    //   实测进程峰值 RSS 1.13GiB，而本机总内存 1.6GB ⇒ 必然 OOM。
    // 临时文件必须落在 geoDir() 内（同一文件系统），否则 adoptGeoFile 的 rename 会抛 EXDEV。
    const tmpGeoPath = path.join(
      geoDir(), `.upload-${Date.now()}-${Math.round(Math.random() * 1e9)}.geojson.part`
    )

    // 使用 execFile 传参数数组（不经过 shell），杜绝命令注入
    // citynd 七普人口数据(WGS84)需转 GCJ-02；other 城市商圈数据已是高德坐标，跳过转换
    const args = [pythonScript, filePath, '--out', tmpGeoPath]
    if (category === 'other') args.push('--skip-convert')

    let pythonResult
    try {
      pythonResult = await new Promise((resolve, reject) => {
        execFile('python3', args, {
          encoding: 'utf-8',
          // 元信息只有几十字节；8MB 足够兜住异常时带 traceback 的 error 文本。
          // ⛔ 不要把「整份 geojson」放回 stdout —— 那正是本次改造要消除的 1.13GiB 峰值来源。
          maxBuffer: 8 * 1024 * 1024
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message))
          } else {
            resolve(stdout)
          }
        })
      })
    } catch (e) {
      // 解析进程本身失败：zip 与半成品 geojson 都要清掉
      try { fs.unlinkSync(filePath) } catch (e2) { /* 忽略 */ }
      try { fs.unlinkSync(tmpGeoPath) } catch (e2) { /* 忽略 */ }
      throw e
    }

    const meta = JSON.parse(pythonResult)

    // 删除临时上传文件
    fs.unlinkSync(filePath)

    if (!meta.success) {
      try { fs.unlinkSync(tmpGeoPath) } catch (e2) { /* 忽略 */ }
      return res.status(400).json({ message: meta.error || '解析失败' })
    }

    // 保存到数据库（v1.13.143：geojson 外置成文件，主库该列只留空串占位）
    const db = getDb()

    // 顺序很关键：先 INSERT 拿 id → 再把临时 geojson 转正 → 最后统一提交。
    // 任一步失败就回滚并删掉刚转正的文件，不会留下「有行无文件」的破窗。
    let insertId = null
    db.beginTx()
    try {
      const insertResult = db.prepare(
        `INSERT INTO shapefiles (name, geojson, field_names, feature_count, user_id, category, created_at)
         VALUES (?, '', ?, ?, ?, ?, datetime('now', 'localtime'))`
      ).run(originalName, JSON.stringify(meta.fields || []), meta.featureCount || 0, userId, category)

      insertId = insertResult.lastInsertRowid
      adoptGeoFile(insertId, tmpGeoPath)   // 一次 rename 转正，零解析零拷贝
      db.commitTx()   // 内含统一落盘（替代原先的 db.saveNow()，且写入合并为一次）
    } catch (e) {
      try { db.rollbackTx() } catch (e2) { /* 忽略 */ }
      try { if (insertId) removeGeoFile(insertId) } catch (e3) { /* 忽略 */ }
      try { fs.unlinkSync(tmpGeoPath) } catch (e3) { /* 忽略：adopt 未执行时文件还在 */ }
      throw e
    }

    res.json({
      success: true,
      message: '上传成功',
      data: {
        id: insertId,
        name: originalName,
        featureCount: meta.featureCount,
        fields: meta.fields,
        category
      }
    })

  } catch (error) {
    console.error('上传 Shapefile 失败:', error)
    res.status(500).json({ message: '服务器错误: ' + error.message })
  }
})

// 获取当前用户可见的 Shapefile（本人上传 + 管理员共享；管理员可看全部）
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const vis = visibilityClause(req.user)
    const category = req.query.category  // 可选：population / other

    let sql = `SELECT id, name, field_names, feature_count, created_at, user_id, category
               FROM shapefiles
               WHERE ${vis.clause}`
    const params = [...vis.params]

    if (category) {
      sql += ` AND category = ?`
      params.push(category)
    }

    sql += ` ORDER BY created_at DESC`

    const rows = db.prepare(sql).all(...params)

    // 解析 field_names
    const data = rows.map(obj => {
      if (obj.field_names) {
        try {
          obj.field_names = JSON.parse(obj.field_names)
        } catch (e) {}
      }
      return obj
    })

    res.json({ data })

  } catch (error) {
    console.error('获取 Shapefile 列表失败:', error)
    res.status(500).json({ message: '服务器错误' })
  }
})

// ============================================================================
// 整城 1km 网格分级渲染（v1.13.266）
// 「商圈工具 → 常住人口分布 → 选择城市」：选城市/区县/字段，把该范围的 1km 网格
// 按 6 档铺在地图上。与原有「地图选点」的区别：不设圆心半径，直接铺整个行政区。
//
// 🔴 五条约束（改动前必读）
//   ① 分级两口径：`equal`＝**等值均分**（区间等宽，默认，遵业主 spec）；
//      `quantile`＝**等量分档**（分位数，每档网格数相近）。
//      ⚠️ 实测上海 7417 网格：等值均分下 **92.2% 落在第 1 档**（p50=0、max=75574）
//      ⇒ 只做等值均分会让整城一片同色，故必须同时提供等量分档。
//   ② 等值均分**左闭右开**，最后一档闭合 ⇒ 每个网格只落一档（max 归第 6 档）。
//   ③ 分级范围＝**当前所选范围**（选了区县就按该区县 min/max）
//      ⇒ 不同区县颜色**不可横向比较**，前端图例必须写明这一点。
//   ④ 只返回**精简 GeoJSON**：geometry + `{v,b}`，坐标取 5 位小数（≈1m）。
//      原始属性全部丢弃 —— 最大城市 75,825 网格、原文件 30MB，全字段透传会撑到上百 MB。
//   ⑤ 解析对象**不自建缓存**（沿用 geoStore「大文件不缓存对象」策略，1.6GB 内存所限），
//      只缓存**精简后的结果**（字节预算 LRU）。
// ============================================================================
// 🔴 缓存的是**已经 gzip 过的 Buffer**，既不是对象也不是原文字符串。
//    实测（v1.13.266 重庆整城 75,825 格）：
//      · 原文 JSON ≈ 20~25MB，V8 对象 3~4 倍（1.6GB 机器扛不住）
//      · 只缓存原文字符串仍需每次 gzip（20MB 压缩 ~1.5s）⇒ 命中也要 3.0s
//      · 缓存 gzip Buffer ⇒ 体积仅 1.3MB，命中时**零压缩零序列化**，直出
//    这也是「重活只在第一次做」的正确切法：一次请求只序列化 + 压缩各一次。
const GRID_CACHE_MAX_BYTES = 24 * 1024 * 1024   // 结果缓存总预算（gzip 后字节）
const GRID_CACHE_ITEM_MAX = 8 * 1024 * 1024     // 单条 gzip 后超过 8MB 就不缓存（现实里远小于此）
const GRID_CLASSES = 6
const GRID_NON_NUMERIC = new Set(['RecID', '区县', '城市'])
const gridPayloadCache = new Map()   // key -> { gz, bytes }
const gridMetaCache = new Map()      // key -> meta（几百字节，专供 metaOnly）
const GRID_META_CACHE_MAX = 300      // 26 城 × 区县 × 字段 的组合上限，超出按插入序淘汰
const gridDistrictCache = new Map()  // id -> string[]
let gridCacheBytes = 0

/** 城市名：优先 DB 的 city 列，多数行为空 ⇒ 从文件名解析（"上海1km网格人口.zip"） */
function resolveGridCity(row) {
  const c = String(row.city || '').trim()
  if (c) return c
  const m = String(row.name || '').match(/^(.+?)1?km网格人口/)
  if (m) return m[1].trim()
  return String(row.name || '').replace(/\.zip$/i, '').trim()
}

function gridNumericFields(fieldNames) {
  return (fieldNames || []).filter(f => f && !GRID_NON_NUMERIC.has(f))
}

/** 按城市名找文件（同城多份时取 id 最大 = 最近一次上传） */
function findGridRow(db, user, city) {
  const vis = visibilityClause(user)
  const rows = db.prepare(
    `SELECT id, name, city, field_names, feature_count FROM shapefiles
     WHERE category = 'population' AND ${vis.clause} ORDER BY id DESC`
  ).all(...vis.params)
  for (const r of rows) {
    if (resolveGridCity(r) === city) return r
  }
  return null
}

/** 坐标取 5 位小数（≈1m 精度；1km 网格用不到更高精度，能显著压小响应） */
const round5 = (x) => Math.round(x * 1e5) / 1e5
function roundGeometry(g) {
  if (!g || !g.type) return g
  const walk = (c) => (Array.isArray(c[0]) ? c.map(walk) : [round5(c[0]), round5(c[1])])
  return { type: g.type, coordinates: walk(g.coordinates) }
}

/**
 * 计算 6 档分界。
 * equal：等宽；quantile：等频（分位数）。
 * ⚠️ 分位数会**出现重复分界**（大量网格值为 0 时）⇒ 部分档位为空，属正常现象，
 *    前端图例如实显示「0 ~ 0」即可，⛔ 不要为了好看去合并档位（会改变档数语义）。
 */
function buildBreaks(sorted, mode) {
  const n = sorted.length
  const min = sorted[0]
  const max = sorted[n - 1]
  if (mode === 'quantile') {
    const breaks = []
    for (let i = 0; i <= GRID_CLASSES; i++) {
      breaks.push(sorted[Math.min(n - 1, Math.floor((n - 1) * i / GRID_CLASSES))])
    }
    breaks[0] = min
    breaks[GRID_CLASSES] = max
    return { min, max, breaks, width: null }
  }
  const width = (max - min) / GRID_CLASSES
  return { min, max, width, breaks: Array.from({ length: GRID_CLASSES + 1 }, (_, i) => min + width * i) }
}

/** 落档：等值均分用左闭右开（max 归最后一档）；等量分档用「第一个上界大于 v 的档」 */
function gridBinOf(v, min, width, mode, breaks) {
  if (mode === 'quantile') {
    for (let i = 0; i < GRID_CLASSES; i++) if (v < breaks[i + 1]) return i
    return GRID_CLASSES - 1
  }
  if (!(width > 0)) return 0   // 全范围同值 ⇒ 单档（前端按「数值一致」显示）
  const b = Math.floor((v - min) / width)
  return Math.min(GRID_CLASSES - 1, Math.max(0, b))
}

// 可选城市列表（不解析文件 ⇒ 秒回）
router.get('/population-grid/cities', authenticate, (req, res) => {
  try {
    const db = getDb()
    const vis = visibilityClause(req.user)
    const rows = db.prepare(
      `SELECT id, name, city, field_names, feature_count FROM shapefiles
       WHERE category = 'population' AND ${vis.clause} ORDER BY id DESC`
    ).all(...vis.params)

    const seen = new Map()
    for (const r of rows) {
      const city = resolveGridCity(r)
      if (!city) continue
      if (seen.has(city)) continue   // id 倒序 ⇒ 首个即最新
      let fields = []
      try { fields = gridNumericFields(JSON.parse(r.field_names || '[]')) } catch (e) {}
      seen.set(city, {
        city,
        id: r.id,
        featureCount: r.feature_count || 0,
        fields
      })
    }
    res.json({ success: true, data: [...seen.values()].sort((a, b) => a.city.localeCompare(b.city, 'zh')) })
  } catch (error) {
    console.error('[grid] 城市列表失败:', error)
    res.status(500).json({ message: '获取城市列表失败' })
  }
})

// 某城市的区县列表（需解析一次文件 ⇒ 结果常驻内存，几十字节/城）
router.get('/population-grid/districts', authenticate, (req, res) => {
  try {
    const db = getDb()
    const city = String(req.query.city || '').trim()
    if (!city) return res.status(400).json({ message: '缺少 city 参数' })

    const row = findGridRow(db, req.user, city)
    if (!row) return res.status(404).json({ message: '该城市暂无 1km 网格数据' })

    const cached = gridDistrictCache.get(row.id)
    if (cached) return res.json({ success: true, city, districts: cached })

    const geo = getGeoObject(row.id)
    const set = new Set()
    for (const f of (geo?.features || [])) {
      const d = String(f.properties?.['区县'] ?? '').trim()
      if (d) set.add(d)
    }
    const districts = [...set].sort((a, b) => a.localeCompare(b, 'zh'))
    gridDistrictCache.set(row.id, districts)
    res.json({ success: true, city, districts })
  } catch (error) {
    console.error('[grid] 区县列表失败:', error)
    res.status(500).json({ message: '获取区县列表失败' })
  }
})

// 分级数据（精简 GeoJSON + 分档元信息）
router.get('/population-grid/data', authenticate, (req, res) => {
  try {
    const db = getDb()
    const city = String(req.query.city || '').trim()
    const district = String(req.query.district || '').trim()
    const field = String(req.query.field || '').trim()
    const mode = req.query.mode === 'quantile' ? 'quantile' : 'equal'
    // metaOnly=1：只回 meta（min/max/breaks/bins），不回 features。
    // 用途：「选择城市 → 设置值域」时要先知道该范围的数值区间才能预填 6 档，
    //   而整城 features 有 1.28MB（重庆）⇒ 只回几百字节。
    // ⚠️ 仍会走完整的解析 + 分档 + 缓存 ⇒ 后续点「显示」时命中缓存，CPU 只需 45ms。
    const metaOnly = String(req.query.metaOnly || '') === '1'
    if (!city || !field) return res.status(400).json({ message: '缺少 city / field 参数' })

    const row = findGridRow(db, req.user, city)
    if (!row) return res.status(404).json({ message: '该城市暂无 1km 网格数据' })

    let fieldNames = []
    try { fieldNames = JSON.parse(row.field_names || '[]') } catch (e) {}
    if (!fieldNames.includes(field)) {
      return res.status(400).json({ message: `字段不存在：${field}` })
    }

    const cacheKey = `${row.id}|${district}|${field}|${mode}`
    if (metaOnly) {
      const m = gridMetaCache.get(cacheKey)
      if (m) return res.json({ success: true, meta: m })
      // 有完整结果但没有 meta 缓存（升级前写入的旧条目）⇒ 解压兜底，顺便补上 meta 缓存
      const full = gridPayloadCache.get(cacheKey)
      if (full) {
        const parsed = JSON.parse(zlib.gunzipSync(full.gz).toString('utf8'))
        if (parsed?.meta) {
          gridMetaCache.set(cacheKey, parsed.meta)
          return res.json({ success: true, meta: parsed.meta })
        }
      }
    } else {
      const hit = gridPayloadCache.get(cacheKey)
      if (hit) {
        // ⚠️ 必须自己设 Content-Encoding：express 的 compression 中间件看到它就会跳过压缩
        return res.set('Content-Encoding', 'gzip').type('application/json').send(hit.gz)
      }
    }

    const geo = getGeoObject(row.id)
    if (!geo) return res.status(500).json({ message: '网格文件缺失或损坏' })

    // 1) 过滤 + 取值
    const picked = []
    let skipped = 0
    for (const f of (geo.features || [])) {
      const p = f.properties || {}
      if (district && String(p['区县'] ?? '').trim() !== district) continue
      const raw = p[field]
      if (raw === null || raw === undefined || raw === '') { skipped++; continue }
      const v = Number(raw)
      if (!Number.isFinite(v)) { skipped++; continue }
      picked.push({ f, v })
    }
    if (!picked.length) {
      return res.status(404).json({ message: district ? `${district} 内没有该字段的有效网格` : '该城市没有该字段的有效网格' })
    }

    // 2) 分档
    const sorted = picked.map(x => x.v).sort((a, b) => a - b)
    const { min, max, breaks, width } = buildBreaks(sorted, mode)
    const bins = new Array(GRID_CLASSES).fill(0)
    const features = new Array(picked.length)
    for (let i = 0; i < picked.length; i++) {
      const { f, v } = picked[i]
      const b = gridBinOf(v, min, width, mode, breaks)
      bins[b]++
      features[i] = {
        type: 'Feature',
        // ⚠️ 只保留 geometry；几何类型保持原样（Polygon / MultiPolygon 都有可能出现）
        geometry: roundGeometry(f.geometry),
        properties: { v: Math.round(v * 100) / 100, b }
      }
    }

    const body = {
      success: true,
      meta: {
        city,
        district: district || null,
        field,
        mode,
        min,
        max,
        breaks,
        width,
        classes: GRID_CLASSES,
        count: features.length,
        skipped,
        bins,
        fileId: row.id,
        featureCount: row.feature_count || 0
      },
      geojson: { type: 'FeatureCollection', features }
    }

    // 3) 序列化 + 压缩各一次，响应与缓存共用同一份 buffer
    //    ⛔ 不要分别 stringify/gzip 两遍 —— 20MB 体量下每次都是几百 ms~1.5s
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(body), 'utf8'))
    const bytes = gz.length
    if (bytes <= GRID_CACHE_ITEM_MAX) {
      gridPayloadCache.set(cacheKey, { gz, bytes })
      gridCacheBytes += bytes
      while (gridCacheBytes > GRID_CACHE_MAX_BYTES && gridPayloadCache.size > 1) {
        const k = gridPayloadCache.keys().next().value
        gridCacheBytes -= gridPayloadCache.get(k).bytes
        gridPayloadCache.delete(k)
      }
    }

    // meta 单独存一份（几十~几百字节），供 metaOnly 直出、无需 gunzip 1.28MB
    gridMetaCache.set(cacheKey, body.meta)
    while (gridMetaCache.size > GRID_META_CACHE_MAX) {
      gridMetaCache.delete(gridMetaCache.keys().next().value)
    }

    if (metaOnly) return res.json({ success: true, meta: body.meta })

    res.set('Content-Encoding', 'gzip').type('application/json').send(gz)
  } catch (error) {
    console.error('[grid] 分级数据失败:', error)
    res.status(500).json({ message: '生成网格分级失败：' + (error?.message || '未知错误') })
  }
})

// 获取单个 Shapefile 的 GeoJSON 数据（登录用户可访问自己 + 管理员共享的文件）
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const vis = visibilityClause(req.user)

    const row = db.prepare(
      `SELECT id, name, field_names, feature_count FROM shapefiles WHERE id = ? AND ${vis.clause}`
    ).get(id, ...vis.params)

    if (!row) {
      return res.status(404).json({ message: '未找到' })
    }

    attachGeo(row)   // geojson 在文件里，回填后再解析
    const geojson = JSON.parse(row.geojson)

    res.json({
      data: {
        id: row.id,
        name: row.name,
        geojson: geojson,
        field_names: JSON.parse(row.field_names),
        feature_count: row.feature_count
      }
    })

  } catch (error) {
    console.error('获取 Shapefile 数据失败:', error)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 重命名 Shapefile（仅本人或管理员可操作自己/管理的文件）
router.put('/:id/rename', authenticate, (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const userId = req.user.id
    const isAdmin = req.user.role === 'admin'
    const { name } = req.body

    if (!name || !name.trim()) {
      return res.status(400).json({ message: '文件名不能为空' })
    }

    // 归属校验：本人可改；管理员可改任意文件（共享数据维护）
    const whereSql = isAdmin ? `id = ?` : `id = ? AND user_id = ?`
    const whereParams = isAdmin ? [id] : [id, userId]

    const row = db.prepare(`SELECT id FROM shapefiles WHERE ${whereSql}`).get(...whereParams)
    if (!row) {
      return res.status(404).json({ message: '未找到该文件或无权操作' })
    }

    db.prepare(`UPDATE shapefiles SET name = ? WHERE ${whereSql}`).run(name.trim(), ...whereParams)
    db.saveNow()

    res.json({ success: true, message: '重命名成功' })
  } catch (error) {
    console.error('重命名 Shapefile 失败:', error)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 删除 Shapefile（仅本人或管理员可删除）
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const userId = req.user.id
    const isAdmin = req.user.role === 'admin'

    const whereSql = isAdmin ? `id = ?` : `id = ? AND user_id = ?`
    const whereParams = isAdmin ? [id] : [id, userId]

    const result = db.prepare(`DELETE FROM shapefiles WHERE ${whereSql}`).run(...whereParams)
    db.saveNow()

    // v1.13.143：geojson 外置成文件，删行后必须同步删文件，否则留下孤儿文件
    if (result.changes > 0) removeGeoFile(id)

    // result.changes === 0 表示无匹配行（越权或不存在）
    res.json({ success: true, message: result.changes > 0 ? '删除成功' : '未找到该文件或无权删除' })

  } catch (error) {
    console.error('删除 Shapefile 失败:', error)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 检索 Shapefile 数据（支持多条件查询；登录用户可查自己+管理员共享）
router.post('/:id/query', authenticate, (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const vis = visibilityClause(req.user)
    const { conditions } = req.body

    // 获取 Shapefile 数据
    const row = db.prepare(
      `SELECT id, name, field_names FROM shapefiles WHERE id = ? AND ${vis.clause}`
    ).get(id, ...vis.params)

    if (!row) {
      return res.status(404).json({ message: '未找到该文件' })
    }

    attachGeo(row)
    const geojson = JSON.parse(row.geojson)
    const features = geojson.features || []

    // 如果没有条件，返回所有数据
    if (!conditions || conditions.length === 0) {
      return res.json({
        success: true,
        data: {
          id: row.id,
          name: row.name,
          features: features,
          total: features.length,
          matched: features.length
        }
      })
    }

    // 执行多条件筛选
    const matchedFeatures = features.filter(feature => {
      const props = feature.properties || {}
      
      // 所有条件都必须满足（AND 逻辑）
      return conditions.every(condition => {
        const { field, operator, value } = condition
        
        // 如果字段不存在，跳过此条件
        if (!(field in props)) return true
        
        const fieldValue = props[field]
        
        // 如果字段值不是数字，尝试转换
        const numValue = parseFloat(fieldValue)
        const targetValue = parseFloat(value)
        
        if (isNaN(numValue) || isNaN(targetValue)) {
          return false
        }
        
        switch (operator) {
          case '>':
            return numValue > targetValue
          case '>=':
            return numValue >= targetValue
          case '<':
            return numValue < targetValue
          case '<=':
            return numValue <= targetValue
          case '=':
          case '==':
            return numValue === targetValue
          case '!=':
            return numValue !== targetValue
          default:
            return true
        }
      })
    })

    res.json({
      success: true,
      data: {
        id: row.id,
        name: row.name,
        features: matchedFeatures,
        total: features.length,
        matched: matchedFeatures.length
      }
    })

  } catch (error) {
    console.error('检索 Shapefile 失败:', error)
    res.status(500).json({ message: '服务器错误: ' + error.message })
  }
})

// 获取 Shapefile 的数值字段列表
router.get('/:id/fields', authenticate, (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const vis = visibilityClause(req.user)

    const row = db.prepare(
      `SELECT id, name, field_names FROM shapefiles WHERE id = ? AND ${vis.clause}`
    ).get(id, ...vis.params)

    if (!row) {
      return res.status(404).json({ message: '未找到该文件' })
    }

    const fieldNames = JSON.parse(row.field_names || '[]')
    
    // 分析每个字段，识别数值字段
    attachGeo(row)
    const geojson = JSON.parse(row.geojson)
    const features = geojson.features || []
    
    // 采样前10个要素来判断字段类型
    const sampleSize = Math.min(10, features.length)
    const numericFields = []
    
    for (const fieldName of fieldNames) {
      let numericCount = 0
      let totalCount = 0
      
      for (let i = 0; i < sampleSize; i++) {
        const value = features[i].properties?.[fieldName]
        if (value !== null && value !== undefined && value !== '') {
          totalCount++
          const num = parseFloat(value)
          if (!isNaN(num)) {
            numericCount++
          }
        }
      }
      
      // 如果采样中超过80%的值是数字，认为是数值字段
      if (totalCount > 0 && numericCount / totalCount >= 0.8) {
        numericFields.push(fieldName)
      }
    }

    res.json({
      success: true,
      data: {
        id: row.id,
        name: row.name,
        allFields: fieldNames,
        numericFields: numericFields
      }
    })

  } catch (error) {
    console.error('获取字段列表失败:', error)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 计算人口分布 - 根据圆心+半径计算各shapefile内人口统计
router.post('/calculate-population', authenticate, (req, res) => {
  try {
    const vis = visibilityClause(req.user)
    const { lat, lng, radius, fieldName, shapefileId } = req.body
    // v1.13.227：category 参数化（白名单，默认 'population' ⇒ 对「常住人口分布」逐字兼容）
    const category = ALLOWED_CATEGORIES.has(req.body.category) ? req.body.category : 'population'

    if (!lat || !lng || !radius) {
      return res.status(400).json({ success: false, error: '缺少必要参数' })
    }

    // 🔴 护栏⓪：hd 仅管理员可用（v1.13.227）—— 与 223 对两族「隐藏功能」的收紧同构。
    //   前端入口虽已 admin-only，但若 API 不拦，普通用户**仍可直接调用**（visibilityClause 让他们
    //   能看到 admin 上传的 hd 文件）⇒「其他用户暂不实施」就成了假的。故此处兜底拒绝。
    if (category === 'population_hd' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'admin_only',
        error: '高精度人口数据仅管理员可用'
      })
    }

    // 🔴 护栏①：hd 必须指定单文件 —— ⛔ 绝不允许走「全 category 兜底」（否则 95MB 级文件被批量遍历）
    if (!shapefileId && category === 'population_hd') {
      return res.status(400).json({
        success: false,
        code: 'shapefile_required',
        error: '高精度人口数据量极大，必须指定单个数据文件'
      })
    }

    // 🔴 护栏②：同一文件串行 —— 并发会让 95MB 解析内存叠加（实测 372MB/次）
    const lockKey = shapefileId ? 'id:' + shapefileId : 'cat:' + category
    if (popCalcInFlight.has(lockKey)) {
      return res.status(429).json({
        success: false,
        code: 'calc_busy',
        error: '该数据文件正在计算中，请稍候再试'
      })
    }

    // 🔴 护栏③：解析前 RSS 自检 —— 宁可拒绝，也不触发 OOM 拖垮整机
    const rssMb = Math.round(process.memoryUsage().rss / 1048576)
    if (rssMb > POP_CALC_RSS_LIMIT_MB) {
      return res.status(503).json({
        success: false,
        code: 'server_memory_pressure',
        error: `服务器内存紧张（当前 ${rssMb}MB），请稍后再试`
      })
    }

    popCalcInFlight.add(lockKey)
    // 正常结束与客户端中断统一释放（close 覆盖两种情况）
    res.on('close', () => popCalcInFlight.delete(lockKey))

    const db = getDb()
    // 获取shapefile（如果前端传了shapefileId则只处理该文件，否则全部可加载的）
    let rows
    if (shapefileId) {
      // ⚠️ 该分支历史上不校验 category；v1.13.227 起一并校验，防止拿 population 的 id 去按 hd 语义算
      rows = db.prepare(
        `SELECT id, name, field_names FROM shapefiles WHERE id = ? AND category = ? AND ${vis.clause}`
      ).all(shapefileId, category, ...vis.params)
    } else {
      // 🔴🔴 兜底分支必须锁定 category（v1.13.227 起为参数，默认 'population'）！
      // 该分支是「不指定文件 ⇒ 用全部人口网格」的语义，MapView 商圈人口分布
      // （MapView.vue 里 radius 批量调用那次）走的正是这条、不传 shapefileId。
      // 若不限制，v1.13.194 新增的 population_hd（单城 95MB / 10.8 万格 / 35 字段）
      // 会被全量 getGeoObject + 逐要素 turf.intersect ⇒ 单次请求数百 MB 内存，服务器必 OOM。
      // （hd 走这条已被上方护栏① 拦下。）
      rows = db.prepare(
        `SELECT id, name, field_names FROM shapefiles WHERE category = ? AND ${vis.clause}`
      ).all(category, ...vis.params)
    }

    if (!rows || rows.length === 0) {
      return res.json({ success: true, data: { total: 0, allFields: {}, matchedFeatures: [] } })
    }

    // 创建圆心点
    const center = turf.point([parseFloat(lng), parseFloat(lat)])
    // 创建圆（使用turf的circle，steps=64保证精度）
    const circle = turf.circle([parseFloat(lng), parseFloat(lat)], radius / 1000, { steps: 64, units: 'kilometers' })

    let totalPop = 0
    const allFields = {}
    const matchedFeatures = []

    // 预计算圆的包围盒，用于快速过滤不相关的要素
    const circleBbox = turf.bbox(circle)

    for (const row of rows) {
      // 缓存统一由 geoStore 管理：文本 LRU + 仅小文件缓存解析对象。
      // 人口网格单文件最大 30MB，V8 解析后 3~4 倍，在 1.6GB 机器上不做对象级缓存。
      const geojson = getGeoObject(row.id) || { features: [] }
      const features = geojson.features || []
      console.log(`[calculate-population] 处理文件: ${row.name}, 要素数: ${features.length}`)

      for (const feature of features) {
        const props = feature.properties || {}
        const fieldVal = parseFloat(props[fieldName])
        if (isNaN(fieldVal) || fieldVal <= 0) continue

        // 快速 AABB 包围盒碰撞检测：过滤掉明显不在圆内的要素（跳过 turf 重计算）
        try {
          const fBbox = turf.bbox(feature)
          if (fBbox[0] > circleBbox[2] || fBbox[2] < circleBbox[0] ||
              fBbox[1] > circleBbox[3] || fBbox[3] < circleBbox[1]) {
            continue
          }
        } catch (e) { /* 包围盒计算失败，回退到完整计算 */ }

        try {
          // 将GeoJSON要素转为turf多边形后进行相交判断
          const geom = feature.geometry
          if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue

          let fPoly
          if (geom.type === 'Polygon') {
            fPoly = turf.polygon(geom.coordinates)
          } else {
            // MultiPolygon: 逐个处理每个多边形
            let totalWeight = 0
            for (const coords of geom.coordinates) {
              try {
                const subPoly = turf.polygon(coords)
                const subIntersect = turf.intersect(turf.featureCollection([subPoly, circle]))
                if (!subIntersect) continue
                const subArea = turf.area(subPoly)
                const subIntersectArea = turf.area(subIntersect)
                const subRatio = Math.min(subIntersectArea / subArea, 1)
                totalWeight += fieldVal * subRatio
              } catch (e) { continue }
            }
            if (totalWeight <= 0) continue
            totalPop += totalWeight
            matchedFeatures.push({
              feature: { properties: { shapefileName: row.name, ...props }, geometry },
              value: totalWeight,
              coverageRatio: 1,
              geom: feature.geometry
            })
            continue
          }

          const intersect = turf.intersect(turf.featureCollection([fPoly, circle]))
          if (!intersect) continue

          // 计算相交面积比例 = 交集面积 / 多边形面积（与前端客户端计算一致）
          const polygonArea = turf.area(feature)
          const intersectArea = turf.area(intersect)
          const ratio = Math.min(intersectArea / polygonArea, 1)
          const weighted = fieldVal * ratio

          totalPop += weighted
          matchedFeatures.push({
            feature: { properties: { shapefileName: row.name, ...props }, geometry: feature.geometry },
            value: weighted,
            coverageRatio: ratio,
            geom: feature.geometry
          })

          // 收集所有字段
          for (const [key, val] of Object.entries(props)) {
            const num = parseFloat(val)
            if (!isNaN(num)) {
              allFields[key] = (allFields[key] || 0) + num * ratio
            }
          }
        } catch (e) {
          console.error(`[calculate-population] 要素处理错误: ${e.message}`)
          continue
        }
      }
    }

    console.log(`[calculate-population] 总人口: ${totalPop}, 匹配要素: ${matchedFeatures.length}`)
    res.json({
      success: true,
      data: {
        total: Math.round(totalPop),
        allFields,
        matchedFeatures
      }
    })
  } catch (error) {
    console.error('计算人口分布错误:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/shapefiles/search-commerce
 * 搜索城市商圈 shapefile 中的名称匹配
 * Body: { keyword: string }
 * 在所有 category='other' 的 shapefile 中查找名称/name 字段包含 keyword 的要素
 */
router.post('/search-commerce', authenticate, (req, res) => {
  try {
    const db = getDb()
    const vis = visibilityClause(req.user)
    const { keyword } = req.body

    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ success: false, message: '请输入搜索关键词' })
    }

    const kw = keyword.trim()

    // 获取所有 other 类 shapefile（当前用户可见）
    const rows = db.prepare(
      `SELECT id, name, field_names FROM shapefiles WHERE category = 'other' AND ${vis.clause}`
    ).all(...vis.params)

    const matchedFeatures = []

    for (const row of rows) {
      try {
        attachGeo(row)
        const geojson = JSON.parse(row.geojson)
        const features = geojson.features || []

        // 确定名称字段（名称 / name / Name）
        let nameField = null
        const fields = row.field_names ? JSON.parse(row.field_names) : []
        nameField = fields.find(f => ['名称', 'name', 'Name', 'NAME'].includes(f))

        if (!nameField) continue

        for (const feature of features) {
          const props = feature.properties || {}
          const fieldValue = props[nameField]
          if (fieldValue && String(fieldValue).includes(kw)) {
            matchedFeatures.push({
              shapefileId: row.id,
              shapefileName: row.name,
              shapefileField: nameField,
              feature
            })
          }
        }
      } catch (e) {
        console.error(`解析 ${row.name} 失败:`, e)
        continue
      }
    }

    res.json({
      success: true,
      data: {
        keyword: kw,
        total: matchedFeatures.length,
        features: matchedFeatures
      }
    })

  } catch (error) {
    console.error('搜索商圈失败:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})


/**
 * POST /api/shapefiles/calculate-potential
 * 开店余地分析
 */
router.post('/calculate-potential', authenticate, async (req, res) => {
  try {
    const vis = visibilityClause(req.user)
    const { cityName, radius, myStoreMin, competitorMin, conditions } = req.body
    if (!cityName || !radius) return res.status(400).json({ success: false, error: '缺少参数' })
    const r = parseFloat(radius) || 1
    const db = getDb()
    const rows = db.prepare(`SELECT id, name, field_names FROM shapefiles WHERE category = 'population' AND name LIKE ? AND ${vis.clause} LIMIT 1`).all(`%${cityName}%`, ...vis.params)
    if (!rows || !rows.length) return res.json({ success: false, error: `未找到${cityName}的数据` })
    attachGeo(rows[0])
    const geojson = JSON.parse(rows[0].geojson)
    const features = geojson.features || []
    // 🔴 v1.13.239：「我的门店数」= **本账号自己的门店**（与 GET /api/markers 同口径 `WHERE user_id = ?`）。
    //   旧实现整表全取、无 user_id 过滤 ⇒ 实际统计的是**全平台门店**，把别人的店算成了"我的"。
    // 🔴 v1.13.240：再收一层 —— **只算在营门店**（`utils/storeStatus.js` 单一真源，与仪表盘 KPI 同口径）。
    //   闭店/停业/候选店不再计入，否则「我的门店数 = 1」可能只是一家早就关掉的店。
    const markers = db.prepare(
      `SELECT id, latitude, longitude, store_status, brand FROM markers WHERE user_id = ? ${IN_BUSINESS_SQL}`
    ).all(req.user.id, ...IN_BUSINESS_PARAMS)
    const comps = db.prepare("SELECT id, brand, latitude, longitude FROM competitors WHERE (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))").all()
    // 品牌筛选（多选，空数组=不限品牌）
    const myBrands = Array.isArray(req.body.myStoreBrands) ? req.body.myStoreBrands.filter(Boolean) : []
    const compBrands = Array.isArray(req.body.compBrands) ? req.body.compBrands.filter(Boolean) : []
    // 其他品牌（高德关键词检索，可两个）
    const otherBrands = [req.body.otherBrand1, req.body.otherBrand2].map(ob => {
      if (!ob || !ob.name || !String(ob.name).trim()) return null
      // 🔴 v1.13.243：填了品牌名却没填数量 ⇒ 该条件不参与（⛔ 不兜底成 1）
      const v = numOr(ob.val, NaN)
      if (!Number.isFinite(v)) return null
      return { name: String(ob.name).trim(), op: ob.op || '>', val: v, pois: [], degraded: null }
    })
    // 高德检索其他品牌 POI（高德返回 GCJ-02，与网格/门店坐标一致，直接用）
    // 🔴🔴 v1.13.239 降级可见：取不到数据时该品牌条件**不参与筛选**，
    //    但必须把原因回传给前端明示 —— ⛔ 绝不允许「条件等于没设」还看起来像筛过了。
    for (let i = 0; i < otherBrands.length; i++) {
      const ob = otherBrands[i]
      if (!ob) continue
      try {
        // 🔴 v1.13.255：其他品牌改为查**平台品牌库** brand_stores，不再走高德。
        //   依据（2026-10-20 实测）：高德单次检索硬上限约 500 条、count 报 800 不可信 ——
        //     上海·肯德基高德只能取回 491 条（覆盖 934 网格），品牌库有 708 条（覆盖 1213 网格）。
        //   代价：只支持库中已有的品牌（前端下拉按城市动态取），换取 100% 准确 + 零 API 调用。
        //   ⚠️ brand_stores.city 存「上海市」，前端传「上海」⇒ REPLACE 归一后再比。
        const cityKey = String(cityName || '').trim()
        const rows = db.prepare(`
          SELECT latitude, longitude FROM brand_stores
          WHERE brand = ? AND REPLACE(city, '市', '') = ?
            AND latitude IS NOT NULL AND longitude IS NOT NULL
        `).all(ob.name, cityKey)
        ob.pois = rows.map(r => ({ lng: r.longitude, lat: r.latitude }))
        ob.source = 'brand_stores'
        if (rows.length === 0) {
          // 兜底：品牌库未收录该城该品牌（正常不会出现 —— 下拉只列有数据的品牌）
          ob.degraded = { name: ob.name, reason: 'no_data',
            message: `平台品牌库中暂无「${cityKey} · ${ob.name}」数据，该品牌条件未生效` }
        }
        console.log(`[calculate-potential] 其他品牌(品牌库) "${ob.name}" 城市${cityKey}: ${ob.pois.length} 点${ob.degraded ? ' ⚠️' + ob.degraded.reason : ''}`)
      } catch (e) {
        ob.degraded = { name: ob.name, reason: 'search_failed',
          message: `品牌库查询异常（${e.message}），该品牌条件未生效` }
        console.warn(`[calculate-potential] 品牌库查询"${ob.name}"失败:`, e.message)
      }
    }
    const degradedBrands = otherBrands.filter(ob => ob && ob.degraded).map(ob => ob.degraded)
    const myStores = markers.filter(m => m.latitude && m.longitude)
    const compStores = comps.filter(c => c.latitude && c.longitude)
    // 品牌过滤后的门店集合（仅统计所选品牌）
    const myStoresFiltered = myBrands.length ? myStores.filter(s => myBrands.includes(s.brand)) : myStores
    const compStoresFiltered = compBrands.length ? compStores.filter(c => compBrands.includes(c.brand)) : compStores
    const results = []
    for (let i = 0; i < features.length; i++) {
      const f = features[i], props = f.properties || {}, geom = f.geometry
      if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue
      let center
      try {
        const poly = geom.type === 'Polygon' ? turf.polygon(geom.coordinates) : turf.polygon(geom.coordinates[0])
        center = turf.centerOfMass(poly)
      } catch(e) { continue }
      const cc = center.geometry.coordinates
      const circle = turf.circle(cc, r, { steps: 48, units: 'kilometers' })
      let popOk = true
      if (conditions && conditions.length > 0) {
        for (const cond of conditions) {
          const val = parseFloat(props[cond.field])
          if (isNaN(val)) { popOk = false; break }
          try {
            const fp = turf.polygon(geom.coordinates)
            const inter = turf.intersect(turf.featureCollection([fp, circle]))
            if (!inter) { popOk = false; break }
            const ratio = Math.min(turf.area(inter) / turf.area(fp), 1)
            const weighted = val * ratio
            const op = cond.operator || '>'
            // 🔴 v1.13.243：数值无效的条件**不参与**（⛔ 不再按 0 参与比较 —— 那会变成"该字段 > 0"）
            const condVal = numOr(cond.value, numOr(cond.minValue, NaN))
            if (!Number.isFinite(condVal)) continue
            if (op === '>') { if (!(weighted > condVal)) { popOk = false; break } }
            else if (op === '>=') { if (!(weighted >= condVal)) { popOk = false; break } }
            else if (op === '<') { if (!(weighted < condVal)) { popOk = false; break } }
            else if (op === '<=') { if (!(weighted <= condVal)) { popOk = false; break } }
            else if (op === '=') { if (!(Math.abs(weighted - condVal) < 1)) { popOk = false; break } }
            else { if (weighted < condVal) { popOk = false; break } }
          } catch(e) { popOk = false; break }
        }
      }
      if (!popOk) continue
      let mc = 0, ccCount = 0
      const bCounts = {}
      for (const s of myStoresFiltered) { if (turf.booleanPointInPolygon(turf.point([s.longitude, s.latitude]), circle)) mc++ }
      // 🔴 v1.13.243：未填有效数值的条件一律**不参与**筛选。
      //    ⛔ 不能再 `numOr(x, 1)` 兜底 —— 空值会被当成"≥1 家店"，结果被悄悄缩小且界面无提示。
      const myStoreOp = req.body.myStoreOp || 'any'
      const myStoreVal = numOr(req.body.myStoreVal ?? req.body.myStoreMin, NaN)
      const myCondOk = myStoreOp !== 'any' && Number.isFinite(myStoreVal)
      const compOp = req.body.competitorOp || 'any'
      const compVal = numOr(req.body.competitorVal ?? req.body.competitorMin, NaN)
      const compCondOk = compOp !== 'any' && Number.isFinite(compVal)
      // 我的门店数条件（'any' = 不限；数值无效 = 未填 ⇒ 同样不筛选）
      if (!myCondOk) { /* 不限 / 未填数量：不筛选 */ }
      else if (myStoreOp === '>' && !(mc > myStoreVal)) continue
      else if (myStoreOp === '>=' && !(mc >= myStoreVal)) continue
      else if (myStoreOp === '<' && !(mc < myStoreVal)) continue
      else if (myStoreOp === '<=' && !(mc <= myStoreVal)) continue
      else if (myStoreOp === '=' && !(Math.abs(mc - myStoreVal) < 1)) continue
      for (const c of compStoresFiltered) {
        if (turf.booleanPointInPolygon(turf.point([c.longitude, c.latitude]), circle)) {
          ccCount++; const b = c.brand || '未知'; bCounts[b] = (bCounts[b] || 0) + 1
        }
      }
      // 竞品门店数条件（'any' = 不限；数值无效 = 未填 ⇒ 同样不筛选）
      if (!compCondOk) { /* 不限 / 未填数量：不筛选 */ }
      else if (compOp === '>' && !(ccCount > compVal)) continue
      else if (compOp === '>=' && !(ccCount >= compVal)) continue
      else if (compOp === '<' && !(ccCount < compVal)) continue
      else if (compOp === '<=' && !(ccCount <= compVal)) continue
      else if (compOp === '=' && !(Math.abs(ccCount - compVal) < 1)) continue
      // 其他品牌（高德POI）条件
      const otherCounts = []
      let otherOk = true
      for (const ob of otherBrands) {
        if (!ob) { otherCounts.push(0); continue }
        // 🔴🔴 v1.13.254：只有「真没数据」才跳过筛选。
        //   truncated 属于**数据不全但仍有部分点**（本次已取到 160 个），必须参与筛选 ——
        //   旧写法把它和 search_failed/no_coords 一样整段 continue，导致「条件等于没设」：
        //   实测上海·肯德基「>= 1」把 7417 个网格全部放行（应为少数）。
        //   ⚠️ 代价：truncated 时的计数只是**下限**（可能偏小），前端已有提示说明。
        const unusable = ob.degraded && ob.degraded.reason !== 'truncated'
        if (unusable) { otherCounts.push(null); continue }
        // ⚠️ 旧实现还有 `|| ob.pois.length === 0 ⇒ 直接放行`，等于该城市确实 0 家时
        //    运算符也不再判定（设「>= 1」也会通过）。现改为按 cnt = 0 正常走运算符。
        let cnt = 0
        for (const p of ob.pois) {
          if (turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), circle)) cnt++
        }
        otherCounts.push(cnt)
        const v = ob.val
        if (ob.op === '>' && !(cnt > v)) { otherOk = false }
        else if (ob.op === '>=' && !(cnt >= v)) { otherOk = false }
        else if (ob.op === '<' && !(cnt < v)) { otherOk = false }
        else if (ob.op === '<=' && !(cnt <= v)) { otherOk = false }
        else if (ob.op === '=' && !(Math.abs(cnt - v) < 1)) { otherOk = false }
      }
      if (!otherOk) continue
      results.push({ index: i, center: cc, radius: r, myStores: mc, competitors: ccCount, competitorBrands: bCounts,
        otherStores: otherBrands.map((ob, oi) => ob ? { name: ob.name, count: otherCounts[oi],
          degraded: !!ob.degraded, reason: ob.degraded ? ob.degraded.reason : null } : null).filter(Boolean) })
    }
    res.json({ success: true, data: { cityName, total: features.length, matched: results.length, results,
      degraded: degradedBrands, myStoreScope: 'own', myStoreInBusiness: true } })
  } catch (error) {
    console.error('[calculate-potential] error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
