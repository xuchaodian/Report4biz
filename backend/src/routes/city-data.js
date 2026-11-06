import express from 'express'
import path from 'path'
import fs from 'fs'
import multer from 'multer'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { getCityData, getCityDataArray, invalidateCityData } from '../utils/cityData.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
// v1.13.320：城市数据可被「一键清空」，属高危操作，必须留痕（谁清的、清了多少条）
import { writeAudit, diffFields, AUDIT_ACTIONS } from '../utils/auditLog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const router = express.Router()
const upload = multer({ dest: '/tmp/uploads/' })

const dataPath = path.join(__dirname, '../data/city_data.json')

// 城市数据的字段清单（顺序＝表格列顺序）。
// v1.13.320：原来只在 POST 里内联一份，PUT 的审计对比需要同一份 ⇒ 提到顶部共用。
// ⛔ 不要在两处各写一份：漏一个字段的后果是「该字段改了但审计里看不到」。
const CITY_FIELDS = [
  '城市', '省份', '等级', '年份', 'GDP(亿元)', '增速(%)', '人均GDP(元)',
  '年末常住人口(万人)', '城镇人口(万人)', '城镇居民人均可支配收入(元)',
  '城镇居民人均消费支出(元)', '社会消费品零售总额(亿元)',
]

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
    // 用现有字段列表保留顺序（清单已提到文件顶部，见 CITY_FIELDS）
    CITY_FIELDS.forEach(f => { const v = body[f]; record[f] = (v !== undefined && v !== '') ? (isNaN(Number(v)) ? v : Number(v)) : '' })
    if (idx >= 0) data[idx] = record
    else data.push(record)
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2))
    invalidateCityData()
    writeAudit({
      req,
      action: AUDIT_ACTIONS.CITYDATA_UPSERT,
      targetType: 'city_data',
      targetId: body['城市'],
      detail: { mode: idx >= 0 ? 'overwrite' : 'create', record },
    })
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
    writeAudit({
      req,
      action: AUDIT_ACTIONS.CITYDATA_IMPORT,
      targetType: 'city_data',
      targetId: 'import',
      detail: {
        updated: updatedCount,
        added: addedCount,
        total: existing.length,
        fileName: req.file?.originalname || null,
      },
    })
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
    const before = data[idx]
    const updated = { ...before, ...req.body }
    data[idx] = updated
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2))
    invalidateCityData()
    // 只记**真变了**的字段：编辑弹窗会把整行原值一起提交，全记会让真正改动的那项被淹没
    writeAudit({
      req,
      action: AUDIT_ACTIONS.CITYDATA_UPDATE,
      targetType: 'city_data',
      targetId: req.params.city,
      detail: { mode: 'update', changes: diffFields(before, updated, CITY_FIELDS) },
    })
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
    // 🔴 先数条数再删：删完就查不到"原本有多少条"，审计里必须回答得了
    const beforeCount = getCityDataArray().length
    fs.writeFileSync(dataPath, JSON.stringify([], null, 2))
    invalidateCityData()
    writeAudit({
      req,
      action: AUDIT_ACTIONS.CITYDATA_CLEAR,
      targetType: 'city_data',
      targetId: 'all',
      detail: { clearedRecords: beforeCount },
    })
    res.json({ success: true, message: '已清除所有数据' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
