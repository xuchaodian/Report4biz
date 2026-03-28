import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// 获取所有品牌门店
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const brandStores = db.prepare(`
      SELECT * FROM brand_stores WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.user.id)

    res.json({ brandStores })
  } catch (error) {
    console.error('获取品牌门店列表错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 获取单个品牌门店
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const brandStore = db.prepare('SELECT * FROM brand_stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)

    if (!brandStore) {
      return res.status(404).json({ message: '品牌门店不存在' })
    }

    res.json({ brandStore })
  } catch (error) {
    console.error('获取品牌门店详情错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 创建品牌门店
router.post('/', authenticate, (req, res) => {
  try {
    const {
      store_code, brand, name, store_type,
      city, district, address,
      contact_person, contact_phone, description,
      latitude, longitude, status, icon_color
    } = req.body

    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: '门店名称和坐标不能为空' })
    }

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO brand_stores (
        store_code, brand, name, store_type,
        city, district, address,
        contact_person, contact_phone, description,
        latitude, longitude, status, icon_color, user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      store_code || '', brand || '', name, store_type || '品牌',
      city || '', district || '', address || '',
      contact_person || '', contact_phone || '', description || '',
      latitude, longitude, status || '正常', icon_color || '#409eff', req.user.id
    )

    const brandStore = db.prepare('SELECT * FROM brand_stores WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({
      success: true,
      message: '添加成功',
      brandStore
    })
  } catch (error) {
    console.error('创建品牌门店错误:', error)
    res.status(500).json({ message: '添加失败' })
  }
})

// 更新品牌门店
router.put('/:id', authenticate, (req, res) => {
  try {
    const {
      store_code, brand, name, store_type,
      city, district, address,
      contact_person, contact_phone, description,
      latitude, longitude, status, icon_color
    } = req.body

    const db = getDb()

    const existing = db.prepare('SELECT * FROM brand_stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!existing) {
      return res.status(404).json({ success: false, message: '品牌门店不存在' })
    }

    db.prepare(`
      UPDATE brand_stores SET
        store_code = ?, brand = ?, name = ?, store_type = ?,
        city = ?, district = ?, address = ?,
        contact_person = ?, contact_phone = ?, description = ?,
        latitude = ?, longitude = ?, status = ?, icon_color = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      store_code ?? existing.store_code,
      brand ?? existing.brand,
      name ?? existing.name,
      store_type ?? existing.store_type,
      city ?? existing.city,
      district ?? existing.district,
      address ?? existing.address,
      contact_person ?? existing.contact_person,
      contact_phone ?? existing.contact_phone,
      description ?? existing.description,
      latitude ?? existing.latitude,
      longitude ?? existing.longitude,
      status ?? existing.status,
      icon_color ?? existing.icon_color,
      req.params.id
    )

    const brandStore = db.prepare('SELECT * FROM brand_stores WHERE id = ?').get(req.params.id)

    res.json({
      success: true,
      message: '更新成功',
      brandStore
    })
  } catch (error) {
    console.error('更新品牌门店错误:', error)
    res.status(500).json({ message: '更新失败' })
  }
})

// 删除品牌门店
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()

    const existing = db.prepare('SELECT * FROM brand_stores WHERE id = ?').get(req.params.id)
    if (!existing) {
      return res.status(404).json({ success: false, message: '品牌门店不存在' })
    }

    if (req.user.role !== 'admin' && existing.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权删除' })
    }

    db.prepare('DELETE FROM brand_stores WHERE id = ?').run(req.params.id)

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除品牌门店错误:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

// 导入品牌门店
router.post('/import', authenticate, upload.single('file'), (req, res) => {
  try {
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
            INSERT INTO brand_stores (
              store_code, brand, name, store_type,
              city, district, address,
              contact_person, contact_phone, description,
              latitude, longitude, status, icon_color, user_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `).run(
            row.store_code || '', row.brand || '', row.name, row.store_type || '品牌',
            row.city || '', row.district || '', row.address || '',
            row.contact_person || '', row.contact_phone || '', row.description || '',
            parseFloat(row.latitude), parseFloat(row.longitude),
            row.status || '正常',
            row.icon_color || '#409eff',
            req.user.id
          )

          const brandStore = db.prepare('SELECT * FROM brand_stores WHERE id = ?').get(result.lastInsertRowid)
          imported.push(brandStore)
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

// 导出品牌门店
router.get('/export', authenticate, (req, res) => {
  try {
    const db = getDb()
    const brandStores = db.prepare('SELECT * FROM brand_stores WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)

    res.json({ success: true, data: brandStores })
  } catch (error) {
    console.error('导出错误:', error)
    res.status(500).json({ message: '导出失败' })
  }
})

export default router
