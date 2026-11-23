/**
 * 初步分析「多半径对比」版式与数据来源守卫（批次 403）
 *
 * ── 业主拍板（2026-11-23）──────────────────────────────────────────────
 * 「可以有多个半径的分析结果对比吗？」→ 形态 A（保留完整报告 + 顶部对比表）、
 * 只比联通能买到三档 1/3/5km、**表要进 PDF**。
 *
 * ── 守什么 ──────────────────────────────────────────────────────────────
 *   ① 表必须在 `.bf-paper` **里面** —— 导出 PDF 截的是纸面 DOM（`exportPaperPdf(paper)`），
 *      放到纸外就等于"屏幕上看得见、导出的 PDF 里没有"
 *   ② 🔴 **前端不许自己按半径算人口/竞品**，也不许硬编码 [1000,3000,5000]：
 *      档位与数值都来自后端 `compare`，前端再算一遍就是两套算法，将来必然和正文对不上
 *   ③ 表格线必须是**真实 border**：PDF 走 html2canvas，伪元素画的线在 PDF 里会消失
 *      （391 的比例条、400 的指标表都栽过同一个坑）
 *   ④ 未评写「未评」，⛔ 不许把 null 兜成 0（`Number(null)===0` 是本项目的老朋友）
 *   ⑤ 表头可点切半径：必须有可访问名称（`aria-label`），且按的是 `switchRadius`
 *   ⑥ 切换不能白跑请求：`switchRadius` 里要挡掉「已经在这一档」
 *   ⑦ 一次请求只发一次：`load()` 里只许有一处 `axios.get('/api/candidates/brief'`
 *      （多半径是后端一次算完的 —— /brief 每次都重建全城网格索引，重庆一次 1.5s）
 *
 * 🔴 守卫自身规范：扫源码必须剥注释（本文件的注释里就写着 1000/3000/5000 与 `bf-paper`）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const FILE = 'frontend/src/components/CandidateBriefReport.vue'

const raw = fs.readFileSync(path.join(REPO, FILE), 'utf8')

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释（HTML 必须最先剥）。 */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const src = strip(raw)
/** 只要 <template> 段（样式里的类名会误命中） */
const TPL = (() => {
  const a = src.indexOf('<template>')
  // ⚠️ 必须 lastIndexOf：正文里有大量内层 `<template v-if>`，第一个 `</template>`
  //    只结束到那里，会把对比表整段截掉（首版就因此假红了两条）
  const b = src.lastIndexOf('</template>')
  return a >= 0 && b > a ? src.slice(a, b) : ''
})()
/** 只要 <style> 段（断言 CSS 规则用） */
const CSS = (() => {
  const a = src.indexOf('<style')
  return a >= 0 ? src.slice(a) : ''
})()

describe('多半径对比 · 数据来源与请求次数（v1.13.403）', () => {
  it('🔴 前端不许硬编码联通三档（档位来自后端 compare.rows）', () => {
    expect(src).not.toMatch(/\[\s*1000\s*,\s*3000\s*,\s*5000\s*\]/)
    expect(TPL).toContain('compareRows')
  })

  it('🔴 一次请求只发一次（多半径是后端一次算完的）', () => {
    const hits = src.match(/axios\.get\('\/api\/candidates\/brief'/g) || []
    expect(hits.length, '出现多处 /brief 请求 ⇒ 前端在按半径循环发请求').toBe(1)
  })

  it('compare 状态取自响应，并在出错时清空（否则会留着上一个点位的数据）', () => {
    expect(src).toMatch(/compare\.value\s*=\s*data\.compare/)
    expect(src).toMatch(/compare\.value\s*=\s*null/)
  })

  it('没有对比数据就整块不渲染（老后端 / 单档场景不能画空表）', () => {
    expect(src).toMatch(/v-if="compareRows\.length\s*>\s*1"/)
  })
})

describe('多半径对比 · 版式（必须能进 PDF）', () => {
  it('① 表在 .bf-paper 里面（导出 PDF 截的是纸面 DOM）', () => {
    const paper = src.indexOf('class="bf-paper"')
    const table = src.indexOf('class="bf-cmp-t"')
    expect(paper).toBeGreaterThan(-1)
    expect(table).toBeGreaterThan(paper)
  })

  it('③ 表格线是真实 border（⛔ 伪元素在 html2canvas 里会消失）', () => {
    const rule = (CSS.match(/\.bf-cmp-t th,\s*\.bf-cmp-t td\s*\{[^}]*\}/) || [''])[0]
    expect(rule, '找不到 .bf-cmp-t 单元格规则').not.toBe('')
    expect(rule).toContain('border-bottom:')
    expect(CSS).not.toMatch(/\.bf-cmp-t[^{]*::(after|before)/)
  })

  it('④ 未评写「未评」，不许把缺值兜成 0', () => {
    expect(TPL).toContain('未评')
    expect(TPL).not.toMatch(/circlePop\s*\|\|\s*0/)
    expect(TPL).toMatch(/v-if="r\.population\.covered"/)
  })

  it('档位与结论都有可读标签（列头 + 判定结论行）', () => {
    expect(TPL).toMatch(/radiusText\(r\.radiusM\)/)
    expect(TPL).toContain('判定结论')
    expect(TPL).toMatch(/verdictTagOf\(r\.verdict\.level\)/)
  })
})

describe('多半径对比 · 交互（点列头切主报告）', () => {
  it('⑤ 切换按钮有可访问名称，且绑定 switchRadius', () => {
    expect(TPL).toMatch(/@click="switchRadius\(r\)"/)
    expect(TPL).toMatch(/:aria-label="r\.isMain \? `当前按/)
    expect(src).toMatch(/function switchRadius\(/)
  })

  it('⑥ 已在该档就不发请求（避免白跑一次 1.5s 的全城网格解析）', () => {
    const fn = src.match(/function switchRadius\([\s\S]*?\n\}/) || ['']
    expect(fn[0]).toContain('loading.value')
    expect(fn[0]).toMatch(/radius\.value\)?\s*===\s*target/)
  })

  it('主半径那列有「本次」标记（表格里必须能看出哪个是当前口径）', () => {
    expect(TPL).toContain('bf-cmp-cur')
    expect(TPL).toMatch(/v-if="r\.isMain"/)
  })

  it('结论随半径翻转时要写出来（⛔ 让读者自己对表）', () => {
    expect(src).toMatch(/const verdictShift = computed/)
    expect(TPL).toContain('verdictShift')
  })
})
