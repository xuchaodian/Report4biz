/**
 * 开店测算（storeSim）守卫。
 *
 * 这里钉的每一条，都对应一个「改错了不会报错、但会静默算错钱」的坑：
 *   ① 品牌外卖占比表**前后端各留一份** ⇒ 必须逐字一致，否则训练用一套、测算用另一套
 *   ② 视图里再写一份表字面量 ⇒ 三份副本，改一处漏两处（v1.13.357 前的真实状态）
 *   ③ 测算模块自己去做预测 ⇒ 同一个店在预测页和测算页出现两个营收数字
 *   ④ 视图里散写 ×10000 / ÷100 ⇒ 漏一处就是 100 倍误差
 *   ⑤ 回本周期自己 toFixed ⇒ Infinity 会被兜成 0，「回不了本」显示成「已回本」
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const FRONT = path.join(REPO, 'frontend/src')
const BACK = path.join(REPO, 'backend/src')

const read = (p) => fs.readFileSync(p, 'utf8')

/** 剥掉行注释与块注释，避免注释里的示例代码被当成真代码（本项目踩过多次）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}
/** 剥 HTML 注释（.vue 模板用）。 */
const stripHtml = (src) => src.replace(/<!--[\s\S]*?-->/g, '')

/** 递归收集 .vue / .js（排除 .bak_ 备份与 dist）。 */
function collect(dir, exts = ['.vue', '.js']) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('dist')) continue
        walk(p)
      } else if (exts.includes(path.extname(e.name)) && !e.name.includes('.bak_')) {
        out.push(p)
      }
    }
  }
  walk(dir)
  return out
}

/** 从源码里截出 `DELIVERY_RATIO_MAP = { … }` 的表体（空白归一后比较）。 */
function extractTable(src) {
  const i = src.indexOf('DELIVERY_RATIO_MAP = {')
  if (i < 0) return null
  const j = src.indexOf('\n}', i)
  if (j < 0) return null
  return src.slice(i, j).replace(/\s+/g, ' ').trim()
}

const FRONT_TABLE_FILE = path.join(FRONT, 'utils/storeBrand.js')
const BACK_TABLE_FILE = path.join(BACK, 'utils/deliveryRatio.js')

describe('外卖占比单一来源（前后端各一份，必须逐字一致）', () => {
  it('① 两侧表体逐字一致', () => {
    const a = extractTable(read(FRONT_TABLE_FILE))
    const b = extractTable(read(BACK_TABLE_FILE))
    expect(a, '前端 storeBrand.js 里找不到 DELIVERY_RATIO_MAP 表').toBeTruthy()
    expect(b, '后端 deliveryRatio.js 里找不到 DELIVERY_RATIO_MAP 表').toBeTruthy()
    expect(a, '前后端外卖占比表已分叉 —— 训练与测算会用两套假设，必须同步修改两侧')
      .toBe(b)
  })

  it('② 兜底值两侧同值（训练特征与测算必须同假设）', () => {
    const pick = (src) => {
      const m = src.match(/DELIVERY_RATIO_FALLBACK\s*=\s*(\d+)/)
      return m ? Number(m[1]) : null
    }
    const a = pick(read(FRONT_TABLE_FILE))
    const b = pick(read(BACK_TABLE_FILE))
    expect(a, '前端缺少 DELIVERY_RATIO_FALLBACK').not.toBeNull()
    expect(b, '后端缺少 DELIVERY_RATIO_FALLBACK').not.toBeNull()
    expect(a).toBe(b)
  })

  it('③ 视图 / 组件 / 路由里不得再出现表字面量（三份副本是旧病根）', () => {
    const hits = []
    const files = [
      ...collect(path.join(FRONT, 'views')),
      ...collect(path.join(FRONT, 'components')),
      ...collect(path.join(BACK, 'routes'))
    ]
    for (const f of files) {
      const src = stripComments(stripHtml(read(f)))
      // 只认「赋值定义」，放过 import / 引用
      if (/DELIVERY_RATIO_MAP\s*=\s*\{/.test(src)) {
        hits.push(path.relative(REPO, f))
      }
    }
    expect(hits, '外卖占比表被重新写死了（应 import 单一来源）:\n' + hits.join('\n')).toEqual([])
  })
})

describe('测算不做预测（营收必须来自销售预测）', () => {
  it('④ storeSim.js 不得发起任何网络请求（不做第二套预测）', () => {
    const src = stripComments(read(path.join(FRONT, 'utils/storeSim.js')))
    expect(src, 'storeSim 里出现了请求调用 —— 测算必须复用 prediction 结果')
      .not.toMatch(/\b(axios|fetch|api\.post|api\.get)\b/)
    expect(src, 'storeSim 里出现了 sales-forecast 接口字样 —— 测算不该自己调预测').not.toMatch(/sales-forecast/)
  })

  it('⑤ 销售预测页把 predictComp（元）作为营收传入 computeSim', () => {
    const src = stripComments(stripHtml(read(path.join(FRONT, 'views/SalesForecastView.vue'))))
    // ⚠️ 必须排除 `predictCompWan`（万元）：它同样以 predictComp 开头，
    //    只写 /predictComp/ 会让「传了万元字段」的缺陷静默通过 —— 差 10000 倍。
    expect(src, '营收未取自 result.predictComp（元）—— 取 Wan 字段会差 10000 倍')
      .toMatch(/annualRevenue\s*:\s*result\.value\?\.predictComp(?![A-Za-z])/)
    expect(src, '营收不得取 predictCompWan（万元）').not
      .toMatch(/annualRevenue\s*:\s*result\.value\?\.predictCompWan/)
  })
})

describe('单位换算集中在一处', () => {
  it('⑥ 视图不得对成本字段自行 ×10000 / ÷100', () => {
    const src = read(path.join(FRONT, 'views/SalesForecastView.vue'))
    // 只检查与测算表单相关的行，避免误伤页面上其他换算
    const bad = src.split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /simForm\.|simCosts\./.test(l) &&
        /(\*\s*10000|\/\s*100\b)/.test(l))
      .map(({ l, n }) => `${n}  ${l.trim().slice(0, 90)}`)
    expect(bad, '成本单位换算散落在视图里（应全部走 toComputeCosts）:\n' + bad.join('\n')).toEqual([])
  })

  it('⑦ toComputeCosts 存在且被视图使用（唯一换算点）', () => {
    const util = read(path.join(FRONT, 'utils/storeSim.js'))
    expect(util, '缺少 toComputeCosts').toMatch(/export function toComputeCosts/)
    const view = read(path.join(FRONT, 'views/SalesForecastView.vue'))
    expect(view, '视图没有使用 toComputeCosts').toMatch(/toComputeCosts\(/)
  })
})

describe('回本周期不能把「回不了本」显示成 0', () => {
  it('⑧ computeSim 对月净利 ≤0 返回 Infinity（须有 > 0 判定）', () => {
    const src = read(path.join(FRONT, 'utils/storeSim.js'))
    expect(src, 'paybackMonths 缺少 monthlyNet > 0 的判定 —— Infinity 会被兜成 0')
      .toMatch(/paybackMonths\s*=\s*monthlyNet\s*>\s*0\s*\?/)
    expect(src, '必须显式给出 Infinity 分支').toMatch(/:\s*Infinity/)
  })

  it('⑨ 视图用 formatPayback 统一转换，不自己 toFixed 回本周期', () => {
    const view = stripComments(stripHtml(read(path.join(FRONT, 'views/SalesForecastView.vue'))))
    expect(view, '视图未使用 formatPayback').toMatch(/formatPayback\(/)
    const bad = view.split('\n')
      .filter((l) => /paybackMonths/.test(l) && /toFixed/.test(l))
      .map((l) => l.trim().slice(0, 90))
    expect(bad, '视图自己格式化回本周期（Infinity 会变 0）:\n' + bad.join('\n')).toEqual([])
  })
})

describe('成本默认值口径', () => {
  it('⑩ 租金不得有默认值（地域差异太大，编数字＝骗人）', () => {
    const src = stripComments(read(path.join(FRONT, 'utils/storeSim.js')))
    expect(src, '租金必须有默认值 null').toMatch(/rentPerSqmMonth:\s*null/)
  })
})
