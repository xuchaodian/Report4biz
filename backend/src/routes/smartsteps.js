import express from 'express'
import NodeCache from 'node-cache'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { SMARTSTEPS_API_KEY } from '../config.js'
import { fetchWithTimeout, DEFAULT_HTTP_TIMEOUT_MS, SLOW_HTTP_TIMEOUT_MS } from '../utils/httpTimeout.js'
import { checkQuota, buildGateError } from '../utils/quotaGate.js'
import { parsePopulation1001 } from '../utils/unicomPopulation.js'

const router = express.Router()

// 智慧足迹API配置
const SMARTSTEPS_CONFIG = {
  baseUrl: 'https://jm-odp.smartsteps.com/febs',
  apiKey: SMARTSTEPS_API_KEY,
  // 费用60元/次
  costPerQuery: 60
}

// Token缓存（10分钟有效期）
const tokenCache = new NodeCache({ stdTTL: 600, checkperiod: 120 })

/**
 * 初始化缓存表
 */
export function initCacheTable(db) {
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
    // 创建索引
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cache_lookup ON smartsteps_cache(center_lng, center_lat, radius, city_month, services)`)
  } catch (err) {
    console.error('初始化缓存表失败:', err)
  }
}

/**
 * 查找缓存数据
 */
export function findCache(db, centerLng, centerLat, radius, cityMonth, services) {
  try {
    // 将坐标精度调整为5位小数（约1米精度），避免浮点误差导致缓存不命中
    const precision = 100000
    const lngKey = Math.round(centerLng * precision) / precision
    const latKey = Math.round(centerLat * precision) / precision
    
    const servicesStr = Array.isArray(services) ? services.sort().join(',') : services
    
    const cached = db.prepare(`
      SELECT result_data FROM smartsteps_cache 
      WHERE center_lng = ? AND center_lat = ? AND radius = ? 
        AND (city_month = ? OR (city_month IS NULL AND ? IS NULL))
        AND services = ?
    `).get(lngKey, latKey, radius, cityMonth, cityMonth, servicesStr)
    
    if (cached) {
      return JSON.parse(cached.result_data)
    }
    return null
  } catch (err) {
    console.error('查找缓存失败:', err)
    return null
  }
}

/**
 * 保存数据到缓存
 */
export function saveToCache(db, centerLng, centerLat, radius, cityMonth, services, resultData) {
  try {
    // 将坐标精度调整为5位小数
    const precision = 100000
    const lngKey = Math.round(centerLng * precision) / precision
    const latKey = Math.round(centerLat * precision) / precision
    
    const servicesStr = Array.isArray(services) ? services.sort().join(',') : services
    
    db.prepare(`
      INSERT OR REPLACE INTO smartsteps_cache (center_lng, center_lat, radius, city_month, services, result_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(lngKey, latKey, radius, cityMonth || null, servicesStr, JSON.stringify(resultData))
    
    console.log('数据已缓存')
  } catch (err) {
    console.error('保存缓存失败:', err)
  }
}

/**
 * 获取授权Token
 */
export async function getAuthorization() {
  // 先检查缓存
  const cachedToken = tokenCache.get('smartsteps_token')
  if (cachedToken) {
    return cachedToken
  }

  const url = `${SMARTSTEPS_CONFIG.baseUrl}/server/openApi/getAuthorization?key=${SMARTSTEPS_CONFIG.apiKey}`
  
  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }, DEFAULT_HTTP_TIMEOUT_MS)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`获取Token失败: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    
    // 文档返回格式: { code: 200, data: "eyJhbGciOiJIUkZkJiQmJRd...." }
    if (data.code === 200 && data.data) {
      const token = data.data
      // JWT token 有效期约10分钟，提前1分钟过期
      tokenCache.set('smartsteps_token', token, 540)
      return token
    }
    
    throw new Error('Token响应异常: ' + JSON.stringify(data))
  } catch (error) {
    console.error('智慧足迹获取Token失败:', error)
    throw error
  }
}

/**
 * 转换坐标：GCJ-02 -> WGS84
 * @param {number} lng - GCJ-02 经度
 * @param {number} lat - GCJ-02 纬度
 * @returns {{lng: number, lat: number}} WGS84坐标
 */
function gcj02ToWgs84(lng, lat) {
  const PI = 3.1415926535897932384626
  const a = 6378245.0
  const ee = 0.00669342162296594323
  
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  
  const radLat = lat / 180.0 * PI
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI)
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI)
  
  const wgsLat = lat - dLat
  const wgsLng = lng - dLng
  
  return {
    lng: Math.round(wgsLng * 1000000) / 1000000,
    lat: Math.round(wgsLat * 1000000) / 1000000
  }
}

function transformLat(x, y) {
  const PI = 3.1415926535897932384626
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0
  return ret
}

function transformLng(x, y) {
  const PI = 3.1415926535897932384626
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0
  return ret
}

/**
 * 构建WKT格式
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 * @param {number} radius - 半径（米）
 */
export function buildCircleWkt(lng, lat, radius) {
  // 转换为WGS84
  const wgs = gcj02ToWgs84(lng, lat)
  // 智慧足迹使用 point(经度 纬度) 格式（空格分隔）
  return `point(${wgs.lng} ${wgs.lat})`
}

/**
 * 检测返回数据是否全为0/空（需要返还配额）
 * @param {any} data - API返回的数据
 * @returns {boolean} - true表示全为0/空，需要返还配额
 */
export function checkIfDataIsEmpty(data) {
  // 空数据情况
  if (data === null || data === undefined) return true
  if (data.error) return false  // 有错误信息不算空数据
  
  // 如果是对象
  if (typeof data === 'object') {
    // 空对象
    if (Object.keys(data).length === 0) return true
    
    // 遍历所有数值字段
    let hasValidNumber = false
    for (const [key, value] of Object.entries(data)) {
      if (key === 'error') continue  // 跳过错误字段
      if (value === null || value === undefined) continue
      
      // 如果是数字
      if (typeof value === 'number') {
        if (value !== 0) {
          hasValidNumber = true
          break
        }
      }
      // 如果是字符串数字
      else if (typeof value === 'string') {
        const num = parseFloat(value)
        if (!isNaN(num) && num !== 0) {
          hasValidNumber = true
          break
        }
      }
      // 如果是数组或对象，递归检查
      else if (typeof value === 'object') {
        if (!checkIfDataIsEmpty(value)) {
          hasValidNumber = true
          break
        }
      }
    }
    
    return !hasValidNumber
  }
  
  return false
}

/**
 * 获取Token
 */
router.get('/token', async (req, res) => {
  try {
    const token = await getAuthorization()
    res.json({ token, cached: tokenCache.has('smartsteps_token') })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

/**
 * 查询可用数据月份（免费，不占调用次数）
 * 联通 getData 数据通常滞后当前约2个月，正式查询前先用 getCityMonth 探测，
 * 避免选中无数据月份导致 60元/次 的无效调用。
 * 返回内部格式: [{ value: 'YYYYMM', label: 'YYYY年M月' }]，最新在前
 */
router.get('/months', authenticate, async (req, res) => {
  try {
    // 复用 getAuthorization 的 token 缓存（10min）
    const token = await getAuthorization()

    const response = await fetchWithTimeout(`${SMARTSTEPS_CONFIG.baseUrl}/server/openApi/getCityMonth`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'authorization': token
      }
    }, DEFAULT_HTTP_TIMEOUT_MS)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`查询数据月份失败: ${response.status} ${errorText}`)
    }

    const apiResponse = await response.json()
    if (apiResponse.code !== 200) {
      throw new Error('数据月份响应异常: ' + JSON.stringify(apiResponse))
    }

    const rawMonths = Array.isArray(apiResponse.data) ? apiResponse.data : []
    // 归一化：兼容联通返回 "YYYY-MM"（实测）与 "YYYYMM" 两种格式
    const months = rawMonths
      .map((m) => {
        const s = String(m).trim()
        const match = s.match(/^(\d{4})[-]?(\d{1,2})$/)
        if (!match) return null
        const year = match[1]
        const monthNum = parseInt(match[2], 10)
        if (monthNum < 1 || monthNum > 12) return null
        return { value: `${year}${String(monthNum).padStart(2, '0')}`, label: `${year}年${monthNum}月` }
      })
      .filter(Boolean)
      // 去重 + 倒序（最新在前）
      .sort((a, b) => String(b.value).localeCompare(String(a.value)))
      .filter((m, i, arr) => i === 0 || m.value !== arr[i - 1].value)

    res.json({ months, raw: rawMonths })
  } catch (error) {
    console.error('获取数据月份失败:', error)
    res.status(500).json({ message: error.message })
  }
})

/**
 * 查询服务列表
 */
router.get('/services', (req, res) => {
  const services = [
    { code: '1001', name: '人口数量及基础属性', unit: '次', price: 0.1 },
    { code: '1002', name: '居住人口', unit: '次', price: 0.1 },
    { code: '1003', name: '工作人口', unit: '次', price: 0.1 },
    { code: '1004', name: '到访人口', unit: '次', price: 0.1 },
    { code: '1005', name: '每小时段人口流量', unit: '小时', price: 0.2 },
    { code: '1006', name: '人口属性分析', unit: '次', price: 0.15 },
    { code: '1007', name: '消费水平分布', unit: '次', price: 0.15 },
    { code: '1008', name: '年龄段分布', unit: '次', price: 0.1 },
    { code: '1009', name: '性别比例', unit: '次', price: 0.05 },
    { code: '1010', name: '收入水平分布', unit: '次', price: 0.15 },
    { code: '1011', name: '家庭状况分布', unit: '次', price: 0.1 },
    { code: '1012', name: '出行方式分布', unit: '次', price: 0.1 },
    { code: '1013', name: '居住地分布', unit: '次', price: 0.15 },
    { code: '1014', name: '工作地分布', unit: '次', price: 0.15 },
    { code: '1015', name: '工作日/周末对比', unit: '次', price: 0.2 },
    { code: '1016', name: '日均人流热度', unit: '次', price: 0.1 },
    { code: '1017', name: '月均人流热度', unit: '次', price: 0.15 },
    { code: '1018', name: '月到访频次', unit: '次', price: 0.1 },
    { code: '1019', name: '市外来源分布', unit: '次', price: 0.2 },
    { code: '1020', name: '省内来源分布', unit: '次', price: 0.15 },
    { code: '1021', name: '市内来源分布', unit: '次', price: 0.15 },
    { code: '1022', name: '停留时长分布', unit: '次', price: 0.1 },
    { code: '1023', name: '全量人口', unit: '次', price: 0.15 }
  ]
  
  res.json({ services })
})

/**
 * 生成模拟数据（用于测试，不消耗联通API配额）
 * 结构模仿真实智慧足迹API响应
 */
function generateMockData(services) {
  const mockDataSet = {
    '1001': { totalPopulation: Math.floor(Math.random() * 50000) + 5000 },
    '1003': { workingPopulation: Math.floor(Math.random() * 30000) + 3000 },
    '1005': { hourlyTraffic: Array.from({length: 24}, () => Math.floor(Math.random() * 2000) + 100) },
    '1006': { age_0_14: Math.floor(Math.random() * 5000) + 500, age_15_59: Math.floor(Math.random() * 20000) + 2000, age_60_plus: Math.floor(Math.random() * 3000) + 300 },
    '1007': { high: Math.floor(Math.random() * 3000) + 500, mid: Math.floor(Math.random() * 5000) + 1000, low: Math.floor(Math.random() * 2000) + 300 },
    '1008': { age_0_14: Math.floor(Math.random() * 5000) + 500, age_15_29: Math.floor(Math.random() * 8000) + 1000, age_30_44: Math.floor(Math.random() * 8000) + 1000, age_45_59: Math.floor(Math.random() * 5000) + 500, age_60_plus: Math.floor(Math.random() * 3000) + 300 },
    '1009': { male: Math.floor(Math.random() * 15000) + 2000, female: Math.floor(Math.random() * 15000) + 2000 },
    '1010': { high: Math.floor(Math.random() * 2000) + 200, mid_high: Math.floor(Math.random() * 3000) + 500, mid: Math.floor(Math.random() * 5000) + 1000, mid_low: Math.floor(Math.random() * 3000) + 500, low: Math.floor(Math.random() * 2000) + 200 },
    '1011': { single: Math.floor(Math.random() * 5000) + 500, couple: Math.floor(Math.random() * 5000) + 500, family_with_children: Math.floor(Math.random() * 8000) + 1000, family_elderly: Math.floor(Math.random() * 2000) + 200 },
    '1012': { car: Math.floor(Math.random() * 8000) + 1000, public_transport: Math.floor(Math.random() * 12000) + 2000, walk: Math.floor(Math.random() * 5000) + 500, bike: Math.floor(Math.random() * 3000) + 300 },
    '1013': { local: Math.floor(Math.random() * 20000) + 5000, other_city: Math.floor(Math.random() * 8000) + 1000, other_province: Math.floor(Math.random() * 5000) + 500 },
    '1014': { local: Math.floor(Math.random() * 20000) + 5000, other_city: Math.floor(Math.random() * 8000) + 1000, other_province: Math.floor(Math.random() * 5000) + 500 },
    '1015': { weekday: Math.floor(Math.random() * 30000) + 5000, weekend: Math.floor(Math.random() * 25000) + 4000 },
    '1016': { daily_avg: Math.floor(Math.random() * 3000) + 500 },
    '1017': { monthly_avg: Math.floor(Math.random() * 80000) + 10000 },
    '1018': { once: Math.floor(Math.random() * 5000) + 500, twice: Math.floor(Math.random() * 3000) + 300, three_plus: Math.floor(Math.random() * 2000) + 200 },
    '1019': { local: Math.floor(Math.random() * 15000) + 3000, other_city: Math.floor(Math.random() * 5000) + 500, other_province: Math.floor(Math.random() * 3000) + 300, other_country: Math.floor(Math.random() * 500) + 50 },
    '1020': { local: Math.floor(Math.random() * 15000) + 3000, other_city: Math.floor(Math.random() * 5000) + 500 },
    '1021': { local: Math.floor(Math.random() * 15000) + 3000, other_district: Math.floor(Math.random() * 5000) + 500 },
    '1022': { lt_30min: Math.floor(Math.random() * 5000) + 500, '30_60min': Math.floor(Math.random() * 4000) + 400, '1_2h': Math.floor(Math.random() * 3000) + 300, '2_4h': Math.floor(Math.random() * 2000) + 200, gt_4h: Math.floor(Math.random() * 1000) + 100 },
    '1023': { total: Math.floor(Math.random() * 100000) + 10000 }
  }

  const result = {}
  const codeList = Array.isArray(services) ? services : services.split(',')
  for (const code of codeList) {
    if (mockDataSet[code]) {
      result[code] = mockDataSet[code]
    }
  }
  return Object.keys(result).length > 0 ? result : mockDataSet['1001']
}

/**
 * 查询数据
 * 请求体: {
 *   centerLng: number,   // GCJ-02经度
 *   centerLat: number,  // GCJ-02纬度
 *   radius: number,      // 主要半径（米）
 *   radii: number[],     // 所有半径数组（米）
 *   services: string[], // 服务编码数组，如 ['1001', '1005']
 *   cityMonth: string,  // 格式: '202403'，为空则用最新月份
 * }
 * 计费（v1.13.105 B1）：本次查询固定消耗 1 次上游 getData 调用。服务端自行计量，
 * 不接受客户端传入 quotaUsed（防改包 quotaUsed:0 绕过扣减），与 districts 硬编码 -1 对齐。
 */
router.post('/query', authenticate, async (req, res) => {
  // 从请求体获取参数（提到try外面供catch块访问）
  const { centerLng, centerLat, radius, radii, services, cityMonth, storeName, storeType, mock } = req.body

  // 数据库和配额变量（提到try外供catch访问）
  let db, available

  // 固定计费单位：1 次查询 = 1 次上游 getData 调用
  const QUOTA_UNIT = 1

  try {
    if (!centerLng || !centerLat || !radius) {
      return res.status(400).json({ message: '缺少必要参数: centerLng, centerLat, radius' })
    }
    
    if (!services || services.length === 0) {
      return res.status(400).json({ message: '请至少选择一个服务' })
    }
    
    // 面积校验（联通API要求 0.3~80 平方公里）
    const radiusKm = radius / 1000
    const area = Math.PI * radiusKm * radiusKm
    if (area < 0.3 || area > 80) {
      return res.status(400).json({
        message: `圆形面积 ${area.toFixed(2)} km² 超出允许范围（0.3~80 km²），请调整半径（建议 0.32~5.0 公里）`
      })
    }
    
    // 初始化数据库连接
    db = getDb()
    
    // 初始化缓存表（如果不存在）
    initCacheTable(db)
    
    // 先检查是否有缓存数据
    const servicesStr = Array.isArray(services) ? services.sort().join(',') : services
    const cachedData = findCache(db, centerLng, centerLat, radius, cityMonth, services)
    
    if (cachedData) {
      console.log('命中缓存，直接返回数据')
      return res.json({
        success: true,
        fromCache: true,  // 标记来自缓存
        wkt: buildCircleWkt(centerLng, centerLat, radius),
        centerWgs: gcj02ToWgs84(centerLng, centerLat),
        data: cachedData,
        quotaUsed: 0,
        remainingQuota: null,
        message: '数据来自缓存，不消耗配额'
      })
    }
    
    // 无缓存，继续检查配额（v0.9 P0：统一走授权闸门 —— 物理池 + 成员授权额度）
    const gate = checkQuota(db, req.user?.id, QUOTA_UNIT, { role: req.user?.role })
    available = gate.pool

    if (!gate.ok) {
      const err = buildGateError(gate)
      return res.status(err.status).json(err.body)
    }
    
    // Mock 模式：跳过联通API调用，返回模拟数据（不消耗配额，方便测试）
    if (mock) {
      console.log('[Mock] 模式开启，返回模拟数据')
      const mockResult = generateMockData(services)
      return res.json({
        success: true,
        refunded: false,
        mock: true,
        wkt: buildCircleWkt(centerLng, centerLat, radius),
        centerWgs: gcj02ToWgs84(centerLng, centerLat),
        data: mockResult,
        quotaUsed: 0,
        remainingQuota: available,
        message: '模拟数据（测试模式，不消耗配额）'
      })
    }

    // 构建polygons参数（point格式：point(经度 纬度)）
    const wkt = buildCircleWkt(centerLng, centerLat, radius)
    
    // 构建请求 - 根据联通API格式
    const requestBody = {
      codes: Array.isArray(services) ? services.join(',') : services,
      cityMonth: cityMonth || '',
      radius: radius,
      polygons: wkt  // 直接使用point格式
    }
    
    console.log('智慧足迹查询请求:', JSON.stringify(requestBody, null, 2))
    
    // 先获取授权Token
    const token = await getAuthorization()
    console.log('获取到Token:', token ? `${token.substring(0, 20)}...` : 'null')
    
    // 调用智慧足迹API（需带Token）
    const response = await fetchWithTimeout(`${SMARTSTEPS_CONFIG.baseUrl}/server/openApi/getData`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': token
      },
      body: JSON.stringify(requestBody)
    }, SLOW_HTTP_TIMEOUT_MS)
    
    let result = null
    let querySuccess = false
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('智慧足迹API错误:', response.status, errorText)
      result = { error: `API调用失败: ${response.status}` }
    } else {
      const apiResponse = await response.json()
      // 解析返回的数据结构
      if (apiResponse.code === 200) {
        result = apiResponse.data
        querySuccess = true
        console.log('智慧足迹查询成功')
      } else {
        result = { error: `API返回错误码: ${apiResponse.code}` }
        console.error('智慧足迹API返回错误:', apiResponse)
      }
    }
    
    // 检测返回数据是否全为0/空（需要返还配额）
    const isEmptyData = !querySuccess ? true : checkIfDataIsEmpty(result)
    
    // 实际扣减的配额（查询失败或空数据时为0）
    let actualQuotaUsed = isEmptyData ? 0 : QUOTA_UNIT
    
    // 落库+扣配额+写缓存 → 事务化：三者要么全部生效，要么全部回滚，
    // 杜绝"有履历没扣配额 / 扣了配额没履历"的中间不一致状态（方案A, v1.13.86）
    let purchaseId = null
    try {
      db.beginTx()
      try {
        const recordStatus = (querySuccess && !isEmptyData) ? 'active' : 'failed'
        const insertResult = db.prepare(`
          INSERT INTO purchases (
            user_id, store_name, store_type, center_lng, center_lat, radius,
            city_month, quota_used, status, result_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.user.id,
          storeName || '',
          storeType || '',
          centerLng,
          centerLat,
          JSON.stringify(radii || [radius]),
          cityMonth || '',
          actualQuotaUsed,
          recordStatus,
          JSON.stringify({ querySuccess, apiResult: result, refunded: isEmptyData })
        )
        purchaseId = insertResult.lastInsertRowid

        // 仅在查询成功且非空数据时扣减配额和缓存（与 INSERT 同事务，任一步失败整体回滚）
        if (querySuccess && !isEmptyData) {
          db.prepare(`UPDATE admin_quota SET remaining_quota = remaining_quota - ? WHERE id = 1`).run(QUOTA_UNIT)

          // 保存到缓存（自身内部失败仅记日志，不影响 purchases/配额一致性）
          saveToCache(db, centerLng, centerLat, radius, cityMonth, services, result)
        }
        db.commitTx()
      } catch (txError) {
        try { db.rollbackTx() } catch (rollbackError) {
          console.error('事务回滚失败:', rollbackError)
        }
        throw txError
      }
    } catch (dbError) {
      // 事务整体失败：履历未写、配额未扣（已回滚），对外按"实际扣减0"返回，保持与购买履历/对账口径一致
      console.error(`记录配额使用失败(事务已回滚，未扣配额) store=${storeName || ''} radius=${radius}:`, dbError)
      purchaseId = null
      actualQuotaUsed = 0
    }
    
    // 返回结果（包含扣减后的配额，空数据时返还）
    res.json({
      success: querySuccess,
      refunded: isEmptyData,
      wkt: wkt,
      centerWgs: gcj02ToWgs84(centerLng, centerLat),
      data: result,
      quotaUsed: actualQuotaUsed,
      remainingQuota: available,  // 返还时配额不变
      purchaseId: purchaseId || null  // 本次查询产生的记录ID（供导出报表使用）
    })
  } catch (error) {
    console.error('智慧足迹查询失败:', error)
    res.status(500).json({ 
      message: error.message,
      quotaUsed: QUOTA_UNIT,
      remainingQuota: null  // 无法计算
    })
  }
})

/**
 * 转换坐标测试接口
 */
router.post('/convert', (req, res) => {
  const { lng, lat } = req.body
  if (!lng || !lat) {
    return res.status(400).json({ message: '缺少参数: lng, lat' })
  }
  
  const wgs = gcj02ToWgs84(lng, lat)
  res.json({
    input: { lng, lat, coord: 'GCJ-02' },
    output: { ...wgs, coord: 'WGS84' }
  })
})


// ============================================================================
// 报告用：按「点位 + 半径」取 1001 人口，**优先复用已购买数据**（v1.13.341）
// ----------------------------------------------------------------------------
// 业主 2026-11-09 定：报告人口改用收费的联通配额，且要与「我的门店」打通 ——
//   已为某个门店买过联通人口时，给同址点位做立项报告**不该重复付费**。
//
// ⚠️ 口径必须与「我的门店」一致：`point(lng lat)` + `radius`（圆），**不是**商圈面多边形。
//   两者 result_data 结构相同（都是 getData 返回的 `{ apiResult: { '1001': … } }`），
//   但覆盖范围完全不同 ⇒ ⛔ 绝不许拿半径数据冒充商圈面人口（报告里那栏叫"商圈人口"）。
//
// 取数优先级（①② 都 0 费用）：
//   ① purchases        —— 同账号 + 同半径 + 坐标 10m 内 + status=active + 含 1001
//   ② smartsteps_cache —— 同坐标（5 位小数）+ 同半径 + services 含 1001
//   ③ 都没有 → 配额闸门 → 调联通（扣 1 次）→ 同事务写 purchases + cache
//
// 🔴 复用**不要求同月份**：已购数据就是那个月的事实，把 `dataMonth` 如实回传让用户自己判断
//   要不要刷新。强行要求同月等于"过期就重新收费"，那是坑用户。
// ============================================================================
const REPORT_RADII = [1000, 3000, 5000]   // 报告只开放这三档：面积 3.1/28.3/78.5 km²（联通限制 0.3~80）
const REUSE_TOL_M = 10                    // 坐标容差 —— 业主 2026-11-09 定为 10m

/** 球面距离（米） */
function distMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * purchases.radius 存的是 **JSON 字符串**（`"[1000]"` 或 `"[1000,3000]"`，见 /query 落库），
 * 也可能是裸数字/裸字符串。这里统一判断「是否包含目标半径」。
 */
function radiusIncludes(raw, want) {
  if (raw === null || raw === undefined || raw === '') return false
  let v = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { v = Number(raw) }
  }
  if (typeof v === 'number') return Number(v) === Number(want)
  if (Array.isArray(v)) return v.map(Number).includes(Number(want))
  return false
}

/** 本地推算最新数据月份（兜底用；前端一般会先调免费的 /months 传进来） */
function latestMonthLocal() {
  const now = new Date()
  let m = now.getMonth()      // 0-based，减 1 得"上个月"
  let y = now.getFullYear()
  m -= 1
  if (m < 0) { m += 12; y -= 1 }
  return `${y}${String(m + 1).padStart(2, '0')}`
}

/**
 * 报告取人口主端点。
 * POST /api/smartsteps/population  { lng, lat, radius, cityMonth?, storeName? }
 */
router.post('/population', authenticate, async (req, res) => {
  const body = req.body || {}
  const gLng = Number(body.lng)
  const gLat = Number(body.lat)
  const radius = Number(body.radius)
  const storeName = String(body.storeName || '').slice(0, 100)

  if (!Number.isFinite(gLng) || !Number.isFinite(gLat) || !gLng || !gLat) {
    return res.status(400).json({ message: '缺少有效坐标' })
  }
  if (!REPORT_RADII.includes(radius)) {
    return res.status(400).json({ message: `半径只支持 ${REPORT_RADII.map((r) => r / 1000 + 'km').join(' / ')}` })
  }

  const db = getDb()
  initCacheTable(db)

  // ── ① 复用已购买：同账号 + 同半径 + 10m 内 + 含 1001 ──────────────────
  try {
    const box = 0.0003   // ≈33m 粗筛（1e-4 度≈11m），精确判定交给 haversine
    const rows = db.prepare(`
      SELECT id, store_name, radius, city_month, result_data, created_at, center_lng, center_lat
        FROM purchases
       WHERE user_id = ? AND status = 'active' AND result_data IS NOT NULL
         AND center_lat BETWEEN ? AND ? AND center_lng BETWEEN ? AND ?
       ORDER BY city_month DESC, id DESC
       LIMIT 200
    `).all(req.user.id, gLat - box, gLat + box, gLng - box, gLng + box)

    for (const row of rows) {
      if (!radiusIncludes(row.radius, radius)) continue
      // 坐标必须再精判一次 —— SQL 只做了矩形粗筛（±0.0003°）
      const lat2 = Number(row.center_lat)
      const lng2 = Number(row.center_lng)
      if (!Number.isFinite(lat2) || !Number.isFinite(lng2)) continue
      if (distMeters(gLng, gLat, lng2, lat2) > REUSE_TOL_M) continue

      const pop = parsePopulation1001(row.result_data)
      if (!pop) continue          // 那笔购买里没有 1001（只买了 1005 之类）⇒ 不算命中
      return res.json({
        success: true,
        source: 'purchase',
        radius,
        population: pop,
        dataMonth: row.city_month || '',
        reused: {
          purchaseId: row.id,
          storeName: row.store_name || '',
          purchasedAt: row.created_at || ''
        },
        quotaUsed: 0,
        message: '已复用该位置购买过的联通人口数据，本次未消耗配额'
      })
    }
  } catch (e) {
    console.error('[ReportPopulation] 查询已购数据失败:', e.message)
  }

  // ── ② 复用共享缓存（同坐标 5 位小数 + 同半径 + services 含 1001）──────
  try {
    const precision = 100000      // 与 findCache/saveToCache 同规则
    const lngKey = Math.round(gLng * precision) / precision
    const latKey = Math.round(gLat * precision) / precision
    const cached = db.prepare(`
      SELECT result_data, city_month FROM smartsteps_cache
       WHERE center_lng = ? AND center_lat = ? AND radius = ?
         AND services LIKE '%1001%'
       ORDER BY city_month DESC
       LIMIT 1
    `).get(lngKey, latKey, radius)
    if (cached) {
      const pop = parsePopulation1001(cached.result_data)
      if (pop) {
        return res.json({
          success: true,
          source: 'cache',
          radius,
          population: pop,
          dataMonth: cached.city_month || '',
          reused: { storeName: '', purchasedAt: '' },
          quotaUsed: 0,
          message: '已命中同位置缓存，本次未消耗配额'
        })
      }
    }
  } catch (e) {
    console.error('[ReportPopulation] 查询缓存失败:', e.message)
  }

  // 只探测：报告一打开就调这里（免费），命中就展示，没命中让用户自己点按钮
  if (body.probeOnly) {
    return res.json({
      success: true,
      source: 'none',
      radius,
      population: null,
      dataMonth: '',
      reused: null,
      quotaUsed: 0
    })
  }

  // ── ③ 都没有：配额闸门 → 调联通（扣 1 次）───────────────────────────
  const gate = checkQuota(db, req.user?.id, 1, { role: req.user?.role })
  if (!gate.ok) {
    const err = buildGateError(gate)
    return res.status(err.status).json(err.body)
  }

  const cityMonth = String(body.cityMonth || '') || latestMonthLocal()
  let result
  try {
    const token = await getAuthorization()
    const response = await fetchWithTimeout(`${SMARTSTEPS_CONFIG.baseUrl}/server/openApi/getData`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: token },
      body: JSON.stringify({
        codes: '1001',
        cityMonth,
        radius,
        polygons: buildCircleWkt(gLng, gLat, radius)
      })
    }, SLOW_HTTP_TIMEOUT_MS)
    if (!response.ok) throw new Error(`联通 API 调用失败: ${response.status}`)
    const api = await response.json()
    if (api.code !== 200 || !api.data) throw new Error(`联通返回错误: ${api.message || api.info || api.code}`)
    result = api.data
  } catch (e) {
    console.error('[ReportPopulation] 联通取数失败:', e.message)
    return res.status(502).json({ message: '人口数据服务暂不可用，请稍后重试' })
  }

  const pop = parsePopulation1001(result)
  if (!pop) {
    // 上游成功但没数据 ⇒ **不扣费**（与 /query 的"空数据返还配额"同口径）
    return res.status(502).json({ message: '联通未返回可用人口数据（本次未消耗配额）' })
  }

  // 扣费 + 写 purchases + 写 cache，同一事务
  const remaining = Number(gate.pool) - 1
  db.beginTx()
  try {
    db.prepare(`UPDATE admin_quota SET remaining_quota = remaining_quota - 1 WHERE id = 1`).run()
    db.prepare(`
      INSERT INTO purchases (user_id, store_name, store_type, center_lng, center_lat, radius,
                             city_month, quota_used, status, result_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)
    `).run(
      req.user.id, storeName, 'report',
      gLng, gLat, JSON.stringify([radius]),
      cityMonth,
      JSON.stringify({ querySuccess: true, apiResult: result, refunded: false })
    )
    saveToCache(db, gLng, gLat, radius, cityMonth, '1001', result)
    db.commitTx()
  } catch (txErr) {
    try { db.rollbackTx() } catch { /* 忽略 */ }
    console.error('[ReportPopulation] 落库失败:', txErr.message)
    return res.status(500).json({ message: '人口数据已取到但落库失败，请重试' })
  }

  res.json({
    success: true,
    source: 'fresh',
    radius,
    population: pop,
    dataMonth: cityMonth,
    reused: null,
    quotaUsed: 1,
    remainingQuota: remaining,
    message: '已从联通获取人口数据（消耗 1 次配额）'
  })
})

export default router
