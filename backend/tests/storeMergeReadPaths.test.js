/**
 * 守卫：所有读取 markers 的 SQL 必须显式排除已合并行（v1.13.284）
 *
 * 背景：门店合并是**软删**（只写 merged_into，不删行）⇒ 撤销才能做。
 * 代价是任何漏加 `merged_into IS NULL` 的统计/分析查询都会把重复门店再算一遍，
 * 而**这种错不会报错**，只表现为数字偏高（实测量级 6%）。
 *
 * 本守卫做的事：扫描 src/ 下所有 JS 里的 SQL 字面量，凡出现 `FROM markers` /
 * `JOIN markers` 的，必须含 `merged_into IS NULL`；否则必须在白名单里、且写明原因。
 *
 * ⚠️ 这是**字面量守卫**（与 vipGateGuard 同类）：靠字符串匹配，不是语法分析。
 *    如果有人把条件拼进变量（`${NOT_MERGED}`）或写成 `WHERE merged_into IS NULL` 的
 *    等价表达式，本守卫会**误报**（这是安全的失败方向，改白名单即可），但也存在
 *    「把断言改成永远通过」就能骗过的可能 ⇒ 白名单变更请连同原因一起 review。
 *    ✅ 仍然能挡住绝大多数真实退化：复制一段查询时漏掉条件、新写查询时忘了加。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '../src')

/** 递归收集 .js 文件 */
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

/**
 * 抽出 JS 源码里的字符串/模板字面量，**并跳过注释**。
 *
 * ⚠️ 必须先剥注释：注释里常引用 SQL 片段（如 districts.js 讲解旧实现时写了
 *    `` `FROM markers` ``），不剥会把注释当成真查询 ⇒ 假红。
 *    （同类教训见 vipGateGuard：裸正则扫源码会被注释/字符串里的片段骗到。）
 *
 * 用字符状态机而不是正则：能正确处理转义与三种引号，零依赖。
 */
function extractLiterals(code) {
  const out = []
  const n = code.length
  let i = 0
  let line = 1
  while (i < n) {
    const ch = code[i]
    if (ch === '\n') { line += 1; i += 1; continue }
    // 行注释
    if (ch === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i += 1
      continue
    }
    // 块注释
    if (ch === '/' && code[i + 1] === '*') {
      i += 2
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') line += 1
        i += 1
      }
      i += 2
      continue
    }
    if (ch === '`' || ch === "'" || ch === '"') {
      const quote = ch
      const startLine = line
      let j = i + 1
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue }
        if (code[j] === '\n') line += 1
        if (code[j] === quote) break
        j += 1
      }
      out.push({ text: code.slice(i, Math.min(j + 1, n)), line: startLine })
      i = j + 1
      continue
    }
    i += 1
  }
  return out
}

const MARKERS_RE = /\b(?:FROM|JOIN)\s+markers\b/i
const MERGED_RE = /merged_into\s+IS\s+NULL/i
// DELETE / UPDATE 不受影响（软删行仍要能被删掉、被撤销），只查读取
const WRITE_ONLY_RE = /^\s*`?\s*DELETE\s+FROM\s+markers/i

/**
 * 白名单：**必须**不加 `merged_into IS NULL` 的地方。加了才是 bug。
 * 每条都必须被真实命中一次（防止白名单腐烂），命中数 ≥1 即通过。
 */
const ALLOW = [
  // ---- 合并/撤销本身的读：必须看得见已合并行，否则撤销不了 ----
  { file: 'routes/markers.js', snippet: 'latitude, merged_into', reason: '合并校验需读被合并行的 merged_into 状态' },
  { file: 'routes/markers.js', snippet: 'name, merged_into FROM markers', reason: '撤销合并需按 id 读已合并行' },

  // ---- 单行读写：按 id 精确操作，过滤会导致「看不见 → 改不了/撤销不了」 ----
  { file: 'routes/markers.js', snippet: 'FROM markers WHERE id = ?', reason: '单行读取/更新/删除按 id 定位，必须能看到软删行' },
  { file: 'routes/sales-forecast.js', snippet: 'SELECT * FROM markers WHERE id = ?', reason: '候选店上下文/预测按 id 取单行' },
  { file: 'routes/store-sales.js', snippet: 'FROM markers WHERE id = ?', reason: '录销售前按 id 校验门店归属' },
  { file: 'routes/purchase-import.js', snippet: 'WHERE name = ? AND (user_id = ? OR user_id IS NULL)', reason: '按门店名回填坐标，需与历史导入行对齐' },
  { file: 'routes/purchase.js', snippet: 'LEFT JOIN markers', reason: '按门店名关联购买记录；过滤会让已合并门店的购买记录失去关联（记录本身没删）' },
  { file: 'routes/brand-icons.js', snippet: 'SELECT DISTINCT brand FROM markers', reason: '品牌归属校验属权限判定，宜宽不宜严（软删行仍属该账号）' },
  { file: 'utils/scopeGuard.js', snippet: 'SELECT city FROM markers', reason: '管辖范围判定：软删行仍属该账号，城市归属不变' },

  // ---- 硬删除 / 同步清理：必须覆盖软删行，否则留下永久垃圾 ----
  { file: 'routes/markers.js', snippet: 'DELETE FROM markers', reason: '删除要覆盖软删行（含「清空门店」与批量删除）' },
  { file: 'routes/markers.js', snippet: 'AND sync_readonly = 1', reason: '清空门店时统计只读行，口径须与 DELETE 一致' },
  { file: 'routes/orgs.js', snippet: 'origin_user_id', reason: '集团解绑/解散的影响面统计与清理，计数必须等于实际删除条数' },
  { file: 'utils/syncCore.js', snippet: 'updated_at > ?', reason: '回滚前检查指定 id 行是否被编辑，按 id 精确判断' },

  // ---- 只做版本签名 / 启动日志，不对外展示业务数字 ----
  { file: 'routes/dashboard.js', snippet: '(SELECT COUNT(*) FROM markers) ||', reason: '仪表盘缓存版本签名：MAX(updated_at) 已随合并变化，COUNT 只作附加扰动' },
  { file: 'routes/districts.js', snippet: 'MAX(updated_at) FROM markers', reason: '商圈计数缓存的版本号，不参与业务统计' },
  { file: 'models/database.js', snippet: 'COUNT(*) as count FROM markers', reason: '启动时打印门店总数日志' },
]

describe('门店合并：读路径必须排除已合并行', () => {
  const files = walk(SRC)
  const violations = []
  const allowHit = new Map()

  for (const abs of files) {
    const rel = path.relative(SRC, abs).split(path.sep).join('/')
    const code = fs.readFileSync(abs, 'utf8')
    for (const lit of extractLiterals(code)) {
      if (!MARKERS_RE.test(lit.text)) continue
      if (MERGED_RE.test(lit.text)) continue
      if (WRITE_ONLY_RE.test(lit.text)) continue

      const hit = ALLOW.find((a) => a.file === rel && lit.text.includes(a.snippet))
      if (hit) {
        allowHit.set(hit, (allowHit.get(hit) || 0) + 1)
        continue
      }
      violations.push(`${rel}:${lit.line}  ${lit.text.replace(/\s+/g, ' ').slice(0, 120)}`)
    }
  }

  it('没有漏加 merged_into IS NULL 的读取', () => {
    expect(violations, `以下查询会统计到已合并的门店：\n${violations.join('\n')}`).toEqual([])
  })

  it('白名单没有腐烂（每条都仍被真实命中）', () => {
    const stale = ALLOW.filter((a) => !allowHit.has(a))
    expect(
      stale.map((a) => `${a.file} :: ${a.snippet}`),
      '这些白名单已不再匹配任何查询（代码改过？）⇒ 请删掉，别让它成为后门'
    ).toEqual([])
  })

  it('扫描有效：至少识别到若干 markers 查询（防止正则写坏后永远通过）', () => {
    let n = 0
    for (const abs of files) {
      const code = fs.readFileSync(abs, 'utf8')
      for (const lit of extractLiterals(code)) if (MARKERS_RE.test(lit.text)) n += 1
    }
    expect(n, '一条 markers 查询都没扫到 ⇒ 提取器失效，本守卫是假绿灯').toBeGreaterThanOrEqual(25)
  })
})

/**
 * 缓存指纹守卫（v1.13.284 实测踩到）
 *
 * 合并是「行数不变 + 只改 merged_into/updated_at」，而 updated_at 是
 * `datetime('now')` 秒级精度 ⇒ **同一秒内**撤销再合并时，两个指纹函数都完全相同，
 * 直接命中旧缓存 ⇒ 页面继续显示合并前的门店数（本地实测：合并后大屏仍是 10，应为 9）。
 *
 * 修法：两个指纹都追加「已合并行数」，它随每次合并/撤销确定性变化。
 * 本守卫钉住，「以后谁把这半截删掉」会立刻红。
 */
describe('缓存指纹：必须包含已合并行数', () => {
  const cases = [
    { file: 'routes/dashboard.js', fn: 'dashboardDataVersion' },
    { file: 'routes/districts.js', fn: 'storeDataVersion' }
  ]
  for (const c of cases) {
    it(`${c.fn} 的指纹含 merged_into IS NOT NULL 计数`, () => {
      const code = fs.readFileSync(path.join(SRC, c.file), 'utf8')
      const start = code.indexOf(`function ${c.fn}`)
      expect(start, `未找到 ${c.fn}`).toBeGreaterThan(-1)
      const body = code.slice(start, start + 1200)
      expect(
        /COUNT\(\*\)\s+FROM\s+markers\s+WHERE\s+merged_into\s+IS\s+NOT\s+NULL/i.test(body),
        `${c.fn} 未统计已合并行 ⇒ 同一秒内合并/撤销会命中旧缓存，显示合并前的数字`
      ).toBe(true)
    })
  }
})
