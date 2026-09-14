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
