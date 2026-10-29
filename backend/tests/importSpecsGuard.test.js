/**
 * 守卫：导入字段清单「只有一份」，且与后端真正解析的列逐项一致（v1.13.292）
 *
 * 背景：门店导入的列名原来散在四处 —— `/data` 弹窗里的 `<li>` 清单、下载模板函数里的
 * 逗号串、后端 `routes/markers.js` 的 `row.xxx`、以及销售导入的 Excel 中文表头。
 * v1.13.292 把清单收口到 `frontend/src/utils/importSpecs.js`，由
 * `components/ImportGuideDialog.vue` 统一渲染，体检页与销售预测页共用。
 *
 * 收口之后新的风险是**漂移**：
 *   · 后端加了一列（客户能填），说明弹窗里没有 ⇒ 客户不知道该填，白加；
 *   · 说明弹窗里列了一列（客户照着填），后端根本不读 ⇒ 客户白填，还可能以为生效了；
 *   · 模板列顺序与后端模板不一致 ⇒ 客户把模板改乱、或按模板填却报列名错。
 * 三类都不会报错，只会「静默不生效」⇒ 用本守卫钉死。
 *
 * ⚠️ 字面量守卫（与 storeMergeReadPaths / vipGateGuard 同类）：靠正则取列名，不是语法分析。
 *    改名重构（如把 `row.name` 改成解构 `const { name } = row`）会假红 —— 这是安全的失败方向。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  STORE_IMPORT_FIELDS,
  SALES_IMPORT_FIELDS,
  ENGINE_THRESHOLDS,
  buildStoreTemplateCsv,
  templateKeys,
  salesTemplateHeaders,
  UNLOCK_HINTS
} from '../../frontend/src/utils/importSpecs.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 去掉整行注释（只剥行首 // 与 JSDoc 续行 *）—— 注释里常引用列名，不剥会假红 */
function stripCommentLines(src) {
  return src.split('\n').filter(l => {
    const s = l.trim()
    return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*'))
  }).join('\n')
}

/** 取某个 `router.xxx('/path'` 处理器的源码片段（到下一个 router. 定义或文件尾） */
function handlerSlice(src, needle) {
  const i = src.indexOf(needle)
  expect(i, `未找到 ${needle} 定义`).toBeGreaterThan(-1)
  const rest = src.slice(i + needle.length)
  const next = rest.search(/\nrouter\.(get|post|put|delete)\(/)
  return stripCommentLines(next > 0 ? rest.slice(0, next) : rest)
}

const storeFields = STORE_IMPORT_FIELDS
const salesFields = SALES_IMPORT_FIELDS

describe('门店台账：说明清单 == 后端真正读取的列', () => {
  const markersSrc = read('backend/src/routes/markers.js')
  const slice = handlerSlice(markersSrc, "router.post('/import'")
  const backendKeys = [...new Set([...slice.matchAll(/row\.([a-z_][a-z0-9_]*)/g)].map(m => m[1]))].sort()

  it('两边的列集合必须完全相同', () => {
    const specKeys = storeFields.map(f => f.key).sort()
    expect(backendKeys.length, '后端一个列都没解析出来 —— 正则或重构失配').toBeGreaterThan(10)
    expect(specKeys, '说明清单与后端解析列不一致：多了客户白填，少了客户没法填').toEqual(backendKeys)
  })

  it('必填项与后端硬性校验一致（name / latitude / longitude）', () => {
    const required = storeFields.filter(f => f.required).map(f => f.key).sort()
    expect(required).toEqual(['latitude', 'longitude', 'name'])
    // 后端就是这三列任一为空即整行跳过
    expect(slice).toMatch(/if\s*\(\s*!row\.name\s*\|\|\s*!row\.latitude\s*\|\|\s*!row\.longitude\s*\)/)
  })

  it('每个字段都要有中文名和说明（否则弹窗里是空白行）', () => {
    for (const f of storeFields) {
      expect(f.label, `${f.key} 缺中文名`).toBeTruthy()
      expect(f.note, `${f.key} 缺说明`).toBeTruthy()
    }
  })
})

describe('销售记录：说明清单 == 后端 Excel 表头', () => {
  const salesSrc = read('backend/src/routes/store-sales.js')
  const slice = handlerSlice(salesSrc, "router.post('/import'")
  const backendHeaders = [...new Set([...slice.matchAll(/r\['([^']+)'\]/g)].map(m => m[1]))].sort()

  it('两边的表头集合必须完全相同', () => {
    const specKeys = salesFields.map(f => f.key).sort()
    expect(backendHeaders.length, '后端一个表头都没解析出来').toBeGreaterThan(4)
    expect(specKeys).toEqual(backendHeaders)
  })

  it('表头顺序必须与后端下发的模板一致（客户按模板改，顺序不该被我们改乱）', () => {
    const tplBlock = salesSrc.slice(salesSrc.indexOf("router.get('/template'"))
    const row = tplBlock.match(/\[\s*'门店编号'[^\]]*\]/)
    expect(row, '未找到模板表头数组').toBeTruthy()
    const tplHeaders = [...row[0].matchAll(/'([^']+)'/g)].map(m => m[1])
    expect(salesTemplateHeaders()).toEqual(tplHeaders)
  })

  it('「年销售额」与「销售档位」必须是二选一（后端语义）', () => {
    const byKey = Object.fromEntries(salesFields.map(f => [f.key, f]))
    expect(byKey['年销售额(万元)'].note).toContain('二选一')
    expect(byKey['销售档位'].note).toContain('忽略')
    // 后端确实是这个语义：填了档位就不再要求金额
    expect(slice).toMatch(/if\s*\(!bandKey\s*&&/)
  })
})

describe('门店模板：列由清单生成，不是另抄一份', () => {
  it('CSV 表头 == 清单里 inTemplate !== false 的列，且顺序一致', () => {
    const header = buildStoreTemplateCsv().split('\n')[0].split(',')
    expect(header).toEqual(templateKeys(storeFields))
  })

  it('示例行数与列数对得上（少一列就会错位，导入时整行报错）', () => {
    const lines = buildStoreTemplateCsv().split('\n')
    expect(lines.length).toBe(3) // 表头 + 2 行示例
    const cols = lines[0].split(',').length
    for (const l of lines.slice(1)) {
      expect(l.split(',').length, '示例行列数与表头不一致').toBe(cols)
    }
  })

  it('icon_color 刻意不进模板（客户用不上，进模板只会让人困惑）', () => {
    expect(templateKeys(storeFields)).not.toContain('icon_color')
    expect(storeFields.map(f => f.key)).toContain('icon_color')
  })
})

describe('引擎门槛：说明里的数字必须与后端判据一致', () => {
  const forecastSrc = read('backend/src/routes/sales-forecast.js')
  const py = read('backend/forecast_server.py')

  it('L3 门槛 == sales-forecast 的 L3_MIN', () => {
    const m = forecastSrc.match(/const\s+L3_MIN\s*=\s*(\d+)/)
    expect(m, '未找到 L3_MIN').toBeTruthy()
    expect(ENGINE_THRESHOLDS.l3).toBe(Number(m[1]))
  })

  it('L2 门槛 == /stats 下发的 l2', () => {
    const m = forecastSrc.match(/const\s+l2\s*=\s*(\d+)/)
    expect(m, '未找到 /stats 的 l2 常量').toBeTruthy()
    expect(ENGINE_THRESHOLDS.l2).toBe(Number(m[1]))
  })

  it('L3 分组交叉验证要求的最少门店数 == forecast_server.py 的阈值', () => {
    const m = py.match(/len\(uniq\)\s*>=\s*(\d+)/)
    expect(m, '未找到 forecast_server.py 的分组阈值').toBeTruthy()
    expect(ENGINE_THRESHOLDS.l3Stores).toBe(Number(m[1]))
  })

  it('体检页引用的门槛文案与常量同源（不是又写了一遍 50 / 150）', () => {
    expect(UNLOCK_HINTS.sales).toContain(String(ENGINE_THRESHOLDS.l2))
    expect(UNLOCK_HINTS.sales).toContain(String(ENGINE_THRESHOLDS.l3))
  })
})

describe('调用方：只允许引用共用弹窗，不许再写一份字段清单', () => {
  const pages = [
    'frontend/src/views/StoreCheckupView.vue',
    'frontend/src/views/SalesForecastView.vue'
  ]

  /** 只取 <template> 段：光有 import 不算用上，必须真的挂在模板里 */
  function templateOf(src) {
    const s = src.indexOf('<template>')
    const e = src.indexOf('<script setup>')
    expect(s, '未找到 <template>').toBeGreaterThan(-1)
    return src.slice(s, e > s ? e : src.length)
  }

  for (const p of pages) {
    it(`${p} 模板里真的挂上了 ImportGuideDialog`, () => {
      const src = read(p)
      const tpl = templateOf(src)
      // 🔴 负向自检过的坑：只看整份源码，`import ImportGuideDialog ...` 这句就能骗过断言
      expect(tpl, `${p} 模板里没有 <ImportGuideDialog>`).toContain('<ImportGuideDialog')
      expect(src, `${p} 直接 import 了 importSpecs —— 应经共用弹窗渲染`).not.toContain("from '@/utils/importSpecs.js'")
    })

    it(`${p} 不再硬写字段清单`, () => {
      const src = read(p)
      // 旧写法长这样：store_code - 门店编号
      expect(src, `${p} 又出现「列名 - 中文名」的手写清单`).not.toMatch(/\bstore_area\s*-\s*门店面积/)
      expect(src).not.toMatch(/门店编号,门店名称,年份/)
    })
  }

  it('DataView 的门店模板不再硬写列名串', () => {
    const src = read('frontend/src/views/DataView.vue')
    expect(src).not.toContain('store_code,brand,name,store_type')
    expect(src).toContain('downloadStoreTemplate')
  })

  it('销售模板不允许前端另造 xlsx（必须走后端 /api/store-sales/template）', () => {
    const src = read('frontend/src/utils/importTemplates.js')
    expect(src).toContain('/api/store-sales/template')
    expect(src).toContain('authHeaders')
    // 🔴 token 只能取 sessionStorage（与 api.js / authHeaders 一致），⛔ 不回退 localStorage
    expect(src).not.toContain('localStorage')
  })
})
