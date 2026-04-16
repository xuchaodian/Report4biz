import express from 'express'
import NodeCache from 'node-cache'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// 智慧足迹API配置
const SMARTSTEPS_CONFIG = {
  baseUrl: 'https://jm-odp.smartsteps.com/febs',
  apiKey: 'bdca5013c9a66ab882dc6b82be93e3a8de3',
  // 费用60元/次
  costPerQuery: 60
}

// Token缓存（10分钟有效期）
const tokenCache = new NodeCache({ stdTTL: 600, checkperiod: 120 })

/**
 * 获取授权Token
 */
async function getAuthorization() {
  // 先检查缓存
  const cachedToken = tokenCache.get('smartsteps_token')
  if (cachedToken) {
    return cachedToken
  }

  const url = `${SMARTSTEPS_CONFIG.baseUrl}/server/openApi/getAuthorization?key=${SMARTSTEPS_CONFIG.apiKey}`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

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
function buildCircleWkt(lng, lat, radius) {
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
function checkIfDataIsEmpty(data) {
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
 * 查询数据
 * 请求体: {
 *   centerLng: number,   // GCJ-02经度
 *   centerLat: number,  // GCJ-02纬度
 *   radius: number,      // 主要半径（米）
 *   radii: number[],     // 所有半径数组（米）
 *   services: string[], // 服务编码数组，如 ['1001', '1005']
 *   cityMonth: string,  // 格式: '202403'，为空则用最新月份
 *   quotaUsed: number   // 本次消耗的配额（默认1）
 * }
 */
router.post('/query', authenticate, async (req, res) => {
  // 从请求体获取参数（提到try外面供catch块访问）
  const { centerLng, centerLat, radius, radii, services, cityMonth, quotaUsed = 1, storeName, storeType } = req.body

  // 数据库和配额变量（提到try外供catch访问）
  let db, available

  try {
    if (!centerLng || !centerLat || !radius) {
      return res.status(400).json({ message: '缺少必要参数: centerLng, centerLat, radius' })
    }
    
    if (!services || services.length === 0) {
      return res.status(400).json({ message: '请至少选择一个服务' })
    }
    
    // 检查用户配额
    db = getDb()
    const user = db.prepare('SELECT quota FROM users WHERE id = ?').get(req.user.id)
    const usedResult = db.prepare(`
      SELECT COALESCE(SUM(quota_used), 0) as used
      FROM purchases
      WHERE user_id = ? AND status = 'active'
    `).get(req.user.id)
    
    available = (user?.quota || 0) - (usedResult?.used || 0)
    
    if (available < quotaUsed) {
      return res.status(400).json({
        message: `配额不足，需要 ${quotaUsed} 次，当前可用 ${available} 次`
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
    const isEmptyData = checkIfDataIsEmpty(result)
    
    // 实际扣减的配额（空数据时为0）
    const actualQuotaUsed = isEmptyData ? 0 : quotaUsed
    
    // 记录到purchases表
    try {
      db.prepare(`
        INSERT INTO purchases (
          user_id, store_name, store_type, center_lng, center_lat, radius,
          city_month, quota_used, status, result_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        req.user.id,
        storeName || '',
        storeType || '',
        centerLng,
        centerLat,
        JSON.stringify(radii || [radius]),
        cityMonth || '',
        actualQuotaUsed,
        JSON.stringify({ querySuccess, apiResult: result, refunded: isEmptyData })
      )
      
      // 仅在非空数据时扣减运营商总配额
      if (!isEmptyData) {
        db.prepare(`UPDATE admin_quota SET total_quota = total_quota - ? WHERE id = 1`).run(quotaUsed)
      }
    } catch (dbError) {
      console.error('记录配额使用失败:', dbError)
    }
    
    // 返回结果（包含扣减后的配额，空数据时返还）
    res.json({
      success: querySuccess,
      refunded: isEmptyData,
      wkt: wkt,
      centerWgs: gcj02ToWgs84(centerLng, centerLat),
      data: result,
      quotaUsed: actualQuotaUsed,
      remainingQuota: available  // 返还时配额不变
    })
  } catch (error) {
    console.error('智慧足迹查询失败:', error)
    res.status(500).json({ 
      message: error.message,
      quotaUsed: quotaUsed,
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

export default router
