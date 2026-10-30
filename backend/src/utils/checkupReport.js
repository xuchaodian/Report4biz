/**
 * 门店体检报告（Excel）的行数据构造（v1.13.298）
 *
 * 纯函数：只做「页面数据 → 表格行」的映射，不碰 db / 不碰 xlsx 库，
 * 这样表头与口径可以被单测钉住 —— 导出的表必须和页面上看到的是同一批数字。
 *
 * 🔴 三条口径在导出里也不能走样：
 *   1. 盲区写「无法评估」，⛔ 不写「低风险」、风险分留空而不是 0；
 *   2. 城市没有商圈面数据的写「该城市暂无商圈面数据」，⛔ 不并进盲区；
 *   3. 需复核清单里「双店型」必须写明**不建议合并**（同商场旗下不同品牌是常态）。
 */

const LEVEL_TEXT = { high: '红灯·高风险', mid: '黄灯·中风险', low: '绿灯·低风险', none: '绿灯·未发现问题' }
const STATUS_TEXT = {
  evaluated: '已评估',
  blind: '无法评估（不在已覆盖商圈面内）',
  no_city_data: '无法评估（该城市暂无商圈面数据）',
  no_coord: '无法评估（缺经纬度）'
}
const FLAG_TEXT = { competition: '竞争密集', cannibal: '自我蚕食', crowd: '客群偏离' }

function flagsText(flags) {
  const list = (flags || []).map(f => FLAG_TEXT[f] || f)
  return list.length ? list.join('、') : '未命中'
}

/** 概览页：指标 / 值 / 补充 */
function overviewSheet({ geo, lights, completeness, nearM, generatedAt }) {
  const rows = [
    ['门店体检报告', ''],
    ['生成时间', generatedAt],
    ['复核阈值', `${nearM}m`],
    ['', ''],
    ['一、门店结构（几何）', ''],
    ['门店总数', geo.counts.total, '含缺少坐标的门店'],
    ['可判定（有经纬度）', geo.counts.withCoord, '没有坐标的门店不参与任何间距计算'],
    ['同址组（<50m 且同品牌）', geo.counts.sameAddrPairs, `${geo.counts.sameAddrStores} 家门店落在其中`],
    [`需复核对数（≤${nearM}m 同品牌）`, geo.counts.pairs, `双店型 ${geo.counts.dualFormatPairs} · 疑似 ${geo.counts.suspectedPairs}`],
    ['中位最近同品牌距离', geo.medianNearestM == null ? '' : `${geo.medianNearestM}m`, `基于 ${geo.medianBasis} 家${geo.noNeighbor ? `；另 ${geo.noNeighbor} 家 20km 内无同品牌` : ''}`],
    ['', ''],
    ['二、商圈信号灯', ''],
    ['红灯·高风险', lights.byLevel.high, '竞争密集 + 自我蚕食（≥4 家同商圈）'],
    ['黄灯·中风险', lights.byLevel.mid, '命中其中一条规则'],
    ['绿灯', lights.byLevel.low + lights.byLevel.none, `其中 ${lights.byLevel.none} 家未发现问题`],
    ['灰灯·无法评估', lights.blind, '⛔ 不等于低风险，是「没评估」'],
    ['', ''],
    ['规则①竞争密集', lights.rules.competition, `所在商圈竞争宽松度 ≤${lights.thresholds.competitionMax}（同类竞品约 16 家以上）`],
    ['规则②自我蚕食', lights.rules.cannibal, `同一商圈内本人门店 ≥2 家，涉及 ${lights.rules.cannibalDistricts} 个商圈`],
    ['规则③客群偏离', lights.rules.crowd, `所在商圈客群占本品牌客群构成不足 ${Math.round(lights.thresholds.crowdShareMin * 100)}%`],
    ['城市无商圈面数据', lights.noCityData, '这是平台数据覆盖问题，不参与评估、不计入灰灯'],
    ['', ''],
    ['三、数据完备度', ''],
    ['销售记录（行）', completeness.salesRows, '不足 50 行时销售预测只能粗看；不足 150 行无法启用 L3'],
    ['门店区分（选址形态）为空', completeness.categoryEmpty, completeness.categoryEmptyReadonly ? `其中 ${completeness.categoryEmptyReadonly} 家为集团下发门店，需在集团侧补` : ''],
    ['缺营业面积', completeness.areaMissing, '缺面积无法判店型，也进不了销售预测'],
    ['缺经纬度', completeness.coordMissing, '没有坐标的门店不参与几何体检'],
    ['', ''],
    ['口径说明', '仅统计本人门店；跨品牌同址不参与判定；本次体检未消耗任何第三方数据配额。']
  ]
  return { name: '概览', aoa: rows, cols: [26, 28, 62] }
}

/** 信号灯明细：一行一家店（全量，不截断 —— 导出的价值就是拿得到全量） */
function lightsSheet({ lights }) {
  const head = ['门店', '品牌', '城市', '商圈', '商圈能级', '客群', '竞争宽松度', '同商圈自有(家)',
    '风险分', '灯', '命中规则', '状态', '纬度', '经度']
  const rows = lights.lights.map(l => ([
    l.name || '',
    l.brand || '',
    l.city || '',
    l.district || '',
    l.districtLevel || '',
    l.crowd || '',
    l.competitionScore == null ? '' : l.competitionScore,
    l.ownInDistrict == null ? '' : l.ownInDistrict,
    // 🔴 盲区留空，⛔ 不要写 0：写 0 会被人当成「零风险」
    l.riskScore == null ? '' : l.riskScore,
    l.riskLevel ? (LEVEL_TEXT[l.riskLevel] || l.riskLevel) : '灰灯·无法评估',
    // 🔴 未评估的门店不能写「未命中」—— 那会被读成「查过了没问题」。
    //   没评估就是没评估，写「—」。
    l.status === 'evaluated' ? flagsText(l.flags) : '—',
    STATUS_TEXT[l.status] || l.status || '',
    l.lat == null ? '' : l.lat,
    l.lng == null ? '' : l.lng
  ]))
  return { name: '信号灯明细', aoa: [head, ...rows], cols: [24, 14, 10, 20, 10, 12, 12, 14, 8, 18, 22, 34, 11, 11] }
}

/** 需复核清单（同品牌贴邻对） */
function pairsSheet({ geo, nearM }) {
  const head = ['距离(m)', '门店 A', 'A 编码', 'A 面积(㎡)', '门店 B', 'B 编码', 'B 面积(㎡)',
    '城市', '地址', '判定', '处理建议']
  const rows = geo.pairs.map(p => ([
    p.distance,
    p.aName || '', p.aCode || '', p.aArea || '',
    p.bName || '', p.bCode || '', p.bArea || '',
    p.city || '', p.address || '',
    p.dualFormat ? '双店型（编码不同且面积差 2 倍以上）' : '疑似（面积缺失或面积接近）',
    p.dualFormat
      ? '通常是同一商场旗下不同品牌门店，⛔ 不建议合并；确认是两家即可'
      : '请人工看一眼（同一道门 or 隔壁门），确认后再决定是否合并'
  ]))
  return {
    name: '需复核清单',
    aoa: [['复核阈值：同品牌且距离 ≤' + nearM + 'm', '', '', '', '', '', '', '', '', '', ''], head, ...rows],
    cols: [10, 24, 14, 12, 24, 14, 12, 10, 40, 34, 46]
  }
}

/** 说明页：把口径与红线一起交付，避免报告被断章取义 */
function notesSheet() {
  const rows = [
    ['这份报告怎么读'],
    [''],
    ['1. 门店结构（几何）', '只回答「密不密、有没有贴在一起」，不评价好坏。最近距离取「同品牌最近一家」，跨品牌不参与。'],
    ['2. 商圈信号灯', '用平台已落库的商圈面判断四条规则，给出「先看哪几家」。不调用任何实时人口接口。'],
    ['3. 盲区＝无法评估', '⛔ 不等于低风险。商圈面只覆盖建成区，园区、街边店常落在面外；这类门店在表里「风险分」留空。'],
    ['4. 城市无商圈面数据', '是平台覆盖问题，不是选址问题，不参与评估、不计入盲区。'],
    ['5. 双店型', '编码不同且面积差 2 倍以上，通常是同一商场旗下不同品牌门店，不建议合并。'],
    ['6. 自我蚕食', '按「本人门店」计数（不含集团可见子公司），因为问题问的是「你自己在这个商圈开了几家」。'],
    ['7. 竞争宽松度', '与「商圈洞察」同一份评分：分越高＝周边竞争越少；自家门店按 2 家计。'],
    ['8. 本报告不消耗配额', '全部为本地几何 + 存量商圈面计算，未调用联通/高德任何计费接口。']
  ]
  return { name: '说明', aoa: rows, cols: [22, 96] }
}

/**
 * 组装全部工作表
 * @param {object} input
 * @param {object} input.geo        buildStoreCheckup 的返回
 * @param {object} input.lights     buildStoreLights 的返回（含 lights 全量）
 * @param {object} input.completeness
 * @param {number} input.nearM
 * @param {string} input.generatedAt
 */
export function buildReportSheets({ geo, lights, completeness, nearM, generatedAt }) {
  const raw = [
    overviewSheet({ geo, lights, completeness, nearM, generatedAt }),
    lightsSheet({ lights }),
    pairsSheet({ geo, nearM }),
    notesSheet()
  ]
  // 🔴 每行补齐到同宽：标题行只有 1~2 个单元格，若放任参差，
  //   xlsx 里会出现「有的行最后一格在 C 列、有的在 B 列」的错列观感。
  //   宽度取「首行长度」与「列宽声明长度」的较大者。
  return raw.map((s) => {
    const width = Math.max(s.aoa[0].length, (s.cols || []).length)
    return {
      ...s,
      aoa: s.aoa.map(r => (r.length === width ? r : [...r, ...Array(width - r.length).fill('')])),
      cols: s.cols && s.cols.length === width ? s.cols : Array(width).fill(18)
    }
  })
}
