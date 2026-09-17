// ============================================================================
// 同步内核 syncCore（批次 D · 设计方案 v0.10 §4 / §6 / §8；批次 E 扩到 competitors）
// ----------------------------------------------------------------------------
// 服务对象（`SYNC_KINDS`）：
//   · `markers`              我的门店       （批次 D 跑通全链路）
//   · `competitors`          竞品门店       （批次 E 横向复用 —— §11 实施建议：
//                             「先把单对象全链路跑通，确认无误后再横向复用」）
//   · `competitor_snapshots` 竞品期次快照   （v0.13 P2/R3 —— **特例**，见 §5b）
//   前两个按表名泛化：内核只把 `kind` 当作**表名**使用，字段由 PRAGMA 内省得出
//   ⇒ 新增同类对象只需加进 SYNC_KINDS，无需改本文件的同步逻辑。
//
// ⚠️ 竞品快照为什么是「特例」而不是「再加一个表名」：
//   它要搬的是**两张表**——头表 `competitor_snapshots`（有 user_id）+ 明细表
//   `competitor_snapshot_rows`（**没有 user_id**，靠 snapshot_id 归属）。
//   泛化的前提「每行都有 user_id」在此不成立，硬套会退化成「只同步空的头表」。
//   故 §5b 单开一段专写它，并把方向约束为**只下不上**（子公司不自行上传，见规则 35）。
//   泛化路径（markers/competitors）**逐字未动** —— 回归风险最小。
//
// ★ 本模块「零业务 import」：只从 scopeGuard 取纯函数（其自身零 import）。
//   目的与 quotaGate/scopeGuard 相同 —— 可在生产直接 `import()` 做自检，
//   不会触发 getDb() 把 166MB 真库读进内存（历史上曾因此 OOM 连坐 pm2+sshd）。
//   所有需要数据库的操作一律**显式收 db 参数**。
//
// 实现的规则（§8 规则总表）：
//   规则 1  组织边界：调用方（routes/sync.js）负责，本模块只认 source/target 两个 userId
//   规则 2  幂等：靠唯一索引 ux_<table>_origin(user_id, origin_user_id, origin_row_id)
//   规则 3  防回环：跳过 origin_user_id === 目标账号 的源行（否则 A→B→A 无限膨胀）
//   规则 4  写权唯一：目标侧镜像行 sync_readonly=1，只由本内核改写
//   规则 6  删除传播：源侧行消失 → 目标侧镜像列为 deleted，**必须走预览确认**
//   规则 8  期次隔离：period / snapshot_id 不复制（同步行以「手工行」身份存在）
//   规则 9  审计留痕：每次同步写 sync_batches（操作人 + IP + 逐行明细）
//   规则 11 管辖范围：只同步 city ∈ scope.cities 或 belong = 本人的行；越界**静默丢弃并计数**
//   规则 13 城市兜底：city 为空的行不参与范围圈定（只能靠 belong 显式归属）
//   规则 15 原子性：commit 的全部写入在**单事务**内，任一步失败整体回滚
//   规则 34 业务键判重：命中目标账号已有行 ⇒ 只提示不写入（先到先得）
//   规则 35 快照单向下行：竞品期次快照只允许 `group_to_member`；明细按成员管辖城市过滤
//           后随头表下发，头表 total_count/open_count 改写为**本辖区**口径
//   规则 36 明细随头表：快照明细无 user_id/溯源列，其归属与只读性**完全跟随头表**
//           ⇒ 头表删除/回滚/脱离时必须连带明细，否则留下永久孤儿行
//
// ⚠️ **同步**（buildPlan/applyPlan）不迁移 store_sales：同步是「复制行」，不是「划拨」。
//   镜像门店在目标账号下**没有销售历史** —— 这是刻意的边界，不要为了「看起来完整」
//   而顺手复制 store_sales（会让同一份历史被两个账号各持一份）。
//   **辖区划拨**（第 9 节 buildTransferPlan/applyTransfer）则相反：它把**同一行**的
//   归属改判给别人，因此必须在同一事务里把 store_sales.user_id 一起改（规则 15），
//   否则销售预测按 WHERE user_id=? 查不到这些店的历史，表现为「数据凭空消失」。
// ============================================================================

import { normalizeCity, parseCityList, parseBrandList } from './scopeGuard.js'

/** 竞品期次快照：内核里唯一的「特例对象」（两表一起搬），见 §5b */
export const SNAPSHOT_KIND = 'competitor_snapshots'
/** 快照明细表（无 user_id —— 靠 snapshot_id 归属，禁止泛化路径碰它） */
export const SNAPSHOT_ROWS_TABLE = 'competitor_snapshot_rows'

/** 可同步对象 = 目标表名白名单（顺序即 UI 展示顺序） */
export const SYNC_KINDS = ['markers', 'competitors', SNAPSHOT_KIND]

/**
 * 「行级对象」= 每行自带 `user_id`、可逐行圈城市/可划拨的对象。
 *
 * ⛔ 快照**不在其中**：头表没有 city 列（城市在明细行上），明细表连 user_id 都没有。
 *   划拨（§9）那套 `WHERE user_id=? / city` 逻辑套到快照上会直接 SQL 报错，
 *   语义上也不该搬 —— 它是集团按季下发的**全国档案**，与「某城市门店归谁」无关。
 *   ⇒ 凡「按城市搬行 / 按行删镜像」的地方一律用本清单，不要用 SYNC_KINDS。
 */
export const ROW_KINDS = ['markers', 'competitors']

/**
 * 对象元数据（前端展示用；`GET /api/sync/scope-options` 会回传给 UI）。
 * 新增对象时这里与 SYNC_KINDS 一起加。
 */
export const KIND_META = {
  markers: { label: '我的门店', short: '门店', field: 'markers', table: 'markers' },
  competitors: { label: '竞品门店', short: '竞品', field: 'competitors', table: 'competitors' },
  // 每个 item 代表**一期快照**（不是一家店）⇒ 前端表格要按期次渲染，见 DataSyncView
  [SNAPSHOT_KIND]: {
    label: '竞品期次快照', short: '快照', field: 'snapshots', table: SNAPSHOT_KIND,
    unit: '期', downloadOnly: true
  }
}

/** kind → 中文标签（未知 kind 原样返回，便于排查） */
export function kindLabel(kind) {
  return KIND_META[kind]?.label || String(kind || '')
}

/** 规范化调用方传来的 kinds（去非法值；空 → 默认第一个对象，保持批次 D 的旧行为） */
export function normalizeKinds(input) {
  const arr = Array.isArray(input)
    ? input.map(s => String(s).trim())
    : String(input || '').split(',').map(s => s.trim())
  const valid = arr.filter(k => SYNC_KINDS.includes(k))
  return valid.length ? [...new Set(valid)] : [SYNC_KINDS[0]]
}

export const DIRECTIONS = {
  GROUP_TO_MEMBER: 'group_to_member',   // 集团下发（源=集团账号，目标=成员）
  MEMBER_TO_GROUP: 'member_to_group'    // 集团拉取（源=成员，目标=集团账号）
}

/**
 * 不参与同步的列（黑名单）。其余列按目标表**实际结构**自动纳入。
 *
 * 为什么用「内省 + 黑名单」而不是硬编码字段白名单：
 *   生产 `markers` 有 41 列，而 models/database.js 的 CREATE TABLE 只有 36 列
 *   （frontage/store_area/store_status/mall_type/trade_area_type 是历史 ALTER 加上去的，
 *    代码里的建表语句已漂移）→ 硬编码白名单会**静默漏字段**。
 */
const BLACKLIST = new Set([
  'id',
  'user_id',
  'created_at',
  'updated_at',
  // 来源与归属（目标侧自己维护，绝不由源侧覆盖）
  'origin_user_id', 'origin_row_id', 'origin_owner', 'sync_batch_id',
  'sync_readonly', 'belong_member_user_id', 'group_note',
  // 城市兜底来源（「本行 city 是怎么来的」属**本地派生信息**，不是业务字段 ——
  //  源侧写着 geocoded 不代表镜像这一份也是反查来的）
  'city_source',
  // 竞品期次隔离（规则 8）
  'period', 'snapshot_id'
])

/** 单批明细上限：超过则截断入库（计数仍精确），避免 preview 写盘把库撑大 */
export const DETAIL_SAMPLE_LIMIT = 100
/** 单次同步处理行数上限（安全阀；正常量级 < 2000） */
export const MAX_PLAN_ROWS = 5000

// ---------------------------------------------------------------------------
// 1. 结构内省
// ---------------------------------------------------------------------------

/** 读目标表真实列名（PRAGMA table_info） */
export function tableColumns(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() || []
  return rows.map(r => r.name)
}

/** 可同步字段 = 真实列 − 黑名单 */
export function syncableFields(db, table) {
  return tableColumns(db, table).filter(c => !BLACKLIST.has(c))
}

// ---------------------------------------------------------------------------
// 2. 值比较 / 差异
// ---------------------------------------------------------------------------

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/**
 * 宽松相等：SQLite 里同一个值可能是 3 / '3' / 3.0，也可能 '' / null 混用。
 * 目的不是「数据完全一致」，而是**别把等价写法报成变更**（否则每次都刷出上百条假更新）。
 */
export function looseEqual(a, b) {
  if (isBlank(a) && isBlank(b)) return true
  if (isBlank(a) || isBlank(b)) return false
  if (a === b) return true
  const na = Number(a)
  const nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb
  return String(a) === String(b)
}

/** 返回 [{field, from(目标现值), to(源侧值)}]，from/to 均取「人看得懂」的空值写法 */
export function diffFields(fields, sourceRow, mirrorRow) {
  const changes = []
  for (const f of fields) {
    if (!looseEqual(sourceRow[f], mirrorRow[f])) {
      changes.push({
        field: f,
        from: isBlank(mirrorRow[f]) ? null : mirrorRow[f],
        to: isBlank(sourceRow[f]) ? null : sourceRow[f]
      })
    }
  }
  return changes
}

// ---------------------------------------------------------------------------
// 2b. 业务键判重（v0.13 R2 · 规则 34）
// ---------------------------------------------------------------------------
//
// 指针匹配（user_id + origin_user_id + origin_row_id）回答的是「这行是不是从那边来的」，
// 它**回答不了**「这是不是同一家门店」。于是三种情况会凭空多出一份副本：
//   · 目标账号自己录过某店，而这店源侧库里本来就有（只是没同步下来）
//   · 两家账号都录了同一家店
//   · 划拨之后新持有方又录了一遍
// 故在指针匹配之外补一层**业务键**兜底：`store_code` 优先，缺失时回退
// `name + city + address` 归一化组合。
//
// ★ 命中已有行时**只提示、不写入**（先到先得）：
//   目标侧那条行**不是本源的镜像**（origin_user_id 为空或属于别人），
//   直接 UPDATE 会破坏「一源一镜像」的单写者语义（规则 4）。
//   所以记入 `items.duplicate` + `counts.duplicate` ——
//   ⛔ **绝不静默丢弃**（静默丢弃是本系统已经踩过的坑，见规则 11 的 outOfScope）。

/** 判重专用文本归一化：去全部空白 + 小写（不做全角/半角转换，保持可解释） */
function normKeyText(v) {
  return String(v === null || v === undefined ? '' : v).trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 业务键。返回 `null` = 「这行的信息量不足以判重」——宁可不判，也不误判。
 *
 * ① `store_code` 非空 ⇒ 用它，并**带上 brand 前缀**：
 *    竞品表里 6 个品牌各有自己的门店编号体系，只比 code 会把「老乡鸡 #100」
 *    和「米村拌饭 #100」判成同一家 ⇒ 漏同步（比多一份副本更糟：那是**丢数据**）。
 * ② 回退 `name + city + address`：要求 name 非空，且 city / address **至少有一个**。
 *    只有名字的键（「星巴克」）太弱，连锁品牌必然误判。
 * @returns {{key:string, by:'store_code'|'name_city_address'}|null}
 */
export function businessKeyOf(row) {
  const code = normKeyText(row && row.store_code)
  if (code) {
    const brand = normKeyText(row && row.brand)
    return { key: `code:${brand}|${code}`, by: 'store_code' }
  }
  const name = normKeyText(row && row.name)
  if (!name) return null
  const city = normalizeCity(row && row.city)
  const addr = normKeyText(row && row.address)
  if (!city && !addr) return null
  return { key: `nca:${name}|${city}|${addr}`, by: 'name_city_address' }
}

/**
 * 目标账号的**业务键索引**（一次性读全表；源行逐行查库在 5000 行量级下太贵）。
 *
 * ★ 索引**包含目标账号的全部行**（自建行 + 各来源镜像）——判重问的是
 *   「这个账号里是不是已经有这家店」，与那行是谁同步来的无关。
 * ★ 同键多行时保留 **id 最小**的那条（先到先得），其余计入 `shadowed`，
 *   供 UI 提示「该账号内本来就存在重复行」。
 *
 * @returns {{ map:Map<string,object>, shadowed:number }}
 */
function buildBusinessKeyIndex(db, kind, targetUserId) {
  const rows = db.prepare(`
    SELECT id, name, store_code, brand, city, address,
           origin_user_id, origin_owner, origin_row_id
      FROM ${kind} WHERE user_id = ?
     ORDER BY id
  `).all(targetUserId) || []

  const map = new Map()
  let shadowed = 0
  for (const r of rows) {
    const bk = businessKeyOf(r)
    if (!bk) continue
    if (map.has(bk.key)) { shadowed++; continue }
    map.set(bk.key, { id: r.id, row: r, by: bk.by, synthetic: false })
  }
  return { map, shadowed }
}

// ---------------------------------------------------------------------------
// 3. 范围判定（规则 11 / 13）
// ---------------------------------------------------------------------------

/**
 * 该行是否落在允许同步的范围内。
 * @param scope.cities        string[]  管辖城市（归一化后比较）
 * @param scope.brands        string[]  品牌白名单；**留空 = 不限**
 * @param belongUserId        number    显式归属成员（belong_member_user_id 命中即放行）
 */
export function inAllowedScope(row, { cityKeys, brands, belongUserId } = {}) {
  if (belongUserId && Number(row.belong_member_user_id) === Number(belongUserId)) return true

  const ck = normalizeCity(row.city)
  if (!ck) return false                       // city 为空 → 无法按范围圈定（规则 13）
  if (!cityKeys || cityKeys.size === 0) return false
  if (!cityKeys.has(ck)) return false

  if (brands && brands.size > 0) {
    const b = String(row.brand ?? '').trim()
    if (!brands.has(b)) return false
  }
  return true
}

/** 由 org_members.scope_json 构造判定所需的结构体 */
export function buildScopeMatcher(scopeJson, belongUserId) {
  const cities = parseCityList(scopeJson)
  const brands = parseBrandList(scopeJson)
  const cityKeys = new Set(cities.map(normalizeCity).filter(Boolean))
  return { cityKeys, brands: new Set(brands.map(b => String(b).trim()).filter(Boolean)), belongUserId, cities, brandList: brands }
}

function matchKeyword(row, keyword) {
  if (!keyword) return true
  const k = String(keyword).trim().toLowerCase()
  if (!k) return true
  const hay = [row.name, row.store_code, row.brand, row.address, row.city]
    .map(v => String(v ?? '').toLowerCase())
    .join('\u0001')
  return hay.includes(k)
}

// ---------------------------------------------------------------------------
// 4. 成员开关（§D5 / 隐私合规）
// ---------------------------------------------------------------------------

/**
 * 方向 × 成员开关。成员可自行关闭，关闭后对应方向一律拒绝。
 * 返回 { ok } 或 { ok:false, code, message }。
 */
export function checkMemberSwitch(member, direction) {
  if (!member) return { ok: false, code: 'not_member', message: '该账号不是本集团成员' }
  const canReceive = Number(member.can_receive ?? 1) !== 0
  const allowPull = Number(member.allow_group_pull ?? 1) !== 0
  if (direction === DIRECTIONS.GROUP_TO_MEMBER && !canReceive) {
    return { ok: false, code: 'member_can_receive_off', message: '该子公司已关闭「接收集团下发」' }
  }
  if (direction === DIRECTIONS.MEMBER_TO_GROUP && !allowPull) {
    return { ok: false, code: 'member_pull_off', message: '该子公司已关闭「允许集团拉取」' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 5. 候选 / 计划
// ---------------------------------------------------------------------------

/**
 * 预览/候选列表要回传给前端的展示字段（**只挑两边都常见的**，缺失的自动跳过）。
 * 多出来的字段不会进 SQL —— 它只影响 UI 表格列。
 */
const KEY_ATTRS = [
  'name', 'store_code', 'brand', 'city', 'district', 'address',
  'store_type', 'store_status', 'status', 'area', 'trading_area'
]

function pickAttrs(row) {
  const out = {}
  for (const k of KEY_ATTRS) if (row[k] !== undefined) out[k] = row[k]
  return out
}

/**
 * 生成同步计划（**只读，不写任何表**）。
 *
 * 统一模型：源侧是权威，目标侧是镜像。
 *   group_to_member → 源 = 集团账号，目标 = 成员
 *   member_to_group → 源 = 成员，    目标 = 集团账号
 * 两个方向共用同一套判定，避免两套逻辑各自漂移。
 *
 * @returns {{items, counts, fields, sourceName}}
 *   items.added    [{key, kind, rowId, ...attrs, originOwner}]
 *   items.updated  [{key, kind, rowId, mirrorRowId, ...attrs, changes[]}]
 *   items.deleted  [{key, kind, mirrorRowId, ...attrs, reason}]
 *   items.skipped  [{kind, rowId, name, reason}]  reason: self_origin | no_change | gone
 *   items.duplicate [{key, kind, rowId, matchedRowId, matchedIsLocal, by, ...attrs}]
 *        —— 业务键命中（规则 34）：目标账号里已有同一家店（先到先得），**不写入**，
 *           只提示。`by` = store_code | name_city_address；`matchedIsLocal` = 命中行是否为
 *           目标账号自建（true 表示「你自己早就录过这家」）。
 *   counts.outOfScope / outOfFilter  —— 静默丢弃计数（规则 11：不报错，但要让用户看得见）
 */
export function buildPlan(db, opts) {
  const {
    kind = 'markers',
    direction,
    sourceUserId,
    targetUserId,
    scopeJson = null,
    belongUserId = null,
    keyword = '',
    targetLabel = ''
  } = opts || {}

  // ★ 特例分派：竞品期次快照（§5b）。两表一起搬，泛化路径（单表 + WHERE user_id）不适用。
  if (kind === SNAPSHOT_KIND) return buildSnapshotPlan(db, opts)

  const fields = syncableFields(db, kind)
  const matcher = buildScopeMatcher(scopeJson, belongUserId)

  const sourceRows = db.prepare(`SELECT * FROM ${kind} WHERE user_id = ?`).all(sourceUserId) || []

  const items = { added: [], updated: [], deleted: [], skipped: [], duplicate: [] }
  const counts = {
    added: 0, updated: 0, deleted: 0, skipped: 0, duplicate: 0,
    outOfScope: 0, outOfFilter: 0, selfOrigin: 0, noChange: 0, total: 0,
    duplicateShadowed: 0,    // 目标账号内本来就存在的重复行（只提示，不进计划）
    // 安全阀溢出计数（v1.13.147 从 outOfFilter 里拆出来）——
    // 原实现把「超过 MAX_PLAN_ROWS」折进 outOfFilter，语义是「关键词没匹配上」，
    // 于是界面上完全看不出「被截断」：用户只看到总数少了一截、**没有任何提示**。
    truncated: 0,
    // 快照专有维度（泛化对象恒为 0，保持键齐全便于各对象计数加总）
    detailRows: 0, detailOutOfScope: 0, detailOutOfFilter: 0, directionBlocked: 0, periodFiltered: 0
  }

  const sourceIds = new Set()
  let processed = 0

  // ★ 业务键索引（v0.13 R2）：循环前一次性建好 ⇒ O(1) 命中；
  //   本批新增的行会**就地补进索引**，让「源侧自己就有重复」也在第一轮拦住。
  const bkIndex = buildBusinessKeyIndex(db, kind, targetUserId)

  for (const row of sourceRows) {
    // 防回环（规则 3）：该行本来就是「目标账号同步过来的镜像」，再拉回去会重复
    if (row.origin_user_id != null && Number(row.origin_user_id) === Number(targetUserId)) {
      counts.selfOrigin++
      counts.skipped++
      items.skipped.push({ kind, rowId: row.id, name: row.name, reason: 'self_origin' })
      continue
    }

    // 范围约束（规则 11）：越界静默丢弃 —— 不报错，只计数
    if (!inAllowedScope(row, matcher)) { counts.outOfScope++; continue }
    if (!matchKeyword(row, keyword)) { counts.outOfFilter++; continue }

    // 安全阀（MAX_PLAN_ROWS）：**显式计数**，不再混进 outOfFilter（否则完全静默，见 counts 注释）
    if (processed >= MAX_PLAN_ROWS) { counts.truncated++; continue }
    processed++
    sourceIds.add(row.id)

    const mirror = db.prepare(`
      SELECT * FROM ${kind}
       WHERE user_id = ? AND origin_user_id = ? AND origin_row_id = ?
    `).get(targetUserId, sourceUserId, row.id)

    if (!mirror) {
      // ---- 二级兜底：业务键判重（规则 34）----
      const bk = businessKeyOf(row)
      const dup = bk ? bkIndex.map.get(bk.key) : null
      if (dup) {
        counts.duplicate++
        items.duplicate.push({
          key: `duplicate:${row.id}`, kind, rowId: row.id,
          matchedRowId: dup.synthetic ? null : dup.id,
          matchedOriginUserId: dup.synthetic ? sourceUserId : (dup.row.origin_user_id ?? null),
          matchedOriginOwner: dup.synthetic ? targetLabel : (dup.row.origin_owner ?? null),
          matchedIsLocal: !dup.synthetic && dup.row.origin_user_id == null,
          by: bk.by,
          ...pickAttrs(row)
        })
      } else {
        counts.added++
        items.added.push({
          key: `added:${row.id}`, kind, rowId: row.id,
          originOwner: targetLabel,
          ...pickAttrs(row)
        })
        // 本批新增的行补进索引（synthetic）：同批内后出现的同键行判重复，先到先得
        if (bk) bkIndex.map.set(bk.key, { id: null, row, by: bk.by, synthetic: true })
      }
    } else {
      const changes = diffFields(fields, row, mirror)
      if (changes.length === 0) {
        counts.noChange++
        counts.skipped++
        items.skipped.push({ kind, rowId: row.id, name: row.name, reason: 'no_change' })
      } else {
        counts.updated++
        items.updated.push({
          key: `updated:${mirror.id}`, kind, rowId: row.id, mirrorRowId: mirror.id,
          ...pickAttrs(row), changes
        })
      }
    }
  }

  // 反向扫描：目标侧由本源产生的镜像行，若源行已不存在 → 删除传播（规则 6）
  const mirrors = db.prepare(`
    SELECT * FROM ${kind} WHERE user_id = ? AND origin_user_id = ?
  `).all(targetUserId, sourceUserId) || []

  for (const m of mirrors) {
    if (m.origin_row_id != null && sourceIds.has(m.origin_row_id)) continue
    // ⚠️ 只有「源行真的没了」才算删除。源行仍在、只是**被收窄的 scope 挡在范围外**的行
    //   刻意不删（保守）：收窄管辖范围属配置动作，不应连带销毁目标侧已有镜像 —— 
    //   那会让子公司「改一次范围就丢一批数据」。要清理请显式走「移除外来副本」。
    const stillExists = m.origin_row_id == null
      ? false
      : !!db.prepare(`SELECT 1 FROM ${kind} WHERE id = ? AND user_id = ?`).get(m.origin_row_id, sourceUserId)
    if (stillExists) continue

    counts.deleted++
    items.deleted.push({
      key: `deleted:${m.id}`, kind, mirrorRowId: m.id,
      ...pickAttrs(m), reason: m.origin_row_id == null ? 'orphan' : 'source_removed'
    })
  }

  counts.duplicateShadowed = bkIndex.shadowed
  counts.total = counts.added + counts.updated + counts.deleted + counts.skipped + counts.duplicate
  // scopeJson/keyword 一并回传：`applyPlan` 要**重建**范围过滤器
  // （快照明细的按城市过滤发生在 apply 阶段，必须与预览同一套口径，否则「预览 650、落库 1905」）
  return { kind, direction, sourceUserId, targetUserId, fields, items, counts, scopeJson, belongUserId, keyword }
}

/**
 * 多对象计划（批次 E）：对每个 kind 各跑一次 `buildPlan` 后**合并**。
 *
 * 为什么需要它：UI 的「数据范围」是复选框（`[✓]我的门店 [✓]竞品门店`），
 * 用户在**一次**预览/确认里跨对象同步 ⇒ 内核必须能表达「一个批次 = 多个对象」。
 * 每个 item 自带 `kind`，`applyPlan` 据此取各自表的字段与 INSERT 语句。
 *
 * ★ 为什么不把 kinds 塞进 buildPlan 内部、循环写进同一份 items：
 *   单对象路径（批次 D 已验证）保持**逐字不变**，回归风险最小 ——
 *   `buildPlan` 仍是唯一真源，本函数只做编排与合并。
 *
 * @returns 与 buildPlan 同构，另加：
 *   kinds         string[]                 实际参与的对象
 *   fieldsByKind  { [kind]: string[] }     各对象的可同步字段
 *   counts.byKind { [kind]: counts }       各对象的计数明细
 */
export function buildPlanForKinds(db, opts) {
  const kinds = normalizeKinds(opts?.kinds ?? opts?.kind)
  const {
    direction, sourceUserId, targetUserId, scopeJson = null, belongUserId = null,
    keyword = '', targetLabel = '', periods = []
  } = opts || {}

  const parts = kinds.map(kind => buildPlan(db, {
    kind, direction, sourceUserId, targetUserId, scopeJson, belongUserId, keyword, targetLabel, periods
  }))

  const fieldsByKind = {}
  const byKind = {}
  const items = { added: [], updated: [], deleted: [], skipped: [], duplicate: [] }
  const counts = {
    added: 0, updated: 0, deleted: 0, skipped: 0, duplicate: 0,
    outOfScope: 0, outOfFilter: 0, selfOrigin: 0, noChange: 0, total: 0, byKind,
    duplicateShadowed: 0, truncated: 0,
    detailRows: 0, detailOutOfScope: 0, detailOutOfFilter: 0, directionBlocked: 0, periodFiltered: 0
  }

  for (const p of parts) {
    fieldsByKind[p.kind] = p.fields
    byKind[p.kind] = p.counts
    for (const bucket of ['added', 'updated', 'deleted', 'skipped', 'duplicate']) items[bucket].push(...p.items[bucket])
    for (const k of [
      'added', 'updated', 'deleted', 'skipped', 'duplicate', 'outOfScope', 'outOfFilter',
      'selfOrigin', 'noChange', 'total', 'duplicateShadowed', 'truncated',
      'detailRows', 'detailOutOfScope', 'detailOutOfFilter', 'directionBlocked', 'periodFiltered'
    ]) {
      counts[k] += p.counts[k] || 0
    }
  }

  return {
    kind: kinds[0],           // 向下兼容：单对象读者仍可用
    kinds,
    direction,
    sourceUserId,
    targetUserId,
    fields: fieldsByKind[kinds[0]] || [],
    fieldsByKind,
    items,
    counts,
    // ★ 供 `applyPlan` 重建范围过滤器：快照明细的按城市过滤发生在 apply 阶段，
    //   必须与预览时**同一套口径**，否则「预览 650 行、落库 1905 行」。
    scopeJson,
    belongUserId,
    keyword,
    periods
  }
}

/**
 * 候选列表（UI「本次筛选 → 候选 N 家」）。
 * 与 buildPlan 同源判定，避免「候选数」和「预览数」对不上。
 */
export function listCandidates(db, opts) {
  const {
    kind = 'markers',
    sourceUserId,
    targetUserId,
    scopeJson = null,
    belongUserId = null,
    keyword = ''
  } = opts || {}

  // ★ 特例分派：竞品期次快照（§5b）
  if (kind === SNAPSHOT_KIND) return listSnapshotCandidates(db, opts)

  const matcher = buildScopeMatcher(scopeJson, belongUserId)
  const rows = db.prepare(`SELECT * FROM ${kind} WHERE user_id = ?`).all(sourceUserId) || []

  const inScope = []
  let outOfScope = 0
  let outOfFilter = 0
  let selfOrigin = 0
  let duplicate = 0
  // 与 buildPlan 同源的业务键索引 —— 「候选 N 家」与「预览 N 行」必须对得上
  const bkIndex = buildBusinessKeyIndex(db, kind, targetUserId)

  for (const row of rows) {
    if (row.origin_user_id != null && Number(row.origin_user_id) === Number(targetUserId)) { selfOrigin++; continue }
    if (!inAllowedScope(row, matcher)) { outOfScope++; continue }
    if (!matchKeyword(row, keyword)) { outOfFilter++; continue }

    const mirror = db.prepare(`
      SELECT id FROM ${kind} WHERE user_id = ? AND origin_user_id = ? AND origin_row_id = ?
    `).get(targetUserId, sourceUserId, row.id)

    let dup = null
    if (!mirror) {
      const bk = businessKeyOf(row)
      if (bk) {
        dup = bkIndex.map.get(bk.key) || null
        if (!dup) bkIndex.map.set(bk.key, { id: null, row, by: bk.by, synthetic: true })
      }
    }
    if (dup) duplicate++

    inScope.push({
      kind,                       // 多对象批次下前端据此标注「门店 / 竞品」
      rowId: row.id,
      mirrorRowId: mirror ? mirror.id : null,
      mirrorState: mirror ? 'synced' : (dup ? 'duplicate' : 'new'),
      duplicateOfRowId: dup && !dup.synthetic ? dup.id : null,
      duplicated: !!dup,
      ...pickAttrs(row)
    })
  }

  return { kind, total: rows.length, inScope, outOfScope, outOfFilter, selfOrigin, duplicate }
}

/**
 * 多对象候选（批次 E）—— 与 `buildPlanForKinds` 对称，供 UI 的「候选 N 家」使用。
 * 每个候选项带 `kind`，计数按对象拆开（byKind）便于前端分行展示。
 */
export function listCandidatesForKinds(db, opts) {
  const kinds = normalizeKinds(opts?.kinds ?? opts?.kind)
  const base = {
    sourceUserId: opts?.sourceUserId,
    targetUserId: opts?.targetUserId,
    scopeJson: opts?.scopeJson ?? null,
    belongUserId: opts?.belongUserId ?? null,
    keyword: opts?.keyword || ''
  }
  const parts = kinds.map(kind => listCandidates(db, { kind, ...base }))

  const out = {
    kinds, total: 0, inScope: [], outOfScope: 0, outOfFilter: 0, selfOrigin: 0, duplicate: 0,
    detailRows: 0, byKind: {}
  }
  for (const p of parts) {
    out.byKind[p.kind] = {
      total: p.total, inScope: p.inScope.length,
      outOfScope: p.outOfScope, outOfFilter: p.outOfFilter, selfOrigin: p.selfOrigin,
      duplicate: p.duplicate,
      detailRows: p.detailRows || 0    // 快照：本辖区的明细行数（「N 期 / M 行」要分开说）
    }
    out.total += p.total
    out.inScope.push(...p.inScope)
    out.outOfScope += p.outOfScope
    out.outOfFilter += p.outOfFilter
    out.selfOrigin += p.selfOrigin
    out.duplicate += p.duplicate
    out.detailRows += p.detailRows || 0
  }
  return out
}

// ---------------------------------------------------------------------------
// 5b. 竞品期次快照（特例对象 · 规则 35 / 36）
// ---------------------------------------------------------------------------
//
// 搬什么：头表 `competitor_snapshots`（源账号名下的期次档案）
//        + 明细表 `competitor_snapshot_rows`（该期全量门店行，含闭店行）
//
// 为什么必须单独写一遍、不能用泛化路径：
//   ① 明细表**没有 user_id** ⇒ 泛化的 `WHERE user_id = ?` 对它无意义；
//      它的归属只有 `snapshot_id` 一个来源 ⇒ 头表搬到哪、明细跟到哪（规则 36）。
//   ② 交付单位是**期次**不是行：源侧一期是「全国 207 城」，目标侧只该拿自己辖区那份
//      ⇒ 头表 total_count/open_count **必须按实际落库行数重算**，否则监测面板会
//      出现「写着 1905 家、列表只有 650 家」的错乱。源侧全国口径另存
//      origin_total_count/origin_open_count，供 UI 显示「本辖区 650 / 全国 1905」。
//   ③ 判重键不同：**品牌 + 期次**（正是头表的 UNIQUE(user_id,brand,period)）。
//      泛化的业务键（store_code / name+city+address）是**门店级**的，
//      对「一期档案」没有意义 —— 套用会把「集团这期档案」误判成「某家门店」。
//
// 方向约束（规则 35）：只允许 group_to_member。子公司不自行上传竞品；
//   把快照往上拉会让集团账号冒出「只跟某个子公司辖区有关的残缺档案」。
//   越界方向由 routes/sync.js 直接 400 拒绝（**不静默**），内核这里再自保一次。
//
// ⚠️ 与 `competitors` 对象的分工（别把两者混起来）：
//    · `competitors` 同步 = 子公司**竞品门店列表**（地图/列表用），镜像行是自建行身份
//      （期次列按规则 8 刻意不复制）；
//    · `competitor_snapshots` 同步 = 子公司**期次档案**（开关店监测 / 两期 diff 用）。
//    两者各走各的，互不依赖 —— 这正是规则 8「期次隔离」得以保持不变的原因。

/** 头表参与同步的列。**显式列出、不用 PRAGMA 内省**：内省会把 total_count / open_count /
 *  file_hash 当普通列照抄，而它们恰恰是需要重算或不宣复制的（见上面 ② 与 file_hash 注释）。 */
const SNAPSHOT_HEADER_FIELDS = ['brand', 'period', 'period_seq', 'source_file', 'data_version']

/** 快照判重键 = 品牌 + 期次（与头表 UNIQUE 约束同源，避免「判重过了却插不进去」） */
function snapshotKey(s) {
  return `${normKeyText(s && s.brand)}|${String((s && s.period) || '').trim()}`
}

/** 快照在 UI 上的展示名（头表没有 name 列，前端表格按 `name` 渲染，故合成一个） */
function snapLabel(s) {
  const brand = String((s && s.brand) || '').trim()
  const period = String((s && s.period) || '').trim()
  return `${brand} ${period}`.trim() || `#${s && s.id}`
}

/**
 * 快照的过滤器。
 *
 * ★ 品牌过滤只对**头表**生效：明细表 `competitor_snapshot_rows` 没有 brand 列，
 *   若把品牌集合丢给 `inAllowedScope` 跑明细，`row.brand` 恒为空 ⇒ 整期明细全判越界、
 *   下发变成空档（静默空转的老坑）。城市过滤则相反，只对明细生效（头表没有 city 列）。
 */
function snapshotFilters({ scopeJson = null, keyword = '', periods = [] } = {}) {
  const m = buildScopeMatcher(scopeJson, null)
  const list = Array.isArray(periods) ? periods.map(p => String(p).trim()).filter(Boolean) : []
  return { cityKeys: m.cityKeys, brands: m.brands, keyword: String(keyword || ''), periods: new Set(list) }
}

/** 头表是否在范围内（只判品牌；城市维度留给明细） */
function snapshotHeaderAllowed(snap, f) {
  if (f.brands && f.brands.size > 0) {
    const b = String((snap && snap.brand) || '').trim()
    if (!f.brands.has(b)) return false
  }
  return true
}

/** 镜像里该期的**全部**明细行（镜像本身就只有本辖区的行） */
function readMirrorRows(db, mirrorId) {
  return db.prepare(`
    SELECT store_key, name, city, district, address, latitude, longitude, status, description, extra
      FROM ${SNAPSHOT_ROWS_TABLE} WHERE snapshot_id = ? ORDER BY store_key
  `).all(mirrorId) || []
}

/**
 * 源期明细 → **本辖区应下发的行**（城市 + 关键词过滤，静默丢弃但计数）。
 * @returns {{kept:object[], sourceTotal:number, outOfScope:number, outOfFilter:number}}
 */
function readSnapshotRows(db, snapshotId, f) {
  const rows = db.prepare(`
    SELECT store_key, name, city, district, address, latitude, longitude, status, description, extra
      FROM ${SNAPSHOT_ROWS_TABLE} WHERE snapshot_id = ? ORDER BY store_key
  `).all(snapshotId) || []

  const kept = []
  let outOfScope = 0
  let outOfFilter = 0
  for (const r of rows) {
    // 明细行没有 brand / belong_member_user_id ⇒ 只按城市圈定（规则 11 / 13）
    if (!inAllowedScope(r, { cityKeys: f.cityKeys, brands: null, belongUserId: null })) { outOfScope++; continue }
    if (!matchKeyword(r, f.keyword)) { outOfFilter++; continue }
    kept.push(r)
  }
  return { kept, sourceTotal: rows.length, outOfScope, outOfFilter }
}

/** open 行数（镜像计数口径与源侧 `open_count` 一致） */
function countOpen(rows) {
  return rows.filter(r => String(r.status || '') === 'open').length
}

/** 明细集合是否与「应下发集合」等价（逐字段宽松比较；两边都已按 store_key 排序） */
const SNAPSHOT_ROW_FIELDS = ['store_key', 'name', 'city', 'district', 'address', 'latitude', 'longitude', 'status', 'description', 'extra']
function sameSnapshotRows(cur, want) {
  if (cur.length !== want.length) return false
  for (let i = 0; i < cur.length; i++) {
    for (const f of SNAPSHOT_ROW_FIELDS) {
      if (!looseEqual(cur[i][f], want[i][f])) return false
    }
  }
  return true
}

/**
 * 生成快照同步计划（只读）。
 * 与 `buildPlan` 同构返回，好让 `buildPlanForKinds` 原样合并：
 * items 的每一项代表**一期快照**（不是一家店），额外带
 * `brand / period / period_seq / detailRows / originTotalCount / originOpenCount`。
 */
export function buildSnapshotPlan(db, opts) {
  const {
    direction,
    sourceUserId,
    targetUserId,
    scopeJson = null,
    keyword = '',
    periods = []
  } = opts || {}

  const f = snapshotFilters({ scopeJson, keyword, periods })
  const fields = SNAPSHOT_HEADER_FIELDS.slice()
  const items = { added: [], updated: [], deleted: [], skipped: [], duplicate: [] }
  const counts = {
    added: 0, updated: 0, deleted: 0, skipped: 0, duplicate: 0,
    outOfScope: 0, outOfFilter: 0, selfOrigin: 0, noChange: 0, total: 0,
    duplicateShadowed: 0, truncated: 0,
    // 快照专有计数：明细行维度的可见性（头表 N 期 ≠ 明细 N 行）
    detailRows: 0, detailOutOfScope: 0, detailOutOfFilter: 0, directionBlocked: 0, periodFiltered: 0
  }

  // 规则 35 自保：内核可被直接调用，不能只靠路由层拦
  if (direction === DIRECTIONS.MEMBER_TO_GROUP) {
    counts.directionBlocked = 1
    return { kind: SNAPSHOT_KIND, direction, sourceUserId, targetUserId, fields, items, counts, scopeJson, belongUserId: null, keyword }
  }

  const sourceRows = db.prepare(`
    SELECT * FROM ${SNAPSHOT_KIND} WHERE user_id = ? ORDER BY brand, period_seq
  `).all(sourceUserId) || []

  // 目标账号「品牌|期次」占用表 —— 判重键（先到先得）
  const occ = new Map()
  for (const r of db.prepare(`
    SELECT id, brand, period, origin_user_id, origin_owner FROM ${SNAPSHOT_KIND} WHERE user_id = ? ORDER BY id
  `).all(targetUserId) || []) {
    const k = snapshotKey(r)
    if (occ.has(k)) { counts.duplicateShadowed++; continue }
    occ.set(k, r)
  }

  const sourceIds = new Set()

  for (const snap of sourceRows) {
    // 防回环（规则 3）
    if (snap.origin_user_id != null && Number(snap.origin_user_id) === Number(targetUserId)) {
      counts.selfOrigin++
      counts.skipped++
      items.skipped.push({ kind: SNAPSHOT_KIND, rowId: snap.id, name: snapLabel(snap), reason: 'self_origin' })
      continue
    }
    // 品牌维度越界 ⇒ 整期不下发（源侧仍在，故不会被判删除）
    if (!snapshotHeaderAllowed(snap, f)) { counts.outOfScope++; continue }
    // 期次收窄（可选 filter.periods）：未勾选的期次不下发。
    // ★ 它**不是**删除条件 —— 下面的反向扫描靠 `stillExists`（源行确实还在）兜住，
    //   所以「这轮只下 2026-08」不会把子公司已有的 2026-05 档案清掉。
    if (f.periods.size > 0 && !f.periods.has(String(snap.period || '').trim())) { counts.periodFiltered++; continue }
    sourceIds.add(snap.id)

    const det = readSnapshotRows(db, snap.id, f)
    counts.detailOutOfScope += det.outOfScope
    counts.detailOutOfFilter += det.outOfFilter

    const mirror = db.prepare(`
      SELECT * FROM ${SNAPSHOT_KIND}
       WHERE user_id = ? AND origin_user_id = ? AND origin_row_id = ?
    `).get(targetUserId, sourceUserId, snap.id)

    if (!mirror) {
      // ---- 判重：目标账号里已有同「品牌|期次」档案（自建的 / 别家下发的）----
      //   头表有 UNIQUE(user_id,brand,period)，硬插会撞唯一索引让整个事务回滚。
      //   按先到先得记 duplicate 提示，⛔ 不覆盖、不静默丢弃。
      const hit = occ.get(snapshotKey(snap))
      if (hit) {
        counts.duplicate++
        items.duplicate.push({
          key: `duplicate:snap:${snap.id}`, kind: SNAPSHOT_KIND, rowId: snap.id,
          matchedRowId: hit.id, matchedIsLocal: hit.origin_user_id == null,
          matchedOriginUserId: hit.origin_user_id ?? null,
          matchedOriginOwner: hit.origin_owner ?? null,
          by: 'brand_period',
          name: snapLabel(snap), brand: snap.brand, period: snap.period, period_seq: snap.period_seq,
          detailRows: det.kept.length, originTotalCount: snap.total_count ?? 0
        })
        continue
      }
      // 本辖区一行都没有 ⇒ 该期对这家子公司无意义，不写空档案
      if (!det.kept.length) { counts.outOfScope++; continue }

      counts.added++
      counts.detailRows += det.kept.length
      items.added.push({
        key: `added:snap:${snap.id}`, kind: SNAPSHOT_KIND, rowId: snap.id,
        originOwner: '',
        name: snapLabel(snap), brand: snap.brand, period: snap.period, period_seq: snap.period_seq,
        detailRows: det.kept.length,
        originTotalCount: snap.total_count ?? 0, originOpenCount: snap.open_count ?? 0
      })
      // 同批内自重复（源侧同品牌同期次两条）就地占位，后到者判重
      occ.set(snapshotKey(snap), { id: null, brand: snap.brand, period: snap.period })
    } else {
      // ---- 更新判定：头表字段 + 明细集合 + 计数，全都没变 ⇒ no_change（一行不写）----
      const wantTotal = det.kept.length
      const wantOpen = countOpen(det.kept)
      const changes = diffFields(fields, snap, mirror)
      for (const [col, want, cur] of [
        ['total_count', wantTotal, mirror.total_count],
        ['open_count', wantOpen, mirror.open_count],
        ['origin_total_count', snap.total_count ?? null, mirror.origin_total_count],
        ['origin_open_count', snap.open_count ?? null, mirror.origin_open_count]
      ]) {
        if (!looseEqual(cur, want)) changes.push({ field: col, from: isBlank(cur) ? null : cur, to: isBlank(want) ? null : want })
      }
      const detailChanged = !sameSnapshotRows(readMirrorRows(db, mirror.id), det.kept)

      if (!detailChanged && changes.length === 0) {
        counts.noChange++
        counts.skipped++
        items.skipped.push({ kind: SNAPSHOT_KIND, rowId: snap.id, name: snapLabel(snap), reason: 'no_change' })
      } else {
        counts.updated++
        counts.detailRows += wantTotal
        items.updated.push({
          key: `updated:snap:${mirror.id}`, kind: SNAPSHOT_KIND, rowId: snap.id, mirrorRowId: mirror.id,
          name: snapLabel(snap), brand: snap.brand, period: snap.period, period_seq: snap.period_seq,
          detailRows: wantTotal, detailChanged, changes
        })
      }
    }
  }

  // 反向扫描 = 删除传播（规则 6）：镜像所依据的源期次已不存在
  const mirrors = db.prepare(`
    SELECT * FROM ${SNAPSHOT_KIND} WHERE user_id = ? AND origin_user_id = ?
  `).all(targetUserId, sourceUserId) || []

  for (const mi of mirrors) {
    if (mi.origin_row_id != null && sourceIds.has(mi.origin_row_id)) continue
    // 源期次仍在、只是被收窄的 scope 挡在范围外 ⇒ 刻意不删（与 markers 同口径：
    // 「改一次范围就丢一批档案」比留着一份旧档案糟得多）。要清请走「移除外来副本」。
    const stillExists = mi.origin_row_id == null
      ? false
      : !!db.prepare(`SELECT 1 FROM ${SNAPSHOT_KIND} WHERE id = ? AND user_id = ?`).get(mi.origin_row_id, sourceUserId)
    if (stillExists) continue

    counts.deleted++
    items.deleted.push({
      key: `deleted:snap:${mi.id}`, kind: SNAPSHOT_KIND, mirrorRowId: mi.id,
      name: snapLabel(mi), brand: mi.brand, period: mi.period, period_seq: mi.period_seq,
      reason: mi.origin_row_id == null ? 'orphan' : 'source_removed'
    })
  }

  counts.total = counts.added + counts.updated + counts.deleted + counts.skipped + counts.duplicate
  return { kind: SNAPSHOT_KIND, direction, sourceUserId, targetUserId, fields, items, counts, scopeJson, belongUserId: null, keyword }
}

/** 快照候选（与 `buildSnapshotPlan` 同源判定，「候选 N 期」与「预览 N 期」必须对得上） */
export function listSnapshotCandidates(db, opts) {
  const { sourceUserId, targetUserId, scopeJson = null, keyword = '', periods = [] } = opts || {}
  const f = snapshotFilters({ scopeJson, keyword, periods })

  const rows = db.prepare(`
    SELECT * FROM ${SNAPSHOT_KIND} WHERE user_id = ? ORDER BY brand, period_seq
  `).all(sourceUserId) || []

  const occ = new Set()
  for (const r of db.prepare(`SELECT brand, period FROM ${SNAPSHOT_KIND} WHERE user_id = ?`).all(targetUserId) || []) {
    occ.add(snapshotKey(r))
  }

  const inScope = []
  let outOfScope = 0
  let outOfFilter = 0
  let selfOrigin = 0
  let duplicate = 0
  let detailRows = 0
  let periodFiltered = 0

  for (const snap of rows) {
    if (snap.origin_user_id != null && Number(snap.origin_user_id) === Number(targetUserId)) { selfOrigin++; continue }
    if (!snapshotHeaderAllowed(snap, f)) { outOfScope++; continue }
    if (f.periods.size > 0 && !f.periods.has(String(snap.period || '').trim())) { periodFiltered++; continue }

    const det = readSnapshotRows(db, snap.id, f)
    outOfFilter += det.outOfFilter
    const mirror = db.prepare(`
      SELECT id FROM ${SNAPSHOT_KIND} WHERE user_id = ? AND origin_user_id = ? AND origin_row_id = ?
    `).get(targetUserId, sourceUserId, snap.id)

    const isDup = !mirror && occ.has(snapshotKey(snap))
    if (isDup) duplicate++

    // 与 buildPlan 对齐：本辖区无行且非重复命中 ⇒ 该期不参与下发（计越界）
    if (!mirror && !isDup && !det.kept.length) { outOfScope++; continue }

    detailRows += det.kept.length
    inScope.push({
      kind: SNAPSHOT_KIND,
      rowId: snap.id,
      mirrorRowId: mirror ? mirror.id : null,
      mirrorState: mirror ? 'synced' : (isDup ? 'duplicate' : 'new'),
      duplicated: isDup,
      name: snapLabel(snap), brand: snap.brand, period: snap.period, period_seq: snap.period_seq,
      detailRows: det.kept.length,
      originTotalCount: snap.total_count ?? 0
    })
  }

  return { kind: SNAPSHOT_KIND, total: rows.length, inScope, outOfScope, outOfFilter, selfOrigin, duplicate, detailRows, periodFiltered }
}

// ---------------------------------------------------------------------------
// 6. 提交（单事务 · 规则 15）
// ---------------------------------------------------------------------------

/** 目标侧镜像行的系统列取值 */
function mirrorMeta({ batchId, sourceUserId, sourceLabel }) {
  return { origin_user_id: sourceUserId, origin_owner: sourceLabel || '', sync_batch_id: batchId, sync_readonly: 1 }
}

/**
 * 写入/更新一期快照镜像（头表 + 本辖区明细）。**调用方必须已在事务内**。
 *
 * ★ 为什么「插头表 → 灌明细 → 回头定稿计数」三步而不是先算后插：
 *   计数必须与**实际落库行数**一致，而实际落库受 `UNIQUE(snapshot_id, store_key)` 约束
 *   （源侧同键重复行会被 OR IGNORE 丢掉）⇒ 只有插完才知道真数。
 *   `total_count` 若照抄源侧，子公司监测面板就会出现「写着 1905 家、列表只有 650 家」。
 *
 * ★ 明细用 `INSERT OR IGNORE`：源侧同期偶然出现重复 store_key 时，
 *   宁可丢掉那一行副本，也不能让 UNIQUE 冲突把**整个同步事务**回滚。
 *
 * @returns {{ok:true, mirrorId:number, rows:number, replaced:number}} | {{ok:false, reason:string}}
 */
function writeSnapshotMirror(db, { sourceSnapshotId, targetUserId, sourceUserId, batchId, sourceLabel, filters }) {
  const snap = db.prepare(`SELECT * FROM ${SNAPSHOT_KIND} WHERE id = ? AND user_id = ?`)
    .get(sourceSnapshotId, sourceUserId)
  if (!snap) return { ok: false, reason: 'source_gone' }

  const det = readSnapshotRows(db, snap.id, filters)
  const mirror = db.prepare(`
    SELECT * FROM ${SNAPSHOT_KIND} WHERE user_id = ? AND origin_user_id = ? AND origin_row_id = ?
  `).get(targetUserId, sourceUserId, sourceSnapshotId)

  let mirrorId
  if (mirror) {
    // 目标账号已「脱离同步」这个期次 ⇒ 它是自有档案了，绝不覆盖（规则 4）
    if (Number(mirror.sync_readonly) !== 1) return { ok: false, reason: 'mirror_locked_or_missing' }

    db.prepare(`
      UPDATE ${SNAPSHOT_KIND}
         SET brand = ?, period = ?, period_seq = ?, source_file = ?, data_version = ?,
             origin_total_count = ?, origin_open_count = ?,
             origin_owner = ?, sync_batch_id = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND sync_readonly = 1
    `).run(
      snap.brand, snap.period, snap.period_seq, snap.source_file ?? null, snap.data_version ?? null,
      snap.total_count ?? null, snap.open_count ?? null,
      sourceLabel || '', batchId, mirror.id, targetUserId
    )
    mirrorId = mirror.id
  } else {
    const r = db.prepare(`
      INSERT INTO ${SNAPSHOT_KIND}
        (user_id, brand, period, period_seq, source_file, data_version,
         total_count, open_count, origin_user_id, origin_row_id, origin_owner,
         sync_batch_id, sync_readonly, origin_total_count, origin_open_count,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))
    `).run(
      targetUserId, snap.brand, snap.period, snap.period_seq, snap.source_file ?? null, snap.data_version ?? null,
      sourceUserId, snap.id, sourceLabel || '', batchId,
      snap.total_count ?? null, snap.open_count ?? null
    )
    mirrorId = r.lastInsertRowid
    // ⚠️ 刻意**不复制 file_hash**：那是「源侧那个文件」的 md5，目标账号从没见过它，
    //   照抄会让子公司侧「重复导入检测」用错基准。
  }

  // ---- 明细：先比后写（集合没变就一行不写 —— 避免每轮同步重灌上千行）----
  let replaced = 0
  if (!sameSnapshotRows(readMirrorRows(db, mirrorId), det.kept)) {
    db.prepare(`DELETE FROM ${SNAPSHOT_ROWS_TABLE} WHERE snapshot_id = ?`).run(mirrorId)
    const ins = db.prepare(`
      INSERT OR IGNORE INTO ${SNAPSHOT_ROWS_TABLE}
        (snapshot_id, store_key, name, city, district, address, latitude, longitude, status, description, extra, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    for (const r of det.kept) {
      const rr = ins.run(
        mirrorId, r.store_key, r.name ?? null, r.city ?? null, r.district ?? null, r.address ?? null,
        r.latitude ?? null, r.longitude ?? null, r.status ?? 'unknown', r.description ?? null, r.extra ?? null
      )
      if (rr && rr.changes > 0) replaced++
    }
  }

  // ---- 定稿计数：按**实际落库**行数（含被 OR IGNORE 丢掉的行）----
  const actual = readMirrorRows(db, mirrorId)
  db.prepare(`
    UPDATE ${SNAPSHOT_KIND} SET total_count = ?, open_count = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?
  `).run(actual.length, countOpen(actual), mirrorId, targetUserId)

  return { ok: true, mirrorId, rows: actual.length, replaced }
}

/**
 * 删除一期快照镜像。**先清明细再删头表**（规则 36）：
 * sqlite3/sql.js 的 `foreign_keys` 默认不开，`ON DELETE CASCADE` **不会触发**，
 * 靠级联会留下一堆永远不会被引用的孤儿明细行（P1 清理 user4 时实际踩到过这个坑）。
 */
function deleteSnapshotMirror(db, { mirrorRowId, targetUserId, sourceUserId }) {
  db.prepare(`DELETE FROM ${SNAPSHOT_ROWS_TABLE} WHERE snapshot_id = ?`).run(mirrorRowId)
  const r = db.prepare(`
    DELETE FROM ${SNAPSHOT_KIND}
     WHERE id = ? AND user_id = ? AND origin_user_id = ? AND sync_readonly = 1
  `).run(mirrorRowId, targetUserId, sourceUserId)
  return (r && r.changes) || 0
}

/**
 * 把计划写入目标账号（**单事务**）。
 *
 * ★ 支持多对象（批次 E）：每个 item 自带 `kind`，据此取**该表**的
 *   `fieldsByKind[kind]` 与 INSERT/UPDATE 语句。单对象计划（批次 D 路径）
 *   没有 `fieldsByKind` 时回落到 `plan.fields`，行为逐字不变。
 *
 * ★ 提交时**重新读源行**，不用预览时快照下来的值：
 *   预览到确认之间源侧可能被改过，重新读才不会写入过期数据。
 *   源行在此期间被删 → 计入 failed（不是静默跳过），让用户看得见。
 *
 * @param plan      buildPlan / buildPlanForKinds 的返回值
 * @param excluded  string[]  用户在预览里取消勾选的 item.key
 * @returns {{inserted,updated,deleted,skipped,failed,status,detail}}
 */
export function applyPlan(db, { plan, excluded = [], batchId, sourceLabel = '' }) {
  const ex = new Set(excluded || [])
  const { kind, sourceUserId, targetUserId } = plan

  const result = { inserted: 0, updated: 0, deleted: 0, skipped: 0, failed: 0, duplicate: 0, snapshotRows: 0, detail: [] }
  const push = (row) => { if (result.detail.length < DETAIL_SAMPLE_LIMIT) result.detail.push(row) }

  // 快照明细在 **apply 阶段**按城市过滤 ⇒ 用与预览同源的口径重建过滤器
  // （plan.scopeJson 由 buildPlan/buildPlanForKinds 回传）
  const snapFilters = snapshotFilters({
    scopeJson: plan.scopeJson ?? null,
    keyword: plan.keyword || '',
    periods: plan.periods || []
  })
  const isSnap = (k) => k === SNAPSHOT_KIND

  // ---- 按对象缓存字段与 INSERT 语句（多对象批次下每张表各一份）----
  const fieldsFor = (k) => (plan.fieldsByKind && plan.fieldsByKind[k]) || plan.fields || []
  const insertCache = new Map()
  const insertSqlFor = (k) => {
    if (!insertCache.has(k)) {
      const f = fieldsFor(k)
      const cols = [...f, 'origin_user_id', 'origin_row_id', 'origin_owner', 'sync_batch_id', 'sync_readonly', 'user_id']
      insertCache.set(k, { cols, sql: `INSERT INTO ${k} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})` })
    }
    return insertCache.get(k)
  }
  const kindOf = (it) => it.kind || kind

  db.beginTx()
  try {
    // ---- 疑似重复（规则 34）：只记录，**绝不写入** ----
    //   命中的目标行不是本源的镜像（自建行或属于别人），改写它会破坏单写者语义。
    for (const it of (plan.items.duplicate || [])) {
      result.duplicate++
      push({
        kind: kindOf(it), action: 'duplicate_skip', rowId: it.rowId, name: it.name,
        matchedRowId: it.matchedRowId, by: it.by
      })
    }

    for (const it of plan.items.added) {
      const k = kindOf(it)
      if (ex.has(it.key)) { result.skipped++; push({ kind: k, action: 'skip', rowId: it.rowId, reason: 'user_excluded' }); continue }

      // ---- 特例：快照 = 头表 + 本辖区明细（§5b）----
      if (isSnap(k)) {
        const w = writeSnapshotMirror(db, {
          sourceSnapshotId: it.rowId, targetUserId, sourceUserId, batchId, sourceLabel, filters: snapFilters
        })
        if (!w.ok) {
          result.failed++
          push({ kind: k, action: 'insert', rowId: it.rowId, name: it.name, period: it.period, reason: w.reason })
        } else {
          result.inserted++
          result.snapshotRows += w.rows
          push({ kind: k, action: 'insert', rowId: it.rowId, mirrorRowId: w.mirrorId, name: it.name, period: it.period, rows: w.rows })
        }
        continue
      }

      const src = db.prepare(`SELECT * FROM ${k} WHERE id = ? AND user_id = ?`).get(it.rowId, sourceUserId)
      if (!src) { result.failed++; push({ kind: k, action: 'insert', rowId: it.rowId, reason: 'source_gone' }); continue }

      const fields = fieldsFor(k)
      const { sql } = insertSqlFor(k)
      const meta = mirrorMeta({ batchId, sourceUserId, sourceLabel })
      const vals = fields.map(f => src[f] ?? null).concat([
        meta.origin_user_id, src.id, meta.origin_owner, meta.sync_batch_id, meta.sync_readonly, targetUserId
      ])
      const r = db.prepare(sql).run(...vals)
      result.inserted++
      push({ kind: k, action: 'insert', rowId: src.id, mirrorRowId: r.lastInsertRowid, name: src.name })
    }

    for (const it of plan.items.updated) {
      const k = kindOf(it)
      if (ex.has(it.key)) { result.skipped++; push({ kind: k, action: 'skip', mirrorRowId: it.mirrorRowId, reason: 'user_excluded' }); continue }

      // ---- 特例：快照（§5b）----
      if (isSnap(k)) {
        const w = writeSnapshotMirror(db, {
          sourceSnapshotId: it.rowId, targetUserId, sourceUserId, batchId, sourceLabel, filters: snapFilters
        })
        if (!w.ok) {
          result.failed++
          push({ kind: k, action: 'update', mirrorRowId: it.mirrorRowId, name: it.name, period: it.period, reason: w.reason })
        } else {
          result.updated++
          result.snapshotRows += w.rows
          push({
            kind: k, action: 'update', mirrorRowId: w.mirrorId, rowId: it.rowId,
            name: it.name, period: it.period, rows: w.rows, replaced: w.replaced, changes: it.changes
          })
        }
        continue
      }

      const src = db.prepare(`SELECT * FROM ${k} WHERE id = ? AND user_id = ?`).get(it.rowId, sourceUserId)
      if (!src) { result.failed++; push({ kind: k, action: 'update', mirrorRowId: it.mirrorRowId, reason: 'source_gone' }); continue }

      const fields = fieldsFor(k)
      const sets = fields.map(f => `${f} = ?`).join(', ')
      const vals = fields.map(f => src[f] ?? null).concat([batchId, it.mirrorRowId, targetUserId])
      const r = db.prepare(`
        UPDATE ${k} SET ${sets}, sync_batch_id = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND sync_readonly = 1
      `).run(...vals)

      if (!r || r.changes === 0) {
        result.failed++
        push({ kind: k, action: 'update', mirrorRowId: it.mirrorRowId, reason: 'mirror_locked_or_missing' })
      } else {
        result.updated++
        push({ kind: k, action: 'update', mirrorRowId: it.mirrorRowId, rowId: src.id, changes: it.changes })
      }
    }

    for (const it of plan.items.deleted) {
      const k = kindOf(it)
      if (ex.has(it.key)) { result.skipped++; push({ kind: k, action: 'skip', mirrorRowId: it.mirrorRowId, reason: 'user_excluded' }); continue }

      // ---- 特例：快照（§5b）—— 先清明细再删头表，避免孤儿（规则 36）----
      if (isSnap(k)) {
        const n = deleteSnapshotMirror(db, { mirrorRowId: it.mirrorRowId, targetUserId, sourceUserId })
        if (!n) {
          result.failed++
          push({ kind: k, action: 'delete', mirrorRowId: it.mirrorRowId, name: it.name, period: it.period, reason: 'mirror_locked_or_missing' })
        } else {
          result.deleted++
          push({ kind: k, action: 'delete', mirrorRowId: it.mirrorRowId, name: it.name, period: it.period })
        }
        continue
      }

      // 再确认一次：只删「仍是本批次来源的只读镜像」，绝不误删用户已脱离同步的自有行
      const r = db.prepare(`
        DELETE FROM ${k}
         WHERE id = ? AND user_id = ? AND origin_user_id = ? AND sync_readonly = 1
      `).run(it.mirrorRowId, targetUserId, sourceUserId)
      if (!r || r.changes === 0) {
        result.failed++
        push({ kind: k, action: 'delete', mirrorRowId: it.mirrorRowId, reason: 'mirror_locked_or_missing' })
      } else {
        result.deleted++
        push({ kind: k, action: 'delete', mirrorRowId: it.mirrorRowId, name: it.name })
      }
    }

    const status = result.failed === 0
      ? 'success'
      : (result.inserted + result.updated + result.deleted > 0 ? 'partial' : 'failed')
    result.status = status

    db.prepare(`
      UPDATE sync_batches
         SET total = ?, inserted = ?, updated = ?, deleted = ?, skipped = ?, failed = ?,
             status = ?, finished_at = datetime('now'), detail = ?
       WHERE id = ?
    `).run(
      countsTotal(plan.counts), result.inserted, result.updated, result.deleted,
      result.skipped + (plan.counts.skipped || 0) + (plan.counts.duplicate || 0), result.failed, status,
      JSON.stringify({ applied: result.detail, planned: plan.counts, appliedCount: result.detail.length }),
      batchId
    )

    db.commitTx()
    return result
  } catch (txError) {
    try { db.rollbackTx() } catch (e) { /* 忽略 */ }
    try {
      db.prepare(`
        UPDATE sync_batches SET status = 'failed', finished_at = datetime('now'), detail = ? WHERE id = ?
      `).run(JSON.stringify({ error: String(txError && txError.message || txError) }), batchId)
    } catch (e) { /* 忽略：回滚后写审计失败不应再抛 */ }
    throw txError
  }
}

function countsTotal(c) {
  // ★ duplicate 计入 total：它出现在预览的「待处理」里，不计会让分项加总对不上
  return (c.added || 0) + (c.updated || 0) + (c.deleted || 0) + (c.skipped || 0) + (c.duplicate || 0)
}

// ---------------------------------------------------------------------------
// 7. 批次审计（规则 9）
// ---------------------------------------------------------------------------

/**
 * 建 preview 批次。
 * ★ params 一并入库：commit 时据此**重建计划**，避免把整份明细 JSON 存进库
 *   （1904 行的明细 ≈ 数百 KB，每次 preview 都写盘会白白撑大 sql.js 的全库导出量）。
 */
export function createBatch(db, {
  orgId, direction, sourceUserId, targetUserId, kinds, plan, params, createdBy, ip
}) {
  const stored = {
    params,
    planned: plan ? plan.counts : null,
    sample: plan ? {
      added: plan.items.added.slice(0, DETAIL_SAMPLE_LIMIT),
      updated: plan.items.updated.slice(0, DETAIL_SAMPLE_LIMIT),
      deleted: plan.items.deleted.slice(0, DETAIL_SAMPLE_LIMIT),
      duplicate: (plan.items.duplicate || []).slice(0, DETAIL_SAMPLE_LIMIT)
    } : null,
    truncated: !!plan && (
      plan.items.added.length > DETAIL_SAMPLE_LIMIT
      || plan.items.updated.length > DETAIL_SAMPLE_LIMIT
      || plan.items.deleted.length > DETAIL_SAMPLE_LIMIT
      || (plan.items.duplicate || []).length > DETAIL_SAMPLE_LIMIT
    )
  }

  const r = db.prepare(`
    INSERT INTO sync_batches
      (org_id, direction, source_user_id, target_user_id, scope,
       total, inserted, updated, deleted, skipped, failed, status, detail, created_by, ip)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'preview', ?, ?, ?)
  `).run(
    orgId, direction, sourceUserId, targetUserId, kinds.join(','),
    plan ? countsTotal(plan.counts) : 0,
    JSON.stringify(stored), createdBy, ip || null
  )
  return r.lastInsertRowid
}

export function findBatch(db, id) {
  return db.prepare(`SELECT * FROM sync_batches WHERE id = ?`).get(id) || null
}

/** 解析 detail JSON（坏数据安全降级） */
export function parseBatchDetail(raw) {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : null
  } catch (e) { return null }
}

export function serializeBatch(row, { withDetail = false } = {}) {
  if (!row) return null
  const detail = parseBatchDetail(row.detail)
  const out = {
    id: row.id,
    orgId: row.org_id,
    direction: row.direction,
    sourceUserId: row.source_user_id,
    targetUserId: row.target_user_id,
    kinds: String(row.scope || '').split(',').filter(Boolean),
    total: row.total,
    inserted: row.inserted,
    updated: row.updated,
    deleted: row.deleted,
    skipped: row.skipped,
    failed: row.failed,
    status: row.status,
    createdBy: row.created_by,
    ip: row.ip,
    createdAt: row.created_at,
    finishedAt: row.finished_at
  }
  if (withDetail) {
    out.planned = detail?.planned || null
    out.sample = detail?.sample || null
    out.truncated = !!detail?.truncated
    out.applied = detail?.applied || null
    out.params = detail?.params || null
    out.error = detail?.error || null
  }
  return out
}

// ---------------------------------------------------------------------------
// 8. 城市兜底反查（规则 13）
// ---------------------------------------------------------------------------

/** 平面近似距离（km）—— GCJ-02 中纬度尺度足够，仅用于「最近邻」比较 */
function approxKm(lng1, lat1, lng2, lat2) {
  const dx = (Number(lng2) - Number(lng1)) * 111.32 * Math.cos(Number(lat1) * Math.PI / 180)
  const dy = (Number(lat2) - Number(lat1)) * 110.57
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * 城市参照池：一次性把「有 city 的点位」读进内存。
 * 批量导入（上千行）时必用 —— 否则每行都要跑一次 bbox 查询，2000 行 × 1 万点位 = 千万级比较。
 */
export function loadCityReferencePool(db) {
  const pool = []
  for (const table of ['markers', 'competitors']) {
    let rows = []
    try {
      rows = db.prepare(`
        SELECT city, latitude, longitude FROM ${table}
         WHERE city IS NOT NULL AND TRIM(city) != ''
           AND latitude IS NOT NULL AND longitude IS NOT NULL
      `).all() || []
    } catch (e) { rows = [] }
    for (const r of rows) {
      pool.push({ city: String(r.city).trim(), lat: Number(r.latitude), lng: Number(r.longitude), from: table })
    }
  }
  return pool
}

/** 在参照池里找最近邻（先 bbox 粗筛再算距离，避免全池算距离） */
export function reverseCityFromPool(pool, lat, lng, { maxKm = 40 } = {}) {
  const y = Number(lat)
  const x = Number(lng)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Array.isArray(pool) || !pool.length) return null

  const d = 0.4   // ±0.4° ≈ 44km
  let best = null
  for (const p of pool) {
    if (Math.abs(p.lat - y) > d || Math.abs(p.lng - x) > d) continue
    const km = approxKm(x, y, p.lng, p.lat)
    if (km > maxKm) continue
    if (!best || km < best.distanceKm) {
      best = { city: p.city, distanceKm: Math.round(km * 100) / 100, from: p.from }
    }
  }
  if (!best) return null
  return { city: best.city, source: 'geocoded', distanceKm: best.distanceKm, from: best.from }
}

/**
 * city 为空 → 按坐标反查补全（规则 13）。
 *
 * 实现用**最近邻**（在 markers/competitors 中找最近的有 city 的行），
 * 而不是城市边界点包含判定：
 *   ① 库存表里没有任何「城市面」数据（shapefiles 是各城市的**商圈**面，粒度对不上）；
 *   ② 城市级粒度下，最近的已知点位几乎必然同城，且零额外依赖、离线可用、可解释；
 *   ③ 引入城市面图层会让本函数从「O(1) 小查询」变成「解析 GB 级 geojson」（生产 1.6GB 小机不可接受）。
 *
 * @returns {{city:string, source:'geocoded', distanceKm:number, from:string}|null}
 */
export function reverseCityByCoordinate(db, lat, lng, { maxKm = 40 } = {}) {
  const y = Number(lat)
  const x = Number(lng)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null

  // 先做 bbox 粗筛（±0.4° ≈ 44km），再算精确距离；10k 行量级下 BETWEEN 足够快
  const d = 0.4
  let best = null
  const pools = [
    { table: 'markers', from: 'markers' },
    { table: 'competitors', from: 'competitors' }
  ]
  for (const p of pools) {
    let rows = []
    try {
      rows = db.prepare(`
        SELECT city, latitude, longitude FROM ${p.table}
         WHERE city IS NOT NULL AND TRIM(city) != ''
           AND longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ?
      `).all(x - d, x + d, y - d, y + d) || []
    } catch (e) { rows = [] }
    for (const r of rows) {
      const km = approxKm(x, y, r.longitude, r.latitude)
      if (km > maxKm) continue
      if (!best || km < best.distanceKm) {
        best = { city: String(r.city).trim(), distanceKm: Math.round(km * 100) / 100, from: p.from }
      }
    }
  }
  if (!best) return null
  return { city: best.city, source: 'geocoded', distanceKm: best.distanceKm, from: best.from }
}

/**
 * 给一行数据补 city（就地返回补好的值，不改数据库）。
 * 调用方负责落库时把 city_source 一起写进去。
 * @param pool 可选：loadCityReferencePool() 的结果（批量场景传入，避免逐行查库）
 */
export function fillCityFallback(db, payload, pool = null) {
  const current = String(payload?.city ?? '').trim()
  if (current) return { city: current, city_source: payload?.city_source || 'manual', geocoded: false }
  const hit = pool
    ? reverseCityFromPool(pool, payload?.latitude, payload?.longitude)
    : reverseCityByCoordinate(db, payload?.latitude, payload?.longitude)
  if (!hit) return { city: current, city_source: payload?.city_source || null, geocoded: false, matched: false }
  return { city: hit.city, city_source: 'geocoded', geocoded: true, matched: true, distanceKm: hit.distanceKm, from: hit.from }
}

// ---------------------------------------------------------------------------
// 9. 辖区划拨（P2 · 设计方案 v0.12 §3.5 Ⅱ · 规则 14 / 15）
// ---------------------------------------------------------------------------
//
// 划拨 = 「同一个城市换人管」。与**同步**（复制行）截然不同：
//
//   | 维度 | 同步 sync | 划拨 transfer |
//   |---|---|---|
//   | 数据动作 | 在目标侧**新增**一份镜像 | **原地改判**同一批行的归属 |
//   | 行 ID   | 新行 | **不变**（保 store_sales.store_id / origin_row_id 引用连续） |
//   | 涉及主体 | 源账号 + 目标账号 | 原持有方 + 新持有方 + **集团侧镜像** 三方 |
//
// 为什么不能「只改 scope」：会留下三处不一致 ——
//   ① 原持有方名下仍有该城门店副本（越界存量，双方都在维护）
//   ② 集团侧镜像 belong_member_user_id 仍指旧主（归属展示错）
//   ③ 集团侧镜像 origin_user_id 仍指旧主（**旧主后续编辑仍会覆盖集团数据** → 破坏 D3 单写者）
//
// ★ 本文件额外补了一处原设计未明写的**必需动作**：同时调整双方 `scope_json`。
//   若原持有方 scope 里仍留着该城市，他再点一次同步 → 集团行在他名下找不到镜像
//   （镜像已随行改判给新主）→ 判定为 added → **凭空重建一份重复副本**，
//   回到 Ⅱ 表格第 1 行的老问题。故 commit 必须「原持有方移除该城 / 新持有方并入该城」。

/** 划拨方向（与同步方向刻意区分：它是所有权改判，不是复制） */
export const TRANSFER_DIRECTION = 'transfer'

/** 归一化城市键集合 —— 库里的城市写法不统一（'上海' / '上海市' / ' 上海 '） */
function cityKeySet(cities) {
  return new Set((Array.isArray(cities) ? cities : []).map(normalizeCity).filter(Boolean))
}

/** 按块切分（长 IN 列表：sql.js 逐参数绑定，块越小越稳） */
function chunkOf(arr, size = 400) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** 某账号在某组织下的 scope（原样） */
function readMemberScope(db, orgId, userId) {
  const m = db.prepare(`SELECT scope_json FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, userId)
  if (!m) return null
  return { cities: parseCityList(m.scope_json), brands: parseBrandList(m.scope_json) }
}

/** 写 scope_json（不写审计批次 —— 调用方在事务内统一写） */
function writeMemberScope(db, orgId, userId, scope) {
  db.prepare(`
    UPDATE org_members SET scope_json = ?, scope_updated_at = CURRENT_TIMESTAMP
     WHERE org_id = ? AND user_id = ?
  `).run(JSON.stringify({ cities: scope.cities, brands: scope.brands }), orgId, userId)
}

/**
 * 划拨影响面（**纯读**，一行业务数据都不写）。
 *
 * 圈定口径（严格照 §3.5 Ⅱ-b 的迁移 SQL）：
 *   · 待改判行 = `user_id = from` 且 `origin_user_id = owner`（**只搬集团下发的行**）
 *     且 `city` 归一化后 ∈ 本次城市集合
 *     —— 刻意不搬 from 自建的行（那是他自己的资产，划拨只搬"集团授权给他管的辖区"）
 *   · 集团侧镜像 = `user_id = owner` 且 `origin_user_id = from` 且城市命中
 *   · 销售记录 = `store_sales WHERE user_id = from AND store_id ∈ 待改判门店 id`（无 city 过滤，
 *     store_id 已精确定位；这是「漏迁则销售预测断链」的那张表 —— 风险 P0）
 *   · 联通购买履历 = **不迁**（§3.5 Ⅱ-d：购买单归属购买方账号）。这里只做**只读计数**，
 *     用最近邻反查中心点城市（purchases 无 city 字段）。
 *
 * @returns {{ fromUserId,toUserId,ownerUserId,cities,cityKeys,kinds,counts,moved,groupMirrors,
 *             sample,fromName,toName,ownerName }}
 */
export function buildTransferPlan(db, {
  orgId,
  ownerUserId,
  fromUserId,
  toUserId,
  cities = [],
  kinds = ROW_KINDS
} = {}) {
  const owner = Number(ownerUserId)
  const from = Number(fromUserId)
  const to = Number(toUserId)
  const keys = cityKeySet(cities)
  // ⛔ 划拨只认「行级对象」（ROW_KINDS）：快照头表没有 city 列，卷进来会 SQL 报错。
  const list = (Array.isArray(kinds) && kinds.length ? kinds : ROW_KINDS)
    .filter(k => ROW_KINDS.includes(k))

  const hitCity = (row) => keys.has(normalizeCity(row.city))

  const moved = {}
  const groupMirrors = {}
  const byKind = {}
  const sample = {}

  for (const kind of list) {
    // ① 待改判 = from 名下**该城的全部行**（v0.13 R4）
    //    ⛔ 原口径只搬 `origin_user_id = owner`（集团下发的镜像行），刻意留下 from 自建的行。
    //       在「子公司自助维护门店 + 新设子公司整城转移」的真实流程下会出三种麻烦：
    //         ① 新城拿不全数据（自建的那几家永远留在原持有方名下）
    //         ② 某城全是自建行 ⇒ moved 为空 ⇒ 409 nothing_to_transfer（用户眼里是「划不动」）
    //         ③ 归属悬空（scope 已互调，门店却还挂旧主）
    //       故放开为「整城转移」，仅留一条防回环：不过继「本来就来自受让方」的行。
    const srcRows = (db.prepare(`
      SELECT id, name, city, district, address, origin_user_id, store_code
        FROM ${kind}
       WHERE user_id = ? AND (origin_user_id IS NULL OR origin_user_id != ?)
       ORDER BY id
    `).all(from, to) || []).filter(hitCity)

    moved[kind] = srcRows.map(r => r.id)
    // 「其中 N 家为原持有方自行录入」——预览里必须让用户点确认前看得见
    const selfBuilt = srcRows.filter(r => r.origin_user_id == null).length

    // ② 集团侧镜像（origin 指向 from 的那些行）
    //    ★ 口径**不变**：A 的自建行若曾回传集团，集团侧那条镜像的 origin_user_id 正是 A，
    //      天然落在这个集合里 ⇒ 步骤 3 会把它的 origin_* 一并改指受让方。
    //      🔴 漏了它，下一轮 member_to_group 会判定「源行已不在 A 名下」而按删除传播
    //         删掉**集团**那家门店（规则 6）。
    const mirrorRows = (db.prepare(`
      SELECT id, name, city FROM ${kind}
       WHERE user_id = ? AND origin_user_id = ?
       ORDER BY id
    `).all(owner, from) || []).filter(hitCity)

    groupMirrors[kind] = mirrorRows.map(r => r.id)
    byKind[kind] = { count: srcRows.length, selfBuilt, groupMirrors: mirrorRows.length }
    sample[kind] = srcRows.slice(0, 20)
  }

  // ③ 销售记录（跟随门店主体）—— 风险 P0 的量化
  let storeSales = 0
  const markerIds = moved.markers || []
  for (const ids of chunkOf(markerIds)) {
    if (!ids.length) continue
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM store_sales
       WHERE user_id = ? AND store_id IN (${ids.map(() => '?').join(',')})
    `).get(from, ...ids)
    storeSales += (r && r.n) || 0
  }

  // ④ 联通购买履历（只读计数；**不迁**）
  let purchases = 0
  try {
    const rows = db.prepare(`
      SELECT center_lng, center_lat FROM purchases
       WHERE user_id = ? AND center_lng IS NOT NULL AND center_lat IS NOT NULL
    `).all(from) || []
    if (rows.length) {
      const pool = loadCityReferencePool(db)
      for (const p of rows) {
        const hit = reverseCityFromPool(pool, p.center_lat, p.center_lng)
        if (hit && keys.has(normalizeCity(hit.city))) purchases++
      }
    }
  } catch (e) { purchases = 0 }

  return {
    orgId: Number(orgId) || null,
    ownerUserId: owner,
    fromUserId: from,
    toUserId: to,
    cities: (Array.isArray(cities) ? cities : []).map(c => String(c).trim()).filter(Boolean),
    cityKeys: [...keys],
    kinds: list,
    moved,
    groupMirrors,
    counts: {
      markers: (moved.markers || []).length,
      competitors: (moved.competitors || []).length,
      storeSales,
      groupMirrors: list.reduce((n, k) => n + (groupMirrors[k] || []).length, 0),
      groupMirrorsByKind: Object.fromEntries(list.map(k => [k, (groupMirrors[k] || []).length])),
      // v0.13 R4：待改判行里「原持有方自行录入」的家数（预览提示用）
      selfBuilt: list.reduce((n, k) => n + ((byKind[k] && byKind[k].selfBuilt) || 0), 0),
      selfBuiltByKind: Object.fromEntries(list.map(k => [k, (byKind[k] && byKind[k].selfBuilt) || 0])),
      purchases,
      total: list.reduce((n, k) => n + (moved[k] || []).length, 0)
    },
    byKind,
    sample,
    fromName: '',
    toName: '',
    ownerName: ''
  }
}

/**
 * 执行划拨（**单事务**，规则 15）。任一步失败整体回滚。
 *
 * 五步（步骤 4 是原设计未明写、但**必须**的补丁，见本节头部注释）：
 *   1) `markers` / `competitors`：`user_id` 改判给新持有方（**行 id 不变**）
 *   2) `store_sales`：`user_id` 跟随（只跟 `store_id ∈ 已改判门店 id`，⛔ 漏了销售预测就断链）
 *   3) 集团侧镜像：`origin_user_id` / `origin_owner` / `belong_member_user_id` 改指新持有方
 *   4) 双方 `scope_json`：原持有方**移除**该城 / 新持有方**并入**该城（+ 各写 1 条 scope_change）
 *   5) 写 1 条 `direction='transfer'` 批次（status=success，detail 存 moved ids 供回滚）
 *      —— 传 `batchId` 时**就地收尾** preview 批次（与同步主链路一致：一次向导 = 一条批次，
 *         不额外留一条永远停在 preview 的孤儿行）；缺省则新插一条。
 *
 * @returns {{ markers, competitors, storeSales, groupMirrors, scopeAdjusted:[], batchId }}
 */
export function applyTransfer(db, { plan, batchId = null, actorId = null, ip = null } = {}) {
  if (!plan) throw new Error('applyTransfer 需要 plan')
  const { fromUserId: from, toUserId: to, ownerUserId: owner, orgId, kinds = [] } = plan
  const moved = plan.moved || {}
  const groupMirrors = plan.groupMirrors || {}
  const cityKeys = new Set(plan.cityKeys || [])
  const cities = plan.cities || []

  const result = {
    markers: 0, competitors: 0, storeSales: 0, groupMirrors: 0,
    scopeAdjusted: [], batchId: null
  }

  db.beginTx()
  try {
    // ---- 1) 门店主体改判（行 id 不变 —— 引用连续的关键）----
    //   ★ v0.13 R4：本步标的已放开为「该城全部行」（含 from 自建行），故
    //     belong_member_user_id 一并同迁 —— 否则该行在新持有方名下仍挂着旧主的
    //     显式归属，靠 belong 兜底的范围判定（规则 13）会错位。
    for (const kind of kinds) {
      for (const id of (moved[kind] || [])) {
        const r = db.prepare(`
          UPDATE ${kind}
             SET user_id = ?,
                 belong_member_user_id = CASE WHEN belong_member_user_id = ? THEN ? ELSE belong_member_user_id END,
                 updated_at = datetime('now')
           WHERE id = ? AND user_id = ?
        `).run(to, from, to, id, from)
        if (r && r.changes > 0) result[kind] = (result[kind] || 0) + 1
      }
    }

    // ---- 2) 销售记录跟随（⛔ 关键：漏了这段，销售预测按 user_id 查不到历史）----
    const markerIds = moved.markers || []
    for (const ids of chunkOf(markerIds)) {
      if (!ids.length) continue
      const r = db.prepare(`
        UPDATE store_sales SET user_id = ?, updated_at = datetime('now')
         WHERE user_id = ? AND store_id IN (${ids.map(() => '?').join(',')})
      `).run(to, from, ...ids)
      result.storeSales += (r && r.changes) || 0
    }

    // ---- 3) 集团侧镜像改指新写权人（否则旧主后续编辑仍会覆盖集团数据）----
    for (const kind of kinds) {
      for (const id of (groupMirrors[kind] || [])) {
        const r = db.prepare(`
          UPDATE ${kind}
             SET origin_user_id = ?, origin_owner = ?, belong_member_user_id = ?,
                 updated_at = datetime('now')
           WHERE id = ? AND user_id = ? AND origin_user_id = ?
        `).run(to, plan.toName || '', to, id, owner, from)
        if (r && r.changes > 0) result.groupMirrors++
      }
    }

    // ---- 4) 双方 scope 调整（含审计：规则 14）----
    const scopeBefore = {}
    const scopeAfter = {}
    if (orgId) {
      const fromB = readMemberScope(db, orgId, from)
      const toB = readMemberScope(db, orgId, to)
      if (fromB && fromB.cities.some(c => cityKeys.has(normalizeCity(c)))) {
        const after = { ...fromB, cities: fromB.cities.filter(c => !cityKeys.has(normalizeCity(c))) }
        writeMemberScope(db, orgId, from, after)
        scopeBefore[from] = fromB; scopeAfter[from] = after
        result.scopeAdjusted.push({ userId: from, action: 'remove', cities })
      }
      if (toB) {
        const seen = new Set(toB.cities.map(normalizeCity))
        const merged = [...toB.cities]
        for (const c of cities) {
          const k = normalizeCity(c)
          if (!k || seen.has(k)) continue
          seen.add(k)
          merged.push(c)
        }
        if (merged.length !== toB.cities.length) {
          const after = { ...toB, cities: merged }
          writeMemberScope(db, orgId, to, after)
          scopeBefore[to] = toB; scopeAfter[to] = after
          result.scopeAdjusted.push({ userId: to, action: 'add', cities })
        }
      }
    }

    // ---- 5) 批次审计（direction='transfer'）----
    // ★ appliedAt = 本次划拨的**真实落库时刻**，是回滚前置检查「目标方是否已编辑」的基准线。
    //   ⛔ 不能用批次 created_at：preview 批次在预演时就已经落库（commit 只是就地收尾），
    //   其 created_at 早于 commit，会把本次迁移自己写入的 updated_at 误判成「目标方编辑」
    //   → 目标方什么都没做却假阳性 409 target_edited。（本地全栈 UI 验证实录：
    //   smoke 脚本 preview/commit 同秒完成恰好绕过，UI 上确认拖了 25s 才暴露。）
    //   取在 ①~④ 全部写入之后，保证 appliedAt ≥ 所有本次写入的 updated_at。
    const appliedAt = db.prepare("SELECT datetime('now') AS t").get().t
    const detail = {
      transfer: {
        orgId: orgId || null,
        ownerUserId: owner,
        fromUserId: from,
        toUserId: to,
        fromName: plan.fromName || '',
        toName: plan.toName || '',
        cities,
        kinds,
        moved,
        groupMirrors,
        storeSales: result.storeSales,
        purchases: plan.counts?.purchases || 0,
        scopeBefore,
        scopeAfter,
        appliedAt
      }
    }
    const totalMoved = result.markers + result.competitors
    if (batchId) {
      // 就地收尾 preview 批次
      db.prepare(`
        UPDATE sync_batches
           SET source_user_id = ?, target_user_id = ?, scope = ?, total = ?, inserted = ?,
               status = 'success', detail = ?, created_by = ?, ip = ?, finished_at = datetime('now')
         WHERE id = ?
      `).run(
        from, to, cities.join(','), totalMoved, totalMoved,
        JSON.stringify(detail), actorId, ip || null, batchId
      )
      result.batchId = batchId
    } else {
      const ins = db.prepare(`
        INSERT INTO sync_batches
          (org_id, direction, source_user_id, target_user_id, scope, total,
           inserted, updated, deleted, skipped, failed, status, detail, created_by, ip, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'success', ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        orgId || 0, TRANSFER_DIRECTION, from, to,
        cities.join(','), totalMoved,
        totalMoved, JSON.stringify(detail), actorId, ip || null
      )
      result.batchId = ins.lastInsertRowid
    }

    // 组织成员 scope_json 改了就补一条范围变更审计（与 routes/orgs.js::recordScopeChange 同构）
    for (const uid of Object.keys(scopeAfter)) {
      db.prepare(`
        INSERT INTO sync_batches
          (org_id, direction, source_user_id, target_user_id, scope, total,
           inserted, updated, deleted, skipped, failed, status, detail, created_by, ip, finished_at)
        VALUES (?, 'scope_change', ?, ?, ?, ?, 0, 0, 0, 0, 0, 'success', ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        orgId || 0, actorId, Number(uid),
        scopeAfter[uid].cities.join(','), scopeAfter[uid].cities.length,
        JSON.stringify({ before: scopeBefore[uid], after: scopeAfter[uid], reason: 'transfer' }),
        actorId, ip || null
      )
    }

    db.commitTx()
    return result
  } catch (txError) {
    try { db.rollbackTx() } catch (e) { /* 忽略 */ }
    throw txError
  }
}

/** 统计「划拨后目标方是否已编辑过这批行」（回滚前置检查，风险 P1） */
function countEditedSince(db, ids, userId, since) {
  let n = 0
  for (const chunk of chunkOf(ids)) {
    if (!chunk.length) continue
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM markers
       WHERE user_id = ? AND updated_at > ?
         AND id IN (${chunk.map(() => '?').join(',')})
    `).get(userId, since, ...chunk)
    n += (r && r.n) || 0
  }
  return n
}

/**
 * 回滚批次（P2）。**单事务**。
 *
 * 两类批次的语义刻意不同 —— 不要假装「都能完整还原」：
 *   · `transfer`：**完整可逆**。moved ids 在批次 detail 里逐行存着，
 *     把 `markers/competitors.user_id` + `store_sales.user_id` + 集团镜像 `origin_*`
 *     一起改回，并把双方 scope 恢复成 `scopeBefore`。
 *     ★ 前置：目标方已编辑过这批行（`updated_at > 划拨时间`）→ 回滚会**覆盖其修改**，
 *       必须 `force`（设计 §3.5 Ⅱ-c 的「回滚风险」）。
 *   · 普通同步批次：**只有结构性可逆的那半**能回滚 —— 删除本批新增的镜像
 *     （`sync_batch_id = 本批` 且 `origin_user_id = 源账号`）。
 *     被「更新」与「删除」的行**没有 before-image**（内核刻意不存快照：
 *     1904 行 × 每行全字段 ≈ 数百 KB，每次 preview 都写盘会撑爆 sql.js），
 *     故计入 `notRestorable` 并明确告知 —— 诚实语义优于「假装全可逆」。
 */
export function rollbackBatch(db, { batch, force = false, actorId = null } = {}) {
  if (!batch) return { ok: false, code: 'not_found', message: '批次不存在' }
  if (!['success', 'partial'].includes(String(batch.status))) {
    return {
      ok: false,
      code: 'not_rollbackable',
      message: `批次状态为「${batch.status}」，只有 success / partial 的批次可回滚`
    }
  }

  const detail = parseBatchDetail(batch.detail) || {}

  if (batch.direction === TRANSFER_DIRECTION) {
    return rollbackTransfer(db, { batch, detail, force, actorId })
  }
  if ([DIRECTIONS.GROUP_TO_MEMBER, DIRECTIONS.MEMBER_TO_GROUP].includes(batch.direction)) {
    return rollbackSyncBatch(db, { batch, actorId })
  }
  return {
    ok: false,
    code: 'not_rollbackable',
    message: `方向「${batch.direction}」不支持回滚（范围变更类留痕不可逆）`
  }
}

function rollbackTransfer(db, { batch, detail, force, actorId }) {
  const t = detail.transfer
  if (!t || !t.moved) {
    return { ok: false, code: 'no_snapshot', message: '该批次缺少划拨快照（detail.transfer），无法回滚' }
  }

  const from = Number(t.fromUserId)
  const to = Number(t.toUserId)
  const owner = Number(t.ownerUserId)
  const kinds = t.kinds || ['markers']
  const cities = t.cities || []
  const cityKeys = new Set(cities.map(normalizeCity))

  // 前置：目标方是否已编辑（设计 §3.5 Ⅱ-c「回滚风险」）
  // ★ 基准线三档降级，绝不用 batch.created_at：
  //   ① detail.appliedAt —— 本次 commit 的真实落库时刻（最准）
  //   ② batch.finished_at —— commit 时写入，与迁移行的 updated_at 同刻（legacy 批次兜底）
  //   ③ created_at —— 仅在极端脏数据下兜底；对 preview 批次它=预演时刻（偏早），
  //      会假阳性 409。详见 applyTransfer 中 appliedAt 的注释。
  const since = t.appliedAt || batch.finished_at || batch.created_at
  const edited = countEditedSince(db, t.moved.markers || [], to, since)
  if (edited > 0 && !force) {
    return {
      ok: false,
      code: 'target_edited',
      edited,
      // ★ 措辞必须诚实：本函数只还原「归属 / 销售记录 / 集团镜像 origin / 双方 scope」，
      //   **不**逐字段回滚目标方的编辑，也**不**撤销其「脱离同步」（脱离后 origin_user_id 已置空，
      //   该行已属对方自有资产，回滚只把它换个归属）。实测 2026-09-13。
      //   所以不能说「会覆盖这些修改」—— 那是假承诺。
      message: `新持有方已修改过其中的 ${edited} 家门店。回滚会把归属/销售记录/集团镜像/双方管辖范围改回原持有方，但不会撤销对方的字段修改。如确需回滚请确认后重试。`
    }
  }

  const result = { restored: { markers: 0, competitors: 0, storeSales: 0, groupMirrors: 0, scope: 0 }, edited }

  db.beginTx()
  try {
    for (const kind of kinds) {
      for (const id of (t.moved[kind] || [])) {
        // belong 与 user_id 成对搬回（与 applyTransfer 步 1 对称）
        const r = db.prepare(`
          UPDATE ${kind}
             SET user_id = ?,
                 belong_member_user_id = CASE WHEN belong_member_user_id = ? THEN ? ELSE belong_member_user_id END,
                 updated_at = datetime('now')
           WHERE id = ? AND user_id = ?
        `).run(from, to, from, id, to)
        if (r && r.changes > 0) result.restored[kind] = (result.restored[kind] || 0) + 1
      }
      for (const id of (t.groupMirrors?.[kind] || [])) {
        const r = db.prepare(`
          UPDATE ${kind}
             SET origin_user_id = ?, origin_owner = ?, belong_member_user_id = ?,
                 updated_at = datetime('now')
           WHERE id = ? AND user_id = ? AND origin_user_id = ?
        `).run(from, t.fromName || '', from, id, owner, to)
        if (r && r.changes > 0) result.restored.groupMirrors++
      }
    }

    for (const ids of chunkOf(t.moved.markers || [])) {
      if (!ids.length) continue
      const r = db.prepare(`
        UPDATE store_sales SET user_id = ?, updated_at = datetime('now')
         WHERE user_id = ? AND store_id IN (${ids.map(() => '?').join(',')})
      `).run(from, to, ...ids)
      result.restored.storeSales += (r && r.changes) || 0
    }

    // scope 恢复
    const orgId = t.orgId || batch.org_id
    const before = t.scopeBefore || {}
    for (const uid of Object.keys(before)) {
      writeMemberScope(db, orgId, Number(uid), before[uid])
      result.restored.scope++
      db.prepare(`
        INSERT INTO sync_batches
          (org_id, direction, source_user_id, target_user_id, scope, total,
           inserted, updated, deleted, skipped, failed, status, detail, created_by, ip, finished_at)
        VALUES (?, 'scope_change', ?, ?, ?, ?, 0, 0, 0, 0, 0, 'success', ?, ?, NULL, CURRENT_TIMESTAMP)
      `).run(
        orgId, actorId, Number(uid),
        before[uid].cities.join(','), before[uid].cities.length,
        JSON.stringify({ before: (t.scopeAfter || {})[uid] || null, after: before[uid], reason: 'transfer_rollback' }),
        actorId
      )
    }

    const rollbackInfo = {
      at: new Date().toISOString(),
      by: actorId,
      forced: !!force,
      editedBefore: edited,
      restored: result.restored,
      cities, cityKeys: [...cityKeys]
    }
    const nextDetail = {
      ...detail,
      rollback: rollbackInfo,
      transfer: { ...t, rolledBack: true }
    }
    db.prepare(`
      UPDATE sync_batches
         SET status = 'rolled_back', finished_at = datetime('now'), detail = ?
       WHERE id = ?
    `).run(JSON.stringify(nextDetail), batch.id)

    db.commitTx()
    return { ok: true, code: 'rolled_back', direction: TRANSFER_DIRECTION, ...result, batchId: batch.id }
  } catch (txError) {
    try { db.rollbackTx() } catch (e) { /* 忽略 */ }
    throw txError
  }
}

function rollbackSyncBatch(db, { batch, actorId = null }) {
  const source = Number(batch.source_user_id)
  const target = Number(batch.target_user_id)
  const kinds = String(batch.scope || '').split(',').filter(Boolean)
  const list = kinds.filter(k => SYNC_KINDS.includes(k))

  const restored = { inserted: 0, byKind: {} }
  db.beginTx()
  try {
    for (const kind of list) {
      // 快照（§5b）：明细无 user_id ⇒ 必须**先按头表圈出本批次的镜像期次，再清它们的明细**，
      // 否则回滚掉头表后会留下永远无人引用的孤儿明细行（规则 36）。
      if (kind === SNAPSHOT_KIND) {
        db.prepare(`
          DELETE FROM ${SNAPSHOT_ROWS_TABLE}
           WHERE snapshot_id IN (
             SELECT id FROM ${SNAPSHOT_KIND}
              WHERE user_id = ? AND origin_user_id = ? AND sync_batch_id = ? AND sync_readonly = 1
           )
        `).run(target, source, batch.id)
      }
      const r = db.prepare(`
        DELETE FROM ${kind}
         WHERE user_id = ? AND origin_user_id = ? AND sync_batch_id = ? AND sync_readonly = 1
      `).run(target, source, batch.id)
      const n = (r && r.changes) || 0
      restored.byKind[kind] = n
      restored.inserted += n
    }

    const notRestorable = {
      updated: batch.updated || 0,
      deleted: batch.deleted || 0,
      note: '被「更新」与「删除」的行没有 before-image（内核不存快照），无法还原内容；'
        + '如需恢复请让源账号重新发起一次同步。'
    }
    const partial = (notRestorable.updated + notRestorable.deleted) > 0

    let detail = {}
    try { detail = JSON.parse(batch.detail || '{}') || {} } catch (e) { detail = {} }
    detail.rollback = {
      at: new Date().toISOString(),
      by: actorId,
      restored,
      notRestorable,
      partial
    }
    db.prepare(`
      UPDATE sync_batches SET status = 'rolled_back', finished_at = datetime('now'), detail = ? WHERE id = ?
    `).run(JSON.stringify(detail), batch.id)

    db.commitTx()
    return {
      ok: true,
      code: 'rolled_back',
      direction: batch.direction,
      restored,
      notRestorable,
      partial,
      batchId: batch.id
    }
  } catch (txError) {
    try { db.rollbackTx() } catch (e) { /* 忽略 */ }
    throw txError
  }
}
