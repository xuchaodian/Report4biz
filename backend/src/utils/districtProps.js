/**
 * 商圈属性归一化（v1.13.276）
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 商圈面数据的字段名换过一次，两代产物并存：
 *   · 2022 年度版：名称 / 居住人数 / 工作人数 / 到访人次 / 低收入人数 / … / RecID
 *   · 联通人口版 ：商圈名 / 居住 / 工作 / 到访 / 低收入 / … / biz_id
 *                + 新增 男总 / 女总 / A0_18…A70P / 客群 / 能级 / 居民类
 *
 * 下游（districts.js 的评分与列表、sales-forecast.js 的商圈画像向量、前端对比表）
 * 全部按**旧名精确匹配**取数。若不做归一化，新数据接入后 `Number(props['居住人数'])`
 * 会静默拿到 undefined ⇒ 评分的「人口规模」整项恒 22 分、销售预测的环境向量全 0，
 * **不报错、只是结果错**，这是最难发现的一类故障。
 *
 * ── 契约（改动前必读）──────────────────────────────────────────────────
 * ① 归一化后的对象**一律用旧名做 key**（名称 / 居住人数 / …），数值仍保持字符串，
 *    与历史产物一致 ⇒ 下游一行不用改。
 * ② 已被用作别名的源字段不再重复保留（否则 payload 里 居住 与 居住人数 各一份）。
 * ③ 未映射的新字段（男总/女总/年龄段/客群/能级/居民类）原样透传。
 * ④ ⛔ 不要把本函数当「缺失填 0」用：取不到就**不写这个 key**，让下游的
 *    `Number(undefined) || 0` 自己决定默认值（缺数据恒 null/0 的既有口径见 MEMORY）。
 */

/** 归一化目标 key → 可接受的源字段名（**顺序即优先级**） */
const ALIASES = {
  名称: ['名称', '商圈名', 'name', 'Name', 'NAME'],
  居住人数: ['居住人数', '居住', '常住人口'],
  工作人数: ['工作人数', '工作'],
  到访人次: ['到访人次', '到访'],
  低收入人数: ['低收入人数', '低收入'],
  // ⚠️ '中等' 与 '中产' 是两个不同档位，不可互相当别名
  中等收入人: ['中等收入人', '中等'],
  小康人数: ['小康人数', '小康'],
  中产人数: ['中产人数', '中产'],
  富裕人数: ['富裕人数', '富裕'],
  富人人数: ['富人人数', '富人'],
  省份: ['省份'],
  城市: ['城市'],
  区县: ['区县'],
  RecID: ['RecID', 'biz_id'],
  客群: ['客群'],
  能级: ['能级'],
  居民类: ['居民类', '居民特征']
}

/** 所有别名 + 所有归一化 key —— 用于「哪些源字段已被消费」的判定 */
const HANDLED = new Set(
  Object.values(ALIASES).flat().concat(Object.keys(ALIASES))
)

function isBlank(v) {
  return v === undefined || v === null || v === ''
}

/**
 * 商圈属性归一化。入参/返回都是「字段名 → 字符串值」的扁平对象。
 * 返回**新对象**，不修改入参（feature.properties 会被多处复用）。
 */
export function normalizeDistrictProps(raw) {
  const src = raw || {}
  const out = {}
  for (const [canon, names] of Object.entries(ALIASES)) {
    for (const n of names) {
      if (!isBlank(src[n])) {
        out[canon] = src[n]
        break
      }
    }
  }
  // 透传未映射字段（性别 / 年龄段 / 客群等画像列）
  for (const k of Object.keys(src)) {
    if (HANDLED.has(k) || k in out) continue
    out[k] = src[k]
  }
  return out
}

/** 取字符串（缺失返回 ''，不返回 undefined，便于直接拼到 payload） */
export function dstr(props, key) {
  const v = props?.[key]
  return isBlank(v) ? '' : String(v)
}

/** 取数值（缺失返回 null —— 刻意不返回 0，让调用方能区分「没有」与「是 0」） */
export function dnum(props, key) {
  const v = props?.[key]
  if (isBlank(v)) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
