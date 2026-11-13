/**
 * 批次 360（v1.13.360）守卫：`Cache-Control: private, no-cache` 中间件
 *
 * 这份测试**不扫源码字符串**，而是起一个真的 express + 真的 HTTP 端口，
 * 用 fetch 走一遍真实响应 —— 因为本批的收益点（304 省掉 2.7MB）恰恰是
 * 「正则写着对、实际不生效」最容易骗过人的地方。
 *
 * 覆盖：
 *  ① JSON GET 拿到 `private, no-cache` 且带 ETag
 *  ② 带 If-None-Match 复验 ⇒ 304 且 body 为空（这才是真正省流量的那一步）
 *  ③ 路由自设的 Cache-Control（登录 no-store / 瓦片 max-age）不被覆盖
 *  ④ 非 JSON（图片、SSE text/event-stream）一个头都不加
 *  ⑤ 非 GET/HEAD（POST 写接口）不碰
 *  ⑥ 非 2xx（401）不碰
 *  ⑦ shouldApplyCacheControl 的分支单测（含 304 无 Content-Type、headersSent）
 *  ⑧ res.end 只包一层并即时还原（防同一响应被处理两次）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { httpCacheHeaders, shouldApplyCacheControl } from '../src/middleware/httpCache.js'

/**
 * 用 node:http 发请求，而不是 fetch —— 这里的坑必须记住：
 * 🔴 `fetch`（Node 内置 undici）按 Fetch 规范的 **forbidden header** 规则
 *    **静默丢弃** `If-None-Match` 请求头（连同 If-Modified-Since 等），
 *    服务端因此收不到条件请求 ⇒ 永远返回 200。
 *    本测试第一版就是这么写错的：报「304 不生效」，实际是客户端把头发扔了。
 *    ⭐ 凡是要验条件请求 / 304，一律用 node:http，别用 fetch。
 */
function rawGet(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}${path}`, { headers }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', c => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
  })
}

let server
let base

beforeAll(async () => {
  const app = express()
  app.use(httpCacheHeaders)

  app.get('/api/plain', (req, res) => res.json({ ok: true, rows: [1, 2, 3] }))
  app.get('/api/problem', (req, res) => {
    res.setHeader('Content-Type', 'application/problem+json')
    res.end(JSON.stringify({ title: 'nope' }))
  })
  // 登录响应：带 token，绝不进缓存
  app.get('/api/no-store', (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json({ token: 'abc' })
  })
  // 地图瓦片：本来就该长缓存
  app.get('/api/tile', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('Content-Type', 'image/png')
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })
  // AI 流式输出
  app.get('/api/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.write('data: hi\n\n')
    res.end()
  })
  app.post('/api/write', (req, res) => res.json({ ok: true }))
  app.get('/api/unauthorized', (req, res) => res.status(401).json({ error: '未登录' }))

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

/**
 * 剥注释（源码守卫专用）
 * 🔴 不能只用裸 `/\*[\s\S]*?\*\//`：字符串里出现 `/*` 会吞掉大段代码并报假红。
 */
function stripComments(src) {
  return src
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('① ② JSON GET 补头并支持 304 复验', () => {
  it('① 200 响应带 private, no-cache 与 ETag', async () => {
    const r = await fetch(`${base}/api/plain`)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-cache')
    expect(r.headers.get('etag')).toBeTruthy()
  })

  it('① `+json` 后缀也认（application/problem+json）', async () => {
    const r = await fetch(`${base}/api/problem`)
    expect(r.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('② 带 If-None-Match 再请求 ⇒ 304 且无 body（这才是省流量的那一步）', async () => {
    const first = await rawGet('/api/plain')
    const etag = first.headers.etag

    const second = await rawGet('/api/plain', { 'If-None-Match': etag })
    expect(second.status).toBe(304)
    expect(second.body).toBe('')
    // 304 也要带缓存指令：告诉浏览器「旧的还能用，继续按同样规则复验」
    expect(second.headers['cache-control']).toBe('private, no-cache')
    // 对照组：不带 If-None-Match 时必须完整返回，证明 304 不是无条件发生的
    const third = await rawGet('/api/plain')
    expect(third.status).toBe(200)
    expect(third.body).toBe(first.body)
  })
})

describe('③ 路由自设的 Cache-Control 一律不被覆盖', () => {
  it('③ 登录响应仍是 no-store（带 token，⛔ 进缓存即安全事故）', async () => {
    const r = await fetch(`${base}/api/no-store`)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })

  it('③ 瓦片仍是 public, max-age=86400', async () => {
    const r = await fetch(`${base}/api/tile`)
    expect(r.headers.get('cache-control')).toBe('public, max-age=86400')
  })
})

describe('④ ⑤ ⑥ 不该碰的响应一个头都不加', () => {
  it('④ SSE（text/event-stream）不加缓存指令', async () => {
    const r = await fetch(`${base}/api/sse`)
    expect(r.headers.get('content-type')).toContain('text/event-stream')
    expect(r.headers.get('cache-control')).toBeNull()
  })

  it('⑤ POST 写接口不加缓存指令', async () => {
    const r = await fetch(`${base}/api/write`, { method: 'POST' })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBeNull()
  })

  it('⑥ 401 错误响应不加缓存指令（否则「登录过期」会被存下来复验）', async () => {
    const r = await fetch(`${base}/api/unauthorized`)
    expect(r.status).toBe(401)
    expect(r.headers.get('cache-control')).toBeNull()
  })
})

describe('⑦ shouldApplyCacheControl 分支单测', () => {
  /** 造一个最小 res 替身 */
  const fakeRes = (over = {}) => ({
    headersSent: false,
    statusCode: 200,
    _h: {},
    getHeader(k) {
      return this._h[k.toLowerCase()]
    },
    setHeader(k, v) {
      this._h[k.toLowerCase()] = v
    },
    ...over
  })

  it('普通 JSON 200 ⇒ true', () => {
    const res = fakeRes()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    expect(shouldApplyCacheControl(res)).toBe(true)
  })

  it('已有 Cache-Control ⇒ false（不覆盖路由决定）', () => {
    const res = fakeRes()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    expect(shouldApplyCacheControl(res)).toBe(false)
  })

  it('304 且 Content-Type 已被 Express 摘掉 ⇒ 仍 true', () => {
    const res = fakeRes({ statusCode: 304 })
    expect(shouldApplyCacheControl(res)).toBe(true)
  })

  it('headersSent ⇒ false', () => {
    const res = fakeRes({ headersSent: true })
    res.setHeader('Content-Type', 'application/json')
    expect(shouldApplyCacheControl(res)).toBe(false)
  })

  it('无 Content-Type 的 200（如 res.end() 裸返回）⇒ false', () => {
    expect(shouldApplyCacheControl(fakeRes())).toBe(false)
  })

  it('text/html ⇒ false', () => {
    const res = fakeRes()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    expect(shouldApplyCacheControl(res)).toBe(false)
  })

  it('201 / 302 ⇒ false', () => {
    for (const statusCode of [201, 302, 404, 500]) {
      const res = fakeRes({ statusCode })
      res.setHeader('Content-Type', 'application/json')
      expect(shouldApplyCacheControl(res)).toBe(false)
    }
  })
})

describe('⑨ 必须真的挂在 app 上（否则本文件全绿也没用）', () => {
  // ⚠️ 上面所有用例都是**自己新建一个 express** 来挂中间件的，
  //   所以「写了中间件但从没在 app.js 注册」这种情况它们**一个都抓不到** ——
  //   这正是 359 那批「只加 prop 不传值」的同类假绿。故单独用源码守卫兜住。
  //
  // 🔴 必须剥注释后再断言：本仓历史上多次出现「`// app.use(xxx)` 注释掉的代码
  //   照样命中 `/app\.use\(xxx\)/`」的假绿（变异 M6 就是这么逃掉的）。
  const appSrc = stripComments(readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'))

  it('⑨ app.js 已 import 并 app.use(httpCacheHeaders)', () => {
    expect(appSrc).toMatch(/import\s*\{\s*httpCacheHeaders\s*\}\s*from\s*'\.\/middleware\/httpCache\.js'/)
    expect(appSrc).toMatch(/app\.use\(httpCacheHeaders\)/)
  })

  it('⑨ 注册位置在所有 /api 路由之前（晚注册 ⇒ 一个接口都覆盖不到）', () => {
    const useIdx = appSrc.indexOf('app.use(httpCacheHeaders)')
    const firstApiIdx = appSrc.indexOf("app.use('/api/auth'")
    expect(useIdx).toBeGreaterThan(-1)
    expect(firstApiIdx).toBeGreaterThan(-1)
    expect(useIdx).toBeLessThan(firstApiIdx)
  })

  it('⑨ ⛔ 不得关掉 Express 内置 ETag（关掉后 304 整条链失效）', () => {
    expect(appSrc).not.toMatch(/app\.set\(\s*['"]etag['"]\s*,\s*false\s*\)/)
  })
})

describe('⑧ res.end 只包一层且即时还原', () => {
  it('调用一次后 res.end 恢复原函数（防同一响应被处理两次）', () => {
    const origEnd = function originalEnd() {}
    const res = {
      end: origEnd,
      headersSent: false,
      statusCode: 200,
      _h: {},
      getHeader(k) {
        return this._h[k]
      },
      setHeader(k, v) {
        this._h[k] = v
      }
    }
    httpCacheHeaders({ method: 'GET' }, res, () => {})

    expect(res.end).not.toBe(origEnd) // 已包
    res.end()
    expect(res.end).toBe(origEnd) // 用完即还原
  })

  it('POST 请求不被包装', () => {
    const origEnd = function originalEnd() {}
    const res = { end: origEnd }
    httpCacheHeaders({ method: 'POST' }, res, () => {})
    expect(res.end).toBe(origEnd)
  })
})
