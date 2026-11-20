/**
 * 立项报告分享链接（v1.13.392）
 * ---------------------------------------------------------------------------
 * 场景（业主 2026-11-20 定的两句）：
 *   ①「生成分析报告」要在初步分析之后判断值不值得往下走，然后**共享或邮件发给同事及领导**；
 *   ② 报告要「尽可能多用联通人口的丰富标签」。
 *   ⇒ ②已由 391 兑现（1001 三套口径全上纸）；本文件补 ① 的交付链路。
 *
 * 🔴🔴 五条设计铁律（改之前必读）
 *   ① **存快照，不存引用**。`snapshot_json` 是发出去那一刻纸面上的完整内容。
 *      同事看到的东西必须与作者发出时逐字一致，⛔ 不能被后续编辑悄悄改掉；
 *      而且匿名访客没有取数权限（商圈 + 联通人口都是受权/付费数据），
 *      现场重建既没权限也负担不起 —— 原报告删了、配额烧完了也不该让链接变空白。
 *   ② **每个点位最多一条有效分享**。再次分享 = 覆盖同一条并顺延有效期，
 *      而不是每点一次多一条链接（业主选的「快照为主，可切最新」正是这个语义：
 *      要更新就由作者重新分享覆盖同一链接，⛔ 匿名页不现场重算）。
 *   ③ **撤销是软删**（`revoked_at`），⛔ 不 DELETE 行 —— 事后要能回答「谁在什么时候撤的」。
 *   ④ **公开读端点不挂 authenticate**（那正是"分享"的意义），但必须自己判
 *      过期 / 撤销，且 **浏览计数要节流**：本库 166MB，`saveNow()` 是整库落盘，
 *      每访问一次就落一次盘等于拿磁盘换一个数字（见 BROWSE_THROTTLE_MINUTES）。
 *   ⑤ **邮件正文不带账号信息**（配额余额、单价、档位一律不出现）：
 *      收件人是外部同事/领导，看到"N 次配额"只会困惑。发信是响应之后的副作用，
 *      SMTP 最坏 30s 超时，⛔ 不许 await 在响应路径上。
 *
 * ⚠️ 幂等零迁移：report_shares 表与索引由 models/database.js 的
 *    CREATE TABLE/INDEX IF NOT EXISTS 在启动时自动建，生产重启即生效。
 */
import express from 'express'
import crypto from 'crypto'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { isMailEnabled, sendReportShareMail } from '../utils/mailer.js'

const router = express.Router()

/** 有效期（天）——业主定 30 天；允许 1~90，⛔ 不收 0/负数/超大值 */
const DEFAULT_DAYS = 30
const MAX_DAYS = 90

/** 快照体积上限。报告 model 实测 ~6KB；给足余量但不允许把 50MB 塞进库 */
const MAX_SNAPSHOT_BYTES = 512 * 1024
/** 地图 dataURL 上限（JPEG q=0.82 实测 100~300KB） */
const MAX_MAP_BYTES = 2 * 1024 * 1024

/** 浏览计数节流窗口：同一 token 5 分钟内重复访问不重复落盘 */
const BROWSE_THROTTLE_MINUTES = 5

/** 一次最多发给多少个收件人（业主口径：同事及领导，不是群发工具） */
const MAX_RECIPIENTS = 10

/** 邮箱粗校验：⛔ 不追求 RFC 完备，只挡明显不是邮箱的串 */
const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[^\s@,;:<>()[\]\\]+\.[A-Za-z]{2,}$/

function str(v) {
  return String(v ?? '').trim()
}

function byteLen(s) {
  return Buffer.byteLength(String(s || ''), 'utf8')
}

/** 生成不可推导的随机 token（24 字节 ⇒ 48 hex），与 purchase 的 HMAC 方案不同：可撤销优先 */
function newToken() {
  return crypto.randomBytes(24).toString('hex')
}

/** 归一化天数：默认 30，夹在 1~90，非数字回默认 */
function normDays(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.max(1, Math.round(n)))
}

/** 该 token 对应的分享（含已撤销/已过期行，调用方自己判状态） */
function byToken(db, token) {
  const t = str(token)
  if (!/^[a-f0-9]{48}$/.test(t)) return null   // 形状不对直接不查库
  return db.prepare('SELECT * FROM report_shares WHERE token = ?').get(t) || null
}

/**
 * SQLite 的 `CURRENT_TIMESTAMP` / `datetime('now')` 都是 **UTC** 的
 * `YYYY-MM-DD HH:MM:SS`（不带 Z）—— 直接 `new Date(s)` 会被当成本地时间，
 * 在 UTC+8 上把过期时刻整体推迟 8 小时（链接多活 8 小时 / 少活 8 小时）。
 * 🔴 统一走这里换算，⛔ 不要在别处再写一次 `new Date(row.expires_at)`。
 */
function utcMs(s) {
  const t = String(s || '').trim()
  if (!t) return 0
  const iso = t.includes('T') ? t : t.replace(' ', 'T')
  const ms = Date.parse(iso.endsWith('Z') ? iso : iso + 'Z')
  return Number.isFinite(ms) ? ms : 0
}

/**
 * 取某条分享的状态。
 * ⚠️ 过期判断在 **JS 侧** 做（不查库）：公开读端点本来就拿着整行，
 *    再发一条 SQL 只会多一次 sql.js 开销，且 `datetime('now')` 与行内时间
 *    在不同时区配置下容易写出「库里说活、代码说死」的分歧。
 * @returns {'ok'|'revoked'|'expired'}
 */
function shareState(row) {
  if (row.revoked_at) return 'revoked'
  const ms = utcMs(row.expires_at)
  if (!ms) return 'expired'
  return ms > Date.now() ? 'ok' : 'expired'
}

/** 状态 ⇒ 公开页要显示的原因码（前端据此出文案，⛔ 不要在这里拼中文长句） */
const STATE_CODE = { revoked: 'revoked', expired: 'expired' }

/**
 * 生成（或覆盖）分享链接
 * body: { candidateId?, title?, snapshot, mapImg?, aiText?, days? }
 *
 * 🔴 覆盖规则见文件头 ②：同一点位已有有效分享 ⇒ UPDATE 同一条（token 不变，
 *    之前发出去的链接自动指向新内容），否则 INSERT。
 */
router.post('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = Number(req.user?.id)
    if (!uid) return res.status(401).json({ message: '登录已失效，请重新登录' })

    const candidateId = Number(req.body?.candidateId) || null
    const title = str(req.body?.title).slice(0, 120)
    const aiText = String(req.body?.aiText ?? '').slice(0, 20000)
    const days = normDays(req.body?.days)

    // ── 快照：必须是对象（⛔ 不收字符串，否则没法判「是不是一份报告」）──
    const snap = req.body?.snapshot
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) {
      return res.status(400).json({ message: '报告快照缺失或格式不正确' })
    }
    let snapshotJson
    try {
      snapshotJson = JSON.stringify(snap)
    } catch (e) {
      return res.status(400).json({ message: '报告快照无法序列化' })
    }
    if (byteLen(snapshotJson) > MAX_SNAPSHOT_BYTES) {
      return res.status(413).json({ message: '报告内容过大，无法生成分享链接' })
    }

    // ── 地图：可空；只接受 data:image/* 的 dataURL ──
    const mapImg = String(req.body?.mapImg ?? '')
    if (mapImg) {
      if (!mapImg.startsWith('data:image/')) {
        return res.status(400).json({ message: '位置示意图格式不正确' })
      }
      if (byteLen(mapImg) > MAX_MAP_BYTES) {
        return res.status(413).json({ message: '位置示意图过大，请重试（通常为底图服务异常）' })
      }
    }

    // ── 点位归属：只能分享自己的候选点位（⛔ 允许把别人的点位挂到自己名下）──
    if (candidateId) {
      const c = db.prepare('SELECT id FROM store_candidates WHERE id = ? AND user_id = ?').get(candidateId, uid)
      if (!c) return res.status(404).json({ message: '未找到该候选点位' })
    }

    // 发起人显示名以**库内**为准（JWT 里的 username 是签发时快照）
    const me = db.prepare('SELECT username, email FROM users WHERE id = ?').get(uid)
    if (!me) return res.status(404).json({ message: '账号不存在' })
    const authorName = str(me.username) || str(me.email) || '—'

    // ── 已有有效分享？同点位 ⇒ 覆盖；不同点位/无点位 ⇒ 新建 ──
    const existing = candidateId
      ? db.prepare(`
          SELECT * FROM report_shares
          WHERE user_id = ? AND candidate_id = ? AND revoked_at IS NULL
            AND expires_at > datetime('now')
          ORDER BY updated_at DESC LIMIT 1
        `).get(uid, candidateId)
      : null

    let row
    if (existing) {
      db.prepare(`
        UPDATE report_shares
           SET title = ?, snapshot_json = ?, map_img = ?, ai_text = ?, author_name = ?,
               expires_at = datetime('now', ?), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `).run(
        title || existing.title, snapshotJson, mapImg || null, aiText, authorName,
        `+${days} days`, existing.id
      )
      row = db.prepare('SELECT * FROM report_shares WHERE id = ?').get(existing.id)
    } else {
      const token = newToken()
      const info = db.prepare(`
        INSERT INTO report_shares
          (token, user_id, candidate_id, title, snapshot_json, map_img, ai_text, author_name, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
      `).run(token, uid, candidateId, title, snapshotJson, mapImg || null, aiText, authorName, `+${days} days`)
      row = db.prepare('SELECT * FROM report_shares WHERE id = ?').get(info.lastInsertRowid)
    }

    db.saveNow()

    res.json({
      share: toSummary(row, req),
      replaced: !!existing,
      message: existing ? '链接内容已更新（原链接继续有效）' : '分享链接已生成'
    })
  } catch (error) {
    console.error('[ReportShare] 生成分享链接失败:', error)
    res.status(500).json({ message: '生成分享链接失败，请稍后重试' })
  }
})

/**
 * 我在这条候选点位上的分享（不含快照正文，⛔ 别把 dataURL 拉进列表）
 * GET /api/report-shares?candidateId=123
 */
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = Number(req.user?.id)
    const candidateId = Number(req.query?.candidateId) || null

    const rows = candidateId
      ? db.prepare(`
          SELECT id, token, candidate_id, title, author_name, expires_at, revoked_at,
                 view_count, last_viewed_at, emailed_at, created_at, updated_at,
                 (expires_at > datetime('now')) AS live
            FROM report_shares
           WHERE user_id = ? AND candidate_id = ?
           ORDER BY updated_at DESC LIMIT 20
        `).all(uid, candidateId)
      : db.prepare(`
          SELECT id, token, candidate_id, title, author_name, expires_at, revoked_at,
                 view_count, last_viewed_at, emailed_at, created_at, updated_at,
                 (expires_at > datetime('now')) AS live
            FROM report_shares
           WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
           ORDER BY updated_at DESC LIMIT 20
        `).all(uid)

    res.json({ shares: rows.map((r) => toSummary(r, req)) })
  } catch (error) {
    console.error('[ReportShare] 读取分享列表失败:', error)
    res.status(500).json({ message: '读取分享记录失败' })
  }
})

/**
 * 撤销（软删）
 * DELETE /api/report-shares/:id
 *
 * ⚠️ 只允许撤自己的；已经撤销的再撤一次直接返回成功（幂等）。
 */
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = Number(req.user?.id)
    const id = Number(req.params.id)
    if (!id) return res.status(400).json({ message: '参数不正确' })

    const row = db.prepare('SELECT * FROM report_shares WHERE id = ? AND user_id = ?').get(id, uid)
    if (!row) return res.status(404).json({ message: '分享记录不存在' })

    if (!row.revoked_at) {
      db.prepare(`UPDATE report_shares SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
      db.saveNow()
    }
    res.json({ success: true, message: '已撤销，此链接立即失效' })
  } catch (error) {
    console.error('[ReportShare] 撤销分享失败:', error)
    res.status(500).json({ message: '撤销失败，请稍后重试' })
  }
})

/**
 * 邮件发送分享链接（需登录；只能发自己的分享）
 * POST /api/report-shares/:id/email  body: { to: 'a@x.com, b@y.com' | string[] , note? }
 *
 * 🔴 三件事必须同时成立（与 routes/feedbacks.js 同源）：
 *   ① 响应先发出去，发信放在其后 ⇒ SMTP 最坏 30s 不让用户干等；
 *   ② 发信失败绝不改写「链接已生成」这个既成事实（只记日志 + emailed_at 不更新）；
 *   ③ 正文不含任何账号/配额/价格信息（见文件头 ⑤）。
 */
router.post('/:id/email', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = Number(req.user?.id)
    const id = Number(req.params.id)
    if (!id) return res.status(400).json({ message: '参数不正确' })

    const row = db.prepare('SELECT * FROM report_shares WHERE id = ? AND user_id = ?').get(id, uid)
    if (!row) return res.status(404).json({ message: '分享记录不存在' })

    const state = shareState(row)
    if (state !== 'ok') {
      return res.status(409).json({ message: state === 'revoked' ? '该链接已撤销，请重新生成' : '该链接已过期，请重新生成' })
    }

    // 收件人：数组或逗号/分号分隔的字符串；去重、去空、挡明显非法串
    const raw = req.body?.to
    const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;，；\s]+/))
      .map((s) => str(s))
      .filter(Boolean)
    const uniq = [...new Set(list.map((s) => s.toLowerCase()))]
    if (uniq.length === 0) return res.status(400).json({ message: '请填写收件人邮箱' })
    if (uniq.length > MAX_RECIPIENTS) {
      return res.status(400).json({ message: `一次最多发送给 ${MAX_RECIPIENTS} 位收件人` })
    }
    const bad = uniq.filter((e) => !EMAIL_RE.test(e))
    if (bad.length) return res.status(400).json({ message: `邮箱格式不正确：${bad.slice(0, 3).join('、')}` })

    if (!isMailEnabled()) {
      return res.status(503).json({ message: '邮件服务未配置，请改用「复制链接」发送' })
    }

    const url = shareUrl(req, row.token)
    const note = String(req.body?.note ?? '').slice(0, 500)

    res.json({
      success: true,
      sentTo: uniq,
      message: `正在发送给 ${uniq.length} 位收件人，请稍候在对方邮箱查收`
    })

    // ---- 以下是响应之后的副作用（见 ①②）----
    sendReportShareMail({
      to: uniq.join(','),
      reportTitle: row.title || '选址立项报告',
      link: url,
      expiresAt: row.expires_at,
      authorName: row.author_name,
      note
    }).then(() => {
      try {
        const d = getDb()
        d.prepare('UPDATE report_shares SET emailed_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
        d.saveNow()
      } catch (e) {
        console.error('[ReportShare] 记录发信时间失败:', e?.message || e)
      }
    }).catch((e) => {
      console.error('[ReportShare] 分享邮件发送失败:', e?.message || e)
    })
  } catch (error) {
    console.error('[ReportShare] 发送分享邮件失败:', error)
    res.status(500).json({ message: '发送失败，请稍后重试' })
  }
})

/**
 * 公开读取（免登录）　GET /api/report-shares/public/:token
 *
 * 🔴 这里**没有 authenticate** —— 这正是"分享"的意义。安全边界只有三条：
 *    token 48 位随机不可猜、30 天有效期、作者可随时撤销。
 * ⚠️ 返回体只含**纸面上已有的内容**，⛔ 不带 user_id / candidate_id / 配额 / 账号信息：
 *    拿到链接的人不该知道这是谁买的第几次配额。
 */
router.get('/public/:token', (req, res) => {
  try {
    const db = getDb()
    const row = byToken(db, req.params.token)
    if (!row) return res.status(404).json({ message: '链接不存在或已失效' })

    const state = shareState(row)
    if (state !== 'ok') {
      return res.status(410).json({
        code: STATE_CODE[state],
        message: state === 'revoked' ? '该分享已被发起人撤销' : '该分享已过期'
      })
    }

    let snapshot = null
    try { snapshot = JSON.parse(row.snapshot_json) } catch (e) { snapshot = null }
    if (!snapshot) return res.status(500).json({ message: '分享内容已损坏，请联系发起人重新分享' })

    // 浏览计数节流（见文件头 ④）：5 分钟内只记一次，避免每次访问整库落盘
    const lastViewMs = utcMs(row.last_viewed_at)
    const needTouch = !lastViewMs || (Date.now() - lastViewMs > BROWSE_THROTTLE_MINUTES * 60 * 1000)
    if (needTouch) {
      try {
        db.prepare('UPDATE report_shares SET view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id)
        db.saveNow()
      } catch (e) {
        // 计数失败不影响正文
        console.error('[ReportShare] 浏览计数失败:', e?.message || e)
      }
    }

    // 源点位在本快照之后是否被改过（只做提示，⛔ 不改内容 —— 见文件头 ②）
    let sourceUpdatedAt = null
    let stale = false
    if (row.candidate_id) {
      const c = db.prepare('SELECT updated_at FROM store_candidates WHERE id = ?').get(row.candidate_id)
      if (c?.updated_at) {
        sourceUpdatedAt = c.updated_at
        stale = String(c.updated_at) > String(row.updated_at)
      }
    }

    const live = db.prepare(`SELECT (expires_at > datetime('now')) AS live FROM report_shares WHERE id = ?`).get(row.id)

    res.json({
      share: {
        title: row.title || '',
        authorName: row.author_name || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
        expiresInDays: Math.max(0, Math.ceil((utcMs(row.expires_at) - Date.now()) / 86400000)),
        viewCount: Number(row.view_count) || 0,
        emailedAt: row.emailed_at || null,
        stale,
        sourceUpdatedAt
      },
      snapshot,
      mapImg: row.map_img || '',
      aiText: row.ai_text || ''
    })
  } catch (error) {
    console.error('[ReportShare] 读取分享失败:', error)
    res.status(500).json({ message: '读取分享内容失败' })
  }
})

/** 分享链接：`/s/:token` —— 与前端路由一致，⛔ 不要改成 query 形式（邮件里要短、要能在微信里直接点开） */
function shareUrl(req, token) {
  const proto = req.get('x-forwarded-proto') || req.protocol
  const host = req.get('host')
  return `${proto}://${host}/s/${token}`
}

/** 行 ⇒ 对外摘要（⛔ 永不带 snapshot_json / map_img） */
function toSummary(row, req) {
  return {
    id: row.id,
    token: row.token,
    url: shareUrl(req, row.token),
    candidateId: row.candidate_id || null,
    title: row.title || '',
    authorName: row.author_name || '',
    state: shareState(row),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    viewCount: Number(row.view_count) || 0,
    lastViewedAt: row.last_viewed_at || null,
    emailedAt: row.emailed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export default router
export { shareUrl, newToken, MAX_RECIPIENTS, DEFAULT_DAYS, MAX_DAYS }
