import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { exec } from 'child_process'
import { getDb } from '../models/database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const router = express.Router()

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

// 上传并解析 Shapefile (ZIP格式)
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
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

// 获取用户的所有 Shapefile
router.get('/', (req, res) => {
  try {
    const db = getDb()
    const userId = req.headers['x-user-id'] || 1

    const rows = db.prepare(
      `SELECT id, name, field_names, feature_count, created_at FROM shapefiles WHERE user_id = ? ORDER BY created_at DESC`
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

// 获取单个 Shapefile 的 GeoJSON 数据
router.get('/:id', (req, res) => {
  try {
    const db = getDb()
    const id = req.params.id
    const userId = req.headers['x-user-id'] || 1

    const row = db.prepare(
      `SELECT id, name, geojson, field_names, feature_count FROM shapefiles WHERE id = ? AND user_id = ?`
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

    // 获取 Shapefile 数据
    const row = db.prepare(
      `SELECT id, name, geojson, field_names FROM shapefiles WHERE id = ? AND user_id = ?`
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
      `SELECT id, name, geojson, field_names FROM shapefiles WHERE id = ? AND user_id = ?`
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

export default router
