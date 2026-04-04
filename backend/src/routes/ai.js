import express from 'express'
import { authenticate } from '../middleware/auth.js'
import { getDb } from '../models/database.js'
import { tools, serverSideTools } from '../ai/tools.js'

const router = express.Router()

const ARK_API_KEY = process.env.ARK_API_KEY || 'f92f55af-7642-49d8-94f5-d1492b7b4e19'
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const MODEL = 'doubao-seed-2-0-pro-260215'

// 工具定义从 ../ai/tools.js 导入

// AI 对话接口
router.post('/chat', authenticate, async (req, res) => {
  try {
    const { messages, context } = req.body
    const userId = req.user.id

    // 构建系统提示
    const systemPrompt = `你是 GeoManager 地图管理系统的 AI 助手，帮助用户通过自然语言操作地图和管理门店数据。

你可以执行以下操作：
- 筛选/定位门店（按城市、区县、类型、品牌等）
- 定位到指定城市或地址
- 显示/隐藏各类图层（我的门店、竞品门店、品牌门店、购物中心）
- 激活地图工具（测量距离、测量面积、绘制圆形、热力图、聚合显示等）
- 统计查询门店数据

当前用户数据概览：
${context ? JSON.stringify(context, null, 2) : '暂无'}

重要规则：
1. 优先使用工具执行操作，而不是仅回复文字
2. 用简洁友好的中文回复，说明你执行了什么操作
3. 如果用户的指令不明确，先询问，再执行
4. 对于无法执行的操作，说明原因并提供替代建议`

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
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 1000
      })
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('豆包 API 错误:', err)
      return res.status(500).json({ message: 'AI 服务暂时不可用', detail: err })
    }

    const result = await response.json()
    const choice = result.choices?.[0]

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
      `).all(userId)
    } else {
      rows = db.prepare(`
        SELECT ${col} as label, COUNT(*) as count
        FROM ${table}
        WHERE user_id = ? AND ${col} IS NOT NULL AND ${col} != ''
        GROUP BY ${col}
        ORDER BY count DESC
      `).all(userId)
    }

    return { success: true, data: rows, group_by: col, data_type }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export default router
