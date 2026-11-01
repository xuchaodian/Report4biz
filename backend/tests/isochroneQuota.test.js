/**
 * 可达范围配额与范围凭证测试 —— v1.13.307
 *
 * 业主 2026-11-01 拍板：可达范围按「免费给图、付费给数」开放，同时必须控住高德 QPS。
 * 拍死的参数：免费/试用 **5 次/日**、VIP **30 次/日**、admin 不限。
 *
 * 本测试要钉死的不变量：
 *   A. 档位判定：admin / vip / trial / user；**trial 必须按免费档**（不是 VIP）
 *      —— `isVipActive` 把 trial 视为 VIP 权益生效，顺序写反就悄悄放大 6 倍。
 *   B. 每日次数：用满即拒；跨天自动重置；**管理员不记账**。
 *   C. 范围凭证：免费档只能查「探测返回过的那几个多边形」，
 *      换用户、改一个坐标、过期都必须拒绝（否则 5 次/日形同虚设）。
 *   D. 全局串行：任务严格先进先出（QPS 兜底）。
 *
 * 走 R4B_DB_PATH 指向 /tmp 临时库；**不打任何外网请求**。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(os.tmpdir(), `r4b-isoquota-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb
let Q

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  Q = await import('../src/utils/isochroneQuota.js')
  getDb() // 触发建表（含 isochrone_usage）
})

afterAll(() => {
  try { fs.unlinkSync(tmpDb) } catch { /* 忽略 */ }
})

function makeUser(role, extra = {}) {
  const db = getDb()
  const name = `u_${role}_${Math.random().toString(36).slice(2, 8)}`
  const r = db.prepare(
    'INSERT INTO users (username, email, password, role, vip_until) VALUES (?, ?, ?, ?, ?)'
  ).run(name, `${name}@t.local`, 'x', role, extra.vip_until ?? null)
  return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)
}

describe('A. 档位与上限（trial 必须按免费档）', () => {
  it('admin 不限', () => {
    const u = makeUser('admin')
    expect(Q.tierOf(u)).toBe('admin')
    expect(Q.limitFor(u)).toBe(Infinity)
  })

  it('vip 30 次', () => {
    const u = makeUser('vip')
    expect(Q.tierOf(u)).toBe('vip')
    expect(Q.limitFor(u)).toBe(30)
  })

  it('🔴 trial 按免费档 5 次 —— ⛔ 不是 30（isVipActive 会把 trial 当成 VIP）', () => {
    const u = makeUser('trial')
    expect(Q.tierOf(u)).toBe('free')
    expect(Q.limitFor(u)).toBe(5)
    // 反向确认：isVipActive 对 trial 为 true，说明这里的分支顺序是刻意的
    expect(Q.limitFor(u)).not.toBe(30)
  })

  it('普通 user 5 次', () => {
    const u = makeUser('user')
    expect(Q.limitFor(u)).toBe(5)
  })

  it('vip 过期按普通用户', () => {
    const u = makeUser('vip', { vip_until: '2020-01-01' })
    expect(Q.tierOf(u)).toBe('free')
    expect(Q.limitFor(u)).toBe(5)
  })
})

describe('B. 每日次数', () => {
  beforeEach(() => Q.resetIsochroneState())

  it('用满即拒，且被拒时不记账', () => {
    const u = makeUser('user')
    const day = new Date(2026, 10, 1, 10, 0, 0)
    for (let i = 1; i <= 5; i++) {
      const r = Q.consume(u, day)
      expect(r.used).toBe(i)
      expect(r.remaining).toBe(5 - i)
    }
    expect(Q.consume(u, day)).toBeNull()
    expect(Q.usedToday(u.id, day)).toBe(5)
  })

  it('跨天自动重置', () => {
    const u = makeUser('user')
    const d1 = new Date(2026, 10, 1, 23, 59, 0)
    const d2 = new Date(2026, 10, 2, 0, 1, 0)
    Q.consume(u, d1)
    Q.consume(u, d1)
    expect(Q.usedToday(u.id, d1)).toBe(2)
    expect(Q.usedToday(u.id, d2)).toBe(0)
    expect(Q.remainingFor(u, d2).remaining).toBe(5)
  })

  it('管理员不记账（today 恒 0）', () => {
    const u = makeUser('admin')
    const day = new Date(2026, 10, 1, 9, 0, 0)
    const r = Q.consume(u, day)
    expect(r.limit).toBe(Infinity)
    expect(Q.usedToday(u.id, day)).toBe(0)
  })

  it('dayKey 是本地的 YYYY-MM-DD', () => {
    expect(Q.dayKey(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05')
    expect(Q.dayKey(new Date(2026, 11, 31, 23, 59, 0))).toBe('2026-12-31')
  })
})

describe('C. 范围凭证', () => {
  beforeEach(() => Q.resetScopes())

  const poly = (dx = 0) => ({
    type: 'Polygon',
    coordinates: [[
      [121.40 + dx, 31.20], [121.41 + dx, 31.20], [121.41 + dx, 31.21], [121.40 + dx, 31.21], [121.40 + dx, 31.20]
    ]]
  })

  it('签发的多边形可通过校验', () => {
    const u = makeUser('user')
    const id = Q.issueScope(u.id, [{ minutes: 10, polygon: poly() }])
    expect(Q.verifyScope(u.id, id, poly())).toBe(true)
  })

  it('🔴 改一个坐标就不认（⛔ 不做模糊匹配）', () => {
    const u = makeUser('user')
    const id = Q.issueScope(u.id, [{ minutes: 10, polygon: poly() }])
    expect(Q.verifyScope(u.id, id, poly(0.0001))).toBe(false)
  })

  it('换用户用同一张凭证 ⇒ 拒', () => {
    const a = makeUser('user')
    const b = makeUser('user')
    const id = Q.issueScope(a.id, [{ minutes: 10, polygon: poly() }])
    expect(Q.verifyScope(b.id, id, poly())).toBe(false)
  })

  it('过期 ⇒ 拒', () => {
    const u = makeUser('user')
    const t0 = Date.now()
    const id = Q.issueScope(u.id, [{ minutes: 10, polygon: poly() }], t0)
    expect(Q.verifyScope(u.id, id, poly(), t0 + 31 * 60 * 1000)).toBe(false)
  })

  it('空凭证/未签发 ⇒ 拒', () => {
    const u = makeUser('user')
    expect(Q.verifyScope(u.id, '', poly())).toBe(false)
    expect(Q.verifyScope(u.id, 'nope', poly())).toBe(false)
  })
})

describe('D. 全局串行（QPS 兜底）', () => {
  it('任务严格按提交顺序完成', async () => {
    Q.resetIsochroneState()
    const order = []
    const mk = (i, delay) => Q.runSerial(async () => {
      await new Promise(r => setTimeout(r, delay))
      order.push(i)
    })
    // 第 1 个慢、第 2/3 个快 —— 若没串行，顺序会是 2,3,1
    await Promise.all([mk(1, 30), mk(2, 1), mk(3, 1)])
    expect(order).toEqual([1, 2, 3])
  })

  it('前一个任务抛错不影响后续排队', async () => {
    Q.resetIsochroneState()
    const done = []
    const fail = Q.runSerial(async () => { throw new Error('boom') }).catch(() => done.push('fail'))
    const next = Q.runSerial(async () => { done.push('next') })
    await Promise.all([fail, next])
    expect(done).toContain('next')
  })
})
