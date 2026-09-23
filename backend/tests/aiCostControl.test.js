/**
 * AI 单次成本控制测试 —— v1.13.162（L3 降本）
 *
 * 需求（用户原话，2026-09-21）：
 *   「能直接压低单次成本 ~30–50% 的话，按你的建议单独一批（改动小、验证也便宜）来吧」
 *
 * ⚠️ 本批的立项依据是**实价探针实测**，不是估算（7 次真实对照调用，见 §0）：
 *   单次调用 prompt ≈ 3889 tok、completion 67~1500 tok ⇒ **prompt 占总成本约 88%**
 *   prompt 构成 = systemPrompt 1573 字符 + 20 个工具 schema 7378 字符
 *   由此推出四项改动（本文件逐项钉死）：
 *     A. `tool_choice: 'required'` → `'auto'`
 *        实测后果①：纯问答被逼进工具模式 ⇒ finish_reason='tool_calls' 但 tool_calls 为空、
 *                   content 也为空 ⇒ 落到兜底串「好的，我来帮您处理。」＝**假回复**
 *        实测后果②：被逼「又调工具又写正文」⇒ 撞满 max_tokens（finish=length、26.2s、成本 ×2.4）
 *     B. `max_tokens: 1500` 硬编码 → 尊重前端请求值 + 封顶（原值会把前端的 800 覆盖掉）
 *     C. systemPrompt 里「⚠️ 高消耗查询引导」整段（~400 字符）搬到服务端拼接
 *        ⇒ 每次调用恒定省 prompt，且三段文案 100% 稳定（不再靠模型复述）
 *     D. 同问短时缓存：完全相同的请求复用结果 ⇒ 重复提问 0 成本
 *        🔴 key 必须含 userId（隐私红线：跨账号串答是数据泄露）
 *
 * 被测：src/routes/ai.js + src/utils/aiResponseCache.js + src/utils/aiQuota.js
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库；
 * 上游（火山方舟 / 高德 / 站内 API）全部打桩，**绝不发出真实外网请求**。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-aicost-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
process.env.AI_RATE_PER_MINUTE = '50'   // 本文件不做限速验证，放宽以免干扰
process.env.AI_CACHE_TTL_MS = '600000'  // 10 分钟，与生产默认一致

// ---------------------------------------------------------------------------
// 上游打桩：把每次调用记录下来（用于断言请求体），并按 URL 分流
//   - ark.cn-beijing.volces.com  → 大模型响应（由 __r4bResponder 决定）
//   - 其它（工具内部的站内 API）  → 一律返回失败对象，避免测试依赖真实数据形状
// 用 globalThis 传递共享状态，避免依赖 vi.hoisted 的版本行为。
// ---------------------------------------------------------------------------
globalThis.__r4bUpstream = { calls: [], responder: null }

vi.mock('../src/utils/httpTimeout.js', () => ({
  DEFAULT_HTTP_TIMEOUT_MS: 15000,
  STREAM_HEAD_TIMEOUT_MS: 15000,
  fetchWithTimeout: vi.fn(async (url, opts) => {
    const st = globalThis.__r4bUpstream
    let parsed = null
    try { parsed = opts?.body ? JSON.parse(opts.body) : null } catch (e) { parsed = null }
    st.calls.push({ url: String(url), body: parsed })

    if (!String(url).includes('ark.cn-beijing.volces.com')) {
      // 工具内部调用站内 API —— 返回失败对象即可（工具函数有 try/catch，不会炸）
      return { ok: false, status: 500, text: async () => '', json: async () => ({ success: false, error: 'mock' }) }
    }
    const responder = st.responder || defaultLlmResponder
    const body = responder(parsed)
    return { ok: true, status: 200, text: async () => '', json: async () => body }
  }),
  fetchStreamWithTimeout: vi.fn()
}))

vi.mock('../src/utils/amapPoi.js', () => ({
  aroundSearch: vi.fn(async () => [])
}))

/** 默认：纯文字回复（模拟 'auto' 下正常问答） */
function defaultLlmResponder(parsed) {
  if (parsed && parsed.tools) {
    return {
      choices: [{ message: { role: 'assistant', content: '这是真实回答' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3800, completion_tokens: 120 }
    }
  }
  return {
    choices: [{ message: { role: 'assistant', content: '统计完成' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3000, completion_tokens: 80 }
  }
}

/** 让首轮返回一个工具调用；续轮（无 tools）返回普通文字 */
function toolCallResponder(name, args = {}) {
  return (parsed) => {
    if (parsed && parsed.tools) {
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'tc1', type: 'function', function: { name, arguments: JSON.stringify(args) } }]
          },
          finish_reason: 'tool_calls'
        }],
        usage: { prompt_tokens: 3800, completion_tokens: 60 }
      }
    }
    return {
      choices: [{ message: { role: 'assistant', content: '已为您完成查询' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3000, completion_tokens: 80 }
    }
  }
}

/** 复刻生产观察到的病态响应：finish_reason 说调了工具，但 tool_calls 为空、content 为空 */
function emptyToolCallsResponder() {
  return () => ({
    choices: [{ message: { role: 'assistant', content: '', tool_calls: undefined }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 3889, completion_tokens: 67 }
  })
}

let db, signToken
let normalizeMaxTokens, normalizeCacheKey, clearAiCache, getCached, setCached, cacheStats
let AI_MAX_OUTPUT_TOKENS, AI_DEFAULT_OUTPUT_TOKENS, AI_CACHE_MAX_ENTRIES
let server, base

const ids = {}
const tokens = {}

async function call(method, p, { token, body } = {}, retry = true) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetch(base + p, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
  } catch (e) {
    if (retry) return call(method, p, { token, body }, false)
    throw e
  }
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, body: json }
}

const upstream = () => globalThis.__r4bUpstream
const llmCalls = () => upstream().calls.filter(c => c.url.includes('ark.cn-beijing.volces.com'))
const firstCallBody = () => llmCalls()[0]?.body
const lastCallBody = () => { const a = llmCalls(); return a[a.length - 1]?.body }
const resetUpstream = () => { upstream().calls.length = 0; upstream().responder = null }
const usageRows = () => db.prepare(`SELECT COUNT(*) AS c FROM ai_usage`).get().c

function ask(userKey, text, extra = {}) {
  return call('POST', '/api/ai/chat', {
    token: tokens[userKey],
    body: { messages: [{ role: 'user', content: text }], ...extra }
  })
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()

  const q = await import('../src/utils/aiQuota.js')
  normalizeMaxTokens = q.normalizeMaxTokens
  AI_MAX_OUTPUT_TOKENS = q.AI_MAX_OUTPUT_TOKENS
  AI_DEFAULT_OUTPUT_TOKENS = q.AI_DEFAULT_OUTPUT_TOKENS
  AI_CACHE_MAX_ENTRIES = q.AI_CACHE_MAX_ENTRIES

  const c = await import('../src/utils/aiResponseCache.js')
  normalizeCacheKey = c.cacheKey
  clearAiCache = c.clearAiCache
  getCached = c.getCached
  setCached = c.setCached
  cacheStats = c.cacheStats

  const { signToken: st } = await import('../src/utils/tokenAuth.js')
  signToken = st

  const mkUser = (username, role = 'user') => {
    const r = db.prepare(
      `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, 0)`
    ).run(username, `${username}@test.local`, 'x', role)
    return r.lastInsertRowid
  }
  ids.admin = mkUser('cc_admin', 'admin')
  ids.u1 = mkUser('cc_u1', 'user')
  ids.u2 = mkUser('cc_u2', 'user')
  ids.vip = mkUser('cc_vip', 'vip')

  for (const k of Object.keys(ids)) {
    tokens[k] = signToken({ id: ids[k], username: `cc_${k}`, role: 'user', token_version: 0 })
  }

  const express = (await import('express')).default
  const aiRouter = (await import('../src/routes/ai.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/ai', aiRouter)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

beforeEach(() => {
  db.prepare(`DELETE FROM ai_usage`).run()
  clearAiCache()
  resetUpstream()
})

// ===========================================================================
describe('A. tool_choice：改 required 为 auto（修假回复 + 消失控）', () => {
  it('A1 首轮请求体的 tool_choice 必须是 auto，且全程不再出现 required', async () => {
    await ask('u1', '你能做什么？一句话')
    expect(firstCallBody().tool_choice).toBe('auto')
    expect(llmCalls().every(c => c.body.tool_choice !== 'required')).toBe(true)
  })

  it('A2 ⭐ 纯问答必须返回真实内容，而不是兜底串「好的，我来帮您处理。」', async () => {
    const r = await ask('u1', '你能做什么？一句话')
    expect(r.status).toBe(200)
    expect(r.body.content).toBe('这是真实回答')
    expect(r.body.content).not.toContain('好的，我来帮您处理')
  })

  it('A3 复刻病态响应（finish=tool_calls 但 tool_calls 为空）⇒ 仍回落兜底串，且**不得被缓存**', async () => {
    upstream().responder = emptyToolCallsResponder()
    const r1 = await ask('u1', '病态场景')
    expect(r1.status).toBe(200)
    expect(r1.body.content).toBe('好的，我来帮您处理。')   // 兜底仍在（不改变降级行为）
    expect(r1.body.cached).toBeUndefined()

    // 关键：假回复不得进缓存，否则 TTL 内会被反复复用
    const before = llmCalls().length
    await ask('u1', '病态场景')
    expect(llmCalls().length).toBe(before + 1)
  })

  it('A4 指令类请求在 auto 下仍能触发工具（首轮 tool_choice 为 auto 且返回 tool_calls）', async () => {
    upstream().responder = toolCallResponder('filter_markers', { city: '北京' })
    const r = await ask('u1', '显示北京的已开业门店')
    expect(r.status).toBe(200)
    expect(r.body.type).toBe('tool_calls')
    expect(r.body.tool_calls[0].name).toBe('filter_markers')
  })
})

// ===========================================================================
describe('B. max_tokens：尊重请求值 + 封顶（原为硬编码 1500）', () => {
  it('B1 纯函数：缺省/非法 ⇒ 默认 800；超限 ⇒ 封顶；更小值 ⇒ 尊重', () => {
    expect(normalizeMaxTokens(undefined)).toBe(AI_DEFAULT_OUTPUT_TOKENS)
    expect(normalizeMaxTokens(null)).toBe(AI_DEFAULT_OUTPUT_TOKENS)
    expect(normalizeMaxTokens('abc')).toBe(AI_DEFAULT_OUTPUT_TOKENS)
    expect(normalizeMaxTokens(0)).toBe(AI_DEFAULT_OUTPUT_TOKENS)
    expect(normalizeMaxTokens(-5)).toBe(AI_DEFAULT_OUTPUT_TOKENS)
    expect(normalizeMaxTokens(99999)).toBe(AI_MAX_OUTPUT_TOKENS)
    expect(normalizeMaxTokens(300)).toBe(300)
    expect(normalizeMaxTokens(800.9)).toBe(800)
  })

  it('B2 请求不带 max_tokens ⇒ 上游收到 800（不再是 1500）', async () => {
    await ask('u1', '不带输出上限')
    expect(firstCallBody().max_tokens).toBe(800)
  })

  it('B3 ⭐ 请求要 5000 ⇒ 上游被封顶到上限（防单次写爆）', async () => {
    await ask('u1', '要一个超大上限', { max_tokens: 5000 })
    expect(firstCallBody().max_tokens).toBe(AI_MAX_OUTPUT_TOKENS)
    expect(firstCallBody().max_tokens).toBe(1000)
  })

  it('B4 请求要 300 ⇒ 上游收到 300（尊重更小值）', async () => {
    await ask('u1', '要一个小上限', { max_tokens: 300 })
    expect(firstCallBody().max_tokens).toBe(300)
  })

  it('B5 非法值 ⇒ 回落默认 800', async () => {
    await ask('u1', '非法上限', { max_tokens: '哈哈哈' })
    expect(firstCallBody().max_tokens).toBe(800)
  })
})

// ===========================================================================
describe('C. 高消耗提示改服务端拼接（systemPrompt 瘦身）', () => {
  it('C1 ⭐ systemPrompt 里不再含提示指令，且长度已下降（防回退）', async () => {
    await ask('u1', '随便问一句')
    const sp = firstCallBody().messages[0].content
    expect(sp).not.toContain('回复结尾必须加上')
    expect(sp).not.toContain('高消耗查询引导')
    expect(sp).not.toContain('💡 提示')
    expect(sp.length).toBeLessThan(1300)
  })

  it('C2 query_mall_tenants ⇒ 服务端补上对应提示原文', async () => {
    upstream().responder = toolCallResponder('query_mall_tenants', { mall: '某某广场' })
    const r = await ask('u1', '这个商场有哪些餐厅')
    expect(r.status).toBe(200)
    expect(r.body.type).toBe('text')
    expect(r.body.content).toContain('已为您完成查询')
    expect(r.body.content).toContain('💡 提示：此查询消耗 token 较大。建议您打开左侧「购物中心」页面 → 点击目标商场名称')
  })

  it('C3 compare_mall_tenants ⇒ 补商场商户对比的提示', async () => {
    upstream().responder = toolCallResponder('compare_mall_tenants', {})
    const r = await ask('u1', '对比两个商场的餐厅')
    expect(r.body.content).toContain('在「餐饮商户」Tab中选择「商户对比」功能自助操作')
  })

  it('C4 calculate_potential ⇒ 补开店余地的提示', async () => {
    upstream().responder = toolCallResponder('calculate_potential', {})
    const r = await ask('u1', '帮我看看开店余地')
    expect(r.body.content).toContain('在地图工具栏中点击「开店余地」按钮自助分析')
  })

  it('C5 模型自己已经写了「💡 提示」⇒ 不重复拼接（防叠字）', async () => {
    upstream().responder = (parsed) => {
      if (parsed && parsed.tools) {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'query_mall_tenants', arguments: '{}' } }]
            },
            finish_reason: 'tool_calls'
          }],
          usage: { prompt_tokens: 3800, completion_tokens: 60 }
        }
      }
      return {
        choices: [{ message: { role: 'assistant', content: '结果如下。\n\n💡 提示：请自助查看。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3000, completion_tokens: 80 }
      }
    }
    const r = await ask('u1', '商场餐厅')
    expect(r.body.content.match(/💡 提示/g).length).toBe(1)
  })

  it('C6 非高消耗的服务端工具（query_stats）⇒ 不拼接任何提示', async () => {
    upstream().responder = toolCallResponder('query_stats', { group_by: 'city' })
    const r = await ask('u1', '按城市统计门店')
    expect(r.body.type).toBe('text')
    expect(r.body.content).not.toContain('💡 提示')
  })
})

// ===========================================================================
describe('D. 同问短时缓存（重复提问 0 成本）', () => {
  it('D1 ⭐⭐ 同账号同请求第二次 ⇒ 不调上游、不记 ai_usage、响应带 cached:true', async () => {
    const r1 = await ask('u1', '重复的问题')
    expect(r1.status).toBe(200)
    expect(r1.body.cached).toBeUndefined()
    const rowsAfterFirst = usageRows()
    const callsAfterFirst = llmCalls().length
    expect(callsAfterFirst).toBe(1)

    const r2 = await ask('u1', '重复的问题')
    expect(r2.status).toBe(200)
    expect(r2.body.cached).toBe(true)
    expect(r2.body.content).toBe(r1.body.content)
    expect(llmCalls().length).toBe(callsAfterFirst)      // 未再调上游
    expect(usageRows()).toBe(rowsAfterFirst)              // 未再记账
  })

  it('D2 🔴 不同账号问同一句话 ⇒ 各自调上游（绝不跨账号命中）', async () => {
    await ask('u1', '同一句话')
    const n1 = llmCalls().length
    const r = await ask('u2', '同一句话')
    expect(llmCalls().length).toBe(n1 + 1)
    expect(r.body.cached).toBeUndefined()
  })

  it('D3 输出上限不同 ⇒ 视为不同请求（不互相命中）', async () => {
    await ask('u1', '同句不同上限', { max_tokens: 400 })
    const n1 = llmCalls().length
    await ask('u1', '同句不同上限', { max_tokens: 800 })
    expect(llmCalls().length).toBe(n1 + 1)
  })

  it('D4 context 不同 ⇒ 视为不同请求', async () => {
    await ask('u1', '同句不同 context', { context: { currentCity: '北京' } })
    const n1 = llmCalls().length
    await ask('u1', '同句不同 context', { context: { currentCity: '上海' } })
    expect(llmCalls().length).toBe(n1 + 1)
  })

  it('D5 纯前端工具的 tool_calls 响应可缓存（复用安全：前端按实时数据重跑）', async () => {
    upstream().responder = toolCallResponder('filter_markers', { city: '北京' })
    const r1 = await ask('u1', '显示北京门店')
    expect(r1.body.type).toBe('tool_calls')
    const n1 = llmCalls().length
    const r2 = await ask('u1', '显示北京门店')
    expect(llmCalls().length).toBe(n1)
    expect(r2.body.cached).toBe(true)
    expect(r2.body.tool_calls[0].name).toBe('filter_markers')
  })

  it('D6 空回复（兜底串）不入缓存 ⇒ 第二次仍会调上游', async () => {
    upstream().responder = emptyToolCallsResponder()
    await ask('u1', '空回复场景')
    const n1 = llmCalls().length
    upstream().responder = defaultLlmResponder
    const r2 = await ask('u1', '空回复场景')
    expect(llmCalls().length).toBe(n1 + 1)
    expect(r2.body.content).toBe('这是真实回答')
  })
})

// ===========================================================================
describe('E. 🔴 闸门必须优先于缓存（缓存不得绕过额度/限速）', () => {
  it('E1 已缓存过的请求，在额度耗尽后必须 403 而不是命中缓存 200', async () => {
    const r1 = await ask('u1', '会被缓存的句子')
    expect(r1.status).toBe(200)

    // 把普通用户本月额度（100 次）用满
    db.beginTx()
    try {
      const stmt = db.prepare(`INSERT INTO ai_usage (user_id, tokens_used, endpoint) VALUES (?, ?, 'chat')`)
      for (let i = 0; i < 100; i++) stmt.run(ids.u1, 100)
    } finally {
      db.commitTx()
    }

    const r2 = await ask('u1', '会被缓存的句子')
    expect(r2.status).toBe(403)
    expect(r2.body.code).toBe('monthly_exhausted')
  })
})

// ===========================================================================
describe('F. 缓存模块单测（key 含 userId / TTL / LRU）', () => {
  const baseReq = { model: 'm', userId: 1, messages: [{ role: 'user', content: 'hi' }], context: null, maxTokens: 800 }

  it('F1 🔴 key 必须随 userId 变化（隐私红线）', () => {
    const k1 = normalizeCacheKey(baseReq)
    const k2 = normalizeCacheKey({ ...baseReq, userId: 2 })
    expect(k1).not.toBe(k2)
    expect(normalizeCacheKey(baseReq)).toBe(k1)   // 同输入稳定
  })

  it('F2 key 随 messages / context / maxTokens 变化', () => {
    const k = normalizeCacheKey(baseReq)
    expect(normalizeCacheKey({ ...baseReq, messages: [{ role: 'user', content: 'hi2' }] })).not.toBe(k)
    expect(normalizeCacheKey({ ...baseReq, context: { a: 1 } })).not.toBe(k)
    expect(normalizeCacheKey({ ...baseReq, maxTokens: 400 })).not.toBe(k)
    expect(normalizeCacheKey({ ...baseReq, model: 'm2' })).not.toBe(k)
  })

  it('F3 TTL 到期即失效，且过期条目被顺带删除', () => {
    clearAiCache()
    setCached('k1', { type: 'text', content: 'v' }, 1000, 500)
    expect(getCached('k1', 1499)).toMatchObject({ content: 'v', cached: true })
    expect(getCached('k1', 1500)).toBeNull()      // 到期
    expect(cacheStats().size).toBe(0)             // 已删除
  })

  it('F4 TTL<=0 等于关闭缓存', () => {
    clearAiCache()
    setCached('k1', { type: 'text', content: 'v' }, 0, 0)
    expect(getCached('k1', 0)).toBeNull()
    expect(cacheStats().size).toBe(0)
  })

  it('F5 超上限按 LRU 淘汰最旧条目', () => {
    clearAiCache()
    for (let i = 0; i < AI_CACHE_MAX_ENTRIES + 5; i++) {
      setCached('k' + i, { type: 'text', content: 'v' + i }, 0, 100000)
    }
    expect(cacheStats().size).toBe(AI_CACHE_MAX_ENTRIES)
    expect(getCached('k0', 0)).toBeNull()                                  // 最旧的被挤掉
    expect(getCached('k' + (AI_CACHE_MAX_ENTRIES + 4), 0)).not.toBeNull()  // 最新的在
  })

  it('F6 返回值是副本，外部改动不污染缓存', () => {
    clearAiCache()
    setCached('k1', { type: 'text', content: 'orig' }, 0, 100000)
    const got = getCached('k1', 0)
    got.content = 'mutated'
    expect(getCached('k1', 0).content).toBe('orig')
  })
})

// ===========================================================================
/**
 * G. 关思考链 —— v1.13.167
 *
 * 立项依据同样是**实价探针实测**（2026-09-23 直连方舟同题对照，见
 * Report4biz_豆包模型下线影响评估_20260923.md §②）：
 *   不传 thinking ⇒ completion 3391 tok（reasoning 2586，占 76%）⇒ ¥0.0546/次
 *   传 disabled   ⇒ completion  870 tok（reasoning    0）        ⇒ ¥0.0142/次（**−74%**）
 * 关键性质：`reasoning_tokens` 按**输出价**计费（¥16/百万 = 输入价 5 倍），
 * 且 `max_tokens` 管不住它（实测 max_tokens=300 仍出 507 tok）。
 * ⇒ 这是**确定性**降本（不是抽样噪声：reasoning 归零是协议级事实）。
 *
 * 必须四处都关（缺一即漏）：
 *   ① /chat 首轮  ② /chat 工具续轮  ③ /site-advice 流式  ④ /site-advice 非流式
 * ①② 用运行时打桩断言（本文件已能捕获上游请求体）；③④ 用源码计数守卫
 * （流式路径需额外打桩 fetchStreamWithTimeout，成本高于收益 ⇒ 以源码守卫覆盖）。
 */
describe('G. 关思考链（v1.13.167）—— 消除 reasoning token 按输出价计费', () => {
  it('G1 ⭐ /chat 首轮请求体必须显式 thinking:{type:"disabled"}', async () => {
    await ask('u1', '关思考链-首轮')
    expect(firstCallBody().thinking).toEqual({ type: 'disabled' })
  })

  it('G2 ⭐ /chat 工具续轮同样必须关闭（否则续轮又按输出价付思考链）', async () => {
    upstream().responder = toolCallResponder('query_stats', { group_by: 'city' })
    const r = await ask('u1', '关思考链-续轮')
    expect(r.status).toBe(200)
    expect(r.body.type).toBe('text')
    expect(llmCalls().length).toBe(2)                       // 首轮 + 续轮
    expect(firstCallBody().thinking).toEqual({ type: 'disabled' })
    expect(lastCallBody().thinking).toEqual({ type: 'disabled' })
  })

  it('G3 🔴 源码守卫：恰好 4 处请求体带 disabled，且全篇无 enabled/auto 回退', () => {
    const src = fs.readFileSync(new URL('../src/routes/ai.js', import.meta.url), 'utf8')
    const lines = src.split('\n').filter((l) => !l.trim().startsWith('//'))

    // ① 使用点必须正好 4 处（注释行已过滤，防止"只改注释"式假通过）
    const used = lines.filter((l) => /thinking:\s*THINKING_DISABLED/.test(l))
    expect(used.length).toBe(4)

    // ② 常量本身的取值必须是 disabled
    expect(src).toMatch(/const THINKING_DISABLED = \{ type: 'disabled' \}/)

    // ③ 禁止任何形式的「开启 / 自动」思考链回退
    expect(src).not.toMatch(/type:\s*'enabled'/)
    expect(src).not.toMatch(/type:\s*'auto'/)

    // ④ 上游请求体共 4 处（model: MODEL 另有 1 处在缓存 key 上）⇒ 数量对得上
    //    才说明没有新增请求体而漏配 thinking
    expect((src.match(/model: MODEL/g) || []).length).toBe(5)
  })

  it('G4 关闭思考链不改变既有响应形状（回答照常返回、照常记账）', async () => {
    const r = await ask('u1', '关思考链-形状')
    expect(r.status).toBe(200)
    expect(r.body.type).toBe('text')
    expect(r.body.content).toBe('这是真实回答')
    expect(usageRows()).toBe(1)
  })
})

// ===========================================================================
// H. 工具调用折叠守卫（v1.13.169）
//    —— 重复调用只**执行一次**，但 tool_call_id 必须保持**严格 1:1**
// ===========================================================================
describe('H. 工具调用折叠守卫（v1.13.169）—— 2.1-pro 偶发重复调用', () => {
  /** 造一个「首轮返回 N 条工具调用、续轮返回普通文字」的响应 */
  function dupResponder(name, argList) {
    return (parsed) => {
      if (parsed && parsed.tools) {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: argList.map((args, i) => ({
                id: `tc${i + 1}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) }
              }))
            },
            finish_reason: 'tool_calls'
          }],
          usage: { prompt_tokens: 3800, completion_tokens: 60 }
        }
      }
      return {
        choices: [{ message: { role: 'assistant', content: '已为您完成查询' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3000, completion_tokens: 80 }
      }
    }
  }

  it('H1 前端工具重复 2 次 ⇒ 下发前端的清单只剩 1 条，并打出折叠日志', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      upstream().responder = dupResponder('filter_markers', [{ city: '上海' }, { city: '上海' }])
      const r = await ask('u1', '折叠-前端工具')
      expect(r.status).toBe(200)
      expect(r.body.type).toBe('tool_calls')
      expect(r.body.tool_calls.length).toBe(1)                    // 🔴 去重
      expect(r.body.tool_calls[0].name).toBe('filter_markers')
      expect(spy.mock.calls.some(c => String(c[0]).includes('[AI-Dedup]'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('H2 🔴 服务端工具重复 2 次 ⇒ 只执行一次，但续轮 tool 消息必须仍是 2 条（协议 1:1）', async () => {
    upstream().responder = dupResponder('query_stats', [{ group_by: 'city' }, { group_by: 'city' }])
    const r = await ask('u1', '折叠-服务端工具')
    expect(r.status).toBe(200)
    expect(r.body.type).toBe('text')
    expect(llmCalls().length).toBe(2)                             // 首轮 + 续轮

    const msgs = lastCallBody().messages
    const toolMsgs = msgs.filter(m => m.role === 'tool')
    expect(toolMsgs.length).toBe(2)                               // 🔴 少一条上游直接 400
    expect(toolMsgs[0].content).toBe(toolMsgs[1].content)         // 重复项复用首条结果

    // assistant 消息里仍保留完整（未裁剪）的 tool_calls
    const asst = msgs.filter(m => m.role === 'assistant' && Array.isArray(m.tool_calls)).pop()
    expect(asst.tool_calls.length).toBe(2)
    expect(asst.tool_calls.map(t => t.id)).toEqual(['tc1', 'tc2'])
  })

  it('H3 同名但参数不同 ⇒ 不折叠，两条都下发（合法多城用法）', async () => {
    upstream().responder = dupResponder('filter_markers', [{ city: '上海' }, { city: '北京' }])
    const r = await ask('u1', '折叠-不同参数')
    expect(r.status).toBe(200)
    expect(r.body.type).toBe('tool_calls')
    expect(r.body.tool_calls.length).toBe(2)
    expect(r.body.tool_calls.map(t => t.args.city)).toEqual(['上海', '北京'])
  })

  it('H4 无重复时行为不变（单条照旧下发）', async () => {
    upstream().responder = dupResponder('filter_markers', [{ city: '上海' }])
    const r = await ask('u1', '折叠-单条')
    expect(r.status).toBe(200)
    expect(r.body.type).toBe('tool_calls')
    expect(r.body.tool_calls.length).toBe(1)
  })

  it('H5 🔴 源码守卫：结果列表基于完整 toolCalls、仅下发给前端才用 unique（防重构打破 1:1）', () => {
    const src = fs.readFileSync(new URL('../src/routes/ai.js', import.meta.url), 'utf8')
    // ① 折叠调用存在
    expect(src).toMatch(/const \{ unique: uniqueToolCalls, aliasOf, collapsed \} = dedupeToolCalls\(toolCalls\)/)
    // ② toolResults 必须基于**完整** toolCalls.map（改成 uniqueToolCalls.map ⇒ 续轮 400）
    expect(src).toMatch(/const toolResults = toolCalls\.map\(/)
    expect(src).not.toMatch(/const toolResults = uniqueToolCalls\.map\(/)
    // ③ 下发前端的清单才用 uniqueToolCalls
    expect(src).toMatch(/tool_calls: uniqueToolCalls\.map\(/)
    // ④ 折叠项必须经 aliasOf 回映射（否则结果是 undefined）
    expect(src).toMatch(/resultById\.get\(aliasOf\.get\(tc\.id\) \?\? tc\.id\)/)
    // ⑤ 旧的「逐条 push」写法不得回潮
    expect(src).not.toMatch(/toolResults\.push\(/)
  })
})
