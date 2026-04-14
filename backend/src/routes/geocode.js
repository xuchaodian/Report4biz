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

  // 主方法：使用 ip-api.com（HTTP版本，支持查询指定IP）
  const queryWithIpApi = () => {
    // 如果有 clientIP，查询指定IP；否则查询服务器IP
    const apiUrl = clientIP 
      ? `http://ip-api.com/json/${clientIP}?fields=status,country,countryCode,region,regionName,city,lat,lon`
      : 'http://ip-api.com/json/?fields=status,country,countryCode,region,regionName,city,lat,lon'
    
    console.log('[IP定位] 查询 ip-api.com:', apiUrl)
    
    http.get(apiUrl, (apiRes) => {
      let data = ''
      apiRes.on('data', chunk => { data += chunk })
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.status === 'success') {
            const gcj = wgs2gcj(json.lat, json.lon)
            console.log('[IP定位] ip-api.com 成功:', json.city, json.lat, json.lon)
            res.json({
              success: true,
              lat: gcj.lat,
              lng: gcj.lng,
              city: json.city || json.regionName || '未知城市',
              province: json.regionName || '',
            })
          } else {
            console.log('[IP定位] ip-api.com 返回失败，返回默认位置')
            res.json(defaultLocation)
          }
        } catch (e) {
          console.error('[IP定位] ip-api JSON 解析失败:', e)
          res.json(defaultLocation)
        }
      })
    }).on('error', (error) => {
      console.error('[IP定位] ip-api 网络错误:', error)
      res.json(defaultLocation)
    })
  }

  // 主方法：先使用 ip-api.com
  queryWithIpApi()
})

export default router
