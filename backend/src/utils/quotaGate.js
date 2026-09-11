// ============================================================================
// 授权闸门（规则 20 · P0 必做，方案 §3.6 Ⅴ）
// ----------------------------------------------------------------------------
// 问题：`users.quota` 原先只是"显示值"不是"限制"—— 4 个扣减入口
//       （smartsteps / districts / scoringEngine / resale）都只校验全局物理池。
//       后果：集团分给子公司 100 次，用完后子公司**照样继续烧全局池**，
//       分配出去的数字没有任何约束力 → 需求实质上没落地。
//
// 本文件把 4 处散落的"只查 admin_quota"逻辑收敛为一次调用，并把
// "成员授权额度"纳入校验。
//
// ★ 兼容开关（关键决策 P8）：**仅对 org_members 中的成员启用**。
//   非组织账号（存量 youshi / xucd 等）行为与改动前**逐字一致**，
//   避免"历史 users.quota 远小于历史消耗"的账号突然配额耗尽。
//
// ★ 顺序铁律：本闸门必须先于 P1.5 配额分配上线（§11）。
//   否则会出现"集团分了额度、子公司照样烧全局池"的错误窗口期。
// ============================================================================

import { getPoolRemaining, getOwnQuota, isOrgMember } from './quotaPool.js'

/**
 * 调用上游前的统一配额校验。
 *
 * @param {Object}  db
 * @param {number|null} userId  调用者账号 id（第三方 API Key 场景传 null）
 * @param {number}  [need=1]    本次需要消耗的次数
 * @param {Object}  [opts]
 * @param {string}  [opts.role]      账号角色（'admin' 直接放行）
 * @param {boolean} [opts.isApiKey]  第三方 API Key 调用（无用户身份，仅校验物理池）
 * @returns {{
 *   ok: boolean,
 *   reason?: 'pool_exhausted'|'own_exhausted',
 *   pool: number,            // 物理池当前剩余
 *   own?: number,            // 成员未消耗授权余额（仅启用闸门时有意义）
 *   need?: number,
 *   isOrgMember?: boolean
 * }}
 */
export function checkQuota(db, userId, need = 1, { role, isApiKey = false } = {}) {
  const pool = getPoolRemaining(db)

  // ① 物理池永远先校验（所有账号，含 admin）
  //    上游真的调不动时，谁都不能放行 —— 这是与联通结算的硬边界
  if (pool < need) {
    return { ok: false, reason: 'pool_exhausted', pool, need }
  }

  // ② 平台 admin / 集团 owner 不走授权闸门（额度由池兜底）
  // ③ 第三方 API Key 无用户身份（另走 api_keys.balance 双轨扣减）→ 仅池校验
  if (role === 'admin' || isApiKey || !userId) {
    return { ok: true, pool }
  }

  // ④ ★ 仅「组织成员」启用授权闸门 —— 非组织账号保持现状（兼容开关 P8）
  if (!isOrgMember(db, userId)) {
    return { ok: true, pool, isOrgMember: false }
  }

  const own = getOwnQuota(db, userId)
  if (own < need) {
    return { ok: false, reason: 'own_exhausted', own, need, pool, isOrgMember: true }
  }

  return { ok: true, own, pool, isOrgMember: true }
}

/**
 * 统一构造闸门拒绝时的 HTTP 响应（4 处复用，避免文案与状态码漂移）。
 *
 * @param {Object} gate   checkQuota 的返回值（ok=false）
 * @param {Object} [opts]
 * @param {string} [opts.service='联通人口数据']  提示语里的服务名
 * @param {number} [opts.poolStatus=400]          物理池耗尽时的状态码（resale 沿用 429）
 * @returns {{ status: number, body: Object }}
 */
export function buildGateError(gate, { service = '联通人口数据', poolStatus = 400 } = {}) {
  if (gate.reason === 'own_exhausted') {
    return {
      status: 403,
      body: {
        message: `本账号「${service}」可用次数不足（需要 ${gate.need} 次，当前可用 ${gate.own} 次），请联系集团管理员分配`,
        code: 'own_quota_exhausted',
        own: gate.own,
        need: gate.need
      }
    }
  }
  return {
    status: poolStatus,
    body: {
      message: `运营商剩余配额不足，需要 ${gate.need} 次，当前剩余 ${gate.pool} 次`
    }
  }
}
