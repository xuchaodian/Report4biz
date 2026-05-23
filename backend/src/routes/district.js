/**
 * 高德行政区域边界查询代理路由
 *
 * 调用高德行政区域查询 API，获取城市/区县的边界坐标
 * 通过 Leaflet L.polygon 在地图上绘制行政界
 */

import express from 'express'
import axios from 'axios'

const router = express.Router()

// 高德 WebService API Key
const KEY = '8e22ba2cec83bc554753a47842383949'

/**
 * GET /api/district/boundary?keywords=上海
 * 查询指定行政区划的边界坐标
 * Query: keywords (城市名/adcode)
 */
router.get('/boundary', async (req, res) => {
  try {
    const { keywords } = req.query
    if (!keywords) {
      return res.status(400).json({ success: false, error: '缺少 keywords 参数' })
    }

    const url = `https://restapi.amap.com/v3/config/district`
    const response = await axios.get(url, {
      params: {
        key: KEY,
        keywords,
        subdistrict: 0,
        extensions: 'all',
        output: 'JSON'
      },
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Report4biz/1.0)',
        'Referer': 'https://mka-online.cn/'
      }
    })

    const data = response.data

    if (data.status === '1' && data.districts && data.districts.length > 0) {
      const district = data.districts[0]
      const polyline = district.polyline || ''
      const center = district.center || ''
      
      // 解析边界坐标：多地块用 | 分隔，坐标点用 ; 分隔
      const boundaries = []
      if (polyline) {
        const parts = polyline.split('|')
        for (const part of parts) {
          const points = part.split(';')
          const coords = points.map(p => {
            const [lng, lat] = p.split(',')
            return [parseFloat(lat), parseFloat(lng)]  // Leaflet 需要 [lat, lng]
          })
          if (coords.length > 2) {
            boundaries.push(coords)
          }
        }
      }

      const [centerLng, centerLat] = center ? center.split(',').map(Number) : [0, 0]

      res.json({
        success: true,
        data: {
          name: district.name,
          adcode: district.adcode,
          level: district.level,
          center: [centerLat, centerLng],  // Leaflet 格式 [lat, lng]
          boundaries  // 多个地块的坐标数组
        }
      })
    } else {
      res.json({
        success: false,
        error: data.info || '未找到该行政区划',
        data: null
      })
    }
  } catch (error) {
    console.error('[District] 查询失败:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
