/**
 * 立项报告分享链接测试（v1.13.392）
 *
 * 被测：src/routes/reportShares.js 的 5 个端点 + mailer.sendReportShareMail 的调用约束
 * 方式：临时库 + 真起 express（端口 0）→ fetch 打真实 HTTP（与 orgs.test.js 同套路，
 *       不引入 supertest）。
 *
 * 覆盖的保证（对应 routes/reportShares.js 文件头的五条铁律）：
 *   A. 生成：未登录 401 / 快照缺失 400 / 快照过大 413 / 地图不是 data:image 400 /
 *      点位不是自己的 404 / 正常 200 且 token 为 48 位随机 hex
 *   B. 覆盖：同一点位再次分享 ⇒ **同一条记录、同一个 token**，replaced=true
 *      （业主选的「快照为主，可切最新」——更新靠覆盖同一链接，⛔ 不是每次多一条）
 *   C. 公开读：免登录可读、内容 = 快照逐字段一致、**不含 user_id / candidate_id**
 *   D. 撤销：他人撤不掉（404）／本人撤后公开读 410 revoked／重复撤销幂等
 *   E. 过期：过期后公开读 410 expired，列表里 state=expired
 *   F. 邮件：未配置 SMTP ⇒ 503（不假装成功）；收件人 >10 或格式非法 ⇒ 400
 *   G. 浏览计数节流：5 分钟内连续读只 +1（本库整库落盘，不能每访问一次就写盘）
 *   H. 列表接口不返回 snapshot_json / map_img（⛔ 别把 dataURL 拉进列表）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-share-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb, server, base, jwtSign
const tokens = {}
const ids = {}
const shares = {}

/** 一份"像报告"的最小快照：只要后端原样存、原样还，就说明快照链路是通的 */
function makeSnapshot(title, extra = {}) {
  return {
    projectName: title,
    brand: '食其家',
    stage: '待评估',
    generatedAt: '2026-11-20T07:43:00.000Z',
    district: { name: '南京西路', score: 78, stars: 4, crowd: '白领', level: 'A', competitorCount: 3, myStoreCount: 1, contained: true, distanceM: 320 },
    population: {
      hasPop: true,
      popRadius: 1000,
      popMonth: '202510',
      population: 48231,
      work: 32116,
      visit: 1284905,
      popTotal: 61882,
      gender: { live: { male: 23392, female: 24839, total: 48231, malePct: 48.5, femalePct: 51.5 } },
      ages: { live: [{ label: '25-29', pct: 14.2 }] },
      arpu: { live: [{ label: '100-150', pct: 22.1 }] },
      summary: ['职住结构：工作人口为居住人口的 0.67 倍']
    },
    coordinate: { lat: 31.2304, lng: 121.4737, radius: 1000 },
    facts: [{ label: '拟入驻品牌', value: '食其家' }],
    risks: ['租金未填'],
    provenance: { source: '联通智慧足迹', period: '202510', sample: '半径 1km', confidence: '中' },
    completeness: '较完整',
    ...extra
  }
}

async function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, body: json }
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const router = (await import('../src/routes/reportShares.js')).default

  const db = getDb()
  const seed = (username, role) => {
    const r = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
      .run(username, `${username}@test.local`, 'x', role, 0)
    return r.lastInsertRowid
  }
  ids.owner = seed('share_owner', 'user')
  ids.other = seed('share_other', 'user')
  for (const k of ['owner', 'other']) {
    tokens[k] = jwtSign({ id: ids[k], username: `${k}`, role: 'user' })
  }

  // 两个候选点位：owner 一个、other 一个（用于「不能分享别人的点位」）
  const mkCand = (uid, name, lat, lng) => db.prepare(
    `INSERT INTO store_candidates (user_id, name, latitude, longitude, radius, city) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uid, name, lat, lng, 1000, '上海').lastInsertRowid
  ids.candOwner = mkCand(ids.owner, '南京西路店', 31.2304, 121.4737)
  ids.candOther = mkCand(ids.other, '别人家的店', 31.24, 121.48)

  const express = (await import('express')).default
  const app = express()
  app.use(express.json({ limit: '50mb' }))
  app.use('/api/report-shares', router)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ---------------------------------------------------------------------------

describe('A 生成分享链接', () => {
  it('未登录 → 401', async () => {
    const r = await call('POST', '/api/report-shares', { body: { snapshot: makeSnapshot('x') } })
    expect(r.status).toBe(401)
  })

  it('快照缺失 / 不是对象 → 400', async () => {
    expect((await call('POST', '/api/report-shares', { token: tokens.owner, body: {} })).status).toBe(400)
    expect((await call('POST', '/api/report-shares', { token: tokens.owner, body: { snapshot: 'str' } })).status).toBe(400)
    expect((await call('POST', '/api/report-shares', { token: tokens.owner, body: { snapshot: [1, 2] } })).status).toBe(400)
  })

  it('快照超过 512KB → 413', async () => {
    const huge = makeSnapshot('超大', { padding: 'x'.repeat(600 * 1024) })
    const r = await call('POST', '/api/report-shares', { token: tokens.owner, body: { snapshot: huge } })
    expect(r.status).toBe(413)
  })

  it('地图不是 data:image ⇒ 400；超过 2MB ⇒ 413', async () => {
    const r1 = await call('POST', '/api/report-shares', {
      token: tokens.owner,
      body: { snapshot: makeSnapshot('x'), mapImg: 'https://evil.example/a.jpg' }
    })
    expect(r1.status).toBe(400)

    const big = 'data:image/jpeg;base64,' + 'A'.repeat(2.2 * 1024 * 1024)
    const r2 = await call('POST', '/api/report-shares', {
      token: tokens.owner,
      body: { snapshot: makeSnapshot('x'), mapImg: big }
    })
    expect(r2.status).toBe(413)
  })

  it('分享别人的候选点位 → 404（不能把自己的名字挂在别人点位上）', async () => {
    const r = await call('POST', '/api/report-shares', {
      token: tokens.owner,
      body: { candidateId: ids.candOther, snapshot: makeSnapshot('x') }
    })
    expect(r.status).toBe(404)
  })

  it('正常生成：token 为 48 位 hex、url 指向 /s/<token>、有效期 30 天', async () => {
    const r = await call('POST', '/api/report-shares', {
      token: tokens.owner,
      body: {
        candidateId: ids.candOwner,
        title: '南京西路店',
        snapshot: makeSnapshot('南京西路店'),
        mapImg: 'data:image/jpeg;base64,AAAA',
        aiText: '建议关注午市客流。'
      }
    })
    expect(r.status).toBe(200)
    expect(r.body.replaced).toBe(false)
    const s = r.body.share
    expect(s.token).toMatch(/^[a-f0-9]{48}$/)
    expect(s.url).toContain(`/s/${s.token}`)
    expect(s.state).toBe('ok')
    shares.main = s
    ids.shareMain = s.id

    // 30 天后到期（换算成"约 30 天"，避免秒级抖动）
    const days = (new Date(s.expiresAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 86400000
    expect(days).toBeGreaterThan(29.5)
    expect(days).toBeLessThan(30.5)
  })
})

describe('B 同点位再次分享 ⇒ 覆盖同一条链接', () => {
  it('id 与 token 不变、replaced=true、内容已换', async () => {
    const r = await call('POST', '/api/report-shares', {
      token: tokens.owner,
      body: {
        candidateId: ids.candOwner,
        title: '南京西路店（更新）',
        snapshot: makeSnapshot('南京西路店（更新）', { completeness: '完整' })
      }
    })
    expect(r.status).toBe(200)
    expect(r.body.replaced).toBe(true)
    expect(r.body.share.id).toBe(ids.shareMain)
    expect(r.body.share.token).toBe(shares.main.token)

    // 公开读到的已经是新内容
    const pub = await call('GET', `/api/report-shares/public/${shares.main.token}`)
    expect(pub.status).toBe(200)
    expect(pub.body.snapshot.projectName).toBe('南京西路店（更新）')
    expect(pub.body.snapshot.completeness).toBe('完整')
    // 覆盖后地图被清空（这次没传）——⛔ 别把上次的地图残留在新报告里
    expect(pub.body.mapImg).toBe('')
  })

  it('不同点位 ⇒ 各自独立一条链接', async () => {
    const r = await call('POST', '/api/report-shares', {
      token: tokens.owner,
      body: { title: '无点位报告', snapshot: makeSnapshot('无点位报告') }
    })
    expect(r.status).toBe(200)
    expect(r.body.share.id).not.toBe(ids.shareMain)
    ids.shareNoCand = r.body.share.id
  })
})

describe('C 公开读取（免登录）', () => {
  it('免登录可读，且内容与快照逐字段一致', async () => {
    const r = await call('GET', `/api/report-shares/public/${shares.main.token}`)
    expect(r.status).toBe(200)
    expect(r.body.snapshot.population.population).toBe(48231)
    expect(r.body.snapshot.population.gender.live.malePct).toBe(48.5)
    expect(r.body.share.authorName).toBe('share_owner')
    expect(r.body.share.title).toBe('南京西路店（更新）')
  })

  it('返回体不含 user_id / candidate_id（拿到链接的人不该知道是谁、哪个点位 id）', async () => {
    const r = await call('GET', `/api/report-shares/public/${shares.main.token}`)
    const raw = JSON.stringify(r.body)
    expect(raw).not.toContain('"userId"')
    expect(raw).not.toContain('"user_id"')
    expect(raw).not.toContain('"candidateId"')
    expect(raw).not.toContain('"candidate_id"')
  })

  it('token 不存在 / 形状不对 → 404（不泄露"这个 id 存在但你没权"）', async () => {
    expect((await call('GET', '/api/report-shares/public/' + 'a'.repeat(48))).status).toBe(404)
    expect((await call('GET', '/api/report-shares/public/abc')).status).toBe(404)
    expect((await call('GET', '/api/report-shares/public/' + "'; DROP TABLE users; --")).status).toBe(404)
  })
})

describe('D 撤销', () => {
  it('别人撤不掉 → 404', async () => {
    const r = await call('DELETE', `/api/report-shares/${ids.shareMain}`, { token: tokens.other })
    expect(r.status).toBe(404)
    // 仍然可读
    expect((await call('GET', `/api/report-shares/public/${shares.main.token}`)).status).toBe(200)
  })

  it('本人撤销后公开读 410 revoked', async () => {
    const r = await call('DELETE', `/api/report-shares/${ids.shareMain}`, { token: tokens.owner })
    expect(r.status).toBe(200)
    const pub = await call('GET', `/api/report-shares/public/${shares.main.token}`)
    expect(pub.status).toBe(410)
    expect(pub.body.code).toBe('revoked')
  })

  it('重复撤销幂等（再撤一次仍 200）', async () => {
    const r = await call('DELETE', `/api/report-shares/${ids.shareMain}`, { token: tokens.owner })
    expect(r.status).toBe(200)
  })

  it('撤销后再分享同一点位 ⇒ 生成新 token（旧链接永久失效，不复用）', async () => {
    const r = await call('POST', '/api/report-shares', {
      token: tokens.owner,
      body: { candidateId: ids.candOwner, title: '重新分享', snapshot: makeSnapshot('重新分享') }
    })
    expect(r.status).toBe(200)
    expect(r.body.share.token).not.toBe(shares.main.token)
    expect((await call('GET', `/api/report-shares/public/${shares.main.token}`)).status).toBe(410)
    shares.second = r.body.share
    ids.shareSecond = r.body.share.id
  })
})

describe('E 过期', () => {
  it('过期后公开读 410 expired，列表里 state=expired', async () => {
    const db = getDb()
    db.prepare(`UPDATE report_shares SET expires_at = datetime('now', '-1 day') WHERE id = ?`).run(ids.shareSecond)

    const pub = await call('GET', `/api/report-shares/public/${shares.second.token}`)
    expect(pub.status).toBe(410)
    expect(pub.body.code).toBe('expired')

    const list = await call('GET', `/api/report-shares?candidateId=${ids.candOwner}`, { token: tokens.owner })
    expect(list.status).toBe(200)
    const row = list.body.shares.find(s => s.id === ids.shareSecond)
    expect(row.state).toBe('expired')
  })
})

describe('F 邮件发送', () => {
  it('未登录 → 401', async () => {
    const r = await call('POST', `/api/report-shares/${ids.shareNoCand}/email`, { body: { to: 'a@b.com' } })
    expect(r.status).toBe(401)
  })

  it('别人的分享 → 404', async () => {
    const r = await call('POST', `/api/report-shares/${ids.shareNoCand}/email`, {
      token: tokens.other, body: { to: 'a@b.com' }
    })
    expect(r.status).toBe(404)
  })

  it('收件人为空 → 400；超过 10 位 → 400；格式非法 → 400', async () => {
    expect((await call('POST', `/api/report-shares/${ids.shareNoCand}/email`, {
      token: tokens.owner, body: { to: [] }
    })).status).toBe(400)

    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(',')
    expect((await call('POST', `/api/report-shares/${ids.shareNoCand}/email`, {
      token: tokens.owner, body: { to: eleven }
    })).status).toBe(400)

    expect((await call('POST', `/api/report-shares/${ids.shareNoCand}/email`, {
      token: tokens.owner, body: { to: 'not-an-email' }
    })).status).toBe(400)
  })

  it('SMTP 未配置 ⇒ 503（⛔ 不假装已发送）', async () => {
    const cfg = await import('../src/config.js')
    if (cfg.MAIL_ENABLED) return   // 本机配了 SMTP 时跳过，避免真发信
    const r = await call('POST', `/api/report-shares/${ids.shareNoCand}/email`, {
      token: tokens.owner, body: { to: 'a@b.com' }
    })
    expect(r.status).toBe(503)
  })
})

describe('G 浏览计数节流', () => {
  it('5 分钟内连续读只 +1（每次读都写盘＝拿磁盘换一个数字）', async () => {
    const list1 = await call('GET', '/api/report-shares', { token: tokens.owner })
    const row1 = list1.body.shares.find(s => s.id === ids.shareNoCand)
    const before = row1.viewCount

    await call('GET', `/api/report-shares/public/${row1.token}`)
    await call('GET', `/api/report-shares/public/${row1.token}`)
    await call('GET', `/api/report-shares/public/${row1.token}`)

    const list2 = await call('GET', '/api/report-shares', { token: tokens.owner })
    const row2 = list2.body.shares.find(s => s.id === ids.shareNoCand)
    // 首次读之前 last_viewed_at 为空 ⇒ 第一次 +1，后两次被节流
    expect(row2.viewCount).toBe(before + 1)
  })
})

describe('H 列表接口不返回大字段', () => {
  it('shares 里没有 snapshot_json / map_img / ai_text', async () => {
    const r = await call('GET', '/api/report-shares', { token: tokens.owner })
    expect(r.status).toBe(200)
    const raw = JSON.stringify(r.body)
    expect(raw).not.toContain('snapshot_json')
    expect(raw).not.toContain('data:image')
    expect(raw).not.toContain('ai_text')
  })

  it('列表只到 20 条，且默认过滤掉已撤销', async () => {
    const r = await call('GET', '/api/report-shares', { token: tokens.owner })
    expect(r.body.shares.length).toBeLessThanOrEqual(20)
    expect(r.body.shares.every(s => s.state !== 'revoked')).toBe(true)
  })
})
