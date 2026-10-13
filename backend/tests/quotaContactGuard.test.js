/**
 * 联通配额「采购引导」守卫（v1.13.217 立 · 批次 217 P0）
 *
 * 立档背景（2026-10-13 只读取证 + 实施期补查）：
 *   「配额不足」的提示文案散在 **5 处前端 + 2 处后端**，且已经**出现措辞分叉**——
 *     · SmartstepsPanel.vue:120/435 → 「配额不足，请联系管理员分配配额」
 *     · SiteEvaluationView.vue:51/334 → 「**余额**不足…，请联系管理员分配配额」
 *     · DistrictInsightView.vue（商圈刷新）→ 无本地文案，直接显示后端 message
 *     · quotaGate.js:78-94（后端闸门）→ own 分支「请联系集团管理员分配」／
 *       pool 分支「运营商剩余配额不足」（**两分支都没有采购引导**）
 *     · districts.js:269-272（后端）→ **自己拼了一套**文案（第 6 处拷贝），
 *       且 code 用后端内部 reason（'own_exhausted'）而非 buildGateError 的
 *       'own_quota_exhausted' ⇒ **同一语义两套 code**，前端按 code 分流会漏掉它。
 *   ⇒ 与 v1.13.208（4 份 VIP 门禁拷贝全漏 trial）／v1.13.214（引导入口收敛）
 *     **同构的病根**：同一语义多处硬编码 ⇒ 必然分叉。
 *
 *   ⚠️ 注意：**本批只做「引导」**（文案 + 出口 + code）。配额「够不够」的判据
 *     （checkQuota 闸门）**一行未动** —— 这是本批的硬约束（见设计 §零 决策 2）。
 *
 * 另一个更本质的问题：**pool_exhausted 与 own_exhausted 被混成同一句话**。
 *   前者＝「平台没货了」（用户买也没用，只能我方补上游额度），后者＝「你没额度了」（可采购）。
 *   混在一起会出现「平台池空时用户去找人买、买了也调不动」——白跑一趟还会怀疑系统坏了。
 *
 * 修法（v1.13.217 P0）：抽 `frontend/src/utils/quotaContact.js::requireQuota(reason, ctx)` 单一入口，
 *   文案与对外联系方式集中在 `QUOTA_CONTACT`；调用点只传 reason（QUOTA_REASON.OWN / POOL）。
 *
 * 本文件是**回归钉子**：
 *   ① 单一入口被删、或导出缺项 → 红
 *   ② 单一入口把 `@/router` 改成**静态** import（214 的打包铁律）→ 红
 *   ③ 6 处调用点任何一处退回就地 `ElMessage` 拦截 → 红
 *   ④ 旧文案「请联系管理员分配配额」等回归 → 红
 *   ⑤ 对外联系方式被就地硬编码到单一入口之外 → 红
 *   ⑥ 后端 `buildGateError` 丢掉 `code`、或 pool 分支退回旧文案 → 红
 *   ⑦ 守卫自身自检（防「正则扫源码」被注释/字符串骗到 —— 211 教训）→ 红
 *   ⑧ 两个「按钮会被静默禁用」的弹窗丢掉**内联引导** → 红（实施期补遗，见 CALL_SITES 注释）
 *
 * ⚠️ 为什么不写「余额不足」四个字做断言：DataSyncView.vue:1276 有一句
 *   `可分配余额不足：当前可分配 N 次`（**集团配额**语义，与本功能无关）。
 *   用「余额不足」会把无关代码判红 ⇒ 本守卫只断言**精确到整句**的旧文案。
 *
 * （前端无独立测试框架，故与 vipGateGuard / vipGateGuideGuard 一致，挂在 backend 的 vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * 仓库根（backend/ 的上一级）。
 * ⚠️ 必须用 fileURLToPath 而不是 `new URL(...).pathname` —— 本项目路径含中文与空格，
 *    pathname 会留下百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src')
const UTIL_REL = 'utils/quotaContact.js'
const UTIL = path.join(FRONTEND_SRC, UTIL_REL)
const GATE_REL = 'backend/src/utils/quotaGate.js'
const GATE = path.join(REPO_ROOT, GATE_REL)

/**
 * 纳管的调用点（相对 frontend/src）。
 * `minCalls` = 该文件应出现的 `requireQuota(` 次数下限：
 *   · 有「行内入口」的页面 → 行内 handler + 预检 + catch 分流 = 3
 *   · 只有「发起请求」的页面 → 预检/行内 + catch 分流 = 2
 *   · 只有 catch 分流的页面（商圈刷新：无本地预检）→ 1
 * ⚠️ DistrictInsightView 是**实施期新发现**的第 5 个入口（设计取证时漏了它），
 *    它原先沿用后端内部 reason 作 code（'own_exhausted'），与 buildGateError 的
 *    'own_quota_exhausted' 不一致 ⇒ 同一语义两套 code。本批一并纠正，故纳入纳管。
 */
const CALL_SITES = [
  { file: 'components/SmartstepsPanel.vue', minCalls: 3 },
  { file: 'views/SiteEvaluationView.vue', minCalls: 3 },
  { file: 'views/DistrictInsightView.vue', minCalls: 1 },
  // ⚠️ 以下两处同样是**实施期才发现**的活入口（设计 §1.2 只列了 5 处，取证漏了它们）：
  //    两个弹窗的查询/购买按钮都是 `:disabled="!canQuery"`，而 canQuery 含 `available > 0`
  //    ⇒ 配额为 0 时按钮**静默禁用、无任何解释**，用户根本不知道下一步该做什么。
  //    原先只有 handler 里一句兜底提示（且因按钮已禁用而**实际不可达**）。
  //    ⇒ 补「内联引导」（复用 QUOTA_INLINE）+ handler 收敛。
  { file: 'components/BatchSmartstepsDialog.vue', minCalls: 2 },
  { file: 'components/StoreSmartstepsDialog.vue', minCalls: 3 },
]

/** 对外商务联系方式（单一来源：utils/quotaContact.js::QUOTA_CONTACT） */
const CONTACT = {
  name: '徐经理',
  phone: '138 1779 1741',
  email: 'jyo@youshi-tech.com',
}

/** 必须绝迹的旧文案（精确到整句，避免误伤 DataSyncView 的「可分配余额不足」） */
const LEGACY_TEXTS = [
  '请联系管理员分配配额',
  '余额不足：剩余次数为 0',
]

/** 递归收集源文件（目录不存在则跳过） */
function collect(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name.startsWith('dist.')) continue
      collect(full, exts, acc)
    } else if (exts.some((e) => ent.name.endsWith(e))) {
      acc.push(full)
    }
  }
  return acc
}

/**
 * 剥离注释后再判 —— 否则「注释里举例说明旧写法」会被当成真违规。
 * 只去整行的 `//`（避免误伤 URL 里的 `//`）、块注释与 Vue 模板注释。
 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

function readOrEmpty(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}

/** 统一成 / 分隔的相对路径，便于报错信息跨平台一致 */
function rel(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/')
}

describe('配额采购引导：文案与联系方式必须收敛到 utils/quotaContact.js 单一入口', () => {
  it('① 单一入口存在，且导出 QUOTA_CONTACT / QUOTA_REASON / requireQuota / 阈值', () => {
    expect(
      fs.existsSync(UTIL),
      `未找到 ${UTIL_REL} —— 4 处配额提示的文案与联系方式应收敛到这一个模块。`
    ).toBe(true)

    const src = stripComments(readOrEmpty(UTIL))

    expect(src, '必须导出 QUOTA_CONTACT（对外商务联系方式的单一来源）').toMatch(
      /export\s+const\s+QUOTA_CONTACT\s*=/
    )
    for (const [k, v] of Object.entries(CONTACT)) {
      expect(src, `QUOTA_CONTACT 必须含 ${k}（值为「${v}」）`).toContain(v)
    }

    expect(src, '必须导出 QUOTA_REASON（OWN / POOL 两个触发原因）').toMatch(
      /export\s+const\s+QUOTA_REASON\s*=/
    )
    expect(src, 'QUOTA_REASON 必须同时含 own_quota_exhausted 与 pool_quota_exhausted').toMatch(
      /own_quota_exhausted/
    )
    expect(src).toMatch(/pool_quota_exhausted/)

    expect(src, '必须导出 requireQuota 供调用点使用').toMatch(
      /(?:export\s+(?:async\s+)?function\s+requireQuota|export\s+const\s+requireQuota)/
    )
    expect(src, '必须导出低额度阈值（软提醒判据）').toMatch(
      /export\s+const\s+QUOTA_WARN_THRESHOLD\s*=/
    )
  })

  it('② requireQuota 用 ElMessageBox 给出口，且 @/router 必须动态 import（214 打包铁律）', () => {
    const src = stripComments(readOrEmpty(UTIL))

    expect(src, '引导须用 ElMessageBox（而非一闪而过的 ElMessage）').toMatch(/ElMessageBox\.(confirm|alert)/)
    expect(src, 'OWN 分支须跳转到个人中心').toMatch(/['"]\/account['"]/)
    expect(src, '须调用 router.push').toMatch(/router\.push\(/)

    // ⚠️ 214 的教训：静态 `import router from '@/router'` 会让 Rollup 把共用 chunk
    //    反向提升进入口，实测把 vendor-maps（53 KB gz）拖进首屏。
    const staticRouterImport = /import\s+router\s+from\s+['"]@\/router['"]/
    expect(
      src,
      "⛔ 不得静态 import '@/router' —— 会触发 Rollup 反向提升（入口静态依赖 6 → 10 个 chunk）。" +
        '必须用动态 import()，见 vipGate.js 文件头「打包约束」。'
    ).not.toMatch(staticRouterImport)
    expect(src, 'router 必须通过动态 import() 延迟加载').toMatch(/import\(\s*['"]@\/router['"]\s*\)/)

    // 取消/关闭会 reject('cancel' / 'close') —— 必须吞掉，否则控制台留 unhandled rejection
    expect(src, 'ElMessageBox 的 reject 必须被 catch 吞掉').toMatch(/catch/)
  })

  it('③ 4 处调用点全部走 requireQuota，且从单一入口 import', () => {
    const problems = []
    for (const { file, minCalls } of CALL_SITES) {
      const p = path.join(FRONTEND_SRC, file)
      if (!fs.existsSync(p)) {
        problems.push(`${file}（文件不存在）`)
        continue
      }
      const src = stripComments(fs.readFileSync(p, 'utf8'))

      if (!/from\s+['"]@\/utils\/quotaContact['"]/.test(src)) {
        problems.push(`${file}（未从 @/utils/quotaContact import）`)
      }
      const calls = (src.match(/requireQuota\s*\(/g) || []).length
      if (calls < minCalls) {
        problems.push(`${file}（requireQuota 调用 ${calls} 次，应 ≥ ${minCalls}：拦截点 + catch 分流）`)
      }
      const reasonKeys = (src.match(/QUOTA_REASON\s*\.\s*(OWN|POOL)/g) || []).length
      if (reasonKeys < 1) {
        problems.push(`${file}（未使用 QUOTA_REASON，可能传了裸字符串）`)
      }
    }
    expect(
      problems,
      `以下调用点未收敛到单一入口：\n${problems.join('\n')}\n` +
        "修法：`if (!(await requireQuota(QUOTA_REASON.OWN, { own, need }))) return`，并在 catch 里按后端 code 分流。"
    ).toEqual([])
  })

  it('④ 旧文案（「请联系管理员分配配额」等）在前端源码中已绝迹', () => {
    const targets = collect(FRONTEND_SRC, ['.vue', '.js'])
    expect(targets.length, '扫描范围异常（防止目录搬迁后守卫静默失效）').toBeGreaterThan(30)

    const hits = []
    for (const f of targets) {
      const src = stripComments(fs.readFileSync(f, 'utf8'))
      src.split('\n').forEach((line, i) => {
        for (const t of LEGACY_TEXTS) {
          if (line.includes(t)) hits.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 140)}`)
        }
      })
    }
    expect(
      hits,
      `发现旧文案（无联系途径 / 「分配」免费语义 / 「余额」与「配额」措辞分叉）：\n` +
        `${hits.join('\n')}\n` +
        '修法：改用 utils/quotaContact.js::requireQuota(...)，文案集中在单一入口。'
    ).toEqual([])

    // ⭐ 反向对照：DataSyncView 的「可分配余额不足」是**集团配额**语义，必须**仍在**
    //   —— 若这条也没了，说明扫描范围写错（例如把整个目录读空了），守卫在骗人。
    const ds = path.join(FRONTEND_SRC, 'views/DataSyncView.vue')
    if (fs.existsSync(ds)) {
      expect(
        stripComments(fs.readFileSync(ds, 'utf8')),
        '反向对照失败：DataSyncView 的「可分配余额不足」（集团配额语义，与本功能无关）不应被本批改动'
      ).toContain('可分配余额不足')
    }
  })

  it('⑤ 对外联系方式只允许出现在单一入口（⛔ 禁止就地硬编码）', () => {
    const targets = collect(FRONTEND_SRC, ['.vue', '.js'])
    expect(targets.length).toBeGreaterThan(30)

    const hits = []
    for (const f of targets) {
      const r = rel(f).replace(/^frontend\/src\//, '')
      if (r === UTIL_REL) continue // 单一入口本身是唯一允许出现的地方
      const src = stripComments(fs.readFileSync(f, 'utf8'))
      for (const [k, v] of Object.entries(CONTACT)) {
        if (src.includes(v)) hits.push(`${r} 就地硬编码了 ${k}「${v}」`)
      }
    }
    expect(
      hits,
      `对外联系方式必须只有一个来源（${UTIL_REL}::QUOTA_CONTACT）：\n${hits.join('\n')}\n` +
        '修法：改为 `import { quotaContactText } from \'@/utils/quotaContact\'` 后渲染。'
    ).toEqual([])
  })

  it('⑥ 后端 buildGateError：两分支都带 code、pool 分支已脱离旧文案，且路由层不得自持文案', () => {
    const src = stripComments(readOrEmpty(GATE))
    expect(src.length, '未读到 quotaGate.js 内容').toBeGreaterThan(200)

    const codeHits = src.match(/\bcode:\s*['"](own_quota_exhausted|pool_quota_exhausted)['"]/g) || []
    expect(
      codeHits.length,
      'buildGateError 的**两个分支**都必须显式给出 code（own_quota_exhausted / pool_quota_exhausted）' +
        '—— 前端据此分流，⛔ 不靠 message 字符串匹配。'
    ).toBe(2)

    expect(src, 'own 分支须保留 code=own_quota_exhausted（quotaGate.test.js:159 有断言）').toMatch(
      /own_quota_exhausted/
    )
    expect(src, "pool 分支须新增 code='pool_quota_exhausted'").toMatch(/pool_quota_exhausted/)

    expect(
      src,
      'pool 分支不得再返回旧的「运营商剩余配额不足」——该文案不含任何可行动指引，' +
        '须改为「平台上游额度已用尽，本项需我方补充上游额度」。'
    ).not.toMatch(/运营商剩余配额不足/)

    // ⭐ 后端**路由层不得自持配额文案** —— 必须走 buildGateError。
    //    否则文案与 code 必然分叉：districts.js:269 原先就是这么分叉的
    //   （code 用了内部 reason 'own_exhausted'，前端按 code 分流会整段漏掉该端点）。
    const routeFiles = collect(path.join(REPO_ROOT, 'backend/src/routes'), ['.js'])
    expect(routeFiles.length, '扫描范围异常（backend/src/routes 读空？）').toBeGreaterThan(0)

    // ⚠️ 明确排除 resale.js：它是**第三方 API 通道**（X-Api-Key、无平台用户身份），
    //    响应体 `{ code: 429, message }` 里的 code 是**数字 HTTP 语义**（对齐状态码），
    //    属**已发布的对外契约**；改成 buildGateError 的字符串 code 会破坏第三方客户端。
    //    ⇒ 它不是「面向浏览器 UI 的引导文案」，不在本守卫的收敛范围内
    //      （若要统一，属对外契约变更，须单独评估 + 通知 API 客户）。
    const API_CONTRACT_FILES = ['backend/src/routes/resale.js']

    const copies = []
    for (const f of routeFiles) {
      const r = rel(f)
      if (API_CONTRACT_FILES.includes(r)) continue
      const s = stripComments(fs.readFileSync(f, 'utf8'))
      if (/请联系集团管理员分配|请联系管理员充值|运营商剩余配额不足/.test(s)) copies.push(r)
    }
    expect(
      copies,
      `以下后端路由**自己拼了配额文案**（第 N 份拷贝）⇒ 文案与 code 必然分叉：\n${copies.join('\n')}\n` +
        '修法：改用 utils/quotaGate.js::buildGateError(gate, { service, ownStatus })。'
    ).toEqual([])
  })

  it('⑧ 活入口的「配额不足」引导必须到位：内联提示来自单一入口，且旧裸提示绝迹', () => {
    // 背景（实施期补查）：这两个弹窗的提交按钮都是 `:disabled="!canQuery || isLoading"`，
    //   而 canQuery 含 `quotaInfo.value?.available > 0` ⇒ **配额为 0 时按钮直接禁用**，
    //   handler 里那句兜底提示**永远显示不出来**。用户看到的是「点不动的按钮 + 无解释」。
    //   ⇒ 必须**内联**一条引导（文案取自单一入口的 QUOTA_INLINE），否则用户无路可走。
    const INLINE_SITES = [
      'components/BatchSmartstepsDialog.vue',
      'components/StoreSmartstepsDialog.vue',
    ]
    const problems = []
    for (const f of INLINE_SITES) {
      const p = path.join(FRONTEND_SRC, f)
      if (!fs.existsSync(p)) {
        problems.push(`${f}（文件不存在）`)
        continue
      }
      const src = stripComments(fs.readFileSync(p, 'utf8'))
      // ⚠️ 必须断言**使用点**（QUOTA_INLINE.prefix / .action），不能只断言 `QUOTA_INLINE`
      //    —— 否则 import 行本身就能满足正则，删掉模板里的引导仍然「绿」（本守卫第 1 版即如此，
      //    被负向验证 M8 抓出）。同 §208「只做字面量匹配＝假绿灯」的教训。
      if (!/QUOTA_INLINE\s*\.\s*prefix/.test(src) || !/QUOTA_INLINE\s*\.\s*action/.test(src)) {
        problems.push(`${f}（未渲染 QUOTA_INLINE 的 prefix/action ⇒ 按钮被禁用时用户看不到任何指引）`)
      }
      if (!/available\s*<=\s*0/.test(src)) {
        problems.push(`${f}（内联引导缺少「剩余次数 ≤ 0」的显示判据）`)
      }
    }
    expect(
      problems,
      `以下活入口的配额引导未到位：\n${problems.join('\n')}\n` +
        '修法：在剩余次数区块内联 `{{ QUOTA_INLINE.prefix }}<el-button @click="onQuotaShortage">{{ QUOTA_INLINE.action }}</el-button>{{ QUOTA_INLINE.suffix }}`。'
    ).toEqual([])

    // 旧「裸提示」必须绝迹：它既无联系方式、也无采购出口（用户读完仍不知下一步）
    const bare = []
    for (const f of INLINE_SITES) {
      const src = stripComments(readOrEmpty(path.join(FRONTEND_SRC, f)))
      src.split('\n').forEach((line, i) => {
        if (line.includes('剩余次数不足！需要') || line.includes('请设置查询参数或检查配额')) {
          bare.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`)
        }
      })
    }
    expect(
      bare,
      `以下位置仍是「裸配额提示」（无联系途径 / 无采购出口）：\n${bare.join('\n')}\n` +
        '修法：改用 utils/quotaContact.js::requireQuota(QUOTA_REASON.OWN, { own, need })。'
    ).toEqual([])
  })

  it('⑦ 守卫自检：stripComments 只剥注释、不吞代码（211 教训）', () => {
    // (a) 合成样例：三种注释写法应被剥掉，真实代码行必须保留 ⇒ 只剩 1 次
    const sample = [
      '// 请联系管理员分配配额',
      '/* 请联系管理员分配配额 */',
      '<!-- 请联系管理员分配配额 -->',
      "const b = '请联系管理员分配配额'",
    ].join('\n')
    expect(
      (stripComments(sample).match(/请联系管理员分配配额/g) || []).length,
      'stripComments 自检失败：注释未被剥净，或把真实代码一起剥掉了'
    ).toBe(1)

    // (b) 真实文件：**代码标记必须存活**。
    //     ⚠️ 刻意不用「剥注释后体积比例」做判据 —— quotaGate.js 的头尾注释本身占了 ~60%，
    //        比例阈值会对「注释多的正常文件」误报（本守卫第 1 版就是这么翻的）。
    //        改为直接盯代码标记：丢了才是真被吃掉。
    const MARKERS = {
      [UTIL]: [/export\s+const\s+QUOTA_CONTACT/, /requireQuota/],
      [GATE]: [/export\s+function\s+checkQuota/, /export\s+function\s+buildGateError/],
      [path.join(FRONTEND_SRC, 'components/SmartstepsPanel.vue')]: [/<script setup>/],
      [path.join(FRONTEND_SRC, 'views/SiteEvaluationView.vue')]: [/<script setup>/],
    }
    const eaten = []
    for (const [f, res] of Object.entries(MARKERS)) {
      if (!fs.existsSync(f)) continue
      const stripped = stripComments(fs.readFileSync(f, 'utf8'))
      for (const re of res) {
        if (!re.test(stripped)) eaten.push(`${rel(f)} 剥离后丢失 ${re}`)
      }
    }
    expect(
      eaten,
      `剥离注释后代码标记消失 ⇒ stripComments 把真代码也吃掉了：\n${eaten.join('\n')}`
    ).toEqual([])

    // (c) 危险模式体检：被扫描文件里**不得**出现「字符串字面量内含 /*」——
    //     那正是 211 翻车的方式（裸正则会从字符串里的 `/*` 一路吃到下一个 `*/`，吞掉中间真代码）。
    //     一旦将来有人这么写，本守卫先红，提示改用更稳的切片方式。
    const risky = []
    for (const f of [UTIL, GATE, ...CALL_SITES.map((c) => path.join(FRONTEND_SRC, c.file))]) {
      if (!fs.existsSync(f)) continue
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/['"`][^'"`\n]*\/\*[^'"`\n]*['"`]/.test(line)) {
          risky.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 120)}`)
        }
      })
    }
    expect(
      risky,
      `以下位置在**字符串字面量**里含 /* ⇒ stripComments 的块注释正则会由此吃到后面的真代码（211 教训）：\n` +
        `${risky.join('\n')}\n修法：改写该字符串，或改用 tokenizer 式剥离。`
    ).toEqual([])
  })
})
