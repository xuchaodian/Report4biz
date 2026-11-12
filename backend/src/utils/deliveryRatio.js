/**
 * 品牌 → 默认外卖占比（%）。
 *
 * 🔴 v1.13.357：本表原先内嵌在 `routes/sales-forecast.js` 里，与前端
 *    `frontend/src/utils/storeBrand.js` 构成**两份逐字相同的副本** ⇒ 改一处必漏一处。
 *    现两侧各抽到自己的 utils 单文件，并由 `tests/storeSimGuard.test.js` **逐字断言两侧一致**。
 *    ⛔ 新增/修改品牌时，必须**同时**改：
 *      · frontend/src/utils/storeBrand.js  → DELIVERY_RATIO_MAP
 *      · backend/src/utils/deliveryRatio.js → DELIVERY_RATIO_MAP
 *    只改一侧 ⇒ 守卫判红（这是刻意的，不是麻烦）。
 *
 * ⚠️ 表里**只有占比，没有兜底值** —— 兜底是调用点的语义：
 *    · 训练特征（buildTrainingSet / buildXForRef / L2/L3 候选）用 `?? 35`：
 *      特征不能缺，缺了整行样本不可用，必须给个中位数兜底；
 *    · 前端录入预填用 `?? null`：留空让用户自己填，不替用户臆断。
 *    两者语义不同是对的，⛔ 别为了「统一」把兜底值塞进本表。
 */
export const DELIVERY_RATIO_MAP = {
  '霸王茶姬': 65, '茶百道': 65, '蜜雪冰城': 70, '瑞幸咖啡': 60, '库迪咖啡': 60,
  '肯德基': 45, '麦当劳': 45, '华莱士': 55, '正新鸡排': 70,
  '食其家': 40, '吉野家': 40, '老乡鸡': 35, '大米先生': 45, '米村拌饭': 35, '谷田稻香': 45, '杨国福': 50, '张亮麻辣烫': 50,
  '西塔老太太': 15, '海底捞': 15, '呷哺呷哺': 20, '外婆家': 10, '绿茶餐厅': 10
}

/** 训练特征缺失时的兜底外卖占比（%）。集中在此，⛔ 别在各调用点写裸 35。 */
export const DELIVERY_RATIO_FALLBACK = 35
