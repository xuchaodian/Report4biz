/**
 * 评分模板播种守卫（v1.13.225）
 *
 * 被测行为（src/models/database.js::initDatabase 内的「插入默认餐饮模板」区块）：
 *   库中不存在「餐饮通用」模板时 ⇒ 播种 1 个模板 + 10 个评分项（满分合计 100）。
 *
 * 🔴 为什么需要这条守卫：
 *   v1.13.225 之前，这段播种在**全新库上静默失效** —— 两张表被 CREATE 出来但恒 0 行，
 *   全程无 warn / 无报错，直到调用 `/api/store-scores` 报「模板不存在」才暴露（批次 223 发现）。
 *   根因是 sql.js 1.14.1 的 `Statement.get()` 语义：
 *     ① 传入**散参**（字符串，而非数组）绑定不上 ⇒ 查询条件恒不成立；
 *     ② 即便绑对，该版本 `get()` 在**空结果时返回 `[]`**（**truthy**！），
 *        而「有结果」时返回的又是**值数组**而非对象 ⇒ `!templateExists` 恒为 false。
 *   修复：改用 `stmt.bind([...]) → stmt.step()`（`step()` 返回 boolean，不受 `[]` 陷阱影响）。
 *
 * ⭐ 本守卫钉的是**行为**（全新库真能播种出 1+10），而非扫源码文本：
 *   把实现改回 `db.prepare('… WHERE name = ?').get('餐饮通用')` ⇒ 播种不发生 ⇒ 本文件立刻变红。
 *   该「变异验证」已实测（批次 225 记录）。这是项目约定的防假绿灯手段。
 *
 * 隔离：通过 R4B_DB_PATH 指向 /tmp 全新临时库，绝不触碰 backend/database/webgis.db。
 * 注：database.js 模块**顶层**有 `await initDatabase()` ⇒ 动态 import 本身即触发一次播种。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const freshDb = path.join(os.tmpdir(), `r4b-seed-guard-${process.pid}-${Date.now()}.db`)
fs.rmSync(freshDb, { force: true })
fs.rmSync(freshDb + '.tmp', { force: true })
process.env.R4B_DB_PATH = freshDb // 🔴 必须在动态 import 之前设置（dbPath 于模块加载时求值）

let dbMod

beforeAll(async () => {
  vi.resetModules()
  dbMod = await import('../src/models/database.js') // 模块顶层 await initDatabase() ⇒ 播种在此发生
})

afterAll(() => {
  fs.rmSync(freshDb, { force: true })
  fs.rmSync(freshDb + '.tmp', { force: true }) // 原子写残留
})

describe('评分模板播种守卫（v1.13.225）', () => {
  it('全新库：播种恰好 1 个「餐饮通用」模板', () => {
    const rows = dbMod.getDb().prepare('SELECT id, name, category FROM scoring_templates').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('餐饮通用')
    expect(rows[0].category).toBe('餐饮')
  })

  it('全新库：10 个评分项、全部挂唯一模板下、满分合计 100、sort_order 连续', () => {
    const tplId = dbMod.getDb().prepare('SELECT id FROM scoring_templates').all()[0].id
    const items = dbMod
      .getDb()
      .prepare('SELECT template_id, max_score, sort_order FROM scoring_items ORDER BY sort_order')
      .all()
    expect(items).toHaveLength(10)
    expect(items.every((i) => i.template_id === tplId)).toBe(true)
    expect(items.reduce((s, i) => s + i.max_score, 0)).toBe(100)
    expect(items.map((i) => i.sort_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('维度与录入方式分布符合模板定义（4 商圈 + 6 点位；select 必带 JSON options）', () => {
    const dimMap = Object.fromEntries(
      dbMod.getDb().prepare('SELECT dimension, COUNT(*) AS c FROM scoring_items GROUP BY dimension').all()
        .map((d) => [d.dimension, d.c])
    )
    expect(dimMap).toEqual({ trade_area: 4, site: 6 })

    const typeMap = Object.fromEntries(
      dbMod.getDb().prepare('SELECT input_type, COUNT(*) AS c FROM scoring_items GROUP BY input_type').all()
        .map((t) => [t.input_type, t.c])
    )
    expect(typeMap).toEqual({ auto: 4, score: 2, number: 2, select: 2 })

    // select 项必须带可解析的 JSON options（前端下拉依赖）
    const selects = dbMod.getDb().prepare('SELECT name, options FROM scoring_items WHERE input_type = ?').all('select')
    expect(selects).toHaveLength(2)
    for (const s of selects) {
      const opts = JSON.parse(s.options)
      expect(Array.isArray(opts)).toBe(true)
      expect(opts.length).toBeGreaterThan(0)
    }

    // auto 项不携带 options（由上游数据源直接出分）
    const autos = dbMod.getDb().prepare('SELECT options FROM scoring_items WHERE input_type = ?').all('auto')
    expect(autos.every((a) => a.options === null || a.options === undefined)).toBe(true)
  })

  it('幂等：重复 initDatabase 不重复播种（模板仍 1 个、项仍 10 个）', async () => {
    await dbMod.initDatabase()
    expect(dbMod.getDb().prepare('SELECT COUNT(*) AS c FROM scoring_templates').all()[0].c).toBe(1)
    expect(dbMod.getDb().prepare('SELECT COUNT(*) AS c FROM scoring_items').all()[0].c).toBe(10)
  })
})
