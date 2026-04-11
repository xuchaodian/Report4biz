/**
 * GeoManager AI 工具定义中心
 *
 * 新增功能时，只需在此文件末尾追加工具定义，
 * 前后端无需改动（执行逻辑在 aiExecutor.js 中补充）。
 */

// ===== 地图操作类工具 =====

const filterMarkers = {
  type: 'function',
  function: {
    name: 'filter_markers',
    description: '筛选我的门店，支持按城市、区县、门店类型、门店分类、品牌等条件过滤',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名称，如"北京"、"上海"' },
        district: { type: 'string', description: '区县名称，如"朝阳区"' },
        store_type: { type: 'string', description: '门店类型：已开业 | 重点候选 | 一般候选' },
        store_category: {
          type: 'string',
          description: '门店分类：社区店 | 临街店 | 商场店 | 写字楼店 | 交通枢纽店 | 校园店 | 景区店 | 专业市场店'
        },
        brand: { type: 'string', description: '品牌名称' },
        keyword: { type: 'string', description: '关键词搜索，匹配门店名称或地址' }
      }
    }
  }
}

const filterCompetitors = {
  type: 'function',
  function: {
    name: 'filter_competitors',
    description: '筛选竞品门店，支持按城市、区县、品牌等条件过滤',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名称' },
        district: { type: 'string', description: '区县名称' },
        brand: { type: 'string', description: '品牌名称，如"大米先生"、"谷田稻香"、"吉野家"' },
        keyword: { type: 'string', description: '关键词搜索' }
      }
    }
  }
}

const filterBrandStores = {
  type: 'function',
  function: {
    name: 'filter_brand_stores',
    description: '筛选品牌门店（别人共享的品牌门店数据），支持按城市、品牌、关键词过滤',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名称' },
        brand: { type: 'string', description: '品牌名称' },
        keyword: { type: 'string', description: '关键词搜索（匹配名称或地址）' }
      }
    }
  }
}

const filterShoppingCenters = {
  type: 'function',
  function: {
    name: 'filter_shopping_centers',
    description: '筛选购物中心，支持按城市、名称关键词、星级等条件过滤',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名称' },
        keyword: { type: 'string', description: '购物中心名称关键词' },
        min_stars: { type: 'number', description: '最低星级，1-5之间的整数' }
      }
    }
  }
}

const locateCity = {
  type: 'function',
  function: {
    name: 'locate_city',
    description: '将地图视图定位到指定城市或地址',
    parameters: {
      type: 'object',
      required: ['location'],
      properties: {
        location: { type: 'string', description: '城市名或详细地址，如"上海"、"北京朝阳区"' }
      }
    }
  }
}

const toggleLayer = {
  type: 'function',
  function: {
    name: 'toggle_layer',
    description: '显示或隐藏地图图层',
    parameters: {
      type: 'object',
      required: ['layer', 'visible'],
      properties: {
        layer: {
          type: 'string',
          description: '图层名称：markers（我的门店）| competitors（竞品门店）| brand_stores（品牌门店）| shopping_centers（购物中心）'
        },
        visible: { type: 'boolean', description: '是否显示' }
      }
    }
  }
}

const clearFilters = {
  type: 'function',
  function: {
    name: 'clear_filters',
    description: '清除所有筛选条件，显示全部门店',
    parameters: { type: 'object', properties: {} }
  }
}

const activateTool = {
  type: 'function',
  function: {
    name: 'activate_tool',
    description: '激活地图工具',
    parameters: {
      type: 'object',
      required: ['tool'],
      properties: {
        tool: {
          type: 'string',
          description: '工具名称：measure（测量距离）| area（测量面积）| circle（绘制圆形）| heatmap（热力图）| cluster（聚合显示）| clear（清除绘制）| fit（定位全部数据）'
        }
      }
    }
  }
}

// ===== POI搜索类工具 =====

const poiAroundSearch = {
  type: 'function',
  function: {
    name: 'poi_around_search',
    description: '【必须使用】周边搜索POI。当用户提到"周边"、"附近"、"周围"时必须调用此工具。搜索指定位置周围的餐厅、商店等地点',
    parameters: {
      type: 'object',
      required: ['keywords'],
      properties: {
        location: { type: 'string', description: '中心点坐标，格式"lng,lat"（如"121.48,31.23"）。如果用户提供了地址名称，系统会自动解析为坐标。如果无法解析，工具会提示用户在地图上点击选择位置' },
        radius: { type: 'number', description: '搜索半径（米），默认2000米，最大5000米。如用户说"2公里"则设置为2000' },
        keywords: { type: 'string', description: '搜索关键词，如"咖啡厅"、"餐厅"、"超市"、"银行"等。可以是单个词或多个词' }
      }
    }
  }
}

const poiPolygonSearch = {
  type: 'function',
  function: {
    name: 'poi_polygon_search',
    description: '多边形搜索POI，在用户框选的区域范围内搜索',
    parameters: {
      type: 'object',
      required: ['coordinates', 'keywords'],
      properties: {
        coordinates: {
          type: 'array',
          description: '多边形顶点坐标数组，每个坐标格式为[lng, lat]',
          items: {
            type: 'array',
            items: { type: 'number' },
            minItems: 3
          }
        },
        keywords: { type: 'string', description: '搜索关键词，如"餐厅"、"银行"等' }
      }
    }
  }
}

const poiTextSearch = {
  type: 'function',
  function: {
    name: 'poi_text_search',
    description: '关键词搜索POI，在全国或指定城市内搜索关键词相关的地点',
    parameters: {
      type: 'object',
      required: ['keywords'],
      properties: {
        city: { type: 'string', description: '城市名称，不填则全国搜索，如"北京"、"上海"' },
        keywords: { type: 'string', description: '搜索关键词，如"火锅"、"咖啡"、"银行"等' }
      }
    }
  }
}

// ===== 商圈分析类工具 =====

const storePopulationDistribution = {
  type: 'function',
  function: {
    name: 'store_population_distribution',
    description: '对指定门店进行商圈人口分布分析。根据门店名称或关键词找到目标门店，以该门店为圆心展示周边人口分布热力图（需要已上传Shapefile人口数据）。用户说"XX门店人口分布"、"分析XX的商圈人口"、"XX周边人口分布"等时调用此工具。',
    parameters: {
      type: 'object',
      required: ['store_keyword'],
      properties: {
        store_keyword: {
          type: 'string',
          description: '门店名称或关键词，用于在"我的门店"中查找目标门店，如"朝阳路店"、"北京一号店"'
        },
        radius: {
          type: 'number',
          description: '分析半径（公里），默认2公里，范围0.5~10'
        }
      }
    }
  }
}

const comparePopulation = {
  type: 'function',
  function: {
    name: 'compare_population',
    description: '对多家门店进行人口对比分析。用户说"对比门店A和门店B的人口"、"对比XX和YY的人口分布"、"哪些门店周边人口更多"等时调用此工具。返回后将跳转到数据页面进行门店对比操作（需要已上传Shapefile人口数据）。',
    parameters: {
      type: 'object',
      required: ['store_keywords'],
      properties: {
        store_keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '门店名称列表，如["星巴克国贸店", "星巴克望京店"]，支持2-5家门店'
        },
        radius: {
          type: 'number',
          description: '分析半径（公里），默认2公里，范围0.5~10'
        }
      }
    }
  }
}

// ===== 统计查询类工具 =====

const queryStats = {
  type: 'function',
  function: {
    name: 'query_stats',
    description: '统计查询数据，如统计各城市门店数量、按类型统计等（由服务端执行）',
    parameters: {
      type: 'object',
      properties: {
        group_by: {
          type: 'string',
          description: '按哪个维度统计：city（城市）| store_type（类型）| store_category（分类）| brand（品牌）| district（区县）'
        },
        data_type: {
          type: 'string',
          description: '统计哪类数据：markers（我的门店）| competitors（竞品）| brand_stores（品牌门店）'
        }
      }
    }
  }
}

// ===== 汇总导出 =====

/**
 * 完整工具列表，供 AI 模型调用
 * ---
 * 新增工具步骤：
 * 1. 在本文件添加工具定义对象
 * 2. 在 aiExecutor.js 添加对应的 case 执行逻辑
 * 3. 在 AiAssistant.vue 的 getActionDescription 添加描述文字
 */
export const tools = [
  filterMarkers,
  filterCompetitors,
  filterBrandStores,
  filterShoppingCenters,
  locateCity,
  toggleLayer,
  clearFilters,
  activateTool,
  queryStats,
  poiAroundSearch,
  poiPolygonSearch,
  poiTextSearch,
  storePopulationDistribution,
  comparePopulation
]

/**
 * 服务端执行的工具名称列表（需要查数据库）
 */
export const serverSideTools = ['query_stats']

/**
 * 所有工具名称（用于快速判断）
 */
export const allToolNames = tools.map(t => t.function.name)
