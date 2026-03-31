import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// 获取所有购物中心
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const shoppingCenters = db.prepare(`
      SELECT * FROM shopping_centers ORDER BY created_at DESC
    `).all()

    res.json({ shoppingCenters })
  } catch (error) {
    console.error('获取购物中心列表错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 获取单个购物中心
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const shoppingCenter = db.prepare('SELECT * FROM shopping_centers WHERE id = ?').get(req.params.id)

    if (!shoppingCenter) {
      return res.status(404).json({ message: '购物中心不存在' })
    }

    res.json({ shoppingCenter })
  } catch (error) {
    console.error('获取购物中心详情错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 创建购物中心（仅管理员）
router.post('/', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可添加购物中心' })
    }

    const {
      store_code, name, store_category,
      city, district, address,
      rank_info, comments, stars,
      latitude, longitude, status, icon_color
    } = req.body

    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: '名称和坐标不能为空' })
    }

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO shopping_centers (
        user_id, store_code, name, store_category,
        city, district, address,
        rank_info, comments, stars,
        latitude, longitude, status, icon_color,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      req.user.id,
      store_code || '', name, store_category || '',
      city || '', district || '', address || '',
      rank_info || '',
      comments !== undefined ? parseInt(comments) || 0 : 0,
      stars !== undefined ? parseFloat(stars) || 0 : 0,
      latitude, longitude, status || '正常', icon_color || '#67c23a'
    )

    const shoppingCenter = db.prepare('SELECT * FROM shopping_centers WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({
      success: true,
      message: '添加成功',
      shoppingCenter
    })
  } catch (error) {
    console.error('创建购物中心错误:', error)
    res.status(500).json({ message: '添加失败' })
  }
})

// 更新购物中心（仅管理员）
router.put('/:id', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可编辑购物中心' })
    }

    const {
      store_code, name, store_category,
      city, district, address,
      rank_info, comments, stars,
      latitude, longitude, status, icon_color
    } = req.body

    const db = getDb()

    const existing = db.prepare('SELECT * FROM shopping_centers WHERE id = ?').get(req.params.id)
    if (!existing) {
      return res.status(404).json({ success: false, message: '购物中心不存在' })
    }

    db.prepare(`
      UPDATE shopping_centers SET
        store_code = ?, name = ?, store_category = ?,
        city = ?, district = ?, address = ?,
        rank_info = ?, comments = ?, stars = ?,
        latitude = ?, longitude = ?, status = ?, icon_color = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      store_code ?? existing.store_code,
      name ?? existing.name,
      store_category ?? existing.store_category,
      city ?? existing.city,
      district ?? existing.district,
      address ?? existing.address,
      rank_info ?? existing.rank_info,
      comments !== undefined ? parseInt(comments) || 0 : existing.comments,
      stars !== undefined ? parseFloat(stars) || 0 : existing.stars,
      latitude ?? existing.latitude,
      longitude ?? existing.longitude,
      status ?? existing.status,
      icon_color ?? existing.icon_color,
      req.params.id
    )

    const shoppingCenter = db.prepare('SELECT * FROM shopping_centers WHERE id = ?').get(req.params.id)

    res.json({
      success: true,
      message: '更新成功',
      shoppingCenter
    })
  } catch (error) {
    console.error('更新购物中心错误:', error)
    res.status(500).json({ message: '更新失败' })
  }
})

// 删除购物中心（仅管理员）
router.delete('/:id', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可删除购物中心' })
    }

    const db = getDb()

    const existing = db.prepare('SELECT * FROM shopping_centers WHERE id = ?').get(req.params.id)
    if (!existing) {
      return res.status(404).json({ success: false, message: '购物中心不存在' })
    }

    db.prepare('DELETE FROM shopping_centers WHERE id = ?').run(req.params.id)

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除购物中心错误:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

// 批量删除（仅管理员）
router.post('/batch-delete', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可批量删除购物中心' })
    }

    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '请提供要删除的ID列表' })
    }

    const db = getDb()
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM shopping_centers WHERE id IN (${placeholders})`).run(...ids)

    res.json({ success: true, message: '批量删除成功', count: ids.length })
  } catch (error) {
    console.error('批量删除购物中心错误:', error)
    res.status(500).json({ message: '批量删除失败' })
  }
})

// 清空所有（仅管理员）
router.delete('/clear-all', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可清空购物中心' })
    }
    const db = getDb()
    const result = db.prepare('DELETE FROM shopping_centers').run()
    res.json({ success: true, message: `已清空 ${result.changes} 条购物中心数据`, count: result.changes })
  } catch (error) {
    console.error('清空购物中心错误:', error)
    res.status(500).json({ message: '清空失败' })
  }
})

// 导入（仅管理员）
router.post('/import', authenticate, upload.single('file'), (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可导入购物中心' })
    }

    if (!req.file) {
      return res.status(400).json({ message: '请上传文件' })
    }

    const fileContent = fs.readFileSync(req.file.path, 'utf-8')

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const db = getDb()
        const imported = []

        for (const row of results.data) {
          if (!row.name || !row.latitude || !row.longitude) continue

          const result = db.prepare(`
            INSERT INTO shopping_centers (
              user_id, store_code, name, store_category,
              city, district, address,
              rank_info, comments, stars,
              latitude, longitude, status, icon_color,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `).run(
            req.user.id,
            row.store_code || '', row.name, row.store_category || '',
            row.city || '', row.district || '', row.address || '',
            row.rank_info || '',
            parseInt(row.comments) || 0,
            parseFloat(row.stars) || 0,
            parseFloat(row.latitude), parseFloat(row.longitude),
            row.status || '正常',
            row.icon_color || '#67c23a'
          )

          const shoppingCenter = db.prepare('SELECT * FROM shopping_centers WHERE id = ?').get(result.lastInsertRowid)
          imported.push(shoppingCenter)
        }

        fs.unlinkSync(req.file.path)

        res.json({
          success: true,
          message: `成功导入 ${imported.length} 条数据`,
          count: imported.length,
          imported
        })
      }
    })
  } catch (error) {
    console.error('导入错误:', error)
    res.status(500).json({ message: '导入失败' })
  }
})

// 导出（仅管理员）
router.get('/export', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可导出购物中心' })
    }

    const db = getDb()
    const shoppingCenters = db.prepare('SELECT * FROM shopping_centers ORDER BY created_at DESC').all()

    res.json({ success: true, data: shoppingCenters })
  } catch (error) {
    console.error('导出错误:', error)
    res.status(500).json({ message: '导出失败' })
  }
})

export default router
