/**
 * database.js wrapper 事务写盘计数测试（S4 测试基建 + S2/A3 per-request 验证）
 *
 * 被测行为（src/models/database.js）：
 *  1. prepare().run() 默认逐次整库 export 落盘（saveDatabase）
 *  2. beginTx 后 run() 抑制落盘，commitTx/rollbackTx 统一落盘 1 次
 *  3. rollbackTx 后事务内插入不生效
 *  4. 事务标志 per-request（AsyncLocalStorage）：并发请求各自 beginTx 不互相抑制/毒化
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，避免触碰/污染 backend/database/webgis.db 真实库。
 * 通过 spy fs.writeFileSync 统计落盘次数（saveDatabase 内部唯一写库文件的路径）。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(os.tmpdir(), `r4b-db-test-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let dbMod
let writeSpy

// 统计「落库文件」的写盘次数（排除测试自身无关的临时文件写入，保险起见按路径后缀匹配 .db）
const dbWrites = () => writeSpy.mock.calls.filter(([p]) => String(p).endsWith('.db')).length

beforeAll(async () => {
  vi.resetModules()
  writeSpy = vi.spyOn(fs, 'writeFileSync')
  dbMod = await import('../src/models/database.js')
  // 清掉模块加载时 initDatabase 末尾 saveDatabase 产生的计数
  writeSpy.mockClear()
  // 建独立计数表（避免与业务 schema 数据互相干扰）
  dbMod.getDb().exec('CREATE TABLE IF NOT EXISTS tx_test (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)')
  dbMod.getDb().exec('DELETE FROM tx_test')
})

afterAll(() => {
  vi.restoreAllMocks()
  try { fs.unlinkSync(tmpDb) } catch (e) { /* 忽略 */ }
})

describe('database.js 事务写盘计数（H3/S1-A 行为基准）', () => {
  it('单条 run 触发 1 次整库落盘', () => {
    writeSpy.mockClear()
    const db = dbMod.getDb()
    db.prepare('INSERT INTO tx_test (v) VALUES (?)').run('single')
    expect(dbWrites()).toBe(1)
  })

  it('beginTx + N 条 run + commitTx：落盘恰 1 次（N 条全部入库）', () => {
    writeSpy.mockClear()
    const db = dbMod.getDb()
    db.beginTx()
    for (let i = 0; i < 20; i++) db.prepare('INSERT INTO tx_test (v) VALUES (?)').run(`tx-${i}`)
    db.commitTx()
    expect(dbWrites()).toBe(1)
    const rows = db.prepare('SELECT COUNT(*) AS cnt FROM tx_test WHERE v LIKE ?').all('tx-%')
    expect(rows[0].cnt).toBe(20)
  })

  it('rollbackTx 后事务内插入不生效，落盘仍 1 次', () => {
    writeSpy.mockClear()
    const db = dbMod.getDb()
    db.beginTx()
    db.prepare('INSERT INTO tx_test (v) VALUES (?)').run('will-rollback')
    db.rollbackTx()
    expect(dbWrites()).toBe(1)
    const rows = db.prepare('SELECT COUNT(*) AS cnt FROM tx_test WHERE v = ?').all('will-rollback')
    expect(rows[0].cnt).toBe(0)
  })

  it('异常逃逸后的 rollbackIfPending 兜底：事务回滚且标志复位', () => {
    const scope = dbMod.createTxScope()
    const db = dbMod.getDb()
    scope.run(() => {
      db.beginTx()
      db.prepare('INSERT INTO tx_test (v) VALUES (?)').run('pending-leak')
      // 模拟 handler 异常逃逸：不调用 commit/rollback，直接抛
      expect(() => { throw new Error('boom') }).toThrow()
      // 请求结束兜底回滚
      scope.rollbackIfPending()
    })
    const rows = db.prepare('SELECT COUNT(*) AS cnt FROM tx_test WHERE v = ?').all('pending-leak')
    expect(rows[0].cnt).toBe(0)
    // 兜底后标志已复位：后续单条 run 恢复逐次落盘
    writeSpy.mockClear()
    db.prepare('INSERT INTO tx_test (v) VALUES (?)').run('after-cleanup')
    expect(dbWrites()).toBe(1)
  })
})

describe('S2/A3：事务标志 per-request（AsyncLocalStorage）隔离', () => {
  it('async handler 事务区跨 await 后 flag 保持：await 期间 run 仍被抑制，commit 落盘 1 次', async () => {
    // 模拟「未来事务区内出现 await」的场景：ALS store 随 async 链传递，flag 不丢失
    writeSpy.mockClear()
    const scope = dbMod.createTxScope()
    const db = dbMod.getDb()
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    await scope.run(async () => {
      db.beginTx()
      db.prepare('INSERT INTO tx_test (v) VALUES (?)').run('async-a1')
      await sleep(20) // 事务挂起
      db.prepare('INSERT INTO tx_test (v) VALUES (?)').run('async-a2')
      // await 前后 run 都应被抑制（模块级单例同样成立；此为回归保护）
      expect(dbWrites()).toBe(0)
      db.commitTx()
    })
    expect(dbWrites()).toBe(1)
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM tx_test WHERE v IN (?, ?)').all('async-a1', 'async-a2')
    expect(cnt[0].c).toBe(2)
  })

  it('请求 A 事务异常逃逸（rollbackIfPending 兜底）不毒化后续请求 B 的落盘', () => {
    const db = dbMod.getDb()
    // ---- 请求 A：beginTx 后异常逃逸（handler 抛错，事务未提交）----
    const scopeA = dbMod.createTxScope()
    scopeA.run(() => {
      db.beginTx()
      db.prepare('INSERT INTO tx_test (v) VALUES (?)').run('leak-a')
      // 无 commit/rollback，直接离开（模拟 async handler 抛错被框架捕获）
    })
    scopeA.rollbackIfPending() // res close 兜底
    expect(db.prepare('SELECT COUNT(*) AS c FROM tx_test WHERE v = ?').all('leak-a')[0].c).toBe(0)

    // ---- 请求 B：事务残留不得抑制其正常写盘（per-request 隔离判据）----
    writeSpy.mockClear()
    const scopeB = dbMod.createTxScope()
    scopeB.run(() => {
      db.prepare('INSERT INTO tx_test (v) VALUES (?)').run('b-after')
    })
    expect(dbWrites()).toBe(1)
    // 若为模块级单例：A 逃逸后 inTransaction 卡 true → B 的 run 被抑制 → 此断言失败
  })
})
