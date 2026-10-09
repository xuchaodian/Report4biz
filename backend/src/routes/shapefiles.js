import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { execFile } from 'child_process'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import * as turf from '@turf/turf'
import iconv from 'iconv-lite'
import { textSearchAll } from '../utils/amapPoi.js'
// ⚠️ 本文件**不再使用 writeGeoText**：上传改由 Python 流式直写 + adoptGeoFile 转正
//    （见 upload 路由与 geoStore::adoptGeoFile 的注释）。writeGeoText 仍供其他模块使用。
import {
  removeGeoFile, getGeoObject, attachGeo,
  adoptGeoFile, geoDir
} from '../models/geoStore.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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

    if (!lat || !lng || !radius) {
      return res.status(400).json({ success: false, error: '缺少必要参数' })
    }

    const db = getDb()
    // 获取shapefile（如果前端传了shapefileId则只处理该文件，否则全部可加载的）
    let rows
    if (shapefileId) {
      rows = db.prepare(
        `SELECT id, name, field_names FROM shapefiles WHERE id = ? AND ${vis.clause}`
      ).all(shapefileId, ...vis.params)
    } else {
      // 🔴🔴 兜底分支必须锁定 category！
      // 该分支是「不指定文件 ⇒ 用全部人口网格」的语义，MapView 商圈人口分布
      // （MapView.vue 里 radius 批量调用那次）走的正是这条、不传 shapefileId。
      // 若不限制，v1.13.194 新增的 population_hd（单城 95MB / 10.8 万格 / 35 字段）
      // 会被全量 getGeoObject + 逐要素 turf.intersect ⇒ 单次请求数百 MB 内存，服务器必 OOM。
      rows = db.prepare(
        `SELECT id, name, field_names FROM shapefiles WHERE category = 'population' AND ${vis.clause}`
      ).all(...vis.params)
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
    const markers = db.prepare('SELECT id, latitude, longitude, store_status, brand FROM markers').all()
    const comps = db.prepare("SELECT id, brand, latitude, longitude FROM competitors WHERE (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))").all()
    // 品牌筛选（多选，空数组=不限品牌）
    const myBrands = Array.isArray(req.body.myStoreBrands) ? req.body.myStoreBrands.filter(Boolean) : []
    const compBrands = Array.isArray(req.body.compBrands) ? req.body.compBrands.filter(Boolean) : []
    // 其他品牌（高德关键词检索，可两个）
    const otherBrands = [req.body.otherBrand1, req.body.otherBrand2].map(ob => {
      if (!ob || !ob.name || !String(ob.name).trim()) return null
      return { name: String(ob.name).trim(), op: ob.op || '>', val: parseFloat(ob.val) || 1, pois: [] }
    })
    // 高德检索其他品牌 POI（高德返回 GCJ-02，与网格/门店坐标一致，直接用）
    for (let i = 0; i < otherBrands.length; i++) {
      const ob = otherBrands[i]
      if (!ob) continue
      try {
        const sres = await textSearchAll(cityName, ob.name)
        ob.pois = sres.pois || []
        console.log(`[calculate-potential] 其他品牌检索 "${ob.name}" 城市${cityName}: 高德count=${sres.count}, 收集${ob.pois.length}点`)
      } catch (e) {
        console.warn(`[calculate-potential] 高德检索"${ob.name}"失败:`, e.message)
      }
    }
    const myStores = markers.filter(m => m.latitude && m.longitude)
    const compStores = comps.filter(c => c.latitude && c.longitude)
    // 品牌过滤后的门店集合（仅统计所选品牌）
    const myStoresFiltered = myBrands.length ? myStores.filter(s => myBrands.includes(s.brand)) : myStores
    const compStoresFiltered = compBrands.length ? compStores.filter(c => compBrands.includes(c.brand)) : compStores
    const closedKeywords = ['闭店','停业','歇业','休业','结业','暂停营业']
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
            const condVal = parseFloat(cond.value) || parseFloat(cond.minValue) || 0
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
      const myStoreOp = req.body.myStoreOp || '>'
      const myStoreVal = parseFloat(req.body.myStoreVal) || parseFloat(req.body.myStoreMin) || 1
      const compOp = req.body.competitorOp || '>'
      const compVal = parseFloat(req.body.competitorVal) || parseFloat(req.body.competitorMin) || 1
      // 我的门店数条件
      if (myStoreOp === '>' && !(mc > myStoreVal)) continue
      else if (myStoreOp === '>=' && !(mc >= myStoreVal)) continue
      else if (myStoreOp === '<' && !(mc < myStoreVal)) continue
      else if (myStoreOp === '<=' && !(mc <= myStoreVal)) continue
      else if (myStoreOp === '=' && !(Math.abs(mc - myStoreVal) < 1)) continue
      for (const c of compStoresFiltered) {
        if (turf.booleanPointInPolygon(turf.point([c.longitude, c.latitude]), circle)) {
          ccCount++; const b = c.brand || '未知'; bCounts[b] = (bCounts[b] || 0) + 1
        }
      }
      // 竞品门店数条件
      if (compOp === '>' && !(ccCount > compVal)) continue
      else if (compOp === '>=' && !(ccCount >= compVal)) continue
      else if (compOp === '<' && !(ccCount < compVal)) continue
      else if (compOp === '<=' && !(ccCount <= compVal)) continue
      else if (compOp === '=' && !(Math.abs(ccCount - compVal) < 1)) continue
      // 其他品牌（高德POI）条件
      const otherCounts = []
      let otherOk = true
      for (const ob of otherBrands) {
        if (!ob || ob.pois.length === 0) { otherCounts.push(0); continue }
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
        otherStores: otherBrands.map((ob, oi) => ob ? { name: ob.name, count: otherCounts[oi] } : null).filter(Boolean) })
    }
    res.json({ success: true, data: { cityName, total: features.length, matched: results.length, results } })
  } catch (error) {
    console.error('[calculate-potential] error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
