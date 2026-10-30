/**
 * 门店体检报告（Excel）的行数据构造（v1.13.298 起，v1.13.299 改半径口径）
 *
 * 纯函数：只做「页面数据 → 表格行」的映射，不碰 db / 不碰 xlsx 库，
 * 这样表头与口径可以被单测钉住 —— 导出的表必须和页面上看到的是同一批数字。
 *
 * 🔴 三条口径在导出里也不能走样：
 *   1. 没评的维度写「未评」，⛔ 不写「未命中」、风险分留空而不是 0；
 *   2. 竞争维度没有竞品点位时写「未评（该城市无竞品点位）」，⛔ 不能读成「0 家竞品 ⇒ 宽松」；
 *   3. 需复核清单里「双店型」必须写明**不建议合并**（同商场旗下不同品牌是常态）。
 */

const LEVEL_TEXT = { high: '红灯·高风险', mid: '黄灯·中风险', low: '绿灯·低风险', none: '绿灯·未发现问题' }
const STATUS_TEXT = {
  evaluated: '已评估',
  no_coord: '未评估（缺经纬度）'
}
const COMP_TEXT = {
  evaluated: '已评估',
  no_data: '未评（该城市无竞品点位）',
  no_city: '未评（门店城市为空）'
}
const FLAG_TEXT = {
  cannibal: '自我蚕食（同品牌贴身）',
  competition: '竞争密集（半径内竞品多）'
}
const SELF_BUCKET_TEXT = {
  same: '同址（<50m，非双店型）',
  sameDual: '同址双店型（不计分）',
  close: '贴身（50–300m）',
  overlap: '部分重叠（300–800m）',
  far: '>800m 或无同品牌'
}
const distText = (m) => (m == null ? '' : `${m}m`)

function flagsText(flags) {
  const list = (flags || []).map(f => FLAG_TEXT[f] || f)
  return list.length ? list.join('、') : '未命中'
}

/** 概览页：指标 / 值 / 补充 */
function overviewSheet({ geo, lights, completeness, nearM, generatedAt }) {
  const t = lights.thresholds || {}
  const d = lights.rules?.selfDetail || {}
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
    ['二、信号灯（按门店半径判定）', ''],
    ['红灯·高风险', lights.byLevel.high, `风险分 ≥${t.riskHigh ?? 5}（自我蚕食与竞争密度同时命中）`],
    ['黄灯·中风险', lights.byLevel.mid, `风险分 ${t.riskMid ?? 3}~${(t.riskHigh ?? 5) - 1}`],
    ['绿灯', lights.byLevel.low + lights.byLevel.none,
      `其中 ${lights.byLevel.none} 家未发现问题${lights.rules.competitionPartial ? `；另有 ${lights.rules.competitionPartial} 家竞争维度未评（绿灯只代表几何没问题）` : ''}`],
    ['未评估·缺经纬度', lights.noCoord, '没有坐标就没法算距离，⛔ 不是「低风险」'],
    ['', ''],
    ['规则①自我蚕食', lights.rules.cannibal,
      `同址 ${d.same || 0} · 贴身 ${d.close || 0} · 部分重叠 ${d.overlap || 0}；同址双店型 ${d.sameDual || 0} 家不计分`],
    ['规则②竞争密度', lights.rules.competition,
      `门店 ${t.compRadiusM ?? 800}m 内同业态竞品 ≥${t.compHigh ?? 6} 家 +3 / ≥${t.compMid ?? 3} 家 +2`],
    ['竞争维度已评估', lights.rules.competitionEvaluated, '该城市有竞品点位才能算'],
    ['竞争维度未评', (lights.rules.competitionNoData || 0) + (lights.rules.competitionNoCity || 0),
      `该城市无竞品点位 ${lights.rules.competitionNoData || 0} 家、门店城市为空 ${lights.rules.competitionNoCity || 0} 家 —— 未评 ≠ 竞争宽松`],
    ['扎堆组（同品牌两两 ≤' + (t.overlapM ?? 800) + 'm 连通）', lights.rules.cannibalDistricts,
      lights.rules.cannibalTop?.length
        ? `最挤：${lights.rules.cannibalTop.map(x => `${x.district} ${x.count} 家`).join('、')}`
        : '没有形成扎堆'],
    ['', ''],
    ['三、数据完备度', ''],
    ['销售记录（行）', completeness.salesRows, '不足 50 行时销售预测只能粗看；不足 150 行无法启用 L3'],
    ['门店区分（选址形态）为空', completeness.categoryEmpty, completeness.categoryEmptyReadonly ? `其中 ${completeness.categoryEmptyReadonly} 家为集团下发门店，需在集团侧补` : ''],
    ['缺营业面积', completeness.areaMissing, '缺面积无法判店型，也进不了销售预测'],
    ['缺经纬度', completeness.coordMissing, '没有坐标的门店不参与几何体检'],
    ['', ''],
    ['口径说明', '仅统计本人门店；跨品牌不判；同址双店型不计分；本次体检未消耗任何第三方数据配额。']
  ]
  return { name: '概览', aoa: rows, cols: [30, 28, 72] }
}

/** 信号灯明细：一行一家店（全量，不截断 —— 导出的价值就是拿得到全量） */
function lightsSheet({ lights }) {
  const head = ['门店', '品牌', '城市', '最近同品牌(m)', '最近同品牌门店', '同品牌800m内(家)',
    '竞品800m内(家)', '竞争维度', '风险分', '灯', '命中规则', '所在商圈（仅展示）', '商圈能级', '客群',
    '状态', '纬度', '经度']
  const rows = lights.lights.map(l => ([
    l.name || '',
    l.brand || '',
    l.city || '',
    distText(l.nearestM),
    l.nearestName || '',
    l.peers800 == null ? '' : l.peers800,
    l.compRing == null ? '' : l.compRing,
    COMP_TEXT[l.compStatus] || l.compStatus || '',
    // 🔴 没评估的留空，⛔ 不要写 0：写 0 会被人当成「零风险」
    l.riskScore == null ? '' : l.riskScore,
    // 🔴 绿灯但竞争维度没评时，灯这一格必须自己说出来
    //（否则导出件会被读成「竞争也查过了、没问题」）
    l.riskLevel
      ? (l.riskLevel === 'none' && l.partial
        ? `${LEVEL_TEXT.none}（竞争未评）`
        : (LEVEL_TEXT[l.riskLevel] || l.riskLevel))
      : '未评估',
    // 🔴 未评估的门店不能写「未命中」—— 那会被读成「查过了没问题」
    l.status === 'evaluated' ? flagsText(l.flags) : '—',
    l.district || '不在已导入商圈面内',
    l.districtLevel || '',
    l.crowd || '',
    STATUS_TEXT[l.status] || l.status || '',
    l.lat == null ? '' : l.lat,
    l.lng == null ? '' : l.lng
  ]))
  return { name: '信号灯明细', aoa: [head, ...rows], cols: [24, 12, 10, 14, 24, 14, 14, 24, 8, 16, 30, 22, 10, 12, 20, 11, 11] }
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
function notesSheet({ lights }) {
  const t = lights.thresholds || {}
  const rows = [
    ['这份报告怎么读'],
    [''],
    ['1. 判定单位是门店，不是商圈', `信号灯以门店坐标为圆心、按半径判：贴身 ≤${t.closeM ?? 300}m、部分重叠 ≤${t.overlapM ?? 800}m。⛔ 不用「在不在商圈面里」当判据 —— 单个商圈面 1~48 km²，会把整片区的拥挤程度当成某一家店的问题。`],
    ['2. 商圈只用于展示', '「所在商圈 / 能级 / 客群」三列只是让人认得这家店在哪，不参与打分，也不影响是否评估。门店落在面外时这三列为空，不影响结论。'],
    ['3. 门店结构（几何）', '只回答「密不密、有没有贴在一起」，不评价好坏。最近距离取「同品牌最近一家」，跨品牌不参与。'],
    ['4. 同址双店型不计分', '编码不同且面积差 2 倍以上的同址门店，通常是同一商场旗下的大店 + 小店组合，是客户的经营策略，硬判蚕食等于让客户去关真店。'],
    ['5. 竞争密度', `门店 ${t.compRadiusM ?? 800}m 内同业态竞品数：≥${t.compHigh ?? 6} 家 +3、≥${t.compMid ?? 3} 家 +2。竞品取本账号（含集团可见子公司）已导入的竞品点位。`],
    ['6. 未评 ≠ 低风险', '该城市没有竞品点位时，竞争维度记「未评」，既不加分也不给绿灯；缺经纬度的门店整行未评估。'],
    ['7. 本报告不消耗配额', '全部为本地几何计算 + 存量竞品点位，未调用联通/高德任何计费接口。']
  ]
  return { name: '说明', aoa: rows, cols: [26, 110] }
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
    notesSheet({ lights })
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

export { SELF_BUCKET_TEXT }
