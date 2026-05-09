/**
 * 瓦片代理路由 - 解决 html2canvas 截取地图时的 CORS 问题
 *
 * 原理：
 * 从国内可直接访问高德（Amap）瓦片服务器，但前端浏览器因 CORS 限制
 * 无法被 html2canvas 读取（某些场景），本代理让请求经过同源后端转发，
 * 并在响应中添加 CORS 头，使 html2canvas 能正常截取地图内容。
 *
 * 使用高德瓦片而非 OSM，因为 OSM 从国内服务器无法访问。
 */

import express from 'express'
import axios from 'axios'

const router = express.Router()

// 高德瓦片子域名 (1-4)
const AMAP_SUBDOMAINS = [1, 2, 3, 4]

// 简单内存缓存
const tileCache = new Map()
const CACHE_MAX = 500
const CACHE_TTL = 3600000 // 1 小时

/**
 * GET /api/tile-proxy/:z/:x/:y.png
 * 代理高德瓦片请求
 */
router.get('/:z/:x/:y.png', async (req, res) => {
  const { z, x, y } = req.params
  const cacheKey = `${z}/${x}/${y}`

  // 检查缓存
  const cached = tileCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    res.set({
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
      'Content-Length': cached.data.length
    })
    return res.send(cached.data)
  }

  // 轮询子域名
  const subdomain = AMAP_SUBDOMAINS[Math.floor(Math.random() * AMAP_SUBDOMAINS.length)]
  const tileUrl = `https://webrd0${subdomain}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=${x}&y=${y}&z=${z}`

  try {
    const response = await axios.get(tileUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Report4biz/1.0)',
        'Referer': 'https://mka-online.cn/'
      }
    })

    const buffer = Buffer.from(response.data)

    // 写入缓存
    if (tileCache.size >= CACHE_MAX) {
      const firstKey = tileCache.keys().next().value
      tileCache.delete(firstKey)
    }
    tileCache.set(cacheKey, {
      data: buffer,
      expires: Date.now() + CACHE_TTL
    })

    res.set({
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
      'Content-Length': buffer.length
    })

    res.send(buffer)
  } catch (error) {
    console.error(`[TileProxy] 瓦片加载失败 ${cacheKey}: ${error.message}`)
    // 尝试从其他子域名重试
    try {
      const altSubdomain = ((subdomain % 4) + 1)
      const altUrl = `https://webrd0${altSubdomain}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=${x}&y=${y}&z=${z}`
      const retry = await axios.get(altUrl, {
        responseType: 'arraybuffer',
        timeout: 10000
      })
      const retryBuffer = Buffer.from(retry.data)
      res.set({
        'Content-Type': 'image/png',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': retryBuffer.length
      })
      res.send(retryBuffer)
    } catch (retryError) {
      console.error(`[TileProxy] 重试也失败 ${cacheKey}: ${retryError.message}`)
      res.status(504).end()
    }
  }
})

export default router
