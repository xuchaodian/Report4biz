/**
 * 时间格式化 —— 项目口径：**库里存 UTC，展示时转本地**（v1.13.333）
 *
 * 背景（这个坑踩过多次）：SQLite 的 `CURRENT_TIMESTAMP` 一律返回 **UTC** 的
 * 「YYYY-MM-DD HH:MM:SS」，不带时区标记。而
 *   · `new Date('2026-11-09 06:57:00')` —— Safari 直接 Invalid Date；
 *     Chrome 会当**本地时间**解析 ⇒ 显示比真实时间早 8 小时。
 * 正确做法：把空格换成 `T` 再补 `Z`，按 UTC 解析，然后用本地时间字段输出。
 *
 * ⚠️ 为什么不直接复用 `UsersView.vue` 里那份：它是内联在组件里的
 *    （那边注释同样写着「后端 created_at 是 UTC」）。同一段逻辑第二次出现时抽出来，
 *    ⛔ 不要在新页面里再抄第三份。UsersView 那份留待下次改它时迁过来。
 *
 * ⚠️ 纯函数、零依赖（守卫测试在 Node 里直接 import）。
 */

/** 补 Z 按 UTC 解析，返回 Date；解析失败返回 null */
export function parseUtc(raw) {
  if (!raw) return null
  const t = String(raw).trim()
  if (!t) return null
  const iso = t.includes('T') ? t : t.replace(' ', 'T')
  const d = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z')
  return isNaN(d.getTime()) ? null : d
}

const p2 = (n) => String(n).padStart(2, '0')

/** 「YYYY-MM-DD HH:MM」（本地时区）；解析失败时退回原串前 16 位，⛔ 不要显示 Invalid Date */
export function formatUtcDateTime(raw) {
  const d = parseUtc(raw)
  if (!d) return raw ? String(raw).slice(0, 16) : '—'
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}
