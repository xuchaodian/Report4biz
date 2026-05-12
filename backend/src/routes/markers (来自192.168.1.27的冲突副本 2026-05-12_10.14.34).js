import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import { getDb, getRawDb, saveDatabase } from '../models/database.js'
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
      open_date, business_hours, area, seats, rent, frontage,
      store_category, contact_person, contact_phone, mall_type, trade_area_type, description,
      latitude, longitude, status, store_status, icon_color
    } = req.body

    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: '门店名称和坐标不能为空' })
    }

    // 兼容新旧字段名：如果新字段为空则用旧字段值
    const finalFrontage = frontage ?? rent ?? null
    const finalMallType = mall_type ?? contact_person ?? ''
    const finalTradeAreaType = trade_area_type ?? contact_phone ?? ''
    const finalStoreStatus = store_status ?? status ?? ''

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO markers (
        store_code, brand, name, store_type,
        city, district, area_manager, phone1, store_manager, phone2, address,
        open_date, business_hours, area, seats, rent, frontage,
        store_category, contact_person, contact_phone, mall_type, trade_area_type, description,
        latitude, longitude, status, store_status, icon_color, user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      store_code || '', brand || '', name, store_type || '已开业',
      city || '', district || '', area_manager || '', phone1 || '', store_manager || '', phone2 || '', address || '',
      open_date || '', business_hours || '', area || null, seats || null, finalFrontage,
      store_category || '', contact_person || '', contact_phone || '', finalMallType, finalTradeAreaType, description || '',
      latitude, longitude, status || '正常', finalStoreStatus, icon_color || '#409eff', req.user.id
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
      open_date, business_hours, area, seats, rent, frontage,
      store_category, contact_person, contact_phone, mall_type, trade_area_type, description,
      latitude, longitude, status, store_status, icon_color
    } = req.body

    const db = getDb()

    // 检查门店是否存在且属于当前用户
    const existingMarker = db.prepare('SELECT * FROM markers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!existingMarker) {
      return res.status(404).json({ message: '门店不存在' })
    }

    // 兼容新旧字段名
    const finalFrontage = frontage ?? rent ?? existingMarker.frontage
    const finalMallType = mall_type ?? contact_person ?? existingMarker.mall_type
    const finalTradeAreaType = trade_area_type ?? contact_phone ?? existingMarker.trade_area_type
    const finalStoreStatus = store_status ?? status ?? existingMarker.store_status

    db.prepare(`
      UPDATE markers SET
        store_code = ?, brand = ?, name = ?, store_type = ?,
        city = ?, district = ?, area_manager = ?, phone1 = ?, store_manager = ?, phone2 = ?, address = ?,
        open_date = ?, business_hours = ?, area = ?, seats = ?, rent = ?, frontage = ?,
        store_category = ?, contact_person = ?, contact_phone = ?, mall_type = ?, trade_area_type = ?, description = ?,
        latitude = ?, longitude = ?, status = ?, store_status = ?, icon_color = ?,
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
      finalFrontage, finalFrontage,
      store_category ?? existingMarker.store_category,
      contact_person ?? existingMarker.contact_person,
      contact_phone ?? existingMarker.contact_phone,
      finalMallType, finalTradeAreaType,
      description ?? existingMarker.description,
      latitude ?? existingMarker.latitude,
      longitude ?? existingMarker.longitude,
      status ?? existingMarker.status,
      finalStoreStatus,
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

// 清空所有门店（仅清除当前用户自己的数据）必须放在 /:id 之前
router.delete('/clear-all', authenticate, (req, res) => {
  try {
    const db = getDb()
    const result = db.prepare('DELETE FROM markers WHERE user_id = ?').run(req.user.id)
    res.json({ message: `已清空 ${result.changes} 条门店数据`, count: result.changes })
  } catch (error) {
    console.error('清空门店错误:', error)
    res.status(500).json({ message: '清空失败' })
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

// 批量删除门店
router.post('/batch-delete', authenticate, (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: '请提供要删除的ID列表' })
    }

    const db = getDb()
    const placeholders = ids.map(() => '?').join(',')

    // 普通用户只能删除自己的门店数据
    if (req.user.role !== 'admin') {
      db.prepare(`DELETE FROM markers WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.user.id)
    } else {
      db.prepare(`DELETE FROM markers WHERE id IN (${placeholders})`).run(...ids)
    }

    res.json({ message: '批量删除成功', count: ids.length })
  } catch (error) {
    console.error('批量删除门店错误:', error)
    res.status(500).json({ message: '批量删除失败' })
  }
})

// 导入门店
router.post('/import', authenticate, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请上传文件' })
    }

    // 自动识别编码：先尝试 UTF-8，若检测到乱码则改用 GBK
    let fileContent = fs.readFileSync(req.file.path, 'utf-8')
    // 去除 BOM
    if (fileContent.charCodeAt(0) === 0xFEFF) {
      fileContent = fileContent.slice(1)
    }
    const seemsGarbled = (fileContent.match(/\ufffd/g) || []).length >= 2
    if (seemsGarbled) {
      const buffer = fs.readFileSync(req.file.path)
      const iconv = require('iconv-lite')
      fileContent = iconv.decode(buffer, 'gbk')
      if (fileContent.charCodeAt(0) === 0xFEFF) {
        fileContent = fileContent.slice(1)
      }
    }

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rawDb = getRawDb()

        rawDb.run('BEGIN TRANSACTION')
        let count = 0

        try {
          // 调试：检查列名和首行
          if (results.data.length > 0) {
            const firstKeys = Object.keys(results.data[0])
            console.log('[导入] 列数:', firstKeys.length, '前5列:', JSON.stringify(firstKeys.slice(0, 5)))
            console.log('[导入] 首行name:', JSON.stringify(results.data[0].name))
            console.log('[导入] 首行lat/lng:', results.data[0].latitude, results.data[0].longitude)
          }

          const INSERT_SQL = `
            INSERT INTO markers (
              store_code, brand, name, store_type,
              city, district, area_manager, phone1, store_manager, phone2, address,
              open_date, business_hours, area, seats, rent, frontage,
              store_category, contact_person, contact_phone, mall_type, trade_area_type, description,
              latitude, longitude, status, store_status, icon_color, user_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `

          let totalRows = 0
          for (const row of results.data) {
            totalRows++
            const rowName = (row.name || '').trim()
            const rowLat = parseFloat(row.latitude)
            const rowLng = parseFloat(row.longitude)
            if (!rowName || isNaN(rowLat) || isNaN(rowLng)) continue
            try {
              rawDb.run(INSERT_SQL, [
                row.store_code || '', row.brand || '', rowName, row.store_type || '已开业',
                row.city || '', row.district || '', row.area_manager || '', row.phone1 || '',
                row.store_manager || '', row.phone2 || '', row.address || '',
                row.open_date || '', row.business_hours || '',
                row.store_area || row.area ? parseFloat(row.store_area || row.area) : null,
                row.seats ? parseInt(row.seats) : null,
                row.frontage || row.rent ? parseFloat(row.frontage || row.rent) : null,
                row.frontage || row.rent ? parseFloat(row.frontage || row.rent) : null,
                row.store_category || '',
                row.mall_type || row.contact_person || '',
                row.trade_area_type || row.contact_phone || '',
                row.mall_type || row.contact_person || '',
                row.trade_area_type || row.contact_phone || '',
                row.description || '',
                rowLat, rowLng,
                row.store_status || row.status || '正常',
                row.store_status || row.status || '',
                row.icon_color || '#409eff',
                req.user.id
              ])
              count++
            } catch (rowErr) {
              console.warn('[导入] 跳过第' + (totalRows + 1) + '行:', rowErr.message)
            }
          }
          rawDb.run('COMMIT')
          saveDatabase()
        } catch (txErr) {
          rawDb.run('ROLLBACK')
          console.error('导入事务错误:', txErr)
          // 清理文件
          try { fs.unlinkSync(req.file.path) } catch (e) {}
          return res.status(500).json({ message: '导入失败: ' + txErr.message })
        }

        // 删除上传的文件
        try { fs.unlinkSync(req.file.path) } catch (e) {}

        res.json({
          message: `成功导入 ${count} 条数据`,
          count
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
