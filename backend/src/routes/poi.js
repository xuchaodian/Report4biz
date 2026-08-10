import express from 'express'
import { aroundSearch, polygonSearch, textSearch, geocode, wgs84ToGcj02 } from '../utils/amapPoi.js'

const router = express.Router()

// 商业成熟度 POI 分类（高德 typecode 大类码，兼容子类）
const BUSINESS_POI_TYPES = [
  { key: 'mall', label: '商场', types: '060100' },
  { key: 'office', label: '写字楼', types: '120200' },
  { key: 'school', label: '学校', types: '141200' },
  { key: 'hospital', label: '医院', types: '090100' },
  { key: 'hotel', label: '酒店', types: '100100' }
]

/**
 * 商业成熟度统计：统计指定半径内的商场/写字楼/学校/医院/酒店数量
 * POST /api/poi/business-count
 * Body: { lng, lat, radius }
 */
router.post('/business-count', async (req, res) => {
  try {
    const { lng, lat, radius = 500 } = req.body
    if (!lng || !lat) {
      return res.status(400).json({ error: '缺少经纬度参数' })
    }

    // 转换为高德坐标（GCJ-02）
    const [gcjLng, gcjLat] = wgs84ToGcj02(parseFloat(lng), parseFloat(lat))

    // 按分类分别查询（高德 around 单次返回有限，分类查询更准；限流时重试一次）
    const counts = {}
    let total = 0
    for (const cat of BUSINESS_POI_TYPES) {
      let count = 0
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await aroundSearch(gcjLng, gcjLat, radius, '', cat.types)
          count = result.count || 0
          break
        } catch (e) {
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 500))
            continue
          }
          console.warn(`POI分类[${cat.key}]查询失败:`, e.message)
        }
      }
      counts[cat.key] = count
      total += count
    }

    res.json({ success: true, radius, counts, total })
  } catch (error) {
    console.error('商业成熟度统计失败:', error.message)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 周边搜索
 * POST /api/poi/around
 * Body: { lng, lat, radius, keywords, types }
 */
router.post('/around', async (req, res) => {
  try {
    const { lng, lat, radius, keywords, types } = req.body
    
    if (!lng || !lat) {
      return res.status(400).json({ error: '缺少经纬度参数' })
    }
    
    // 转换为高德坐标（GCJ-02）
    const [gcjLng, gcjLat] = wgs84ToGcj02(parseFloat(lng), parseFloat(lat))
    
    const result = await aroundSearch(gcjLng, gcjLat, radius, keywords, types)
    res.json(result)
  } catch (error) {
    console.error('周边搜索失败:', error.message)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 多边形搜索
 * POST /api/poi/polygon
 * Body: { coordinates: [{lng, lat}, ...], keywords, types }
 * coordinates 至少需要3个点构成多边形
 */
router.post('/polygon', async (req, res) => {
  try {
    const { coordinates, keywords, types } = req.body
    
    if (!coordinates || coordinates.length < 3) {
      return res.status(400).json({ error: '多边形至少需要3个坐标点' })
    }
    
    // 转换为GCJ-02坐标并构建多边形字符串
    const polygon = coordinates
      .map(coord => {
        const [lng, lat] = wgs84ToGcj02(parseFloat(coord.lng), parseFloat(coord.lat))
        return `${lng},${lat}`
      })
      .join(';')
    
    const result = await polygonSearch(polygon, keywords, types)
    res.json(result)
  } catch (error) {
    console.error('多边形搜索失败:', error.message)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 关键词搜索
 * POST /api/poi/text
 * Body: { city, keywords, types }
 */
router.post('/text', async (req, res) => {
  try {
    const { city, keywords, types } = req.body
    
    if (!keywords && !types) {
      return res.status(400).json({ error: '关键词和类型至少需要提供一个' })
    }
    
    const result = await textSearch(city, keywords, types)
    res.json(result)
  } catch (error) {
    console.error('关键词搜索失败:', error.message)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 地理编码：将地址转换为坐标
 * POST /api/poi/geocode
 * Body: { address }
 */
router.post('/geocode', async (req, res) => {
  try {
    const { address } = req.body
    
    if (!address) {
      return res.status(400).json({ error: '缺少地址参数' })
    }
    
    const result = await geocode(address)
    if (!result) {
      return res.json({ success: false, error: '未找到该地址' })
    }
    
    res.json({ success: true, ...result })
  } catch (error) {
    console.error('地理编码失败:', error.message)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 批量地理编码：将多个地址转换为坐标
 * POST /api/poi/batch-geocode
 * Body: { addresses: [{ name, address, city, district }] }
 */
router.post('/batch-geocode', async (req, res) => {
  try {
    const { addresses } = req.body

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return res.status(400).json({ error: '缺少地址列表' })
    }

    if (addresses.length > 500) {
      return res.status(400).json({ error: '最多支持500条批量解析' })
    }

    const results = []
    for (const item of addresses) {
      const rawAddress = (item.address || '').trim()
      if (!rawAddress) {
        results.push({ name: item.name, address: rawAddress, success: false, error: '地址为空' })
        continue
      }

      // 构造完整地址：避免重复拼接
      // 如果 address 已包含 city/district（前6字匹配），不再重复拼接
      let fullAddress = rawAddress
      const city6 = (item.city || '').trim().slice(0, 6)
      const dist6 = (item.district || '').trim().slice(0, 6)
      if (city6 && !rawAddress.startsWith(city6) && dist6 && !rawAddress.startsWith(dist6)) {
        fullAddress = (item.district || '') + rawAddress
      }

      let geoResult = null
      let lastError = ''
      const maxRetries = 2

      for (let retry = 0; retry <= maxRetries; retry++) {
        try {
          geoResult = await geocode(fullAddress)
          break // 成功则跳出重试循环
        } catch (err) {
          lastError = err.message
          // 被限流时等待 1.5 秒后重试
          if (err.message.includes('CUQPS_HAS_EXCEEDED_THE_LIMIT') && retry < maxRetries) {
            await new Promise(r => setTimeout(r, 1500))
            continue
          }
          // 其他错误直接退出重试
          break
        }
      }

      if (geoResult) {
        results.push({
          name: item.name,
          address: rawAddress,
          city: item.city || geoResult.city,
          district: item.district || geoResult.district,
          success: true,
          longitude: geoResult.lng,
          latitude: geoResult.lat,
          formatted_address: geoResult.formatted_address
        })
      } else {
        results.push({ name: item.name, address: rawAddress, success: false, error: lastError || '未找到该地址' })
      }

      // 高德免费配额限制：每秒最多 1 次，间隔 1.1 秒
      await new Promise(r => setTimeout(r, 1100))
    }

    const successCount = results.filter(r => r.success).length
    res.json({ success: true, total: addresses.length, successCount, results })
  } catch (error) {
    console.error('批量地理编码失败:', error.message)
    res.status(500).json({ error: error.message })
  }
})

export default router
