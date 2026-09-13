// ============================================================================
// 同步内核 syncCore（批次 D · 设计方案 v0.10 §4 / §6 / §8；批次 E 扩到 competitors）
// ----------------------------------------------------------------------------
// 服务对象（`SYNC_KINDS`）：
//   · `markers`     我的门店   （批次 D 跑通全链路）
//   · `competitors` 竞品门店   （批次 E 横向复用 —— §11 实施建议：
//                    「先把单对象全链路跑通，确认无误后再横向复用」）
//   按表名泛化：内核只把 `kind` 当作**表名**使用，字段由 PRAGMA 内省得出
//   ⇒ 新增对象只需加进 SYNC_KINDS，无需改本文件的同步逻辑。
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
//
// ⚠️ **同步**（buildPlan/applyPlan）不迁移 store_sales：同步是「复制行」，不是「划拨」。
//   镜像门店在目标账号下**没有销售历史** —— 这是刻意的边界，不要为了「看起来完整」
//   而顺手复制 store_sales（会让同一份历史被两个账号各持一份）。
//   **辖区划拨**（第 9 节 buildTransferPlan/applyTransfer）则相反：它把**同一行**的
//   归属改判给别人，因此必须在同一事务里把 store_sales.user_id 一起改（规则 15），
//   否则销售预测按 WHERE user_id=? 查不到这些店的历史，表现为「数据凭空消失」。
// ============================================================================

import { normalizeCity, parseCityList, parseBrandList } from './scopeGuard.js'

/** 可同步对象 = 目标表名白名单（顺序即 UI 展示顺序） */
export const SYNC_KINDS = ['markers', 'competitors']

/**
 * 对象元数据（前端展示用；`GET /api/sync/scope-options` 会回传给 UI）。
 * 新增对象时这里与 SYNC_KINDS 一起加。
 */
export const KIND_META = {
  markers: { label: '我的门店', short: '门店', field: 'markers', table: 'markers' },
  competitors: { label: '竞品门店', short: '竞品', field: 'competitors', table: 'competitors' }
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

  const fields = syncableFields(db, kind)
  const matcher = buildScopeMatcher(scopeJson, belongUserId)

  const sourceRows = db.prepare(`SELECT * FROM ${kind} WHERE user_id = ?`).all(sourceUserId) || []

  const items = { added: [], updated: [], deleted: [], skipped: [] }
  const counts = {
    added: 0, updated: 0, deleted: 0, skipped: 0,
    outOfScope: 0, outOfFilter: 0, selfOrigin: 0, noChange: 0, total: 0
  }

  const sourceIds = new Set()
  let processed = 0

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

    if (processed >= MAX_PLAN_ROWS) { counts.outOfFilter++; continue }
    processed++
    sourceIds.add(row.id)

    const mirror = db.prepare(`
      SELECT * FROM ${kind}
       WHERE user_id = ? AND origin_user_id = ? AND origin_row_id = ?
    `).get(targetUserId, sourceUserId, row.id)

    if (!mirror) {
      counts.added++
      items.added.push({
        key: `added:${row.id}`, kind, rowId: row.id,
        originOwner: targetLabel,
        ...pickAttrs(row)
      })
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

  counts.total = counts.added + counts.updated + counts.deleted + counts.skipped
  return { kind, direction, sourceUserId, targetUserId, fields, items, counts }
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
  const { direction, sourceUserId, targetUserId, scopeJson = null, belongUserId = null, keyword = '', targetLabel = '' } = opts || {}

  const parts = kinds.map(kind => buildPlan(db, {
    kind, direction, sourceUserId, targetUserId, scopeJson, belongUserId, keyword, targetLabel
  }))

  const fieldsByKind = {}
  const byKind = {}
  const items = { added: [], updated: [], deleted: [], skipped: [] }
  const counts = {
    added: 0, updated: 0, deleted: 0, skipped: 0,
    outOfScope: 0, outOfFilter: 0, selfOrigin: 0, noChange: 0, total: 0, byKind
  }

  for (const p of parts) {
    fieldsByKind[p.kind] = p.fields
    byKind[p.kind] = p.counts
    for (const bucket of ['added', 'updated', 'deleted', 'skipped']) items[bucket].push(...p.items[bucket])
    for (const k of ['added', 'updated', 'deleted', 'skipped', 'outOfScope', 'outOfFilter', 'selfOrigin', 'noChange', 'total']) {
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
    counts
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

  const matcher = buildScopeMatcher(scopeJson, belongUserId)
  const rows = db.prepare(`SELECT * FROM ${kind} WHERE user_id = ?`).all(sourceUserId) || []

  const inScope = []
  let outOfScope = 0
  let outOfFilter = 0
  let selfOrigin = 0

  for (const row of rows) {
    if (row.origin_user_id != null && Number(row.origin_user_id) === Number(targetUserId)) { selfOrigin++; continue }
    if (!inAllowedScope(row, matcher)) { outOfScope++; continue }
    if (!matchKeyword(row, keyword)) { outOfFilter++; continue }

    const mirror = db.prepare(`
      SELECT id FROM ${kind} WHERE user_id = ? AND origin_user_id = ? AND origin_row_id = ?
    `).get(targetUserId, sourceUserId, row.id)

    inScope.push({
      kind,                       // 多对象批次下前端据此标注「门店 / 竞品」
      rowId: row.id,
      mirrorRowId: mirror ? mirror.id : null,
      mirrorState: mirror ? 'synced' : 'new',
      ...pickAttrs(row)
    })
  }

  return { kind, total: rows.length, inScope, outOfScope, outOfFilter, selfOrigin }
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

  const out = { kinds, total: 0, inScope: [], outOfScope: 0, outOfFilter: 0, selfOrigin: 0, byKind: {} }
  for (const p of parts) {
    out.byKind[p.kind] = {
      total: p.total, inScope: p.inScope.length,
      outOfScope: p.outOfScope, outOfFilter: p.outOfFilter, selfOrigin: p.selfOrigin
    }
    out.total += p.total
    out.inScope.push(...p.inScope)
    out.outOfScope += p.outOfScope
    out.outOfFilter += p.outOfFilter
    out.selfOrigin += p.selfOrigin
  }
  return out
}

// ---------------------------------------------------------------------------
// 6. 提交（单事务 · 规则 15）
// ---------------------------------------------------------------------------

/** 目标侧镜像行的系统列取值 */
function mirrorMeta({ batchId, sourceUserId, sourceLabel }) {
  return { origin_user_id: sourceUserId, origin_owner: sourceLabel || '', sync_batch_id: batchId, sync_readonly: 1 }
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

  const result = { inserted: 0, updated: 0, deleted: 0, skipped: 0, failed: 0, detail: [] }
  const push = (row) => { if (result.detail.length < DETAIL_SAMPLE_LIMIT) result.detail.push(row) }

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
    for (const it of plan.items.added) {
      const k = kindOf(it)
      if (ex.has(it.key)) { result.skipped++; push({ kind: k, action: 'skip', rowId: it.rowId, reason: 'user_excluded' }); continue }
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
      result.skipped + (plan.counts.skipped || 0), result.failed, status,
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
  return (c.added || 0) + (c.updated || 0) + (c.deleted || 0) + (c.skipped || 0)
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
      deleted: plan.items.deleted.slice(0, DETAIL_SAMPLE_LIMIT)
    } : null,
    truncated: !!plan && (
      plan.items.added.length > DETAIL_SAMPLE_LIMIT
      || plan.items.updated.length > DETAIL_SAMPLE_LIMIT
      || plan.items.deleted.length > DETAIL_SAMPLE_LIMIT
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
  kinds = SYNC_KINDS
} = {}) {
  const owner = Number(ownerUserId)
  const from = Number(fromUserId)
  const to = Number(toUserId)
  const keys = cityKeySet(cities)
  const list = (Array.isArray(kinds) && kinds.length ? kinds : SYNC_KINDS)
    .filter(k => SYNC_KINDS.includes(k))

  const hitCity = (row) => keys.has(normalizeCity(row.city))

  const moved = {}
  const groupMirrors = {}
  const byKind = {}
  const sample = {}

  for (const kind of list) {
    // ① 待改判（from 名下、由集团下发行）
    const srcRows = (db.prepare(`
      SELECT id, name, city, district, address FROM ${kind}
       WHERE user_id = ? AND origin_user_id = ?
       ORDER BY id
    `).all(from, owner) || []).filter(hitCity)

    moved[kind] = srcRows.map(r => r.id)

    // ② 集团侧镜像（origin 指向 from 的那些行）
    const mirrorRows = (db.prepare(`
      SELECT id, name, city FROM ${kind}
       WHERE user_id = ? AND origin_user_id = ?
       ORDER BY id
    `).all(owner, from) || []).filter(hitCity)

    groupMirrors[kind] = mirrorRows.map(r => r.id)
    byKind[kind] = { count: srcRows.length, groupMirrors: mirrorRows.length }
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
    for (const kind of kinds) {
      for (const id of (moved[kind] || [])) {
        const r = db.prepare(`
          UPDATE ${kind} SET user_id = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?
        `).run(to, id, from)
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
        const r = db.prepare(`
          UPDATE ${kind} SET user_id = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?
        `).run(from, id, to)
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
