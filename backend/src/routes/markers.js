import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// 获取所有点位
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const markers = db.prepare(`
      SELECT id, name, category, latitude, longitude, description, status, icon_color, created_at, updated_at
      FROM markers
      ORDER BY created_at DESC
    `).all()

    res.json({ markers })
  } catch (error) {
    console.error('获取点位列表错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 获取单个点位
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const marker = db.prepare('SELECT * FROM markers WHERE id = ?').get(req.params.id)

    if (!marker) {
      return res.status(404).json({ message: '点位不存在' })
    }

    res.json({ marker })
  } catch (error) {
    console.error('获取点位详情错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 创建点位
router.post('/', authenticate, (req, res) => {
  try {
    const { name, category, latitude, longitude, description, status, icon_color } = req.body

    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: '名称和坐标不能为空' })
    }

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO markers (name, category, latitude, longitude, description, status, icon_color, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      category || '门店',
      latitude,
      longitude,
      description || '',
      status || '正常',
      icon_color || '#409eff',
      req.user.id
    )

    const marker = db.prepare('SELECT * FROM markers WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({
      message: '添加成功',
      marker
    })
  } catch (error) {
    console.error('创建点位错误:', error)
    res.status(500).json({ message: '添加失败' })
  }
})

// 更新点位
router.put('/:id', authenticate, (req, res) => {
  try {
    const { name, category, latitude, longitude, description, status, icon_color } = req.body

    const db = getDb()

    // 检查点位是否存在
    const existingMarker = db.prepare('SELECT * FROM markers WHERE id = ?').get(req.params.id)
    if (!existingMarker) {
      return res.status(404).json({ message: '点位不存在' })
    }

    db.prepare(`
      UPDATE markers
      SET name = ?, category = ?, latitude = ?, longitude = ?, description = ?, status = ?, icon_color = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ?? existingMarker.name,
      category ?? existingMarker.category,
      latitude ?? existingMarker.latitude,
      longitude ?? existingMarker.longitude,
      description ?? existingMarker.description,
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
    console.error('更新点位错误:', error)
    res.status(500).json({ message: '更新失败' })
  }
})

// 删除点位
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()

    const existingMarker = db.prepare('SELECT * FROM markers WHERE id = ?').get(req.params.id)
    if (!existingMarker) {
      return res.status(404).json({ message: '点位不存在' })
    }

    db.prepare('DELETE FROM markers WHERE id = ?').run(req.params.id)

    res.json({ message: '删除成功' })
  } catch (error) {
    console.error('删除点位错误:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

// 导入点位
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
            INSERT INTO markers (name, category, latitude, longitude, description, status, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            row.name,
            row.category || '门店',
            parseFloat(row.latitude),
            parseFloat(row.longitude),
            row.description || '',
            row.status || '正常',
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

// 导出点位
router.get('/export', authenticate, (req, res) => {
  try {
    const db = getDb()
    const markers = db.prepare('SELECT * FROM markers ORDER BY created_at DESC').all()

    res.json(markers)
  } catch (error) {
    console.error('导出错误:', error)
    res.status(500).json({ message: '导出失败' })
  }
})

// 空间查询 - 获取范围内的点位
router.get('/query/bounds', authenticate, (req, res) => {
  try {
    const { north, south, east, west } = req.query

    if (!north || !south || !east || !west) {
      return res.status(400).json({ message: '请提供范围参数' })
    }

    const db = getDb()
    const markers = db.prepare(`
      SELECT * FROM markers
      WHERE latitude BETWEEN ? AND ?
      AND longitude BETWEEN ? AND ?
    `).all(south, north, west, east)

    res.json({ markers, count: markers.length })
  } catch (error) {
    console.error('空间查询错误:', error)
    res.status(500).json({ message: '查询失败' })
  }
})

export default router
