/**
 * 场景引导完成率埋点（v1.13.264）
 * ---------------------------------------------------------------------------
 * 目的：两个场景（网点规划 / 单店评估）上线后，**不知道客户走到第几步就放弃了**。
 *   本接口只回答一个问题：**每个场景的第 i 步，有多少人真的做完了**。
 *
 * 事件只有 4 种（⛔ 不要扩成通用埋点平台）：
 *   · guide_open   打开引导面板（入口有没有被看见）
 *   · scene_start  选了某个场景（分流：谁对哪种活儿感兴趣）
 *   · step_done    某步**真实完成**（核心漏斗）
 *   · scene_finish 该场景全部步骤完成
 *
 * 🔴 四条设计铁律（勿改坏）
 *   ① **`step_done` 只能由真实结果上报** —— 前端挂在 MapView 的 `sceneDone` 置位处
 *      （即「商圈加载成功 / 人口分析出结果 / …」之后），⛔ 绝不能挂在按钮点击处。
 *      按点击计 ⇒ 点了但没跑出结果也算完成 ⇒ 漏斗数据是假的，比没有更糟。
 *   ② **服务端 24h 去重**（同人+同事件+同场景+同步骤只留一条）：
 *      前端刷新/重进页面会重复上报，不去重则「完成人数」被放大成「完成次数」。
 *      ⭐ 这样表体积也有上界：人数 × 步骤数 × 事件数 / 天。
 *   ③ **埋点绝不影响主流程**：本接口永远返回 2xx（除非未登录），
 *      字段非法只跳过不报错；前端也是 fire-and-forget。
 *   ④ **只记「行为坐标」，不记业务数据**：不存门店名/地址/评分/任何用户输入，
 *      因此聚合统计不触碰「拒绝跨用户聚合业务数据」那条底线。
 *
 * ⚠️ 幂等零迁移：表与索引由 models/database.js 的 IF NOT EXISTS 在启动时建，重启即生效。
 */
import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const router = express.Router()

/** 允许的事件白名单。⛔ 不做自由文本，避免变成任意写入口 */
const EVENTS = ['guide_open', 'scene_start', 'step_done', 'scene_finish']

/** 场景/步骤 key 的形态：前端配置里的 key 都是这种形态（如 network-plan / siteCircle） */
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/

/** 去重窗口：24h（越过跨天，够表达「今天这人做过这步」） */
const DEDUPE_HOURS = 24

function str(v) {
  return String(v ?? '').trim()
}

function loadUser(db, id) {
  const uid = Number(id)
  if (!uid) return null
  return db.prepare('SELECT id, username FROM users WHERE id = ?').get(uid) || null
}

/**
 * 上报一个事件。
 * body: { event, scene?, step?, step_index? }
 * ⭐ 刻意设计成「怎么都不报错」：埋点失败不该让用户的正常操作看到红字。
 */
router.post('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const me = loadUser(db, req.user?.id)
    if (!me) return res.json({ ok: false, reason: 'no-user' })

    const event = str(req.body?.event)
    const scene = str(req.body?.scene)
    const step = str(req.body?.step)
    const stepIndex = Number.isInteger(req.body?.step_index) ? req.body.step_index : null

    // 非法就直接吞掉（见铁律 ③）
    if (!EVENTS.includes(event)) return res.json({ ok: false, reason: 'bad-event' })
    if (scene && !KEY_RE.test(scene)) return res.json({ ok: false, reason: 'bad-scene' })
    if (step && !KEY_RE.test(step)) return res.json({ ok: false, reason: 'bad-step' })

    // 去重（铁律 ②）——先查后插，⛔ 不依赖表达式唯一索引（sql.js 版本差异风险）
    const dup = db.prepare(
      `SELECT id FROM scene_events
       WHERE user_id = ? AND event = ? AND IFNULL(scene,'') = ? AND IFNULL(step,'') = ?
         AND created_at >= datetime('now', ?)
       LIMIT 1`
    ).get(me.id, event, scene, step, `-${DEDUPE_HOURS} hours`)
    if (dup) return res.json({ ok: true, deduped: true })

    db.prepare(`
      INSERT INTO scene_events (user_id, username, event, scene, step, step_index)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(me.id, me.username, event, scene || null, step || null, stepIndex)

    return res.json({ ok: true })
  } catch (error) {
    // 埋点永远不抛给用户
    console.error('[scene-events] 上报失败:', error?.message || error)
    return res.json({ ok: false })
  }
})

/**
 * 漏斗汇总（仅 admin）。
 * GET /api/scene-events/summary?days=30
 *
 * 返回结构（每个场景一段）：
 *   { scene, opened, started, finished,
 *     steps: [{ step, index, done, rate }] }
 *   · done  = 该步**去重后的人数**（COUNT DISTINCT user_id）
 *   · rate  = done / started（以「选了这个场景的人」为分母 —— 这才是流失率的分母）
 *   · 分母为 0 时 rate 返回 null（⛔ 不要返回 0，0 会被读成「没人完成」）
 */
// ⚠️ requireAdmin **必须**挂在 authenticate 之后（它只判角色，不认证）
router.get('/summary', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365)
    const since = `-${days} days`

    const rows = db.prepare(
      `SELECT event, scene, step, step_index,
              COUNT(DISTINCT user_id) AS users
       FROM scene_events
       WHERE created_at >= datetime('now', ?)
       GROUP BY event, scene, step`
    ).all(since)

    const scenes = new Map()
    const ensure = (k) => {
      // ⚠️ 不要在这里放 opened：打开引导是不绑场景的（见上方 opened 单独统计），
      //    放进来会恒为 0，读的人会误以为「没人打开过」。
      if (!scenes.has(k)) scenes.set(k, { scene: k, started: 0, finished: 0, steps: [] })
      return scenes.get(k)
    }

    for (const r of rows) {
      const ev = r.event
      const n = Number(r.users) || 0
      if (ev === 'scene_start') {
        ensure(r.scene || '(none)').started = n
      } else if (ev === 'scene_finish') {
        ensure(r.scene || '(none)').finished = n
      } else if (ev === 'step_done') {
        const s = ensure(r.scene || '(none)')
        s.steps.push({ step: r.step, index: r.step_index, done: n })
      }
    }

    // guide_open 不绑场景，单独给一个总览
    const openedRow = rows.find(r => r.event === 'guide_open')
    const opened = openedRow ? Number(openedRow.users) || 0 : 0

    const list = [...scenes.values()].map((s) => {
      s.steps.sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
      s.steps = s.steps.map(x => ({
        ...x,
        rate: s.started > 0 ? Math.round(x.done / s.started * 100) : null
      }))
      s.finishRate = s.started > 0 ? Math.round(s.finished / s.started * 100) : null
      return s
    }).sort((a, b) => b.started - a.started)

    res.json({ success: true, days, opened, scenes: list })
  } catch (error) {
    console.error('[scene-events] 汇总失败:', error)
    res.status(500).json({ message: '汇总失败：' + (error?.message || '未知错误') })
  }
})

export default router
