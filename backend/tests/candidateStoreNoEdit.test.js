/**
 * 候选点位详情：「我的门店」来源不显示「编辑信息」（批次 386）
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * 业主 2026-11-20 反馈：详情弹窗最下方的「编辑信息」，在门店来源的行上打开后
 * 只有「评估半径」一个可改项，名称/品牌/城市/地址/坐标/面积/租金全部 disabled
 * ⇒ 点开就是一片灰，等于没有编辑能力，不该占一个按钮位。
 *
 * ── 守什么 ──────────────────────────────────────────────────────────────
 *   ① 「编辑信息」按钮必须带 `v-if="detail.origin !== 'store'"`
 *   ② 门店来源仍要说明「怎么让它从列表消失」（锁定说明不许跟着一起删）
 *   ③ 🔴 `openEdit` 里的 `formFromStore` 护栏**必须留**：
 *      按钮隐藏后该分支看似不可达，但它挡的是「门店台账字段被当成候选点位字段写库」。
 *      删掉它＝埋雷（将来任何路径打开这个弹窗都会把门店资料写进 store_candidates）。
 *   ④ 🔴 `save()` 里 `formFromStore ? { radius } : {...}` 的收窄分支同样必须留。
 *   ⑤ 独立点位（origin !== 'store'）仍要能编辑 —— 不许把按钮整个删掉。
 *
 * 🔴 守卫自身规范：扫源码必须剥注释，否则注释里出现的旧文案会让断言假红/假绿。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const VIEW = 'frontend/src/views/CandidateView.vue'

const raw = fs.readFileSync(path.join(REPO, VIEW), 'utf8')

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释。HTML 必须最先剥。 */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const src = strip(raw)

/** 详情弹窗底部操作区（从 `.cd-detail-actions` 到该 div 闭合前的片段） */
function actionsBlock() {
  const start = src.indexOf('class="cd-detail-actions"')
  expect(start, '找不到详情操作区 .cd-detail-actions').toBeGreaterThan(-1)
  const end = src.indexOf('</el-drawer>', start)
  expect(end, '详情抽屉没有闭合标签').toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('386 门店来源不显示「编辑信息」', () => {
  it('①「编辑信息」按钮带 origin !== store 的条件', () => {
    const blk = actionsBlock()
    // 取按钮所在的那一整行（属性可能跨行，这里按闭合尖括号截）
    const at = blk.indexOf('openEdit')
    expect(at, '操作区里找不到 openEdit 按钮').toBeGreaterThan(-1)
    const open = blk.lastIndexOf('<el-button', at)
    expect(open, '找不到 openEdit 对应的 <el-button 开标签').toBeGreaterThan(-1)
    const tag = blk.slice(open, blk.indexOf('>', at) + 1)
    expect(tag, '按钮必须写 v-if="detail.origin !== \'store\'"')
      .toMatch(/v-if="detail\.origin\s*!==\s*'store'"/)
    // 反向：别写成 !=='candidate' 这种等价翻转（读起来更容易误解成"只有门店能编辑"）
    expect(tag).not.toMatch(/origin\s*===\s*'candidate'/)
  })

  it('② 门店来源仍保留「怎么让它消失」的锁定说明', () => {
    const blk = actionsBlock()
    expect(blk).toContain('cd-detail-lock')
    expect(blk).toMatch(/v-else/)
    expect(blk).toContain('我的门店')
    expect(blk).toMatch(/已开业/)
  })

  it('③ openEdit 里的 formFromStore 护栏不许删', () => {
    const at = src.indexOf('async function openEdit')
    expect(at, '找不到 openEdit 函数').toBeGreaterThan(-1)
    const body = src.slice(at, src.indexOf('\n}\n', at) + 3)
    expect(body, 'openEdit 必须按 origin 设置 formFromStore')
      .toMatch(/formFromStore\.value\s*=\s*detail\.value\.origin\s*===\s*'store'/)
  })

  it('④ save() 必须保留「门店只提交半径」的收窄分支', () => {
    const at = src.indexOf('async function save')
    expect(at, '找不到 save 函数').toBeGreaterThan(-1)
    const body = src.slice(at, src.indexOf('\n}\n', at) + 3)
    // 正向 + 收窄一起断言：`? { radius: f.radius } :` —— 门店分支里**只许有 radius 一个键**
    expect(body, 'save 必须有「门店只提交 radius」的收窄 payload')
      .toMatch(/const payload\s*=\s*formFromStore\.value\s*\?\s*\{\s*radius:\s*f\.radius\s*\}\s*:/)
  })

  it('⑤ 独立点位仍可编辑：按钮没有被无条件删除', () => {
    const blk = actionsBlock()
    expect(blk).toContain('openEdit')
    // 必须还有「初步分析 / 生成立项报告」两个入口在（别把整行删了）
    expect(blk).toContain('openBrief')
    expect(blk).toContain('openReport')
  })

  it('⑥ 编辑弹窗里「门店只能改半径」的提示仍在（护栏配套文案）', () => {
    expect(src).toContain('formFromStore')
    expect(src).toMatch(/这个点位来自「我的门店」/)
  })

  it('⑦ 初步分析不许再让人「去点编辑信息」（门店来源没有那个按钮了）', () => {
    const brief = strip(fs.readFileSync(path.join(REPO, 'frontend/src/components/CandidateBriefReport.vue'), 'utf8'))
    expect(brief, '初步分析的半径说明仍在').toMatch(/不会写回点位的评估半径/)
    // 反向：⛔ 不许再出现「请点「编辑信息」」这类指路文案
    expect(brief).not.toMatch(/请点「编辑信息」/)
    expect(brief).not.toContain('要改请点')
  })
})
