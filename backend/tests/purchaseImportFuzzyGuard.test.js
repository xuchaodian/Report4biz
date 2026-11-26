/**
 * 守卫：联通 Excel 导入的「近似门店名 → 候选 → 用户确认」链路（v1.13.425）
 *
 * 为什么要有这个文件：这条链路的错**都不会报错**，只会静默写错数据 ——
 *   ① 候选自动被采用 ⇒ 人口数据挂到隔壁「二期店」上；
 *   ② confirmMap 不校验归属 ⇒ 请求体夹一个别人的门店 id 就能往人家店里写；
 *   ③ 去重/落库仍用文件名 ⇒ 同一家店传两种文件名变成两条履历。
 * 所以这里用**真库（sql.js 临时库）+ 真 xlsx** 直接跑 analyzeFile，而不是只做字符串断言。
 *
 * ⚠️ 库隔离：R4B_DB_PATH 指向 /tmp 临时库，绝不碰 backend/database/webgis.db。
 * ⚠️ 每个用例用自己的 user_id：候选池/判重都按 user_id 过滤，天然互不干扰。
 *    （例外：user_id IS NULL 的平台预置店对所有账号可见 —— 只在专用用例里插。）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const tmpDb = path.join(os.tmpdir(), `r4b-import-fuzzy-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-import-xlsx-'))

let getDb
let analyzeFile
let loadStorePool
let db
let seq = 0

/** 造一个符合格式的最小报表：封面 E21 = 门店名，商圈数据 C1=半径 / E1=月份 / 第3行起数据 */
function makeXlsx(opts = {}) {
  const { e21 = '星空广场', radius = '1km', month = '202606' } = opts
  const wb = XLSX.utils.book_new()
  const cover = XLSX.utils.aoa_to_sheet([['']])
  cover['E21'] = { t: 's', v: e21 }
  cover['!ref'] = 'A1:E21'
  XLSX.utils.book_append_sheet(wb, cover, '封面')
  const ds = XLSX.utils.aoa_to_sheet([
    ['服务码', '', '字段键', '', '数值'],
    [],
    ['1001', '', 'p1_sum', '', 12345]
  ])
  ds['C1'] = { t: 's', v: radius }
  ds['E1'] = { t: 's', v: month }
  ds['!ref'] = 'A1:E3'
  XLSX.utils.book_append_sheet(wb, ds, '商圈数据')
  const p = path.join(tmpDir, `f${++seq}.xlsx`)
  XLSX.writeFile(wb, p)
  return p
}

/** 插一家门店，返回 { id, uid } */
function addStore(uid, name, extra = {}) {
  const { latitude = 31.2, longitude = 121.5, store_type = '已开业', store_status = '正常', merged_into = null } = extra
  const r = db.prepare(
    `INSERT INTO markers (user_id, name, city, district, address, latitude, longitude, store_type, store_status, merged_into)
     VALUES (?, ?, '上海市', '闵行区', '测试路 1 号', ?, ?, ?, ?, ?)`
  ).run(uid, name, latitude, longitude, store_type, store_status, merged_into)
  return { id: r.lastInsertRowid, uid }
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const routeMod = await import('../src/routes/purchase-import.js')
  analyzeFile = routeMod.analyzeFile
  loadStorePool = routeMod.loadStorePool
  db = getDb()
})

afterAll(() => {
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

describe('A. 精确同名：行为必须与改造前一致', () => {
  it('同名命中 → ok:true、无候选、未确认', () => {
    const uid = 9101
    const { id } = addStore(uid, '星空广场')
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx')
    expect(r.ok).toBe(true)
    expect(r.marker.id).toBe(id)
    expect(r.duplicate).toBe(false)
    expect(r.confirmedByUser).toBe(false)
    expect(r.candidates).toBeUndefined()
    expect(r.needConfirm).toBeUndefined()
  })

  it('无同名但有近似名 → needConfirm + 候选，且**不给 reason**（不是失败）', () => {
    const uid = 9102
    addStore(uid, '星空广场店')
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx')
    expect(r.ok).toBe(false)
    expect(r.needConfirm).toBe(true)
    expect(r.reason).toBeUndefined()
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0].name).toBe('星空广场店')
    expect(r.candidates[0].score).toBe(100)
    expect(r.candidates[0].suggest).toBe(true)
    // 只是候选，⛔ 不许自带 marker —— 带了就等于已经认了这家店
    expect(r.marker).toBeNull()
  })

  it('真的没有近似店 → 保留原文案（前端「门店不匹配」标签靠这句话识别）', () => {
    const uid = 9103
    addStore(uid, '完全不相干的店')
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx')
    expect(r.ok).toBe(false)
    expect(r.needConfirm).toBeUndefined()
    expect(r.reason).toBe('系统无此门店（或门店不属于当前账号）')
    expect(r.candidates).toBeUndefined()
  })
})

describe('B. 用户确认后的落库口径', () => {
  it('确认近似门店 → ok:true，且 marker 就是用户选的那家', () => {
    const uid = 9104
    const { id } = addStore(uid, '星空广场店')
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx', id)
    expect(r.ok).toBe(true)
    expect(r.marker.id).toBe(id)
    expect(r.confirmedByUser).toBe(true)
    expect(r.duplicate).toBe(false)
  })

  it('🔴 确认他人门店 id → 拒绝，且不返回 marker（防请求体越权）', () => {
    const ownerUid = 9105
    const attackerUid = 9106
    const { id } = addStore(ownerUid, '星空广场店')
    const r = analyzeFile(db, attackerUid, makeXlsx(), '星空广场_1km_202606.xlsx', id)
    expect(r.ok).toBe(false)
    expect(r.marker).toBeNull()
    expect(r.reason).toContain('不属于当前账号')
  })

  it('确认已合并（软删）的门店 → 拒绝', () => {
    const uid = 9107
    const { id } = addStore(uid, '星空广场店')
    // 另一家被合并进 id（它是软删行，不能再被选中）
    const merged = addStore(uid, '星空广场旗舰店', { merged_into: id })
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx', merged.id)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('不属于当前账号')
  })

  it('确认不存在的 id / 非法 id → 拒绝，不抛错', () => {
    const uid = 9108
    for (const bad of [99999999, 0, -1, 'abc']) {
      const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx', bad)
      expect(r.ok, `id=${bad}`).toBe(false)
      expect(r.reason).toContain('不属于当前账号')
    }
  })
})

describe('C. 候选池口径（与 matchStore 同源）', () => {
  it('已关停的门店不进候选', () => {
    const uid = 9109
    addStore(uid, '星空广场店', { store_status: '闭店' })
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx')
    expect(r.candidates).toBeUndefined()
    expect(r.reason).toBe('系统无此门店（或门店不属于当前账号）')
  })

  it('待开业 / 筹备中仍应进候选（开店前做人口测算很常见）', () => {
    const uid = 9110
    addStore(uid, '星空广场店', { store_status: '筹备中' })
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx')
    expect(r.needConfirm).toBe(true)
    expect(r.candidates[0].name).toBe('星空广场店')
  })

  it('已合并（软删）的门店不进候选', () => {
    const uid = 9111
    const { id } = addStore(uid, '星空广场老店')
    addStore(uid, '星空广场店', { merged_into: id })
    const pool = loadStorePool(db, uid)
    expect(pool.map((p) => p.name)).not.toContain('星空广场店')
    expect(pool.map((p) => p.name)).toContain('星空广场老店')
  })

  it('别家的门店不进候选（数据隔离）', () => {
    const uid = 9112
    addStore(9113, '星空广场店')
    const pool = loadStorePool(db, uid)
    expect(pool.map((p) => p.name)).not.toContain('星空广场店')
  })

  it('平台预置店（user_id IS NULL）可以进候选，但候选里不带坐标与 user_id', () => {
    const uid = 9114
    db.prepare(
      `INSERT INTO markers (user_id, name, city, latitude, longitude) VALUES (NULL, '星空广场公共店', '上海市', 31.2, 121.5)`
    ).run()
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx')
    expect(r.needConfirm).toBe(true)
    expect(r.candidates.some((c) => c.name === '星空广场公共店')).toBe(true)
    for (const c of r.candidates) {
      expect(Object.keys(c).sort()).toEqual(['address', 'city', 'district', 'duplicate', 'id', 'name', 'score', 'suggest'])
    }
  })
})

describe('D. 去重与落库都用「确认后的门店名」', () => {
  it('同一门店换个文件名再来 → 判重复（⛔ 不能因解析名不同而写第二条）', () => {
    const uid = 9115
    const { id } = addStore(uid, '星空广场店')
    // 先按确认名写一条历史（模拟上一次导入的结果）
    db.prepare(
      `INSERT INTO purchases (user_id, store_name, store_type, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
       VALUES (?, '星空广场店', '已开业', 121.5, 31.2, ?, '202606', 0, 'active', '{}')`
    ).run(uid, JSON.stringify([1000]))
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx', id)
    expect(r.ok).toBe(true)
    expect(r.duplicate).toBe(true)
  })

  it('判重不吃解析名：文件名「星空广场店」+ 确认同一家 → 也判重复', () => {
    const uid = 9116
    const { id } = addStore(uid, '星空广场店')
    db.prepare(
      `INSERT INTO purchases (user_id, store_name, store_type, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
       VALUES (?, '星空广场店', '已开业', 121.5, 31.2, ?, '202606', 0, 'active', '{}')`
    ).run(uid, JSON.stringify([1000]))
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场店_1km_202606.xlsx', id)
    expect(r.duplicate).toBe(true)
  })
})

describe('D2. 预检阶段就要提示「确认后会判重复」', () => {
  it('🔴 预检就要标出「该候选同半径同月份已有记录」（否则预检说可导入、提交跳重复）', () => {
    const uid = 9117
    const { id } = addStore(uid, '星空广场店')
    db.prepare(
      `INSERT INTO purchases (user_id, store_name, store_type, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
       VALUES (?, '星空广场店', '已开业', 121.5, 31.2, ?, '202606', 0, 'active', '{}')`
    ).run(uid, JSON.stringify([1000]))
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx')
    expect(r.needConfirm).toBe(true)
    expect(r.candidates[0].id).toBe(id)
    expect(r.candidates[0].duplicate).toBe(true)
  })

  it('不同半径的候选不算重复（1.5km 没买过就是可以导）', () => {
    const uid = 9118
    addStore(uid, '星空广场店')
    db.prepare(
      `INSERT INTO purchases (user_id, store_name, store_type, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
       VALUES (?, '星空广场店', '已开业', 121.5, 31.2, ?, '202606', 0, 'active', '{}')`
    ).run(uid, JSON.stringify([1000]))
    const r = analyzeFile(db, uid, makeXlsx({ radius: '1.5km' }), '星空广场_1.5km_202606.xlsx')
    expect(r.candidates[0].duplicate).toBe(false)
  })
})

describe('E. 源码结构约束（防止有人把口径改回去）', () => {
  const SRC = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/routes/purchase-import.js'),
    'utf8'
  )

  it('commit 必须收 confirmMap，且类型校验后才用', () => {
    expect(SRC).toMatch(/const confirmMap = \(rawConfirm && typeof rawConfirm === 'object' && !Array\.isArray\(rawConfirm\)\) \? rawConfirm : \{\}/)
    expect(SRC).toMatch(/analyzeFile\(db, req\.user\.id, full, original, confirmedId, pool\)/)
  })

  it('🔴 needConfirm 行进 commit 时必须给明确原因（否则前端原因是空白）', () => {
    expect(SRC).toMatch(/analysis\.needConfirm\s*\n?\s*\?\s*'该文件名与门店不同名，请先在预检里选择对应门店后再导入'/)
  })

  it('🔴 needConfirm 失败时**不许删临时文件**（删了用户只能重新上传整个文件夹）', () => {
    const seg = SRC.slice(SRC.indexOf("reason: analysis.needConfirm"), SRC.indexOf('continue', SRC.indexOf("reason: analysis.needConfirm")))
    expect(seg).toContain('if (!analysis.needConfirm) removeTmpFiles([diskName])')
    // 反例：无条件删除 = 回退成「失败即丢文件」
    expect(seg).not.toMatch(/^\s*removeTmpFiles\(\[diskName\]\)\s*$/m)
  })

  it('落库 store_name 必须是 marker.name，⛔ 不许退回 analysis.storeName', () => {
    const seg = SRC.slice(SRC.indexOf('INSERT INTO purchases'), SRC.indexOf('storeNameOfFile[diskName]'))
    expect(seg).toContain('analysis.marker.name')
    expect(seg).not.toMatch(/req\.user\.id,\s*\n\s*analysis\.storeName,/)
  })

  it('matchStore 的精确等值 SQL 一个字都不许改（另一条守卫的白名单靠它命中）', () => {
    expect(SRC).toContain("'SELECT id, name, latitude, longitude, store_type, user_id FROM markers WHERE name = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1'")
  })

  it('门店搜索端点：必须登录 + LIKE 必须转义 + 必须 ESCAPE', () => {
    const seg = SRC.slice(SRC.indexOf("router.get('/stores'"))
    expect(seg).toContain('authenticate')
    expect(seg).toContain('escapeLike(')
    expect(seg).toMatch(/LIKE \? ESCAPE '\\\\'/)
    expect(seg).toContain('merged_into IS NULL')
  })

  it('候选池/搜索都排除已关停，且不与「在营」口径混用（在营还要求 store_type=已开业）', () => {
    expect(SRC).toContain('NOT_CLOSED_STATUS_SQL')
    expect(SRC).not.toContain('IN_BUSINESS_SQL')
    expect(SRC).not.toMatch(/store_type\s*=\s*'已开业'\s*AND\s*store_status/)
  })
})
