// ============================================================================
// 同步内核 syncCore（批次 D · 设计方案 v0.10 §4 / §6 / §8）
// ----------------------------------------------------------------------------
// 只服务一个对象：`markers`（§11 实施建议 —— 先把单对象全链路跑通，
// 确认无误后再横向复用到 competitors / purchases；三者共用本内核）。
//
// ★ 本模块「零业务 import」：只从 scopeGuard 取纯函数（其自身零 import）。
//   目的与 quotaGate/scopeGuard 相同 —— 可在生产直接 `import()` 做自检，
//   不会触发 getDb() 把 166MB 真库读进内存（历史上曾因此 OOM 连坐 pm2+sshd）。
//   所有需要数据库的操作一律**显式收 db 参数**。
//
// 实现的规则（§8 规则总表）：
//   规则 1  组织边界：调用方（routes/sync.js）负责，本模块只认 source/target 两个 userId
//   规则 2  幂等：靠唯一索引 ux_markers_origin(user_id, origin_user_id, origin_row_id)
//   规则 3  防回环：跳过 origin_user_id === 目标账号 的源行（否则 A→B→A 无限膨胀）
//   规则 4  写权唯一：目标侧镜像行 sync_readonly=1，只由本内核改写
//   规则 6  删除传播：源侧行消失 → 目标侧镜像列为 deleted，**必须走预览确认**
//   规则 8  期次隔离：period / snapshot_id 不复制（同步行以「手工行」身份存在）
//   规则 9  审计留痕：每次同步写 sync_batches（操作人 + IP + 逐行明细）
//   规则 11 管辖范围：只同步 city ∈ scope.cities 或 belong = 本人的行；越界**静默丢弃并计数**
//   规则 13 城市兜底：city 为空的行不参与范围圈定（只能靠 belong 显式归属）
//   规则 15 原子性：commit 的全部写入在**单事务**内，任一步失败整体回滚
//
// ⚠️ 本批**不迁移 store_sales**：同步是「复制行」，不是「划拨」。
//   划拨（P2 / 批次 E）才需要在同一事务里改 store_sales.user_id（规则 15）。
//   因此镜像门店在目标账号下**没有销售历史** —— 这是刻意的边界，
//   不要为了「看起来完整」而顺手复制 store_sales（会让同一份历史被两个账号各持一份）。
// ============================================================================

import { normalizeCity, parseCityList, parseBrandList } from './scopeGuard.js'

export const SYNC_KINDS = ['markers']

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

const KEY_ATTRS = ['name', 'store_code', 'brand', 'city', 'district', 'address', 'store_status', 'area']

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
      rowId: row.id,
      mirrorRowId: mirror ? mirror.id : null,
      mirrorState: mirror ? 'synced' : 'new',
      ...pickAttrs(row)
    })
  }

  return { kind, total: rows.length, inScope, outOfScope, outOfFilter, selfOrigin }
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
 * ★ 提交时**重新读源行**，不用预览时快照下来的值：
 *   预览到确认之间源侧可能被改过，重新读才不会写入过期数据。
 *   源行在此期间被删 → 计入 failed（不是静默跳过），让用户看得见。
 *
 * @param plan      buildPlan 的返回值
 * @param excluded  string[]  用户在预览里取消勾选的 item.key
 * @returns {{inserted,updated,deleted,skipped,failed,status,detail}}
 */
export function applyPlan(db, { plan, excluded = [], batchId, sourceLabel = '' }) {
  const ex = new Set(excluded || [])
  const { kind, sourceUserId, targetUserId, fields } = plan

  const result = { inserted: 0, updated: 0, deleted: 0, skipped: 0, failed: 0, detail: [] }
  const push = (row) => { if (result.detail.length < DETAIL_SAMPLE_LIMIT) result.detail.push(row) }

  const insertCols = [...fields, 'origin_user_id', 'origin_row_id', 'origin_owner', 'sync_batch_id', 'sync_readonly', 'user_id']
  const insertSql = `INSERT INTO ${kind} (${insertCols.join(',')}) VALUES (${insertCols.map(() => '?').join(',')})`

  db.beginTx()
  try {
    for (const it of plan.items.added) {
      if (ex.has(it.key)) { result.skipped++; push({ kind, action: 'skip', rowId: it.rowId, reason: 'user_excluded' }); continue }
      const src = db.prepare(`SELECT * FROM ${kind} WHERE id = ? AND user_id = ?`).get(it.rowId, sourceUserId)
      if (!src) { result.failed++; push({ kind, action: 'insert', rowId: it.rowId, reason: 'source_gone' }); continue }

      const meta = mirrorMeta({ batchId, sourceUserId, sourceLabel })
      const vals = fields.map(f => src[f] ?? null).concat([
        meta.origin_user_id, src.id, meta.origin_owner, meta.sync_batch_id, meta.sync_readonly, targetUserId
      ])
      const r = db.prepare(insertSql).run(...vals)
      result.inserted++
      push({ kind, action: 'insert', rowId: src.id, mirrorRowId: r.lastInsertRowid, name: src.name })
    }

    for (const it of plan.items.updated) {
      if (ex.has(it.key)) { result.skipped++; push({ kind, action: 'skip', mirrorRowId: it.mirrorRowId, reason: 'user_excluded' }); continue }
      const src = db.prepare(`SELECT * FROM ${kind} WHERE id = ? AND user_id = ?`).get(it.rowId, sourceUserId)
      if (!src) { result.failed++; push({ kind, action: 'update', mirrorRowId: it.mirrorRowId, reason: 'source_gone' }); continue }

      const sets = fields.map(f => `${f} = ?`).join(', ')
      const vals = fields.map(f => src[f] ?? null).concat([batchId, it.mirrorRowId, targetUserId])
      const r = db.prepare(`
        UPDATE ${kind} SET ${sets}, sync_batch_id = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND sync_readonly = 1
      `).run(...vals)

      if (!r || r.changes === 0) {
        result.failed++
        push({ kind, action: 'update', mirrorRowId: it.mirrorRowId, reason: 'mirror_locked_or_missing' })
      } else {
        result.updated++
        push({ kind, action: 'update', mirrorRowId: it.mirrorRowId, rowId: src.id, changes: it.changes })
      }
    }

    for (const it of plan.items.deleted) {
      if (ex.has(it.key)) { result.skipped++; push({ kind, action: 'skip', mirrorRowId: it.mirrorRowId, reason: 'user_excluded' }); continue }
      // 再确认一次：只删「仍是本批次来源的只读镜像」，绝不误删用户已脱离同步的自有行
      const r = db.prepare(`
        DELETE FROM ${kind}
         WHERE id = ? AND user_id = ? AND origin_user_id = ? AND sync_readonly = 1
      `).run(it.mirrorRowId, targetUserId, sourceUserId)
      if (!r || r.changes === 0) {
        result.failed++
        push({ kind, action: 'delete', mirrorRowId: it.mirrorRowId, reason: 'mirror_locked_or_missing' })
      } else {
        result.deleted++
        push({ kind, action: 'delete', mirrorRowId: it.mirrorRowId, name: it.name })
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
