/**
 * 初步分析「买联通人口」入口守卫（批次 379 立 · **v1.13.407 重写**）
 *
 * ── 这一版守什么 ──────────────────────────────────────────────────────────
 * 407 起，购买动作不再由初步分析自己取数，而是**交给地图页同一个门店弹窗**
 * （`StoreSmartstepsDialog`，走 `/api/smartsteps/query`）。所以 379~406 那套
 * 「probeOnly / 确认框 / requireQuota」的断言已经全部失效 —— 取数逻辑搬走了，
 * 留在原处只会变成一堆指向死代码的假断言。现在守的是「搬家没搬坏」：
 *
 *   ① 面板**一个取数请求都不许有**（0 消耗是初步分析能免费给人看的前提）
 *   ② 按钮只能打开弹窗，且弹窗**必须懒加载**（那个组件 2800+ 行）
 *   ③ 传给弹窗的坐标字段名必须是 `latitude / longitude`（弹窗内部这么读，
 *      传 lat/lng 会让它拿到 undefined，然后在几百行外炸）
 *   ④ 预填半径必须 clamp 到 0.31~5km 且保留 2 位小数，且**不许动 4 个输入框**
 *      （业主 11-23 明确：4 个框是「一次查多个候选半径」的用法，要保留）
 *   ⑤ 后端口径文案不许再写「联通只有 1/3/5km 三档 / 向上取整 / 不会漏算」——
 *      这个前提已被证伪（门店弹窗一直支持任意半径、生产库 0 条记录）
 *   ⑥ 报告页（纸张本体）仍然一个付费接口都不碰
 *
 * 🔴 守卫自身规范（211/231）：正则扫源码**必须剥注释**，且必须配负变异。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释（顺序不可换，见 candidateBriefGuard 的踩坑记录） */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const UPGRADE_RAW = read('frontend/src/components/CandidateBriefUpgrade.vue')
const UPGRADE = strip(UPGRADE_RAW)
const DIALOG_RAW = read('frontend/src/components/StoreSmartstepsDialog.vue')
const DIALOG = strip(DIALOG_RAW)
const BRIEF = strip(read('frontend/src/components/CandidateBriefReport.vue'))
const PDF_UTIL = strip(read('frontend/src/utils/exportPaperPdf.js'))
const CONFIG = strip(read('backend/src/utils/siteSelectConfig.js'))
const BRIEF_UTIL = strip(read('backend/src/utils/candidateBrief.js'))

describe('U1. 面板存在、被报告页引用、且在纸张之外', () => {
  it('切片自检：取到的内容非空（否则下面全部静默假绿）', () => {
    expect(UPGRADE_RAW.length).toBeGreaterThan(1500)
    expect(DIALOG_RAW.length).toBeGreaterThan(10000)
    expect(BRIEF.length).toBeGreaterThan(10000)
  })

  it('报告页引用了面板', () => {
    expect(BRIEF).toContain("from '@/components/CandidateBriefUpgrade.vue'")
    expect(BRIEF).toContain('<CandidateBriefUpgrade')
  })

  it('🔴 面板必须在纸张之外（打印 / PDF 不该出现付费按钮）', () => {
    const iFoot = BRIEF.indexOf('class="bf-foot"')
    const iComp = BRIEF.indexOf('<CandidateBriefUpgrade')
    expect(iFoot).toBeGreaterThan(0)
    expect(iComp, '升级面板被塞进纸张里 ⇒ 会进 PDF').toBeGreaterThan(iFoot)
    expect(PDF_UTIL, '导出工具里出现付费面板类名 ⇒ 它被算进切页范围').not.toContain('bu-panel')
  })
})

describe('U2. 面板本身 0 消耗（取数已搬去弹窗）', () => {
  it('⛔ 面板里不许有任何取数请求', () => {
    for (const bad of [
      "axios.post('/api/smartsteps", 'axios.get(\'/api/smartsteps',
      '/api/smartsteps/population', 'probeOnly', 'fetchPointPopulation'
    ]) {
      expect(UPGRADE, `面板里出现 ${bad} ⇒ 初步分析又变回会扣钱的页面`).not.toContain(bad)
    }
  })

  it('⛔ 也不许引 axios（没有请求就不需要它）', () => {
    expect(UPGRADE).not.toContain("import axios")
  })

  it('⛔ 旧的证据块 / 成本行 / 口径说明都已下线（避免同一件事两处展示）', () => {
    for (const gone of ['bu-ev', 'bu-kpi', 'bu-cost', 'radiusNote', 'reuseHint', 'evidence']) {
      expect(UPGRADE, `面板里还留着 ${gone} ⇒ 与弹窗重复或已失效`).not.toContain(gone)
    }
  })
})

describe('U3. 按钮只能打开弹窗，且必须懒加载', () => {
  it('按钮文案是「打开联通人口查询」', () => {
    expect(UPGRADE).toContain('打开联通人口查询')
    // ⛔ 不再承诺「（1 次配额）」—— 用户在弹窗里能改半径，扣几次由弹窗决定
    expect(UPGRADE).not.toContain('次配额）')
  })

  it('🔴 必须 defineAsyncComponent 懒加载（2800+ 行，同步 import 会撑大首屏）', () => {
    expect(UPGRADE).toContain('defineAsyncComponent')
    expect(UPGRADE).toMatch(/defineAsyncComponent\(\s*\(\)\s*=>\s*import\(['"]@\/components\/StoreSmartstepsDialog\.vue['"]\)\s*\)/)
    // 反向：不许出现同步 import
    expect(UPGRADE).not.toMatch(/^import\s+StoreSmartstepsDialog\s+from/m)
  })

  it('🔴 挂载时用 v-if 重建（否则预填半径会覆盖用户下一次的输入）', () => {
    const i = UPGRADE.indexOf('<StoreSmartstepsDialog')
    expect(i).toBeGreaterThan(0)
    const tag = UPGRADE.slice(i, UPGRADE.indexOf('/>', i) + 2)
    expect(tag).toContain('v-if="upOpen"')
    expect(tag).toContain(':visible="upOpen"')
  })

  it('🔴 坐标字段必须是 latitude / longitude（⛔ lat / lng）', () => {
    const i = UPGRADE.indexOf('<StoreSmartstepsDialog')
    const tag = UPGRADE.slice(i, UPGRADE.indexOf('/>', i) + 2)
    expect(tag).toContain(':store="dialogStore"')
    const fn = UPGRADE.slice(UPGRADE.indexOf('const dialogStore'), UPGRADE.indexOf('const tierTag'))
    expect(fn.length, '切片失败（dialogStore 被改名？）').toBeGreaterThan(80)
    expect(fn).toContain('latitude:')
    expect(fn).toContain('longitude:')
    expect(fn, 'dialogStore 里出现裸 lat: ⇒ 弹窗读不到坐标').not.toMatch(/\blat\s*:/)
    expect(fn, 'dialogStore 里出现裸 lng: ⇒ 弹窗读不到坐标').not.toMatch(/\blng\s*:/)
  })

  it('报告半径作为预填值传进去', () => {
    const i = UPGRADE.indexOf('<StoreSmartstepsDialog')
    const tag = UPGRADE.slice(i, UPGRADE.indexOf('/>', i) + 2)
    expect(tag).toContain(':preset-radius="reportRadius"')
  })
})

describe('U4. 弹窗的预填实现（clamp + 不动 4 个框）', () => {
  it('props 声明了 presetRadius，默认 0（＝地图页进来的老行为不变）', () => {
    expect(DIALOG).toMatch(/presetRadius:\s*\{\s*type:\s*Number,\s*default:\s*0\s*\}/)
  })

  it('🔴 预填必须 clamp 到 0.31~5 且保留 2 位小数', () => {
    const i = DIALOG.indexOf('function applyPresetRadius')
    expect(i, '找不到 applyPresetRadius（预填逻辑被删？）').toBeGreaterThan(0)
    const fn = DIALOG.slice(i, DIALOG.indexOf('}', DIALOG.indexOf('radius1 =', i)) + 1)
    expect(fn.length).toBeGreaterThan(80)
    expect(fn, '没夹上限 / 下限 ⇒ 弹窗会显示 0.05 或 8 公里').toMatch(/Math\.min\(5[\s\S]*Math\.max\(0\.31/)
    expect(fn, '没四舍五入到 2 位 ⇒ 输入框会显示 1.4999999').toMatch(/Math\.round\(/)
  })

  it('🔴 只在传了正数时覆盖（⛔ 把地图页默认值冲掉）', () => {
    const i = DIALOG.indexOf('function applyPresetRadius')
    const fn = DIALOG.slice(i, DIALOG.indexOf('}', DIALOG.indexOf('radius1 =', i)) + 1)
    expect(fn).toMatch(/m\s*<=\s*0\)\s*return/)
    expect(fn).toContain('Number.isFinite')
  })

  it('🔴 4 个半径输入框必须原样保留（业主 11-23：这是「一次查多个候选半径」的用法）', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(DIALOG, `半径${n} 输入框被删了`).toContain(`v-model="queryForm.radius${n}"`)
    }
    expect(DIALOG).toContain(':min="0.31"')
    expect(DIALOG).toContain(':max="5"')
    expect(DIALOG).toContain(':step="0.01"')
  })

  it('预填只碰 radius1，⛔ 不清空其余 3 个', () => {
    const i = DIALOG.indexOf('function applyPresetRadius')
    const fn = DIALOG.slice(i, DIALOG.indexOf('}', DIALOG.indexOf('radius1 =', i)) + 1)
    const hits = [...fn.matchAll(/radius\d/g)].map((m) => m[0])
    expect(hits.length, 'applyPresetRadius 里应当只出现 radius1').toBe(1)
    expect(hits[0]).toBe('radius1')
  })
})

describe('U5. 后端口径文案：旧前提不许回潮', () => {
  it('radiusNote 不再写「三档 / 向上取整 / 不会漏算 / 将按」', () => {
    const i = BRIEF_UTIL.indexOf('function upgradeRadiusNote')
    expect(i, '找不到 upgradeRadiusNote').toBeGreaterThan(0)
    const fn = BRIEF_UTIL.slice(i, BRIEF_UTIL.indexOf('\n}', i) + 2)
    expect(fn.length).toBeGreaterThan(60)
    for (const gone of ['三档', '漏算', '将按', '向上取']) {
      expect(fn, `口径文案里还写着「${gone}」⇒ 前提已被证伪`).not.toContain(gone)
    }
    expect(fn, '必须给出弹窗里可选的真实区间').toContain('UNICOM_RADIUS_RANGE_KM')
    // 区间本身只有一份来源，且必须与弹窗输入框的 min/max 一致
    expect(BRIEF_UTIL).toMatch(/UNICOM_RADIUS_RANGE_KM\s*=\s*Object\.freeze\(\{\s*min:\s*0\.31,\s*max:\s*5\s*\}\)/)
    expect(DIALOG).toContain(':min="0.31"')
    expect(DIALOG).toContain(':max="5"')
  })

  it('reuseHint 不再替用户指定档位（「本次按 3km」）', () => {
    const i = BRIEF_UTIL.indexOf('export function purchasedReuseText')
    const fn = BRIEF_UTIL.slice(i, BRIEF_UTIL.indexOf('\n}', i) + 2)
    expect(fn.length).toBeGreaterThan(200)
    expect(fn, '又把「本次按 X」写回来了 ⇒ 用户在弹窗里可能选别的圆').not.toContain('本次按')
    // 恒为真的两件事必须在
    expect(fn).toContain('已购')
    expect(fn).toContain('同半径')
  })

  it('纸面上仍展示取数口径（删掉这句用户就不知道弹窗能选多大）', () => {
    expect(BRIEF).toContain('取数口径')
    expect(BRIEF).toContain('brief.upgrade.radiusNote')
  })

  it('🔴 对比表不许再写「联通无此档，按 X 取」（弹窗支持 0.31~5km 任意半径）', () => {
    expect(BRIEF, '「无此档」是「报告替用户取整」时代的说法，前提已失效').not.toContain('联通无此档')
    expect(BRIEF, '前端还在读 r.unicom ⇒ 后端字段已删，会渲染成 undefined').not.toContain('r.unicom')
  })
})

describe('U6. 初步分析页必须保持 0 消耗', () => {
  it('报告页仍然一个付费接口都不碰', () => {
    for (const bad of ['/api/smartsteps', 'probeOnly', '/api/amap', '/api/poi', 'fetchPointPopulation']) {
      expect(BRIEF, `初步分析页出现了 ${bad} ⇒ 0 消耗被破坏`).not.toContain(bad)
    }
    const calls = [...BRIEF.matchAll(/axios\.(get|post|patch|delete)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[2])
    expect([...new Set(calls)]).toEqual(['/api/candidates/brief'])
  })
})

describe('U7. 联通档位常量只有一份来源', () => {
  it('配置里有 UNICOM_REPORT_RADII，且 candidateBrief 不自己写字面量', () => {
    expect(CONFIG).toMatch(/UNICOM_REPORT_RADII\s*=\s*Object\.freeze\(\[1000,\s*3000,\s*5000\]\)/)
    expect(BRIEF_UTIL, '半径映射自己写字面量 ⇒ 联通开新档时会漏')
      .not.toMatch(/\[\s*1000\s*,\s*3000\s*,\s*5000\s*\]/)
  })
})

describe('U8. 负变异：证明上面的断言真会红', () => {
  /** 与守卫同构的最小判据：拿坏样本跑一遍，必须逐条点名 */
  const forbidden = (src) => {
    const bad = []
    if (src.includes('/api/smartsteps')) bad.push('panel-fetch')
    if (!/defineAsyncComponent\(/.test(src)) bad.push('no-lazy')
    if (!/latitude:/.test(src) || !/longitude:/.test(src)) bad.push('bad-coord-fields')
    if (/radius2\s*=/.test(src) && /applyPresetRadius/.test(src)) bad.push('preset-touches-radius2')
    if (!/Math\.min\(5/.test(src)) bad.push('no-clamp')
    if (!src.includes('打开联通人口查询')) bad.push('wrong-button-text')
    return bad
  }

  it('坏样本必须逐条被点名（否则守卫只是「写了个正则」）', () => {
    const sample = `
      import StoreSmartstepsDialog from '@/components/StoreSmartstepsDialog.vue'
      axios.post('/api/smartsteps/population', {})
      const dialogStore = { name: 'x', lat: 1, lng: 2 }
      function applyPresetRadius(){ queryForm.value.radius2 = 3 }
      const btn = '取联通人口（1 次配额）'
    `
    expect(forbidden(sample)).toEqual([
      'panel-fetch', 'no-lazy', 'bad-coord-fields', 'preset-touches-radius2', 'no-clamp', 'wrong-button-text'
    ])
  })

  it('好样本必须全过（避免守卫把正确写法判红）', () => {
    const ok = `
      const StoreSmartstepsDialog = defineAsyncComponent(() => import('@/components/StoreSmartstepsDialog.vue'))
      const dialogStore = { name: 'x', latitude: 1, longitude: 2 }
      function applyPresetRadius(){ queryForm.value.radius1 = Math.min(5, Math.max(0.31, 3)) }
      const btn = '打开联通人口查询'
    `
    expect(forbidden(ok)).toEqual([])
  })
})
