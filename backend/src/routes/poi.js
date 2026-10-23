import express from 'express'
import { aroundSearch, polygonSearch, textSearch, geocode } from '../utils/amapPoi.js'

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
 * 限流类错误（高德 QPS 超限）判定。
 * 🔴 v1.13.262：命中就**不再重试** —— 上一版被限流后还 sleep 400ms 再补一刀，
 *    只会把 QPS 打得更死（生产日志里 COQPS 报错就是这么堆出来的）。
 */
function isQuotaError(e) {
  return /CUQPS_HAS_EXCEEDED_THE_LIMIT|CUQPS/i.test(String(e?.message || ''))
}

/**
 * 按类目逐个统计某点半径内的 POI 数量（串行）。
 *
 * 🔴 降级语义（v1.13.262）：某类目没查到时 `counts[key] = null`（**未知**），
 *    ⛔ 不是 0 —— 0 的含义是「确实一家都没有」，两者不能混。前端据 null 显示「—」。
 *    （项目铁律：缺数据恒 null）
 *
 * @returns {{ counts: Record<string, number|null>, degradedKeys: string[] }}
 */
async function countPoiByTypes(lng, lat, radius, cats) {
  const counts = {}
  const degradedKeys = []
  // 🔴 调用间隔（v1.13.262 实测得出）：高德 Web 服务 QPS 限制约 3 次/秒，
  //    串行紧挨着发必被打满 —— 生产实测 5 类里第 5 个就 `CUQPS_HAS_EXCEEDED_THE_LIMIT`，
  //    紧接着再请求一次会 5 类全挂。
  //    ⛔ 上一版靠「失败后 sleep 400ms 重试」硬扛，那是先违约再补救，反而把 QPS 打得更死。
  //    ⇒ 改成**发之前**统一间隔 350ms（≈2.8 次/秒）。慢 ~1s，但换来不再降级。
  const GAP_MS = 350
  for (let i = 0; i < cats.length; i++) {
    const cat = cats[i]
    if (i > 0) await new Promise(r => setTimeout(r, GAP_MS))
    let count = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await aroundSearch(lng, lat, radius, '', cat.types)
        count = result.count || 0
        break
      } catch (e) {
        if (isQuotaError(e)) {
          // 限流 ⇒ 直接降级，不重试
          console.warn(`POI[${cat.key}] 被限流，降级为未知（不重试）`)
          break
        }
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 400))
          continue
        }
        console.warn(`POI[${cat.key}] 查询失败:`, e.message)
      }
    }
    counts[cat.key] = count
    if (count === null) degradedKeys.push(cat.key)
  }
  return { counts, degradedKeys }
}

/** 求和时跳过未知（null），⛔ 不要把 null 当 0 累加 */
function sumKnown(counts) {
  let total = 0
  for (const v of Object.values(counts)) {
    if (typeof v === 'number') total += v
  }
  return total
}

// 商业成熟度缓存（v1.13.262 新增）
// 🔴 必须与 envScoreCache **分开存**：两者类目不同（business 5 类 / env 8 类），
//    共用同一个 Map 会按同一 cacheKey 串数据（后写的覆盖前者，读出来缺维度）。
const businessCache = new Map()
const BUSINESS_CACHE_TTL = 24 * 60 * 60 * 1000 // 24h

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
    const lngN = parseFloat(lng)
    const latN = parseFloat(lat)
    const rN = Number(radius)

    // 入参为系统内 GCJ-02 坐标（全链路一致），高德 around 要求 GCJ-02，直接透传
    // （v1.13.103 B1 修复：原在此 wgs84ToGcj02 二次转换 → 门店 GCJ-02 被再转一次，检索圆心偏移 ~500m）

    const cacheKey = `${lngN.toFixed(5)},${latN.toFixed(5)},${rN}`
    const cached = businessCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < BUSINESS_CACHE_TTL) {
      return res.json({ ...cached.payload, fromCache: true })
    }

    const { counts, degradedKeys } = await countPoiByTypes(lngN, latN, rN, BUSINESS_POI_TYPES)
    const payload = {
      success: true,
      radius: rN,
      counts,
      total: sumKnown(counts),
      degraded: degradedKeys.length > 0,
      degradedKeys
    }

    // 🔴 降级结果**不写缓存**：把「8 类里 3 类没查到」的结果缓存 24h，
    //    等于让用户一整天都看到偏低的分数。宁可下次重新查。
    if (degradedKeys.length === 0) {
      businessCache.set(cacheKey, { payload, ts: Date.now() })
      if (businessCache.size > 5000) {
        const keys = [...businessCache.keys()].slice(0, 2500)
        keys.forEach(k => businessCache.delete(k))
      }
    }

    res.json(payload)
  } catch (error) {
    console.error('商业成熟度统计失败:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// 周边环境打分卡 POI 分类（8 类）
const ENV_POI_TYPES = [
  { key: 'mall', label: '购物中心', types: '060100' },
  { key: 'restaurant', label: '餐饮', types: '050000' },
  { key: 'office', label: '写字楼', types: '120200' },
  { key: 'school', label: '学校', types: '141200' },
  { key: 'hospital', label: '医院', types: '090100' },
  { key: 'hotel', label: '酒店', types: '100100' },
  { key: 'bank', label: '银行', types: '160100' },
  { key: 'transit', label: '地铁/公交', types: '150500' }
]

// 环境打分卡缓存（内存 Map，简单够用）
const envScoreCache = new Map()
const ENV_CACHE_TTL = 24 * 60 * 60 * 1000 // 24h

/**
 * 周边环境打分卡：统计指定半径内 8 类商业 POI 数量
 * POST /api/poi/environment-score
 * Body: { lng, lat, radius }
 */
router.post('/environment-score', async (req, res) => {
  try {
    const { lng, lat, radius = 500 } = req.body
    if (!lng || !lat) {
      return res.status(400).json({ error: '缺少经纬度参数' })
    }
    const lngN = Number(lng)
    const latN = Number(lat)
    const rN = Number(radius)
    if (rN > 5000) {
      return res.status(400).json({ error: '半径最大 5000 米' })
    }

    // 缓存命中
    const cacheKey = `${lngN.toFixed(5)},${latN.toFixed(5)},${rN}`
    const cached = envScoreCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < ENV_CACHE_TTL) {
      return res.json({ success: true, radius: rN, counts: cached.counts, total: cached.total, fromCache: true })
    }

    // v1.13.262：改用公共 helper —— 限流时直接降级（不重试），缺失类目记 null
    const { counts, degradedKeys } = await countPoiByTypes(lngN, latN, rN, ENV_POI_TYPES)
    const total = sumKnown(counts)

    // 🔴 降级结果不写缓存（见 business-count 同处注释）
    if (degradedKeys.length === 0) {
      envScoreCache.set(cacheKey, { counts, total, ts: Date.now() })
      if (envScoreCache.size > 5000) {
        // 简单清理：删除最早一半
        const keys = [...envScoreCache.keys()].slice(0, 2500)
        keys.forEach(k => envScoreCache.delete(k))
      }
    } else {
      console.warn(`[environment-score] 降级（${degradedKeys.join(',')} 未取到），本次结果不缓存`)
    }

    res.json({
      success: true, radius: rN, counts, total,
      degraded: degradedKeys.length > 0,
      degradedKeys,
      fromCache: false
    })
  } catch (error) {
    console.error('环境打分统计失败:', error.message)
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
    
    // 入参为系统内 GCJ-02（v1.13.103 B1：删除二次转换，原把 GCJ-02 当 WGS84 再转 → 圆心偏移 ~500m）
    const result = await aroundSearch(parseFloat(lng), parseFloat(lat), radius, keywords, types)
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
    
    // 入参为系统内 GCJ-02（v1.13.103 B1：删除二次转换），直接构建多边形字符串
    const polygon = coordinates
      .map(coord => `${parseFloat(coord.lng)},${parseFloat(coord.lat)}`)
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
