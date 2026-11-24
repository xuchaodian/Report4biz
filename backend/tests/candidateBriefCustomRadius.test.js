/**
 * 初步分析「设置分析半径」手动输入守卫（批次 411）
 *
 * ── 业主原话 ─────────────────────────────────────────────────────────────
 * 2026-11-24：「1.1 把名称改为『设置分析半径』 1.2 下拉列表中增加手动输入选项」。
 *
 * ── 守什么 ───────────────────────────────────────────────────────────────
 *   ① 文案只留新名：`设置分析半径`（旧名 `本次分析半径` 只许出现在注释里）
 *   ② 下拉真的能手动输入：`filterable` + `allow-create` 缺一不可
 *      （EP 的 `allow-create` **必须**配 `filterable`，单写一个静默无效）
 *   ③ 输入解析成**米**：`2`/`1.5`/`2km`/`2公里`/`2千米` ⇒ 2000/1500/2000/2000/2000；
 *      `800m`/`800米` ⇒ 800；其余一律 NaN（⛔ 不许"猜单位"）
 *   ④ 区间 0.35~5km 与后端 `UNICOM_RADIUS_RANGE_KM` **同源**（漂移即红）
 *   ⑤ 越界/看不懂 ⇒ `ElMessage.warning` ＋ **回退**（⛔ 只提示不回写 ⇒ 框里会留个不存在的半径）
 *   ⑥ 半径没变就不重新取数（`/brief` 每次解析整城网格，重庆约 1.5s）
 *   ⑦ 手动输入同样**不写回**点位的评估半径（`bf-bar-note` 那句话必须还在）
 *
 * 🔴 守卫自身规范（211/231/402 教训）：正则扫 Vue 源码**必须先剥注释**，
 *    否则模板里那句「由『本次分析半径』改名」会让 ① 假红。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { UNICOM_RADIUS_RANGE_KM } from '../src/utils/candidateBrief.js'
import { UNICOM_REPORT_RADII } from '../src/utils/siteSelectConfig.js'
import {
  parseRadiusInput,
  CUSTOM_RADIUS_MIN_M,
  CUSTOM_RADIUS_MAX_M
} from '../../frontend/src/utils/candidateReport.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const FILE = 'frontend/src/components/CandidateBriefReport.vue'

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释（HTML 必须最先剥，否则 `/*` 会吃掉 `-->`） */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const raw = fs.readFileSync(path.join(REPO, FILE), 'utf8')
const code = strip(raw)

/** 取 [start, end) 源码；找不到起点返回 ''（让断言直接红，而不是静默通过） */
function slice(src, startMark, endMark) {
  const i = src.indexOf(startMark)
  if (i < 0) return ''
  const j = src.indexOf(endMark, i + startMark.length)
  return src.slice(i, j < 0 ? src.length : j)
}

/**
 * 模板里的半径选择器（从「设置分析半径」到「刷新」按钮之间）。
 * 🔴 锚点用「刷新」：v1.13.412 把按钮名从「重新分析」改成了「刷新」，锚点不同步会让 slice 切空、
 *    断言全红（好一点）或切到别处（危险）—— 改名时**必须一起改这里**。
 */
const SELECT_BLOCK = slice(code, '设置分析半径', '刷新')
/** onRadiusChange 函数体 */
const ON_CHANGE = slice(code, 'function onRadiusChange', '/** 三档结论的统一措辞')

describe('初步分析 · 设置分析半径（v1.13.411）', () => {
  it('① 文案改成「设置分析半径」，旧名只剩注释', () => {
    expect(SELECT_BLOCK, '模板里找不到「设置分析半径」').not.toBe('')
    // 🔴 切片不得越界：锚点 '刷新' 若命不中按钮，会一路切到 653 行的「返回列表刷新后重试」，
    //    那样 ② 仍能过（属性都在前面）⇒ 假绿。用「按钮之后的说明行」当越界线。
    expect(SELECT_BLOCK, '切片跑过界了（锚点没命中按钮，改名后忘了同步 endMark？）')
      .not.toContain('bf-bar-note')
    expect(code, '旧名「本次分析半径」还在代码里（注释不算）').not.toContain('本次分析半径')
    expect(code, 'aria-label 必须同步改名').toContain('aria-label="设置分析半径"')
  })

  it('② 下拉具备手动输入能力（filterable 与 allow-create 缺一不可）', () => {
    expect(SELECT_BLOCK).toMatch(/\bfilterable\b/)
    expect(SELECT_BLOCK).toMatch(/\ballow-create\b/)
    // ⛔ 不能再用 v-model：allow-create 会把用户敲的字（字符串）直接写进模型
    expect(SELECT_BLOCK, '必须用 :model-value + @change 接管输入').toContain(':model-value="radius"')
    expect(SELECT_BLOCK).toContain('@change="onRadiusChange"')
  })

  it('③ 输入按「公里」解析成米（含 m/米 写法）', () => {
    expect(parseRadiusInput('2')).toBe(2000)
    expect(parseRadiusInput('1.5')).toBe(1500)
    expect(parseRadiusInput('2.0')).toBe(2000)
    expect(parseRadiusInput(' 2 ')).toBe(2000)
    expect(parseRadiusInput('2km')).toBe(2000)
    expect(parseRadiusInput('2公里')).toBe(2000)
    expect(parseRadiusInput('2千米')).toBe(2000)
    expect(parseRadiusInput('800m')).toBe(800)
    expect(parseRadiusInput('800米')).toBe(800)
  })

  it('③-2 看不懂的输入一律 NaN（⛔ 不许猜单位）', () => {
    for (const bad of ['', '   ', 'abc', '2.5.1', '-1', '0', '2英里', 'km', null, undefined]) {
      expect(Number.isNaN(parseRadiusInput(bad)), `「${bad}」不该被解析出数值`).toBe(true)
    }
  })

  it('④ 区间与后端 UNICOM_RADIUS_RANGE_KM 同源（0.35~5km）', () => {
    expect(CUSTOM_RADIUS_MIN_M).toBe(UNICOM_RADIUS_RANGE_KM.min * 1000)
    expect(CUSTOM_RADIUS_MAX_M).toBe(UNICOM_RADIUS_RANGE_KM.max * 1000)
    // 上界＝联通最大档：再大的圆买不到数据，报告口径不该先跑出去
    expect(CUSTOM_RADIUS_MAX_M).toBe(Math.max(...UNICOM_REPORT_RADII))
  })

  it('⑤ 越界/无效必须提示并回退（不能只弹提示）', () => {
    expect(ON_CHANGE, '找不到 onRadiusChange').not.toBe('')
    expect(ON_CHANGE).toMatch(/ElMessage\.warning/)
    // 回退＝不写 radius.value；只有「解析成功且在区间内」那一支才赋值
    expect(ON_CHANGE).toMatch(/radius\.value = next/)
    expect(ON_CHANGE, '越界分支必须给条件（⛔ 无条件赋值）').toMatch(
      /next < CUSTOM_RADIUS_MIN_M \|\| next > CUSTOM_RADIUS_MAX_M/
    )
    // 填 2000 想要 2000 米是最常见误填 ⇒ 必须有对症提示
    expect(ON_CHANGE).toContain('looksLikeMeters')
  })

  it('⑥ 半径没变就不重新取数', () => {
    expect(ON_CHANGE).toMatch(/if \(radius\.value !== prev\) load\(\)/)
  })

  it('⑦ 手动输入同样不写回点位半径（提示句还在）', () => {
    expect(code).toContain('不会写回点位的评估半径')
    expect(code, '手动输入也必须说明区间').toMatch(/手动输入 0\.35~5 公里/)
  })

  it('⑧ 按钮名是「刷新」，⛔ 不再叫「重新分析」', () => {
    // 业主 2026-11-24：「把「重新分析」按钮名称改为「刷新」」
    expect(SELECT_BLOCK, '半径选择器后面找不到具名按钮').not.toBe('')
    expect(code, '按钮文案没改成「刷新」').toContain('@click="load">刷新</el-button>')
    // 「重新分析」是数据洞察那两个按钮的名字（StoreSmartstepsDialog / MyAccountView），本文件已无此词
    expect(code, '本文件不该再有「重新分析」（含 aria-label）').not.toContain('重新分析')
  })
})
