/**
 * 候选点位 + 推进流水（v1.13.333 · P1-6「轻量工作流」）
 * ---------------------------------------------------------------------------
 * 场景：选址经理在图上选了个铺位，还没开店。他要能把它存下来、标状态、留一句推进记录，
 *   让「这批点位现在推到哪一步」一眼看得见 —— 而不是散在微信和 Excel 里。
 *
 * 🔴🔴 三条设计红线（改代码前必读）
 *   ① **候选点位不进 markers 表**（业主 2026-11-09 拍板独立表）。
 *      markers 被门店体检 / 销售预测 / 台账去重 / 集团同步 / 各类统计全都在读，
 *      往里塞候选点等于把「读路径铁律」逐条重改（每条统计都得再加"非候选"过滤），
 *      成本与风险远大于收益。⇒ 本表独立，计算时复用**函数**，不复用**表**。
 *   ② **`markers.status` 是经营状态**（正常/关注/暂停/关闭），与推进阶段是两套语义，⛔ 不复用字段。
 *   ③ **备注只追加、不改写**：选址推进过程要能回溯。⛔ 不做可编辑备注框。
 *
 * 🔴🔴 v1.13.376（P0）**数据源反转**：列表改为**读 `markers` 里的候选门店**
 *   （`store_type ∈ 重点候选/一般候选`），`store_candidates` 降级为「阶段 + 流水」的叠加层。
 *   业主原话：「候选点位读取『我的门店』中登录的一般候选与重要候选门店」。
 *
 *   合成规则（`buildRows`）：
 *     · 每个候选门店 ⇒ 一行，`origin:'store'`，stage/radius/area/rent 由关联的
 *       `store_candidates` 行覆盖（关联判据见 `utils/candidateLink.js`）
 *     · 没被任何门店认领的 `store_candidates` 行 ⇒ 仍单独显示，`origin:'candidate'`
 *       （＝333~375 期间手工建/地图右键存的点位。⛔ 不许静默吞掉：那是用户的推进记录）
 *    ⇒ 所以 `id` **可能为 null**（门店还没有推进记录）。前端要写操作前先调 `POST /ensure`。
 *
 *   🔴 三个必须守住的边界：
 *     1. 列表**只读**：`GET /` 不建行、不改行。惰性建行只在 `POST /ensure`（用户真要写时才发生）。
 *     2. `origin:'store'` 的行**不可删除**（`DELETE` 会 400）：候选点位页是门店的**视图**，
 *        删视图不能删源数据。不想看到它 ⇒ 去「我的门店」把门店类型改掉。
 *     3. 筛选（stage/city/keyword）改在 JS 里做：两个来源要合并后才能正确分页与计数，
 *        放在 SQL 里就只能筛其中一个来源，会出现「筛选后计数和列表对不上」。
 *
 * 🔴 可见性：一律 `WHERE user_id = ?` —— 只本人可见，`admin` 也**不放大**
 *    （与 `/api/markers` 同口径：体检、点位都是"我这批店"的自我检查，混进别人的会误判）。
 *    ⛔ 不要顺手接 visibleScope / readableUserIds。
 *    ⚠️ 现网有 3 条 `markers.user_id IS NULL` 的候选门店（BJ003/BJ005/SH002，见 376 核查），
 *       `user_id = ?` 天然把它们排除 —— 这是**有意**的：没有归属的门店不属于任何人，
 *       在这里出现等于把别人的店显示给你。
 *
 * ⚠️ STAGES 这四个字符串是**落库值**：改动必须同步
 *    `frontend/src/utils/candidateStage.js`（前端唯一来源）与 database.js 的建表默认值，
 *    守卫 `tests/candidateWorkflow.test.js` 三处对比，改一处就红。
 *
 * ⚠️ 幂等零迁移：两张表由 models/database.js 的 CREATE TABLE IF NOT EXISTS 在启动时建，
 *    生产 `pm2 restart` 即生效，无需手工脚本。（`store_code` 列走 ALTER 补，见 database.js）
 */
import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { linkAll, matchCandidate } from '../utils/candidateLink.js'
import { planarMeters } from '../utils/potentialGrid.js'

const router = express.Router()

/** 推进四档（业主 2026-11-09 定；顺序＝推进正序，⛔ 不要重排：前端统计条按此顺序渲染） */
const STAGES = ['待评估', '已勘踏', '立项', '放弃']

/**
 * 哪些 `markers.store_type` 算「候选门店」。
 * 🔴 与前端 `stores/marker.js::storeTypes`、`utils/importSpecs.js` 必须同口径（都是
 *    `['已开业','重点候选','一般候选']` 里的后两个）。业主口语说的「重要候选」＝库里的「重点候选」，
 *    ⛔ 不要为了对齐口语去改枚举值：那个字符串是**落库值**，改它要迁 data、改 map.js 配色、
 *    改 importSpecs，且历史上写进库的老值是「重点候选」。
 */
const CANDIDATE_STORE_TYPES = ['重点候选', '一般候选']

/** 门店没有推进记录时的默认评估半径（与 store_candidates.radius 的建表默认值一致） */
const DEFAULT_RADIUS = 1000

/** 字段长度上限（服务端兜底，防超长文本撑库；与前端 maxlength 同口径） */
const FIELD_MAX = { name: 60, brand: 40, city: 20, district: 20, address: 200, drop_reason: 200, note: 500 }

/** 半径上下限（米）：小于 100m 没有商业意义，大于 50km 会拖垮前端圆渲染 */
const RADIUS_MIN = 100
const RADIUS_MAX = 50000

function str(v) {
  return String(v ?? '').trim()
}

/** 数字解析：非数字/空 ⇒ null（⛔ 不要 fallback 成 0：0 ㎡ 与"没填"是两件事） */
function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clampInt(v, min, max, dflt) {
  const n = num(v)
  if (n === null) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * 取本人点位；不属于本人 ⇒ null（路由统一按 404 处理，不区分"不存在"与"不是你的"，
 * 避免用 id 探测别人有没有这个点位）。
 */
function ownCandidate(db, id, userId) {
  const cid = Number(id)
  if (!cid) return null
  return db.prepare('SELECT * FROM store_candidates WHERE id = ? AND user_id = ?').get(cid, userId) || null
}

/** 流水列表（时间正序：故事按发生顺序读） */
function notesOf(db, candidateId) {
  return db.prepare(
    `SELECT id, from_stage, to_stage, note, user_id, created_at
       FROM candidate_notes WHERE candidate_id = ? ORDER BY created_at ASC, id ASC`
  ).all(candidateId)
}

/**
 * 本人名下的**候选门店**（`markers` 里 store_type 为候选的那批）。
 *
 * 🔴 `merged_into IS NULL` 不能少：门店合并是软删（只写墓碑指针），
 *    被合并掉的那条若也列出来，一次合并在候选点位页就会凭空多一条。
 *
 * 🔴 字段只取这里用得到的：`markers` 有 30+ 列（含集团同步的 origin_* 与 sync_*），
 *    `SELECT *` 会把它们全带给前端，既有隐私面也有体积问题。
 */
function candidateStores(db, userId) {
  const ph = CANDIDATE_STORE_TYPES.map(() => '?').join(',')
  return db.prepare(
    `SELECT id, store_code, name, brand, store_type, city, district, address,
            latitude, longitude, area, rent, status, created_at, updated_at
       FROM markers
      WHERE user_id = ? AND store_type IN (${ph}) AND merged_into IS NULL
      ORDER BY updated_at DESC, id DESC`
  ).all(userId, ...CANDIDATE_STORE_TYPES)
}

/** 本人全部推进记录（带流水条数；用于列表的「N 条记录」角标） */
function allCandidates(db, userId) {
  return db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM candidate_notes n WHERE n.candidate_id = c.id) AS note_count
       FROM store_candidates c WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.id DESC`
  ).all(userId)
}

/**
 * 把「门店」与「推进记录」合成列表行（**纯读**：不建行、不改行）。
 *
 * 行结构（前端契约，改动要同步 CandidateView）：
 *   id         store_candidates.id，**可能为 null**（该门店还没有推进记录）
 *   markerId   markers.id，独立点位为 null
 *   origin     'store'（来自我的门店）| 'candidate'（333~375 的独立点位 / 手工新建）
 *   stage      叠加后的阶段（无记录时给「待评估」）
 *   stageStored 该阶段是库里存的（true）还是补的默认值（false）
 *
 * ⚠️ 面积/租金优先取门店台账（它是准的），台账没填才回落到候选点位当年手填的值。
 */
function buildRows(db, userId) {
  const stores = candidateStores(db, userId)
  const cands = allCandidates(db, userId)
  const { pairs, orphans } = linkAll(stores, cands, planarMeters)
  const byMarker = new Map(pairs.map((p) => [p.marker.id, p.candidate]))

  const rows = stores.map((m) => {
    const c = byMarker.get(m.id) || null
    const radius = c ? Number(c.radius) : NaN
    return {
      id: c ? c.id : null,
      markerId: m.id,
      origin: 'store',
      storeCode: str(m.store_code),
      storeType: str(m.store_type),
      name: str(m.name),
      brand: str(m.brand),
      city: str(m.city),
      district: str(m.district),
      address: str(m.address),
      latitude: m.latitude === null ? null : Number(m.latitude),
      longitude: m.longitude === null ? null : Number(m.longitude),
      area: m.area ?? (c ? c.area : null),
      rent: m.rent ?? (c ? c.rent : null),
      radius: Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_RADIUS,
      stage: c ? str(c.stage) : STAGES[0],
      stageStored: !!c,
      noteCount: c ? Number(c.note_count || 0) : 0,
      source: c ? str(c.source) : '',
      dropReason: c ? str(c.drop_reason) : '',
      created_at: c ? c.created_at : m.created_at,
      updated_at: c ? c.updated_at : m.updated_at
    }
  })

  for (const c of orphans) {
    const radius = Number(c.radius)
    rows.push({
      id: c.id,
      markerId: null,
      origin: 'candidate',
      storeCode: str(c.store_code),
      storeType: '',
      name: str(c.name),
      brand: str(c.brand),
      city: str(c.city),
      district: str(c.district),
      address: str(c.address),
      latitude: c.latitude === null ? null : Number(c.latitude),
      longitude: c.longitude === null ? null : Number(c.longitude),
      area: c.area ?? null,
      rent: c.rent ?? null,
      radius: Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_RADIUS,
      stage: str(c.stage),
      stageStored: true,
      noteCount: Number(c.note_count || 0),
      source: str(c.source),
      dropReason: str(c.drop_reason),
      created_at: c.created_at,
      updated_at: c.updated_at
    })
  }

  // 最近动过的在前。updated_at 是 SQLite 的 'YYYY-MM-DD HH:MM:SS'（UTC）⇒ 字符串比较即可；
  // 空值（老数据）落到底部，⛔ 不要当 0 参与比较（会跑到最前，看着像"刚更新过"）
  rows.sort((a, b) => {
    const x = String(a.updated_at || '')
    const y = String(b.updated_at || '')
    if (x !== y) return y.localeCompare(x)
    return Number(b.id || b.markerId || 0) - Number(a.id || a.markerId || 0)
  })

  return { rows, stores, cands, pairs, orphans }
}

/**
 * 列表 + 四档计数
 * GET /api/candidates?stage=待评估&keyword=五角场&city=上海
 *
 * 🔴 筛选在 **JS** 里做（不在 SQL）：列表是两个来源合成的，SQL 只能筛其中一个，
 *    会出现「筛选后列表 3 条、计数 5 条」这种自相矛盾。
 */
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = req.user.id
    const stage = str(req.query.stage)
    const keyword = str(req.query.keyword)
    const city = str(req.query.city)

    const { rows } = buildRows(db, uid)

    // 计数始终按**全量**算（不受 stage/keyword 影响）⇒ 顶部四个格子才不会因为筛选而变空
    const counts = {}
    for (const s of STAGES) counts[s] = 0
    for (const r of rows) {
      // 历史脏值（手改库/旧版本写进来的）不让它把界面搞崩：单独占一格，不进四档
      if (counts[r.stage] === undefined) counts[r.stage] = 0
      counts[r.stage] += 1
    }

    const kw = keyword.toLowerCase()
    const list = rows.filter((r) => {
      if (stage && STAGES.includes(stage) && r.stage !== stage) return false
      if (city && r.city !== city) return false
      if (kw && !`${r.name} ${r.address} ${r.brand}`.toLowerCase().includes(kw)) return false
      return true
    })

    res.json({
      list,
      counts,
      total: rows.length,
      stages: STAGES,
      // 前端用来区分「我的门店」与「独立点位」（空态提示、删除按钮的可用性都靠它）
      originCounts: {
        store: rows.filter((r) => r.origin === 'store').length,
        candidate: rows.filter((r) => r.origin === 'candidate').length
      }
    })
  } catch (e) {
    console.error('[Candidates] 列表失败:', e)
    res.status(500).json({ message: '获取候选点位失败' })
  }
})

/**
 * 为某条候选门店「确保」一条推进记录 POST /api/candidates/ensure  body: { markerId }
 *
 * 为什么需要它：376 起列表以 `markers` 驱动，**新加进「我的门店」的候选店还没有推进记录**
 *   （列表里 `id === null`）。用户第一次点「改为已勘踏 / 记一笔」时才建行 ——
 *   而不是在列表接口里偷偷建（`GET` 带写副作用会让缓存、预取、爬虫都变成写操作）。
 *
 * 🔴 幂等：已有记录 ⇒ 原样返回（`created:false`）；没有才建行。
 * 🔴 回填 `store_code` 时 **不动 `updated_at`**：补一个关联键不是「推进了一步」，
 *    不能让它把列表排序顶上去（同 `/report` 留痕的取舍，333 已定）。
 * ⛔ 不做反向同步：这里的 name/address 是从门店台账抄的一份**初始快照**，
 *    之后再改门店不会回写、改这里也不会回写门店 —— 两边各自独立，P2 再谈联动。
 */
router.post('/ensure', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = req.user.id
    const mid = Number(req.body?.markerId)
    if (!mid) return res.status(400).json({ message: '缺少 markerId' })

    // `merged_into IS NULL`：被合并掉的店是墓碑（软删），列表里本来就不显示；
    // 这里不挡就能给它建出一条永远看不见的候选点位行（脏数据）。
    const m = db.prepare('SELECT * FROM markers WHERE id = ? AND user_id = ? AND merged_into IS NULL').get(mid, uid)
    if (!m) return res.status(404).json({ message: '未找到该门店' })
    if (!CANDIDATE_STORE_TYPES.includes(str(m.store_type))) {
      return res.status(400).json({ message: '该门店不是候选门店（门店类型需为「重点候选」或「一般候选」）' })
    }

    const code = str(m.store_code)
    let c = code
      ? db.prepare('SELECT * FROM store_candidates WHERE user_id = ? AND store_code = ?').get(uid, code)
      : null
    if (!c) c = matchCandidate(m, allCandidates(db, uid), planarMeters)

    if (c) {
      if (!str(c.store_code) && code) {
        db.prepare('UPDATE store_candidates SET store_code = ? WHERE id = ?').run(code, c.id)
        db.saveNow()
        c = db.prepare('SELECT * FROM store_candidates WHERE id = ?').get(c.id)
      }
      return res.json({ success: true, candidate: c, notes: notesOf(db, c.id), created: false })
    }

    const lat = num(m.latitude)
    const lng = num(m.longitude)
    if (lat === null || lng === null) {
      return res.status(400).json({ message: '该门店没有有效坐标，无法建立候选点位' })
    }

    let newId = null
    db.beginTx()
    try {
      newId = db.prepare(
        `INSERT INTO store_candidates (user_id, store_code, name, brand, city, district, address,
                                       latitude, longitude, radius, area, rent, stage, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uid, code || null,
        str(m.name).slice(0, FIELD_MAX.name) || `门店 ${mid}`,
        str(m.brand).slice(0, FIELD_MAX.brand),
        str(m.city).slice(0, FIELD_MAX.city),
        str(m.district).slice(0, FIELD_MAX.district),
        str(m.address).slice(0, FIELD_MAX.address),
        lat, lng,
        DEFAULT_RADIUS, num(m.area), num(m.rent),
        STAGES[0], 'store-sync'
      ).lastInsertRowid

      db.prepare('INSERT INTO candidate_notes (candidate_id, user_id, from_stage, to_stage, note) VALUES (?, ?, ?, ?, ?)')
        .run(newId, uid, '', STAGES[0], code
          ? `从「我的门店」关联（门店编码 ${code}）`
          : '从「我的门店」关联（该门店没有编码，按名称与坐标匹配）')
      db.commitTx()
    } catch (e) {
      try { db.rollbackTx() } catch (e2) { /* 忽略 */ }
      throw e
    }

    res.json({
      success: true,
      candidate: db.prepare('SELECT * FROM store_candidates WHERE id = ?').get(newId),
      notes: notesOf(db, newId),
      created: true
    })
  } catch (e) {
    console.error('[Candidates] 建立推进记录失败:', e)
    res.status(500).json({ message: '建立推进记录失败' })
  }
})

/** 详情 + 流水 GET /api/candidates/:id */
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = req.user.id
    const c = ownCandidate(db, req.params.id, uid)
    if (!c) return res.status(404).json({ message: '未找到该候选点位' })

    // 顺带把对应的候选门店带出来（详情里要显示「门店类型 / 门店编码」，
    // 也用来判断这行到底能不能删 —— 前端不用再猜）
    let marker = null
    if (str(c.store_code)) {
      marker = db.prepare(
        `SELECT id, store_code, name, store_type, city, district, address, latitude, longitude, area, rent
           FROM markers WHERE user_id = ? AND store_code = ? AND merged_into IS NULL`
      ).get(uid, str(c.store_code)) || null
    }
    if (!marker) {
      const stores = candidateStores(db, uid)
      const hit = matchCandidate(c, stores, planarMeters)
      if (hit) marker = hit
    }

    // 🔴 再返回一份**与列表同构**的行（`row`）：
    //    列表的 name/address/坐标/面积/租金取自门店台账，而 `store_candidates` 里存的是
    //    当年手工录的旧值 —— 两个值现网确实不一样（例：markers 地址「浦锦路309弄6号」、
    //    候选表地址「江月路」）。只返回 candidate 会让「列表显示 A 地址、点开变 B 地址」，
    //    用户第一反应是数据显示错了。所以展示层统一用 `row`，`candidate` 保持原样
    //    给报告组件用（它读的是下划线字段 + 完整 row）。
    const row = buildRows(db, uid).rows.find((r) => r.id === c.id) || null

    res.json({ candidate: c, notes: notesOf(db, c.id), marker, row })
  } catch (e) {
    console.error('[Candidates] 详情失败:', e)
    res.status(500).json({ message: '获取候选点位失败' })
  }
})

/** 新建 POST /api/candidates */
router.post('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const b = req.body || {}
    const name = str(b.name)
    if (!name) return res.status(400).json({ message: '请填写点位名称' })
    if (name.length > FIELD_MAX.name) return res.status(400).json({ message: `点位名称不能超过 ${FIELD_MAX.name} 字` })

    const lat = num(b.latitude)
    const lng = num(b.longitude)
    if (lat === null || lng === null) return res.status(400).json({ message: '请提供有效的经纬度' })
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return res.status(400).json({ message: '经纬度超出有效范围' })
    if (lat === 0 && lng === 0) return res.status(400).json({ message: '经纬度不能为 0,0（多为漏填）' })

    const stage = STAGES.includes(str(b.stage)) ? str(b.stage) : STAGES[0]

    const info = db.prepare(
      `INSERT INTO store_candidates (user_id, name, brand, city, district, address, latitude, longitude, radius, area, rent, stage, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    // 两次写（建点位 + 建档流水）⇒ 包事务，一次落盘
    let newId = null
    db.beginTx()
    try {
      newId = info.run(
        req.user.id, name,
        str(b.brand).slice(0, FIELD_MAX.brand),
        str(b.city).slice(0, FIELD_MAX.city),
        str(b.district).slice(0, FIELD_MAX.district),
        str(b.address).slice(0, FIELD_MAX.address),
        lat, lng,
        clampInt(b.radius, RADIUS_MIN, RADIUS_MAX, 1000),
        num(b.area), num(b.rent),
        stage,
        str(b.source).slice(0, 20)
      ).lastInsertRowid

      // 建档就留一条流水：以后回看才知道"这个点位是谁什么时候建的、从哪来的"
      db.prepare('INSERT INTO candidate_notes (candidate_id, user_id, from_stage, to_stage, note) VALUES (?, ?, ?, ?, ?)')
        .run(newId, req.user.id, '', stage, `新建点位（来源：${str(b.source) || '手动'}）`)
      db.commitTx()
    } catch (e) {
      try { db.rollbackTx() } catch (e2) { /* 忽略 */ }
      throw e
    }
    const c = db.prepare('SELECT * FROM store_candidates WHERE id = ?').get(newId)

    res.json({ success: true, candidate: c })
  } catch (e) {
    console.error('[Candidates] 新建失败:', e)
    res.status(500).json({ message: '新建候选点位失败' })
  }
})

/** 改基础信息 PATCH /api/candidates/:id（⛔ 不含 stage：阶段只能走 /stage 入口，保证必留流水） */
router.patch('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const c = ownCandidate(db, req.params.id, req.user.id)
    if (!c) return res.status(404).json({ message: '未找到该候选点位' })
    const b = req.body || {}

    const sets = []
    const params = []
    const put = (col, val) => { sets.push(`${col} = ?`); params.push(val) }

    if (b.name !== undefined) {
      const name = str(b.name)
      if (!name) return res.status(400).json({ message: '点位名称不能为空' })
      if (name.length > FIELD_MAX.name) return res.status(400).json({ message: `点位名称不能超过 ${FIELD_MAX.name} 字` })
      put('name', name)
    }
    if (b.brand !== undefined) put('brand', str(b.brand).slice(0, FIELD_MAX.brand))
    if (b.city !== undefined) put('city', str(b.city).slice(0, FIELD_MAX.city))
    if (b.district !== undefined) put('district', str(b.district).slice(0, FIELD_MAX.district))
    if (b.address !== undefined) put('address', str(b.address).slice(0, FIELD_MAX.address))
    if (b.area !== undefined) put('area', num(b.area))
    if (b.rent !== undefined) put('rent', num(b.rent))
    if (b.radius !== undefined) put('radius', clampInt(b.radius, RADIUS_MIN, RADIUS_MAX, c.radius))
    if (b.latitude !== undefined || b.longitude !== undefined) {
      const lat = b.latitude !== undefined ? num(b.latitude) : c.latitude
      const lng = b.longitude !== undefined ? num(b.longitude) : c.longitude
      if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ message: '经纬度无效' })
      }
      put('latitude', lat); put('longitude', lng)
    }
    // stage 显式拒绝：⛔ 让调用方走 /stage，否则会出现"改了阶段却没流水"
    if (b.stage !== undefined) return res.status(400).json({ message: '阶段变更请走 PATCH /:id/stage（需记录流水）' })

    if (!sets.length) return res.status(400).json({ message: '没有要更新的字段' })
    params.push(c.id, req.user.id)
    // updated_at 必须显式刷新：sql.js 不会自动维护 ON UPDATE
    // 🔴 用 CURRENT_TIMESTAMP（UTC）而非 datetime('now','localtime')：
    //    created_at 走 SQLite 默认 CURRENT_TIMESTAMP（UTC），同一张表混两种时区
    //    会让「最近更新」比「创建时间」凭空多 8 小时。项目口径＝存 UTC、前端补 Z 转本地
    //    （见 frontend/src/utils/datetime.js 与 UsersView 的 formatDateTime）
    db.prepare(`UPDATE store_candidates SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .run(...params)
    db.saveNow()
    res.json({ success: true, candidate: db.prepare('SELECT * FROM store_candidates WHERE id = ?').get(c.id) })
  } catch (e) {
    console.error('[Candidates] 更新失败:', e)
    res.status(500).json({ message: '更新候选点位失败' })
  }
})

/**
 * 阶段流转 PATCH /api/candidates/:id/stage  body: { stage, note?, drop_reason? }
 * 🔴 必须同时写一条流水（两位写点 ⇒ 包事务，见落盘铁律）
 */
router.patch('/:id/stage', authenticate, (req, res) => {
  try {
    const db = getDb()
    const c = ownCandidate(db, req.params.id, req.user.id)
    if (!c) return res.status(404).json({ message: '未找到该候选点位' })

    const to = str(req.body?.stage)
    if (!STAGES.includes(to)) {
      return res.status(400).json({ message: `阶段只能是：${STAGES.join(' / ')}` })
    }
    if (to === c.stage) return res.status(400).json({ message: '阶段未变化' })

    const note = str(req.body?.note).slice(0, FIELD_MAX.note)
    // 放弃必须给原因：⛔ 不写原因的"放弃"半年后没人记得为什么
    const dropReason = str(req.body?.drop_reason).slice(0, FIELD_MAX.drop_reason)
    if (to === '放弃' && !dropReason && !note) {
      return res.status(400).json({ message: '标记为"放弃"时请填写原因' })
    }

    db.beginTx()
    try {
      db.prepare(
        `UPDATE store_candidates SET stage = ?, drop_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      ).run(to, to === '放弃' ? (dropReason || note) : '', c.id, req.user.id)

      db.prepare(
        'INSERT INTO candidate_notes (candidate_id, user_id, from_stage, to_stage, note) VALUES (?, ?, ?, ?, ?)'
      ).run(c.id, req.user.id, c.stage, to, note || (to === '放弃' ? `放弃：${dropReason}` : `改为「${to}」`))
      db.commitTx()
    } catch (e) {
      try { db.rollbackTx() } catch (e2) { /* 忽略 */ }
      throw e
    }

    res.json({
      success: true,
      candidate: db.prepare('SELECT * FROM store_candidates WHERE id = ?').get(c.id),
      notes: notesOf(db, c.id)
    })
  } catch (e) {
    console.error('[Candidates] 阶段流转失败:', e)
    res.status(500).json({ message: '更新阶段失败' })
  }
})

/** 追加备注 POST /api/candidates/:id/notes  body: { note } —— 只追加，⛔ 不提供编辑/删除 */
router.post('/:id/notes', authenticate, (req, res) => {
  try {
    const db = getDb()
    const c = ownCandidate(db, req.params.id, req.user.id)
    if (!c) return res.status(404).json({ message: '未找到该候选点位' })
    const note = str(req.body?.note)
    if (!note) return res.status(400).json({ message: '备注不能为空' })
    if (note.length > FIELD_MAX.note) return res.status(400).json({ message: `备注不能超过 ${FIELD_MAX.note} 字` })

    db.prepare('INSERT INTO candidate_notes (candidate_id, user_id, from_stage, to_stage, note) VALUES (?, ?, ?, ?, ?)')
      .run(c.id, req.user.id, '', '', note)
    // 备注也算"动过"，让列表排序跟得上
    db.prepare(`UPDATE store_candidates SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(c.id)
    db.saveNow()
    res.json({ success: true, notes: notesOf(db, c.id) })
  } catch (e) {
    console.error('[Candidates] 加备注失败:', e)
    res.status(500).json({ message: '添加备注失败' })
  }
})

/**
 * 删除 DELETE /api/candidates/:id
 * 真删（不软删）：候选点位不是台账，没有"保留痕迹"的业务要求；
 * 若将来要审计，改软删即可，但**必须同时**改 /list 的过滤条件。
 * 两次写（流水 + 主表）⇒ 包事务。
 *
 * 🔴🔴 376：**关联到「我的门店」的行一律不可删**（400）。
 *   这一页现在是门店的**视图**：删掉推进记录 ≠ 删掉门店，刷新后门店仍在（阶段回到「待评估」），
 *   用户会以为"删不掉"，反复点。真想让它从这里消失 ⇒ 去「我的门店」把门店类型改回「已开业」。
 *   判据必须与列表的关联判据**同源**（都走 `matchCandidate`），否则会出现
 *   「列表里显示它属于某某门店、点删除却说它不属于任何门店」这种自相矛盾。
 */
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = req.user.id
    const c = ownCandidate(db, req.params.id, uid)
    if (!c) return res.status(404).json({ message: '未找到该候选点位' })

    const linkedStore = matchCandidate(c, candidateStores(db, uid), planarMeters)
    if (linkedStore) {
      return res.status(400).json({
        message: `「${str(linkedStore.name) || '该门店'}」来自「我的门店」，不能在这里删除。`
          + '如果不想让它出现在候选点位里，请到「我的门店」把门店类型改为「已开业」。'
      })
    }

    db.beginTx()
    try {
      db.prepare('DELETE FROM candidate_notes WHERE candidate_id = ?').run(c.id)
      db.prepare('DELETE FROM store_candidates WHERE id = ? AND user_id = ?').run(c.id, uid)
      db.commitTx()
    } catch (e) {
      try { db.rollbackTx() } catch (e2) { /* 忽略 */ }
      throw e
    }
    res.json({ success: true, message: '删除成功' })
  } catch (e) {
    console.error('[Candidates] 删除失败:', e)
    res.status(500).json({ message: '删除候选点位失败' })
  }
})

/**
 * 报告导出留痕 POST /api/candidates/:id/report  body: { withAi: boolean }
 *
 * 为什么留痕：立项报告里含**商圈人口与竞争画像**（联通口径数据），导出即离开系统。
 * 记一条流水，事后能回答「谁在什么时候拿这个点位的数据出过报告、有没有带 AI 建议」。
 *
 * 🔴 只 INSERT 流水，⛔ 不改 stage / ⛔ 不动 updated_at —— 导出报告不是"推进了一步"，
 *    不能让它把列表排序顶上去，也不能让"最近更新"变成"最后导出的时间"。
 */
router.post('/:id/report', authenticate, (req, res) => {
  try {
    const db = getDb()
    const c = ownCandidate(db, req.params.id, req.user.id)
    if (!c) return res.status(404).json({ message: '未找到该候选点位' })
    const withAi = !!req.body?.withAi
    db.prepare('INSERT INTO candidate_notes (candidate_id, user_id, from_stage, to_stage, note) VALUES (?, ?, ?, ?, ?)')
      .run(c.id, req.user.id, '', '', `导出立项报告（${withAi ? '含 AI 建议' : '不含 AI 建议'}）`)
    db.saveNow()
    res.json({ success: true })
  } catch (e) {
    console.error('[Candidates] 报告留痕失败:', e)
    res.status(500).json({ message: '记录报告导出失败' })
  }
})

export default router
export { STAGES }
