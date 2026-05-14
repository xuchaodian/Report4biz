import express from 'express'
import { authenticate } from '../middleware/auth.js'
import { getDb } from '../models/database.js'
import { tools, serverSideTools } from '../ai/tools.js'

const router = express.Router()

const ARK_API_KEY = process.env.ARK_API_KEY || 'f92f55af-7642-49d8-94f5-d1492b7b4e19'
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const MODEL = 'doubao-seed-2-0-pro-260215'

// 每月AI token用量限额配置
const TOKEN_LIMITS = [
  { minQuota: 200, limit: 1_500_000, warn: true },        // ≥200 → 150万/月
  { minQuota: 100, limit: 1_000_000, warn: true },        // 100~199 → 100万/月
  { minQuota: 1, limit: 500_000, warn: true },             // 1~99 → 50万/月
  { minQuota: 0, limit: 0, warn: true }                    // 0 → 禁止
]

// ... (rest of code stays)

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
  
  const monthlyTokens = getMonthlyTokenUsage(userId)
  
  for (const limit of TOKEN_LIMITS) {
    if (remaining > limit.minQuota) {
      // 找到对应区间
      if (monthlyTokens >= limit.limit) {
        const limitStr = limit.limit >= 1_500_000 ? '150万' : limit.limit >= 1_000_000 ? '100万' : '50万'
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
    if (result.usage) {
      const totalTokens = (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0)
      recordTokenUsage(userId, totalTokens)
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
          toolResult = await executeQueryStats(userId, args)
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
          assistant_message: choice.message
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
          max_tokens: 800
        })
      })

      const followUpResult = await followUp.json()
      const finalContent = followUpResult.choices?.[0]?.message?.content || '已完成统计查询'

      // 记录followUp的token消耗
      if (followUpResult.usage) {
        const totalTokens = (followUpResult.usage.prompt_tokens || 0) + (followUpResult.usage.completion_tokens || 0)
        recordTokenUsage(userId, totalTokens)
      }

      return res.json({
        type: 'text',
        content: finalContent
      })
    }

    // 普通文字回复
    res.json({
      type: 'text',
      content: choice.message?.content || '好的，我来帮您处理。'
    })

  } catch (error) {
    console.error('AI 接口错误:', error)
    res.status(500).json({ message: '服务器错误', detail: error.message })
  }
})

// 服务端执行：统计查询
async function executeQueryStats(userId, args) {
  try {
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

    let rows
    if (table === 'markers') {
      rows = db.prepare(`
        SELECT ${col} as label, COUNT(*) as count
        FROM ${table}
        WHERE user_id = ? AND ${col} IS NOT NULL AND ${col} != ''
        GROUP BY ${col}
        ORDER BY count DESC
        LIMIT 20
      `).all(userId)
    } else {
      rows = db.prepare(`
        SELECT ${col} as label, COUNT(*) as count
        FROM ${table}
        WHERE user_id = ? AND ${col} IS NOT NULL AND ${col} != ''
        GROUP BY ${col}
        ORDER BY count DESC
        LIMIT 20
      `).all(userId)
    }

    // 仅返回摘要信息，避免大量数据传入 AI（节省 token）
    const summary = rows.length > 0
      ? `共 ${rows.length} 个分组（前 ${rows.length} 条）：` + rows.map(r => `${r.label} ${r.count}家`).join('；')
      : '暂无数据'

    return { success: true, data: rows, summary, group_by: col, data_type }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export default router
