import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { authenticate } from '../middleware/auth.js'
import { getDb } from '../models/database.js'
import { groupOwnerUserId, tagIconSource, sortByPrecedence } from '../utils/brandIconScope.js'

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

// 获取品牌图标（自己的 + **集团总部继承的** + 管理员上传的共享图标）
//
// v1.13.191：非 admin 多一路 —— 所属集团总部账号上传的图标（读时继承，零复制）。
//   详见 utils/brandIconScope.js 文件头。每行回带 `source`（'self'|'group'|'admin'），
//   并按「我 > 集团 > admin」定序 ⇒ **同品牌并列时列表首条＝实际生效的那条**。
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const userId = req.user.id
    const isAdmin = req.user.role === 'admin'

    // admin 视角维持原样（看全部），刻意不参与集团继承 —— 它是平台侧，不属于任何集团
    const groupOwnerId = isAdmin ? null : groupOwnerUserId(db, userId)

    let rows
    if (isAdmin) {
      // 管理员：看到所有图标
      rows = db.prepare(`
        SELECT id, brand, filename, original_name, created_at, user_id
        FROM brand_icons
        ORDER BY brand ASC, id ASC
      `).all()
    } else {
      // 普通用户：看到自己上传的 + 所有管理员上传的
      rows = db.prepare(`
        SELECT id, brand, filename, original_name, created_at, user_id
        FROM brand_icons
        WHERE user_id = ? OR user_id IN (SELECT id FROM users WHERE role = 'admin')
        ORDER BY brand ASC, id ASC
      `).all(userId)

      // v1.13.191：再加上「集团总部账号上传的」。无集团 / 总部自身 / 已解散 ⇒ groupOwnerId=null，跳过
      if (groupOwnerId) {
        rows = rows.concat(
          db.prepare(`
            SELECT id, brand, filename, original_name, created_at, user_id
            FROM brand_icons
            WHERE user_id = ?
            ORDER BY brand ASC, id ASC
          `).all(groupOwnerId)
        )
      }
    }

    // 标来源 + 定序（纯读；不写任何一行）
    const icons = sortByPrecedence(
      rows.map(row => ({ ...row, source: tagIconSource(row, userId, groupOwnerId) }))
    )

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

      // 每个用户的品牌图标相互独立
      // 管理员上传的图标对所有用户可见，普通用户上传的仅自己可见
      const existing = db.prepare(`
        SELECT id, filename, user_id FROM brand_icons WHERE brand = ? AND user_id = ?
      `).get(brand.trim(), userId)

      if (existing) {
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
        // v1.13.191：回包也带 source —— 前端 store 用它做「我 > 集团 > admin」定序，
        // 少这个字段刚上传的图标会被排到低优先级（见 utils/brandIcons.js 的兜底）
        return res.json({ success: true, message: '图标已更新', icon: { ...icon, source: 'self' } })
      }

      // 插入新记录
      const result = db.prepare(`
        INSERT INTO brand_icons (brand, filename, original_name, user_id)
        VALUES (?, ?, ?, ?)
      `).run(brand.trim(), req.file.filename, req.file.originalname, userId)

      const icon = db.prepare(`SELECT * FROM brand_icons WHERE id = ?`).get(result.lastInsertRowid)
      res.json({ success: true, message: '图标上传成功', icon: { ...icon, source: 'self' } })
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
