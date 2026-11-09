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
 * 🔴 可见性：一律 `WHERE user_id = ?` —— 只本人可见，`admin` 也**不放大**
 *    （与 `/api/markers` 同口径：体检、点位都是"我这批店"的自我检查，混进别人的会误判）。
 *    ⛔ 不要顺手接 visibleScope / readableUserIds。
 *
 * ⚠️ STAGES 这四个字符串是**落库值**：改动必须同步
 *    `frontend/src/utils/candidateStage.js`（前端唯一来源）与 database.js 的建表默认值，
 *    守卫 `tests/candidateWorkflow.test.js` 三处对比，改一处就红。
 *
 * ⚠️ 幂等零迁移：两张表由 models/database.js 的 CREATE TABLE IF NOT EXISTS 在启动时建，
 *    生产 `pm2 restart` 即生效，无需手工脚本。
 */
import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

/** 推进四档（业主 2026-11-09 定；顺序＝推进正序，⛔ 不要重排：前端统计条按此顺序渲染） */
const STAGES = ['待评估', '已勘踏', '立项', '放弃']

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
 * 列表 + 四档计数
 * GET /api/candidates?stage=待评估&keyword=五角场&city=上海
 */
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = req.user.id
    const stage = str(req.query.stage)
    const keyword = str(req.query.keyword)
    const city = str(req.query.city)

    // 计数始终按**全量**算（不受 stage/keyword 影响）⇒ 顶部四个格子才不会因为筛选而变空
    const countRows = db.prepare(
      'SELECT stage, COUNT(*) AS c FROM store_candidates WHERE user_id = ? GROUP BY stage'
    ).all(uid)
    const counts = {}
    for (const s of STAGES) counts[s] = 0
    let total = 0
    for (const r of countRows) {
      // 历史脏值（手改库/旧版本写进来的）不让它把 interface 搞崩：归到"待评估"之外单独计数
      if (counts[r.stage] === undefined) counts[r.stage] = 0
      counts[r.stage] = r.c
      total += r.c
    }

    let sql = 'SELECT * FROM store_candidates WHERE user_id = ?'
    const params = [uid]
    if (stage && STAGES.includes(stage)) { sql += ' AND stage = ?'; params.push(stage) }
    if (city) { sql += ' AND city = ?'; params.push(city) }
    if (keyword) {
      // 名称/地址/品牌任一命中；⚠️ LIKE 通配符要转义，否则用户搜 "%" 会全表命中
      const kw = `%${keyword.replace(/[%_\\]/g, (m) => '\\' + m)}%`
      sql += ` AND (name LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\')`
      params.push(kw, kw, kw)
    }
    sql += ' ORDER BY updated_at DESC, id DESC'

    const list = db.prepare(sql).all(...params)
    res.json({ list, counts, total, stages: STAGES })
  } catch (e) {
    console.error('[Candidates] 列表失败:', e)
    res.status(500).json({ message: '获取候选点位失败' })
  }
})

/** 详情 + 流水 GET /api/candidates/:id */
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const c = ownCandidate(db, req.params.id, req.user.id)
    if (!c) return res.status(404).json({ message: '未找到该候选点位' })
    res.json({ candidate: c, notes: notesOf(db, c.id) })
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
    db.prepare(`UPDATE store_candidates SET ${sets.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ? AND user_id = ?`)
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
        `UPDATE store_candidates SET stage = ?, drop_reason = ?, updated_at = datetime('now','localtime')
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
    db.prepare(`UPDATE store_candidates SET updated_at = datetime('now','localtime') WHERE id = ?`).run(c.id)
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
 */
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const c = ownCandidate(db, req.params.id, req.user.id)
    if (!c) return res.status(404).json({ message: '未找到该候选点位' })

    db.beginTx()
    try {
      db.prepare('DELETE FROM candidate_notes WHERE candidate_id = ?').run(c.id)
      db.prepare('DELETE FROM store_candidates WHERE id = ? AND user_id = ?').run(c.id, req.user.id)
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

export default router
export { STAGES }
