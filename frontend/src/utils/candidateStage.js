/**
 * 候选点位「推进阶段」的**唯一来源**（v1.13.333 · P1-6）
 *
 * 为什么单独一个文件：这四档要同时被「列表页 / 详情抽屉 / 统计条 / 后端校验 / 测试」用到，
 * 散在各处就会漂移（本项目已被「两份 BRAND_CATEGORY_MAP 各自漂移」坑过一次，见 utils/storeBrand.js）。
 *
 * 🔴🔴 下面 STAGES 的字符串是**落库值**（`store_candidates.stage`）：
 *   改动必须同时改 `backend/src/routes/candidates.js::STAGES` 与
 *   `backend/src/models/database.js` 的建表默认值 —— 守卫 `tests/candidateWorkflow.test.js`
 *   会做三处对比，只改一处立刻红。
 *
 * 🔴 `markers.status` 是**经营状态**（正常/关注/暂停/关闭），与本文件的推进阶段是两套语义，
 *   ⛔ 绝不要合并、也不要拿阶段去写门店状态。
 *
 * ⚠️ 本模块必须**零依赖**（守卫在 Node 里直接 import 跑用例，同 importSpecs.js / storeBrand.js）。
 */

/** 推进四档（业主 2026-11-09 定；顺序＝推进正序，⛔ 不要重排：统计条按此顺序渲染） */
export const STAGES = ['待评估', '已勘踏', '立项', '放弃']

/**
 * 每档的展示元数据。
 * ⚠️ 颜色写死在这里、用内联 style 渲染，⛔ 不要用 el-tag 的 type（项目里 EP 全局色被覆盖过，
 *    type 出来的颜色和设计稿对不上，见记忆附录①§6.31 ⑦⑧）。
 * `progress` 只用于「阶段徽标前的实心点大小」这类视觉轻重，不参与业务判断。
 */
export const STAGE_META = {
  '待评估': { color: '#909399', bg: '#f4f4f5', desc: '已记录位置，还没去现场' },
  '已勘踏': { color: '#e6a23c', bg: '#fdf6ec', desc: '现场看过了，等内部评估' },
  '立项': { color: '#67c23a', bg: '#f0f9eb', desc: '已进入立项 / 签约流程' },
  '放弃': { color: '#b1b3b8', bg: '#f4f4f5', desc: '不做了，原因见流水' }
}

/** 是否是合法阶段（前后端同口径；前端用在切阶段前的兜底） */
export function isValidStage(s) {
  return STAGES.includes(s)
}

/**
 * 取阶段元数据；未知值不抛错、也不静默当"待评估"，
 * 而是返回一个明显的灰色占位 —— 让脏数据在界面上看得见，而不是被洗掉。
 */
export function stageMeta(s) {
  return STAGE_META[s] || { color: '#c0c4cc', bg: '#f4f4f5', desc: '未知阶段（数据异常）' }
}

/** 「放弃」必须给原因：与后端同口径，前端提前拦一下省一次往返 */
export function requiresDropReason(stage) {
  return stage === '放弃'
}
