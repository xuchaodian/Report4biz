import express from 'express'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const router = express.Router()
const upload = multer({ dest: '/tmp/uploads/' })

const dataPath = path.join(__dirname, '../data/mall_tenants.json')

// 内存缓存
let cachedData = null
let cacheTime = 0
const CACHE_TTL = 30000 // 30秒

function loadData() {
  const now = Date.now()
  if (cachedData && (now - cacheTime) < CACHE_TTL) return cachedData
  const raw = fs.readFileSync(dataPath, 'utf-8')
  cachedData = JSON.parse(raw)
  cacheTime = now
  return cachedData
}

function invalidateCache() {
  cachedData = null
  cacheTime = 0
}

// GET /api/mall-tenants?page=1&pageSize=20&keyword=&city=&district=&bizCircle=&type=
router.get('/', (req, res) => {
  try {
    const all = loadData()
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20))
    const keyword = (req.query.keyword || '').trim().toLowerCase()
    const city = req.query.city || ''
    const district = req.query.district || ''
    const bizCircle = req.query.bizCircle || ''
    const type = req.query.type || ''

    // 过滤
    let filtered = all
    if (keyword) {
      filtered = filtered.filter(d =>
        (d['商场名称'] || '').toLowerCase().includes(keyword) ||
        (d['商户名称'] || '').toLowerCase().includes(keyword)
      )
    }
    if (city) filtered = filtered.filter(d => d['城市'] === city)
    if (district) filtered = filtered.filter(d => d['区县'] === district)
    if (bizCircle) filtered = filtered.filter(d => d['商圈'] === bizCircle)
    if (type) filtered = filtered.filter(d => d['商户类型'] === type)

    const total = filtered.length
    const start = (page - 1) * pageSize
    const data = filtered.slice(start, start + pageSize)

    // 同时返回筛选选项（用于下拉框）
    const cityOptions = [...new Set(all.map(d => d['城市']).filter(Boolean))]
    const districtOptions = [...new Set(all.map(d => d['区县']).filter(Boolean))]
    const bizCircleOptions = [...new Set(all.map(d => d['商圈']).filter(Boolean))]
    const typeOptions = [...new Set(all.map(d => d['商户类型']).filter(Boolean))]

    res.json({ success: true, data, total, page, pageSize,
      filterOptions: { city: cityOptions, district: districtOptions, bizCircle: bizCircleOptions, type: typeOptions }
    })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/mall-tenants/import - 导入CSV
router.post('/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请上传 CSV 文件' })
    const csvRaw = fs.readFileSync(req.file.path, 'utf-8')
    const lines = csvRaw.trim().split('\n')
    if (lines.length < 2) return res.status(400).json({ success: false, message: 'CSV 文件为空' })
    
    function parseCSVLine(line) {
      const result = []; let cur = '', inQ = false
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ }
        else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = '' }
        else { cur += ch }
      }
      result.push(cur.trim())
      return result
    }

    const headers = parseCSVLine(lines[0])
    const existing = loadData()
    let added = 0
    
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i])
      const row = {}
      headers.forEach((h, idx) => {
        const raw = vals[idx] || ''
        const cleaned = raw.replace(/,/g, '')
        const num = parseFloat(cleaned)
        row[h] = isNaN(num) ? raw : num
      })
      if (!row['商户ID']) continue
      const idx = existing.findIndex(d => d['商户ID'] === row['商户ID'])
      if (idx >= 0) existing[idx] = row
      else existing.push(row)
      added++
    }

    fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2))
    invalidateCache()
    fs.unlinkSync(req.file.path)
    res.json({ success: true, message: `导入成功，处理 ${added} 条`, total: existing.length })
  } catch (error) {
    console.error('[MallTenants] 导入失败:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE /api/mall-tenants - 清除所有数据
router.delete('/', (req, res) => {
  try {
    fs.writeFileSync(dataPath, JSON.stringify([], null, 2))
    invalidateCache()
    res.json({ success: true, message: '已清除所有商户数据' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
