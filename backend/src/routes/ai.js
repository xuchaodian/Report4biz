import express from 'express'
import { authenticate } from '../middleware/auth.js'
import { getDb } from '../models/database.js'
import { tools, serverSideTools } from '../ai/tools.js'
import { aroundSearch } from '../utils/amapPoi.js'
import { ARK_API_KEY } from '../config.js'
import { fetchWithTimeout, fetchStreamWithTimeout, DEFAULT_HTTP_TIMEOUT_MS, STREAM_HEAD_TIMEOUT_MS } from '../utils/httpTimeout.js'
import { checkAiBudget, loadAiUser, isVipActive, truncateMessages, slimContext, normalizeMaxTokens } from '../utils/aiQuota.js'
import { cacheKey, getCached, setCached } from '../utils/aiResponseCache.js'
import { logAiQuestion } from '../utils/aiQuestionLog.js'
import { dedupeToolCalls } from '../utils/toolCallGuard.js'

const router = express.Router()

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

// ============================================================================
// v1.13.168：迁移到 doubao-seed-2.1-pro（旧模型 2.0-pro 于 2026-11-24 14:00 EOS 关停）
// ----------------------------------------------------------------------------
// 旧 doubao-seed-2-0-pro-260215 落在火山方舟**第 10 批下线名单**，且该批公告表只有 2 列、
// 无「到期未迁移则由系统替换模型」列 ⇒ **无平台自动兜底，到期直接关停**。
// 时间线：2026-09-22 10:00 起配额逐步下调 → 09-24 10:00 EOM → **11-24 14:00 EOS**。
// 新 doubao-seed-2-1-pro-260915 为方舟指定的 2.1-pro 版本，已在控制台开通。
// 仍走 OpenAI 兼容 /chat/completions，**无需**迁移到 Responses API（2026-09-23 实测确认）。
//
// ⚠️ 换模型**必须同一个 commit** 同步改 utils/aiQuota.js 的两个费用常量，
//    否则「¥200 月度熔断上限」静默失真（旧常量按 2.0-pro 的 3.2/16 反推）。
//    2.1-pro 官方价：输入 6.00 / 输出 30.00 元每百万（单一档 [0,1024]千tok，**无分段计费**）
//    ⇒ 混合价 0.8×6 + 0.2×30 = 10.8 元/百万。
//
// 选型依据（2026-09-23 二阶段探针，真实 systemPrompt + 20 工具同载荷对照，见
// workbuddy过程文件/Report4biz_豆包模型下线影响评估_20260923.md）：
//   · 协议：/chat/completions + tools + tool_choice:auto + thinking:disabled 全部被接受
//   · 思考链：thinking:disabled 在 2.1-pro 同样生效（实测 reasoning_tokens 74 → 0）
//   · 延迟：工具类提问中位 3043→1861ms（−39%）；流式首字节 1852~2681→661~943ms（−65%）
//   · 工具调度：多意图覆盖**优于**旧模型（"显示门店 + 打开热力图"旧模型漏 1 个，新模型全中）
//   · 付费类工具（store_population_distribution / compare_population / store_ranking）
//     5 问实测重复调用 0 次 ⇒ 无联通双倍计费风险（另见 utils/aiQuota.js 计费红线）
// ============================================================================
const MODEL = 'doubao-seed-2-1-pro-260915'

// ============================================================================
// v1.13.167：显式关闭「深度思考链」(thinking)
// ----------------------------------------------------------------------------
// 豆包 2.0-pro **默认开启**思考链，且 reasoning token 按**输出价**计费
// （输出 ¥16/百万，是输入价的 5 倍）；而 ai.js 本文件从未传过 thinking 参数
// ⇒ 线上一直在为思考链付全价，且 max_tokens 管不住它（实测设 300 实际出 507）。
//
// 实价探针实测（2026-09-23 直连方舟同题对照，见
// workbuddy过程文件/Report4biz_豆包模型下线影响评估_20260923.md §②）：
//   不传 thinking      ⇒ completion 3391 tok（reasoning 2586，占 76%）⇒ ¥0.0546/次
//   传 disabled        ⇒ completion  870 tok（reasoning    0，占  0%）⇒ ¥0.0142/次（−74%）
//   传 enabled（显式） ⇒ 模型自判该题无需思考，反而更短（仍有 302 reasoning tok）
// 回答长度几乎不变（~1400 字 → ~1300 字），质量无退化；
// 附带收益：思考期不吐首字节，关闭后 site-advice 流式的首字节延迟更稳
// （此前思考链贴着 STREAM_HEAD_TIMEOUT_MS 走，属超时风险源）。
//
// ⇒ chat 类场景（问答 / 20 个工具调度 / 选址建议）不需要思考链。**四处请求体缺一不可**：
//   ① chat 首轮  ② chat 工具续轮  ③ site-advice 流式  ④ site-advice 非流式
//   守卫测试：tests/aiCostControl.test.js §G（计数 + 运行时断言，防回退）
// ============================================================================
const THINKING_DISABLED = { type: 'disabled' }

// L6：AI 上游（火山方舟）非流式调用整体超时 90s；流式见 STREAM_HEAD_TIMEOUT_MS（仅首字节计时）
const AI_TIMEOUT_MS = 90000

// 记录AI token用量（endpoint 区分「一次问答」与上游续轮 —— 口径见 utils/aiQuota.js）
function recordTokenUsage(userId, tokens, endpoint = null) {
  try {
    const db = getDb()
    // v1.13.144：不再追加 db.saveNow() —— run() 在非事务态已自动落盘（database.js run 内 `if (!getTxFlag()) saveDatabase()`），
    // 事务态则由 commitTx 统一落盘。原写法每次记账都整库写两遍。
    db.prepare(`INSERT INTO ai_usage (user_id, tokens_used, endpoint) VALUES (?, ?, ?)`)
      .run(userId, tokens, endpoint)
  } catch (e) {
    console.error('[AI] 记录token用量失败:', e.message)
  }
}

// 4C-D4：AI 数据外发审计日志——凡将用户数据（对话内容/人口摘要/周边要素）发送至第三方大模型
// （火山方舟 ark.cn-beijing.volces.com）时留痕，供合规审计与用量核对。前端另有知情提示与开关。
function logAiEgress(userId, endpoint, payloadChars) {
  try {
    const db = getDb()
    // v1.13.144：同上，run() 已负责落盘，不再追加 db.saveNow()
    db.prepare(`INSERT INTO ai_egress_log (user_id, endpoint, payload_chars) VALUES (?, ?, ?)`)
      .run(userId, endpoint, Number(payloadChars) || 0)
    console.log(`[AI-Egress] user=${userId} endpoint=${endpoint} payload=${Number(payloadChars) || 0}chars → ark.cn-beijing.volces.com`)
  } catch (e) {
    console.error('[AI] 记录数据外发日志失败:', e.message)
  }
}

// ============================================================================
// AI 额度闸门（L0 解耦 / L1 额度 / L2 刹车）—— v1.13.161
// ----------------------------------------------------------------------------
// 原判据是**联通**配额（users.quota − Σ purchases.quota_used），与豆包花费毫无关系：
//   联通池为 0 ⇒ AI 全站 403（连 admin 也打不开，2026-09-07 起停摆）
//   联通额度给得大 ⇒ AI 顺带被放开，且 AI 侧零限制
// 现改为读 AI 自己的账：角色分层额度 + 日上限 + 分钟限速 + 全局月度熔断，
// 判据与文案统一收敛在 utils/aiQuota.js（唯一权威入口）。
// 一并删除挂在联通 quota 上、且**前端从未消费**的
// TOKEN_LIMITS / TOKEN_WARN_CONFIG / checkTokenWarning 死代码。
// ============================================================================
function checkAIAccess(userId, now = new Date()) {
  const db = getDb()
  return checkAiBudget(db, loadAiUser(db, userId), now)
}

// ============================================================================
// L3 降本（v1.13.162）：把「高消耗查询提示」从 systemPrompt 搬到服务端拼接
// ----------------------------------------------------------------------------
// 原实现是在 systemPrompt 里写「回复结尾必须加上：'💡 提示：…'」，
// 让**模型**去复述三段固定文案 —— 代价是：
//   ① 这段指令（含文案本身）每次调用都要作为 prompt 发一遍 ⇒ 每次都在付费
//   ② 文案由模型复述 ⇒ 有概率漏字/改写，且占用 completion token
// 现在改为：systemPrompt 删掉整段，**由服务端在拿到模型回复后按所调用的工具拼上**。
// 收益：每次调用恒定省 ~400 字符的 prompt，且文案 100% 稳定。
// ⚠️ 这三段文案必须与产品原口径**逐字一致**（用户可见），改动请同步前端文案约定。
// ⚠️ 只对**服务端工具**（goes through followUp）拼接；前端执行的工具其回复由前端渲染。
// ============================================================================
const SERVER_TOOL_HINTS = {
  query_mall_tenants: '💡 提示：此查询消耗 token 较大。建议您打开左侧「购物中心」页面 → 点击目标商场名称 → 在「餐饮商户」Tab中自助筛选查看，结果更完整且不消耗 AI 额度。',
  compare_mall_tenants: '💡 提示：此查询消耗 token 较大。建议您打开左侧「购物中心」页面 → 点击商场 → 在「餐饮商户」Tab中选择「商户对比」功能自助操作。',
  calculate_potential: '💡 提示：此查询消耗 token 较大。建议您在地图工具栏中点击「开店余地」按钮自助分析，支持自定义人口/门店筛选条件且不消耗 AI 额度。'
}

/** 按本次实际调用的服务端工具拼接提示；已含「💡 提示」则不再重复（防模型自行复述导致叠字） */
function appendServerToolHints(content, toolNames = []) {
  const text = content || ''
  if (text.includes('💡 提示')) return text
  const hint = toolNames.map(n => SERVER_TOOL_HINTS[n]).find(Boolean)
  return hint ? `${text}\n\n${hint}` : text
}

// 工具定义从 ../ai/tools.js 导入

// AI 对话接口
router.post('/chat', authenticate, async (req, res) => {
  try {
    const userId = req.user.id

    // 检查AI使用权限（AI 自己的账：角色额度 + 日上限 + 分钟限速 + 全局熔断）
    const access = checkAIAccess(userId)
    if (!access.allowed) {
      // 限速可重试 ⇒ 429；额度类（月/日/全局）⇒ 403
      const status = access.code === 'rate_limited' ? 429 : 403
      return res.status(status).json({ message: access.message, code: access.code })
    }

    // L2 刹车：按字符预算截断历史 + context 瘦身（防超长输入绕过次数额度）
    const messages = truncateMessages(req.body?.messages)
    const context = slimContext(req.body?.context)
    if (!messages.length) {
      return res.status(400).json({ message: '请提供对话内容' })
    }

    // L3 降本：输出上限归一化（原为硬编码 1500，会覆盖前端的 800，且可被撞满导致成本 ×2.4）
    const maxTokens = normalizeMaxTokens(req.body?.max_tokens)

    // ========================================================================
    // v1.13.165：提问留痕（数据驱动 FAQ 的前置）—— 落「FAQ 没拦住的真实问法」
    // ------------------------------------------------------------------------
    // ★ 位置三原则（改动请勿挪动，见 utils/aiQuestionLog.js 头部）：
    //   · 闸门之后     ⇒ 被 403/429 拒的请求**零写入**（161「空 body 连打零成本」不被破坏）
    //   · body 校验之后 ⇒ 无问法不落库
    //   · 缓存之前     ⇒ 重复提问也留痕（重复＝该加指引的最强信号）
    //   外加：在调上游之前 ⇒ 上游失败同样留痕。
    // 只记问法文本，不记 context 内容/回答/IP（隐私边界见 utils/aiQuestionLog.js）
    // ========================================================================
    logAiQuestion(getDb(), { userId, endpoint: 'chat', messages, context })

    // L3 降本：同问短时缓存 —— 完全相同的请求（同账号 + 同对话 + 同 context + 同输出上限）直接复用。
    // key 含 userId（隐私红线：绝不跨账号共享回答）；命中即不调上游、不记账、不产生任何费用。
    const reqCacheKey = cacheKey({ model: MODEL, userId, messages, context, maxTokens })
    const cachedResp = getCached(reqCacheKey)
    if (cachedResp) {
      console.log(`[AI-Cache] hit user=${userId} endpoint=chat → 复用结果（未调用上游、未记账）`)
      return res.json(cachedResp)
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

当前用户数据概览：
${context ? JSON.stringify(context, null, 2) : '暂无'}

## 回复规则（必须遵守）
1. POI相关问题**必须调用工具**，禁止直接回复文字说"我来帮您搜索"
2. 其他地图操作优先使用工具
3. 用简洁的中文回复，告知用户执行了什么操作
4. 如果需要用户配合（如点击地图），明确告知`

    // 4C-D4：数据外发审计留痕（对话内容 + 用户数据概览将发送至火山方舟）
    logAiEgress(userId, 'chat', JSON.stringify(messages || []).length + (context ? JSON.stringify(context).length : 0))

    const response = await fetchWithTimeout(`${ARK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        // v1.13.167：① chat 首轮 —— 关思考链（详因见文件头 THINKING_DISABLED 注释）
        thinking: THINKING_DISABLED,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        tools,
        // v1.13.162：改为 'auto'。原为 'required'（强制每次都必须调工具），实价实测两个后果：
        //   ① 纯问答被逼进工具模式 ⇒ finish_reason='tool_calls' 但 tool_calls 为空、content 也为空
        //      ⇒ 落到下方兜底串「好的，我来帮您处理。」＝**假回复**（用户拿不到真答案）
        //   ② 被逼「既调工具又写正文」⇒ 撞满 max_tokens（实测 finish=length、耗时 26.2s、成本 ×2.4）
        // 'auto' 下指令类请求仍正常触发工具（实测 filter_markers / poi_around_search 命中 2/2）。
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: maxTokens
      })
    }, AI_TIMEOUT_MS)

    if (!response.ok) {
      const err = await response.text()
      console.error('豆包 API 错误:', err)
      return res.status(500).json({ message: 'AI 服务暂时不可用', detail: err })
    }

    const result = await response.json()
    const choice = result.choices?.[0]

    // 记录本次token消耗（endpoint='chat' ⇒ 计入「一次问答」额度）
    if (result.usage) {
      const totalTokens = (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0)
      recordTokenUsage(userId, totalTokens, 'chat')
    }

    if (!choice) {
      return res.status(500).json({ message: 'AI 返回数据异常' })
    }

    // 如果有 Function Calling，需要处理工具调用
    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      const toolCalls = choice.message.tool_calls

      // ======================================================================
      // v1.13.169：折叠「同名 + 同参」的重复工具调用
      // ----------------------------------------------------------------------
      // 起因：2.1-pro 对服务端只读工具偶发重复调用（`query_city_data` ×2，3/3 复现）。
      // ⚠️ 只折叠「执行」，**不折叠 id** —— 下方 toolResults 仍与上游 toolCalls 严格 1:1
      //    （协议要求每个 tool_call_id 都有对应 tool 消息，少一条续轮直接 400），
      //    重复项复用首次出现的结果。详见 utils/toolCallGuard.js 头注释。
      // 只折叠「完全相同」的调用；参数不同的同名调用（如对比上海/北京）会被保留。
      // ======================================================================
      const { unique: uniqueToolCalls, aliasOf, collapsed } = dedupeToolCalls(toolCalls)
      if (collapsed > 0) {
        console.log(`[AI-Dedup] 折叠重复工具调用 ${toolCalls.length} → ${uniqueToolCalls.length}（折叠 ${collapsed} 条, user=${userId}）`)
      }

      // 处理需要查询数据库的工具（query_stats）—— 只对**首次出现**的执行
      const resultById = new Map()
      for (const tc of uniqueToolCalls) {
        const args = JSON.parse(tc.function.arguments || '{}')
        if (serverSideTools.includes(tc.function.name)) {
          resultById.set(tc.id, await executeServerTool(tc.function.name, userId, args))
        } else {
          // 其他工具由前端执行，这里返回 pending 标记
          resultById.set(tc.id, { status: 'client_side', args })
        }
      }

      // 🔴 必须与 toolCalls 等长（1:1）：折叠项通过 aliasOf 取回首条的结果
      const toolResults = toolCalls.map(tc => ({
        tool_call_id: tc.id,
        name: tc.function.name,
        result: resultById.get(aliasOf.get(tc.id) ?? tc.id)
      }))

      // 如果有需要前端执行的工具，直接返回给前端处理
      const clientSideTools = toolResults.filter(t => t.result?.status === 'client_side')
      if (clientSideTools.length > 0) {
        const payload = {
          type: 'tool_calls',
          // ⚠️ 下发给前端的清单用去重后的 uniqueToolCalls（前端逐个 emit、无去重）
          tool_calls: uniqueToolCalls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}')
          })),
          assistant_message: choice.message
        }
        // 纯前端工具（无服务端查询结果）⇒ 结果里不含任何数据快照，复用完全安全：
        // 前端拿到同一组指令后会**对着当时的实时数据**重新执行，不存在陈旧问题。
        setCached(reqCacheKey, payload)
        return res.json(payload)
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

      const followUp = await fetchWithTimeout(`${ARK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ARK_API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          // v1.13.167：② chat 工具续轮（把工具结果润色成中文回复，同样无需思考链）
          thinking: THINKING_DISABLED,
          messages: followUpMessages,
          temperature: 0.3,
          max_tokens: 400
        })
      }, AI_TIMEOUT_MS)

      const followUpResult = await followUp.json()
      // v1.13.162：原本由 systemPrompt 让模型复述的「高消耗查询提示」，改由服务端按实际调用的工具拼接
      const rawFollowUpContent = followUpResult.choices?.[0]?.message?.content
      const finalContent = appendServerToolHints(
        rawFollowUpContent || '已完成统计查询',
        toolResults.map(t => t.name)
      )

      // 记录followUp的token消耗（只贡献 token，不计入次数额度）
      if (followUpResult.usage) {
        const totalTokens = (followUpResult.usage.prompt_tokens || 0) + (followUpResult.usage.completion_tokens || 0)
        recordTokenUsage(userId, totalTokens, 'chat-followup')
      }

      const followUpPayload = { type: 'text', content: finalContent }
      // 仅当模型确实产出了正文才缓存（避免把兜底串当答案缓存下来、放大问题）
      if (rawFollowUpContent) setCached(reqCacheKey, followUpPayload)
      return res.json(followUpPayload)
    }

    // 普通文字回复
    // ⚠️ 空回复不缓存：把兜底串缓存下来会让「假回复」在 TTL 内反复被复用
    const realContent = choice.message?.content
    const textPayload = { type: 'text', content: realContent || '好的，我来帮您处理。' }
    if (realContent) setCached(reqCacheKey, textPayload)
    res.json(textPayload)

  } catch (error) {
    console.error('AI 接口错误:', error)
    res.status(500).json({ message: '服务器错误，请稍后重试' })
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
  const r = await fetchWithTimeout(`https://mka-online.cn/api/city-data/${encodeURIComponent(city)}`, {}, DEFAULT_HTTP_TIMEOUT_MS)
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
  const r = await fetchWithTimeout(`https://mka-online.cn/api/mall-tenants?${params}`, {}, DEFAULT_HTTP_TIMEOUT_MS)
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
  const r = await fetchWithTimeout(`https://mka-online.cn/api/mall-tenants/compare?${params}`, {}, DEFAULT_HTTP_TIMEOUT_MS)
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
  const r = await fetchWithTimeout('https://mka-online.cn/api/shapefiles/calculate-potential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cityName: city, radius, myStoreMin: min_stores, competitorMin: min_competitors, conditions: [] })
  }, 30000)
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

    // 检查AI使用权限（与 AI 助手共用同一额度闸门）
    const access = checkAIAccess(userId)
    if (!access.allowed) {
      const status = access.code === 'rate_limited' ? 429 : 403
      return res.status(status).json({ message: access.message, code: access.code })
    }
    // VIP 门禁：AI 选址建议仅 VIP 用户可用（判据抽到 utils/aiQuota.js::isVipActive，管理员视为 VIP）
    if (!isVipActive(loadAiUser(getDb(), userId))) {
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

    // 4C-D4：数据外发审计留痕（联通人口摘要 + 周边要素将发送至火山方舟）
    logAiEgress(userId, 'site-advice', (dataSummary || '').length + (surroundings || '').length)

    // 流式：只对「连接+首字节」计时，避免打断长回答；非流式：整体 90s
    const response = stream
      ? await fetchStreamWithTimeout(`${ARK_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ARK_API_KEY}`
          },
          body: JSON.stringify({
            model: MODEL,
            // v1.13.167：③ site-advice 流式 —— 关思考链（原思考期不吐首字节，贴着 STREAM_HEAD_TIMEOUT_MS）
            thinking: THINKING_DISABLED,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent }
            ],
            temperature: 0.5,
            max_tokens: 1200,
            stream: true,
            // 流式模式下让最后一块携带 usage（用于 token 用量统计）
            stream_options: { include_usage: true }
          })
        }, STREAM_HEAD_TIMEOUT_MS)
      : await fetchWithTimeout(`${ARK_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ARK_API_KEY}`
          },
          body: JSON.stringify({
            model: MODEL,
            // v1.13.167：④ site-advice 非流式 —— 关思考链
            thinking: THINKING_DISABLED,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent }
            ],
            temperature: 0.5,
            max_tokens: 1200
          })
        }, AI_TIMEOUT_MS)

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
      let saCounted = false
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
                  const t = (chunk.usage.prompt_tokens || 0) + (chunk.usage.completion_tokens || 0)
                  // 首次 usage 计 1 次额度；同一请求若出现多块 usage，后续只贡献 token
                  recordTokenUsage(userId, t, saCounted ? 'site-advice-extra' : 'site-advice')
                  saCounted = true
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

    // 记录token消耗（endpoint='site-advice' ⇒ 计入「一次问答」额度）
    if (result.usage) {
      const totalTokens = (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0)
      recordTokenUsage(userId, totalTokens, 'site-advice')
    }

    res.json({ success: true, reply })
  } catch (e) {
    console.error('[site-advice] 失败:', e.message)
    res.status(500).json({ message: '选址建议生成失败，请稍后重试' })
  }
})

export default router
