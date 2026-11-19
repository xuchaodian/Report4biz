/**
 * 「某品牌的周边竞品点集」—— 单一来源（v1.13.378）
 *
 * ── 为什么抽出来 ────────────────────────────────────────────────────────
 * 智能选址（批次 370）与候选点位初步分析（批次 378）都要回答「这个点周边有多少竞品」。
 * 两处若各写一条 SQL，迟早会出现「智能选址说有 12 家、初步分析说有 9 家」——
 * 而用户看不出哪边对（口径差在那个账号看得见哪些竞品上）。
 *
 * ── 口径（四段，缺一段数量就不对）────────────────────────────────────────
 * ① **可见域**：`readableUserIds` —— 竞品快照由集团下发（只下不上），
 *    子公司账号要能看到集团同步下来的竞品，否则「竞品 0 家」会变成绿灯。
 *    ⚠️ 这与门店/候选点位的口径**不同**：门店一律 `user_id = ?` 只本人可见（隐私红线），
 *    竞品是公共市场数据，不属同一件事。⛔ 不要把两者混成一套。
 * ② **品牌映射**：`resolveCompBrands` —— 自有品牌 → 该品牌的竞品集合（多品牌必配映射）。
 *    传空 ⇒ 全量竞品（三态语义见 competitorScope.js）。
 * ③ **在营过滤**：已关店/尚未营业的不算（否则一个关掉的店会永久占着一个竞品位）。
 * ④ **点集索引**：`buildPointIndex`（按纬度排序 + 二分扫窗，供 countWithin 用）。
 *
 * ⚠️ 本函数刻意**不吞异常**：选不出竞品时宁可直接 500，也不能静默返回「0 家竞品」
 *    —— 那会把「查不到」显示成「这里没有竞争」，是最危险的假绿灯。
 */
import { buildPointIndex } from './potentialGrid.js'
import { resolveCompBrands, competitorWhere } from './competitorScope.js'
import { readableUserIds } from './visibleScope.js'

/** 已关 / 未开业的竞品行不计入 */
const NOT_ACTIVE_SQL = `AND (status IS NULL OR status NOT IN ('店铺已关', '尚未营业'))`

/**
 * @param {object} db
 * @param {number} userId 查看者
 * @param {string} myBrand 自有品牌（可空 ⇒ 全量竞品）
 * @returns {{arr:Array, lats:number[]}} buildPointIndex 的结果
 */
export function loadCompetitorIndex(db, userId, myBrand) {
  const scopeIds = readableUserIds(db, userId)
  if (!scopeIds.length) return buildPointIndex([])
  const { sql, params } = competitorWhere(resolveCompBrands(db, userId, myBrand))
  const ph = scopeIds.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT id, brand, latitude, longitude FROM competitors
      WHERE user_id IN (${ph})${sql} ${NOT_ACTIVE_SQL}`
  ).all(...scopeIds, ...params)
  return buildPointIndex(rows)
}
