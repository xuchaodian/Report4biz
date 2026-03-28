import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { authenticate } from '../middleware/auth.js'
import { getDb } from '../models/database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 配置文件上传存储
const uploadDir = path.join(__dirname, '../../uploads/brand-icons')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    // 使用 brand_前缀 + 时间戳 + 原扩展名，避免文件名冲突
    const brand = req.body.brand || 'unknown'
    const safeBrand = brand.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')
    const ext = path.extname(file.originalname)
    cb(null, `${safeBrand}_${Date.now()}${ext}`)
  }
})

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|svg/
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
  const mimetype = allowedTypes.test(file.mimetype)
  if (extname && mimetype) {
    cb(null, true)
  } else {
    cb(new Error('只支持上传图片文件 (jpg, png, gif, webp, svg)'))
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 限制 2MB
})

const router = express.Router()

// 获取当前用户所有品牌图标
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const icons = db.prepare(`
      SELECT id, user_id, brand, filename, original_name, created_at
      FROM brand_icons
      WHERE user_id = ?
      ORDER BY brand ASC
    `).all(req.userId)

    res.json({ success: true, icons })
  } catch (error) {
    console.error('获取品牌图标失败:', error)
    res.status(500).json({ success: false, message: '获取品牌图标失败' })
  }
})

// 上传品牌图标（brand + 图片一起传）
router.post('/', authenticate, (req, res) => {
  upload.single('icon')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message })
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片文件' })
    }

    const { brand } = req.body
    if (!brand || !brand.trim()) {
      // 删除已上传的文件
      fs.unlinkSync(req.file.path)
      return res.status(400).json({ success: false, message: '请提供品牌名称' })
    }

    try {
      const db = getDb()

      // 检查是否已存在该品牌的图标，存在则替换
      const existing = db.prepare(`
        SELECT id, filename FROM brand_icons WHERE user_id = ? AND brand = ?
      `).get(req.userId, brand.trim())

      if (existing) {
        // 删除旧文件
        const oldPath = path.join(uploadDir, existing.filename)
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath)
        }
        // 更新记录
        db.prepare(`
          UPDATE brand_icons
          SET filename = ?, original_name = ?, created_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(req.file.filename, req.file.originalname, existing.id)

        const icon = db.prepare(`SELECT * FROM brand_icons WHERE id = ?`).get(existing.id)
        return res.json({ success: true, message: '图标已更新', icon })
      }

      // 插入新记录
      const result = db.prepare(`
        INSERT INTO brand_icons (user_id, brand, filename, original_name)
        VALUES (?, ?, ?, ?)
      `).run(req.userId, brand.trim(), req.file.filename, req.file.originalname)

      const icon = db.prepare(`SELECT * FROM brand_icons WHERE id = ?`).get(result.lastInsertRowid)
      res.json({ success: true, message: '图标上传成功', icon })
    } catch (error) {
      console.error('保存品牌图标失败:', error)
      // 清理上传的文件
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path)
      }
      res.status(500).json({ success: false, message: '保存失败' })
    }
  })
})

// 删除品牌图标
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const icon = db.prepare(`
      SELECT * FROM brand_icons WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId)

    if (!icon) {
      return res.status(404).json({ success: false, message: '图标不存在' })
    }

    // 删除文件
    const filePath = path.join(uploadDir, icon.filename)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除记录
    db.prepare(`DELETE FROM brand_icons WHERE id = ?`).run(icon.id)

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除品牌图标失败:', error)
    res.status(500).json({ success: false, message: '删除失败' })
  }
})

export default router
