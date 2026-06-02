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

const dataPath = path.join(__dirname, '../data/city_data.json')

// GET /api/city-data - 获取城市宏观数据
router.get('/', (req, res) => {
  try {
    const raw = fs.readFileSync(dataPath, 'utf-8')
    const data = JSON.parse(raw)
    res.json({ success: true, data })
  } catch (error) {
    console.error('[CityData] 读取失败:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/city-data/:city - 获取单个城市数据
router.get('/:city', (req, res) => {
  try {
    const raw = fs.readFileSync(dataPath, 'utf-8')
    const data = JSON.parse(raw)
    const city = data.find(d => d['城市'] === req.params.city)
    if (!city) return res.status(404).json({ success: false, message: '未找到该城市' })
    res.json({ success: true, data: city })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/city-data - 手动添加城市数据
router.post('/', (req, res) => {
  try {
    const body = req.body
    if (!body['城市']) return res.status(400).json({ success: false, message: '城市名不能为空' })
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    const idx = data.findIndex(d => d['城市'] === body['城市'])
    const record = {}
    // 用现有字段列表保留顺序
    const fields = ['城市','省份','等级','年份','GDP(亿元)','增速(%)','人均GDP(元)','年末常住人口(万人)','城镇人口(万人)','城镇居民人均可支配收入(元)','城镇居民人均消费支出(元)','社会消费品零售总额(亿元)']
    fields.forEach(f => { const v = body[f]; record[f] = (v !== undefined && v !== '') ? (isNaN(Number(v)) ? v : Number(v)) : '' })
    if (idx >= 0) data[idx] = record
    else data.push(record)
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2))
    res.json({ success: true, message: `已${idx >= 0 ? '更新' : '添加'}「${body['城市']}」` })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/city-data/import - 导入 CSV
router.post('/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请上传 CSV 文件' })
    const csvPath = req.file.path
    const csvRaw = fs.readFileSync(csvPath, 'utf-8')
    const lines = csvRaw.trim().split('\n')
    if (lines.length < 2) return res.status(400).json({ success: false, message: 'CSV 文件为空' })

    // 解析 CSV 行（支持引号包裹的逗号）
    function parseCSVLine(line) {
      const result = []
      let current = ''
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
          inQuotes = !inQuotes
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim())
          current = ''
        } else {
          current += ch
        }
      }
      result.push(current.trim())
      return result
    }

    const headers = parseCSVLine(lines[0])
    const existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    let updatedCount = 0, addedCount = 0

    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i])
      const row = {}
      headers.forEach((h, idx) => {
        const raw = vals[idx] || ''
        // 尝试转为数字（去掉千位分隔逗号）
        const cleaned = raw.replace(/,/g, '')
        const num = parseFloat(cleaned)
        row[h] = isNaN(num) ? raw : num
      })
      // 跳过无城市名的行
      if (!row['城市']) continue
      const idx = existing.findIndex(d => d['城市'] === row['城市'])
      if (idx >= 0) { existing[idx] = row; updatedCount++ }
      else { existing.push(row); addedCount++ }
    }

    fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2))
    fs.unlinkSync(csvPath)
    res.json({ success: true, message: `导入完成：更新 ${updatedCount} 条，新增 ${addedCount} 条`, total: existing.length })
  } catch (error) {
    console.error('[CityData] 导入失败:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/city-data/:city - 更新单个城市数据
router.put('/:city', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    const idx = data.findIndex(d => d['城市'] === req.params.city)
    if (idx === -1) return res.status(404).json({ success: false, message: '未找到该城市' })
    // 只更新传入的字段，保留未传的字段
    const updated = { ...data[idx], ...req.body }
    data[idx] = updated
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2))
    res.json({ success: true, message: '更新成功', data: updated })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE /api/city-data - 清除所有城市数据（仅管理员调用）
router.delete('/', (req, res) => {
  try {
    fs.writeFileSync(dataPath, JSON.stringify([], null, 2))
    res.json({ success: true, message: '已清除所有数据' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
