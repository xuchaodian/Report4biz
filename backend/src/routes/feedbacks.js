/**
 * 用户意见反馈（v1.13.261）
 * ---------------------------------------------------------------------------
 * 场景：外部客户自助注册后，在使用中提交「用着有问题 / 有改进建议」。
 *   提交 → 落库（feedbacks）→ 内部通知邮件（config.js::FEEDBACK_NOTIFY_EMAIL）。
 *   一期**不做**管理后台列表页 —— 反馈量小，直接看邮件处理；
 *   `status` / `admin_note` / `handled_at` 先留着，等量上来（约每月 >20 条）再补二期。
 *
 * 🔴 设计要点（勿改坏）
 *   ① **上下文自动采集，不靠用户描述**：用户只会说「点不动」，
 *      而 `page_path` / `scene_key` / `scene_step` 能直接告出是哪个页面、哪个引导场景第几步。
 *      ⛔ 不要为了"表单简洁"把这几个字段砍掉 —— 它们是本功能的核心价值。
 *   ② **先回响应、后发信**：SMTP socketTimeout 达 30s，`await` 会让用户干等；
 *      且发信失败绝不能把「反馈已提交」这一既成事实变成 500。
 *   ③ 邮件在 INSERT **之后**发送（外部 IO 不进事务边界）。
 *   ④ **以库内数据为准**读账号（⛔ 不用 `req.user.username`：JWT 是签发时快照）。
 *   ⑤ 限流：同一账号 60 分钟内最多 5 条 —— 防误触重发与刷屏，⛔ 不要靠前端拦。
 *
 * ⚠️ 幂等零迁移：feedbacks 表与索引由 models/database.js 的
 *    CREATE TABLE/INDEX IF NOT EXISTS 在启动时自动建，生产重启即生效，无需手工脚本。
 */
import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { isMailEnabled, sendFeedbackNotice } from '../utils/mailer.js'
import { FEEDBACK_NOTIFY_EMAIL } from '../config.js'

const router = express.Router()

/** 反馈类型：只做两种。⛔ 不要扩成「bug/建议/咨询/投诉/其他」—— 用户分不清，分类靠人工判断 */
const TYPES = ['bug', 'idea']

/** 字段长度上限（服务端兜底，防超长文本撑库）；与前端 maxlength 同口径 */
const FIELD_MAX = {
  content: 2000,
  page_path: 200,
  scene_key: 60,
  scene_step: 60,
  user_agent: 300,
  screen: 20
}

/** 限流窗口 */
const RATE = { windowMinutes: 60, max: 5 }

/** 以库内数据为准读取账号（见文件头 ④） */
function loadUser(db, id) {
  const uid = Number(id)
  if (!uid) return null
  return db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(uid) || null
}

/** 取字符串字段并 trim（超长交给 FIELD_MAX 统一校验） */
function str(v) {
  return String(v ?? '').trim()
}

/**
 * 提交反馈
 * body: { type, content, page_path?, scene_key?, scene_step?, user_agent?, screen? }
 */
router.post('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const me = loadUser(db, req.user?.id)
    if (!me) return res.status(404).json({ message: '账号不存在' })

    const type = str(req.body?.type)
    const content = str(req.body?.content)
    const pagePath = str(req.body?.page_path)
    const sceneKey = str(req.body?.scene_key)
    const sceneStep = str(req.body?.scene_step)
    const userAgent = str(req.body?.user_agent)
    const screen = str(req.body?.screen)

    if (!TYPES.includes(type)) {
      return res.status(400).json({ message: '反馈类型不正确' })
    }
    if (!content) {
      return res.status(400).json({ message: '请填写反馈内容' })
    }

    const fields = {
      content, page_path: pagePath, scene_key: sceneKey,
      scene_step: sceneStep, user_agent: userAgent, screen
    }
    for (const [k, max] of Object.entries(FIELD_MAX)) {
      if (fields[k] && fields[k].length > max) {
        return res.status(400).json({ message: `字段过长：${k} 最多 ${max} 个字符` })
      }
    }

    // 限流（⛔ 前端拦截不算数，服务端必须自己判）
    const recent = db.prepare(
      `SELECT COUNT(*) AS n FROM feedbacks
       WHERE user_id = ? AND created_at >= datetime('now', ?)`
    ).get(me.id, `-${RATE.windowMinutes} minutes`)
    if (recent && Number(recent.n) >= RATE.max) {
      return res.status(429).json({ message: '反馈太频繁了，请稍后再试' })
    }

    const result = db.prepare(`
      INSERT INTO feedbacks
        (user_id, username, type, content, page_path, scene_key, scene_step, user_agent, screen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      me.id, me.username, type, content,
      pagePath || null, sceneKey || null, sceneStep || null,
      userAgent || null, screen || null
    )

    const created = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({
      message: '反馈已提交，谢谢！我们会尽快处理',
      id: created.id
    })

    // ---- 以下为「已提交」之后的副作用，绝不影响上面的响应（见文件头 ②③）----
    if (isMailEnabled()) {
      sendFeedbackNotice({
        to: FEEDBACK_NOTIFY_EMAIL,
        id: created.id,
        type,
        content,
        username: me.username,
        userEmail: me.email,
        pagePath,
        sceneKey,
        sceneStep,
        userAgent,
        screen,
        createdAt: created.created_at
      }).catch((e) => {
        console.error('[feedbacks] 内部通知邮件发送失败:', e?.message || e)
      })
    } else {
      console.warn('[feedbacks] 邮件未配置，跳过内部通知（反馈已落库）')
    }
  } catch (error) {
    console.error('[feedbacks] 提交反馈失败:', error)
    res.status(500).json({ message: '提交反馈失败，请稍后重试' })
  }
})

export default router
