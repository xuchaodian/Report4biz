// POI搜索接口（后端代理）
async function callPoiApi(endpoint, params) {
  const response = await fetch(`/api/poi/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  return response.json()
}

// 地理编码：将地址转换为坐标（使用高德API）
async function geocodeAddress(address) {
  try {
    const result = await callPoiApi('geocode', { address })
    if (result.success) {
      return {
        lng: result.lng,
        lat: result.lat,
        formatted_address: result.formatted_address
      }
    }
    return null
  } catch (e) {
    console.error('[Geocode] Error:', e)
    return null
  }
}

// 解析location参数：支持坐标格式 "lng,lat" 或 地址字符串
// 返回 { lng, lat } 或 null（需要用户点击地图）
function parseLocation(loc) {
  if (!loc) return null
  
  // 检查是否是坐标格式 "lng,lat"
  if (typeof loc === 'string' && loc.includes(',')) {
    const parts = loc.split(',')
    const lng = parseFloat(parts[0])
    const lat = parseFloat(parts[1])
    if (!isNaN(lng) && !isNaN(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
      return { lng, lat }
    }
  }
  
  // 如果不是有效坐标格式，返回 null 表示需要用户选择
  return null
}

/**
 * GeoManager AI 执行器中心
 *
 * 负责将 AI 返回的 tool_calls 转换为实际的地图操作。
 *
 * 新增工具时，只需在此文件末尾追加对应的 case 分支即可。
 *
 * @param {string} name - 工具名称
 * @param {object} args - 工具参数
 * @param {object} ctx - 地图上下文（store refs 等）
 * @param {object} ctx.map - Leaflet 地图实例
 * @param {object} ctx.markerStore - 门店 store
 * @param {object} ctx.competitorStore - 竞品 store
 * @param {object} ctx.brandStoreStore - 品牌门店 store
 * @param {object} ctx.shoppingCenterStore - 购物中心 store
 * @param {object} ctx.showCompetitorLayer - 竞品图层可见性 ref
 * @param {object} ctx.showBrandStoreLayer - 品牌门店图层可见性 ref
 * @param {object} ctx.showShoppingCenterLayer - 购物中心图层可见性 ref
 * @param {object} ctx.showBusinessLayer - 我的门店图层可见性 ref
 * @param {object} ctx.showHeatmap - 热力图可见性 ref
 * @param {object} ctx.showCluster - 聚合可见性 ref
 * @param {object} ctx.toggleHeatmap - 热力图切换函数
 * @param {object} ctx.toggleCluster - 聚合切换函数
 * @param {object} ctx.clearDrawings - 清除绘制函数
 * @param {object} ctx.setTool - 激活工具函数
 * @returns {Promise<void>}
 */
export async function executeTool(name, args, ctx) {
  const {
    map,
    markerStore, competitorStore, brandStoreStore, shoppingCenterStore,
    showCompetitorLayer, showBrandStoreLayer, showShoppingCenterLayer, showBusinessLayer,
    showHeatmap, showCluster,
    toggleHeatmap, toggleCluster, clearDrawings, setTool
  } = ctx

  switch (name) {

    // ===== 我的门店 =====
    case 'filter_markers': {
      const filtered = markerStore.markers.filter(m => {
        if (args.city && !m.city?.includes(args.city)) return false
        if (args.district && !m.district?.includes(args.district)) return false
        if (args.store_type && m.store_type !== args.store_type) return false
        if (args.store_category && m.store_category !== args.store_category) return false
        if (args.brand && !m.brand?.includes(args.brand)) return false
        if (args.keyword) {
          const kw = args.keyword.toLowerCase()
          if (!m.name?.toLowerCase().includes(kw) && !m.address?.toLowerCase().includes(kw)) return false
        }
        return true
      })
      markerStore.setVisibleIds(filtered.map(m => m.id))
      showBusinessLayer.value = true
      return { success: true, message: `已筛选，显示 ${filtered.length} 家门店` }
    }

    // ===== 竞品门店 =====
    case 'filter_competitors': {
      const filtered = competitorStore.competitors.filter(m => {
        if (args.city && !m.city?.includes(args.city)) return false
        if (args.district && !m.district?.includes(args.district)) return false
        if (args.brand && !m.brand?.includes(args.brand)) return false
        if (args.keyword) {
          const kw = args.keyword.toLowerCase()
          if (!m.name?.toLowerCase().includes(kw) && !m.address?.toLowerCase().includes(kw)) return false
        }
        return true
      })
      competitorStore.setVisibleIds(filtered.map(m => m.id))
      showCompetitorLayer.value = true
      return { success: true, message: `已筛选竞品，显示 ${filtered.length} 家` }
    }

    // ===== 品牌门店 =====
    case 'filter_brand_stores': {
      const filtered = brandStoreStore.brandStores.filter(m => {
        if (args.city && !m.city?.includes(args.city)) return false
        if (args.brand && !m.brand?.includes(args.brand)) return false
        if (args.keyword) {
          const kw = args.keyword.toLowerCase()
          if (!m.name?.toLowerCase().includes(kw) && !m.address?.toLowerCase().includes(kw)) return false
        }
        return true
      })
      brandStoreStore.setVisibleIds(filtered.map(m => m.id))
      showBrandStoreLayer.value = true
      return { success: true, message: `已筛选品牌门店，显示 ${filtered.length} 家` }
    }

    // ===== 购物中心 =====
    case 'filter_shopping_centers': {
      const filtered = shoppingCenterStore.shoppingCenters.filter(m => {
        if (args.city && !m.city?.includes(args.city)) return false
        if (args.keyword && !m.name?.toLowerCase().includes(args.keyword.toLowerCase())) return false
        if (args.min_stars && (!m.stars || m.stars < args.min_stars)) return false
        return true
      })
      shoppingCenterStore.setVisibleIds(filtered.map(m => m.id))
      showShoppingCenterLayer.value = true
      return { success: true, message: `已筛选购物中心，显示 ${filtered.length} 家` }
    }

    // ===== 定位城市 =====
    case 'locate_city': {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(args.location)}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'zh-CN' } }
      )
      const data = await res.json()
      if (data && data[0]) {
        const { lat, lon, boundingbox } = data[0]
        if (boundingbox) {
          map.fitBounds([
            [parseFloat(boundingbox[0]), parseFloat(boundingbox[2])],
            [parseFloat(boundingbox[1]), parseFloat(boundingbox[3])]
          ])
        } else {
          map.setView([parseFloat(lat), parseFloat(lon)], 13)
        }
        return { success: true, message: `已定位到 ${args.location}` }
      } else {
        return { success: false, message: `未找到"${args.location}"` }
      }
    }

    // ===== 图层开关 =====
    case 'toggle_layer': {
      const { layer, visible } = args
      if (layer === 'markers') showBusinessLayer.value = visible
      else if (layer === 'competitors') showCompetitorLayer.value = visible
      else if (layer === 'brand_stores') showBrandStoreLayer.value = visible
      else if (layer === 'shopping_centers') showShoppingCenterLayer.value = visible
      return { success: true, message: `图层 "${layer}" 已${visible ? '显示' : '隐藏'}` }
    }

    // ===== 清除筛选 =====
    case 'clear_filters': {
      markerStore.clearFilters()
      competitorStore.clearFilters()
      if (brandStoreStore.clearFilters) brandStoreStore.clearFilters()
      if (shoppingCenterStore.clearFilters) shoppingCenterStore.clearFilters()
      return { success: true, message: '已清除所有筛选条件' }
    }

    // ===== 激活地图工具 =====
    case 'activate_tool': {
      const { tool } = args
      if (tool === 'heatmap') {
        if (!showHeatmap.value) toggleHeatmap()
      } else if (tool === 'cluster') {
        if (!showCluster.value) toggleCluster()
      } else if (tool === 'clear') {
        clearDrawings()
      } else if (tool === 'fit') {
        // fitBounds 由外部处理，这里只返回状态
      } else {
        setTool(tool)
      }
      return { success: true, message: `已激活工具：${tool}` }
    }

    // ===== POI搜索 =====
    case 'poi_around_search': {
      let locationStr = args.location
      
      // 如果 location 不是有效坐标格式，尝试地理编码
      const parsed = parseLocation(locationStr)
      if (!parsed) {
        // location 是地址或为空，尝试地理编码
        const addressToGeocode = locationStr || args.keywords
        if (addressToGeocode) {
          console.log('[POI] 尝试地理编码:', addressToGeocode)
          const geo = await geocodeAddress(addressToGeocode)
          if (geo) {
            locationStr = `${geo.lng},${geo.lat}`
            console.log('[POI] 地理编码成功:', locationStr, geo.formatted_address)
            // 保存地址名，用于前端定位提示
            args._geocodedAddress = geo.formatted_address || addressToGeocode
          } else {
            console.log('[POI] 地理编码失败')
          }
        }
      }
      
      // 再次解析坐标
      const finalParsed = parseLocation(locationStr)
      if (!finalParsed) {
        // 无法解析坐标，需要用户点击地图选择
        return {
          success: false,
          require_user_location: true,
          location_hint: args.location || args.keywords,
          keywords: args.keywords,
          radius: args.radius || 2000,
          message: `无法定位"${args.location || args.keywords}"，请在地图上点击选择搜索中心点`
        }
      }
      
      console.log('[POI] 执行周边搜索:', finalParsed, args.radius, args.keywords)
      const searchRadius = args.radius || 2000
      const result = await callPoiApi('around', {
        lng: finalParsed.lng,
        lat: finalParsed.lat,
        radius: searchRadius,
        keywords: args.keywords
      })
      if (result.error) {
        return { success: false, message: result.error }
      }
      // 返回POI结果给前端处理（包含中心点坐标和半径）
      return {
        success: true,
        type: 'poi',
        subtype: 'around',
        pois: result.pois,
        count: result.count,
        centerLat: finalParsed.lat,
        centerLng: finalParsed.lng,
        radius: searchRadius,
        geocodedAddress: args._geocodedAddress || args.location || null,
        message: `在指定位置周边找到 ${result.count} 个POI`
      }
    }

    case 'poi_text_search': {
      const result = await callPoiApi('text', {
        city: args.city,
        keywords: args.keywords
      })
      if (result.error) {
        return { success: false, message: result.error }
      }
      return {
        success: true,
        type: 'poi',
        subtype: 'text',
        pois: result.pois,
        count: result.count,
        message: `在${args.city || '全国'}找到 ${result.count} 个POI`
      }
    }

    case 'poi_polygon_search': {
      const result = await callPoiApi('polygon', {
        coordinates: args.coordinates,
        keywords: args.keywords
      })
      if (result.error) {
        return { success: false, message: result.error }
      }
      return {
        success: true,
        type: 'poi',
        subtype: 'polygon',
        pois: result.pois,
        count: result.count,
        message: `在多边形区域内找到 ${result.count} 个POI`
      }
    }

    // ===== 门店人口分布分析 =====
    case 'store_population_distribution': {
      const { store_keyword, radius = 2 } = args

      // 在门店列表中查找目标门店
      const allMarkers = markerStore.markers
      if (!allMarkers || allMarkers.length === 0) {
        return { success: false, message: '暂无门店数据，请先加载门店' }
      }

      const kw = store_keyword.toLowerCase()
      const matched = allMarkers.filter(m =>
        m.name?.toLowerCase().includes(kw) ||
        m.address?.toLowerCase().includes(kw)
      )

      if (matched.length === 0) {
        return { success: false, message: `未找到名称包含"${store_keyword}"的门店` }
      }

      // 取第一个匹配的门店
      const store = matched[0]
      const lat = store.latitude
      const lng = store.longitude

      if (!lat || !lng) {
        return { success: false, message: `门店"${store.name}"缺少坐标信息` }
      }

      // 调用全局函数打开人口分布对话框（由MapView注册）
      if (typeof window.openStorePopulationDistribution === 'function') {
        window.openStorePopulationDistribution(lat, lng, radius)
        const storeName = matched.length === 1
          ? `"${store.name}"`
          : `"${store.name}"等 ${matched.length} 家门店中的第一家`
        return {
          success: true,
          message: `已定位到${storeName}，正在打开人口分布分析对话框（半径 ${radius} 公里）`
        }
      } else {
        return { success: false, message: '人口分布功能未就绪，请确认已打开地图页面' }
      }
    }

    default:
      return { success: false, message: `未知工具：${name}` }
  }
}

/**
 * 生成操作描述文字（用于对话框显示）
 * 新增工具时在此追加对应的 case 即可
 */
export function getActionDescription(name, args) {
  switch (name) {
    case 'filter_markers': {
      const parts = []
      if (args.city) parts.push(`城市：${args.city}`)
      if (args.district) parts.push(`区县：${args.district}`)
      if (args.store_type) parts.push(`类型：${args.store_type}`)
      if (args.store_category) parts.push(`分类：${args.store_category}`)
      if (args.brand) parts.push(`品牌：${args.brand}`)
      if (args.keyword) parts.push(`关键词：${args.keyword}`)
      return parts.length ? `筛选我的门店（${parts.join('，')}）` : '显示全部我的门店'
    }
    case 'filter_competitors': {
      const parts = []
      if (args.city) parts.push(`城市：${args.city}`)
      if (args.district) parts.push(`区县：${args.district}`)
      if (args.brand) parts.push(`品牌：${args.brand}`)
      if (args.keyword) parts.push(`关键词：${args.keyword}`)
      return parts.length ? `筛选竞品门店（${parts.join('，')}）` : '显示全部竞品门店'
    }
    case 'filter_brand_stores': {
      const parts = []
      if (args.city) parts.push(`城市：${args.city}`)
      if (args.brand) parts.push(`品牌：${args.brand}`)
      if (args.keyword) parts.push(`关键词：${args.keyword}`)
      return parts.length ? `筛选品牌门店（${parts.join('，')}）` : '显示全部品牌门店'
    }
    case 'filter_shopping_centers': {
      const parts = []
      if (args.city) parts.push(`城市：${args.city}`)
      if (args.keyword) parts.push(`名称：${args.keyword}`)
      if (args.min_stars) parts.push(`最低${args.min_stars}星`)
      return parts.length ? `筛选购物中心（${parts.join('，')}）` : '显示全部购物中心'
    }
    case 'locate_city':
      return `定位到：${args.location}`
    case 'toggle_layer': {
      const layerNames = {
        markers: '我的门店',
        competitors: '竞品门店',
        brand_stores: '品牌门店',
        shopping_centers: '购物中心'
      }
      return `${args.visible ? '显示' : '隐藏'} ${layerNames[args.layer] || args.layer} 图层`
    }
    case 'clear_filters':
      return '清除所有筛选条件'
    case 'activate_tool': {
      const toolNames = {
        measure: '测量距离',
        area: '测量面积',
        circle: '绘制圆形',
        heatmap: '热力图',
        cluster: '聚合显示',
        clear: '清除绘制',
        fit: '定位全部数据'
      }
      return `激活工具：${toolNames[args.tool] || args.tool}`
    }
    case 'query_stats':
      return `统计查询：按${args.group_by || '城市'}分组`
    case 'poi_around_search':
      return `周边搜索：${args.keywords}（${args.radius || 1000}米内）`
    case 'poi_text_search':
      return `关键词搜索：${args.keywords}${args.city ? '（' + args.city + '）' : ''}`
    case 'poi_polygon_search':
      return `多边形搜索：${args.keywords}`
    case 'store_population_distribution': {
      const radiusText = args.radius ? `${args.radius}公里` : '2公里'
      return `门店人口分布分析：${args.store_keyword}（半径 ${radiusText}）`
    }
    default:
      return name
  }
}
