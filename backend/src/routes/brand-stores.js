import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// 获取所有品牌门店（共享数据，所有用户可见）
// 支持分页: ?page=1&pageSize=20&keyword=&city=&district=&brand=&category=
// 无page参数时返回全量（兼容地图）
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const page = parseInt(req.query.page)
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20))
    const keyword = (req.query.keyword || '').trim()
    const city = req.query.city || ''
    const district = req.query.district || ''
    const brand = req.query.brand || ''
    const category = req.query.category || ''

    let where = 'WHERE 1=1'
    const params = []
    if (keyword) { where += ' AND (name LIKE ? OR address LIKE ? OR store_code LIKE ? OR brand LIKE ?)'; const kw = `%${keyword}%`; params.push(kw, kw, kw, kw) }
    if (city) { where += ' AND city = ?'; params.push(city) }
    if (district) { where += ' AND district = ?'; params.push(district) }
    if (brand) {
      const brands = brand.split(',').map(b => b.trim()).filter(Boolean)
      if (brands.length > 0) {
        where += ` AND brand IN (${brands.map(() => '?').join(',')})`
        params.push(...brands)
      }
    }
    if (category) { where += ' AND store_category = ?'; params.push(category) }

    // 无page参数 = 全量返回（兼容地图等）
    if (isNaN(page)) {
      const brandStores = db.prepare(`SELECT id, user_id, store_code, brand, name, store_category, city, district, address, description, latitude, longitude, status, icon_color, created_at FROM brand_stores ${where} ORDER BY created_at DESC`).all(...params)
      return res.json({ brandStores })
    }

    // 分页模式
    const countRow = db.prepare(`SELECT COUNT(*) as total FROM brand_stores ${where}`).get(...params)
    const total = countRow.total
    const offset = (page - 1) * pageSize
    const data = db.prepare(`SELECT id, user_id, store_code, brand, name, store_category, city, district, address, description, latitude, longitude, status, icon_color, created_at FROM brand_stores ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset)

    // 筛选选项（从全量数据中提取）
    const allCity = db.prepare(`SELECT DISTINCT city FROM brand_stores WHERE city != '' ORDER BY city`).all().map(r => r.city)
    const allDistrict = db.prepare(`SELECT DISTINCT district FROM brand_stores WHERE district != '' ORDER BY district`).all().map(r => r.district)
    const allBrand = db.prepare(`SELECT DISTINCT brand FROM brand_stores WHERE brand != '' ORDER BY brand`).all().map(r => r.brand)
    const allCategory = db.prepare(`SELECT DISTINCT store_category FROM brand_stores WHERE store_category != '' ORDER BY store_category`).all().map(r => r.store_category)

    res.json({ success: true, data, total, page, pageSize, filterOptions: { city: allCity, district: allDistrict, brand: allBrand, category: allCategory } })
  } catch (error) {
    console.error('获取品牌门店列表错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 获取单个品牌门店（共享数据）
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const brandStore = db.prepare('SELECT * FROM brand_stores WHERE id = ?').get(req.params.id)

    if (!brandStore) {
      return res.status(404).json({ message: '品牌门店不存在' })
    }

    res.json({ brandStore })
  } catch (error) {
    console.error('获取品牌门店详情错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 创建品牌门店（仅管理员可操作，共享数据）
router.post('/', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可添加品牌门店' })
    }

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
      INSERT INTO brand_stores (
        user_id, store_code, brand, name, store_type, store_category,
        city, district, address,
        description,
        latitude, longitude, status, icon_color,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      req.user.id, store_code || '', brand || '', name, store_type || '品牌', store_category || '',
      city || '', district || '', address || '',
      description || '',
      latitude, longitude, status || '正常', icon_color || '#409eff'
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

// 更新品牌门店（仅管理员可操作）
router.put('/:id', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可编辑品牌门店' })
    }

    const {
      store_code, brand, name, store_type, store_category,
      city, district, address,
      description,
      latitude, longitude, status, icon_color
    } = req.body

    const db = getDb()

    const existing = db.prepare('SELECT * FROM brand_stores WHERE id = ?').get(req.params.id)
    if (!existing) {
      return res.status(404).json({ success: false, message: '品牌门店不存在' })
    }

    db.prepare(`
      UPDATE brand_stores SET
        store_code = ?, brand = ?, name = ?, store_type = ?, store_category = ?,
        city = ?, district = ?, address = ?,
        description = ?,
        latitude = ?, longitude = ?, status = ?, icon_color = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      store_code ?? existing.store_code,
      brand ?? existing.brand,
      name ?? existing.name,
      store_type ?? existing.store_type,
      store_category ?? existing.store_category,
      city ?? existing.city,
      district ?? existing.district,
      address ?? existing.address,
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

// 删除品牌门店（仅管理员可操作）
router.delete('/:id', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可删除品牌门店' })
    }

    const db = getDb()

    const existing = db.prepare('SELECT * FROM brand_stores WHERE id = ?').get(req.params.id)
    if (!existing) {
      return res.status(404).json({ success: false, message: '品牌门店不存在' })
    }

    db.prepare('DELETE FROM brand_stores WHERE id = ?').run(req.params.id)

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除品牌门店错误:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

// 批量删除品牌门店（仅管理员可操作）
router.post('/batch-delete', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可批量删除品牌门店' })
    }

    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '请提供要删除的ID列表' })
    }

    const db = getDb()
    const placeholders = ids.map(() => '?').join(',')

    db.prepare(`DELETE FROM brand_stores WHERE id IN (${placeholders})`).run(...ids)

    res.json({ success: true, message: '批量删除成功', count: ids.length })
  } catch (error) {
    console.error('批量删除品牌门店错误:', error)
    res.status(500).json({ message: '批量删除失败' })
  }
})

// 清空所有品牌门店（仅管理员）
router.delete('/clear-all', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可清空品牌门店' })
    }
    const db = getDb()
    const result = db.prepare('DELETE FROM brand_stores').run()
    res.json({ success: true, message: `已清空 ${result.changes} 条品牌门店数据`, count: result.changes })
  } catch (error) {
    console.error('清空品牌门店错误:', error)
    res.status(500).json({ message: '清空失败' })
  }
})

// 导入品牌门店（仅管理员可操作，共享数据）
router.post('/import', authenticate, upload.single('file'), (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可导入品牌门店' })
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

          // 使用 db.exec 直接执行，避免每行触发 saveDatabase()
          const esc = (v) => { if (v === null || v === undefined) return 'NULL'; return `'${String(v).replace(/'/g, "''")}'` }
          const sql = `INSERT INTO brand_stores (user_id, store_code, brand, name, store_type, store_category, city, district, address, description, latitude, longitude, status, icon_color, created_at, updated_at) VALUES (${req.user.id}, ${esc(row.store_code || '')}, ${esc(row.brand || '')}, ${esc(row.name)}, ${esc(row.store_type || '品牌')}, ${esc(row.store_category || '')}, ${esc(row.city || '')}, ${esc(row.district || '')}, ${esc(row.address || '')}, ${esc(row.description || '')}, ${parseFloat(row.latitude)}, ${parseFloat(row.longitude)}, ${esc(row.status || '正常')}, ${esc(row.icon_color || '#409eff')}, datetime('now'), datetime('now'))`
          db.execNoSave(sql)

          const lastId = db.exec('SELECT last_insert_rowid() as id')[0]?.values?.[0]?.[0]
          if (lastId) {
            const brandStore = db.prepare('SELECT * FROM brand_stores WHERE id = ?').get(lastId)
            imported.push(brandStore)
          }
        }

        // 批量写入完成后一次性保存
        db.saveNow()

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

// 导出品牌门店（仅管理员可操作，导出所有共享数据）
router.get('/export', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '仅管理员可导出品牌门店' })
    }

    const db = getDb()
    const brandStores = db.prepare('SELECT * FROM brand_stores ORDER BY created_at DESC').all()

    res.json({ success: true, data: brandStores })
  } catch (error) {
    console.error('导出错误:', error)
    res.status(500).json({ message: '导出失败' })
  }
})

export default router
