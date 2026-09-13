// ============================================================================
// 数据同步（v0.10 批次 C 起 · 生产同步主链路见 v0.11 批次 D）
// ----------------------------------------------------------------------------
// 批次 C（v0.10）落了一个接口：
//   GET /api/sync/scope-options   管辖范围可选项（城市 + 品牌 + 门店计数）
//
// 批次 D（v0.11）补齐同步主链路：
//   GET  /api/sync/candidates          候选（按 scope 圈定，越界静默丢弃并计数 —— 规则 11）
//   POST /api/sync/preview             先看后写（→ batchId + 增减改明细）
//   POST /api/sync/commit              正式写入（单事务 —— 规则 15）
//   GET  /api/sync/batches             历史批次（审计 —— 规则 9）
//   GET  /api/sync/batches/:id         批次详情
//   POST /api/sync/detach              脱离同步（镜像行 → 自有行）
//   POST /api/sync/foreign/remove      移除本账号的外来副本（不动源）
//
// 批次 E（v0.12）把同步对象从 markers 扩到 competitors，并支持「一次批次多对象」：
//   · candidates / preview / commit 的 kinds 入参支持逗号分隔（`markers,competitors`）
//   · mirrors 支持 `kind=all` 合并两表（每行带 kind）
//   · scope-options 回传 kinds 元数据（前端不再硬编码对象清单）
//   ⚠️ 对象清单的唯一真源是 syncCore.SYNC_KINDS —— 加对象只改那里 + KIND_META。
//
// P2（v0.13）回滚 + 历史方向放开：
//   POST /api/sync/batches/:id/rollback   回滚批次（transfer 完整可逆；普通批次只可逆「新增」那半）
//   GET  /api/sync/batches                方向白名单加入 `transfer`（辖区划拨也进历史，可回滚）
//   ★ 划拨本身不在这里 —— 它挂 /api/orgs/:id/transfer/*（见 routes/orgs.js），
//     因为它需要组织级鉴权（requireOrgOwner）与 scope 调整。
//
// ★ 分文件而不是塞进 orgs.js 的原因：路径前缀就是 /api/sync（设计方案 §6），
//   而 orgs.js 挂在 /api/orgs 上；把 /scope-options 放进 orgs.js 会与 /:id 抢段位。
//
// ⛔ 刻意不实现（勿「补全」）：
//   - 反向同步（子公司 → 集团 的**自动**推送）：本方案是「集团主动拉」，规则 5
//   - 跨组织同步：集团只能看到本组织成员（规则 10 / 24 的不跨组织红线）
//   - 冲突合并 UI：单写者模型下结构上不存在冲突（规则 4），合并 UI 是伪需求
//   - 普通批次的「内容级」回滚：内核**不存 before-image**（1904 行 × 全字段 ≈ 数百 KB，
//     每次 preview 都写盘会撑爆 sql.js 的整库导出），故只能还原「新增」那一半。
// ============================================================================

import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { normalizeCity, parseCityList, parseBrandList } from '../utils/scopeGuard.js'
import {
  DIRECTIONS,
  SYNC_KINDS,
  KIND_META,
  normalizeKinds,
  buildPlanForKinds,
  applyPlan,
  listCandidatesForKinds,
  createBatch,
  findBatch,
  serializeBatch,
  checkMemberSwitch,
  parseBatchDetail,
  rollbackBatch
} from '../utils/syncCore.js'

const router = express.Router()

// ---------------------------------------------------------------------------
// 组织上下文解析
// ---------------------------------------------------------------------------

function toId(v) {
  const n = Number.parseInt(v, 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

function findOrg(db, id) {
  return db.prepare(`SELECT * FROM organizations WHERE id = ? AND dissolved_at IS NULL`).get(id) || null
}

function findMember(db, orgId, userId) {
  return db.prepare(`SELECT * FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, userId) || null
}

/**
 * 解析调用者在组织里的视角。
 *   view = 'owner'  集团总部账号本人
 *   view = 'member' 本组织成员本人
 *   view = 'admin'  平台管理员（必须显式传 orgId —— 管理员可能管着多个集团，
 *                   不替他猜「当前集团」是哪个）
 * 返回 { org, view, member } 或 { error:{status, body} }
 */
function resolveOrgView(req, db) {
  const meId = req.user?.id
  const isPlatformAdmin = req.user?.role === 'admin'
  const orgIdParam = toId(req.query?.orgId ?? req.body?.orgId)

  if (orgIdParam) {
    const org = findOrg(db, orgIdParam)
    if (!org) return { error: { status: 404, body: { message: '集团不存在' } } }
    if (org.owner_user_id === meId) return { org, view: 'owner', member: null }
    const mine = findMember(db, org.id, meId)
    if (mine) return { org, view: 'member', member: mine }
    if (isPlatformAdmin) return { org, view: 'admin', member: null }
    console.warn(`[sync] 组织边界拒绝 user=${meId} org=${org.id} ${req.method} ${req.originalUrl} ip=${req.ip}`)
    return { error: { status: 403, body: { message: '无权限操作该集团的数据同步' } } }
  }

  // 未指定 orgId：按调用者身份自动定位
  const ownOrg = db.prepare(`
    SELECT * FROM organizations WHERE owner_user_id = ? AND dissolved_at IS NULL
  `).get(meId)
  if (ownOrg) return { org: ownOrg, view: 'owner', member: null }

  const mine = db.prepare(`SELECT * FROM org_members WHERE user_id = ?`).get(meId)
  if (mine) {
    const org = findOrg(db, mine.org_id)
    if (org) return { org, view: 'member', member: mine }
  }

  if (isPlatformAdmin) return { error: { status: 400, body: { message: '请指定 orgId（平台管理员不属于任何集团）' } } }
  return { error: { status: 404, body: { message: '当前账号不属于任何集团' } } }
}

/**
 * 解析「源 / 目标 / 成员」三要素（两个方向共用）。
 *   group_to_member → 源 = 集团账号，目标 = 成员
 *   member_to_group → 源 = 成员，    目标 = 集团账号
 * 返回 { direction, memberUserId, member, sourceUserId, targetUserId } 或 { error }
 */
function resolveTransfer({ db, org, view, meId, direction, memberUserId }) {
  if (!SYNC_KINDS.length) return { error: { status: 500, body: { message: '未配置可同步对象' } } }
  if (![DIRECTIONS.GROUP_TO_MEMBER, DIRECTIONS.MEMBER_TO_GROUP].includes(direction)) {
    return { error: { status: 400, body: { message: 'direction 无效（group_to_member | member_to_group）' } } }
  }

  const mId = toId(memberUserId)
  if (!mId) return { error: { status: 400, body: { message: '缺少 userId（子公司成员）' } } }

  const member = findMember(db, org.id, mId)
  if (!member) return { error: { status: 404, body: { message: '该账号不是本集团成员' } } }

  // 权限：①集团下发 —— owner/admin 发起，成员本人也可主动拉取
  //       ②集团拉取 —— 仅 owner/admin（成员无权决定「把我的数据推给集团」）
  if (direction === DIRECTIONS.MEMBER_TO_GROUP && view === 'member') {
    return { error: { status: 403, body: { message: '「从子公司同步」仅集团总部账号可发起' } } }
  }
  if (direction === DIRECTIONS.GROUP_TO_MEMBER && view === 'member' && mId !== meId) {
    return { error: { status: 403, body: { message: '子公司只能同步自己的管辖范围数据' } } }
  }

  const sw = checkMemberSwitch(member, direction)
  if (!sw.ok) return { error: { status: 409, body: { code: sw.code, message: sw.message } } }

  const ownerId = org.owner_user_id
  return direction === DIRECTIONS.GROUP_TO_MEMBER
    ? { direction, memberUserId: mId, member, sourceUserId: ownerId, targetUserId: mId }
    : { direction, memberUserId: mId, member, sourceUserId: mId, targetUserId: ownerId }
}

/**
 * 管辖范围（集团设定）∩ 本次筛选 → 实际生效的范围。
 * ★ 双重圈定（§D4）：scope 是**上限**，本次筛选只能在其中收窄；
 *   前端就算传来越界的城市，也会被交集过滤掉（规则 11 静默丢弃的服务端侧保证）。
 */
function mergeScopeWithFilter(scopeJson, filter) {
  const scopeCities = parseCityList(scopeJson)
  const scopeBrands = parseBrandList(scopeJson)

  let cities = scopeCities
  const fc = Array.isArray(filter?.cities) ? filter.cities.map(c => String(c).trim()).filter(Boolean) : []
  if (fc.length) {
    const scopeKeys = new Set(scopeCities.map(normalizeCity))
    cities = fc.filter(c => scopeKeys.has(normalizeCity(c)))
  }

  let brands = scopeBrands
  const fb = Array.isArray(filter?.brands) ? filter.brands.map(b => String(b).trim()).filter(Boolean) : []
  if (fb.length) {
    const scopeSet = new Set(scopeBrands.map(b => String(b).trim()))
    brands = scopeBrands.length ? fb.filter(b => scopeSet.has(b)) : fb
  }

  return { scopeJson: JSON.stringify({ cities, brands }), cities, brands }
}

/** 账号展示名（写进镜像行的 origin_owner，免 JOIN —— §5.2） */
function displayName(db, userId) {
  const u = db.prepare(`SELECT username, company FROM users WHERE id = ?`).get(userId)
  if (!u) return `#${userId}`
  return String(u.company || '').trim() || String(u.username || `#${userId}`).trim()
}

/**
 * 解析请求里的 kinds（批次 E：一个批次可含多个对象）。
 * 委派给 syncCore.normalizeKinds —— 保证「非法/缺省」的回落口径与内核**同源**，
 * 不会出现「路由认为是 markers、内核认为是 competitors」的错位。
 */
function kindsFromQuery(v) {
  return normalizeKinds(v)
}

// ---------------------------------------------------------------------------
// GET /api/sync/scope-options（批次 C）
// ---------------------------------------------------------------------------

/**
 * 管辖范围抽屉（§7.5）的下拉数据源。
 *
 * 入参：
 *   orgId   可选。给出时选项取**集团总部账号**名下的数据，并校验调用者是
 *           本组织 owner 或平台 admin；缺省时退化为「取自己账号的数据」。
 *   userId  可选。用于回显该成员当前已选城市（selected）。
 *
 * 返回：
 *   cities  [{ name, key, count }]  城市候选（按门店数降序）
 *   brands  string[]                品牌候选（markers.brand ∪ competitors.brand）
 *   totalMarkers                    集团账号门店总数（用于「预计可同步」）
 *   selected                        该成员当前 scope 里的城市（回显用）
 *
 * ★ 城市候选为什么取「集团账号 markers 里出现过的城市」而不是行政区划全集：
 *   scope 的语义是「集团能同步给子公司哪些城市」（§D4 两层圈定），
 *   集团根本没有门店的城市设了也没有任何行可同步，反而把下拉框撑到几千项。
 *   只到城市级、不细分区县 —— 规则 11。
 */
router.get('/scope-options', authenticate, (req, res) => {
  try {
    const db = getDb()
    const orgIdRaw = Number.parseInt(req.query?.orgId, 10)
    let org = null
    let sourceUserId = req.user?.id

    if (Number.isInteger(orgIdRaw) && orgIdRaw > 0) {
      org = db.prepare(`
        SELECT * FROM organizations WHERE id = ? AND dissolved_at IS NULL
      `).get(orgIdRaw)
      if (!org) return res.status(404).json({ message: '集团不存在' })

      const isAdmin = req.user?.role === 'admin'
      const isOwner = org.owner_user_id === req.user?.id
      // ★ 成员本人也要能读：他需要知道「集团授权给我的城市有哪些」才能做本次筛选
      //   （§D5 读权限 = 集团或本人；写权限仍仅 owner）。缺了这条，子公司页面会
      //   因为 403 而拿不到城市下拉（UI 验证时实际踩到）。
      const mine = db.prepare(`
        SELECT user_id FROM org_members WHERE org_id = ? AND user_id = ?
      `).get(org.id, req.user?.id)
      if (!isAdmin && !isOwner && !mine) {
        console.warn(
          `[sync] 组织边界拒绝(scope-options) user=${req.user?.id} org=${org.id} `
          + `${req.method} ${req.originalUrl} ip=${req.ip}`
        )
        return res.status(403).json({ message: '无权限查看该集团的管辖范围选项' })
      }
      sourceUserId = org.owner_user_id   // 选项取自集团账号名下的数据
    }

    // ---- 城市候选：按归一化键聚合（「上海市 / 上海」视为同城）----
    const cityRows = db.prepare(`
      SELECT city, COUNT(*) AS n
        FROM markers
       WHERE user_id = ? AND city IS NOT NULL AND TRIM(city) != ''
       GROUP BY city
       ORDER BY n DESC
    `).all(sourceUserId)

    const cityMap = new Map()
    for (const r of cityRows) {
      const key = normalizeCity(r.city)
      if (!key) continue
      const hit = cityMap.get(key)
      if (hit) {
        hit.count += r.n
      } else {
        cityMap.set(key, { name: String(r.city).trim(), key, count: r.n })
      }
    }
    const cities = [...cityMap.values()].sort((a, b) => b.count - a.count)

    // ---- 品牌候选：自家门店 ∪ 竞品门店 ----
    const brandSet = new Set()
    const pushBrands = (rows) => {
      for (const r of rows) {
        const b = String(r.brand ?? '').trim()
        if (b) brandSet.add(b)
      }
    }
    pushBrands(db.prepare(`
      SELECT DISTINCT brand FROM markers
       WHERE user_id = ? AND brand IS NOT NULL AND TRIM(brand) != ''
    `).all(sourceUserId))
    pushBrands(db.prepare(`
      SELECT DISTINCT brand FROM competitors
       WHERE user_id = ? AND brand IS NOT NULL AND TRIM(brand) != ''
    `).all(sourceUserId))
    const brands = [...brandSet].sort((a, b) => a.localeCompare(b, 'zh'))

    // ---- 该成员当前已选（回显用；集团无数据的已选城市也应能显示出来）----
    let selected = []
    const memberUserId = Number.parseInt(req.query?.userId, 10)
    if (org && Number.isInteger(memberUserId) && memberUserId > 0) {
      const m = db.prepare(`
        SELECT scope_json FROM org_members WHERE org_id = ? AND user_id = ?
      `).get(org.id, memberUserId)
      selected = parseCityList(m?.scope_json)
    }

    res.json({
      ok: true,
      orgId: org ? org.id : null,
      sourceUserId,
      // 可同步对象元数据（批次 E：前端据「数据范围」复选框渲染，避免前端硬编码）
      kinds: SYNC_KINDS.map(k => ({ kind: k, ...KIND_META[k] })),
      cities,
      brands,
      totalMarkers: cities.reduce((s, c) => s + c.count, 0),
      selected,
      note: '城市候选 = 集团账号「我的门店」中出现过的城市；管辖范围只到城市级（规则 11）'
    })
  } catch (error) {
    console.error('获取管辖范围选项失败:', error)
    res.status(500).json({ message: '获取管辖范围选项失败' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/sync/candidates —— 候选（规则 11）
// ---------------------------------------------------------------------------

router.get('/candidates', authenticate, (req, res) => {
  try {
    const db = getDb()
    const ctx = resolveOrgView(req, db)
    if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body)

    const direction = String(req.query?.direction || '').trim()
      || (ctx.view === 'member' ? DIRECTIONS.GROUP_TO_MEMBER : DIRECTIONS.MEMBER_TO_GROUP)

    const memberUserId = toId(req.query?.userId) || (ctx.view === 'member' ? req.user.id : null)
    const tr = resolveTransfer({
      db, org: ctx.org, view: ctx.view, meId: req.user?.id, direction, memberUserId
    })
    if (tr.error) return res.status(tr.error.status).json(tr.error.body)

    const kinds = kindsFromQuery(req.query?.kind || req.query?.kinds)
    const citiesRaw = String(req.query?.cities || '').split(',').map(s => s.trim()).filter(Boolean)
    const brandsRaw = String(req.query?.brands || '').split(',').map(s => s.trim()).filter(Boolean)
    const merged = mergeScopeWithFilter(tr.member.scope_json, { cities: citiesRaw, brands: brandsRaw })

    const out = listCandidatesForKinds(db, {
      kinds,
      sourceUserId: tr.sourceUserId,
      targetUserId: tr.targetUserId,
      scopeJson: merged.scopeJson,
      belongUserId: tr.memberUserId,
      keyword: req.query?.keyword || ''
    })

    res.json({
      ok: true,
      direction: tr.direction,
      kinds,
      kind: kinds[0],          // 向下兼容单对象读者
      kindMeta: KIND_META,
      memberUserId: tr.memberUserId,
      scope: { cities: merged.cities, brands: merged.brands },
      scopeCities: parseCityList(tr.member.scope_json),
      ...out,
      emptyScope: parseCityList(tr.member.scope_json).length === 0,
      hint: parseCityList(tr.member.scope_json).length === 0
        ? '尚未为该账号设置管辖范围（城市）→ 没有任何行可同步。请先在「用户管理 → 集团/子公司」里点「设置范围」。'
        : null
    })
  } catch (error) {
    console.error('获取同步候选失败:', error)
    res.status(500).json({ message: '获取同步候选失败' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/sync/preview —— 先看后写
// ---------------------------------------------------------------------------

/**
 * 入参 { orgId?, userId, direction, kind?, filter{cities[],brands[],keyword} }
 * 返回 { batchId, direction, items{added,updated,deleted,skipped}, counts }
 *
 * ★ 每次调用都会建一条 `status='preview'` 的批次行 —— 它**不是**数据写入，
 *   只是把「这次打算怎么同步」的参数留痕。真正写 markers 的只有 /commit。
 *   ⇒ 首次同步结构上必然先经过预览（我建议的「默认 dry-run」就是这样落实的：
 *     不是加一个 dryRun 开关，而是 commit 必须携带 preview 产生的 batchId，
 *     没有预览就没有批次、没有批次就提交不了）。
 */
router.post('/preview', authenticate, (req, res) => {
  try {
    const db = getDb()
    const ctx = resolveOrgView(req, db)
    if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body)

    const body = req.body || {}
    const direction = String(body.direction || '').trim()
      || (ctx.view === 'member' ? DIRECTIONS.GROUP_TO_MEMBER : DIRECTIONS.MEMBER_TO_GROUP)
    const memberUserId = toId(body.userId) || (ctx.view === 'member' ? req.user.id : null)

    const tr = resolveTransfer({
      db, org: ctx.org, view: ctx.view, meId: req.user?.id, direction, memberUserId
    })
    if (tr.error) return res.status(tr.error.status).json(tr.error.body)

    const kinds = kindsFromQuery(body.kind || body.kinds)
    const merged = mergeScopeWithFilter(tr.member.scope_json, body.filter || {})
    const keyword = String(body.filter?.keyword || '')

    const plan = buildPlanForKinds(db, {
      kinds,
      direction: tr.direction,
      sourceUserId: tr.sourceUserId,
      targetUserId: tr.targetUserId,
      scopeJson: merged.scopeJson,
      belongUserId: tr.memberUserId,
      keyword,
      targetLabel: displayName(db, tr.sourceUserId)
    })

    const batchId = createBatch(db, {
      orgId: ctx.org.id,
      direction: tr.direction,
      sourceUserId: tr.sourceUserId,
      targetUserId: tr.targetUserId,
      kinds,
      plan,
      params: {
        direction: tr.direction,
        memberUserId: tr.memberUserId,
        sourceUserId: tr.sourceUserId,
        targetUserId: tr.targetUserId,
        kinds,
        scopeJson: merged.scopeJson,
        belongUserId: tr.memberUserId,
        keyword,
        targetLabel: displayName(db, tr.sourceUserId)
      },
      createdBy: req.user?.id,
      ip: req.ip
    })

    res.json({
      ok: true,
      batchId,
      direction: tr.direction,
      kinds,
      kind: kinds[0],          // 向下兼容单对象读者
      kindMeta: KIND_META,
      memberUserId: tr.memberUserId,
      sourceUserId: tr.sourceUserId,
      targetUserId: tr.targetUserId,
      sourceName: displayName(db, tr.sourceUserId),
      memberName: displayName(db, tr.memberUserId),
      // ★ 显式给出 targetName：member_to_group 时 target 是集团账号，
      //   前端若只用 source/member 两个名字画「A → B」会渲染成「子公司 → 子公司」
      targetName: displayName(db, tr.targetUserId),
      scope: { cities: merged.cities, brands: merged.brands },
      items: plan.items,
      counts: plan.counts
    })
  } catch (error) {
    console.error('生成同步预览失败:', error)
    res.status(500).json({ message: '生成同步预览失败' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/sync/commit —— 正式写入（单事务）
// ---------------------------------------------------------------------------

/**
 * 入参 { batchId, excluded[] }
 * ★ **重建计划**而不是回放存下来的明细：预览到确认之间源侧可能被改过，
 *   按最新状态重算才不会写入过期数据（存明细还会让库白白膨胀数百 KB）。
 *   `excluded` 里的 key 形如 `added:<行id>` / `updated:<镜像行id>` / `deleted:<镜像行id>`，
 *   重建后 key 稳定，用户取消勾选仍然有效。
 */
router.post('/commit', authenticate, (req, res) => {
  try {
    const db = getDb()
    const batchId = toId(req.body?.batchId)
    if (!batchId) return res.status(400).json({ message: '缺少 batchId' })

    const batch = findBatch(db, batchId)
    if (!batch) return res.status(404).json({ message: '批次不存在' })

    const org = findOrg(db, batch.org_id)
    if (!org) return res.status(404).json({ message: '集团不存在或已解散' })

    const meId = req.user?.id
    const isAdmin = req.user?.role === 'admin'
    const isOwner = org.owner_user_id === meId
    const isTargetMember = batch.target_user_id === meId
    // 「从集团同步」由子公司本人点确认；「从子公司同步」仅集团/管理员
    const allowed = isAdmin || isOwner
      || (batch.direction === DIRECTIONS.GROUP_TO_MEMBER && isTargetMember)
    if (!allowed) return res.status(403).json({ message: '无权限提交该同步批次' })

    if (batch.status !== 'preview') {
      return res.status(409).json({
        code: 'batch_not_preview',
        message: `该批次已是「${batch.status}」状态，不能重复提交。请重新预览。`
      })
    }

    const detail = parseBatchDetail(batch.detail)
    const params = detail?.params
    if (!params) return res.status(409).json({ message: '批次参数缺失，请重新预览' })

    const plan = buildPlanForKinds(db, {
      kinds: params.kinds || (params.kind ? [params.kind] : ['markers']),
      direction: params.direction,
      sourceUserId: params.sourceUserId,
      targetUserId: params.targetUserId,
      scopeJson: params.scopeJson,
      belongUserId: params.belongUserId,
      keyword: params.keyword,
      targetLabel: params.targetLabel
    })

    const result = applyPlan(db, {
      plan,
      excluded: Array.isArray(req.body?.excluded) ? req.body.excluded : [],
      batchId,
      sourceLabel: params.targetLabel
    })

    console.log(
      `[sync] commit batch=${batchId} dir=${params.direction} `
      + `src=${params.sourceUserId} tgt=${params.targetUserId} `
      + `ins=${result.inserted} upd=${result.updated} del=${result.deleted} `
      + `skip=${result.skipped} fail=${result.failed} by=${meId}`
    )

    res.json({
      ok: true,
      batchId,
      status: result.status,
      applied: {
        inserted: result.inserted,
        updated: result.updated,
        deleted: result.deleted,
        skipped: result.skipped,
        failed: result.failed
      },
      planned: plan.counts,
      detail: result.detail,
      batch: serializeBatch(findBatch(db, batchId), { withDetail: false })
    })
  } catch (error) {
    console.error('提交同步失败:', error)
    res.status(500).json({ message: '提交同步失败（已整体回滚）' })
  }
})

// ---------------------------------------------------------------------------
// 历史批次（审计）
// ---------------------------------------------------------------------------

router.get('/batches', authenticate, (req, res) => {
  try {
    const db = getDb()
    const ctx = resolveOrgView(req, db)
    if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body)

    const limit = Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || 50, 1), 200)
    const includePreview = String(req.query?.includePreview || '') === '1'
    // scope_change（范围变更留痕）默认不进历史：集团给 N 个成员配范围就会刷 N 条，
    // 会把「数据动了哪些」淹没。需要审计范围变更时显式 `?includeScope=1`。
    const includeScope = String(req.query?.includeScope || '') === '1'

    // 成员只看与自己相关的批次；集团/管理员看本组织全部
    const args = [ctx.org.id]
    const directions = ["'group_to_member'", "'member_to_group'", "'transfer'"]
    if (includeScope) directions.push("'scope_change'")
    let where = `org_id = ? AND direction IN (${directions.join(',')})`
    if (!includePreview) where += ` AND status != 'preview'`
    if (ctx.view === 'member') {
      where += ` AND (source_user_id = ? OR target_user_id = ?)`
      args.push(req.user.id, req.user.id)
    }
    args.push(limit)

    const rows = db.prepare(`
      SELECT * FROM sync_batches WHERE ${where} ORDER BY id DESC LIMIT ?
    `).all(...args)

    res.json({
      ok: true,
      orgId: ctx.org.id,
      view: ctx.view,
      batches: rows.map(r => serializeBatch(r))
    })
  } catch (error) {
    console.error('获取同步历史失败:', error)
    res.status(500).json({ message: '获取同步历史失败' })
  }
})

router.get('/batches/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const id = toId(req.params.id)
    if (!id) return res.status(400).json({ message: '批次 id 无效' })

    const batch = findBatch(db, id)
    if (!batch) return res.status(404).json({ message: '批次不存在' })

    const org = findOrg(db, batch.org_id)
    if (!org) return res.status(404).json({ message: '集团不存在或已解散' })

    const meId = req.user?.id
    const isAdmin = req.user?.role === 'admin'
    const inOrg = org.owner_user_id === meId || batch.source_user_id === meId || batch.target_user_id === meId
    if (!isAdmin && !inOrg) return res.status(403).json({ message: '无权限查看该批次' })

    res.json({
      ok: true,
      batch: serializeBatch(batch, { withDetail: true }),
      sourceName: displayName(db, batch.source_user_id),
      targetName: displayName(db, batch.target_user_id)
    })
  } catch (error) {
    console.error('获取批次详情失败:', error)
    res.status(500).json({ message: '获取批次详情失败' })
  }
})

// ---------------------------------------------------------------------------
// 回滚批次（P2 · §3.5 Ⅱ-c / §7.2 ④）
// ---------------------------------------------------------------------------

/**
 * POST /api/sync/batches/:id/rollback   { force? }
 *
 * 权限：**仅本集团总部账号或平台管理员**（回滚是撤回别人已经看到的数据，
 * 不能让被同步的一方自己决定—— 成员视角只在历史里看到行，不给他按钮）。
 *
 * 两类批次语义不同（见 syncCore.rollbackBatch 注释）：
 *   · transfer            完整可逆（moved ids 在 detail 里）→ 改回 user_id + store_sales + 镜像 + scope
 *                         目标方已编辑过 → 409 `target_edited`，须 `force` 重试（会覆盖其修改）
 *   · 普通同步批次        只可逆「新增」那半（删除本批镜像）；更新/删除无 before-image → notRestorable
 *   · scope_change        不可回滚（配置留痕）→ 400
 */
router.post('/batches/:id/rollback', authenticate, (req, res) => {
  try {
    const db = getDb()
    const id = toId(req.params.id)
    if (!id) return res.status(400).json({ message: '批次 id 无效' })

    const batch = findBatch(db, id)
    if (!batch) return res.status(404).json({ message: '批次不存在' })

    const org = findOrg(db, batch.org_id)
    if (!org) return res.status(404).json({ message: '集团不存在或已解散' })

    const isAdmin = req.user?.role === 'admin'
    const isOwner = org.owner_user_id === req.user?.id
    if (!isAdmin && !isOwner) {
      console.warn(
        `[sync] 组织边界拒绝(rollback) user=${req.user?.id} org=${org.id} batch=${id} `
        + `${req.method} ${req.originalUrl} ip=${req.ip}`
      )
      return res.status(403).json({ message: '仅集团总部账号或平台管理员可回滚批次' })
    }

    const force = req.body?.force === true
      || req.query?.force === '1' || req.query?.force === 'true'

    const r = rollbackBatch(db, { batch, force, actorId: req.user?.id })
    if (!r.ok) {
      const status = r.code === 'not_found' ? 404
        : (r.code === 'target_edited' || r.code === 'no_snapshot') ? 409
          : 400
      return res.status(status).json(r)
    }

    const msg = r.direction === 'transfer'
      ? `已回滚划拨：${r.restored.markers} 家门店及其 ${r.restored.storeSales} 条销售记录改回原持有方，`
        + `集团侧镜像与双方管辖范围已一并还原。`
      : `已回滚：删除本批新增的 ${r.restored.inserted} 行镜像。`
        + (r.partial
          ? `另有 ${r.notRestorable.updated} 行更新 / ${r.notRestorable.deleted} 行删除无快照可还原，`
            + '如需恢复请让源账号重新发起同步。'
          : '')

    res.json({ ok: true, ...r, message: msg })
  } catch (error) {
    console.error('回滚批次失败:', error)
    res.status(500).json({ message: '回滚批次失败（已整体回滚）' })
  }
})

// ---------------------------------------------------------------------------
// 外来数据管理（§7.3）
// ---------------------------------------------------------------------------

/**
 * POST /api/sync/detach  { kind, ids[] }
 * 脱离同步：镜像行 → 自有行（清 origin_* + sync_readonly=0）→ 此后不再被覆盖。
 * ★ 只动**自己名下**的行；源侧那行不受任何影响（它是别人的数据）。
 */
router.post('/detach', authenticate, (req, res) => {
  try {
    const db = getDb()
    const kind = SYNC_KINDS.includes(req.body?.kind) ? req.body.kind : 'markers'
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(toId).filter(Boolean) : []
    if (!ids.length) return res.status(400).json({ message: '缺少要脱离同步的行 id' })

    let changed = 0
    db.beginTx()
    try {
      for (const id of ids) {
        const r = db.prepare(`
          UPDATE ${kind}
             SET origin_user_id = NULL, origin_row_id = NULL, origin_owner = NULL,
                 sync_batch_id = NULL, sync_readonly = 0, updated_at = datetime('now')
           WHERE id = ? AND user_id = ? AND sync_readonly = 1
        `).run(id, req.user.id)
        if (r && r.changes > 0) changed++
      }
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    res.json({ ok: true, changed, message: `已脱离同步 ${changed} 行，此后不再被源账号覆盖` })
  } catch (error) {
    console.error('脱离同步失败:', error)
    res.status(500).json({ message: '脱离同步失败' })
  }
})

/**
 * POST /api/sync/foreign/remove  { kind, ids[] }
 * 移除本账号名下的外来副本（只删自己的副本，**不影响源账号**）。
 */
router.post('/foreign/remove', authenticate, (req, res) => {
  try {
    const db = getDb()
    const kind = SYNC_KINDS.includes(req.body?.kind) ? req.body.kind : 'markers'
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(toId).filter(Boolean) : []
    if (!ids.length) return res.status(400).json({ message: '缺少要移除的行 id' })

    let changed = 0
    db.beginTx()
    try {
      for (const id of ids) {
        const r = db.prepare(`
          DELETE FROM ${kind}
           WHERE id = ? AND user_id = ? AND origin_user_id IS NOT NULL
        `).run(id, req.user.id)
        if (r && r.changes > 0) changed++
      }
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    res.json({ ok: true, changed, message: `已移除 ${changed} 行外来副本（源账号数据未受影响）` })
  } catch (error) {
    console.error('移除外来副本失败:', error)
    res.status(500).json({ message: '移除外来副本失败' })
  }
})

/**
 * GET /api/sync/mirrors?kind=markers|competitors|all&limit=200
 * 本账号名下的**外来副本**（镜像行）—— 这是只读锁的「出口」页面用得上的数据：
 * 用户看到某行改不了时，需要能在这里「脱离同步」或「移除副本」。
 * 只查自己（user_id = 我），不跨账号（规则 10）。
 *
 * ★ 批次 E：`kind=all` 合并 markers + competitors（每行带 `kind`），
 *   否则 ② 选了「竞品门店」的用户在 ④ 看不到自己刚同步来的竞品镜像。
 *   `limit` 在 all 模式下**按对象各自生效**（避免一个对象把页额吃光）。
 */
router.get('/mirrors', authenticate, (req, res) => {
  try {
    const db = getDb()
    const raw = String(req.query?.kind || '').trim()
    const kinds = raw === 'all' ? SYNC_KINDS.slice() : [SYNC_KINDS.includes(raw) ? raw : 'markers']
    const limit = Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || 200, 1), 1000)

    const rows = []
    for (const kind of kinds) {
      const part = db.prepare(`
        SELECT id, name, store_code, brand, city, district, address,
               origin_user_id, origin_row_id, origin_owner, sync_batch_id, sync_readonly
          FROM ${kind}
         WHERE user_id = ? AND origin_user_id IS NOT NULL
         ORDER BY origin_owner, id
         LIMIT ?
      `).all(req.user.id, limit) || []
      for (const r of part) rows.push({ ...r, kind })
    }

    const grouped = {}
    for (const r of rows) {
      const key = String(r.origin_owner || `#${r.origin_user_id}`)
      grouped[key] = (grouped[key] || 0) + 1
    }
    const byKind = {}
    for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1

    res.json({
      ok: true,
      kinds,
      count: rows.length,
      byKind,
      bySource: Object.entries(grouped).map(([name, n]) => ({ name, count: n })),
      mirrors: rows,
      hint: '镜像行由来源账号维护，本账号不能直接改/删；如需本地修改请「脱离同步」（转为自有行），或「移除副本」（只删本账号这份）。'
    })
  } catch (error) {
    console.error('获取外来副本失败:', error)
    res.status(500).json({ message: '获取外来副本失败' })
  }
})

export default router
