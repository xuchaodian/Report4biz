import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { execSync } from 'child_process'
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
    const originalName = req.file.originalname

    // 调用 Python 脚本解析 shapefile
    const pythonScript = path.join(__dirname, '../utils/shapefile_parser.py')
    const pythonResult = execSync(`python3 "${pythonScript}" "${filePath}"`, { encoding: 'utf-8' })
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

export default router
