// ============================================================================
// 同步只读锁（集团/子公司同步 §7.3 · 规则 4「写权唯一」）
// ----------------------------------------------------------------------------
// 背景：镜像行（`sync_readonly = 1`）由**源账号**维护，目标账号只能读。
//   目标账号若想本地改动，必须先走 `POST /api/sync/detach`「脱离同步」
//   （清 origin_* + sync_readonly=0 → 转为自有行），此后不再被源侧覆盖。
//
// 为什么抽成共享模块（v1.13.122 批次 E）：
//   批次 D 只在 `markers.js` 里写了这把锁。批次 E 把同步对象扩到
//   `competitors` 之后，**竞品表也必须上同一把锁** —— 否则子公司能直接
//   改/删同步来的竞品镜像，单写者模型当场破裂。
//   两处各写一份必然漂移（文案/状态码/字段名），故收敛到本文件。
//
// ⚠️ 文案按 kind 区分（「该门店」/「该竞品门店」）—— 混用会让用户以为
//    改错了对象。KIND_LABEL 与本文件同源，勿在调用方各自硬编码。
// ============================================================================

/** kind → 中文量词标签（用于文案；与 syncCore.KIND_META.label 保持一致的含义） */
export const KIND_LABEL = {
  markers: '门店',
  competitors: '竞品门店'
}

/** 取 kind 的展示标签，未知 kind 回退为「数据」 */
export function kindLabel(kind) {
  return KIND_LABEL[kind] || '数据'
}

/**
 * 只读锁拦截器。
 *
 * @param {Object} res    express 响应对象
 * @param {Object} row    目标表的数据行（需含 sync_readonly / origin_owner / origin_user_id）
 * @param {Object} [opts]
 * @param {string} [opts.kind='markers']  行所属对象（决定文案量词）
 * @param {string} [opts.action='修改']   被拦下的动作（修改 / 删除 / 批量删除 …）
 * @returns {boolean} true = **已拦下**（403 响应已发出，调用方须立即 return）
 */
export function blockedBySyncLock(res, row, { kind = 'markers', action = '修改' } = {}) {
  if (!row || Number(row.sync_readonly) !== 1) return false

  const owner = String(row.origin_owner || '').trim() || `账号 #${row.origin_user_id}`
  const label = kindLabel(kind)

  res.status(403).json({
    code: 'sync_readonly',
    message: `该${label}由「${owner}」同步维护，不能在此${action}。如需本地改动，请先「脱离同步」。`,
    kind,
    originUserId: row.origin_user_id,
    originOwner: row.origin_owner,
    readonly: true
  })
  return true
}

/**
 * 批量场景：从「待操作 id 列表 + 已查出的行」中剔除只读行，并统计被拦下的数量。
 * 用于批量删除 / 批量导入覆盖等**逐行循环**的写路径（这些路径没有单行 403 的机会，
 * 只能跳过 + 计数回报，否则会整批失败）。
 *
 * @returns {{ allowedIds:number[], lockedIds:number[], locked:number }}
 */
export function partitionLockedRows(rows, { idKey = 'id' } = {}) {
  const allowedIds = []
  const lockedIds = []
  for (const r of rows || []) {
    if (Number(r.sync_readonly) === 1) lockedIds.push(r[idKey])
    else allowedIds.push(r[idKey])
  }
  return { allowedIds, lockedIds, locked: lockedIds.length }
}
