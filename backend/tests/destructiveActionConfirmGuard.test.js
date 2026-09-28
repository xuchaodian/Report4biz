/**
 * 破坏性操作二次确认守卫（v1.13.185）
 *
 * 背景事故：v1.13.184 真机验证「地图页门店弹窗 → 删除」按钮时，助手以为它会弹二次确认框，
 *   点了才发现 `deleteMarker()` **无任何确认、直接调接口**，而后端 `DELETE /api/markers/:id`
 *   是**硬删除且无级联**（markers.js 里只有一句 `DELETE FROM markers WHERE id = ?`）
 *   ⇒ **生产库被真实删掉 1 行门店**（markers.id=10249，靠备份库按列名重建才恢复）。
 *
 * 教训：前端从「可变 UI 的弹窗/动态 HTML」里触发删除时，**确认框必须写在与接口调用同一处**，
 *   不能指望调用方补。本文件即钉死这一点。
 *
 * 本文件是**回归钉子**：谁把确认框删掉、或把 confirm 挪到接口调用之后，测试立刻红。
 * （前端无独立测试框架，故与 cspInlineHandlerGuard/faqMatch/orderCompare 一致挂在 backend 的 vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，
 *    `new URL(...).pathname` 会留下 %E5%BE%AE… 百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND = path.join(REPO_ROOT, 'frontend')

/** 按大括号配平截出函数体（本用途下模板字符串里的 ${…} 是配平的，朴素计数即可） */
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

const read = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8')

describe('破坏性操作：前端删除前必须有二次确认', () => {
  it('MapView.deleteMarker 在调用接口之前先弹 ElMessageBox.confirm', () => {
    const body = extractFnBody(read('src/views/MapView.vue'), 'const deleteMarker =')
    expect(body, '未找到 MapView 的 deleteMarker —— 断言失效，请更新守卫').toBeTruthy()

    const iConfirm = body.indexOf('ElMessageBox.confirm')
    const iDelete = body.indexOf('markerStore.deleteMarker')
    expect(iConfirm, 'MapView.deleteMarker 缺少二次确认（184 曾因此误删生产数据）').toBeGreaterThan(-1)
    expect(iDelete).toBeGreaterThan(-1)
    expect(iConfirm, 'confirm 必须在调用删除接口【之前】').toBeLessThan(iDelete)
  })

  it('MapView.deleteMarker 有「用户取消则不发请求」的早退（catch 里 return）', () => {
    const body = extractFnBody(read('src/views/MapView.vue'), 'const deleteMarker =')
    // try/catch 包裹 confirm，catch 内必须 return，否则取消后仍会继续删除
    expect(body).toMatch(/try\s*\{[\s\S]*?ElMessageBox\.confirm[\s\S]*?\}\s*catch\s*\{[\s\S]*?return[\s\S]*?\}/)
  })

  it('MapView.deleteMarker 对只读镜像行（sync_readonly=1）先行拦截', () => {
    const body = extractFnBody(read('src/views/MapView.vue'), 'const deleteMarker =')
    expect(body, '应本地拦截集团下发的只读行，避免用户白点一次').toMatch(/sync_readonly/)
  })

  it('DataView.handleDelete 的二次确认未被回退', () => {
    const body = extractFnBody(read('src/views/DataView.vue'), 'const handleDelete =')
    expect(body).toBeTruthy()
    expect(body).toMatch(/ElMessageBox\.confirm/)
    const iConfirm = body.indexOf('ElMessageBox.confirm')
    const iDelete = body.indexOf('markerStore.deleteMarker')
    expect(iConfirm).toBeLessThan(iDelete)
  })

  it('地图弹窗的「删除」动作确实被委托分发到 deleteMarker', () => {
    const mapView = read('src/views/MapView.vue')
    expect(mapView).toMatch(/case\s+'delete'\s*:\s*return\s+deleteMarker\(/)
  })
})
