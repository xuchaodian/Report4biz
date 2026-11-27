/**
 * 守卫：联通 Excel 导入「同一门店名的多个文件一次套用」（v1.13.426）
 *
 * 起因：425 要求「近似名必须用户亲手选门店」，但一次导出同一家店常有 3~12 个文件
 * （不同半径/月份），20 个文件就要重复点 20 次同样的选择 —— 纯体力活，且手滑选错
 * 一行的概率随次数线性上升。本批加「同组一次套用」。
 *
 * 这条链路有四个**不报错但会写错数据**的点，逐条钉住：
 *   ① 分组用相似度而不是精确同名 ⇒「星空广场」和「星空广场二期」被套成一家（写错店）；
 *   ② 套用顺手替用户勾选 ⇒ 用户以为只是「选了家店」，结果一提交就把没看过的文件导了；
 *   ③ 套用覆盖用户已选的**别的**门店 ⇒ 用户自己的决定被静默改掉；
 *   ④ 套用后沿用基准行的「是否已存在」结论 ⇒ 同门店不同半径/月份的文件被误判/漏判重复。
 *
 * 两类用例：
 *   【运行时】真 import 分组纯函数 + 真库真 xlsx 跑 analyzeFile（判重口径必须逐文件算）；
 *   【源码】钉住接口与组件里的行为判据（退回旧写法会红）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const tmpDb = path.join(os.tmpdir(), `r4b-import-batch-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-import-batch-xlsx-'))

const { groupPendingRows, siblingsOf, pendingSiblingsOf, conflictSiblingCount } =
  await import('../../frontend/src/utils/importNameGroup.js')

let getDb
let analyzeFile
let db
let seq = 0

/** 造一个符合格式的最小报表 */
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
  const p = path.join(tmpDir, `b${++seq}.xlsx`)
  XLSX.writeFile(wb, p)
  return p
}

function addStore(uid, name, extra = {}) {
  const { latitude = 31.2, longitude = 121.5 } = extra
  const r = db.prepare(
    `INSERT INTO markers (user_id, name, city, district, address, latitude, longitude)
     VALUES (?, ?, '上海市', '闵行区', '测试路 1 号', ?, ?)`
  ).run(uid, name, latitude, longitude)
  return { id: r.lastInsertRowid, uid }
}

/** 造一条已存在的购买记录（模拟上一次导入） */
function addPurchase(uid, storeName, radiusM, cityMonth, lng = 121.5, lat = 31.2) {
  db.prepare(
    `INSERT INTO purchases (user_id, store_name, store_type, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
     VALUES (?, ?, '已开业', ?, ?, ?, ?, 0, 'active', '{}')`
  ).run(uid, storeName, lng, lat, JSON.stringify([radiusM]), cityMonth)
}

/** 预览行工厂：只写分组/套用真正读到的字段 */
function row(fileName, storeName, extra = {}) {
  return { fileName, fileKey: fileName, storeName, needConfirm: true, confirmedStoreId: null, ...extra }
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const routeMod = await import('../src/routes/purchase-import.js')
  analyzeFile = routeMod.analyzeFile
  db = getDb()
})

afterAll(() => {
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

describe('A. 分组判据：只认「门店名完全相同」', () => {
  it('A1 同名的多个文件归成一组', () => {
    const rows = [
      row('星空广场_1km_202606.xlsx', '星空广场'),
      row('星空广场_2km_202606.xlsx', '星空广场'),
      row('星空广场_3km_202606.xlsx', '星空广场')
    ]
    const g = groupPendingRows(rows)
    expect(g).toHaveLength(1)
    expect(g[0].storeName).toBe('星空广场')
    expect(g[0].rows).toHaveLength(3)
  })

  it('A2 🔴「星空广场」与「星空广场二期」绝不并组（二期是另一家店）', () => {
    const rows = [
      row('a.xlsx', '星空广场'),
      row('b.xlsx', '星空广场二期'),
      row('c.xlsx', '星空广场 二期') // 只差一个空格：⛔ 也不许归一化后并组
    ]
    expect(groupPendingRows(rows)).toHaveLength(0)
  })

  it('A3 单文件不成组（避免界面上出现只含一行的「组」）', () => {
    expect(groupPendingRows([row('a.xlsx', '星空广场')])).toHaveLength(0)
  })

  it('A4 精确命中（ok）的行不参与分组 —— 它本来就已经定好门店', () => {
    const rows = [
      row('a.xlsx', '星空广场', { needConfirm: false, ok: true }),
      row('b.xlsx', '星空广场', { needConfirm: false, ok: true })
    ]
    expect(groupPendingRows(rows)).toHaveLength(0)
  })

  it('A5 空店名不参与（解析失败的行没有 storeName）', () => {
    const rows = [row('a.xlsx', ''), row('b.xlsx', '')]
    expect(groupPendingRows(rows)).toHaveLength(0)
  })

  it('A6 多组并存时按组内文件数降序（最省事的先给）', () => {
    const rows = [
      row('a1.xlsx', 'A 店'), row('a2.xlsx', 'A 店'),
      row('b1.xlsx', 'B 店'), row('b2.xlsx', 'B 店'), row('b3.xlsx', 'B 店')
    ]
    const g = groupPendingRows(rows)
    expect(g.map((x) => x.storeName)).toEqual(['B 店', 'A 店'])
    expect(g.map((x) => x.rows.length)).toEqual([3, 2])
  })
})

describe('B. 套用目标：不许覆盖用户自己的选择', () => {
  const rows = [
    row('a.xlsx', '星空广场'),
    row('b.xlsx', '星空广场'),
    row('c.xlsx', '星空广场'),
    row('d.xlsx', '别家店')
  ]

  it('B1 同组其它行不含自己，也不跨组', () => {
    const sib = siblingsOf(rows, rows[0])
    expect(sib.map((r) => r.fileName)).toEqual(['b.xlsx', 'c.xlsx'])
  })

  it('B2 已选好门店的行不进套用目标', () => {
    const withPick = [
      row('a.xlsx', '星空广场'),
      row('b.xlsx', '星空广场', { confirmedStoreId: 11 }),
      row('c.xlsx', '星空广场')
    ]
    expect(pendingSiblingsOf(withPick, withPick[0]).map((r) => r.fileName)).toEqual(['c.xlsx'])
  })

  it('B3 🔴 用户已选「别的门店」的行也不在目标里（批量动作不许静默改掉）', () => {
    const mixed = [
      row('a.xlsx', '星空广场', { confirmedStoreId: 11 }),
      row('b.xlsx', '星空广场', { confirmedStoreId: 99 }), // 另一个决定
      row('c.xlsx', '星空广场')
    ]
    expect(pendingSiblingsOf(mixed, mixed[0]).map((r) => r.fileName)).toEqual(['c.xlsx'])
    expect(conflictSiblingCount(mixed, mixed[0])).toBe(1)
  })

  it('B4 全部已选同门店 ⇒ 没有可套用目标（按钮不出现）', () => {
    const all = [
      row('a.xlsx', '星空广场', { confirmedStoreId: 11 }),
      row('b.xlsx', '星空广场', { confirmedStoreId: 11 })
    ]
    expect(pendingSiblingsOf(all, all[0])).toHaveLength(0)
    expect(conflictSiblingCount(all, all[0])).toBe(0)
  })

  it('B5 精确命中行不会被当成套用目标', () => {
    const mixed = [
      row('a.xlsx', '星空广场', { confirmedStoreId: 11 }),
      row('b.xlsx', '星空广场', { needConfirm: false, ok: true })
    ]
    expect(pendingSiblingsOf(mixed, mixed[0])).toHaveLength(0)
  })
})

describe('C. 判重必须逐文件算（套用不能沿用基准行的结论）', () => {
  it('C1 🔴 同一门店套到「不同半径」的文件上 ⇒ 只有已存在的那档算重复', () => {
    const uid = 9201
    const { id } = addStore(uid, '星空广场店')
    addPurchase(uid, '星空广场店', 1000, '202606') // 1km 那档已经买过

    const r1 = analyzeFile(db, uid, makeXlsx({ radius: '1km' }), '星空广场_1km_202606.xlsx', id)
    const r3 = analyzeFile(db, uid, makeXlsx({ radius: '3km' }), '星空广场_3km_202606.xlsx', id)
    expect(r1.ok).toBe(true)
    expect(r1.duplicate).toBe(true)
    expect(r3.ok).toBe(true)
    expect(r3.duplicate).toBe(false) // 若沿用基准行结论，这里会误报重复
  })

  it('C2 同门店 + 同半径 + 不同月份 ⇒ 不算重复（月份是判重维度）', () => {
    const uid = 9202
    const { id } = addStore(uid, '星空广场店')
    addPurchase(uid, '星空广场店', 1000, '202606')
    const r = analyzeFile(db, uid, makeXlsx({ radius: '1km', month: '202607' }), '星空广场_1km_202607.xlsx', id)
    expect(r.ok).toBe(true)
    expect(r.duplicate).toBe(false)
  })

  it('C3 🔴 套用只能落在本账号门店上：拿别人的门店 id 一律拒绝', () => {
    const owner = 9203
    const attacker = 9204
    const { id } = addStore(owner, '星空广场店')
    const r = analyzeFile(db, attacker, makeXlsx(), '星空广场_1km_202606.xlsx', id)
    expect(r.ok).toBe(false)
    expect(r.marker).toBeNull()
    expect(r.reason).toContain('不属于当前账号')
  })

  it('C4 落库名是确认后的门店名（套用后同一家店不会写成两个名字）', () => {
    const uid = 9205
    const { id } = addStore(uid, '星空广场店')
    const r = analyzeFile(db, uid, makeXlsx(), '星空广场_1km_202606.xlsx', id)
    expect(r.marker.name).toBe('星空广场店')
    expect(r.storeName).toBe('星空广场') // 解析名仍在，只用于展示/审计
    expect(r.confirmedByUser).toBe(true)
  })
})

describe('D. 源码守卫：接口只读 + 组件三条行为判据', () => {
  const BACK = read('backend/src/routes/purchase-import.js')
  const COMP = read('frontend/src/components/PurchaseImportDialog.vue')
  const util = read('frontend/src/utils/importNameGroup.js')

  /** 剥注释（守卫断言「不许出现」前必须做，注释里的反面教材会把自己判红） */
  const stripComments = (s) =>
    String(s)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  const BACK_CODE = stripComments(BACK)
  const COMP_CODE = stripComments(COMP)

  const slice = (src, startMark, endMark) => {
    const a = src.indexOf(startMark)
    expect(a, `找不到标记：${startMark}`).toBeGreaterThan(-1)
    const b = endMark ? src.indexOf(endMark, a) : -1
    return b > a ? src.slice(a, b) : src.slice(a, a + 4000)
  }

  it('D1 `/check-mapping` 必须登录，且必须复用 analyzeFile（不许另写一套判重）', () => {
    const s = slice(BACK_CODE, "router.post('/check-mapping'")
    expect(s).toContain('authenticate')
    expect(s).toContain('analyzeFile(db, req.user.id, full, original,')
    // 另写判重 SQL ＝ 口径分叉（预核说能导、提交说重复）
    expect(s).not.toContain('FROM purchases')
  })

  it('D2 `/check-mapping` 必须只读：不写库、不删临时文件', () => {
    const s = slice(BACK_CODE, "router.post('/check-mapping'")
    expect(s).not.toMatch(/INSERT\s+INTO/i)
    expect(s).not.toMatch(/UPDATE\s+\w+\s+SET/i)
    expect(s).not.toMatch(/DELETE\s+FROM/i)
    expect(s).not.toContain('removeTmpFiles')
  })

  it('D3 前端套用必须走 check-mapping（⛔ 沿用基准行的 duplicate）', () => {
    const s = slice(COMP_CODE, 'async function applyToGroup')
    expect(s).toContain("api.post('/purchase/import/check-mapping'")
    expect(s).toContain('applyTargets(row)')
  })

  it('D4 🔴 套用不许顺手替用户勾选复选框（勾选＝要不要导入，必须用户亲手）', () => {
    const s = slice(COMP_CODE, 'async function applyToGroup', 'function checkAllConfirmed')
    expect(s).not.toMatch(/toggleRowSelection\([^)]*,\s*true\s*\)/)
    expect(s).toContain('勾选这些行后再点')
  })

  it('D5 套用前必须二次确认（一次点击不给静默批量改）', () => {
    const s = slice(COMP_CODE, 'async function applyToGroup', 'function checkAllConfirmed')
    expect(s).toContain('ElMessageBox.confirm')
  })

  it('D6 分组必须来自 importNameGroup（组件里不许自己写相似度）', () => {
    expect(COMP_CODE).toContain("from '@/utils/importNameGroup'")
    expect(COMP_CODE).toContain('groupPendingRows(previewRows.value)')
    expect(COMP_CODE).toContain('pendingSiblingsOf(previewRows.value, row)')
    // 组件里出现"相似度/归一化"就是又把判据办到别处去了
    expect(COMP_CODE).not.toMatch(/levenshtein|similarity|normalizeStoreName/)
  })

  it('D7 分组判据写死在「精确同名」上：util 里不许出现归一化/相似度', () => {
    const code = stripComments(util)
    expect(code).toContain('String((row && row.storeName) || \'\').trim()')
    expect(code).not.toMatch(/levenshtein|similarity|normalize/i)
  })

  it('D8 搜索出来的门店（无 duplicate 标记）选定后必须问后端预核', () => {
    expect(COMP_CODE).toContain('dupKnown')
    const s = slice(COMP_CODE, 'function onPickStore')
    expect(s).toContain('verifyMapping(row, opt)')
  })
})
