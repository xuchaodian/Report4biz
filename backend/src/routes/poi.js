import express from 'express'
import { aroundSearch, polygonSearch, textSearch, geocode, wgs84ToGcj02 } from '../utils/amapPoi.js'

const router = express.Router()

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

export default router
