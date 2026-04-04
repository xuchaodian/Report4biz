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
    default:
      return name
  }
}
