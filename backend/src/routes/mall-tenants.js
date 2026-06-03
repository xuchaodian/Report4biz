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
    const classification = req.query.classification || ''

    // 过滤
    let filtered = all
    if (keyword) {
      filtered = filtered.filter(d =>
        (String(d['商场名称'] || '')).toLowerCase().includes(keyword)
      )
    }
    if (city) filtered = filtered.filter(d => d['城市'] === city)
    if (district) filtered = filtered.filter(d => d['区县'] === district)
    if (bizCircle) filtered = filtered.filter(d => d['商圈'] === bizCircle)
    if (type) filtered = filtered.filter(d => d['商户类型'] === type)
    if (classification) filtered = filtered.filter(d => d['归类'] === classification)

    // 排序
    const sortBy = req.query.sortBy || ''
    const sortOrder = req.query.sortOrder || ''
    if (sortBy && ['商场名称','商场ID','城市'].includes(sortBy)) {
      filtered.sort((a, b) => {
        const va = String(a[sortBy] || ''), vb = String(b[sortBy] || '')
        return sortOrder === 'desc' ? vb.localeCompare(va, 'zh-CN') : va.localeCompare(vb, 'zh-CN')
      })
    }

    const total = filtered.length
    const mallCount = [...new Set(filtered.map(d => d['商场名称']))].length
    const start = (page - 1) * pageSize
    const data = filtered.slice(start, start + pageSize)

    // 筛选选项（根据已选城市/区县联动）
    const cityOptions = [...new Set(all.map(d => d['城市']).filter(Boolean))]
    const filteredByCity = city ? all.filter(d => d['城市'] === city) : all
    const districtOptions = [...new Set(filteredByCity.map(d => d['区县']).filter(Boolean))]
    const filteredByDistrict = district ? filteredByCity.filter(d => d['区县'] === district) : filteredByCity
    const bizCircleOptions = [...new Set(filteredByDistrict.map(d => d['商圈']).filter(Boolean))]
    const typeOptions = [...new Set(all.map(d => d['商户类型']).filter(Boolean))]
    const classificationOptions = [...new Set(all.map(d => d['归类']).filter(Boolean))]

    res.json({ success: true, data, total, mallCount, page, pageSize,
      filterOptions: { city: cityOptions, district: districtOptions, bizCircle: bizCircleOptions, type: typeOptions, classification: classificationOptions }
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
        // 文本字段不应转为数字
        const textFields = ['商场ID','商场名称','商户ID','商户名称','商户类型','所在楼层','评分','城市','区县','商圈','归类','地址','备注','营业时间','数据出处','数据年月']
        if (textFields.includes(h)) {
          row[h] = raw
        } else {
          const cleaned = raw.replace(/,/g, '')
          const num = parseFloat(cleaned)
          row[h] = isNaN(num) ? raw : num
        }
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

// GET /api/mall-tenants/options - 返回过滤选项（轻量，不含数据）
router.get('/options', (req, res) => {
  try {
    const all = loadData()
    const mallNames = [...new Set(all.map(d => d['商场名称']).filter(Boolean))].sort()
    const types = [...new Set(all.map(d => d['商户类型']).filter(Boolean))].sort()
    const classifications = [...new Set(all.map(d => d['归类']).filter(Boolean))].sort()
    res.json({ success: true, data: { mallNames, types, classifications } })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/mall-tenants/compare?malls=商场A,商场B&types=分类1,分类2&byClassification=true
router.get('/compare', (req, res) => {
  try {
    const all = loadData()
    const mallNames = (req.query.malls || '').split(',').filter(Boolean)
    const selectedTypes = (req.query.types || '').split(',').filter(Boolean)
    const byClassification = req.query.byClassification === 'true'

    const result = []
    for (const name of mallNames) {
      const mallTenants = all.filter(d => d['商场名称'] === name)
      const total = mallTenants.length
      const typeCounts = {}
      for (const t of mallTenants) {
        const type = byClassification ? (t['归类'] || '未知') : (t['商户类型'] || '未知')
        typeCounts[type] = (typeCounts[type] || 0) + 1
      }
      // 只返回选择的类型
      const filteredCounts = {}
      if (selectedTypes.length > 0) {
        for (const t of selectedTypes) {
          filteredCounts[t] = typeCounts[t] || 0
        }
      }
      result.push({ 商场名称: name, 商户总数: total, 分类型: selectedTypes.length > 0 ? filteredCounts : typeCounts })
    }
    res.json({ success: true, data: result })
  } catch (error) {
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
