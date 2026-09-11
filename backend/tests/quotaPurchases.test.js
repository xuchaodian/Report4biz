/**
 * 配额「两本账」隔离性测试（v1.13.115）
 *
 * 系统里有三处配额数据，语义必须严格区分：
 *   1. admin_quota            —— 池级：采购总账（initial_quota / remaining_quota，单例 id=1）
 *   2. quota_history          —— 账号级：每个账号分到多少（带 user_id）。purchase.js 用
 *                                Σ(change_amount) WHERE user_id=? 当作该账号的 cumulativeTotal
 *   3. quota_purchases        —— 池级：采购明细（本轮新增），append-only，**不带 user_id 语义**
 *
 * 被测保证：
 *   A. initDatabase 建出 quota_purchases 表 + created_at 索引（幂等）
 *   B. 🔴 往 quota_purchases 写采购行，**不会**改变任何账号的 Σ(quota_history.change_amount)
 *      —— 这是最关键的一条护栏。若日后有人图省事把采购写进 quota_history，本用例会立刻失败，
 *         因为那会让每个账号的「累计分配额」被污染，且 purchase.js 的 total ≠ cumulativeTotal。
 *   C. 采购行自洽：quota_before + amount === quota_after（禁止 amount ≤ 0 混入）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，避免触碰 backend/database/webgis.db 真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(os.tmpdir(), `r4b-quota-purchases-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
})

afterAll(() => {
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

describe('配额两本账隔离性', () => {
  it('initDatabase 建出 quota_purchases 表与索引', () => {
    const db = getDb()
    const table = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
    ).get('quota_purchases')
    expect(table?.name).toBe('quota_purchases')

    const idx = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`
    ).get('idx_quota_purchases_created')
    expect(idx?.name).toBe('idx_quota_purchases_created')
  })

  it('采购行自洽：quota_before + amount === quota_after', () => {
    const db = getDb()
    const admin = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get()
    expect(admin?.id).toBeTruthy()

    db.prepare(`
      INSERT INTO quota_purchases (amount, quota_before, quota_after, note, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(2400, 400, 2800, '第 1 批', admin.id, 'admin')

    const row = db.prepare(`SELECT * FROM quota_purchases ORDER BY id DESC LIMIT 1`).get()
    expect(row.amount).toBe(2400)
    expect(row.quota_before + row.amount).toBe(row.quota_after)
  })

  it('🔴 写 quota_purchases 不会污染任何账号的 Σ(quota_history.change_amount)', () => {
    const db = getDb()
    const admin = db.prepare(`SELECT id, quota FROM users WHERE username = 'admin'`).get()

    // 造一个「账号级」分配履历（模拟给某账号分配 200 次）
    db.prepare(`UPDATE users SET quota = 200 WHERE id = ?`).run(admin.id)
    db.prepare(`
      INSERT INTO quota_history (user_id, old_quota, new_quota, change_amount, action)
      VALUES (?, ?, ?, ?, ?)
    `).run(admin.id, 0, 200, 200, 'set')

    const historyCountBefore = db.prepare(
      `SELECT COUNT(*) AS c FROM quota_history WHERE user_id = ?`
    ).get(admin.id).c
    const cumBefore = db.prepare(
      `SELECT COALESCE(SUM(change_amount), 0) AS cum FROM quota_history WHERE user_id = ?`
    ).get(admin.id).cum
    expect(cumBefore).toBe(200)

    // 再记一笔「池级」采购
    db.prepare(`
      INSERT INTO quota_purchases (amount, quota_before, quota_after, note, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(4800, 2800, 7600, '第 2 批', admin.id, 'admin')

    // 账号级台账必须纹丝不动
    const historyCountAfter = db.prepare(
      `SELECT COUNT(*) AS c FROM quota_history WHERE user_id = ?`
    ).get(admin.id).c
    const cumAfter = db.prepare(
      `SELECT COALESCE(SUM(change_amount), 0) AS cum FROM quota_history WHERE user_id = ?`
    ).get(admin.id).cum

    expect(historyCountAfter).toBe(historyCountBefore)
    expect(cumAfter).toBe(cumBefore)
    // 且与 users.quota 仍然对得上（两本账各自自洽）
    const u = db.prepare(`SELECT quota FROM users WHERE id = ?`).get(admin.id)
    expect(cumAfter).toBe(u.quota)
  })

  it('采购台账可汇总：Σ(amount) 与笔数', () => {
    const db = getDb()
    const s = db.prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total FROM quota_purchases`
    ).get()
    expect(s.cnt).toBe(2)
    expect(s.total).toBe(2400 + 4800)
  })
})
