import express from 'express'
import crypto from 'crypto'
import NodeCache from 'node-cache'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// 智慧足迹（联通）上游配置 —— 仅后端可见，绝不随响应暴露
const SMARTSTEPS_CONFIG = {
  baseUrl: 'https://jm-odp.smartsteps.com/febs',
  apiKey: 'bdca5013c9a66ab882dc6b82be93e3a8de3',
  costPerQuery: 60  // 上游成本 60 元/次
}

// 转售价格（按次扣费，可配置）
const RESALE_PRICE = 60
// 最低充值次数
const MIN_RECHARGE = 100

// Token 缓存（10 分钟有效期，提前 1 分钟过期）
const tokenCache = new NodeCache({ stdTTL: 600, checkperiod: 120 })

// ===== 坐标转换（GCJ-02 -> WGS84）=====
const PI = 3.1415926535897932384626
const A = 6378245.0
const EE = 0.00669342162296594323

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0
  return ret
}

function gcj02ToWgs84(lng, lat) {
  const dLat = transformLat(lng - 105.0, lat - 35.0)
  const dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = lat / 180.0 * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const dLat2 = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI)
  const dLng2 = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI)
  return {
    lng: Math.round((lng - dLng2) * 1000000) / 1000000,
    lat: Math.round((lat - dLat2) * 1000000) / 1000000
  }
}

function buildCircleWkt(lng, lat, radius) {
  const wgs = gcj02ToWgs84(lng, lat)
  return `point(${wgs.lng} ${wgs.lat})`
}

// ===== 上游 Token =====
async function getAuthorization() {
  const cachedToken = tokenCache.get('smartsteps_token')
  if (cachedToken) return cachedToken

  const url = `${SMARTSTEPS_CONFIG.baseUrl}/server/openApi/getAuthorization?key=${SMARTSTEPS_CONFIG.apiKey}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    if (!response.ok) {
      throw new Error(`获取Token失败: ${response.status}`)
    }
    const data = await response.json()
    if (data.code === 200 && data.data) {
      tokenCache.set('smartsteps_token', data.data, 540)
      return data.data
    }
    throw new Error('Token响应异常: ' + JSON.stringify(data))
  } catch (error) {
    console.error('智慧足迹获取Token失败:', error)
    throw error
  }
}

// ===== 缓存（复用 smartsteps_cache 表，同 key 规则，与主系统共享）=====
function initCacheTable(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS smartsteps_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        center_lng REAL NOT NULL,
        center_lat REAL NOT NULL,
        radius INTEGER NOT NULL,
        city_month TEXT,
        services TEXT NOT NULL,
        result_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(center_lng, center_lat, radius, city_month, services)
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cache_lookup ON smartsteps_cache(center_lng, center_lat, radius, city_month, services)`)
  } catch (err) {
    console.error('初始化缓存表失败:', err)
  }
}

function findCache(db, centerLng, centerLat, radius, cityMonth, services) {
  try {
    const servicesStr = Array.isArray(services) ? services.sort().join(',') : services
    const row = cityMonth
      ? db.prepare(`
          SELECT result_data FROM smartsteps_cache
          WHERE center_lng = ? AND center_lat = ? AND radius = ? AND city_month = ? AND services = ?
        `).get(centerLng, centerLat, radius, cityMonth, servicesStr)
      : db.prepare(`
          SELECT result_data FROM smartsteps_cache
          WHERE center_lng = ? AND center_lat = ? AND radius = ? AND city_month IS NULL AND services = ?
        `).get(centerLng, centerLat, radius, servicesStr)
    return row ? JSON.parse(row.result_data) : null
  } catch (e) {
    return null
  }
}

function saveToCache(db, centerLng, centerLat, radius, cityMonth, services, resultData) {
  try {
    const servicesStr = Array.isArray(services) ? services.sort().join(',') : services
    db.prepare(`
      INSERT OR REPLACE INTO smartsteps_cache (center_lng, center_lat, radius, city_month, services, result_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(centerLng, centerLat, radius, cityMonth || null, servicesStr, JSON.stringify(resultData))
  } catch (e) {
    console.error('写入缓存失败:', e)
  }
}

// ===== 检测空数据 =====
function checkIfDataIsEmpty(data) {
  if (data === null || data === undefined) return true
  if (data.error) return false
  if (typeof data === 'object') {
    if (Object.keys(data).length === 0) return true
    for (const v of Object.values(data)) {
      if (!checkIfDataIsEmpty(v)) return false
    }
    return true
  }
  return data === 0 || data === ''
}

// ===== API Key 工具 =====
function generateApiKey() {
  return 'r4b_' + crypto.randomBytes(24).toString('hex')
}

// ===== 中间件：X-Api-Key 认证 =====
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key']
  if (!apiKey) {
    return res.status(401).json({ code: 401, message: '缺少 X-Api-Key 请求头' })
  }
  try {
    const db = getDb()
    const client = db.prepare(`SELECT * FROM api_keys WHERE api_key = ? AND status = 'active'`).get(apiKey)
    if (!client) {
      return res.status(401).json({ code: 401, message: 'API Key 无效或已停用' })
    }
    req.apiClient = client
    next()
  } catch (e) {
    res.status(500).json({ code: 500, message: '认证服务异常' })
  }
}

// ===== 管理员接口 =====

// 管理员接口统一挂 /resale/* 前缀
const adminRouter = express.Router()

/**
 * 创建转售客户并生成 API Key（需管理员登录）
 * POST /api/v1/resale/keys
 * Body: { companyName, initialBalance }
 */
adminRouter.post('/keys', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '仅管理员可操作' })
    }
    const { companyName, initialBalance = 0 } = req.body
    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ message: '缺少公司名称' })
    }
    const balance = Math.floor(Number(initialBalance) || 0)
    if (balance < 0) {
      return res.status(400).json({ message: '充值次数不能为负数' })
    }
    const db = getDb()
    const apiKey = generateApiKey()
    const result = db.prepare(`
      INSERT INTO api_keys (company_name, api_key, balance)
      VALUES (?, ?, ?)
    `).run(companyName.trim(), apiKey, balance)
    res.json({
      success: true,
      key: {
        id: result.lastInsertRowid,
        company_name: companyName.trim(),
        api_key: apiKey,
        balance,
        status: 'active'
      },
      message: balance > 0 ? `已创建，初始 ${balance} 次` : '已创建（余额 0，需充值）'
    })
  } catch (e) {
    console.error('创建转售客户失败:', e)
    res.status(500).json({ message: '创建失败: ' + e.message })
  }
})

/**
 * 充值（按次计费，最低 100 次起充）
 * POST /api/v1/resale/recharge
 * Body: { keyId, amount }
 */
adminRouter.post('/recharge', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '仅管理员可操作' })
    }
    const { keyId, amount } = req.body
    const amt = Math.floor(Number(amount) || 0)
    if (!keyId) {
      return res.status(400).json({ message: '缺少 keyId' })
    }
    if (amt < MIN_RECHARGE) {
      return res.status(400).json({ message: `最低充值 ${MIN_RECHARGE} 次起充` })
    }
    const db = getDb()
    const client = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(keyId)
    if (!client) {
      return res.status(404).json({ message: '客户不存在' })
    }
    db.prepare(`UPDATE api_keys SET balance = balance + ? WHERE id = ?`).run(amt, keyId)
    const updated = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(keyId)
    res.json({
      success: true,
      message: `已充值 ${amt} 次`,
      balance: updated.balance,
      totalCost: amt * RESALE_PRICE
    })
  } catch (e) {
    console.error('充值失败:', e)
    res.status(500).json({ message: '充值失败: ' + e.message })
  }
})

/**
 * 启停用客户 Key
 * POST /api/v1/resale/toggle-status
 * Body: { keyId }
 */
adminRouter.post('/toggle-status', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '仅管理员可操作' })
    }
    const { keyId } = req.body
    if (!keyId) {
      return res.status(400).json({ message: '缺少 keyId' })
    }
    const db = getDb()
    const client = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(keyId)
    if (!client) {
      return res.status(404).json({ message: '客户不存在' })
    }
    const newStatus = client.status === 'active' ? 'disabled' : 'active'
    db.prepare(`UPDATE api_keys SET status = ? WHERE id = ?`).run(newStatus, keyId)
    res.json({ success: true, message: newStatus === 'active' ? '已启用' : '已停用', status: newStatus })
  } catch (e) {
    res.status(500).json({ message: '操作失败: ' + e.message })
  }
})

/**
 * 客户列表（含余额）
 * GET /api/v1/resale/keys
 */
adminRouter.get('/keys', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '仅管理员可操作' })
    }
    const db = getDb()
    const keys = db.prepare(`
      SELECT k.*, (SELECT COUNT(*) FROM api_usage u WHERE u.api_key_id = k.id) AS used
      FROM api_keys k ORDER BY k.created_at DESC
    `).all()
    res.json({ keys })
  } catch (e) {
    res.status(500).json({ message: '查询失败: ' + e.message })
  }
})

/**
 * 用量明细
 * GET /api/v1/resale/usage?keyId=1
 */
adminRouter.get('/usage', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '仅管理员可操作' })
    }
    const { keyId, limit = 100 } = req.query
    const db = getDb()
    let usage
    if (keyId) {
      usage = db.prepare(`
        SELECT u.*, k.company_name FROM api_usage u
        LEFT JOIN api_keys k ON k.id = u.api_key_id
        WHERE u.api_key_id = ? ORDER BY u.created_at DESC LIMIT ?
      `).all(Number(keyId), Math.min(Number(limit) || 100, 500))
    } else {
      usage = db.prepare(`
        SELECT u.*, k.company_name FROM api_usage u
        LEFT JOIN api_keys k ON k.id = u.api_key_id
        ORDER BY u.created_at DESC LIMIT ?
      `).all(Math.min(Number(limit) || 100, 500))
    }
    res.json({ usage })
  } catch (e) {
    res.status(500).json({ message: '查询失败: ' + e.message })
  }
})

// ===== 核心转售查询接口 =====

/**
 * 人口数据查询（第三方调用，X-Api-Key 认证）
 * POST /api/v1/population
 * Headers: X-Api-Key: <key>
 * Body: {
 *   lng, lat,            // 中心点坐标（GCJ-02）
 *   radius,              // 半径（米），面积须 0.3~80 km²
 *   indicators,          // 业务指标数组，如 ["population","residence","work","hourly_flow","spend"]
 *   cityMonth            // 可选，数据年月 YYYYMM
 * }
 */
router.post('/', requireApiKey, async (req, res) => {
  const { lng, lat, radius, indicators, cityMonth } = req.body
  const client = req.apiClient

  // 参数校验
  if (!lng || !lat || !radius) {
    return res.status(400).json({ code: 400, message: '缺少必要参数: lng, lat, radius' })
  }
  if (!indicators || !Array.isArray(indicators) || indicators.length === 0) {
    return res.status(400).json({ code: 400, message: '请至少指定一个 indicators' })
  }

  // 业务指标 -> 上游服务号 映射（自有语义，不暴露上游编码）
  const INDICATOR_MAP = {
    population: '1001',      // 人口数量及基础属性
    residence: '1002',       // 居住人口
    work: '1003',            // 工作人口
    visit: '1004',           // 到访人口
    hourly_flow: '1005',     // 每小时段人口流量
    attributes: '1006',      // 人口属性分析
    spend: '1007',           // 消费水平分布
    age: '1008',             // 年龄段分布
    gender: '1009',          // 性别比例
    income: '1010',          // 收入水平分布
    family: '1011',          // 家庭状况分布
    travel: '1012',          // 出行方式分布
    origin: '1013',          // 居住地分布
    workplace: '1014',       // 工作地分布
    weekday: '1015',         // 工作日/周末对比
    heat_daily: '1016',      // 日均人流热度
    heat_monthly: '1017',    // 月均人流热度
    visit_freq: '1018',      // 月到访频次
    origin_outside: '1019',  // 市外来源分布
    origin_province: '1020', // 省内来源分布
    origin_city: '1021',     // 市内来源分布
    stay_duration: '1022',   // 停留时长分布
    full_population: '1023'  // 全量人口
  }

  const services = []
  for (const ind of indicators) {
    const code = INDICATOR_MAP[ind]
    if (!code) {
      return res.status(400).json({ code: 400, message: `未知指标: ${ind}（可用: ${Object.keys(INDICATOR_MAP).join(', ')}）` })
    }
    services.push(code)
  }

  // 余额检查
  if (client.balance < 1) {
    return res.status(402).json({ code: 402, message: '余额不足，请充值' })
  }

  // 面积校验（联通 API 要求 0.3~80 km²）
  const radiusKm = Number(radius) / 1000
  const area = Math.PI * radiusKm * radiusKm
  if (area < 0.3 || area > 80) {
    return res.status(400).json({ code: 400, message: `圆形面积 ${area.toFixed(2)} km² 超出允许范围（0.3~80 km²）` })
  }

  const db = getDb()
  initCacheTable(db)

  const cLng = Number(lng)
  const cLat = Number(lat)
  const r = Number(radius)

  try {
    // 1. 查缓存
    const cachedData = findCache(db, cLng, cLat, r, cityMonth, services)
    if (cachedData) {
      // 命中缓存：不消耗余额（上游未调用）
      db.prepare(`
        INSERT INTO api_usage (api_key_id, services, center_lng, center_lat, radius, city_month, from_cache, cost)
        VALUES (?, ?, ?, ?, ?, ?, 1, 0)
      `).run(client.id, services.join(','), cLng, cLat, r, cityMonth || null)
      return res.json({
        code: 200,
        success: true,
        fromCache: true,
        data: cachedData,
        message: '数据来自缓存，未消耗次数'
      })
    }

    // 2. 调用上游
    const wkt = buildCircleWkt(cLng, cLat, r)
    const requestBody = {
      codes: services.join(','),
      cityMonth: cityMonth || '',
      radius: r,
      polygons: wkt
    }
    const token = await getAuthorization()
    const response = await fetch(`${SMARTSTEPS_CONFIG.baseUrl}/server/openApi/getData`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': token
      },
      body: JSON.stringify(requestBody)
    })

    let result = null
    let querySuccess = false
    if (!response.ok) {
      const errorText = await response.text()
      console.error('智慧足迹API错误:', response.status, errorText)
      result = { error: `上游调用失败: ${response.status}` }
    } else {
      const apiResponse = await response.json()
      if (apiResponse.code === 200) {
        result = apiResponse.data
        querySuccess = true
      } else {
        result = { error: `上游返回错误码: ${apiResponse.code}` }
        console.error('智慧足迹API返回错误:', apiResponse)
      }
    }

    // 3. 空数据判断：查询失败或空数据不扣次数
    const isEmpty = !querySuccess ? true : checkIfDataIsEmpty(result)
    const deducted = isEmpty ? 0 : 1

    // 4. 扣费 + 记录
    if (deducted > 0) {
      db.prepare(`UPDATE api_keys SET balance = balance - 1 WHERE id = ?`).run(client.id)
    }
    db.prepare(`
      INSERT INTO api_usage (api_key_id, services, center_lng, center_lat, radius, city_month, from_cache, cost)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(client.id, services.join(','), cLng, cLat, r, cityMonth || null, deducted)

    // 5. 成功后写缓存
    if (querySuccess && !isEmpty) {
      saveToCache(db, cLng, cLat, r, cityMonth, services, result)
    }

    const updatedClient = db.prepare(`SELECT balance FROM api_keys WHERE id = ?`).get(client.id)

    if (isEmpty) {
      return res.json({
        code: 200,
        success: false,
        message: '查询成功但无数据（未扣次数）',
        data: result,
        balance: updatedClient.balance
      })
    }

    return res.json({
      code: 200,
      success: true,
      fromCache: false,
      data: result,
      balance: updatedClient.balance,
      deducted: 1
    })
  } catch (e) {
    console.error('转售查询失败:', e)
    res.status(500).json({ code: 500, message: '查询失败: ' + e.message })
  }
})

export default router
export { adminRouter }
