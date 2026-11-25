/**
 * 414 候选点位详情抽屉：去掉「评估半径」＋ 面积/月租金必须真读门店台账
 *
 * ── 业主原话（2026-11-25）────────────────────────────────────────────
 *  ① 「评估半径 1000m」显示意义不大，去掉（半径是点「初步分析」后在那份报告里设置的）；
 *  ② 「面积」与「月租金」是读取「我的门店」里的数据吗？
 *
 * ── 查出来的两个真问题（这不是"改文案"，是两个数据链路的断点）──────
 *  ① 面积读错列：`markers` 同时有 `area`（早期遗留列，**全站没有任何写入路径**）
 *     与 `store_area`（「我的门店」页面真正写入的那一列）。原代码取 `m.area`
 *     ⇒ 门店来源的候选点位，面积**恒显示「—」**，用户填了也看不到。
 *  ② 月租金根本没有录入处：`markers.rent` 无人写、门店表单没有租金输入框
 *     ⇒ 只有「独立点位」手填时才有值。
 *
 * ── 守什么 ────────────────────────────────────────────────────────────
 *  ① 详情抽屉不再渲染「评估半径」（但 `row.radius` 的数据依赖不能一起删）
 *  ② 面积必须是 `store_area` → `area`（老数据兜底）→ 候选记录 三级回落
 *  ③ 三处 markers 查询（列表 / 反查 / 按 markerId 解析）都要带 `store_area`
 *  ④ 月租金三条写入路径齐全：新建 / 更新 / CSV 导入
 *  ⑤ 「我的门店」表单有月租金输入，且绑定 `form.rent`
 *  ⑥ 导入字段清单含 `rent`，且口径写清「元/月」而不是「元/㎡/月」
 *
 * 🔴 守卫自身规范：扫源码必须先剥注释（注释里写着「评估半径」「月租金」的历史说明，
 *    不剥会让 ① 假红；同理 `detail.radius` 的旧注释也会骗过断言）。
 * 🔴 模板断言必须**切片**：抽屉里的 `<dt>` 与列表列名是两套 DOM，全文搜索会串味。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** 剥 HTML 注释 → 块注释 → 行注释（HTML 必须最先剥：`//` 会先吃掉 `<!-- ... -->` 的一半）。 */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const viewRaw = read('frontend/src/views/CandidateView.vue')
const view = strip(viewRaw)
const candRaw = read('backend/src/routes/candidates.js')
const cand = strip(candRaw)
const markers = strip(read('backend/src/routes/markers.js'))
const dataView = strip(read('frontend/src/views/DataView.vue'))
const specs = read('frontend/src/utils/importSpecs.js')

/** 详情抽屉的信息区片段（`<dl class="cd-info">` … `</dl>`），所有抽屉断言都在这片里做。 */
function detailInfoBlock() {
  const start = view.indexOf('<dl class="cd-info">')
  expect(start, '找不到详情抽屉的 <dl class="cd-info">').toBeGreaterThan(-1)
  const end = view.indexOf('</dl>', start)
  expect(end, 'cd-info 没有闭合').toBeGreaterThan(start)
  return view.slice(start, end)
}

describe('414 ① 详情抽屉去掉「评估半径」', () => {
  it('抽屉信息区不再有「评估半径」这一项', () => {
    const block = detailInfoBlock()
    expect(block).not.toContain('评估半径')
    expect(block).not.toContain('detail.radius')
  })

  it('面积/月租金两项仍在（删的只是半径，别顺手删过头）', () => {
    const block = detailInfoBlock()
    expect(block).toContain('<dt>面积</dt>')
    expect(block).toContain('<dt>月租金</dt>')
  })

  it('🔴 删的只是展示：openBrief 仍靠 row.radius 决定初步分析的默认半径', () => {
    expect(view).toMatch(/radius:\s*Number\(row\?\.radius\)\s*\|\|\s*1000/)
  })

  it('半径仍可在「编辑评估半径」对话框里改（form.radius 的输入框还在）', () => {
    expect(view).toMatch(/v-model="form\.radius"/)
  })
})

describe('414 ② 面积必须真读门店台账的 store_area', () => {
  it('门店行按 store_area → area → 候选记录 三级回落', () => {
    expect(cand).toMatch(/area:\s*m\.store_area\s*\?\?\s*m\.area\s*\?\?\s*\(c \? c\.area : null\)/)
  })

  it('⛔ 不许退回只读 m.area（那会让门店行恒显示「—」）', () => {
    expect(cand).not.toMatch(/area:\s*m\.area\s*\?\?\s*\(c \? c\.area : null\)/)
  })

  it('三处 markers 查询都带上了 store_area', () => {
    const hits = cand.match(/store_area/g) || []
    // candidateStores / linkedStoreFor / resolvePointRequest 三处 SELECT + 建行时的一处取值
    expect(hits.length).toBeGreaterThanOrEqual(4)
  })

  it('自动建候选记录时面积也取 store_area（否则新建那行就丢了面积）', () => {
    expect(cand).toMatch(/num\(m\.store_area \?\? m\.area\)/)
  })
})

describe('414 ③ 月租金三条写入路径齐全', () => {
  it('新建门店（POST）写 rent', () => {
    expect(markers).toMatch(/frontage, rent,\s*\n\s*store_category/)
    expect(markers).toMatch(/rent === undefined \|\| rent === null \|\| rent === '' \? null : Number\(rent\)/)
  })

  it('更新门店（PUT）写 rent，未传则保留原值', () => {
    expect(markers).toMatch(/seats = \?, frontage = \?, rent = \?/)
    expect(markers).toMatch(/rent === undefined \? existingMarker\.rent/)
  })

  it('CSV 导入（/import）写 rent', () => {
    expect(markers).toMatch(/store_area,seats,frontage,rent,store_category/)
    expect(markers).toMatch(/row\.rent \? esc\(parseFloat\(row\.rent\)\) : 'NULL'/)
  })

  it('「我的门店」表单有月租金输入并绑定 form.rent', () => {
    expect(dataView).toContain('月租金(元)')
    expect(dataView).toMatch(/v-model="form\.rent"/)
  })

  it('保存时把 rent 一起发给后端（{ ...form } 覆盖到，不得被白名单丢掉）', () => {
    expect(dataView).toMatch(/updateMarker\(editingId\.value, \{ \.\.\.form \}\)/)
  })
})

describe('414 ④ 导入字段清单：rent 的口径必须写清「元/月」', () => {
  it('STORE_IMPORT_FIELDS 含 rent 行', () => {
    expect(specs).toMatch(/\{ key: 'rent', label: '月租金（元）'/)
  })

  it('⛔ 文件名/列名不许写成「元/㎡/月」单价（那是销售预测的另一种口径）', () => {
    const line = specs.split('\n').find((l) => l.includes("key: 'rent'")) || ''
    expect(line).toContain('元/月')
    // 只校列名：说明里那句「⛔ 不是元/㎡/月的单价」是反向提示，本身就该出现
    expect(line).toMatch(/label: '月租金（元）'/)
    expect(line).not.toMatch(/label: '[^']*元\/㎡/)
  })

  it('模板样例行带上 rent，用户能看懂这一列怎么填', () => {
    expect(specs).toMatch(/store_area: 200, rent: 56000/)
  })
})
