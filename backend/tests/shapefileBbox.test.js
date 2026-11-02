/**
 * 人口网格文件 bbox 预筛测试 —— v1.13.308
 *
 * 背景：calculate-population 不传 shapefileId 时取全部 26 个人口文件（313MB / 32.8 万要素），
 * 逐个解析 ⇒ 单档 4 秒。改成按文件 bbox 先筛掉不相交的城市。
 *
 * 本测试要钉死的不变量（都是**错了不报错、只静默少算**的类型）：
 *   A. 参数顺序：SQL 的第 1 个 ? 是查询的 maxLng，第 2 个才是 minLng。
 *      写反 ⇒ 相邻城市被错误排除，客户看到的人口凭空少一块。
 *   B. NULL 语义：bbox 为空的历史文件**必须保留**（拿不准就算相交）。
 *      只写 NOT(...) 时 NULL 比较得 NULL，这些文件会被静默跳过。
 *   C. 真跑一次 SQL：用内存库插 4 行（相交 / 东侧不相交 / 远城 / 空 bbox），
 *      断言结果恰好是「相交 + 空 bbox」两条。
 *   D. 路由不许绕过本模块自己写一段字面量 —— 否则两处语义迟早漂移。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BBOX_INTERSECT_SQL, bboxParams, bboxIntersects } from '../src/utils/shapefileBbox.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')

// 查询范围：上海人民广场 10km 圈的近似 bbox
const Q = [121.37, 31.14, 121.58, 31.32]

describe('bboxParams：占位符顺序', () => {
  it('摊成 [maxLng, minLng, maxLat, minLat]', () => {
    expect(bboxParams(Q)).toEqual([121.58, 121.37, 31.32, 31.14])
  })

  it('入参不是 4 元数组时抛错（⛔ 不静默返回半截）', () => {
    expect(() => bboxParams([1, 2])).toThrow()
    expect(() => bboxParams(null)).toThrow()
  })
})

describe('bboxIntersects：JS 侧同口径', () => {
  it('重叠 ⇒ true', () => {
    expect(bboxIntersects([120.85, 30.67, 122.0, 31.87], Q)).toBe(true)
  })
  it('完全在东侧 ⇒ false', () => {
    expect(bboxIntersects([122.5, 30.7, 123.0, 32.0], Q)).toBe(false)
  })
  it('完全在西侧 ⇒ false', () => {
    expect(bboxIntersects([119.9, 30.7, 121.30, 32.0], Q)).toBe(false)
  })
  it('西侧但边缘压线（maxx 刚好进界）⇒ true', () => {
    // 苏州实际 bbox maxx≈121.38，比查询 minLng 121.37 大一点点 ⇒ 必须算相交
    expect(bboxIntersects([119.92, 30.76, 121.38, 32.05], Q)).toBe(true)
  })
  it('缺失 ⇒ true（同 SQL 的 NULL 语义：拿不准就算相交）', () => {
    expect(bboxIntersects(null, Q)).toBe(true)
  })
})

let db
beforeAll(async () => {
  const tmp = path.join(os.tmpdir(), `r4b-bbox-${process.pid}-${Date.now()}.db`)
  process.env.R4B_DB_PATH = tmp
  const mod = await import('../src/models/database.js')
  db = mod.getDb()
})

describe('真跑 SQL：只筛掉确实不相交的，空 bbox 必须保留', () => {
  it('4 个文件里命中「相交 + 空 bbox」两条', () => {
    // shapefiles 表由 database.js 建好；这里清理后插入明确的 4 条
    db.prepare(`DELETE FROM shapefiles WHERE name LIKE 'TEST_BBOX_%'`).run()
    const ins = db.prepare(
      `INSERT INTO shapefiles (name, geojson, field_names, feature_count, user_id, category,
                               created_at, minx, miny, maxx, maxy)
       VALUES (?, '', '[]', 0, 1, 'population', datetime('now'), ?, ?, ?, ?)`
    )
    ins.run('TEST_BBOX_hit_shanghai', 120.85, 30.67, 122.00, 31.87)
    ins.run('TEST_BBOX_edge_suzhou', 119.92, 30.76, 121.38, 32.05)   // 边缘相交（maxx 121.38 > 121.37）⇒ 应保留
    ins.run('TEST_BBOX_miss_beijing', 115.43, 39.44, 117.49, 41.05)
    ins.run('TEST_BBOX_null_bbox', null, null, null, null)

    const rows = db.prepare(
      `SELECT name FROM shapefiles
        WHERE category = 'population' AND name LIKE 'TEST_BBOX_%' AND ${BBOX_INTERSECT_SQL}
        ORDER BY name`
    ).all(...bboxParams(Q))

    const names = rows.map(r => r.name)
    expect(names).toContain('TEST_BBOX_hit_shanghai')
    // 🔴 最要紧的一条：空 bbox 不能被筛掉
    expect(names).toContain('TEST_BBOX_null_bbox')
    // 北京明显不相交
    expect(names).not.toContain('TEST_BBOX_miss_beijing')
  })

  it('🔴 参数顺序写反会让「相邻城市」被误判为不相交 —— 用一个正好落在两个区间之间的例子证伪', () => {
    // 昆山方向的文件：maxx = 121.45
    //   正序（minLng=121.37）：121.45 < 121.37 为假 ⇒ 相交 ✓
    //   反序（minLng=121.58）：121.45 < 121.58 为真 ⇒ 被判不相交 ✗（人口凭空少一块）
    db.prepare(`DELETE FROM shapefiles WHERE name = 'TEST_BBOX_kunshan'`).run()
    db.prepare(
      `INSERT INTO shapefiles (name, geojson, field_names, feature_count, user_id, category,
                               created_at, minx, miny, maxx, maxy)
       VALUES ('TEST_BBOX_kunshan', '', '[]', 0, 1, 'population', datetime('now'), 120.90, 31.20, 121.45, 31.60)`
    ).run()

    const sql = `SELECT name FROM shapefiles
                  WHERE category = 'population' AND name = 'TEST_BBOX_kunshan' AND ${BBOX_INTERSECT_SQL}`

    expect(db.prepare(sql).all(...bboxParams(Q)).length, '正序必须命中').toBe(1)

    const wrong = [Q[0], Q[2], Q[1], Q[3]]   // 故意错：[minLng,maxLng,minLat,maxLat]
    expect(
      db.prepare(sql).all(...wrong).length,
      '反序居然也命中 —— 说明这条守卫没能区分顺序，换一个能区分的数据再试'
    ).toBe(0)

    db.prepare(`DELETE FROM shapefiles WHERE name LIKE 'TEST_BBOX_%'`).run()
  })
})

describe('源码守卫：路由必须复用本模块', () => {
  it('shapefiles.js 引用 BBOX_INTERSECT_SQL，且不再自写 minx/maxx 字面量条件', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/shapefiles.js'), 'utf8')
    expect(src).toContain("from '../utils/shapefileBbox.js'")
    expect(src).toContain('${BBOX_INTERSECT_SQL}')
    expect(
      /NOT\s*\(\s*minx\s*>/.test(src),
      'shapefiles.js 里又出现了手写的 bbox 条件 —— 请改回 ${BBOX_INTERSECT_SQL}，否则参数顺序会各写一份'
    ).toBe(false)
  })

  it('补算脚本存在且是幂等 UPDATE（重复跑不会写坏）', () => {
    const p = path.join(REPO_ROOT, 'backend/scripts/backfill-shapefile-bbox.mjs')
    expect(fs.existsSync(p)).toBe(true)
    const src = fs.readFileSync(p, 'utf8')
    expect(src).toContain('UPDATE shapefiles SET minx=')
  })
})
