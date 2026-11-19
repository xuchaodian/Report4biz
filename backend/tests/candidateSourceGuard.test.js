/**
 * 候选点位 P0 源码守卫（批次 376）
 *
 * ── 守什么 ──────────────────────────────────────────────────────────────
 * 376 把候选点位页的数据源换成「我的门店」的候选门店（`markers.store_type`），
 * `store_candidates` 降级为「阶段 + 流水」的叠加层。这个改动带来六个**容易被后人改回去**的约束，
 * 它们要么在功能上不可见地坏掉（读接口偷偷写库），要么在特定操作下才炸（删了会复活）。
 * 功能测试（candidateSourceP0.test.js）证明行为对；本文件防止**行为被改回去而测试没跟上**。
 *
 * ── 为什么单开一个文件 ──────────────────────────────────────────────────
 * 功能测试要起临时库 + express（约 1.3s），源码扫描是纯字符串、毫秒级。
 * 混在一起会让"改一个断言"也要等数据库初始化。
 *
 * 🔴 守卫自身规范（211/231 教训）：正则扫源码**必须剥注释**，且必须配负变异证明"改坏会红"。
 *    注释里写着 `fetchPointPopulation` / `INSERT INTO` 之类的字面量会骗出假绿。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** 剥 JS 块/行注释 + Vue HTML 注释；[^:] 保护 https:// 这类字面量 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const ROUTE_RAW = read('backend/src/routes/candidates.js')
const ROUTE = strip(ROUTE_RAW)
const VIEW_RAW = read('frontend/src/views/CandidateView.vue')
const VIEW = strip(VIEW_RAW)
const DB = strip(read('backend/src/models/database.js'))
const LINK = strip(read('backend/src/utils/candidateLink.js'))

/** 取 [start, end) 之间的源码；找不到起点返回 ''（让断言直接红，而不是静默通过） */
function slice(src, startMark, endMark) {
  const i = src.indexOf(startMark)
  if (i < 0) return ''
  if (!endMark) return src.slice(i)
  const j = src.indexOf(endMark, i + startMark.length)
  return src.slice(i, j < 0 ? src.length : j)
}

/** 取某个顶层函数体（到行首 } 为止） */
function fnBody(src, name) {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) return ''
  const j = src.indexOf('\n}', i)
  return src.slice(i, j < 0 ? src.length : j + 2)
}

const LIST = slice(ROUTE, "router.get('/', authenticate", "router.post('/ensure'")
const ENSURE = slice(ROUTE, "router.post('/ensure'", '/** 详情 + 流水')
const DETAIL = slice(ROUTE, "router.get('/:id'", "router.post('/', authenticate")
const DELETE = slice(ROUTE, "router.delete('/:id'", 'export default router')

describe('G1. GET / 必须纯读（⛔ 读接口偷偷建行）', () => {
  it('列表路由里没有任何写语句', () => {
    expect(LIST.length, '找不到 GET / 路由').toBeGreaterThan(200)
    expect(LIST, 'GET / 里出现了 INSERT —— 读接口带写副作用，缓存/预取/爬虫都会变成写操作')
      .not.toMatch(/INSERT\s+INTO/i)
    expect(LIST, 'GET / 里出现了 UPDATE').not.toMatch(/\bUPDATE\s+\w+\s+SET/i)
    expect(LIST, 'GET / 里出现了 DELETE').not.toMatch(/\bDELETE\s+FROM/i)
  })

  it('惰性建行只发生在 POST /ensure', () => {
    expect(ENSURE).toContain('INSERT INTO store_candidates')
    // 除 ensure 外，路由里其余 INSERT 必须是 333 就有的「新建点位」与「写流水」
    const inserts = [...ROUTE.matchAll(/INSERT\s+INTO\s+(\w+)/gi)].map((m) => m[1])
    expect(inserts.filter((t) => t === 'store_candidates').length, 'store_candidates 的 INSERT 只该有 2 处（新建点位 + ensure）').toBe(2)
  })
})

describe('G2. POST /ensure 的边界', () => {
  it('必须挂 authenticate，且只对候选门店建行', () => {
    expect(ENSURE).toContain('authenticate')
    expect(ENSURE, '没校验 store_type ⇒ 已开业的门店也能被建成"候选点位"').toContain('CANDIDATE_STORE_TYPES.includes')
    expect(ENSURE, '没校验归属 ⇒ 能拿别人的 markerId 建行').toMatch(/WHERE id = \? AND user_id = \?/)
  })

  it('回填 store_code 时不碰 updated_at（补关联键不是"推进了一步"）', () => {
    const upd = slice(ENSURE, 'UPDATE store_candidates SET', 'run(code, c.id)')
    expect(upd, '找不到回填语句').toBeTruthy()
    expect(upd, '回填 store_code 时改了 updated_at ⇒ 列表排序被顶上去，看着像刚推进过').not.toContain('updated_at')
  })
})

describe('G3. 删除：关联到门店的行必须拦住', () => {
  it('判据与列表同源（都走 matchCandidate），⛔ 不能只判 store_code', () => {
    expect(DELETE.length).toBeGreaterThan(200)
    expect(DELETE, '没拦关联门店 ⇒ 删了刷新就复活，用户会反复点').toContain('matchCandidate(')
    expect(DELETE, '只判 store_code 会漏掉"按名称+坐标关联上"的行').toContain('candidateStores(')
    expect(DELETE).toMatch(/status\(400\)/)
  })
})

describe('G4. 候选门店的取数口径', () => {
  it('必须排除合并软删（merged_into）', () => {
    const body = fnBody(ROUTE, 'candidateStores')
    expect(body, '找不到 candidateStores').toBeTruthy()
    expect(body, '少了 merged_into IS NULL ⇒ 一次门店合并在候选点位页会多出一条').toContain('merged_into IS NULL')
  })

  it('只取两种候选门店类型，且常量只有一处定义', () => {
    const body = fnBody(ROUTE, 'candidateStores')
    expect(body).toContain('CANDIDATE_STORE_TYPES')
    const defs = [...ROUTE.matchAll(/const CANDIDATE_STORE_TYPES = \[([^\]]+)\]/g)]
    expect(defs.length, '候选门店类型被定义了多份 ⇒ 迟早漂移').toBe(1)
    expect(defs[0][1]).toContain("'重点候选'")
    expect(defs[0][1]).toContain("'一般候选'")
    expect(defs[0][1], '⛔ 别把「已开业」也算成候选门店').not.toContain('已开业')
  })

  it('详情接口带出关联门店（前端靠它显示门店类型/判断能否删）', () => {
    expect(DETAIL).toContain('marker')
    // 377：反查门店抽成 linkedStoreFor（详情与初步分析共用），判据仍必须走 matchCandidate
    expect(DETAIL, '详情不反查门店 ⇒ 前端不知道这行来自哪家店、能不能删').toContain('linkedStoreFor(')
    const body = fnBody(ROUTE, 'linkedStoreFor')
    expect(body, '找不到 linkedStoreFor').toBeTruthy()
    expect(body, '⛔ 只判 store_code 会漏掉「名字差一个店字」的现网数据（376 实测 118m 同名店）')
      .toContain('matchCandidate(')
    expect(body).toContain('merged_into IS NULL')
  })
})

describe('G5. 关联判据模块必须零依赖', () => {
  it('candidateLink.js 不 import 任何模块（被 mock 的模块里不许放纯判据）', () => {
    expect(LINK.length).toBeGreaterThan(500)
    expect(LINK, 'candidateLink 一旦 import 了会发请求/读配置的模块，测试里一 mock 判据就变 undefined（静默假绿）')
      .not.toMatch(/^\s*import\s/m)
  })

  it('判据包含三条优先级：store_code / 名称+500m / 名称+同城', () => {
    expect(LINK).toContain('export function normStoreName')
    expect(LINK).toContain('export function matchCandidate')
    expect(LINK).toContain('export function linkAll')
    expect(LINK).toContain('LINK_TOL_M')
  })
})

describe('G6. 前端：读不建行、写前 ensure、门店行不可删', () => {
  it('openDetail 里 ⛔ 不调 ensureRow（点开详情只是看）', () => {
    const body = fnBody(VIEW, 'openDetail')
    expect(body, '找不到 openDetail').toBeTruthy()
    expect(body, 'openDetail 里建行 ⇒ 用户看一眼就在库里留记录').not.toContain('ensureRow(')
    expect(body).toMatch(/if \(!row\.id\) return/)
  })

  it('四个写入口都必须先 ensureRow', () => {
    for (const fn of ['changeStage', 'addRemark', 'openReport', 'openEdit']) {
      // changeStage / addRemark / openReport / openEdit 都是 async function
      const i = VIEW.indexOf(`async function ${fn}(`)
      expect(i, `找不到 ${fn}`).toBeGreaterThan(-1)
      const j = VIEW.indexOf('\n}', i)
      const body = VIEW.slice(i, j < 0 ? VIEW.length : j)
      expect(body, `${fn} 没 ensureRow ⇒ 门店行第一次操作会 404`).toContain('ensureRow(')
    }
  })

  it('门店行的「删除」按钮不渲染，且 remove() 二次拦截', () => {
    expect(VIEW_RAW, '表格里门店行仍渲染删除按钮').toMatch(
      /<el-button[^>]*v-if="row\.origin !== 'store'"[^>]*@click\.stop="remove\(row\)"[^>]*>删除<\/el-button>/
    )
    const body = fnBody(VIEW, 'remove')
    expect(body, 'remove() 没拦门店行 ⇒ 用户从详情抽屉仍能点删除').toContain("origin === 'store'")
    expect(body).toContain('我的门店')
  })

  it('门店行的编辑弹窗里，门店台账字段必须 disabled', () => {
    expect(VIEW_RAW, '缺 formFromStore 开关').toContain('formFromStore')
    expect(VIEW_RAW).toMatch(/form\.name[^>]*:disabled="formFromStore"/)
    expect(VIEW_RAW).toMatch(/form\.address[^>]*:disabled="formFromStore"/)
    expect(VIEW_RAW).toMatch(/form\.latitude[^>]*:disabled="formFromStore"/)
    // 半径是候选点位独有的，必须可改
    expect(VIEW_RAW).toMatch(/form\.radius[^>]*:min="100"/)
  })

  it('空态必须指向「我的门店」，⛔ 不能只教用户点「新建」', () => {
    const i = VIEW_RAW.indexOf('cd-empty')
    expect(i).toBeGreaterThan(-1)
    const block = VIEW_RAW.slice(i, i + 1600)
    expect(block).toContain('我的门店')
    expect(block).toContain('/data')
  })

  it('🔴 el-table 的 row-key 不能是裸 id（门店驱动的行 id 可能为 null）', () => {
    expect(VIEW_RAW, 'row-key="id" 在多行 id 为 null 时会让行复用错乱').not.toContain('row-key="id"')
    expect(VIEW_RAW).toMatch(/:row-key="\(row\) =>/)
  })
})

describe('G7. store_code 列必须代码自己建（新库 + 老库）', () => {
  it('CREATE TABLE 里有，且另有 ALTER 兜底', () => {
    const create = slice(DB, 'CREATE TABLE IF NOT EXISTS store_candidates', 'FOREIGN KEY (user_id) REFERENCES users(id)')
    expect(create, '新库建表里没有 store_code').toContain('store_code TEXT')
    expect(DB, '老库没有 ALTER 补列 ⇒ 现网一升级就 SELECT 报错（shapefiles.city 事故翻版）')
      .toMatch(/ALTER TABLE store_candidates ADD COLUMN store_code/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('负变异：改坏必须报红（证明上面不是假绿）', () => {
  const mutated = (file, from, to) => {
    const src = file === 'route' ? ROUTE : file === 'view' ? VIEW : DB
    const out = src.replace(from, to)
    expect(out, `变异没生效：${from} 不存在`).not.toBe(src)
    return out
  }
  const reList = (src) => slice(src, "router.get('/', authenticate", "router.post('/ensure'")
  const reDelete = (src) => slice(src, "router.delete('/:id'", 'export default router')

  it('M201 给 GET / 塞一条 INSERT ⇒ 纯读断言必须红', () => {
    const src = mutated('route', "const { rows } = buildRows(db, uid)", "db.prepare('INSERT INTO store_candidates (user_id, name, latitude, longitude) VALUES (?,?,?,?)').run(uid, 'x', 1, 1)\n    const { rows } = buildRows(db, uid)")
    expect(reList(src)).toMatch(/INSERT\s+INTO/i)
  })

  it('M202 删掉 DELETE 里的 matchCandidate 拦截 ⇒ 关联行可删（刷新复活）', () => {
    const src = mutated('route', 'const linkedStore = matchCandidate(c, candidateStores(db, uid), planarMeters)', 'const linkedStore = null')
    expect(reDelete(src)).not.toContain('matchCandidate(')
  })

  it('M203 删掉 merged_into IS NULL ⇒ 合并后的墓碑店重新出现', () => {
    const src = mutated('route', 'AND merged_into IS NULL', '')
    expect(fnBody(src, 'candidateStores')).not.toContain('merged_into IS NULL')
  })

  it('M204 把 ensureRow 塞进 openDetail ⇒ 读操作变成写操作', () => {
    const src = mutated('view', '  drawer.value = true\n  if (!row.id) return', '  drawer.value = true\n  await ensureRow(row)')
    expect(fnBody(src, 'openDetail')).toContain('ensureRow(')
  })

  it('M205 删掉前端 remove 的门店拦截 ⇒ 提交到后端才 400（体验差且用户以为坏了）', () => {
    const src = mutated('view', "if (row.origin === 'store') {", 'if (false) {')
    expect(fnBody(src, 'remove')).not.toContain("origin === 'store'")
  })

  it('M206 删掉 database.js 的 ALTER ⇒ 老库升级后 SELECT 报错', () => {
    // ⚠️ 只能锚 ALTER 语句本身：DB 已经剥过注释，`catch (e) { /* 列已存在 */ }`
    //    在剥注释后变成 `catch (e) {  }`，按整行正则去匹配会静默失配（本文件踩过一次）
    const src = DB.replace(/ALTER TABLE store_candidates ADD COLUMN store_code TEXT/, '')
    expect(src).not.toBe(DB)
    expect(src).not.toMatch(/ALTER TABLE store_candidates ADD COLUMN store_code/)
  })

  it('基线本身是干净的（否则上面六条变异可能"本来就红"）', () => {
    expect(reList(ROUTE)).not.toMatch(/INSERT\s+INTO/i)
    expect(reDelete(ROUTE)).toContain('matchCandidate(')
    expect(fnBody(ROUTE, 'candidateStores')).toContain('merged_into IS NULL')
    expect(fnBody(VIEW, 'openDetail')).not.toContain('ensureRow(')
    expect(fnBody(VIEW, 'remove')).toContain("origin === 'store'")
    expect(DB).toMatch(/ALTER TABLE store_candidates ADD COLUMN store_code/)
  })
})
