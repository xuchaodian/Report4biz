/**
 * 门店体检 · 打印版报告（v1.13.298）
 *
 * 为什么用「浏览器打印」而不是服务器生成 PDF：
 *   · 服务器上只有 libreoffice，把 xlsx 转 PDF 的中文分页与字体很难看；
 *   · 这台机器 2C/1.6G，为了出一份 PDF 起一个 LibreOffice 进程（几百 MB）不划算；
 *   · 浏览器打印能直接「另存为 PDF」，中文字体与分页由系统保证。
 * ⇒ 本文件只产出**纯 HTML 字符串**（无脚本），由页面 new window 打开后调用 print()。
 *
 * 🔴 CSP：本站在 `script-src 'self'`，所以报告里**绝对不能有内联脚本**；
 *    `style-src` 含 'unsafe-inline'，内联 <style> 可以。
 */

const LEVEL_TEXT = { high: '红灯·高风险', mid: '黄灯·中风险', low: '绿灯·低风险', none: '绿灯·未发现' }
const FLAG_TEXT = { competition: '竞争密集', cannibal: '自我蚕食' }

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function flagsText(flags) {
  const l = (flags || []).map(f => FLAG_TEXT[f] || f)
  return l.length ? l.join('、') : '未命中'
}

const dist = (m) => (m == null ? '—' : m >= 1000 ? (m / 1000).toFixed(2) + 'km' : Math.round(m) + 'm')

/**
 * @param {object} input
 * @param {object} input.data      /api/markers/checkup 的返回
 * @param {object} input.lights    /api/markers/checkup/lights 的返回
 * @param {string} [input.owner]   账号显示名（可选，报告抬头用）
 * @param {number} [input.maxLights=60]
 * @param {number} [input.maxPairs=30]
 */
export function buildCheckupPrintHtml({ data, lights, owner = '', maxLights = 60, maxPairs = 30 }) {
  const now = new Date().toLocaleString('zh-CN', { hour12: false })
  const c = data.counts || {}
  const comp = data.completeness || {}
  const b = lights?.byLevel || { high: 0, mid: 0, low: 0, none: 0 }

  const litRows = (lights?.lights || [])
    .filter(l => l.status === 'evaluated' && (l.riskLevel === 'high' || l.riskLevel === 'mid'))
    .slice(0, maxLights)

  const pairRows = (data.pairs || []).slice(0, maxPairs)

  const kpi = (n, label, hint, cls) => `
      <div class="kpi ${cls || ''}">
        <div class="kpi-n">${esc(n)}</div>
        <div class="kpi-l">${esc(label)}</div>
        <div class="kpi-h">${esc(hint)}</div>
      </div>`

  const litTr = litRows.map(l => `
        <tr>
          <td><span class="dot ${l.riskLevel}"></span>${esc(LEVEL_TEXT[l.riskLevel] || '')}</td>
          <td>${esc(l.name || '（未命名）')}<div class="sub">${esc(l.riskScore)} 分 · ${esc(flagsText(l.flags))}</div></td>
          <td class="num">${esc(dist(l.nearestM))}<div class="sub">${esc(l.nearestName || '')}</div></td>
          <td class="num">${l.peers800 == null ? '—' : esc(l.peers800) + ' 家'}</td>
          <td class="num">${l.compRing == null ? '未评' : esc(l.compRing) + ' 家'}</td>
          <td>${esc(l.district || '—')}<div class="sub">${esc(l.district ? (l.crowd || '客群未知') : '不在已导入商圈面内')}</div></td>
        </tr>`).join('')

  const pairTr = pairRows.map(p => `
        <tr>
          <td class="num">${esc(p.distance)}m</td>
          <td>${esc(p.aName || '')}<div class="sub">${esc(p.aCode || '无编码')} · ${p.aArea ? esc(p.aArea) + '㎡' : '无面积'}</div></td>
          <td>${esc(p.bName || '')}<div class="sub">${esc(p.bCode || '无编码')} · ${p.bArea ? esc(p.bArea) + '㎡' : '无面积'}</div></td>
          <td>${p.dualFormat ? '双店型<div class="sub">不建议合并</div>' : '疑似<div class="sub">需人工看一眼</div>'}</td>
        </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>门店体检报告 ${esc(now)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif; color: #111827; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
  .meta { color: #6b7280; font-size: 12px; }
  .kpis { display: flex; gap: 8px; margin: 14px 0 6px; }
  .kpi { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
  .kpi-n { font-size: 20px; font-weight: 700; line-height: 1.2; }
  .kpi-l { font-size: 12px; color: #374151; }
  .kpi-h { font-size: 10px; color: #9ca3af; }
  .kpi.red { background: #fef2f2; border-color: #fecaca; } .kpi.red .kpi-n { color: #b91c1c; }
  .kpi.yellow { background: #fffbeb; border-color: #fcd34d; } .kpi.yellow .kpi-n { color: #b45309; }
  .kpi.green { background: #f0fdf4; border-color: #bbf7d0; } .kpi.green .kpi-n { color: #15803d; }
  .kpi.gray { background: #f3f4f6; } .kpi.gray .kpi-n { color: #4b5563; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #eef0f3; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #fafafa; font-weight: 600; color: #374151; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sub { color: #6b7280; font-size: 11px; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: middle; background: #d1d5db; }
  .dot.high { background: #dc2626; } .dot.mid { background: #f59e0b; }
  .dot.low, .dot.none { background: #22c55e; }
  .rules { font-size: 12px; margin: 6px 0 0; padding-left: 18px; }
  .rules li { margin: 2px 0; }
  .warn { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 8px 10px; font-size: 12px; color: #92400e; margin: 10px 0; }
  .note { color: #9ca3af; font-size: 11px; margin-top: 6px; }
  .foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 11px; }
  tr { page-break-inside: avoid; }
  h2 { page-break-after: avoid; }
</style>
</head>
<body>
  <h1>门店体检报告</h1>
  <div class="meta">
    生成时间 ${esc(now)}　｜　门店 ${esc(c.total)} 家（可判定 ${esc(c.withCoord)} 家）　｜　复核阈值 ${esc(data.nearM)}m
    ${owner ? `　｜　账号 ${esc(owner)}` : ''}
  </div>

  <h2>一、结论速览</h2>
  <div class="kpis">
    ${kpi(b.high, '红灯 · 高风险', '贴身 + 半径内竞品密集', 'red')}
    ${kpi(b.mid, '黄灯 · 中风险', '命中其中一条', 'yellow')}
    ${kpi(b.low + b.none, '绿灯 · 低风险', `其中 ${b.none} 家未发现问题${lights?.rules?.competitionPartial ? `；${lights.rules.competitionPartial} 家竞争未评` : ''}`, 'green')}
    ${kpi(lights?.noCoord ?? 0, '未评估 · 缺经纬度', '没坐标就算不了距离', 'gray')}
  </div>
  <ul class="rules">
    <li><b>自我蚕食</b>：最近同品牌 ≤${esc(lights?.thresholds?.closeM ?? 300)}m 记 +3、≤${esc(lights?.thresholds?.overlapM ?? 800)}m 记 +2；
      同址双店型不计分（大店+小店是有意为之）—— ${esc(lights?.rules?.cannibal ?? 0)} 家
      <span class="sub">（同址 ${esc(lights?.rules?.selfDetail?.same ?? 0)} · 贴身 ${esc(lights?.rules?.selfDetail?.close ?? 0)} ·
      部分重叠 ${esc(lights?.rules?.selfDetail?.overlap ?? 0)}；同址双店型 ${esc(lights?.rules?.selfDetail?.sameDual ?? 0)} 家不计分）</span>
    </li>
    <li><b>竞争密度</b>：门店 ${esc(lights?.thresholds?.compRadiusM ?? 800)}m 内同业态竞品
      ≥${esc(lights?.thresholds?.compHigh ?? 6)} 家 +3、≥${esc(lights?.thresholds?.compMid ?? 3)} 家 +2 —— ${esc(lights?.rules?.competition ?? 0)} 家
      <span class="sub">（已评 ${esc(lights?.rules?.competitionEvaluated ?? 0)} 家，未评 ${esc((lights?.rules?.competitionNoData ?? 0) + (lights?.rules?.competitionNoCity ?? 0))} 家）</span>
    </li>
    <li><b>扎堆组</b>：同品牌两两 ≤${esc(lights?.thresholds?.overlapM ?? 800)}m 连通成一团 —— ${esc(lights?.rules?.cannibalDistricts ?? 0)} 组${
      lights?.rules?.clusters?.length
        ? `（最挤：${esc(lights.rules.clusters.map(c => `${c.names[0]}一带 ${c.count} 家`).join('、'))}）`
        : ''
    }</li>
  </ul>

  ${lights?.noCoord ? `<div class="warn">${esc(lights.noCoord)} 家门店缺经纬度 —— 这是<b>「没评估」，不是「没问题」</b>，先做地址解析补坐标。</div>` : ''}
  ${lights?.rules?.competitionNoData ? `<div class="warn">${esc(lights.rules.competitionNoData)} 家门店所在城市没有竞品点位 —— 竞争密度<b>没算过</b>（⛔ 不等于竞争宽松），在「竞品管理」导入竞品后重跑即可。</div>` : ''}

  <h2>二、门店结构</h2>
  <table>
    <tr><th style="width:42%">指标</th><th>数值</th><th>说明</th></tr>
    <tr><td>同址组（&lt;50m 且同品牌）</td><td class="num">${esc(c.sameAddrPairs)} 组</td><td>${esc(c.sameAddrStores)} 家门店落在其中</td></tr>
    <tr><td>需复核对数（≤${esc(data.nearM)}m 同品牌）</td><td class="num">${esc(c.pairs)} 对</td><td>双店型 ${esc(c.dualFormatPairs)} · 疑似 ${esc(c.suspectedPairs)}</td></tr>
    <tr><td>中位最近同品牌距离</td><td class="num">${esc(dist(data.medianNearestM))}</td><td>基于 ${esc(data.medianBasis)} 家${data.noNeighbor ? `；另 ${esc(data.noNeighbor)} 家 20km 内无同品牌` : ''}</td></tr>
    <tr><td>门店区分（选址形态）为空</td><td class="num">${esc(comp.categoryEmpty)} 家</td><td>${comp.categoryEmptyReadonly ? `其中 ${esc(comp.categoryEmptyReadonly)} 家为集团下发门店，需在集团侧补` : '可在「门店管理 → 导入门店 → 补门店区分」批量补齐'}</td></tr>
    <tr><td>缺营业面积 / 缺经纬度</td><td class="num">${esc(comp.areaMissing)} / ${esc(comp.coordMissing)} 家</td><td>缺面积的店无法判店型，也进不了销售预测</td></tr>
    <tr><td>销售记录</td><td class="num">${esc(comp.salesRows)} 行</td><td>不足 50 行时销售预测只能粗看；不足 150 行无法启用 L3</td></tr>
  </table>

  ${litRows.length ? `<h2>三、优先复核门店（红黄灯，前 ${litRows.length} 家）</h2>
  <table>
    <tr><th style="width:18%">灯</th><th>门店</th><th class="num">最近同品牌</th><th class="num">同品牌800m</th><th class="num">竞品800m</th><th>所在商圈（仅展示）</th></tr>
    ${litTr}
  </table>
  <div class="note">按风险分排序；「竞品800m」显示「未评」表示该城市没有竞品点位，<b>不是</b>竞争宽松。完整名单与全部字段见导出的 Excel。</div>` : ''}

  ${pairRows.length ? `<h2>四、需复核清单（前 ${pairRows.length} 对）</h2>
  <table>
    <tr><th style="width:12%">距离</th><th>门店 A</th><th>门店 B</th><th style="width:24%">判定</th></tr>
    ${pairTr}
  </table>
  <div class="note">双店型＝编码不同且面积差 2 倍以上，通常是同一商场旗下不同品牌门店，<b>不建议合并</b>；疑似＝面积缺失或面积接近，需人工看一眼。</div>` : ''}

  <div class="foot">
    <b>口径</b>：仅统计本人门店；跨品牌不参与判定；信号灯以<b>门店坐标为圆心按半径</b>判定
    （贴身 ≤${esc(lights?.thresholds?.closeM ?? 300)}m、部分重叠 ≤${esc(lights?.thresholds?.overlapM ?? 800)}m、竞品半径 ${esc(lights?.thresholds?.compRadiusM ?? 800)}m），
    商圈名只作定位参考、不参与打分。同址双店型不计分；「未评」不等于低风险。<br>
    本次体检全部为本地几何计算 + 存量竞品点位，<b>未消耗任何第三方数据配额</b>。
  </div>
</body>
</html>`
}
