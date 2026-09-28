/**
 * admin 销售读权收窄守卫（v1.13.186）
 *
 * 背景：客户普遍不愿把「自家门店营业额」录进第三方平台（属公司保密信息）。
 * 但审计发现，**真正把销售数据暴露给平台侧的，是我们自己的一行代码**：
 *   routes/store-sales.js 的 GET / 原本是
 *     if (!(all === '1' && req.user.role === 'admin')) { conds.push('user_id = ?') }
 *   ⇒ 平台管理员带 `?all=1` 就能读到**全部客户**的销售明细（含金额）。
 *   这与 `utils/visibleScope.js` 自己写下的原则直接冲突：
 *     「admin 是平台运维角色，放开等于让平台能读所有客户的付费数据，
 *       与数据隐私最高优先级冲突」
 *
 * 同一扇门还有第二条缝：GET /stores/:storeId/history 只判「admin 放行」，
 *   平台侧可逐店读明文金额 ⇒ 一并收窄。
 *
 * 用户拍板：**只留聚合、不出金额**。本文件是回归钉子：
 *   ① 凡「平台侧看销售」的入口只回答「有多少」，绝不回答「是多少」
 *   ② ⛔ 不许为了留痕去写审计表（本项目每次 saveNow() 是整库写盘 160MB+，
 *      为一行日志付这个代价会拖垮 2C 小机）⇒ 留痕只走 pm2 日志
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/** ⚠️ 用 fileURLToPath，不用 new URL().pathname（本项目路径含中文与空格） */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC = fs.readFileSync(
  path.join(REPO_ROOT, 'backend/src/routes/store-sales.js'), 'utf8'
)

/** 从函数签名处按大括号配平截出函数体（与 destructiveActionConfirmGuard 同一手法） */
function extractFnBody(src, signature) {
  const start = src.indexOf(signature)
  if (start === -1) return null
  const braceStart = src.indexOf('{', start)
  if (braceStart === -1) return null
  let depth = 0
  for (let i = braceStart; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(braceStart, i + 1)
    }
  }
  return null
}

describe('admin `?all=1` 收窄为「只聚合、不出金额」', () => {
  it('① 聚合分支存在，且在明细查询之前就 return', () => {
    const i = SRC.indexOf("if (all === '1' && req.user.role === 'admin')")
    expect(i).toBeGreaterThan(-1)
    const seg = SRC.slice(i, i + 400)
    expect(seg).toMatch(/buildSalesAggregate\(db\)/)
    expect(seg).toMatch(/return res\.json/)

    const detailIdx = SRC.indexOf('SELECT * FROM store_sales')
    expect(detailIdx).toBeGreaterThan(-1)
    // 按顺序数下来：明细查询在「本人」分支里，admin 分支必须排在它前面
    expect(i).toBeLessThan(detailIdx)
  })

  it('② 聚合函数体内绝不出现 sales_amount（连 SUM/AVG 都不行）', () => {
    const body = extractFnBody(SRC, 'function buildSalesAggregate(db)')
    expect(body).toBeTruthy()
    expect(body).not.toMatch(/sales_amount/)
    // 金额聚合（SUM/AVG/MAX/MIN 作用在 sales_amount 上）同样禁止。
    // ⚠️ 但 `SUM(CASE WHEN sales_band IS NOT NULL ...)` 是**计数**、不是金额 ⇒ 允许，
    //    所以这里必须精确匹配「聚合函数 + sales_amount」，不能粗暴地禁掉 SUM(。
    expect(body).not.toMatch(/(SUM|AVG|MAX|MIN)\(\s*sales_amount/i)
    expect(body).not.toMatch(/\bsales:/)
  })

  it('③ 聚合返回的字段只有「计数/覆盖率」，没有金额口径', () => {
    const body = extractFnBody(SRC, 'function buildSalesAggregate(db)')
    // 正向：应有的计数字段（防止有人把整个函数清空也算通过）
    for (const k of ['records', 'accounts', 'stores', 'coverage']) {
      expect(body).toMatch(new RegExp(`${k}\\s*:`))
    }
    for (const k of ['amount', 'salesAmount', 'totalSales', 'sumSales']) {
      expect(body).not.toMatch(new RegExp(k))
    }
  })

  it('④ 旧的「admin 直接读全量明细」分支已彻底消失', () => {
    expect(SRC).not.toMatch(/if \(!\(all === '1' && req\.user\.role === 'admin'\)\)/)
    // 本人分支现在无条件按 user_id 过滤
    expect(SRC).toMatch(/conds\.push\('user_id = \?'\)/)
  })
})

describe('/stores/:storeId/history 的同一扇门第二条缝', () => {
  it('⑤ admin 查非自己名下门店时提前返回 restricted，且金额字段为 null', () => {
    const i = SRC.indexOf('admin 查阅他店历史被收窄')
    expect(i).toBeGreaterThan(-1)
    const seg = SRC.slice(i, i + 600)
    expect(seg).toMatch(/restricted: true/)
    expect(seg).toMatch(/yearTotal: null/)
    expect(seg).toMatch(/series: \[\]/)
    expect(seg).toMatch(/annual: null/)
    expect(seg).toMatch(/recordCount/)
  })

  it('⑥ restricted 分支必须排在明细查询之前（否则照样查了明文金额）', () => {
    const restrictedIdx = SRC.indexOf('admin 查阅他店历史被收窄')
    const selectIdx = SRC.indexOf('SELECT year, month, sales_amount')
    expect(restrictedIdx).toBeGreaterThan(-1)
    expect(selectIdx).toBeGreaterThan(-1)
    expect(restrictedIdx).toBeLessThan(selectIdx)
  })
})

describe('留痕方式：走日志，不落表', () => {
  it('⑦ 两处收窄都写审计日志', () => {
    const hits = SRC.match(/\[audit\]\[store-sales\]/g) || []
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })

  it('⑧ ⛔ 不为留痕新增审计表写入（saveNow 是整库写盘）', () => {
    expect(SRC).not.toMatch(/INSERT INTO \w*audit/i)
    expect(SRC).not.toMatch(/CREATE TABLE/i)
  })
})

describe('档位字段贯通（写入 → 读取 → 展示）', () => {
  it('⑨ 列表/历史/年度的查询都带出 sales_band', () => {
    expect(SRC).toMatch(/sales_amount, store_area, delivery_ratio, customer_count, sales_band/)
    expect(SRC).toMatch(/band: hit \? \(hit\.sales_band \|\| null\) : null/)
    expect(SRC).toMatch(/band: latestAnnual\.sales_band \|\| null/)
  })

  it('⑩ Excel 模板含「销售档位」列并说明填了档位就忽略销售额', () => {
    expect(SRC).toMatch(/'销售档位'/)
    expect(SRC).toMatch(/填了档位则忽略「年销售额」/)
  })
})
