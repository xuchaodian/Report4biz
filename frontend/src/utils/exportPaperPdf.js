/**
 * 「A4 纸」DOM → PDF（v1.13.378 从 CandidateReport.vue 抽出）
 *
 * ── 为什么抽出来 ────────────────────────────────────────────────────────
 * 378 起站内有两份可导出的纸质报告：**立项报告**（含联通人口，付费）与
 * **初步分析**（本地网格，0 消耗）。两者都必须遵守业主 2026-11-09 两次拍板的版式规则：
 *   ① 纸张固定 A4 纵向（⛔ 不按内容高度自定义纸张）
 *   ② 能缩到 ≥72% 装进一页 ⇒ 一页
 *   ③ 再缩就不可读了 ⇒ 分页，并在均分点附近找空白行切，避免把一行字切成两半
 * 两份各写一遍必然分叉（一份改了分页阈值，另一份没改），所以只留这一份实现。
 *
 * ── 切页策略（三段式，⛔ 不要简化成均分）────────────────────────────────
 *   ① DOM 区块/行边界（最安全）：把 `.rp-sec / .rp-table tr / .rp-risks li / .rp-foot`
 *      这类元素的上/下边界换算成 canvas 像素，切在它们之间。
 *      ⚠️ 优先用 DOM 边界而不是像素扫描：表格行、段落之间常有 1px 边框线（#f0f1f3 ≈ 240），
 *      像素扫描判不出「纯白」，于是退回均分点，正好把一行字切成两半（2026-11-09 实测踩到）。
 *   ② 找一行「几乎全白」的像素作切点（±8% 页高内），越界就退回理想位置
 *   ③ 再退就均分
 *
 * ── 使用约定 ────────────────────────────────────────────────────────────
 * · 传进来的 `el` 必须是**纸张本身**（宽度约 794px ≈ 210mm@96dpi），不是滚动容器
 * · `el` 内的地图图片若走外链，`getImageData` 会因跨域污染抛错 ⇒ 已 try/catch 兜住
 * · 文件名由调用方拼（含业务前缀与日期），本模块不猜业务
 */
import { ElMessage } from 'element-plus'

const A4_W = 210
const A4_H = 297
const PAD = 6                        // 上下留白（mm）
const MIN_READABLE = 0.72            // 低于此比例正文 ≈4~5pt，宁可分页
const MAX_PAGES = 3                  // 兜底：超过 3 页就不再增加，改为缩到 3 页

/**
 * 收集「安全的切页点」：DOM 里每个可切元素的上/下边界 → canvas 像素。
 * ⚠️ 只收区块级 + 行级边界，**不收正文容器**（如 `.rp-ai-body`）——
 *    收了会把切点落在标题与正文之间，标题留在上页、内容翻到下页。
 */
function collectCutCandidates(paperEl, canvas) {
  try {
    const box = paperEl.getBoundingClientRect()
    if (!box.height) return []
    const ratio = canvas.height / box.height
    const out = []
    paperEl.querySelectorAll('.rp-sec, .bf-sec, .rp-table tr, .rp-risks li, .rp-foot, .bf-foot').forEach((el) => {
      const r = el.getBoundingClientRect()
      out.push(Math.round((r.top - box.top) * ratio))
      out.push(Math.round((r.bottom - box.top) * ratio))
    })
    return out.filter((v) => v > 0 && v < canvas.height).sort((a, b) => a - b)
  } catch {
    return []
  }
}

/**
 * 在 idealY 附近找一行「几乎全白」的像素作切页点。
 * @returns {number} 相对 fromY 的偏移（px）
 */
function findCutY(canvas, fromY, idealH, pageHpx) {
  try {
    const ctx = canvas.getContext('2d')
    const target = fromY + idealH
    const win = Math.floor(pageHpx * 0.08)
    const lo = Math.max(fromY + Math.floor(pageHpx * 0.55), target - win)
    const hi = Math.min(canvas.height, target + win)
    if (hi - lo < 8) return idealH
    const W = canvas.width
    const data = ctx.getImageData(0, lo, W, hi - lo).data
    const step = 4                       // 每 4 像素抽一格，够判断且快 4 倍
    const samples = Math.ceil(W / step)
    let bestRow = -1
    let bestScore = -1
    for (let row = 0; row < hi - lo; row++) {
      let white = 0
      const base = row * W * 4
      for (let x = 0; x < W; x += step) {
        const i = base + x * 4
        if (data[i] > 236 && data[i + 1] > 236 && data[i + 2] > 236) white++
      }
      const score = white / samples
      if (score > bestScore) { bestScore = score; bestRow = row }
      if (score >= 0.999) break          // 已找到纯白行，不必再往下扫
    }
    if (bestRow >= 0 && bestScore >= 0.9) return lo - fromY + bestRow
    return idealH
  } catch {
    return idealH
  }
}

/** 决定这一页切在哪：①DOM 边界 ②纯白像素行 ③均分。三种都限制在「本页至少装 55%」以内 */
function pickCutY(canvas, fromY, idealH, pageHpx, cuts) {
  const headroom = Math.floor(fromY + pageHpx * 0.55)
  const limit = fromY + idealH + Math.floor(pageHpx * 0.15)
  const domCut = cuts.filter((c) => c > headroom && c <= limit).pop()
  if (domCut !== undefined) return domCut - fromY
  return findCutY(canvas, fromY, idealH, pageHpx)
}

/**
 * 导出 PDF。
 * @param {HTMLElement} el 纸张元素
 * @param {string} fileName 完整文件名（含 .pdf）
 * @returns {Promise<{pages:number, scale:number}>}
 */
export async function exportPaperPdf(el, fileName) {
  if (!el) throw new Error('没有可导出的纸张元素')
  const { default: html2canvas } = await import('html2canvas')
  const { jsPDF } = await import('jspdf')

  const canvas = await html2canvas(el, {
    useCORS: true,
    scale: 2,
    backgroundColor: '#ffffff',
    logging: false
  })

  const availH = A4_H - PAD * 2                 // 285mm
  const rawH = (canvas.height * A4_W) / canvas.width   // 1:1 下的纸高（mm）

  // 一页装得下就一页；装不下但缩一页仍可读就缩；否则分页
  const onePageScale = availH / rawH
  const pages = onePageScale >= MIN_READABLE
    ? 1
    : Math.min(MAX_PAGES, Math.max(2, Math.ceil(rawH / availH)))
  // 分页时均分：每页装 rawH/pages，缩放到正好铺满可用高度（≤1，不放大）
  const scale = pages === 1 ? Math.min(1, onePageScale) : Math.min(1, (rawH / pages) / availH)

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [A4_W, A4_H] })

  if (pages === 1) {
    const drawW = A4_W * scale
    const drawH = rawH * scale
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.72), 'JPEG', (A4_W - drawW) / 2, PAD, drawW, drawH)
    if (scale < 0.9) {
      ElMessage.warning(`内容较多，已自动缩小到约 ${Math.round(scale * 100)}% 才装进一页 A4`)
    }
  } else {
    const pxPerMm = canvas.width / A4_W
    const pageHpx = Math.floor((availH * pxPerMm) / scale)   // 每页对应原图多少 px
    const cuts = collectCutCandidates(el, canvas)
    let fromY = 0
    for (let i = 0; i < pages; i++) {
      let h = Math.min(pageHpx, canvas.height - fromY)
      if (i < pages - 1) h = pickCutY(canvas, fromY, h, pageHpx, cuts)
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = h
      slice.getContext('2d').drawImage(canvas, 0, fromY, canvas.width, h, 0, 0, canvas.width, h)
      if (i > 0) pdf.addPage([A4_W, A4_H], 'p')
      const hMm = (h * scale) / pxPerMm
      pdf.addImage(slice.toDataURL('image/jpeg', 0.78), 'JPEG', 0, PAD, A4_W, hMm)
      fromY += h
    }
    ElMessage.info(`内容较多，已自动排成 ${pages} 页 A4（未压缩字号）`)
  }

  pdf.save(fileName)
  return { pages, scale }
}

/** 文件名时间戳：20261119 → 报告文件名用 */
export function fileStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** 文件名安全化：剥掉路径分隔符与空白（⛔ 不要直接拿点位名当文件名） */
export function safeFileName(s, max = 40) {
  return String(s || '点位').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, max)
}
