/**
 * 初步分析「本次分析半径」档位守卫（批次 402）
 *
 * ── 为什么加 5km ────────────────────────────────────────────────────────
 * 业主 2026-11-23：「初步分析页面右上角『本次分析半径』的下拉列表里增加 5km」。
 * 5km 不是随手加的第四/五档：它正好是联通 1001 的**最大档**（`UNICOM_REPORT_RADII`
 * 上界），而**立项报告的半径选项里本来就有 5000**（`CandidateReport.RADIUS_OPTIONS`）。
 * 初步分析最长只给到 3km ⇒ 「能买的档在初步分析里选不到」，5km 的立项报告也没法
 * 从初步分析直接生成。补上之后 `pickUnicomRadius(5000)` 是 exact，升级面板写
 * 「与本次报告口径一致（5km）」，不再有「按 3km 取、范围小于本报告」的折损文案。
 *
 * ── 守什么 ──────────────────────────────────────────────────────────────
 *   ① 5km 必须在档位里（业主明确要求，防止后续"清理一下"又删掉）
 *   ② 档位升序、无重复（下拉列表顺序＝数值顺序，否则 5km 会插在奇怪位置）
 *   ③ 默认档 1000 必须还在（`radius = ref(... || 1000)` 与后端 DEFAULT_RADIUS 同值）
 *   ④ 最大档必须等于 `UNICOM_REPORT_RADII` 上界 —— 这是「能买到的档」的硬边界：
 *      阈值一旦被拉开（比如前端给 10km），升级面板就得说「范围小于本报告、人口会偏少」
 *   ⑤ ⛔ 不许有超过联通最大档的选项（同上，宁可少一档也不让用户选一个买不到的圆）
 *
 * 🔴 守卫自身规范：扫源码先剥注释 —— 本文件的说明注释里就写着「5km」「5000」，
 *    不剥会把这些字面量当成选项数组的一部分，断言假绿。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { UNICOM_REPORT_RADII } from '../src/utils/siteSelectConfig.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const BRIEF = 'frontend/src/components/CandidateBriefReport.vue'

const raw = fs.readFileSync(path.join(REPO, BRIEF), 'utf8')

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释（HTML 必须最先剥）。 */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const src = strip(raw)

/** 解析 `const STANDARD_RADII = [500, 1000, 1500, 3000, 5000]` */
function parseStandardRadii() {
  const m = src.match(/const\s+STANDARD_RADII\s*=\s*\[([^\]]*)\]/)
  expect(m, '找不到 STANDARD_RADII 定义').not.toBeNull()
  return m[1].split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n))
}

const RADII = parseStandardRadii()

describe('初步分析 · 本次分析半径档位（v1.13.402）', () => {
  it('① 档位里必须有 5000（业主 2026-11-23 要求）', () => {
    expect(RADII).toContain(5000)
  })

  it('② 升序且无重复', () => {
    expect(RADII, `实际档位：${RADII.join(' / ')}`).toEqual([...new Set(RADII)].sort((a, b) => a - b))
  })

  it('③ 默认档 1000 仍在（与后端 DEFAULT_RADIUS 同值）', () => {
    expect(RADII).toContain(1000)
  })

  it('④ 最大档＝联通最大档（能买到才配得上这个圆）', () => {
    const max = Math.max(...RADII)
    const unicomMax = Math.max(...UNICOM_REPORT_RADII)
    expect(max, `初步分析最大档 ${max}m ≠ 联通最大档 ${unicomMax}m`).toBe(unicomMax)
  })

  it('⑤ 没有超过联通最大档的选项（否则升级面板要说"人口会偏少"）', () => {
    const over = RADII.filter(r => r > Math.max(...UNICOM_REPORT_RADII))
    expect(over, `这些档位联通买不到：${over.join(' / ')}`).toEqual([])
  })

  it('⑥ 五档都落在后端可接受区间（100 ~ 50000）', () => {
    for (const r of RADII) {
      expect(r, `档位 ${r}m 越界`).toBeGreaterThanOrEqual(100)
      expect(r).toBeLessThanOrEqual(50000)
    }
  })
})
