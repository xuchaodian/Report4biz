// 邮件发送封装（阿里云邮件推送 DirectMail SMTP）
//
// 设计要点：
// 1) 走 465(SSL)：阿里云 ECS 默认封禁 TCP 25 端口出方向，不能用 25 发信。
// 2) 凭据全部来自环境变量 / backend/.env（config.js 统一加载），源码内不写死。
// 3) transporter 懒加载 + 连接池复用，避免每次发信重新做 TLS 握手。
// 4) 未配置凭据时整体禁用：isMailEnabled() 返回 false，调用方据此返回 503。
import nodemailer from 'nodemailer'
import {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM_NAME, MAIL_ENABLED
} from '../config.js'

let transporter = null

export function isMailEnabled() {
  return MAIL_ENABLED
}

function getTransporter() {
  if (!MAIL_ENABLED) return null
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 为隐式 TLS；587 走 STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000
    })
  }
  return transporter
}

/**
 * 连接 + 鉴权自检（部署后冒烟用，不实际发送邮件）。
 * 凭据或端口不对时会抛错，便于在部署阶段立刻发现。
 */
export async function verifyMailer() {
  const t = getTransporter()
  if (!t) throw new Error('邮件未配置（SMTP_USER / SMTP_PASS 缺失）')
  await t.verify()
  return true
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

/**
 * 发送「重置密码」邮件。
 * @param {{ to: string, username?: string, link: string, expiresMinutes?: number }} opts
 * @returns {Promise<object>} nodemailer 的发送结果（含 messageId）
 */
export async function sendPasswordResetMail({ to, username, link, expiresMinutes = 30 }) {
  const t = getTransporter()
  if (!t) throw new Error('邮件服务未配置')

  const safeName = escapeHtml(username || to)
  const safeLink = escapeHtml(link)
  const subject = `【${MAIL_FROM_NAME}】密码重置`

  const text = [
    `${username || ''} 你好，`,
    '',
    `我们收到了你的「${MAIL_FROM_NAME}」账号密码重置请求。`,
    `请在 ${expiresMinutes} 分钟内打开下面的链接设置新密码：`,
    '',
    link,
    '',
    '链接仅可使用一次，过期后需重新申请。',
    '如果这不是你本人的操作，请忽略本邮件，你的密码不会被修改。',
    '',
    `—— ${MAIL_FROM_NAME}（本邮件由系统自动发送，请勿直接回复）`
  ].join('\n')

  const html = `
<div style="max-width:560px;margin:0 auto;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#333;">
  <h2 style="font-size:18px;font-weight:500;margin:0 0 16px;color:#333;">密码重置</h2>
  <p style="font-size:14px;line-height:1.7;margin:0 0 12px;">${safeName} 你好，</p>
  <p style="font-size:14px;line-height:1.7;margin:0 0 20px;">我们收到了你的「${MAIL_FROM_NAME}」账号密码重置请求。请在 <strong>${expiresMinutes} 分钟</strong>内点击下方按钮设置新密码：</p>
  <p style="margin:0 0 20px;">
    <a href="${safeLink}" style="display:inline-block;padding:11px 26px;background:#409eff;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;">设置新密码</a>
  </p>
  <p style="font-size:12px;color:#888;line-height:1.7;margin:0 0 8px;">按钮无法点击时，请复制下面的链接到浏览器打开：</p>
  <p style="font-size:12px;color:#409eff;word-break:break-all;line-height:1.7;margin:0 0 20px;">${safeLink}</p>
  <p style="font-size:12px;color:#888;line-height:1.7;margin:0 0 8px;">链接仅可使用一次，过期后需重新申请。</p>
  <p style="font-size:12px;color:#888;line-height:1.7;margin:0;">如果这不是你本人的操作，请忽略本邮件，你的密码不会被修改。</p>
  <hr style="border:none;border-top:1px solid #eeeeee;margin:20px 0;">
  <p style="font-size:12px;color:#aaaaaa;line-height:1.7;margin:0;">${MAIL_FROM_NAME} · 本邮件由系统自动发送，请勿直接回复</p>
</div>`.trim()

  const info = await t.sendMail({
    from: `"${MAIL_FROM_NAME}" <${SMTP_USER}>`,
    to,
    subject,
    text,
    html
  })
  return info
}

/**
 * 发送「配额采购申请」内部通知（v1.13.218）。
 *
 * 收件人是我方商务/管理员（config.js::QUOTA_NOTIFY_EMAIL），**不是**申请人。
 *
 * ⚠️ 调用方约束（routes/quotaRequests.js 的 POST / 已按此实现）：
 *   ① 必须在 INSERT **之后**调用 —— 外部 IO 绝不进事务（项目铁律）；
 *   ② 必须「先回响应、后发信」＋ `.catch()` 兜住 —— SMTP socketTimeout 达 30s，
 *      await 会让用户干等；且发信失败绝不能把「申请已提交」变成 500。
 *   ③ ⛔ 正文不落「单价 / 报价 / 金额」（决策 4：成本 ≠ 售价，价格属合同条款）。
 *
 * @param {{ to: string, requestId: number, applicant?: string, company?: string, department?: string,
 *           contactName?: string, contactEmail?: string, contactPhone?: string,
 *           wantAmount?: number, purpose?: string, expectDate?: string, createdAt?: string }} opts
 * @returns {Promise<object>} nodemailer 的发送结果（含 messageId）
 */
export async function sendQuotaPurchaseNotice({
  to, requestId, applicant, company, department,
  contactName, contactEmail, contactPhone, wantAmount, purpose, expectDate, createdAt
}) {
  const t = getTransporter()
  if (!t) throw new Error('邮件服务未配置')

  const id = requestId ?? '—'
  const subject = `【${MAIL_FROM_NAME}】新的配额采购申请（#${id}${company ? ' · ' + company : ''}）`

  // 逐项 escapeHtml：申请人自填字段全部按不可信文本处理
  const lines = [
    ['申请人账号', applicant || '—'],
    ['公司名称', company || '—'],
    ['所在部门', department || '—'],
    ['联系人', contactName || '—'],
    ['联系电话', contactPhone || '—'],
    ['电子邮箱', contactEmail || '—'],
    ['采购次数', wantAmount != null ? String(wantAmount) : '—'],
    ['用途说明', purpose || '—'],
    ['期望到货日期', expectDate || '—'],
    ['提交时间', createdAt || '—']
  ].map(([k, v]) => [k, String(v)])

  const text = [
    `收到一条新的「${MAIL_FROM_NAME}」配额采购申请（单号 #${id}）：`,
    '',
    ...lines.map(([k, v]) => `${k}：${v}`),
    '',
    '请及时与申请人联系，确认合同与付款事宜。',
    '（受理后请在「用户管理」页单独执行配额充值 —— 审批本身不会到账）',
    '',
    `—— ${MAIL_FROM_NAME}（本邮件由系统自动发送，请勿直接回复）`
  ].join('\n')

  const rowsHtml = lines.map(([k, v]) => (
    `<tr>` +
    `<td style="padding:7px 12px;border:1px solid #eeeeee;background:#fafafa;color:#666;font-size:13px;white-space:nowrap;">${escapeHtml(k)}</td>` +
    `<td style="padding:7px 12px;border:1px solid #eeeeee;color:#333;font-size:13px;word-break:break-all;">${escapeHtml(v)}</td>` +
    `</tr>`
  )).join('')

  const html = `
<div style="max-width:620px;margin:0 auto;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#333;">
  <h2 style="font-size:18px;font-weight:500;margin:0 0 8px;color:#333;">新的配额采购申请</h2>
  <p style="font-size:13px;line-height:1.7;margin:0 0 18px;color:#888;">单号 #${escapeHtml(String(id))} · 来自用户在 ${MAIL_FROM_NAME} 提交的采购意向</p>
  <table style="border-collapse:collapse;width:100%;margin:0 0 18px;">${rowsHtml}</table>
  <p style="font-size:13px;line-height:1.7;margin:0 0 8px;">请及时与申请人联系，确认合同与付款事宜。</p>
  <p style="font-size:12px;color:#888;line-height:1.7;margin:0 0 18px;">受理后请在「用户管理」页单独执行配额充值 —— 审批本身不会到账。</p>
  <hr style="border:none;border-top:1px solid #eeeeee;margin:20px 0;">
  <p style="font-size:12px;color:#aaaaaa;line-height:1.7;margin:0;">${MAIL_FROM_NAME} · 本邮件由系统自动发送，请勿直接回复</p>
</div>`.trim()

  const info = await t.sendMail({
    from: `"${MAIL_FROM_NAME}" <${SMTP_USER}>`,
    to,
    subject,
    text,
    html
  })
  return info
}


/**
 * 发送「用户意见反馈」内部通知（v1.13.261）。
 *
 * ⚠️ 调用方约束（routes/feedbacks.js 的 POST / 已按此实现）：
 *   ① 必须在 INSERT **之后**调用 —— 外部 IO 绝不进事务/事务边界；
 *   ② 必须「先回响应、后发信」＋ `.catch()` 兜住 —— SMTP socketTimeout 达 30s，
 *      await 会让用户干等；发信失败绝不能把「反馈已提交」变成 500；
 *   ③ `content` 是用户自由文本，text 版原样保留换行，html 版 escapeHtml 后把 \n 转 <br>。
 *
 * 🔴 为什么邮件里要带 page_path / scene_key / scene_step：
 *    用户只会说「点不动」，但这三个字段能直接告诉我们是哪个页面、哪个引导场景的第几步。
 *    ⛔ 不要为了"简洁"把这几个上下文砍掉 —— 它们是这个功能真正的价值。
 *
 * @param {{ to: string, id?: number, type?: string, content?: string, username?: string,
 *           userEmail?: string, pagePath?: string, sceneKey?: string, sceneStep?: string,
 *           userAgent?: string, screen?: string, createdAt?: string }} opts
 * @returns {Promise<object>} nodemailer 的发送结果（含 messageId）
 */
export async function sendFeedbackNotice({
  to, id, type, content, username, userEmail,
  pagePath, sceneKey, sceneStep, userAgent, screen, createdAt
}) {
  const t = getTransporter()
  if (!t) throw new Error('邮件服务未配置')

  const fid = id ?? '—'
  const typeText = type === 'idea' ? '改进建议' : '问题反馈'
  const sceneText = sceneKey ? (sceneStep ? `${sceneKey} / ${sceneStep}` : sceneKey) : '—'
  const subject = `【${MAIL_FROM_NAME}】用户反馈 #${fid}（${typeText}${username ? ' · ' + username : ''}）`

  const lines = [
    ['类型', typeText],
    ['反馈人', username || '—'],
    ['注册邮箱', userEmail || '—'],
    ['所在页面', pagePath || '—'],
    ['引导位置', sceneText],
    ['屏幕', screen || '—'],
    ['浏览器', userAgent || '—'],
    ['提交时间', createdAt || '—']
  ].map(([k, v]) => [k, String(v)])

  const bodyText = String(content || '—')

  const text = [
    `收到一条新的「${MAIL_FROM_NAME}」用户反馈（#${fid}）：`,
    '',
    ...lines.map(([k, v]) => `${k}：${v}`),
    '',
    '反馈内容：',
    bodyText,
    '',
    '—— 可直接回复本邮件？⛔ 不行，本邮件为系统自动发送；请用「注册邮箱」联系用户。',
    `—— ${MAIL_FROM_NAME}`
  ].join('\n')

  const rowsHtml = lines.map(([k, v]) => (
    `<tr>` +
    `<td style="padding:7px 12px;border:1px solid #eeeeee;background:#fafafa;color:#666;font-size:13px;white-space:nowrap;">${escapeHtml(k)}</td>` +
    `<td style="padding:7px 12px;border:1px solid #eeeeee;color:#333;font-size:13px;word-break:break-all;">${escapeHtml(v)}</td>` +
    `</tr>`
  )).join('')

  const contentHtml = escapeHtml(bodyText).replace(/\n/g, '<br>')

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;">
  <h2 style="font-size:16px;color:#333;margin:0 0 16px;">用户反馈 #${escapeHtml(String(fid))}</h2>
  <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">${rowsHtml}</table>
  <div style="background:#fafafa;border:1px solid #eeeeee;border-radius:6px;padding:14px 16px;">
    <p style="font-size:12px;color:#999;margin:0 0 8px;">反馈内容</p>
    <p style="font-size:13px;color:#333;line-height:1.8;margin:0;white-space:normal;">${contentHtml}</p>
  </div>
  <p style="font-size:12px;color:#aaaaaa;line-height:1.7;margin:16px 0 0;">请用「注册邮箱」联系用户，本邮件由系统自动发送，请勿直接回复</p>
  <p style="font-size:12px;color:#aaaaaa;line-height:1.7;margin:0;">${MAIL_FROM_NAME}</p>
</div>`.trim()

  const info = await t.sendMail({
    from: `"${MAIL_FROM_NAME}" <${SMTP_USER}>`,
    to,
    subject,
    text,
    html
  })
  return info
}
