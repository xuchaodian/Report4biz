import express from 'express'
import { authenticate } from '../middleware/auth.js'
import { getDb } from '../models/database.js'
import { tools, serverSideTools } from '../ai/tools.js'
import { aroundSearch } from '../utils/amapPoi.js'
import { ARK_API_KEY } from '../config.js'

const router = express.Router()

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const MODEL = 'doubao-seed-2-0-pro-260215'

// 每月AI token用量限额配置
const TOKEN_LIMITS = [
  { minQuota: 200, limit: 1_500_000, warn: true },        // ≥200 → 150万/月
  { minQuota: 100, limit: 1_000_000, warn: true },        // 100~199 → 100万/月
  { minQuota: 50, limit: 500_000, warn: true },           // 50~99 → 50万/月
  { minQuota: 1, limit: 100_000, warn: true },            // 1~49 → 10万/月
  { minQuota: 0, limit: 0, warn: true }                   // 0 → 禁止
]

// ... (rest of code stays)

// 获取用户本月已用token数
function getMonthlyTokenUsage(db, userId) {
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`
  const row = db.prepare(`
    SELECT COALESCE(SUM(tokens_used), 0) as total
    FROM ai_usage WHERE user_id = ? AND created_at >= ?
  `).get(userId, monthStart)
  return row?.total || 0
}

// 记录AI token用量
function recordTokenUsage(userId, tokens) {
  try {
    const db = getDb()
    db.prepare(`INSERT INTO ai_usage (user_id, tokens_used) VALUES (?, ?)`).run(userId, tokens)
    db.saveNow()
  } catch (e) {
    console.error('[AI] 记录token用量失败:', e.message)
  }
}

// token用量提醒阈值配置
const TOKEN_WARN_CONFIG = [
  { minQuota: 200, limit: 1_500_000, step: 150_000, label: '高频' },
  { minQuota: 100, limit: 1_000_000, step: 100_000, label: '中频' },
  { minQuota: 50, limit: 500_000, step: 50_000, label: '普通' },
  { minQuota: 1, limit: 100_000, step: 10_000, label: '低频' }
]

// 获取用户tier对应的警告配置
function getWarnConfig(remaining) {
  for (const cfg of TOKEN_WARN_CONFIG) {
    if (remaining >= cfg.minQuota) return cfg
  }
  return null
}

// 每个用户上次警告的阈值级别（内存跟踪，重启后重置）
const warnedLevels = new Map()

// 检查是否需要发送token用量提醒
function checkTokenWarning(userId, monthlyUsed, remaining) {
  const cfg = getWarnConfig(remaining)
  if (!cfg) return null

  const currentLevel = Math.floor(monthlyUsed / cfg.step)
  const key = `${userId}_${cfg.label}`
  const lastLevel = warnedLevels.get(key) ?? -1

  if (currentLevel > lastLevel && currentLevel > 0) {
    warnedLevels.set(key, currentLevel)
    const warned = currentLevel * cfg.step
    const remainTokens = cfg.limit - monthlyUsed
    const remainAfterWarn = cfg.limit - warned
    // 估算可查询次数：按每次平均 2000 tokens 估算
    const estQueries = Math.max(1, Math.round(remainTokens / 2000))
    const estQueriesAfterWarn = Math.max(1, Math.round(remainAfterWarn / 2000))
    return {
      warnAt: warned,
      remainTokens,
      estQueries,
      limit: cfg.limit,
      label: cfg.label,
      message: `⚠️ 本月已消耗 ${(warned / 10000).toFixed(0)} 万 token，剩余约 ${(remainTokens / 10000).toFixed(0)} 万（约 ${estQueries} 次查询）`
    }
  }
  return null
}

function checkAIAccess(userId) {
  const db = getDb()
  const user = db.prepare('SELECT quota FROM users WHERE id = ?').get(userId)
  if (!user) return { allowed: false, message: '用户不存在' }
  
  const used = db.prepare(`
    SELECT COALESCE(SUM(quota_used), 0) as used
    FROM purchases WHERE user_id = ? AND status = 'active'
  `).get(userId)
  
  const remaining = (user.quota || 0) - (used?.used || 0)
  
  // 剩余次数为0 → 直接禁止
  if (remaining <= 0) {
    return { allowed: false, message: '剩余次数为0，无法使用AI助手功能。请联系管理员购买联通人口数据配额' }
  }
  
  const monthlyTokens = getMonthlyTokenUsage(db, userId)
  
  for (const limit of TOKEN_LIMITS) {
    if (remaining >= limit.minQuota) {
      // 找到对应区间
      if (monthlyTokens >= limit.limit) {
        const limitStr = limit.limit >= 1_500_000 ? '150万' : limit.limit >= 1_000_000 ? '100万' : limit.limit >= 500_000 ? '50万' : '10万'
        return { allowed: false, message: `本月AI token用量已达${limitStr}上限，请下月再使用（已用${Math.round(monthlyTokens / 10000)}万）` }
      }
      return { allowed: true, remaining, monthlyTokens, limit: limit.limit }
    }
  }
  
  return { allowed: false, message: '无法使用AI助手功能' }
}

// 工具定义从 ../ai/tools.js 导入

// AI 对话接口
router.post('/chat', authenticate, async (req, res) => {
  try {
    const { messages, context } = req.body
    const userId = req.user.id

    // 检查AI使用权限（基于剩余配额和月token用量）
    const access = checkAIAccess(userId)
    if (!access.allowed) {
      return res.status(403).json({ message: access.message })
    }

    // 构建系统提示
    const systemPrompt = `你是 GeoManager 地图管理系统的 AI 助手，帮助用户通过自然语言操作地图和管理门店数据。

## 必须使用的工具（严格遵守）

**【POI搜索 - 必须使用】**
当用户询问"周边"、"附近"、"周围"时，必须使用 poi_around_search 工具！
- 例："上海闵行浦江欢乐颂周边2km咖啡厅" → 调用 poi_around_search
- 例："我家附近有什么餐厅" → 调用 poi_around_search
- 如果没有提供具体位置，先尝试用关键词搜索，或提示用户点击地图选择位置

**【其他地图操作工具】**
- 筛选门店：filter_markers / filter_competitors / filter_brand_stores
- 定位城市：locate_city
- 图层开关：toggle_layer
- 激活工具：activate_tool（热力图、聚合、测量等）
- 统计查询：query_stats
- 门店人口分布：store_population_distribution（用户提到"XX门店人口分布"、"分析XX商圈人口"时调用）
- 人口对比分析：compare_population（用户提到"对比门店A和门店B的人口"、"哪些门店周边人口更多"、"对比XX和YY"时调用，需要2-5家门店）
- 门店购买数据对比：compare_stores（用户提到"门店对比"、"对比门店A和门店B的购买履历"、"对比客流"、"对比数据"时调用，跳转到数据管理页面进行对比操作，需要2-5家门店）
- 门店人口数据排名：store_ranking（用户提到"排名"、"门店排名"、"门店排行"、"到访人口最多"、"人口排名"时调用，按到访、居住、工作人口数分别显示前10和后10名）
- 城市宏观数据：query_city_data（用户提到城市GDP、人口、收入等时调用）
- 商场餐饮商户：query_mall_tenants（用户提到商场商户、餐厅时调用）
- 商场商户对比：compare_mall_tenants（用户提到商场商户对比时调用）
- 开店余地分析：calculate_potential（用户提到开店余地时调用）

## ⚠️ 高消耗查询引导（重要）
以下查询 token 消耗较大，你需要在回复结果的同时，引导用户亲自在系统中操作以获得更完整的结果：

**【query_mall_tenants - 商场商户查询】**
回复结尾必须加上：'💡 提示：此查询消耗 token 较大。建议您打开左侧「购物中心」页面 → 点击目标商场名称 → 在「餐饮商户」Tab中自助筛选查看，结果更完整且不消耗 AI 额度。'

**【compare_mall_tenants - 商场商户对比】**
回复结尾必须加上：'💡 提示：此查询消耗 token 较大。建议您打开左侧「购物中心」页面 → 点击商场 → 在「餐饮商户」Tab中选择「商户对比」功能自助操作。'

**【calculate_potential - 开店余地分析】**
回复结尾必须加上：'💡 提示：此查询消耗 token 较大。建议您在地图工具栏中点击「开店余地」按钮自助分析，支持自定义人口/门店筛选条件且不消耗 AI 额度。'

当前用户数据概览：
${context ? JSON.stringify(context, null, 2) : '暂无'}

## 回复规则（必须遵守）
1. POI相关问题**必须调用工具**，禁止直接回复文字说"我来帮您搜索"
2. 其他地图操作优先使用工具
3. 用简洁的中文回复，告知用户执行了什么操作
4. 如果需要用户配合（如点击地图），明确告知`

    const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        tools,
        // 强制要求模型使用工具（特别是POI搜索）
        tool_choice: 'required',
        temperature: 0.1,
        max_tokens: 1500
      })
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('豆包 API 错误:', err)
      return res.status(500).json({ message: 'AI 服务暂时不可用', detail: err })
    }

    const result = await response.json()
    const choice = result.choices?.[0]

    // 记录本次token消耗
    let tokenWarn = null
    if (result.usage) {
      const totalTokens = (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0)
      recordTokenUsage(userId, totalTokens)
      // 检查是否需要发送token用量提醒
      tokenWarn = checkTokenWarning(userId, access.monthlyTokens + totalTokens, access.remaining)
    }

    if (!choice) {
      return res.status(500).json({ message: 'AI 返回数据异常' })
    }

    // 如果有 Function Calling，需要处理工具调用
    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      const toolCalls = choice.message.tool_calls

      // 处理需要查询数据库的工具（query_stats）
      const toolResults = []
      for (const tc of toolCalls) {
        let toolResult = null
        const args = JSON.parse(tc.function.arguments || '{}')

        if (serverSideTools.includes(tc.function.name)) {
          toolResult = await executeServerTool(tc.function.name, userId, args)
        } else {
          // 其他工具由前端执行，这里返回 pending 标记
          toolResult = { status: 'client_side', args }
        }

        toolResults.push({
          tool_call_id: tc.id,
          name: tc.function.name,
          result: toolResult
        })
      }

      // 如果有需要前端执行的工具，直接返回给前端处理
      const clientSideTools = toolResults.filter(t => t.result?.status === 'client_side')
      if (clientSideTools.length > 0) {
        return res.json({
          type: 'tool_calls',
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}')
          })),
          assistant_message: choice.message,
          tokenWarn: tokenWarn?.message
        })
      }

      // 如果是服务端工具（query_stats），再次调用 AI 获取文字回复
      const followUpMessages = [
        { role: 'system', content: systemPrompt },
        ...messages,
        choice.message,
        ...toolResults.map(t => ({
          role: 'tool',
          tool_call_id: t.tool_call_id,
          content: JSON.stringify(t.result)
        }))
      ]

      const followUp = await fetch(`${ARK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ARK_API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages: followUpMessages,
          temperature: 0.3,
          max_tokens: 400
        })
      })

      const followUpResult = await followUp.json()
      const finalContent = followUpResult.choices?.[0]?.message?.content || '已完成统计查询'

      // 记录followUp的token消耗
      if (followUpResult.usage) {
        const totalTokens = (followUpResult.usage.prompt_tokens || 0) + (followUpResult.usage.completion_tokens || 0)
        recordTokenUsage(userId, totalTokens)
        tokenWarn = checkTokenWarning(userId, access.monthlyTokens + totalTokens, access.remaining) || tokenWarn
      }

      return res.json({
        type: 'text',
        content: finalContent,
        tokenWarn: tokenWarn?.message
      })
    }

    // 普通文字回复
    res.json({
      type: 'text',
      content: choice.message?.content || '好的，我来帮您处理。',
      tokenWarn: tokenWarn?.message
    })

  } catch (error) {
    console.error('AI 接口错误:', error)
    res.status(500).json({ message: '服务器错误', detail: error.message })
  }
})

// 服务端执行：统计查询
async function executeServerTool(toolName, userId, args) {
  try {
    switch (toolName) {
      case 'query_stats':
        return await executeQueryStats(userId, args)

      case 'query_city_data':
        return await executeCityDataQuery(args)

      case 'query_mall_tenants':
        return await executeMallTenantsQuery(args)

      case 'compare_mall_tenants':
        return await executeMallTenantsCompare(args)

      case 'calculate_potential':
        return await executeCalculatePotential(args)

      default:
        return { success: false, error: `未知工具: ${toolName}` }
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ==== 原有 query_stats ====
async function executeQueryStats(userId, args) {
  const db = getDb()
  const { group_by = 'city', data_type = 'markers' } = args

  const tableMap = {
    markers: 'markers',
    competitors: 'competitors',
    brand_stores: 'brand_stores',
    shopping_centers: 'shopping_centers'
  }
  const table = tableMap[data_type] || 'markers'
  const validColumns = ['city', 'store_type', 'store_category', 'brand', 'district', 'name']
  const col = validColumns.includes(group_by) ? group_by : 'city'

  const rows = db.prepare(`
    SELECT ${col} as label, COUNT(*) as count
    FROM ${table}
    WHERE user_id = ? AND ${col} IS NOT NULL AND ${col} != ''
    ${table === 'competitors' ? `AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))` : ''}
    GROUP BY ${col}
    ORDER BY count DESC
    LIMIT 20
  `).all(userId)

  const summary = rows.length > 0
    ? `共 ${rows.length} 个分组：` + rows.map(r => `${r.label} ${r.count}家`).join('；')
    : '暂无数据'
  return { success: true, data: rows, summary, group_by: col, data_type }
}

// ==== 城市宏观数据查询 ====
async function executeCityDataQuery(args) {
  const { city } = args
  if (!city) return { success: false, error: '请提供城市名称' }
  const r = await fetch(`https://mka-online.cn/api/city-data/${encodeURIComponent(city)}`)
  const d = await r.json()
  if (!d.success) return { success: false, error: d.message || '未找到该城市数据' }
  const c = d.data
  const items = [
    `城市: ${c['城市'] || '-'}`,
    `省份: ${c['省份'] || '-'}`,
    `等级: ${c['等级'] || '-'}`,
    `年份: ${c['年份'] || '-'}`,
    `GDP: ${c['GDP(亿元)'] != null ? c['GDP(亿元)'] + '亿元' : '-'}`,
    `增速: ${c['增速(%)'] != null ? c['增速(%)'] + '%' : '-'}`,
    `人均GDP: ${c['人均GDP(元)'] != null ? c['人均GDP(元)'] + '元' : '-'}`,
    `常住人口: ${c['年末常住人口(万人)'] != null ? c['年末常住人口(万人)'] + '万人' : '-'}`,
    `人均可支配收入: ${c['城镇居民人均可支配收入(元)'] != null ? c['城镇居民人均可支配收入(元)'] + '元' : '-'}`,
    `社零总额: ${c['社会消费品零售总额(亿元)'] != null ? c['社会消费品零售总额(亿元)'] + '亿元' : '-'}`
  ].filter(Boolean)
  return { success: true, summary: items.join('\n'), data: c }
}

// ==== 商场商户查询 ====
async function executeMallTenantsQuery(args) {
  const { mall_name, classification, limit = 10 } = args
  if (!mall_name) return { success: false, error: '请提供商场名称' }
  const params = new URLSearchParams({ pageSize: 50, keyword: mall_name })
  if (classification) params.set('classification', classification)
  const r = await fetch(`https://mka-online.cn/api/mall-tenants?${params}`)
  const d = await r.json()
  if (!d.success) return { success: false, error: '查询失败' }
  const tenants = d.data || []
  // 按归类统计
  const byClass = {}
  for (const t of tenants) {
    const cls = t['归类'] || t['商户类型'] || '未知'
    byClass[cls] = (byClass[cls] || 0) + 1
  }
  const classSummary = Object.entries(byClass).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}家`).join('；')
  const list = tenants.slice(0, limit).map(t =>
    `${t['商户名称']}（${t['商户类型'] || '-'}，${t['所在楼层'] || '-'}）`
  ).join('\n')
  return {
    success: true,
    summary: `「${mall_name}」共 ${tenants.length} 家商户\n分类统计：${classSummary}\n商户列表：\n${list}`,
    data: { total: tenants.length, byClassification: byClass, list: tenants.slice(0, limit) }
  }
}

// ==== 商场商户对比 ====
async function executeMallTenantsCompare(args) {
  const { malls, by_classification = true } = args
  if (!malls || malls.length < 2) return { success: false, error: '请至少选择2个商场' }
  const params = new URLSearchParams({ malls: malls.join(','), byClassification: String(by_classification) })
  const r = await fetch(`https://mka-online.cn/api/mall-tenants/compare?${params}`)
  const d = await r.json()
  if (!d.success) return { success: false, error: '对比失败' }
  const lines = d.data.map(m =>
    `${m['商场名称']}: 共${m['商户总数']}家` + (m['分类型']
      ? '\n  ' + Object.entries(m['分类型']).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')
      : '')
  )
  return { success: true, summary: lines.join('\n\n'), data: d.data }
}

// ==== 开店余地分析 ====
async function executeCalculatePotential(args) {
  const { city, radius = 1, min_stores = 1, min_competitors = 1 } = args
  if (!city) return { success: false, error: '请提供城市名称' }
  const r = await fetch('https://mka-online.cn/api/shapefiles/calculate-potential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cityName: city, radius, myStoreMin: min_stores, competitorMin: min_competitors, conditions: [] })
  })
  const d = await r.json()
  if (!d.success) return { success: false, error: d.error || '分析失败' }
  const matched = d.data?.matched || 0
  const total = d.data?.total || 0
  return {
    success: true,
    summary: `${city}开店余地分析：共 ${total} 个网格，符合条件 ${matched} 个（占比 ${(matched / total * 100).toFixed(1)}%），已在图上显示`,
    data: { matched, total }
  }
}


// ===== 品牌选址建议（数据洞察 → AI）=====
// 读取门店品牌 + 业态映射 + 联通智慧足迹数据摘要，调用豆包给出是否符合品牌定位的选址建议
// 周边环境要素：半径内竞品/购物中心/我的门店（DB 距离计算）+ 地铁站（高德周边搜索）
async function buildSurroundingContext(lat, lng, radii, userId, isAdmin) {
  // 归一化半径数组：数字、去重、升序；无则默认 1000 米
  let rs = Array.isArray(radii) ? radii.map(Number).filter(n => n > 0) : []
  rs = [...new Set(rs)].sort((a, b) => a - b)
  if (rs.length === 0) rs = [1000]
  if (!lat || !lng) return ''
  const R = 6371000
  const dist = (la, lo) => {
    const dLat = (la - lat) * Math.PI / 180
    const dLng = (lo - lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(la * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(a))
  }
  const fmtR = (m) => (m >= 1000 ? (m / 1000).toFixed(m % 1000 === 0 ? 0 : 1) + 'km' : m + '米')
  const lines = []
  try {
    const db = getDb()
    const comps = db.prepare(
      isAdmin ? `SELECT brand, longitude, latitude FROM competitors WHERE longitude IS NOT NULL AND latitude IS NOT NULL AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))`
              : `SELECT brand, longitude, latitude FROM competitors WHERE user_id = ? AND longitude IS NOT NULL AND latitude IS NOT NULL AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))`
    ).all(...(isAdmin ? [] : [userId]))
    const centers = db.prepare('SELECT longitude, latitude FROM shopping_centers WHERE latitude IS NOT NULL AND latitude != 0 AND longitude IS NOT NULL AND longitude != 0').all()
    const myStores = db.prepare(
      isAdmin ? `SELECT longitude, latitude FROM markers WHERE longitude IS NOT NULL AND latitude IS NOT NULL`
              : `SELECT longitude, latitude FROM markers WHERE user_id = ? AND longitude IS NOT NULL AND latitude IS NOT NULL`
    ).all(...(isAdmin ? [] : [userId]))
    // 逐半径统计：竞品/购物中心/我的门店
    const compCounts = [], centerCounts = [], myCounts = []
    for (const r of rs) {
      compCounts.push(comps.filter(c => dist(c.latitude, c.longitude) <= r).length)
      centerCounts.push(centers.filter(c => dist(c.latitude, c.longitude) <= r).length)
      myCounts.push(myStores.filter(s => dist(s.latitude, s.longitude) <= r).length)
    }
    const series = (arr) => arr.map((n, i) => `${fmtR(rs[i])}内${n}家`).join('、')
    // 竞品：逐半径 + 最大半径品牌分布
    const maxR = rs[rs.length - 1]
    const inCompMax = comps.filter(c => dist(c.latitude, c.longitude) <= maxR)
    if (inCompMax.length > 0) {
      const byBrand = {}
      inCompMax.forEach(c => { byBrand[c.brand] = (byBrand[c.brand] || 0) + 1 })
      const top = Object.entries(byBrand).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b, n]) => `${b}${n}家`).join('、')
      lines.push(`竞品门店 ${series(compCounts)}（品牌分布：${top}）`)
    } else {
      lines.push(`竞品门店 ${series(compCounts)}（区域内暂无竞品）`)
    }
    lines.push(`购物中心 ${series(centerCounts)}`)
    const myTotal = myCounts[myCounts.length - 1]
    lines.push(`我的门店 ${series(myCounts)}${myTotal > 0 ? '（注意自家门店相互蚕食风险）' : ''}`)
  } catch (e) {
    console.error('[site-advice] DB 周边要素失败:', e.message)
  }
  // 地铁站（高德周边搜索，半径至少 1000 米）
  try {
    const amap = await aroundSearch(lng, lat, Math.max(rs[0], 1000), '地铁站')
    const pois = (amap && amap.pois) || []
    if (pois.length > 0) {
      const near = pois.slice(0, 3).map(p => `${p.name}约${Math.round(p.distance || 0)}米`).join('、')
      lines.push(`最近地铁站：${near}`)
    } else {
      lines.push('最近地铁站：周边暂无（交通便利性一般）')
    }
  } catch (e) {
    console.error('[site-advice] 地铁站查询失败:', e.message)
  }
  // 著名品牌（高德周边检索：肯德基/麦当劳/星巴克，半径至少 1000 米）
  // 注意：高德 QPS 限制（CUQPS_HAS_EXCEEDED_THE_LIMIT）——串行调用 + 300ms 间隔 + 单品牌独立降级
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const brands = ['肯德基', '麦当劳', '星巴克']
  const parts = []
  for (const b of brands) {
    try {
      const amap = await aroundSearch(lng, lat, Math.max(rs[0], 1000), b)
      if (amap && amap.count > 0) {
        const minDist = amap.pois.length ? Math.min(...amap.pois.map(p => p.distance || Infinity)) : null
        parts.push(`${b}${amap.count}家${minDist ? `（最近约${Math.round(minDist)}米）` : ''}`)
      } else {
        parts.push(`${b}0家`)
      }
    } catch (e) {
      console.error(`[site-advice] 著名品牌 ${b} 查询失败:`, e.message)
      parts.push(`${b}查询失败`)
    }
    await sleep(300)
  }
  lines.push(`著名品牌：${parts.join('、')}`)
  return lines.join('；')
}

router.post('/site-advice', authenticate, async (req, res) => {
  try {
    const { storeName = '', brand = '', category = '', city = '', radius = '', dataSummary = '', lat = null, lng = null, radiusMeters = null, radii = null, stream = false } = req.body || {}
    const userId = req.user.id

    // 检查AI使用权限
    const access = checkAIAccess(userId)
    if (!access.allowed) {
      return res.status(403).json({ message: access.message })
    }
    // VIP 门禁：AI 选址建议仅 VIP 用户可用（查 DB 最新角色 + 到期校验，管理员视为 VIP）
    const vipUser = getDb().prepare('SELECT role, vip_until FROM users WHERE id = ?').get(userId)
    const isVip = vipUser && (vipUser.role === 'vip' || vipUser.role === 'admin') &&
      (!vipUser.vip_until || new Date(String(vipUser.vip_until) + 'T23:59:59') >= new Date())
    if (!isVip) {
      return res.status(403).json({ message: '🤖 AI 选址建议为 VIP 用户专属功能，请联系管理员开通 VIP' })
    }
    if (!brand && !storeName) {
      return res.status(400).json({ message: '缺少门店/品牌信息' })
    }

    // 周边环境要素：竞品/购物中心/我的门店（DB）+ 地铁站（高德周边搜索）
    let surroundings = ''
    try {
      surroundings = await buildSurroundingContext(lat, lng, radii || (radiusMeters ? [radiusMeters] : null), req.user.id, req.user.role === 'admin')
      console.log('[site-advice] surroundings:', surroundings)
    } catch (e) {
      console.error('[site-advice] 周边要素获取失败:', e.message)
    }

    const systemPrompt = `你是专业的连锁品牌选址顾问（GeoManager 商业智能系统）。用户会提供品牌名、所属业态、查询区域和联通智慧足迹人口大数据摘要（基于高德/联通数据服务：1001 人口结构、1005 客流时段、1009 消费水平、1010 教育水平、1011 行业分布、1013 消费能力、1015 资产水平）。

你的任务：判断该区域是否适合该品牌开设门店，并给出专业选址建议。

用户还会提供「周边环境要素」（半径内竞品数量及品牌分布、购物中心、我的门店、最近地铁站），需结合人口画像与周边竞争/配套/交通综合判断。

## 输出要求（Markdown 格式，简洁专业）
1. **选址结论**：开头第一行直接给出「✅ 适合选址」或「⚠️ 谨慎选址」或「❌ 不建议选址」，并说明理由（结合竞争格局与交通配套）
2. **客群匹配度**：区域主要人群（居住/工作/到访比例、消费力、行业）与该品牌目标客群是否匹配
3. **业态契合点**：区域特征（如高密度居住区/商务区/商圈）与该业态（如快餐/正餐/零售）的契合度
4. **竞争与配套**：基于周边环境要素分析竞争压力（竞品数量/品牌、自家门店蚕食）与配套成熟度（购物中心、地铁可达性）
5. **风险提示**：不匹配的风险点（如有）
6. **运营建议**：若开业，建议的时段推广、定价、选址位置偏好（如近地铁/写字楼/社区）

注意：严格基于提供的数据摘要分析，不要编造数据；如果数据不足，明确说明哪些维度缺失。回复控制在 500 字以内，用中文。`

    const userContent = [
      `【门店】${storeName || '-'}`,
      `【品牌】${brand || '未知'}`,
      `【业态】${category || '未知（请根据品牌自行判断）'}`,
      `【查询城市】${city || '-'}`,
      `【查询半径】${radius || '-'}`,
      '',
      '【联通智慧足迹数据摘要】',
      dataSummary || '暂无数据',
      '',
      surroundings ? `【周边环境要素】${surroundings}` : '',
      '',
      '请基于以上信息（含周边环境要素），给出该区域是否符合该品牌定位的选址建议。'
    ].join('\n')

    const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.5,
        max_tokens: 1200,
        stream: !!stream,
        // 流式模式下让最后一块携带 usage（用于 token 用量统计）
        stream_options: stream ? { include_usage: true } : undefined
      })
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('豆包 site-advice 错误:', err)
      return res.status(500).json({ message: 'AI 服务暂时不可用', detail: err })
    }

    // ===== 流式模式：SSE 透传（循序渐进式显示） =====
    if (stream && response.body) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buf = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
          // 顺带解析 usage（流式最后一块带 usage）记录 token 消耗
          buf += decoder.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (line.startsWith('data:') && !line.includes('[DONE]')) {
              try {
                const chunk = JSON.parse(line.slice(5).trim())
                if (chunk.usage) {
                  recordTokenUsage(userId, (chunk.usage.prompt_tokens || 0) + (chunk.usage.completion_tokens || 0))
                }
              } catch (e) { /* 忽略解析失败 */ }
            }
          }
        }
      } catch (e) {
        console.error('[site-advice] 流式转发失败:', e.message)
      } finally {
        res.end()
      }
      return
    }

    const result = await response.json()
    const reply = result.choices?.[0]?.message?.content || ''

    // 记录token消耗
    if (result.usage) {
      const totalTokens = (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0)
      recordTokenUsage(userId, totalTokens)
    }

    res.json({ success: true, reply })
  } catch (e) {
    console.error('[site-advice] 失败:', e.message)
    res.status(500).json({ message: '服务器错误', detail: e.message })
  }
})

export default router
