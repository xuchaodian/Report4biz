/**
 * AI 提问留痕测试 —— v1.13.165（数据驱动 FAQ 的前置）
 *
 * 需求（用户原话，2026-09-22）：
 *   「FAQ 命中率数据驱动 — 新增『提问原文落库』吧」
 *
 * 本批要钉死的三件事：
 *   A. 落库语义：记的是**最后一次用户发言**、只记问法不记 context 内容、超长截断到前 N 字符
 *   B. 相对位置（最关键，改代码时最容易被挪坏）：
 *        · 闸门之后   ⇒ 403/429 拒绝的请求**零写入**（161「空 body 连打零成本」不被破坏）
 *        · 校验之后   ⇒ 空/纯空白问法不落库
 *        · 缓存之前   ⇒ **重复提问（命中同问缓存）也要留痕**（重复＝该加指引的最强信号）
 *   C. 失败隔离：表缺失/写入报错**绝不影响 AI 问答可用性**（仍 200、仍记账）
 *
 * 被测：src/utils/aiQuestionLog.js（纯函数 + 落库）+ src/routes/ai.js（调用位置）
 *
 * ⚠️ 打桩：上游（火山方舟 / 高德 / 站内 API）全部 mock，**绝不发出真实外网请求**；
 *    库走 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 *
 * ⚠️ AI_RATE_PER_MINUTE 设为 3：本文件既要用「40 例都跑得动」的宽松额度，
 *    又要在 B/C 组验证「第 4 次必 429 且 0 落库」，故每个用例用**独立账号**避免互相干扰。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-aiq-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
process.env.AI_RATE_PER_MINUTE = '3'      // 低限速：用于验证「被拒 = 零落库」
process.env.AI_CACHE_TTL_MS = '600000'    // 10 分钟，与生产默认一致

// ---------------------------------------------------------------------------
// 上游打桩（同 aiCostControl.test.js 范式）
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
      // 工具/周边要素内部调用的站内 API —— 返回失败对象（工具函数自带 try/catch）
      return { ok: false, status: 500, text: async () => '', json: async () => ({ success: false, error: 'mock' }) }
    }
    const body = (st.responder || plainTextResponder)(parsed)
    return { ok: true, status: 200, text: async () => '', json: async () => body }
  }),
  fetchStreamWithTimeout: vi.fn()
}))

vi.mock('../src/utils/amapPoi.js', () => ({
  aroundSearch: vi.fn(async () => [])
}))

/** 普通文字回复（真内容 ⇒ 会被写入同问缓存，供「重复提问仍留痕」用例） */
function plainTextResponder() {
  return {
    choices: [{ message: { role: 'assistant', content: '这是真实回答' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3800, completion_tokens: 120 }
  }
}

let db, signToken
let logAiQuestion, extractQuestion, normalizeQuestion, AI_QUESTION_MAX_CHARS
let server, base

const tokens = {}
let userSeq = 0

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

/** 建一个全新账号（避开分钟限速与额度为别的用例记账） */
function newUser(tag, role = 'user') {
  const username = `aiq_${tag}_${++userSeq}`
  const r = db.prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, 0)`
  ).run(username, `${username}@test.local`, 'x', role)
  const id = r.lastInsertRowid
  const token = signToken({ id, username, role: 'user', token_version: 0 })
  tokens[username] = token
  return { id, token }
}

function ask(u, text, extra = {}) {
  return call('POST', '/api/ai/chat', {
    token: u.token,
    body: { messages: [{ role: 'user', content: text }], ...extra }
  })
}

/** 某账号的留痕行（按 id 升序） */
function rowsOf(u) {
  return db.prepare(`SELECT * FROM ai_questions WHERE user_id = ? ORDER BY id`).all(u.id)
}
const countOf = (u) => rowsOf(u).length
const upstreamCalls = () => globalThis.__r4bUpstream.calls.filter(c => c.url.includes('ark.cn-beijing.volces.com'))

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()

  const q = await import('../src/utils/aiQuota.js')
  AI_QUESTION_MAX_CHARS = q.AI_QUESTION_MAX_CHARS

  const m = await import('../src/utils/aiQuestionLog.js')
  logAiQuestion = m.logAiQuestion
  extractQuestion = m.extractQuestion
  normalizeQuestion = m.normalizeQuestion

  const { signToken: st } = await import('../src/utils/tokenAuth.js')
  signToken = st

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

beforeEach(async () => {
  db.prepare(`DELETE FROM ai_usage`).run()
  const c = await import('../src/utils/aiResponseCache.js')
  c.clearAiCache()
  globalThis.__r4bUpstream.calls.length = 0
  globalThis.__r4bUpstream.responder = null
})

// ===========================================================================
describe('A. 表结构与纯函数', () => {
  it('A1 ai_questions 表存在，且两个分析索引都在', () => {
    const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ai_questions'`).get()
    expect(t?.name).toBe('ai_questions')
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ai_questions'`)
      .all().map(r => r.name)
    expect(idx).toContain('idx_ai_questions_created')
    expect(idx).toContain('idx_ai_questions_user')
  })

  it('A2 extractQuestion 取**最后一次**用户发言（而非第一句）', () => {
    expect(extractQuestion([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '答' },
      { role: 'user', content: '那再看上海的' }
    ])).toBe('那再看上海的')
  })

  it('A3 extractQuestion 兼容多段块数组；非法输入返回空串', () => {
    expect(extractQuestion([
      { role: 'user', content: [{ type: 'text', text: '看这个' }, { type: 'text', text: '和这个' }] }
    ])).toBe('看这个 和这个')
    expect(extractQuestion(null)).toBe('')
    expect(extractQuestion([{ role: 'assistant', content: '只有 AI 的话' }])).toBe('')
  })

  it('A4 normalizeQuestion 折掉换行/连续空白 + 只留前 N 字符', () => {
    expect(normalizeQuestion('  怎么  导出\n报表？  ')).toBe('怎么 导出 报表？')
    const long = '问'.repeat(600)
    const out = normalizeQuestion(long)
    expect(out.length).toBe(AI_QUESTION_MAX_CHARS)
    expect(out).toBe(long.slice(0, AI_QUESTION_MAX_CHARS))
  })

  it('A5 参数非法（无 db / userId 为 0 / messages 为空）⇒ 返回 null 且不抛', () => {
    expect(logAiQuestion(null, { userId: 1, messages: [{ role: 'user', content: 'x' }] })).toBeNull()
    expect(logAiQuestion(db, { userId: 0, messages: [{ role: 'user', content: 'x' }] })).toBeNull()
    expect(logAiQuestion(db, { userId: 1, messages: [] })).toBeNull()
    expect(logAiQuestion(db, { userId: 1 })).toBeNull()
  })
})

// ===========================================================================
describe('B. 落库语义（真 HTTP 调用 /api/ai/chat）', () => {
  it('B1 一次问答落 1 行：原文逐字一致、长度/轮数/端点列正确', async () => {
    const u = newUser('b1')
    const r = await ask(u, '怎么导入门店')
    expect(r.status).toBe(200)

    const rows = rowsOf(u)
    expect(rows.length).toBe(1)
    expect(rows[0].question_text).toBe('怎么导入门店')
    expect(rows[0].question_len).toBe(6)
    expect(rows[0].msg_count).toBe(1)
    expect(rows[0].has_context).toBe(0)
    expect(rows[0].endpoint).toBe('chat')
    expect(rows[0].created_at).toBeTruthy()
  })

  it('B2 带 context ⇒ has_context=1，但**库里不含 context 内容**（隐私红线）', async () => {
    const u = newUser('b2')
    const marker = 'ZZZ-CTX-ONLY-12345'
    const r = await ask(u, '帮我看看这个店', { context: { city: '北京', storeId: marker } })
    expect(r.status).toBe(200)

    const rows = rowsOf(u)
    expect(rows.length).toBe(1)
    expect(rows[0].has_context).toBe(1)
    // 整行序列化后不得出现 context 里的特征串
    expect(JSON.stringify(rows[0])).not.toContain(marker)
    expect(JSON.stringify(rows[0])).not.toContain('北京')
  })

  it('B3 多轮会话 ⇒ 只落最后一次用户发言，msg_count 记整段长度', async () => {
    const u = newUser('b3')
    const r = await call('POST', '/api/ai/chat', {
      token: u.token,
      body: {
        messages: [
          { role: 'user', content: '第一问' },
          { role: 'assistant', content: '答' },
          { role: 'user', content: '第二问' }
        ]
      }
    })
    expect(r.status).toBe(200)
    const rows = rowsOf(u)
    expect(rows.length).toBe(1)
    expect(rows[0].question_text).toBe('第二问')
    expect(rows[0].msg_count).toBe(3)
  })

  it('B4 超长提问（600 字）⇒ 截断到 500，且留的是**前**500 字符', async () => {
    const u = newUser('b4')
    const long = '长'.repeat(600)
    await ask(u, long)
    const rows = rowsOf(u)
    expect(rows[0].question_len).toBe(AI_QUESTION_MAX_CHARS)
    expect(rows[0].question_text).toBe(long.slice(0, AI_QUESTION_MAX_CHARS))
    expect(rows[0].question_text.endsWith('长')).toBe(true)
  })

  it('B5 纯空白问法 ⇒ 不落库（但仍按既有逻辑正常问答）', async () => {
    const u = newUser('b5')
    const r = await ask(u, '   \n  ')
    expect(r.status).toBe(200)          // truncateMessages 保留非空字符串 ⇒ 不进 400
    expect(countOf(u)).toBe(0)
  })

  it('B6 messages 为空 ⇒ 400 且零落库（body 校验之后才落库）', async () => {
    const u = newUser('b6')
    const r = await call('POST', '/api/ai/chat', { token: u.token, body: { messages: [] } })
    expect(r.status).toBe(400)
    expect(countOf(u)).toBe(0)
  })
})

// ===========================================================================
describe('C. 相对位置：闸门 / 缓存', () => {
  it('C1 ⭐ 重复提问命中同问缓存 ⇒ **仍然新增一行留痕**（缓存之后才落库就漏了）', async () => {
    const u = newUser('c1')
    await ask(u, '怎么查看剩余次数')
    expect(countOf(u)).toBe(1)

    const before = upstreamCalls().length
    const r2 = await ask(u, '怎么查看剩余次数')
    expect(r2.body.cached).toBe(true)                  // 确实走了缓存
    expect(upstreamCalls().length).toBe(before)        // 未调上游
    expect(countOf(u)).toBe(2)                         // 但留痕必须 +1
  })

  it('C2 月额度耗尽 ⇒ 403 且**零落库**（闸门在最前）', async () => {
    const u = newUser('c2')
    for (let i = 0; i < 100; i++) {
      db.prepare(`INSERT INTO ai_usage (user_id, tokens_used, endpoint) VALUES (?, 1, 'chat')`).run(u.id)
    }
    const r = await ask(u, '额度用尽后还能记吗')
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('monthly_exhausted')
    expect(countOf(u)).toBe(0)
  })

  it('C3 分钟限速（上限 3）⇒ 第 4 次 429 且零落库，仅前 3 次留痕', async () => {
    const u = newUser('c3')
    const codes = []
    for (let i = 0; i < 4; i++) {
      const r = await ask(u, `问题 ${i}`)
      codes.push(r.status)
    }
    expect(codes).toEqual([200, 200, 200, 429])
    const rows = rowsOf(u)
    expect(rows.length).toBe(3)
    expect(rows.map(r => r.question_text)).toEqual(['问题 0', '问题 1', '问题 2'])
  })

  it('C4 ⭐ 空 body 连打仍零写入（161 的零成本验证手段不被本批破坏）', async () => {
    const u = newUser('c4')
    for (let i = 0; i < 3; i++) {
      const r = await call('POST', '/api/ai/chat', { token: u.token, body: {} })
      expect(r.status).toBe(400)
    }
    expect(countOf(u)).toBe(0)
  })
})

// ===========================================================================
describe('E. 范围：问答之外的端点不落库（本批刻意只收 /chat 的问法）', () => {
  it('E1 /site-advice 是表单参数不是问法 ⇒ 不写 ai_questions', async () => {
    const u = newUser('e1', 'vip')
    const r = await call('POST', '/api/ai/site-advice', {
      token: u.token,
      body: { brand: '老乡鸡', category: '快餐', city: '上海', dataSummary: '人口摘要', stream: false }
    })
    expect(r.status).toBe(200)
    expect(countOf(u)).toBe(0)
  })
})

// ===========================================================================
// ⚠️ 本组会 DROP 掉 ai_questions 表（证伪「失败隔离」），故必须**最后执行**。
describe('D. 失败隔离：留痕坏了不能拖垮 AI 问答', () => {
  it('D1（最后执行）删掉 ai_questions 表 ⇒ 提问仍 200、仍记账，只是不落痕', async () => {
    const u = newUser('d1')
    db.prepare('DROP TABLE ai_questions').run()

    const r = await ask(u, '表没了还能问吗')
    expect(r.status).toBe(200)
    expect(r.body.content).toBe('这是真实回答')
    // 记账不受影响（主流程零感知）
    const usage = db.prepare(`SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ?`).get(u.id).c
    expect(usage).toBe(1)
    const stillGone = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ai_questions'`).get()
    expect(stillGone).toBeUndefined()
  })
})
