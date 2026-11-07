/**
 * 业态确认弹框 —— v1.13.329
 *
 * 为什么单独一个文件：`utils/storeBrand.js` 要保持**零依赖**（守卫测试在 Node 里直接
 * import 它跑边界用例），而本模块要用 Element Plus 的 ElMessageBox。
 *
 * 业务背景：白名单（BRAND_CATEGORY_MAP）只有 34 个品牌，未收录的品牌（如「滨寿司」）
 * 原先会把「未知（请根据品牌自行判断）」丢给大模型去猜 —— 猜错会让整段建议跑偏，
 * 而且**照样扣 Token**（见记忆里的费用铁律：拒答/胡说都花钱）。
 * ⇒ 改成在调模型之前问用户一句，用户填完再用其填写的业态调用。
 */

import { ElMessageBox } from 'element-plus'
import 'element-plus/es/components/message-box/style/css'

/** 弹框里的举例文案（仅提示用，不参与判断） */
const CATEGORY_EXAMPLES = '回转寿司 / 日式牛肉饭快餐 / 新式茶饮 / 火锅正餐 / 社区生鲜超市'

/**
 * 同一会话内记住用户上次填的业态，同品牌下次作为默认值。
 * ⚠️ 刻意**不落盘**（不写 localStorage）：业态可能随门店调整，陈旧值比空值更危险。
 */
const lastCategoryByBrand = new Map()

/**
 * 白名单没命中时，在调用大模型之前让用户补一句业态。
 *
 * @param {string} brand 已提取的品牌名（用于弹框文案与默认值记忆）
 * @returns {Promise<string>} 用户填写的业态；**取消/关闭时返回空串**，
 *   调用方据此中止流程 —— 不要拿空串去调 AI（会变成模型自己猜，等于没修）。
 */
export async function promptCategoryIfUnmapped(brand) {
  const key = brand || '__unknown__'
  try {
    const { value } = await ElMessageBox.prompt(
      `系统没有收录「${brand || '该门店'}」的业态。请补充一句业态描述 —— AI 会按它来分析，` +
        `这比让模型自己猜更准（也避免白花一次调用）。`,
      '确认业态',
      {
        confirmButtonText: '开始分析',
        cancelButtonText: '取消',
        inputValue: lastCategoryByBrand.get(key) || '',
        inputPlaceholder: `例如：${CATEGORY_EXAMPLES}`,
        inputValidator: (v) => {
          const t = String(v || '').trim()
          if (t.length < 2) return '请填写业态（至少 2 个字）'
          if (t.length > 30) return '请控制在 30 个字以内'
          return true
        }
      }
    )
    const val = String(value || '').trim()
    if (val) lastCategoryByBrand.set(key, val)
    return val
  } catch (e) {
    // 取消 / 关闭 ⇒ 空串（调用方中止，不消耗 AI 额度）
    return ''
  }
}
