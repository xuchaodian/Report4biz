import express from 'express'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { getCityData, getCityDataArray, invalidateCityData } from '../utils/cityData.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const router = express.Router()
const upload = multer({ dest: '/tmp/uploads/' })

const dataPath = path.join(__dirname, '../data/city_data.json')

// ============================================================================
// 🔴 鉴权口径（v1.13.319）
//
// 本文件原先是**整个文件零鉴权**——4 个写接口谁都能调：
//   POST /            新增/覆盖任一城市      POST /import   上传 CSV 覆盖
//   PUT  /:city       改任一城市              DELETE /       清空全部（写成 []）
// 其中 DELETE 的注释一直写着「仅管理员调用」，但**没有任何校验**。
// 实测（无 token）：PUT 不存在的城市返回 404「未找到该城市」、POST 空 body 返回
// 400「城市名不能为空」——若挂了鉴权，应当先返回 401「请先登录」。
// ⇒ 任何人不登录、一条 curl 即可清空或篡改 51 个城市的宏观数据。
// ⚠️ city_data.json 是**文件不是数据库**，不在 webgis.db 的备份链里，
//    被清空后库快照救不回来。
//
// 现在的口径：
//   · GET / 与 GET /:city **保持公开** —— 地图页 MapView.vue 在用 `/api/city-data/:city`
//     读城市宏观数据，加鉴权会让未登录访客的地图页直接失效。
//   · 四个写接口一律 `authenticate, requireAdmin`。
//   ⛔ 不要图省事写 `router.use(authenticate)` 组级挂载：那会把两个 GET 也一起关掉。
//
// ⚠️ `/import` 的鉴权必须排在 `upload.single('file')` **之前**：
//    multer 是先落盘再进 handler，排在后面等于「未授权的请求也能往 /tmp 写文件」，
//    可被用来填盘。顺序写反了功能看起来一样，但攻击面完全不同。
// ============================================================================

// GET /api/city-data - 获取城市宏观数据（M6：模块级缓存，不再每请求读盘解析）
router.get('/', (req, res) => {
  try {
    res.json({ success: true, data: getCityData() })
  } catch (error) {
    console.error('[CityData] 读取失败:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/city-data/:city - 获取单个城市数据
router.get('/:city', (req, res) => {
  try {
    const data = getCityDataArray()
    const city = data.find(d => d['城市'] === req.params.city)
    if (!city) return res.status(404).json({ success: false, message: '未找到该城市' })
    res.json({ success: true, data: city })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/city-data - 手动添加城市数据（🔴 写接口 ⇒ 仅管理员）
router.post('/', authenticate, requireAdmin, (req, res) => {
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

// POST /api/city-data/import - 导入 CSV（🔴 鉴权必须在 upload 之前，否则未授权也能落盘 /tmp）
router.post('/import', authenticate, requireAdmin, upload.single('file'), (req, res) => {
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
    invalidateCityData()
    fs.unlinkSync(csvPath)
    res.json({ success: true, message: `导入完成：更新 ${updatedCount} 条，新增 ${addedCount} 条`, total: existing.length })
  } catch (error) {
    console.error('[CityData] 导入失败:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/city-data/:city - 更新单个城市数据（🔴 写接口 ⇒ 仅管理员）
router.put('/:city', authenticate, requireAdmin, (req, res) => {
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

// DELETE /api/city-data - 清除所有城市数据（🔴 仅管理员）
// ⚠️ 原注释就写着「仅管理员调用」，但**代码里一直没有校验**（v1.13.319 才补上）。
//    这句注释曾让审计时误以为已受保护 —— 注释不等于防护，判据永远看中间件链。
router.delete('/', authenticate, requireAdmin, (req, res) => {
  try {
    fs.writeFileSync(dataPath, JSON.stringify([], null, 2))
    invalidateCityData()
    res.json({ success: true, message: '已清除所有数据' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
