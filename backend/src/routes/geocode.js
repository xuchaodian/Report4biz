import express from 'express'
import https from 'https'

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

// IP定位：通过高德IP定位API（服务端请求，无浏览器HTTPS混合内容限制）
router.get('/ip-location', (req, res) => {
  // 获取客户端真实IP（考虑代理）
  // x-forwarded-for 可能为空或包含多级代理IP，取第一个公网IP
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

  // 高德IP定位接口（服务端调用，无HTTPS限制）
  const url = `https://restapi.amap.com/v3/ip?ip=${clientIP}&key=${AMap_KEY}`

  https.get(url, (apiRes) => {
    let data = ''
    apiRes.on('data', chunk => { data += chunk })
    apiRes.on('end', () => {
      try {
        const json = JSON.parse(data)
        // rectangle 可能是空数组 [] 或字符串 "leftBottom;rightTop"，必须判断是字符串才处理
        const rectangle = json.rectangle
        const hasValidRectangle = typeof rectangle === 'string' && rectangle.length > 0
        if (json.status === '1' && hasValidRectangle) {
          const parts = rectangle.split(';')
          const lb = parts[0].split(',')
          const rt = parts[1].split(',')
          const lng = (parseFloat(lb[0]) + parseFloat(rt[0])) / 2
          const lat = (parseFloat(lb[1]) + parseFloat(rt[1])) / 2
          res.json({
            success: true,
            lat,
            lng,
            city: json.city || json.province || '未知城市',
            province: json.province || '',
          })
        } else {
          res.json({ success: false, message: '无法定位当前城市' })
        }
      } catch (e) {
        console.error('IP定位 JSON 解析失败，响应内容:', data.substring(0, 200))
        res.json({ success: false, message: '解析响应失败' })
      }
    })
  }).on('error', (error) => {
    console.error('IP定位网络错误:', error)
    res.status(500).json({ success: false, message: 'IP定位服务出错' })
  })
})

export default router
