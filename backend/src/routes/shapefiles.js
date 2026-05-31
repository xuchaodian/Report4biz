import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { exec } from 'child_process'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import * as turf from '@turf/turf'
import iconv from 'iconv-lite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const router = express.Router()

// 简单内存缓存：避免同一 shapefile 被频繁 JSON.parse（key=shapefileId, value={geojson, ts}）
const shapefileCache = new Map()
const CACHE_TTL_MS = 60 * 1000 // 缓存1分钟

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

    // 获取用户ID (从 header 或默认)
    const userId = req.headers['x-user-id'] || 1

    // 获取类别参数（默认 population），放在前面供解析时使用
    const category = req.body.category || 'population'

    // 调用 Python 脚本解析 shapefile (使用 exec 代替 execSync，避免缓冲区溢出)
    const pythonScript = path.join(__dirname, '../utils/shapefile_parser.py')

    // citynd 类型是七普人口数据（WGS84），需要转换到 GCJ-02
    // other 类型是城市商圈数据（已是高德坐标系），跳过转换
    const skipCoordConvert = category === 'other' ? '--skip-convert' : ''

    // 使用 Promise 包装 exec
    const pythonResult = await new Promise((resolve, reject) => {
      exec(`python3 "${pythonScript}" "${filePath}" ${skipCoordConvert}`.trim(), { 
        encoding: 'utf-8',
        maxBuffer: 100 * 1024 * 1024  // 100MB 缓冲区
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
        } else {
          resolve(stdout)
        }
      })
    })

    const parseResult = JSON.parse(pythonResult)

    // 删除临时上传文件
    fs.unlinkSync(filePath)

    if (!parseResult.success) {
      return res.status(400).json({ message: parseResult.error || '解析失败' })
    }

    // 保存到数据库
    const db = getDb()
    const geojsonData = JSON.stringify(parseResult.data)

    // 插入数据
    const insertResult = db.prepare(
      `INSERT INTO shapefiles (name, geojson, field_names, feature_count, user_id, category, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`
    ).run(originalName, geojsonData, JSON.stringify(parseResult.data.metadata.fields), parseResult.data.features.length, userId, category)

    // 立即保存到磁盘，防止进程重启导致数据丢失
    db.saveNow()

    const insertId = insertResult.lastInsertRowid

    res.json({
      success: true,
      message: '上传成功',
      data: {
        id: insertId,
        name: originalName,
        featureCount: parseResult.data.features.length,
        fields: parseResult.data.metadata.fields,
        category
      }
    })

  } catch (error) {
    console.error('上传 Shapefile 失败:', error)
    res.status(500).json({ message: '服务器错误: ' + error.message })
  }
})

// 获取用户的所有 Shapefile（同时包含管理员的，方便商圈人口分布功能共享数据）
router.get('/', (req, res) => {
  try {
    const db = getDb()
    const userId = req.headers['x-user-id'] || 1
    const category = req.query.category  // 可选：population / other

    // 返回当前用户 + 管理员(user_id=1) 的文件（去重）
    let sql = `SELECT id, name, field_names, feature_count, created_at, user_id, category
               FROM shapefiles
               WHERE (user_id = ? OR user_id = 1)`
    const params = [userId]

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

// 获取单个 Shapefile 的 GeoJSON 数据（普通用户可访问管理员共享的文件）
router.get('/:id', (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const userId = req.headers['x-user-id'] || 1

    const row = db.prepare(
      `SELECT id, name, geojson, field_names, feature_count FROM shapefiles WHERE id = ? AND (user_id = ? OR user_id = 1)`
    ).get(id, userId)

    if (!row) {
      return res.status(404).json({ message: '未找到' })
    }

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

// 重命名 Shapefile
router.put('/:id/rename', (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const userId = req.headers['x-user-id'] || 1
    const { name } = req.body

    if (!name || !name.trim()) {
      return res.status(400).json({ message: '文件名不能为空' })
    }

    const row = db.prepare(`SELECT id FROM shapefiles WHERE id = ? AND user_id = ?`).get(id, userId)
    if (!row) {
      return res.status(404).json({ message: '未找到该文件' })
    }

    db.prepare(`UPDATE shapefiles SET name = ? WHERE id = ? AND user_id = ?`).run(name.trim(), id, userId)
    db.saveNow()

    res.json({ success: true, message: '重命名成功' })
  } catch (error) {
    console.error('重命名 Shapefile 失败:', error)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 删除 Shapefile
router.delete('/:id', (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const userId = req.headers['x-user-id'] || 1

    db.prepare(`DELETE FROM shapefiles WHERE id = ? AND user_id = ?`).run(id, userId)
    db.saveNow()

    res.json({ success: true, message: '删除成功' })

  } catch (error) {
    console.error('删除 Shapefile 失败:', error)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 检索 Shapefile 数据（支持多条件查询）
router.post('/:id/query', (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const userId = req.headers['x-user-id'] || 1
    const { conditions } = req.body

    // 获取 Shapefile 数据（普通用户可访问管理员共享的文件）
    const row = db.prepare(
      `SELECT id, name, geojson, field_names FROM shapefiles WHERE id = ? AND (user_id = ? OR user_id = 1)`
    ).get(id, userId)

    if (!row) {
      return res.status(404).json({ message: '未找到该文件' })
    }

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
router.get('/:id/fields', (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const userId = req.headers['x-user-id'] || 1

    const row = db.prepare(
      `SELECT id, name, geojson, field_names FROM shapefiles WHERE id = ? AND (user_id = ? OR user_id = 1)`
    ).get(id, userId)

    if (!row) {
      return res.status(404).json({ message: '未找到该文件' })
    }

    const fieldNames = JSON.parse(row.field_names || '[]')
    
    // 分析每个字段，识别数值字段
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
router.post('/calculate-population', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 1
    const { lat, lng, radius, fieldName, shapefileId } = req.body

    if (!lat || !lng || !radius) {
      return res.status(400).json({ success: false, error: '缺少必要参数' })
    }

    const db = getDb()
    // 获取shapefile（如果前端传了shapefileId则只处理该文件，否则全部加载）
    let rows
    if (shapefileId) {
      rows = db.prepare(
        `SELECT id, name, geojson, field_names FROM shapefiles WHERE id = ?`
      ).all(shapefileId)
    } else {
      rows = db.prepare(
        `SELECT id, name, geojson, field_names FROM shapefiles`
      ).all()
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
      // 使用内存缓存避免重复 JSON.parse
      let geojson
      const cached = shapefileCache.get(row.id)
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        geojson = cached.geojson
      } else {
        geojson = JSON.parse(row.geojson)
        shapefileCache.set(row.id, { geojson, ts: Date.now() })
        // 控制缓存大小，超过10个时删除最旧的
        if (shapefileCache.size > 10) {
          const oldest = shapefileCache.keys().next().value
          shapefileCache.delete(oldest)
        }
      }
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
router.post('/search-commerce', (req, res) => {
  try {
    const db = getDb()
    const userId = req.headers['x-user-id'] || 1
    const { keyword } = req.body

    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ success: false, message: '请输入搜索关键词' })
    }

    const kw = keyword.trim()

    // 获取所有 other 类 shapefile
    const rows = db.prepare(
      `SELECT id, name, geojson, field_names FROM shapefiles WHERE category = 'other' AND (user_id = ? OR user_id = 1)`
    ).all(userId)

    const matchedFeatures = []

    for (const row of rows) {
      try {
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
router.post('/calculate-potential', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 1
    const { cityName, radius, myStoreMin, competitorMin, conditions } = req.body
    if (!cityName || !radius) return res.status(400).json({ success: false, error: '缺少参数' })
    const r = parseFloat(radius) || 1
    const db = getDb()
    const rows = db.prepare(`SELECT id, name, geojson, field_names FROM shapefiles WHERE category = 'population' AND name LIKE ? AND (user_id = ? OR user_id = 1) LIMIT 1`).all(`%${cityName}%`, userId)
    if (!rows || !rows.length) return res.json({ success: false, error: `未找到${cityName}的数据` })
    const geojson = JSON.parse(rows[0].geojson)
    const features = geojson.features || []
    const markers = db.prepare('SELECT id, latitude, longitude, store_status FROM markers').all()
    const comps = db.prepare('SELECT id, brand, latitude, longitude FROM competitors').all()
    const myStores = markers.filter(m => m.latitude && m.longitude)
    const compStores = comps.filter(c => c.latitude && c.longitude)
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
      for (const s of myStores) { if (turf.booleanPointInPolygon(turf.point([s.longitude, s.latitude]), circle)) mc++ }
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
      for (const c of compStores) {
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
      results.push({ index: i, center: cc, radius: r, myStores: mc, competitors: ccCount, competitorBrands: bCounts })
    }
    res.json({ success: true, data: { cityName, total: features.length, matched: results.length, results } })
  } catch (error) {
    console.error('[calculate-potential] error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
