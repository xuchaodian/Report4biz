import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// 获取所有竞品门店（只看自己的数据）
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    
    // 每个用户只看自己的竞品门店数据
    const competitors = db.prepare(`
      SELECT * FROM competitors WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.user.id)

    res.json({ competitors })
  } catch (error) {
    console.error('获取竞品列表错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 获取单个竞品门店（只看自己的）
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const competitor = db.prepare('SELECT * FROM competitors WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)

    if (!competitor) {
      return res.status(404).json({ message: '竞品门店不存在' })
    }

    res.json({ competitor })
  } catch (error) {
    console.error('获取竞品详情错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 创建竞品门店
router.post('/', authenticate, (req, res) => {
  try {
    const {
      store_code, brand, name, store_type, store_category,
      city, district, address,
      description,
      latitude, longitude, status, icon_color
    } = req.body

    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: '门店名称和坐标不能为空' })
    }

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO competitors (
        store_code, brand, name, store_type, store_category,
        city, district, address,
        description,
        latitude, longitude, status, icon_color, user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      store_code || '', brand || '', name, store_type || '竞品', store_category || '',
      city || '', district || '', address || '',
      description || '',
      latitude, longitude, status || '正常', icon_color || '#f56c6c', req.user.id
    )

    const competitor = db.prepare('SELECT * FROM competitors WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({
      message: '添加成功',
      competitor
    })
  } catch (error) {
    console.error('创建竞品错误:', error)
    res.status(500).json({ message: '添加失败' })
  }
})

// 更新竞品门店
router.put('/:id', authenticate, (req, res) => {
  try {
    const {
      store_code, brand, name, store_type, store_category,
      city, district, address,
      description,
      latitude, longitude, status, icon_color
    } = req.body

    const db = getDb()

    // 检查竞品门店是否存在且属于当前用户
    const existingCompetitor = db.prepare('SELECT * FROM competitors WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!existingCompetitor) {
      return res.status(404).json({ message: '竞品门店不存在' })
    }

    db.prepare(`
      UPDATE competitors SET
        store_code = ?, brand = ?, name = ?, store_type = ?, store_category = ?,
        city = ?, district = ?, address = ?,
        description = ?,
        latitude = ?, longitude = ?, status = ?, icon_color = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      store_code ?? existingCompetitor.store_code,
      brand ?? existingCompetitor.brand,
      name ?? existingCompetitor.name,
      store_type ?? existingCompetitor.store_type,
      store_category ?? existingCompetitor.store_category,
      city ?? existingCompetitor.city,
      district ?? existingCompetitor.district,
      address ?? existingCompetitor.address,
      description ?? existingCompetitor.description,
      latitude ?? existingCompetitor.latitude,
      longitude ?? existingCompetitor.longitude,
      status ?? existingCompetitor.status,
      icon_color ?? existingCompetitor.icon_color,
      req.params.id
    )

    const competitor = db.prepare('SELECT * FROM competitors WHERE id = ?').get(req.params.id)

    res.json({
      message: '更新成功',
      competitor
    })
  } catch (error) {
    console.error('更新竞品错误:', error)
    res.status(500).json({ message: '更新失败' })
  }
})

// 删除竞品门店
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()

    // 检查竞品门店是否存在
    const existingCompetitor = db.prepare('SELECT * FROM competitors WHERE id = ?').get(req.params.id)
    if (!existingCompetitor) {
      return res.status(404).json({ message: '竞品门店不存在' })
    }

    // 普通用户只能删除自己的竞品门店，管理员可以删除所有竞品门店
    if (req.user.role !== 'admin' && existingCompetitor.user_id !== req.user.id) {
      return res.status(403).json({ message: '无权删除该竞品门店' })
    }

    db.prepare('DELETE FROM competitors WHERE id = ?').run(req.params.id)

    res.json({ message: '删除成功' })
  } catch (error) {
    console.error('删除竞品错误:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

// 批量删除竞品门店
router.post('/batch-delete', authenticate, (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: '请提供要删除的ID列表' })
    }

    const db = getDb()
    const placeholders = ids.map(() => '?').join(',')

    // 普通用户只能删除自己的竞品门店数据
    if (req.user.role !== 'admin') {
      db.prepare(`DELETE FROM competitors WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.user.id)
    } else {
      db.prepare(`DELETE FROM competitors WHERE id IN (${placeholders})`).run(...ids)
    }

    res.json({ message: '批量删除成功', count: ids.length })
  } catch (error) {
    console.error('批量删除竞品错误:', error)
    res.status(500).json({ message: '批量删除失败' })
  }
})

// 导入竞品门店
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
            INSERT INTO competitors (
              store_code, brand, name, store_type, store_category,
              city, district, address,
              description,
              latitude, longitude, status, icon_color, user_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `).run(
            row.store_code || '', row.brand || '', row.name, row.store_type || '竞品', row.store_category || '',
            row.city || '', row.district || '', row.address || '',
            row.description || '',
            parseFloat(row.latitude), parseFloat(row.longitude),
            row.status || '正常',
            row.icon_color || '#f56c6c',
            req.user.id
          )

          const competitor = db.prepare('SELECT * FROM competitors WHERE id = ?').get(result.lastInsertRowid)
          imported.push(competitor)
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

// 导出竞品门店（按用户隔离）
router.get('/export', authenticate, (req, res) => {
  try {
    const db = getDb()
    const competitors = db.prepare('SELECT * FROM competitors WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)

    res.json(competitors)
  } catch (error) {
    console.error('导出错误:', error)
    res.status(500).json({ message: '导出失败' })
  }
})

// 空间查询 - 获取范围内的竞品门店
router.get('/query/bounds', authenticate, (req, res) => {
  try {
    const { north, south, east, west } = req.query

    if (!north || !south || !east || !west) {
      return res.status(400).json({ message: '请提供范围参数' })
    }

    const db = getDb()
    const competitors = db.prepare(`
      SELECT * FROM competitors
      WHERE user_id = ?
      AND latitude BETWEEN ? AND ?
      AND longitude BETWEEN ? AND ?
    `).all(req.user.id, south, north, west, east)

    res.json({ competitors, count: competitors.length })
  } catch (error) {
    console.error('空间查询错误:', error)
    res.status(500).json({ message: '查询失败' })
  }
})

export default router
