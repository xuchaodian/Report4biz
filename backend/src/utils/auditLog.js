/**
 * 敏感操作审计日志（v1.13.320）
 *
 * 由来（2026-11-06 安全审计）：
 *   admin 改配额 / 改角色 / 停用 / 删号 / 重置密码，全站**没有任何落库留痕**，
 *   只有 2 处 `console.log('[audit]')`（且都在 store-sales，与配额无关）。
 *   ⇒ 内部人滥用或 admin 账号被盗后，pm2 日志一轮转就彻底无法追溯。
 *   同时 `quota_history` 只记「某账号的配额变了多少」，**不记是谁改的**。
 *
 * 三条设计约束（改本文件前先读）：
 *
 * ① **审计是旁路，绝不能拖垮业务。**
 *    写失败只 console.error，不抛异常、不回滚业务事务。
 *    （但⚠️ 反过来说：审计**丢一条**是可以接受的，业务**少做一步**不可接受。
 *      所以这里不做「审计失败就回滚」那套。）
 *
 * ② **必须尽量在调用方已有的 `beginTx()` 事务内调用。**
 *    本库是 sql.js：非事务态的每次 `run()` 都会 `db.export()` + 整库写盘（当前 ~166MB）。
 *    一个单次写的 handler（如停用账号）加审计后变成两次写 ⇒ 要包事务，否则多付一次整库落盘。
 *    ⇒ 调用方负责事务；本函数**不自己开事务**（在事务内再 beginTx 会嵌套出错）。
 *
 * ③ **操作人存快照，不存实时外键。**
 *    `actor_name` / `actor_role` 是操作那一刻的值：操作人被改名、降权、停用、
 *    甚至物理删除后，审计仍要看得出「当时是谁、当时是不是 admin」。
 *    （本库未开 PRAGMA foreign_keys ⇒ actor_id 会悬空，快照是唯一可靠来源。）
 *
 * ⛔ 不要把密码、token、密钥、完整请求体写进 detail —— 审计表是长期留存的。
 */
import { getDb } from '../models/database.js'

/**
 * 动作码。
 * 🔴 一律从这里取，⛔ 不要在 handler 里手写字符串：
 *    散落字符串改一个字就差一个动作，查询时会漏（本项目已因同类问题返工过多次）。
 */
export const AUDIT_ACTIONS = {
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DISABLE: 'user.disable',
  USER_ENABLE: 'user.enable',
  USER_DELETE: 'user.delete',
  USER_RESET_PASSWORD: 'user.reset_password',
  QUOTA_POOL: 'quota.pool',
  VIP_REVIEW: 'vip.review',
  CITYDATA_CLEAR: 'citydata.clear',
  CITYDATA_IMPORT: 'citydata.import',
  CITYDATA_UPSERT: 'citydata.upsert',
  CITYDATA_UPDATE: 'citydata.update',
}

/** detail JSON 的上限（字符）。超长截断并标注，避免一条日志把整库撑大。 */
const MAX_DETAIL_CHARS = 4000
/** user_agent 上限 */
const MAX_UA_CHARS = 300

/**
 * 写一条审计。
 *
 * @param {object}  opts
 * @param {object}  opts.req          Express 请求（取 actor / ip / ua）
 * @param {string}  opts.action       AUDIT_ACTIONS 里的值
 * @param {string} [opts.targetType]  user / org / city_data / store ...
 * @param {*}       [opts.targetId]   目标标识（数字 id 或字符串键）
 * @param {object}  [opts.detail]     结构化前后值，建议用 diffFields 生成
 * @param {object}  [opts.actor]      覆盖操作人（系统自动写入时传 { id:null, username:'system' }）
 * @param {object}  [opts.db]         复用调用方已取的 db（省一次 getDb）
 * @returns {boolean} 是否写入成功（调用方一般不用管）
 */
export function writeAudit({
  req,
  action,
  targetType = null,
  targetId = null,
  detail = null,
  actor = null,
  db = null,
} = {}) {
  try {
    const database = db || getDb()

    const who = actor || req?.user || null
    const actorId = who?.id ?? null
    const actorName = who?.username ?? null
    const actorRole = who?.role ?? null

    let detailText = null
    if (detail && typeof detail === 'object' && Object.keys(detail).length > 0) {
      let s = JSON.stringify(detail)
      if (s.length > MAX_DETAIL_CHARS) {
        s = s.slice(0, MAX_DETAIL_CHARS) + `…[truncated ${s.length - MAX_DETAIL_CHARS} chars]`
      }
      detailText = s
    }

    // req.ip 依赖 app.js 的 `app.set('trust proxy', true)`（已开），否则拿到的是 nginx 内网 IP
    const ip = req?.ip ? String(req.ip).slice(0, 64) : null
    const ua = req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, MAX_UA_CHARS) : null

    database
      .prepare(
        `INSERT INTO audit_log
           (actor_id, actor_name, actor_role, action, target_type, target_id, detail, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        actorId,
        actorName,
        actorRole,
        action,
        targetType,
        targetId === null || targetId === undefined ? null : String(targetId),
        detailText,
        ip,
        ua
      )
    return true
  } catch (e) {
    // 审计失败不能影响业务（见文件头 ①）
    console.error('[audit] 写审计失败:', e?.message || e)
    return false
  }
}

/**
 * 只收录**真的变了**的字段，生成 `{ field: { from, to } }`。
 *
 * 为什么要它：编辑弹窗会把整行原值一起提交（本项目 v1.13.142 已为同一原因返工过），
 * 若把所有字段都写进 detail，真正变动的那一项会被 10 个没变的字段淹没。
 *
 * @param {object} before 变更前的行
 * @param {object} after  变更后的值（或直接给 { field: newValue }）
 * @param {string[]} keys 关心的字段
 */
export function diffFields(before, after, keys) {
  const out = {}
  for (const k of keys) {
    const a = before?.[k] ?? null
    const b = after?.[k] ?? null
    if (a !== b) out[k] = { from: a, to: b }
  }
  return out
}
