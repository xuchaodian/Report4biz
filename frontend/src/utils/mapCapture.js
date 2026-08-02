/**
 * 地图截图引擎（Canvas 离屏渲染）
 * 从 MyAccountView 抽取，供个人中心/导出报表/查询结果框等跨组件复用
 * 纯函数实现，不依赖组件实例；瓦片通过 /api/tile-proxy 代理加载
 */
import axios from 'axios'

// 加载品牌图标映射（当前用户可见的图标：自己的 + 管理员共享的）
const loadBrandIcons = async () => {
  try {
    const { data } = await axios.get('/api/brand-icons')
    const map = {}
    ;(data.icons || []).forEach(ic => { map[ic.brand] = `/uploads/brand-icons/${ic.filename}` })
    return map
  } catch (e) {
    console.warn('[截图] 品牌图标加载失败:', e)
    return {}
  }
}

// 预加载图标图片（失败自动跳过，返回可用的映射）
const preloadIconImages = async (brandIconMap) => {
  const imgs = {}
  await Promise.all(Object.entries(brandIconMap).map(([brand, url]) => new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { imgs[brand] = img; resolve() }
    img.onerror = () => resolve()
    img.src = url
  })))
  return imgs
}

// 竞品品牌颜色映射
const compBrandColors = {
  '大米先生': '#e6a23c',
  '谷田稻香': '#f56c6c',
  '吉野家': '#409eff',
  '老乡鸡': '#67c23a',
  '米村拌饭': '#9c27b0',
  '其他': '#ff9800'
}

const getCompBrandColor = (brand) => {
  if (!brand) return compBrandColors['其他']
  for (const key in compBrandColors) {
    if (brand.includes(key) || key.includes(brand)) return compBrandColors[key]
  }
  return compBrandColors['其他']
}

// 经纬度 → 瓦片坐标（Web墨卡托）
const latLngToTileMeters = (lat, lng, zoom) => {
  const n = Math.pow(2, zoom)
  const x = ((lng + 180) / 360 * n)
  const latRad = lat * Math.PI / 180
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  return { x, y }
}

// 共享的图钉绘制函数
const drawPin = (ctx, x, y, color, label) => {
  const pinH = 44  // 图钉总高度
  const headR = 13 // 头部圆半径

  // 图钉形状：圆头 + 尖底
  ctx.save()
  
  // 主图钉形状（带阴影）
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 2

  // 绘制圆头
  ctx.beginPath()
  ctx.arc(x, y - pinH / 2 + headR, headR, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()

  // 绘制尖底
  ctx.beginPath()
  ctx.moveTo(x - headR + 2, y - pinH / 2 + headR)
  ctx.lineTo(x + headR - 2, y - pinH / 2 + headR)
  ctx.lineTo(x, y + pinH / 2)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()

  // 高光
  ctx.shadowColor = 'transparent'
  ctx.beginPath()
  ctx.arc(x - 2, y - pinH / 2 + headR - 2, 3, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fill()

  // 白色描边
  ctx.beginPath()
  ctx.arc(x, y - pinH / 2 + headR, headR, 0, Math.PI * 2)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x - headR + 2, y - pinH / 2 + headR)
  ctx.lineTo(x + headR - 2, y - pinH / 2 + headR)
  ctx.lineTo(x, y + pinH / 2)
  ctx.closePath()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.stroke()

  // 首字母
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 12px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label ? label.charAt(0).toUpperCase() : 'C', x, y - pinH / 2 + headR)

  ctx.restore()
}

// 纯 Canvas 渲染竞品地图截图
const captureMapToCanvas = async (centerLat, centerLng, radiusMeters, competitors, zoom = 14, brandIcons = null) => {
  // 2倍画布尺寸
  const CANVAS_W = 1420
  const CANVAS_H = 930
  const TILE_SIZE = 256

  // 半径固定输出3km
  const DISPLAY_RADIUS = 3000

  // 直接用zoom 14（覆盖3km范围，画面比例合适）
  const metersPerPixel = 156543.03 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom)

  // 加载品牌图标（未传入时自动获取当前用户可见图标）
  const brandIconMap = brandIcons || await loadBrandIcons()
  const iconImgs = await preloadIconImages(brandIconMap)

  // 创建 canvas
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')

  // 白色背景
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  // 中心点的瓦片坐标（像素级）
  const center = latLngToTileMeters(centerLat, centerLng, zoom)
  const centerPxX = center.x * TILE_SIZE
  const centerPxY = center.y * TILE_SIZE
  const halfW = CANVAS_W / 2
  const halfH = CANVAS_H / 2

  // 计算可见瓦片范围
  const minTileX = Math.floor((centerPxX - halfW) / TILE_SIZE)
  const maxTileX = Math.floor((centerPxX + CANVAS_W - halfW - 1) / TILE_SIZE)
  const minTileY = Math.floor((centerPxY - halfH) / TILE_SIZE)
  const maxTileY = Math.floor((centerPxY + CANVAS_H - halfH - 1) / TILE_SIZE)
  const n = Math.pow(2, zoom)

  // 加载瓦片
  const tiles = []
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const wtX = ((tx % n) + n) % n
      const wtY = ((ty % n) + n) % n

      const img = new Image()
      img.crossOrigin = 'anonymous'
      const loadPromise = new Promise(r => { img.onload = () => r(true); img.onerror = () => r(false) })
      img.src = `/api/tile-proxy/${zoom}/${wtX}/${wtY}.png`

      const drawX = Math.round(tx * TILE_SIZE - centerPxX + halfW)
      const drawY = Math.round(ty * TILE_SIZE - centerPxY + halfH)
      tiles.push({ img, drawX, drawY, loaded: loadPromise })
    }
  }

  // 等待所有瓦片加载（最多 6 秒）
  await Promise.race([
    Promise.all(tiles.map(t => t.loaded)),
    new Promise(r => setTimeout(r, 6000))
  ])

  // 绘制瓦片（灰色滤镜，与系统内高德地图灰色样式一致）
  ctx.filter = 'grayscale(100%) brightness(1.05)'
  for (const tile of tiles) {
    try { ctx.drawImage(tile.img, tile.drawX, tile.drawY, TILE_SIZE, TILE_SIZE) } catch (e) {}
  }
  ctx.filter = 'none'

  // === 绘制竞品元素 ===

  // 半径圆（固定3km）
  const radiusPx = DISPLAY_RADIUS / metersPerPixel
  ctx.beginPath()
  ctx.arc(halfW, halfH, radiusPx, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(245, 108, 108, 0.12)'
  ctx.fill()
  ctx.strokeStyle = '#f56c6c'
  ctx.lineWidth = 4
  ctx.stroke()

  // 半径文字标注
  ctx.fillStyle = '#f56c6c'
  ctx.font = 'bold 26px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const labelR = radiusPx + 40
  ctx.fillText('3km', halfW + labelR, halfH)

  // 圆心标记（红白圆点）
  const dotR = 12
  ctx.beginPath()
  ctx.arc(halfW, halfH, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = '#f56c6c'
  ctx.lineWidth = 4
  ctx.stroke()

  // 竞品标记（优先使用上传的品牌图标，无图标回退图钉；带品牌标签防重叠）
  const drawnLabels = []  // 已绘制的标签区域 {x, y, w, h}
  const pinH = 44, headR = 13
  for (const comp of competitors) {
    const compPos = latLngToTileMeters(comp.latitude, comp.longitude, zoom)
    const compPxX = (compPos.x - center.x) * TILE_SIZE + halfW
    const compPxY = (compPos.y - center.y) * TILE_SIZE + halfH

    if (compPxX < -80 || compPxX > CANVAS_W + 80 || compPxY < -80 || compPxY > CANVAS_H + 80) continue

    const color = getCompBrandColor(comp.brand || '')
    const labelText = comp.brand || ''
    const iconImg = iconImgs[comp.brand || '']

    if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
      // 使用上传的品牌图标（圆形裁剪 + 白边）
      const iconSize = 38
      ctx.save()
      ctx.beginPath()
      ctx.arc(compPxX, compPxY, iconSize / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(iconImg, compPxX - iconSize / 2, compPxY - iconSize / 2, iconSize, iconSize)
      ctx.restore()
      ctx.beginPath()
      ctx.arc(compPxX, compPxY, iconSize / 2, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.stroke()
    } else {
      // 回退：图钉 + 首字母
      drawPin(ctx, compPxX, compPxY, color, '')
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 14px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(labelText ? labelText.charAt(0).toUpperCase() : 'C', compPxX, compPxY - pinH / 2 + headR)
    }

    // 绘制品牌标签（带防重叠检测）
    if (labelText) {
      ctx.font = 'bold 14px Arial'
      const textW = ctx.measureText(labelText).width
      const labelX = compPxX
      const labelY = compPxY - pinH / 2 - 4  // 标记上方

      // 检测是否与已有标签重叠
      let overlaps = false
      for (const existing of drawnLabels) {
        const gap = 10
        if (Math.abs(labelX - existing.x) < (textW / 2 + existing.w / 2 + gap) &&
            Math.abs(labelY - existing.y) < (16 + gap)) {
          overlaps = true
          break
        }
      }

      if (!overlaps) {
        drawnLabels.push({ x: labelX, y: labelY, w: textW, h: 16 })
        ctx.fillStyle = '#333333'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(labelText, labelX, labelY)
      }
    }
  }

  // JPEG质量（0.5平衡清晰度和文件大小）
  const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
  console.log('[导出截图] Canvas渲染成功, base64长度:', dataUrl.length, '竞品数:', competitors.length)
  return dataUrl
}

// 纯 Canvas 渲染地图截图（仅门店位置+半径，无竞品/购物中心）
const captureMapOnlyCanvas = async (centerLat, centerLng, radiusMeters) => {
  const CANVAS_W = 1420
  const CANVAS_H = 930
  const TILE_SIZE = 256

  // 计算合适的zoom：让半径圈占画布较小边约30%（确保完整显示）
  const minDim = Math.min(CANVAS_W, CANVAS_H)  // 930
  const targetRatio = 0.30
  const targetRadiusPx = minDim * targetRatio
  const targetZoom = Math.log2(156543.03 * Math.cos(centerLat * Math.PI / 180) * targetRadiusPx / radiusMeters)
  const zoom = Math.min(18, Math.max(12, Math.floor(targetZoom)))
  const metersPerPixel = 156543.03 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom)

  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  const center = latLngToTileMeters(centerLat, centerLng, zoom)
  const centerPxX = center.x * TILE_SIZE
  const centerPxY = center.y * TILE_SIZE
  const halfW = CANVAS_W / 2
  const halfH = CANVAS_H / 2

  // 计算可见瓦片范围
  const minTileX = Math.floor((centerPxX - halfW) / TILE_SIZE)
  const maxTileX = Math.floor((centerPxX + CANVAS_W - halfW - 1) / TILE_SIZE)
  const minTileY = Math.floor((centerPxY - halfH) / TILE_SIZE)
  const maxTileY = Math.floor((centerPxY + CANVAS_H - halfH - 1) / TILE_SIZE)
  const n = Math.pow(2, zoom)

  const tiles = []
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const wtX = ((tx % n) + n) % n
      const wtY = ((ty % n) + n) % n
      const img = new Image()
      img.crossOrigin = 'anonymous'
      const loadPromise = new Promise(r => { img.onload = () => r(true); img.onerror = () => r(false) })
      img.src = `/api/tile-proxy/${zoom}/${wtX}/${wtY}.png`
      const drawX = Math.round(tx * TILE_SIZE - centerPxX + halfW)
      const drawY = Math.round(ty * TILE_SIZE - centerPxY + halfH)
      tiles.push({ img, drawX, drawY, loaded: loadPromise })
    }
  }

  await Promise.race([
    Promise.all(tiles.map(t => t.loaded)),
    new Promise(r => setTimeout(r, 6000))
  ])

  // 灰色地图
  ctx.filter = 'grayscale(100%) brightness(1.05)'
  for (const tile of tiles) {
    try { ctx.drawImage(tile.img, tile.drawX, tile.drawY, TILE_SIZE, TILE_SIZE) } catch (e) {}
  }
  ctx.filter = 'none'

  // 半径圆
  const radiusPx = radiusMeters / metersPerPixel
  ctx.beginPath()
  ctx.arc(halfW, halfH, radiusPx, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(245, 108, 108, 0.12)'
  ctx.fill()
  ctx.strokeStyle = '#f56c6c'
  ctx.lineWidth = 4
  ctx.stroke()

  // 半径文字标注
  const radiusKm = (radiusMeters / 1000).toFixed(2)
  ctx.fillStyle = '#f56c6c'
  ctx.font = 'bold 26px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const labelR = radiusPx + 70
  ctx.fillText(`${radiusKm}km`, halfW + labelR, halfH)

  // 圆心标记（红白圆点）
  const dotR = 12
  ctx.beginPath()
  ctx.arc(halfW, halfH, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = '#f56c6c'
  ctx.lineWidth = 4
  ctx.stroke()

  const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
  console.log('[导出截图] 地图Canvas渲染成功, base64长度:', dataUrl.length, 'radius:', radiusMeters, 'zoom:', zoom)
  return dataUrl
}

// 购物中心地图截图
const captureShoppingCenterMap = async (centerLat, centerLng, centers, zoom = 14) => {
  const CANVAS_W = 1420
  const CANVAS_H = 930
  const TILE_SIZE = 256
  const DISPLAY_RADIUS = 3000

  const metersPerPixel = 156543.03 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom)

  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  const center = latLngToTileMeters(centerLat, centerLng, zoom)
  const centerPxX = center.x * TILE_SIZE
  const centerPxY = center.y * TILE_SIZE
  const halfW = CANVAS_W / 2
  const halfH = CANVAS_H / 2

  const minTileX = Math.floor((centerPxX - halfW) / TILE_SIZE)
  const maxTileX = Math.floor((centerPxX + CANVAS_W - halfW - 1) / TILE_SIZE)
  const minTileY = Math.floor((centerPxY - halfH) / TILE_SIZE)
  const maxTileY = Math.floor((centerPxY + CANVAS_H - halfH - 1) / TILE_SIZE)
  const n = Math.pow(2, zoom)

  const tiles = []
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const wtX = ((tx % n) + n) % n
      const wtY = ((ty % n) + n) % n
      const img = new Image()
      img.crossOrigin = 'anonymous'
      const loadPromise = new Promise(r => { img.onload = () => r(true); img.onerror = () => r(false) })
      img.src = `/api/tile-proxy/${zoom}/${wtX}/${wtY}.png`
      const drawX = Math.round(tx * TILE_SIZE - centerPxX + halfW)
      const drawY = Math.round(ty * TILE_SIZE - centerPxY + halfH)
      tiles.push({ img, drawX, drawY, loaded: loadPromise })
    }
  }

  await Promise.race([
    Promise.all(tiles.map(t => t.loaded)),
    new Promise(r => setTimeout(r, 6000))
  ])

  // 灰色地图
  ctx.filter = 'grayscale(100%) brightness(1.05)'
  for (const tile of tiles) {
    try { ctx.drawImage(tile.img, tile.drawX, tile.drawY, TILE_SIZE, TILE_SIZE) } catch (e) {}
  }
  ctx.filter = 'none'

  // 半径圆
  const radiusPx = DISPLAY_RADIUS / metersPerPixel
  ctx.beginPath()
  ctx.arc(halfW, halfH, radiusPx, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(245, 108, 108, 0.12)'
  ctx.fill()
  ctx.strokeStyle = '#f56c6c'
  ctx.lineWidth = 4
  ctx.stroke()

  // 半径文字标注
  const radiusKm = (DISPLAY_RADIUS / 1000).toFixed(0)
  ctx.fillStyle = '#f56c6c'
  ctx.font = 'bold 26px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const labelR = radiusPx + 70
  ctx.fillText(`${radiusKm}km`, halfW + labelR, halfH)

  // 圆心标记
  const dotR = 12
  ctx.beginPath()
  ctx.arc(halfW, halfH, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = '#f56c6c'
  ctx.lineWidth = 4
  ctx.stroke()

  // 购物中心标记 - 绿色图钉（与竞品地图样式一致）
  const drawnLabels = []
  for (const sc of centers) {
    const pos = latLngToTileMeters(sc.latitude, sc.longitude, zoom)
    const px = (pos.x - center.x) * TILE_SIZE + halfW
    const py = (pos.y - center.y) * TILE_SIZE + halfH

    if (px < -80 || px > CANVAS_W + 80 || py < -80 || py > CANVAS_H + 80) continue

    const color = '#67c23a'
    const labelText = sc.name || ''

    // 画绿色图钉
    drawPin(ctx, px, py, color, labelText)

    // 名称标签（防重叠）
    const pinH = 44
    ctx.font = 'bold 13px Arial'
    const textW = ctx.measureText(labelText).width
    const lx = px
    const ly = py - pinH / 2 - 4  // 图钉上方

    let overlaps = false
    for (const e of drawnLabels) {
      if (Math.abs(lx - e.x) < (textW / 2 + e.w / 2 + 10) && Math.abs(ly - e.y) < (16 + 10)) {
        overlaps = true; break
      }
    }
    if (!overlaps && labelText) {
      drawnLabels.push({ x: lx, y: ly, w: textW, h: 16 })
      ctx.fillStyle = '#333333'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(labelText, lx, ly)
    }
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
  console.log('[导出截图] 购物中心Canvas渲染成功, base64长度:', dataUrl.length, '购物中心数:', centers.length)
  return dataUrl
}

// 同时挂载到全局（兼容旧入口）
window.__captureMapToCanvas = captureMapToCanvas
window.__captureMapOnlyCanvas = captureMapOnlyCanvas
window.__captureShoppingCenterMap = captureShoppingCenterMap

export {
  captureMapToCanvas,
  captureMapOnlyCanvas,
  captureShoppingCenterMap
}
