import express from 'express'
import https from 'https'
import http from 'http'

const router = express.Router()

// 高德 Web 服务 Key
const AMap_KEY = '8e22ba2cec83bc554753a47842383949'

// 确保正确编码
const ensureProperEncoding = (str) => {
  try {
    return decodeURIComponent(str)
  } catch (e) {
    return str
  }
}

// 地理编码：地址 → 经纬度（精确匹配）
router.get('/geocode', (req, res) => {
  const rawAddress = req.query.address
  if (!rawAddress) {
    return res.status(400).json({ error: '地址不能为空' })
  }

  const address = ensureProperEncoding(rawAddress)
  const encodedAddress = encodeURIComponent(address)
  const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodedAddress}&key=${AMap_KEY}`
  
  https.get(url, (apiRes) => {
    let data = ''
    apiRes.on('data', chunk => data += chunk)
    apiRes.on('end', () => {
      try {
        const json = JSON.parse(data)
        if (json.status === '1' && json.geocodes && json.geocodes.length > 0) {
          const results = json.geocodes.map(item => ({
            lat: item.location.split(',')[1],
            lon: item.location.split(',')[0],
            display_name: item.formatted_address,
            province: item.province,
            city: item.city,
            district: item.district,
          }))
          res.json({ success: true, results })
        } else {
          res.json({ success: false, results: [], message: json.info || '未找到相关地址' })
        }
      } catch (e) {
        res.json({ success: false, results: [], message: '解析响应失败' })
      }
    })
  }).on('error', (error) => {
    console.error('地理编码错误:', error)
    res.status(500).json({ error: '地理编码服务出错' })
  })
})

// 搜索建议：模糊匹配，返回提示列表
router.get('/suggest', (req, res) => {
  const rawKeyword = req.query.keyword
  if (!rawKeyword) {
    return res.status(400).json({ error: '关键词不能为空' })
  }

  const keyword = ensureProperEncoding(rawKeyword)
  const encodedKeyword = encodeURIComponent(keyword)
  // 使用高德搜索建议API
  const url = `https://restapi.amap.com/v3/assistant/inputtips?keywords=${encodedKeyword}&key=${AMap_KEY}`
  
  https.get(url, (apiRes) => {
    let data = ''
    apiRes.on('data', chunk => data += chunk)
    apiRes.on('end', () => {
      try {
        const json = JSON.parse(data)
        if (json.status === '1' && json.tips && json.tips.length > 0) {
          // 过滤并转换结果（只保留有有效坐标的）
          const results = json.tips
            .filter(tip => {
              const loc = tip.location
              if (!loc) return false
              
              // 如果是字符串（如"120.2,31.9"）
              if (typeof loc === 'string' && loc.trim() !== '') {
                const parts = loc.split(',')
                return parts.length >= 2 && 
                       !isNaN(parseFloat(parts[0])) && 
                       !isNaN(parseFloat(parts[1]))
              }
              
              // 如果是数组（且非空）
              if (Array.isArray(loc) && loc.length >= 2) {
                return !isNaN(parseFloat(loc[0])) && !isNaN(parseFloat(loc[1]))
              }
              
              return false
            })
            .map(tip => {
              let lon, lat
              const loc = tip.location
              
              if (typeof loc === 'string') {
                const parts = loc.split(',')
                lon = parts[0]
                lat = parts[1]
              } else {
                lon = loc[0]
                lat = loc[1]
              }
              
              // 处理可能的数组字段
              const district = Array.isArray(tip.district) ? tip.district.join('') : (tip.district || '')
              const name = Array.isArray(tip.name) ? tip.name.join('') : (tip.name || '')
              
              return {
                id: Array.isArray(tip.id) ? tip.id.join('') : (tip.id || ''),
                name: name,
                district: district,
                address: Array.isArray(tip.address) ? tip.address.join('') : (tip.address || ''),
                display_name: district ? `${district}${name}` : name,
                lat: lat,
                lon: lon,
              }
            })
          res.json({ success: true, results })
        } else {
          res.json({ success: false, results: [], message: json.info || '未找到相关建议' })
        }
      } catch (e) {
        console.error('搜索建议解析错误:', e)
        res.json({ success: false, results: [], message: '解析响应失败' })
      }
    })
  }).on('error', (error) => {
    console.error('搜索建议错误:', error)
    res.status(500).json({ error: '搜索建议服务出错' })
  })
})

// IP定位：使用 ip-api.com（主）+ 高德API（备）
router.get('/ip-location', (req, res) => {
  // 获取客户端真实IP（考虑代理）
  let clientIP = ''
  const xff = req.headers['x-forwarded-for']
  if (xff) {
    const firstIP = String(xff).split(',')[0]
    clientIP = firstIP ? firstIP.trim() : ''
  }
  if (!clientIP) {
    clientIP = req.headers['x-real-ip'] || ''
  }
  if (!clientIP) {
    clientIP = req.connection?.remoteAddress || req.socket?.remoteAddress || ''
  }
  // 去掉 IPv6 前缀 ::ffff:
  if (clientIP.startsWith('::ffff:')) {
    clientIP = clientIP.substring(7)
  }

  console.log('[IP定位] 客户端IP:', clientIP)

  // 默认位置（北京）
  const defaultLocation = {
    success: true,
    lat: 39.9042,
    lng: 116.4074,
    city: '北京市',
    province: '北京市',
  }

  // WGS84 转 GCJ02
  const wgs2gcj = (wgLat, wgLon) => {
    const a = 6378245.0
    const ee = 0.00669342162296594323
    const pi = 3.14159265358979324
    
    const transformLat = (x, y) => {
      let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
      ret += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0
      ret += (20.0 * Math.sin(y * pi) + 40.0 * Math.sin(y / 3.0 * pi)) * 2.0 / 3.0
      ret += (160.0 * Math.sin(y / 12.0 * pi) + 320.0 * Math.sin(y * pi / 30.0)) * 2.0 / 3.0
      return ret
    }
    
    const transformLng = (x, y) => {
      let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
      ret += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0
      ret += (20.0 * Math.sin(x * pi) + 40.0 * Math.sin(x / 3.0 * pi)) * 2.0 / 3.0
      ret += (150.0 * Math.sin(x / 12.0 * pi) + 300.0 * Math.sin(x / 30.0 * pi)) * 2.0 / 3.0
      return ret
    }
    
    let dLat = transformLat(wgLon - 105.0, wgLat - 35.0)
    let dLon = transformLng(wgLon - 105.0, wgLat - 35.0)
    const radLat = wgLat / 180.0 * pi
    let magic = Math.sin(radLat)
    magic = 1 - ee * magic * magic
    const sqrtMagic = Math.sqrt(magic)
    dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * pi)
    dLon = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * pi)
    return { lat: wgLat + dLat, lng: wgLon + dLon }
  }

  // 主方法：使用高德IP定位API（国内可访问，返回GCJ-02坐标系）
  const queryAMapIP = () => {
    const apiUrl = clientIP
      ? `https://restapi.amap.com/v3/ip?key=${AMap_KEY}&ip=${encodeURIComponent(clientIP)}`
      : `https://restapi.amap.com/v3/ip?key=${AMap_KEY}`
    
    console.log('[IP定位] 查询高德API:', apiUrl.replace(AMap_KEY, '***'))
    
    const req = https.get(apiUrl, (apiRes) => {
      let data = ''
      apiRes.on('data', chunk => { data += chunk })
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.status === '1' && json.city) {
            // 从 rectangle 解析中心坐标（rectangle 格式: "minX,minY;maxX,maxY"）
            let lat = defaultLocation.lat
            let lng = defaultLocation.lng
            if (json.rectangle) {
              const parts = json.rectangle.split(';')
              if (parts.length === 2) {
                const min = parts[0].split(',').map(Number)
                const max = parts[1].split(',').map(Number)
                if (min.length === 2 && max.length === 2) {
                  lng = (min[0] + max[0]) / 2
                  lat = (min[1] + max[1]) / 2
                }
              }
            }
            console.log('[IP定位] 高德API 成功:', json.city, lat, lng)
            res.json({
              success: true,
              lat, lng,
              city: json.city || defaultLocation.city,
              province: json.province || '',
            })
          } else {
            console.log('[IP定位] 高德API 返回失败:', json.info || json.city, '，返回默认位置')
            res.json(defaultLocation)
          }
        } catch (e) {
          console.error('[IP定位] 高德API JSON解析失败:', e)
          res.json(defaultLocation)
        }
      })
    })
    req.setTimeout(5000, () => {
      console.error('[IP定位] 高德API 请求超时(5s)，返回默认位置')
      req.destroy()
      res.json(defaultLocation)
    })
    req.on('error', (error) => {
      console.error('[IP定位] 高德API 网络错误:', error)
      res.json(defaultLocation)
    })
  }

  // 主方法：使用高德IP定位
  queryAMapIP()
})

// 行政区域边界查询 - 使用高德行政区域API
router.get('/district', (req, res) => {
  const rawCity = req.query.city
  if (!rawCity) return res.status(400).json({ error: '城市名不能为空' })
  const city = ensureProperEncoding(rawCity)
  const url = `https://restapi.amap.com/v3/config/district?keywords=${encodeURIComponent(city)}&key=${AMap_KEY}&extensions=all&subdistrict=0`
  https.get(url, (apiRes) => {
    let data = ''
    apiRes.on('data', chunk => data += chunk)
    apiRes.on('end', () => {
      try {
        const json = JSON.parse(data)
        if (json.status === '1' && json.districts && json.districts.length > 0) {
          const district = json.districts[0]
          const polyline = district.polyline || ''
          // polyline 格式：lon1,lat1;lon2,lat2|lon1,lat1;...
          // 用 | 分隔多个多边形（可能有飞地）
          const polygons = polyline.split('|').filter(Boolean).map(part => {
            const points = part.split(';').filter(Boolean).map(pt => {
              const [lon, lat] = pt.split(',')
              return [parseFloat(lon), parseFloat(lat)]
            })
            return points
          })
          res.json({
            success: true,
            data: {
              name: district.name,
              center: district.center,
              polygons,
              level: district.level
            }
          })
        } else {
          res.json({ success: false, message: json.info || '未找到该城市' })
        }
      } catch (e) {
        res.json({ success: false, message: '解析失败' })
      }
    })
  }).on('error', (error) => {
    res.status(500).json({ error: '服务出错' })
  })
})

export default router
