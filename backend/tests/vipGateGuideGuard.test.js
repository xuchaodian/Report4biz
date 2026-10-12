/**
 * VIP 门禁「引导入口」守卫（v1.13.214 立）
 *
 * 背景（2026-10-12 只读审计 §17）：
 *   全站 5 个 VIP 门禁点里，**只有「销售预测」**做了引导（SalesForecastView 的
 *   `.fc-locked` 锁定卡 + 按钮「前往个人中心申请试用」→ `/account`）；
 *   其余 3 个功能（AI 选址建议 / 开店余地 / 网点优化，共 4 处调用点）**只弹一句**
 *   `ElMessage.warning('…为 VIP 用户专属功能，请联系管理员开通 VIP')` ——
 *   文案还是 **v1.13.205 之前**的老流程。
 *
 * 问题所在不是「没做引导」，而是 **v1.13.205 上线自助申请后，这 4 处文案/入口没跟着同步**：
 *   205 已支持普通用户在个人中心自助提交（「体验 VIP 用户」→ 填表 → 管理员审核 → 30 天试用），
 *   这 4 处却仍把用户往「找管理员」这条人工渠道引 ⇒ 同一站点两套话术、自相矛盾。
 *
 * 修法（v1.13.214，选项 A）：抽 `frontend/src/utils/vipGate.js::requireVip(key)` 单一入口——
 *   · 判据复用 `userStore.isVipActive`（**不自持角色白名单**，避免第 2 份拷贝分叉）；
 *   · 拦截时用 `ElMessageBox.confirm` 给出「前往个人中心申请」按钮 → `router.push('/account')`；
 *   · 已在 `/account` 时**不再跳转**（跳自己＝无操作），改为就地指路；
 *   · 功能展示名集中在该模块的 `VIP_FEATURE_LABELS`，调用点只传 key。
 *
 * ⚠️ 为什么必须收敛：**同一形态的门禁此前已分叉过一次**（v1.13.208 的
 *   「四个拷贝全漏 trial」）——正是 tests/vipGateGuard.test.js 的立档原因。
 *   本次若不收敛，4 份提示文案同样会各自漂移。
 *
 * 本文件是**回归钉子**：
 *   ① 谁再就地写 `ElMessage.warning('…请联系管理员…')` → 立刻红；
 *   ② 单一入口自持角色白名单（而非走 isVipActive） → 立刻红；
 *   ③ 调用点写了一个没登记的 key（文案会渲染成 undefined） → 立刻红。
 * （前端无独立测试框架，故与 vipGateGuard.test.js 一致，挂在 backend 的 vitest 下。）
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
const GATE_UTIL_REL = 'utils/vipGate.js'
const GATE_UTIL = path.join(FRONTEND_SRC, GATE_UTIL_REL)

/** 需要纳管的调用点（相对 frontend/src）：key 必须是该调用点真正传入的那个 */
const CALL_SITES = [
  { file: 'components/StoreSmartstepsDialog.vue', key: 'aiAdvice' },
  { file: 'components/map/BusinessCirclePanel.vue', key: 'openingRoom' },
  { file: 'components/map/StoreControlPanel.vue', key: 'storeCircles' },
  { file: 'views/MyAccountView.vue', key: 'aiAdvice' },
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

describe('VIP 门禁引导：文案与跳转必须收敛到 utils/vipGate.js 单一入口', () => {
  it('① 单一入口存在，且走 isVipActive 判据、不自持角色白名单', () => {
    expect(
      fs.existsSync(GATE_UTIL),
      `未找到 ${GATE_UTIL_REL} —— 4 处门禁的提示文案与跳转应收敛到这一个模块。`
    ).toBe(true)

    const src = stripComments(readOrEmpty(GATE_UTIL))
    expect(src, '单一入口必须复用 stores/user.js 的 isVipActive（同口径）').toMatch(/isVipActive/)

    // 自持白名单 = 第 2 份拷贝 ⇒ 必然再次分叉（208 的教训）。
    // 只查带引号的角色字面量，不会误伤 VIP_FEATURE_LABELS 这类标识符。
    const roles = src.match(/['"](vip|trial|admin)['"]/g) || []
    expect(
      roles,
      `单一入口出现了角色字面量 ${JSON.stringify(roles)} —— 判据必须由 stores/user.js::isVipActive 持有，` +
        '⛔ 不得在此复制一份白名单（多处拷贝必然分叉，见 vipGateGuard.test.js 的立档背景）。'
    ).toEqual([])
  })

  it('② 单一入口提供 requireVip，且含「前往个人中心」确认与 /account 跳转', () => {
    const src = stripComments(readOrEmpty(GATE_UTIL))
    expect(src, '必须导出 requireVip 供调用点使用').toMatch(/(?:export\s+(?:async\s+)?function\s+requireVip|export\s+const\s+requireVip)/)
    expect(src, '拦截提示须用 ElMessageBox 确认框（而非一闪而过的 ElMessage）').toMatch(/ElMessageBox\.confirm/)
    expect(src, '须跳转到个人中心').toMatch(/['"]\/account['"]/)
    expect(src, '须调用 router.push').toMatch(/router\.push\(/)
    // 取消/关闭会 reject('cancel' / 'close') —— 必须吞掉，否则控制台留 unhandled rejection
    expect(src, 'ElMessageBox 的 reject 必须被 catch 吞掉').toMatch(/catch/)
  })

  it('③ 4 个调用点全部走 requireVip(对应 key)，且已无就地 ElMessage 拦截', () => {
    const problems = []
    for (const { file, key } of CALL_SITES) {
      const p = path.join(FRONTEND_SRC, file)
      if (!fs.existsSync(p)) {
        problems.push(`${file}（文件不存在）`)
        continue
      }
      const src = stripComments(fs.readFileSync(p, 'utf8'))
      const re = new RegExp("requireVip\\(\\s*'" + key + "'")
      if (!re.test(src)) problems.push(`${file}（未调用 requireVip('${key}')）`)
    }
    expect(
      problems,
      `以下调用点未收敛到单一入口：\n${problems.join('\n')}\n` +
        '修法：`if (!(await requireVip(\'<key>\'))) return`，并把 handler 改为 async。'
    ).toEqual([])
  })

  it('④ 旧文案「请联系管理员开通 VIP」在全站前端源码中已绝迹', () => {
    const targets = collect(FRONTEND_SRC, ['.vue', '.js'])
    expect(targets.length, '扫描范围异常（防止目录搬迁后守卫静默失效）').toBeGreaterThan(30)

    const hits = []
    for (const f of targets) {
      const src = stripComments(fs.readFileSync(f, 'utf8'))
      src.split('\n').forEach((line, i) => {
        if (line.includes('请联系管理员开通 VIP')) {
          hits.push(`${path.relative(REPO_ROOT, f)}:${i + 1}: ${line.trim().slice(0, 140)}`)
        }
      })
    }
    expect(
      hits,
      `发现 v1.13.205 之前的旧流程文案（让人去「找管理员」，与自助申请入口自相矛盾）：\n` +
        `${hits.join('\n')}\n` +
        '修法：改用 utils/vipGate.js::requireVip(key)，拦截时引导「前往个人中心申请」。'
    ).toEqual([])
  })

  it('⑤ 调用点使用的 key 必须在 VIP_FEATURE_LABELS 登记（防文案渲染成 undefined）', () => {
    const utilSrc = stripComments(readOrEmpty(GATE_UTIL))
    const block = utilSrc.match(/VIP_FEATURE_LABELS\s*=\s*\{([\s\S]*?)\}/)
    expect(block, '未找到 VIP_FEATURE_LABELS 登记表').toBeTruthy()
    const declared = new Set()
    for (const m of block[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) declared.add(m[1])
    expect(declared.size, '登记表为空').toBeGreaterThan(0)

    // 全站实际用到的 key（不止 CALL_SITES：将来新增门禁也应在此自动纳管）
    const used = new Map()
    for (const f of collect(FRONTEND_SRC, ['.vue', '.js'])) {
      const src = stripComments(fs.readFileSync(f, 'utf8'))
      for (const m of src.matchAll(/requireVip\(\s*'([A-Za-z_$][\w$]*)'/g)) {
        if (!used.has(m[1])) used.set(m[1], path.relative(REPO_ROOT, f))
      }
    }
    expect(used.size, '全站没有任何 requireVip 调用点').toBeGreaterThan(0)

    const missing = [...used.entries()]
      .filter(([k]) => !declared.has(k))
      .map(([k, f]) => `${k}（首次出现于 ${f}）`)
    expect(
      missing,
      `以下 key 未在 VIP_FEATURE_LABELS 登记 ⇒ 拦截提示会显示成「该功能」：\n${missing.join('\n')}\n` +
        `已登记：${[...declared].join(', ')}`
    ).toEqual([])
  })
})
