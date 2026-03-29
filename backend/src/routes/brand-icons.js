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

// 获取品牌图标（用户自己的 + 管理员上传的共享图标）
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const userId = req.user.id
    const isAdmin = req.user.role === 'admin'

    let icons
    if (isAdmin) {
      // 管理员：看到所有图标
      icons = db.prepare(`
        SELECT id, brand, filename, original_name, created_at, user_id
        FROM brand_icons
        ORDER BY brand ASC
      `).all()
    } else {
      // 普通用户：看到自己上传的 + 所有管理员上传的
      icons = db.prepare(`
        SELECT id, brand, filename, original_name, created_at, user_id
        FROM brand_icons
        WHERE user_id = ? OR user_id IN (SELECT id FROM users WHERE role = 'admin')
        ORDER BY brand ASC
      `).all(userId)
    }

    res.json({ success: true, icons })
  } catch (error) {
    console.error('获取品牌图标失败:', error)
    res.status(500).json({ success: false, message: '获取品牌图标失败' })
  }
})

// 上传品牌图标（brand + 图片一起传）
// 普通用户只能上传自己门店和竞品门店的品牌，管理员可以上传所有品牌
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
      const userId = req.user.id
      const isAdmin = req.user.role === 'admin'

      // 普通用户只能上传自己门店、竞品门店或品牌门店的品牌
      if (!isAdmin) {
        const markerBrands = db.prepare(`
          SELECT DISTINCT brand FROM markers WHERE user_id = ? AND brand = ?
        `).get(userId, brand.trim())
        // 竞品门店是共享数据
        const competitorBrands = db.prepare(`
          SELECT DISTINCT brand FROM competitors WHERE brand = ?
        `).get(brand.trim())
        // 品牌门店也是共享数据
        const brandStoreBrands = db.prepare(`
          SELECT DISTINCT brand FROM brand_stores WHERE brand = ?
        `).get(brand.trim())

        if (!markerBrands && !competitorBrands && !brandStoreBrands) {
          fs.unlinkSync(req.file.path)
          return res.status(403).json({ success: false, message: '只能上传自己门店、竞品门店或品牌门店的品牌图标' })
        }
      }

      // 检查是否已存在该品牌且是当前用户上传的图标，存在则替换
      const existing = db.prepare(`
        SELECT id, filename, user_id FROM brand_icons WHERE brand = ?
      `).get(brand.trim())

      if (existing) {
        // 如果已存在的图标不是当前用户上传的，普通用户不能替换
        if (!isAdmin && existing.user_id !== userId) {
          fs.unlinkSync(req.file.path)
          return res.status(403).json({ success: false, message: '该品牌图标由管理员设置，您无法替换' })
        }
        
        // 删除旧文件
        const oldPath = path.join(uploadDir, existing.filename)
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath)
        }
        // 更新记录
        db.prepare(`
          UPDATE brand_icons
          SET filename = ?, original_name = ?, user_id = ?, created_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(req.file.filename, req.file.originalname, userId, existing.id)

        const icon = db.prepare(`SELECT * FROM brand_icons WHERE id = ?`).get(existing.id)
        return res.json({ success: true, message: '图标已更新', icon })
      }

      // 插入新记录
      const result = db.prepare(`
        INSERT INTO brand_icons (brand, filename, original_name, user_id)
        VALUES (?, ?, ?, ?)
      `).run(brand.trim(), req.file.filename, req.file.originalname, userId)

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

// 删除品牌图标（普通用户只能删除自己上传的，管理员可以删除所有）
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const userId = req.user.id
    const isAdmin = req.user.role === 'admin'

    const icon = db.prepare(`
      SELECT * FROM brand_icons WHERE id = ?
    `).get(req.params.id)

    if (!icon) {
      return res.status(404).json({ success: false, message: '图标不存在' })
    }

    // 权限检查：普通用户只能删除自己上传的
    if (!isAdmin && icon.user_id !== userId) {
      return res.status(403).json({ success: false, message: '只能删除自己上传的图标' })
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
