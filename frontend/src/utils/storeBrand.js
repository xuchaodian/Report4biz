/**
 * 门店品牌 → 业态 —— **单一来源**（v1.13.329）
 *
 * ── 为什么抽出来 ────────────────────────────────────────────────────────────
 * 这段「映射表 + 提取函数」原先在 `views/MyAccountView.vue`（购买履历详情弹窗）
 * 和 `components/StoreSmartstepsDialog.vue`（地图门店详情弹窗）**各写了一份**，
 * 两份当时一致但属于重复定义 ⇒ 改一处另一处就漂移。
 * 现已全部改为引用本模块，⛔ 不要再在组件里内联这两段。
 *
 * ── 业务口径（业主 2026-11-07 确认）─────────────────────────────────────────
 * AI 选址建议按**门店品牌**识别业态，**⛔ 不读用户账户的公司名**。
 * 原因：同一家公司可能经营多个完全不同业态的品牌
 * （例：食其家＝日式牛肉盖饭，滨寿司＝回转寿司，同属泉膳集团但业态不同）。
 * 用公司名会把它们混成一类，建议就废了。
 *
 * ── 两张网的配合（v1.13.329 起）────────────────────────────────────────────
 * ① 白名单（本文件的 BRAND_CATEGORY_MAP）：命中即得精确业态 —— 最可靠；
 * ② 用户确认（见 `utils/storeBrandPrompt.js`）：未命中时**在调模型之前**问用户一句，
 *    而不是把「未知」丢给大模型猜。猜错的代价是整段建议跑偏，且照样扣 Token。
 *
 * ⚠️ 不能拿 `store_category`（门店区分）当业态用 —— 那是**选址形态**
 *    （社区店/临街店/商场店…），与菜系业态是两回事。
 *
 * 🔴 本模块**必须保持零依赖**（除 node 内置外的任何 import 都不要加）：
 *    守卫测试会在 Node 里直接 import 它跑边界用例（同 `importSpecs.js` 的做法）。
 *    需要弹框的部分放 `utils/storeBrandPrompt.js`。
 */

/** 常见餐饮/零售品牌 → 业态。命中则给模型确定的业态，不命中走「用户确认」。 */
export const BRAND_CATEGORY_MAP = {
  '食其家': '日式牛肉盖饭快餐',
  '吉野家': '日式快餐（牛肉饭/丼饭）',
  '松屋': '日式快餐（牛肉饭）',
  '老乡鸡': '中式快餐（以鸡肉为主的炖菜快餐）',
  '大米先生': '中式快餐（现炒小碗菜）',
  '米村拌饭': '韩式拌饭快餐',
  '西塔老太太': '韩式烤肉（正餐）',
  '谷田稻香': '中式快餐（瓦锅饭）',
  '杨国福': '麻辣烫快餐',
  '张亮麻辣烫': '麻辣烫快餐',
  '海底捞': '火锅正餐',
  '呷哺呷哺': '小火锅快餐',
  '肯德基': '西式快餐（炸鸡汉堡）',
  '麦当劳': '西式快餐（汉堡）',
  '汉堡王': '西式快餐（汉堡）',
  '必胜客': '西式休闲餐饮（披萨）',
  '瑞幸咖啡': '咖啡饮品（快取式）',
  '星巴克': '咖啡饮品（第三空间）',
  '蜜雪冰城': '平价茶饮',
  '喜茶': '新式茶饮',
  '奈雪的茶': '新式茶饮',
  '茶百道': '新式茶饮',
  '沪上阿姨': '新式茶饮',
  '书亦烧仙草': '新式茶饮',
  '霸王茶姬': '新中式茶饮',
  '古茗': '新式茶饮',
  '屈臣氏': '个人护理零售',
  '名创优品': '生活百货零售',
  '优衣库': '快时尚服饰零售',
  '7-11': '便利店',
  '罗森': '便利店',
  '全家': '便利店',
  '永辉超市': '生鲜超市',
  '盒马鲜生': '生鲜超市（新零售）'
}

/** 未命中时的地理后缀，用于把「滨寿司上海五角场」剥成「滨寿司」 */
const GEO_SUFFIX_RE = /(步行街|购物中心|地铁站|广场|中心|大厦|商场|商厦|大道|路|街|城|汇|坊|店)$/

/**
 * 从门店名提取品牌。
 *
 * @param {string} storeName 门店名，如「食其家(上海五角场店)」「滨寿司上海五角场店」
 * @param {string} [city]    城市（可选）。**只用于剥离地名**，不参与业态判断。
 * @returns {string}
 *
 * ⚠️ 第 ④ 步为什么要判断「城市名出现在第 2 个字之后（i > 0）」：
 *    「南京大牌档」这类**品牌名本身以城市名开头**的，直接截断会被截成空
 *    （city=南京、index=0）。i > 0 才截，能同时兼容「滨寿司上海…」和「南京大牌档」。
 */
export function extractBrand(storeName, city = '') {
  if (!storeName) return ''
  const raw = String(storeName).trim()

  // ① 去括号内容：「食其家(上海五角场店)」→「食其家」
  let name = raw.replace(/[（(][^）)]*[）)]/g, '').trim()
  // ② 去结尾的「店 / N号店 / -N店」
  name = name.replace(/[-—–]?\d+号?店$/, '').replace(/店$/, '').trim()

  // ③ 白名单最长优先匹配（清理后的名字与原始名都比一次，避免括号把品牌名一起吃掉）
  const keys = Object.keys(BRAND_CATEGORY_MAP).sort((a, b) => b.length - a.length)
  const hit = keys.find((k) => name.includes(k) || raw.includes(k))
  if (hit) return hit

  // ④ 未命中：用城市名剥掉后面的地名（「滨寿司上海五角场」+ 上海 → 「滨寿司」）
  let guess = name
  const c = String(city || '').replace(/市$/, '').trim()
  if (c) {
    const i = guess.indexOf(c)
    if (i > 0) guess = guess.slice(0, i).trim()
  }
  // ⑤ 再尝试去掉常见地理后缀
  const trimmed = guess.replace(GEO_SUFFIX_RE, '').trim()
  if (trimmed.length >= 2) guess = trimmed

  // 兜底：实在剥不出来就返回清理后的名字（下一步会让用户确认业态，不会静默传脏值给模型）
  return (guess.length >= 2 ? guess : name) || raw
}

/**
 * 解析门店的品牌与业态。
 *
 * @returns {{ brand: string, category: string, mapped: boolean }}
 *   `mapped=false` 表示白名单没命中，调用方应先用 `promptCategoryIfUnmapped()` 问用户，
 *   用户填了再用其填写的业态调用 AI；用户取消则**不要**调用 AI。
 */
export function resolveBrandCategory(storeName, city = '') {
  const brand = extractBrand(storeName, city)
  const category = BRAND_CATEGORY_MAP[brand] || ''
  return { brand, category, mapped: !!category }
}
