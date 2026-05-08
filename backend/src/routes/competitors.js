import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import ExcelJS from 'exceljs'

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
      latitude, longitude, status, icon_color,
      industry, price, rating, reviews, taste_score, environment_score, service_score
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
        industry, price, rating, reviews, taste_score, environment_score, service_score,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      store_code || '', brand || '', name, store_type || '竞品', store_category || '',
      city || '', district || '', address || '',
      description || '',
      latitude, longitude, status || '正常', icon_color || '#f56c6c', req.user.id,
      industry || '', price || 0, rating || 0, reviews || 0, taste_score || 0, environment_score || 0, service_score || 0
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
      latitude, longitude, status, icon_color,
      industry, price, rating, reviews, taste_score, environment_score, service_score
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
        industry = ?, price = ?, rating = ?, reviews = ?, taste_score = ?, environment_score = ?, service_score = ?,
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
      industry ?? existingCompetitor.industry,
      price ?? existingCompetitor.price,
      rating ?? existingCompetitor.rating,
      reviews ?? existingCompetitor.reviews,
      taste_score ?? existingCompetitor.taste_score,
      environment_score ?? existingCompetitor.environment_score,
      service_score ?? existingCompetitor.service_score,
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

// 清空所有竞品门店（普通用户清除自己的，管理员清除所有）
// 注意：clear-all 必须放在 /:id 之前，否则会被当作id参数
router.delete('/clear-all', authenticate, (req, res) => {
  try {
    const db = getDb()
    let result
    if (req.user.role === 'admin') {
      result = db.prepare('DELETE FROM competitors').run()
    } else {
      result = db.prepare('DELETE FROM competitors WHERE user_id = ?').run(req.user.id)
    }
    res.json({ message: `已清空 ${result.changes} 条竞品数据`, count: result.changes })
  } catch (error) {
    console.error('清空竞品错误:', error)
    res.status(500).json({ message: '清空失败' })
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
        try {
          const db = getDb()
          let importCount = 0

          // 预编译INSERT语句
          const insertStmt = db.prepare(`
            INSERT INTO competitors (
              store_code, brand, name, store_type, store_category,
              city, district, address,
              description,
              latitude, longitude, status, icon_color, user_id,
              industry, price, rating, reviews, taste_score, environment_score, service_score,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `)

          // 使用 runNoSave 避免每行都写盘，末尾一次性保存
          let errorRow = null
          for (const row of results.data) {
            if (!row.name || !row.latitude || !row.longitude) continue
            try {
              insertStmt.runNoSave(
                row.store_code || '', row.brand || '', row.name, row.store_type || '竞品', row.store_category || '',
                row.city || '', row.district || '', row.address || '',
                row.description || '',
                parseFloat(row.latitude), parseFloat(row.longitude),
                row.status || '正常',
                row.icon_color || '#f56c6c',
                req.user.id,
                row.industry || '', parseFloat(row.price) || 0, parseFloat(row.rating) || 0,
                parseInt(row.reviews) || 0, parseFloat(row.taste_score) || 0,
                parseFloat(row.environment_score) || 0, parseFloat(row.service_score) || 0
              )
              importCount++
            } catch (rowError) {
              errorRow = { index: importCount, name: row.name, error: rowError.message }
              console.error('导入单行失败:', errorRow)
            }
          }
          // 一次性保存数据库到磁盘
          db.saveDatabase()

          // 删除上传的文件
          try { fs.unlinkSync(req.file.path) } catch (e) {}

          // 只返回数量，不返回完整数据（大数据量时序列化可能超时）
          res.json({
            message: `成功导入 ${importCount} 条数据${errorRow ? '（部分行失败）' : ''}`,
            count: importCount
          })
        } catch (innerError) {
          console.error('导入处理错误:', innerError)
          try { fs.unlinkSync(req.file.path) } catch (e) {}
          return res.status(500).json({ message: '导入失败: ' + innerError.message })
        }
      },
      error: (parseError) => {
        console.error('CSV解析错误:', parseError)
        try { fs.unlinkSync(req.file.path) } catch (e) {}
        return res.status(500).json({ message: 'CSV解析失败: ' + parseError.message })
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

// 导出竞品地图Excel（含地图截图）
router.post('/export-map-excel', authenticate, async (req, res) => {
  try {
    const { screenshot, center, radius, myStores, competitors } = req.body

    if (!screenshot || !center || !radius) {
      return res.status(400).json({ message: '缺少必要参数（screenshot, center, radius）' })
    }

    // 解码base64截图
    const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '')
    const imageBuffer = Buffer.from(base64Data, 'base64')

    // 创建Workbook
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Report4biz'
    workbook.created = new Date()

    // 设置颜色主题
    const headerColor = { argb: 'FFF56C6C' }     // 红色标题背景
    const headerFgColor = { argb: 'FFFFFFFF' }    // 白色标题文字
    const subHeaderColor = { argb: 'FFF0F0F0' }   // 浅灰表头背景
    const borderStyle = {
      top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
    }

    // ==================== Sheet 1: 竞品地图（截图） ====================
    const mapSheet = workbook.addWorksheet('竞品地图')

    // 插入截图图片
    const imageId = workbook.addImage({
      buffer: imageBuffer,
      extension: 'png'
    })
    mapSheet.addImage(imageId, {
      tl: { col: 1, row: 1 },
      ext: { width: 700, height: 500 }
    })

    // 设置列宽和行高适配图片
    mapSheet.getColumn(1).width = 8
    mapSheet.getColumn(2).width = 80
    // 在地图图片下方添加标题信息
    const radiusText = radius >= 1000 ? `${(radius / 1000)}公里` : `${radius}米`
    mapSheet.getCell('A30').value = `分析中心: ${center.name || `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`}`
    mapSheet.getCell('A30').font = { bold: true, size: 12, color: { argb: 'FF333333' } }
    mapSheet.getCell('A31').value = `分析半径: ${radiusText}`
    mapSheet.getCell('A31').font = { size: 11, color: { argb: 'FF666666' } }
    const storeCount = (myStores || []).length
    const compCount = (competitors || []).length
    mapSheet.getCell('A32').value = `圈内门店: 我的门店 ${storeCount} 家 / 竞品门店 ${compCount} 家`
    mapSheet.getCell('A32').font = { size: 11, color: { argb: 'FF666666' } }

    // ==================== Sheet 2: 竞品门店 ====================
    const compSheet = workbook.addWorksheet('竞品门店')

    // 标题行
    const compTitleRow = compSheet.addRow(['竞品门店明细'])
    compSheet.mergeCells(`A${compTitleRow.number}:E${compTitleRow.number}`)
    compTitleRow.getCell(1).font = { bold: true, size: 14, color: headerFgColor }
    compTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: headerColor }
    compTitleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
    compTitleRow.height = 30

    // 空行
    compSheet.addRow([])

    // 表头
    const compHeaderRow = compSheet.addRow(['序号', '品牌', '门店名称', '地址', '距圆心距离'])
    compHeaderRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FF333333' }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: subHeaderColor }
      cell.border = borderStyle
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    compHeaderRow.height = 25

    // 数据行
    ;(competitors || []).forEach((store, index) => {
      const distText = store.distance < 1000
        ? `${store.distance.toFixed(0)}米`
        : `${(store.distance / 1000).toFixed(2)}公里`
      const row = compSheet.addRow([
        index + 1,
        store.brand || '-',
        store.name || '-',
        store.address || '-',
        distText
      ])
      row.eachCell(cell => {
        cell.border = borderStyle
        cell.alignment = { vertical: 'middle' }
      })
      row.height = 22
    })

    // 列宽
    compSheet.getColumn(1).width = 8
    compSheet.getColumn(2).width = 18
    compSheet.getColumn(3).width = 30
    compSheet.getColumn(4).width = 40
    compSheet.getColumn(5).width = 18

    // ==================== Sheet 3: 我的门店 ====================
    const storeSheet = workbook.addWorksheet('我的门店')

    // 标题行
    const storeTitleRow = storeSheet.addRow(['我的门店明细'])
    storeSheet.mergeCells(`A${storeTitleRow.number}:E${storeTitleRow.number}`)
    storeTitleRow.getCell(1).font = { bold: true, size: 14, color: headerFgColor }
    storeTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF409EFF' } }
    storeTitleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
    storeTitleRow.height = 30

    // 空行
    storeSheet.addRow([])

    // 表头
    const storeHeaderRow = storeSheet.addRow(['序号', '品牌', '门店名称', '地址', '距圆心距离'])
    storeHeaderRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FF333333' }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: subHeaderColor }
      cell.border = borderStyle
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    storeHeaderRow.height = 25

    // 数据行
    ;(myStores || []).forEach((store, index) => {
      const distText = store.distance < 1000
        ? `${store.distance.toFixed(0)}米`
        : `${(store.distance / 1000).toFixed(2)}公里`
      const row = storeSheet.addRow([
        index + 1,
        store.brand || '-',
        store.name || '-',
        store.address || '-',
        distText
      ])
      row.eachCell(cell => {
        cell.border = borderStyle
        cell.alignment = { vertical: 'middle' }
      })
      row.height = 22
    })

    // 列宽
    storeSheet.getColumn(1).width = 8
    storeSheet.getColumn(2).width = 18
    storeSheet.getColumn(3).width = 30
    storeSheet.getColumn(4).width = 40
    storeSheet.getColumn(5).width = 18

    // 生成文件
    const fileName = `竞品地图分析_${center.name || '未知'}_${Date.now()}.xlsx`
    const outputDir = os.tmpdir()
    const outputPath = path.join(outputDir, fileName)

    await workbook.xlsx.writeFile(outputPath)

    // 发送文件
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)

    const fileStream = fs.createReadStream(outputPath)
    fileStream.pipe(res)
    fileStream.on('end', () => {
      fs.unlink(outputPath, () => {})
    })
  } catch (error) {
    console.error('导出竞品地图Excel错误:', error)
    res.status(500).json({ message: '导出失败: ' + error.message })
  }
})

export default router
