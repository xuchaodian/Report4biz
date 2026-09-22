/**
 * 操作指引（FAQ）本机匹配 —— 命中即由**前端直接作答**，完全不调用豆包。
 *
 * ## 为什么存在（2026-09-22 实测结论）
 * ① AI 助手的 systemPrompt 里**没有任何操作手册 / 菜单结构** ⇒ 问「怎么导出PDF报告」，
 *    它会编出「数据报告模块」这类**系统里不存在**的入口（实测），用户照着找不到；
 * ② 每次提问**无论模型答不答**都要付 ~3.9k prompt token（≈¥0.015）—— prompt 占单次成本 ~88%。
 * ⇒ 把「高频操作路径」固化成静态 FAQ：**零 token、零幻觉、路径可逐条对照源码核对**。
 *
 * ## 🔴 判据原则：宁可漏拦，不可误伤
 * - 漏拦 ⇒ 走 AI，多花 ¥0.015，无害；
 * - 误伤 ⇒ 把「帮我导出北京的报表」这类**真指令**当成操作问答拦下，用户操作失败 —— 后果严重得多。
 * 因此必须**同时**满足：①疑问形态 ②主题词（每组至少命中一个）③不含动作意图词/排除词。
 *
 * ## 为什么"导出报表"（无疑问词）故意不拦
 * 「导出报表」是名词短语（可拦），但「**导出上海的报表**」是**指令**（不能拦），
 * 二者字面几乎同形。⇒ 统一要求疑问形态，把边界划清楚；漏掉的问法走 AI 即可。
 */

/** 疑问形态：只有在「问方法」时才可能拦 */
const ASK_MARKERS = [
  '怎么', '怎样', '如何', '咋', '咋样',
  '在哪', '在哪里', '哪里', '哪儿',
  '教我', '告诉我', '求教', '什么步骤', '怎么弄', '怎么办', '怎样操作', '怎么操作'
]

/** 动作意图：出现即放行走 AI —— 用户在「下命令」，不是在「问方法」 */
const ACTION_MARKERS = [
  '帮我', '给我', '替我', '我要', '请帮', '麻烦',
  '直接', '马上', '立刻', '一键', '我现在', '我想把'
]

/**
 * FAQ 条目
 * `topic` 是「组」的数组：语义 = **每组至少命中一个词**（组间 AND，组内 OR）。
 * `exclude` 命中任意一个词即整条不匹配（交给 AI）。
 */
const FAQS = [
  {
    id: 'export-report',
    icon: '📥',
    title: '导出报表（PDF / Excel）',
    topic: [
      ['导出', '下载', '生成', '输出'],
      ['报表', '报告', 'pdf', 'excel']
    ],
    exclude: ['竞品'],
    steps: [
      '点击**右上角的用户名** → 在菜单里选「**📥 导出报表**」（全站任意页面都能打开）',
      '弹窗会列出你的**购买履历**记录 → **勾选**要导出的那几条（可多选）',
      '点「**📄 导出PDF**」（也可选「📊 导出Excel」或「导出Excel+PDF」）',
      '勾选 1 条＝直接下载该报表；勾选多条＝自动打包成 ZIP 下载'
    ],
    note: '导出的是「购买履历」里的记录；「我的门店」等页面另有各自的「导出」按钮。'
  },
  {
    id: 'add-store',
    icon: '📍',
    title: '添加门店',
    topic: [
      ['添加', '新增', '新建', '创建', '录入', '建立', '开店', '添加一'],
      ['门店', '店铺', '商铺', '店面', '店']
    ],
    exclude: ['竞品', '品牌', '购物中心', '商场'],
    steps: [
      '在地图页面**左下角**找到「**门店工具**」面板（默认收起，**先点面板标题展开**）',
      '点「**📍 添加门店**」，鼠标指针会变成十字',
      '**在地图上点一下**你要添加的位置',
      '弹出「添加门店」表单，填写门店信息后保存即可'
    ],
    note: '另外两个入口：① 在地图上**右键** →「添加门店」；② 顶部导航「**我的门店**」页 → 顶部的「**＋ 添加门店**」。'
  }
]

/** 归一化：小写 + 去掉空白（用户输入常夹杂空格） */
function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '')
}

/**
 * 匹配操作指引。
 * @param {string} text 用户输入
 * @param {{orgRole?: string}} [opts] 当前账号的组织身份（'owner' | 'member' | '' | null）
 * @returns {null | {id:string,icon:string,title:string,steps:string[],note:string}} 命中返回指引，否则 null
 */
export function matchFaq(text, opts = {}) {
  const t = normalize(text)
  if (!t) return null

  const isAsking = ASK_MARKERS.some(m => t.includes(m))
  if (!isAsking) return null

  if (ACTION_MARKERS.some(m => t.includes(m))) return null

  for (const faq of FAQS) {
    if (faq.exclude.some(w => t.includes(w.toLowerCase()))) continue
    const hitAll = faq.topic.every(group => group.some(w => t.includes(w.toLowerCase())))
    if (!hitAll) continue

    const note = faq.note || ''
    // 子公司成员（orgRole === 'member'）的门店由集团统一下发：
    // 照常给步骤（功能本身可用，不改变可达性），只在前面补一句提示，避免误导。
    if (faq.id === 'add-store' && opts.orgRole === 'member') {
      return {
        ...faq,
        note: '你的门店由集团统一下发，通常无需自行添加；确有需要时也可用上面的方式新增。' + note
      }
    }
    return { ...faq, note }
  }

  return null
}

/** 全部 FAQ（供快捷问句等场景使用） */
export function listFaqs() {
  return FAQS.map(f => ({ id: f.id, title: f.title, question: `怎么${f.title.replace(/（.*?）/, '')}？` }))
}
