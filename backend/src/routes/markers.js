import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// 获取所有门店（只看自己的数据）
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    
    // 每个用户只看自己的门店数据
    const markers = db.prepare(`
      SELECT * FROM markers WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.user.id)

    res.json({ markers })
  } catch (error) {
    console.error('获取门店列表错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 获取单个门店（只看自己的）
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const marker = db.prepare('SELECT * FROM markers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)

    if (!marker) {
      return res.status(404).json({ message: '门店不存在' })
    }

    res.json({ marker })
  } catch (error) {
    console.error('获取门店详情错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 创建门店
router.post('/', authenticate, (req, res) => {
  try {
    const {
      store_code, brand, name, store_type,
      city, district, area_manager, phone1, store_manager, phone2, address,
      open_date, business_hours, area, seats, rent,
      store_category, contact_person, contact_phone, description,
      latitude, longitude, status, icon_color
    } = req.body

    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: '门店名称和坐标不能为空' })
    }

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO markers (
        store_code, brand, name, store_type,
        city, district, area_manager, phone1, store_manager, phone2, address,
        open_date, business_hours, area, seats, rent,
        store_category, contact_person, contact_phone, description,
        latitude, longitude, status, icon_color, user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      store_code || '', brand || '', name, store_type || '社区店',
      city || '', district || '', area_manager || '', phone1 || '', store_manager || '', phone2 || '', address || '',
      open_date || '', business_hours || '', area || null, seats || null, rent || null,
      store_category || '', contact_person || '', contact_phone || '', description || '',
      latitude, longitude, status || '正常', icon_color || '#409eff', req.user.id
    )

    const marker = db.prepare('SELECT * FROM markers WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({
      message: '添加成功',
      marker
    })
  } catch (error) {
    console.error('创建门店错误:', error)
    res.status(500).json({ message: '添加失败' })
  }
})

// 更新门店
router.put('/:id', authenticate, (req, res) => {
  try {
    const {
      store_code, brand, name, store_type,
      city, district, area_manager, phone1, store_manager, phone2, address,
      open_date, business_hours, area, seats, rent,
      store_category, contact_person, contact_phone, description,
      latitude, longitude, status, icon_color
    } = req.body

    const db = getDb()

    // 检查门店是否存在且属于当前用户
    const existingMarker = db.prepare('SELECT * FROM markers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!existingMarker) {
      return res.status(404).json({ message: '门店不存在' })
    }

    db.prepare(`
      UPDATE markers SET
        store_code = ?, brand = ?, name = ?, store_type = ?,
        city = ?, district = ?, area_manager = ?, phone1 = ?, store_manager = ?, phone2 = ?, address = ?,
        open_date = ?, business_hours = ?, area = ?, seats = ?, rent = ?,
        store_category = ?, contact_person = ?, contact_phone = ?, description = ?,
        latitude = ?, longitude = ?, status = ?, icon_color = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      store_code ?? existingMarker.store_code,
      brand ?? existingMarker.brand,
      name ?? existingMarker.name,
      store_type ?? existingMarker.store_type,
      city ?? existingMarker.city,
      district ?? existingMarker.district,
      area_manager ?? existingMarker.area_manager,
      phone1 ?? existingMarker.phone1,
      store_manager ?? existingMarker.store_manager,
      phone2 ?? existingMarker.phone2,
      address ?? existingMarker.address,
      open_date ?? existingMarker.open_date,
      business_hours ?? existingMarker.business_hours,
      area ?? existingMarker.area,
      seats ?? existingMarker.seats,
      rent ?? existingMarker.rent,
      store_category ?? existingMarker.store_category,
      contact_person ?? existingMarker.contact_person,
      contact_phone ?? existingMarker.contact_phone,
      description ?? existingMarker.description,
      latitude ?? existingMarker.latitude,
      longitude ?? existingMarker.longitude,
      status ?? existingMarker.status,
      icon_color ?? existingMarker.icon_color,
      req.params.id
    )

    const marker = db.prepare('SELECT * FROM markers WHERE id = ?').get(req.params.id)

    res.json({
      message: '更新成功',
      marker
    })
  } catch (error) {
    console.error('更新门店错误:', error)
    res.status(500).json({ message: '更新失败' })
  }
})

// 删除门店
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()

    // 检查门店是否存在
    const existingMarker = db.prepare('SELECT * FROM markers WHERE id = ?').get(req.params.id)
    if (!existingMarker) {
      return res.status(404).json({ message: '门店不存在' })
    }

    // 普通用户只能删除自己的门店，管理员可以删除所有门店
    if (req.user.role !== 'admin' && existingMarker.user_id !== req.user.id) {
      return res.status(403).json({ message: '无权删除该门店' })
    }

    db.prepare('DELETE FROM markers WHERE id = ?').run(req.params.id)

    res.json({ message: '删除成功' })
  } catch (error) {
    console.error('删除门店错误:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

// 导入门店
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
            INSERT INTO markers (
              store_code, brand, name, store_type,
              city, district, area_manager, phone1, store_manager, phone2, address,
              open_date, business_hours, area, seats, rent,
              store_category, contact_person, contact_phone, description,
              latitude, longitude, status, icon_color, user_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `).run(
            row.store_code || '', row.brand || '', row.name, row.store_type || '社区店',
            row.city || '', row.district || '', row.area_manager || '', row.phone1 || '',
            row.store_manager || '', row.phone2 || '', row.address || '',
            row.open_date || '', row.business_hours || '',
            row.area ? parseFloat(row.area) : null,
            row.seats ? parseInt(row.seats) : null,
            row.rent ? parseFloat(row.rent) : null,
            row.store_category || '', row.contact_person || '', row.contact_phone || '', row.description || '',
            parseFloat(row.latitude), parseFloat(row.longitude),
            row.status || '正常',
            row.icon_color || '#409eff',
            req.user.id
          )

          const marker = db.prepare('SELECT * FROM markers WHERE id = ?').get(result.lastInsertRowid)
          imported.push(marker)
        }

        // 删除上传的文件
        fs.unlinkSync(req.file.path)

        res.json({
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

// 导出门店（按用户隔离）
router.get('/export', authenticate, (req, res) => {
  try {
    const db = getDb()
    const markers = db.prepare('SELECT * FROM markers WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)

    res.json(markers)
  } catch (error) {
    console.error('导出错误:', error)
    res.status(500).json({ message: '导出失败' })
  }
})

// 空间查询 - 获取范围内的门店
router.get('/query/bounds', authenticate, (req, res) => {
  try {
    const { north, south, east, west } = req.query

    if (!north || !south || !east || !west) {
      return res.status(400).json({ message: '请提供范围参数' })
    }

    const db = getDb()
    const markers = db.prepare(`
      SELECT * FROM markers
      WHERE user_id = ?
      AND latitude BETWEEN ? AND ?
      AND longitude BETWEEN ? AND ?
    `).all(req.user.id, south, north, west, east)

    res.json({ markers, count: markers.length })
  } catch (error) {
    console.error('空间查询错误:', error)
    res.status(500).json({ message: '查询失败' })
  }
})

export default router
