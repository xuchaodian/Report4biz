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
    // HTTP multipart 头的文件名可能在传输中被编码，我们尝试恢复正确的 UTF-8
    let originalName = req.file.originalname
    
    // 检测是否有编码问题（检查是否包含 Latin-1 被误解为 UTF-8 的情况）
    // 常见特征：中文变成乱码如 "ä½ " 等
    const hasEncodingIssue = /[Ã¤Ã©Ã¨Ã¼Ã¶Ã¼Â°Ã§Â·Â¢]/.test(originalName)
    if (hasEncodingIssue) {
      // 将字符串当作 Latin-1 重新编码为 Buffer，再解码为 UTF-8
      originalName = Buffer.from(originalName, 'latin1').toString('utf8')
    }
    
    // 另一种情况：文件名本身就是正常的 UTF-8，直接使用即可

    // 调用 Python 脚本解析 shapefile (使用 exec 代替 execSync，避免缓冲区溢出)
    const pythonScript = path.join(__dirname, '../utils/shapefile_parser.py')

    // 使用 Promise 包装 exec
    const pythonResult = await new Promise((resolve, reject) => {
      exec(`python3 "${pythonScript}" "${filePath}"`, { 
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

    // 获取用户ID (从 header 或默认)
    const userId = req.headers['x-user-id'] || 1

    // 保存到数据库
    const db = getDb()
    const geojsonData = JSON.stringify(parseResult.data)

    // 插入数据
    const insertResult = db.prepare(
      `INSERT INTO shapefiles (name, geojson, field_names, feature_count, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`
    ).run(originalName, geojsonData, JSON.stringify(parseResult.data.metadata.fields), parseResult.data.features.length, userId)

    const insertId = insertResult.lastInsertRowid

    res.json({
      success: true,
      message: '上传成功',
      data: {
        id: insertId,
        name: originalName,
        featureCount: parseResult.data.features.length,
        fields: parseResult.data.metadata.fields
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

    // 返回当前用户 + 管理员(user_id=1) 的文件（去重）
    const rows = db.prepare(
      `SELECT id, name, field_names, feature_count, created_at, user_id
       FROM shapefiles
       WHERE user_id = ? OR user_id = 1
       ORDER BY created_at DESC`
    ).all(userId)

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

export default router
