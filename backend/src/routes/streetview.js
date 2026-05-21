/**
 * 腾讯地图街景 API 代理路由
 *
 * 功能：
 * 1. URI 跳转街景全景页面（方案A，推荐）
 * 2. 静态街景图片代理（备用）
 *
 * API Key 仅存于服务端，前端不暴露。
 */

import express from 'express'

const router = express.Router()

// 腾讯位置服务 API Key
const KEY = 'PL5BZ-HGV6J-MC2FC-DXNCT-EF6W3-EWFKU'

/**
 * GET /api/streetview/open?lat=&lng=
 * 跳转到腾讯地图街景全景页面（方案A：URI 跳转）
 */
router.get('/open', (req, res) => {
  const { lat, lng } = req.query
  if (!lat || !lng) {
    return res.status(400).json({ success: false, error: '缺少 lat/lng 参数' })
  }

  const uri = `https://apis.map.qq.com/uri/v1/streetview?location=${lat},${lng}&key=${KEY}`
  res.redirect(302, uri)
})

export default router
