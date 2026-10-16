/**
 * MapView ↔ utils 的「重复实现」守卫（v1.13.233）
 *
 * 背景：MapView.vue 长期存在与 `utils/` 功能重复的局部实现。批次 233 实测并清理了第一批
 * （决策与依据见 `MEMORY_附录_前端约定与运维.md` §6.63）：
 *   · 删 `calculateIntersectionRatio`（41 行，**零引用死代码**；`utils/populationStats.js` 已有活实现）
 *   · `getDistanceFromLatLng` → `utils/map` 的 `calculateDistance`（**逐字等价**）
 *   · `calculatePolygonArea` → `utils/map` 的 `calculateArea`（**公式相同**，仅入参格式不同）
 *   · 随死函数移除 3 个 turf import（turf 是 CJS ⇒ 只要 import 就进 vendor-maps，无法 tree-shake）
 *
 * 本守卫防两件事：
 *   ① 已消除的重复实现 / 死依赖「复活」；
 *   ② 未来新增「与 utils 导出同名的局部定义」—— 这是 §6.63「抽 util 路线」的核心约束。
 *
 * ⚠️⚠️ `stripComments` 的**顺序**：必须先剥**行注释**、再剥**块注释**。
 *   反例（231 批的教训）：先剥块注释时，行注释里出现的「斜杠+星号」会被当成块注释开头，
 *   一路吞到后面真正的「星号+斜杠」⇒ 静默吃掉大段真实代码，导致断言假红/假绿。
 *   ⚠️ 另：**本文件自身就踩过这条** —— 初版在注释里写出字面的「星号+斜杠」，
 *      直接提前终止了块注释、其后的注释文字变成非法代码（vite 报 invalid JS syntax）。
 *   故本文件同时带 ④ 体积自检（剥后不得低于 60%）作兜底。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '../..')

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')   // ← 必须先剥行注释
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 提取 `export function NAME` / `export const NAME` 的名字 */
function exportedNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of src.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  return names
}

/**
 * 已知「未处理」的重复 —— 均因**接口不兼容**或 utils 版更完整而**刻意保留**（§6.63.3）。
 * ⛔ 不得把新发现的重复直接加进本白名单；必须先判定属于「等价」还是「不等价」。
 */
const KNOWN_PENDING = new Map([
  ['isPolygonIntersectsCircle', 'utils 版更完整（处理 geom.type）；MapView 版 31 行 vs utils 67 行'],
  ['isPointInPolygon', '接口不兼容：MapView (x,y,ring) vs utils (point,polygon)'],
  ['isPointInCircle', '接口不兼容：MapView 5 参 vs utils 3 参'],
])

/** 批次 233 已消除项 —— 不得复活 */
const REMOVED_LOCALS = ['calculateIntersectionRatio', 'calculatePolygonArea', 'getDistanceFromLatLng']
const REMOVED_TURF_IMPORTS = ['@turf/area', '@turf/circle', '@turf/intersect']

const MV = 'frontend/src/views/MapView.vue'
const UTIL_FILES = ['frontend/src/utils/map.js', 'frontend/src/utils/populationStats.js']

describe('MapView：不得重复实现 utils 已有逻辑（v1.13.233 起）', () => {
  const mvRaw = read(MV)
  const mv = stripComments(mvRaw)

  it('① 批次 233 移除的本地实现不得复活', () => {
    const alive = REMOVED_LOCALS.filter((n) => new RegExp('^const\\s+' + n + '\\s*=', 'm').test(mv))
    expect(
      alive,
      `以下实现已于 v1.13.233 消除（改用 utils 单一实现），不得再在 MapView 内定义：${alive.join(', ')}`
    ).toEqual([])
  })

  it('② 随死函数移除的 turf 依赖不得重新引入（CJS 无法 tree-shake ⇒ 会直接进 vendor-maps）', () => {
    const back = REMOVED_TURF_IMPORTS.filter((p) => srcHasImport(mvRaw, p))
    expect(back, `以下 turf 包已于 v1.13.233 随死函数移除，不得重新 import：${back.join(', ')}`).toEqual([])
  })

  it('③ MapView 不得本地定义与 utils 导出同名的函数（已知未处理项除外）', () => {
    const utilNames = new Set()
    for (const f of UTIL_FILES) exportedNames(read(f)).forEach((n) => utilNames.add(n))
    expect(utilNames.size, '未从 utils 解析出任何导出名 —— 解析失效，本断言会变成假绿灯').toBeGreaterThan(10)

    const dupes = []
    for (const n of utilNames) {
      if (KNOWN_PENDING.has(n)) continue
      if (new RegExp('^const\\s+' + n + '\\s*=', 'm').test(mv)) dupes.push(n)
    }
    expect(
      dupes,
      `检测到与 utils 重复的本地实现：${dupes.join(', ')}。\n` +
      `  ⇒ 处置：若与 utils 版**等价**则改 import 并删除本地副本；若**不等价**，\n` +
      `     须先判定差异（§6.63.3「同名 ≠ 等价」），再决定消重或加入 KNOWN_PENDING（附理由）。`
    ).toEqual([])
  })

  it('④ stripComments 自检：剥后体积不得低于原始 60%（防「静默吃代码」）', () => {
    const ratio = mv.length / mvRaw.length
    expect(
      ratio,
      `${MV} 剥注释后仅剩 ${(ratio * 100).toFixed(1)}% —— 极可能是块注释正则吞掉了真实代码（231 教训）`
    ).toBeGreaterThan(0.6)
  })

  it('⑤ 白名单自查：每个 KNOWN_PENDING 条目必须**确实**重复（防白名单空挂）', () => {
    const utilNames = new Set()
    for (const f of UTIL_FILES) exportedNames(read(f)).forEach((n) => utilNames.add(n))
    const stale = []
    for (const [n, why] of KNOWN_PENDING) {
      if (!utilNames.has(n)) stale.push(`${n}（utils 中已无此导出 ⇒ 白名单过期）`)
      else if (!new RegExp('^const\\s+' + n + '\\s*=', 'm').test(mv)) stale.push(`${n}（MapView 中已无本地实现 ⇒ 可移出白名单）`)
      else if (!why) stale.push(`${n}（缺理由）`)
    }
    expect(stale, `白名单条目失效：${stale.join('；')}`).toEqual([])
  })
})

/** 判断源码中是否存在指定包的 import（含 `import x from 'pkg'` 与 `import { a } from 'pkg'`） */
function srcHasImport(src, pkg) {
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp("^import\\s[^\\n]*from\\s+'" + esc + "'", 'm').test(src)
}
