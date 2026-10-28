import express from 'express'
import https from 'https'
import http from 'http'
import { AMAP_KEY } from '../config.js'
import { suggestByTencent, isTencentMapEnabled } from '../utils/tencentMap.js'
import { normalizeLngLat } from '../utils/geocodeParams.js'
import { authenticate } from '../middleware/auth.js'
import { rateLimit } from '../utils/rateLimit.js'

const router = express.Router()

// v1.13.281：本路由组原先**既无鉴权也无速度上限** —— 任何人都能拿服务端的 AMAP_KEY
// 去刷高德地理编码 / 搜索建议 / 行政区划，配额被刷爆只需要一个 curl 循环。
// ⚠️ `/ip-location` 与 `/suggest` 在前端是**裸 fetch** 调用的，挂 authenticate 后
//    必须同步给那两处补 Authorization 头，否则地图页定位与地址搜索会 401。
router.use(authenticate)
// 60 次/分钟兜底：地址解析的**批量**入口走 /api/poi/batch-geocode（那里另有 10 次/分钟）。
router.use(rateLimit({ max: 60, windowMs: 60 * 1000, name: 'geocode' }))

// 高德 Web 服务 Key
const AMap_KEY = AMAP_KEY

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
  
  const amapReq = https.get(url, (apiRes) => {
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
  // L6：10s 超时（destroy 携带 error → 触发上面的 error 处理返回 500）
  amapReq.setTimeout(10000, () => amapReq.destroy(new Error('高德地理编码请求超时(10s)')))
})

// 搜索建议：模糊匹配，返回提示列表
router.get('/suggest', async (req, res) => {
  const rawKeyword = req.query.keyword
  if (!rawKeyword) {
    return res.status(400).json({ error: '关键词不能为空' })
  }

  const keyword = ensureProperEncoding(rawKeyword)

  // v1.13.287：可选「就近偏置」—— lng/lat 传当前地图中心。
  // 🔴 必须在**查询阶段**偏置，不能只在前端重排：实测「寿司郎」无偏置时前 10 条
  //    全是北京/武汉/深圳/宁波，**一条上海都没有** ⇒ 前端再怎么排也排不出本城的店。
  //    传 location 后高德按距离排序，前 6 条立刻变成本城各分店。
  const bias = normalizeLngLat(req.query.lng, req.query.lat)
  // v1.13.287：当前城市（由前端用 /regeo 反查后传入）。
  // 🔴 只传 city、**不加 citylimit**：实测 citylimit=true 会按行政区字段过滤，
  //    而没有 city 字段的连锁 POI 会被**直接误杀**（「寿司郎」在上海 citylimit=true 返回 0 条，
  //    不加 limit 时前 6 条全是上海门店）。所以 city 只当「优先」，不当「限定」。
  const city = String(req.query.city || '').trim().slice(0, 20)

  // ===== v1.13.263：优先腾讯（分流高德配额）=====
  // 地址搜索建议对「数据源一致性」不敏感（用户只是选个地址），所以切腾讯是安全的。
  // ⚠️ 与 POI 分类计数不同：那个绝不能换源（分类体系不同会让评分漂移）。
  if (isTencentMapEnabled()) {
    try {
      const results = await suggestByTencent(keyword, city || undefined, bias)
      if (results.length > 0) {
        return res.json({ success: true, results })
      }
      // 腾讯无结果 ⇒ 继续走高德（两家库不同，高德可能命中）
    } catch (e) {
      console.warn('[suggest] 腾讯失败，回退高德:', e.message)
    }
  }

  const encodedKeyword = encodeURIComponent(keyword)
  // 使用高德搜索建议API
  // 高德的 location 是「经度在前、纬度在后」，与 lat/lng 的习惯顺序相反 —— 这里显式拼。
  const locPart = bias ? `&location=${bias.lng},${bias.lat}` : ''
  const cityPart = city ? `&city=${encodeURIComponent(city)}` : ''
  const url = `https://restapi.amap.com/v3/assistant/inputtips?keywords=${encodedKeyword}&key=${AMap_KEY}${cityPart}${locPart}`
  
  const amapReq = https.get(url, (apiRes) => {
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
  // L6：10s 超时
  amapReq.setTimeout(10000, () => amapReq.destroy(new Error('高德搜索建议请求超时(10s)')))
})

// IP定位缓存：{ ip: { result, expireAt } }，24小时有效
const ipLocCache = new Map()
const IP_CACHE_TTL = 24 * 60 * 60 * 1000

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

  // 命中缓存直接返回（避免每次登录都请求高德API）
  if (clientIP) {
    const cached = ipLocCache.get(clientIP)
    if (cached && cached.expireAt > Date.now()) {
      console.log('[IP定位] 命中缓存:', cached.result.city)
      return res.json(cached.result)
    }
  }

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
            const result = {
              success: true,
              lat, lng,
              city: json.city || defaultLocation.city,
              province: json.province || '',
            }
            if (clientIP) ipLocCache.set(clientIP, { result, expireAt: Date.now() + IP_CACHE_TTL })
            res.json(result)
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
// ============================================================================
// 逆地理编码（v1.13.287）
// GET /api/geocode/regeo?lng=&lat=  →  { city, district, province }
//
// 用途：地址搜索要「当前城市优先」，而前端没有城市边界数据 ⇒ 用地图中心反查城市名，
// 再把它作为 city 传给 /suggest（只当优先，不当限定，见 /suggest 处注释）。
//
// 成本控制（不便宜的东西不要每次拖动都调）：
//   · 只有前端**在搜索时**才调，不是 onmove 轮询；
//   · 按 0.02°（≈2km）网格缓存 24h；
//   · 缓存上限 500 条，满了整体清空（城市名几乎不变，不需要 LRU）。
// ============================================================================
const regeoCache = new Map()
const REGEO_TTL = 24 * 60 * 60 * 1000
const REGEO_MAX = 500

router.get('/regeo', (req, res) => {
  const pos = normalizeLngLat(req.query.lng, req.query.lat)
  if (!pos) return res.status(400).json({ success: false, message: '缺少或非法的 lng/lat' })

  const key = `${pos.lng.toFixed(2)},${pos.lat.toFixed(2)}`
  const hit = regeoCache.get(key)
  if (hit && hit.expireAt > Date.now()) {
    return res.json({ success: true, cached: true, ...hit.data })
  }

  const url = `https://restapi.amap.com/v3/geocode/regeo?location=${pos.lng},${pos.lat}&key=${AMap_KEY}&extensions=base`
  const apiReq = https.get(url, (apiRes) => {
    let data = ''
    apiRes.on('data', (chunk) => { data += chunk })
    apiRes.on('end', () => {
      try {
        const json = JSON.parse(data)
        const ac = (json && json.regeocode && json.regeocode.addressComponent) || {}
        // 高德对直辖市（北京/上海/天津/重庆）的 city 常常返回空数组 ⇒ 用 province 兜底
        const pick = (v) => (Array.isArray(v) ? (v[0] || '') : (v || ''))
        const province = pick(ac.province)
        const city = pick(ac.city) || province
        const payload = { city, district: pick(ac.district), province }
        if (json.status === '1' && city) {
          if (regeoCache.size >= REGEO_MAX) regeoCache.clear()
          regeoCache.set(key, { data: payload, expireAt: Date.now() + REGEO_TTL })
        }
        res.json({ success: json.status === '1', ...payload })
      } catch (e) {
        console.error('[regeo] 解析失败:', e.message)
        res.json({ success: false, city: '', district: '', province: '' })
      }
    })
  }).on('error', (e) => {
    console.error('[regeo] 请求失败:', e.message)
    res.json({ success: false, city: '', district: '', province: '' })
  })
  apiReq.setTimeout(8000, () => apiReq.destroy(new Error('逆地理编码请求超时(8s)')))
})

router.get('/district', (req, res) => {
  const rawCity = req.query.city
  if (!rawCity) return res.status(400).json({ error: '城市名不能为空' })
  const city = ensureProperEncoding(rawCity)
  const url = `https://restapi.amap.com/v3/config/district?keywords=${encodeURIComponent(city)}&key=${AMap_KEY}&extensions=all&subdistrict=0`
  const amapReq = https.get(url, (apiRes) => {
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
  // L6：10s 超时
  amapReq.setTimeout(10000, () => amapReq.destroy(new Error('高德行政区划请求超时(10s)')))
})

export default router
