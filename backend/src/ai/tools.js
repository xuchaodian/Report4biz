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
  queryStats
]

/**
 * 服务端执行的工具名称列表（需要查数据库）
 */
export const serverSideTools = ['query_stats']

/**
 * 所有工具名称（用于快速判断）
 */
export const allToolNames = tools.map(t => t.function.name)
