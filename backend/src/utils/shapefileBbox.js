/**
 * 人口网格文件的 bbox 预筛（v1.13.308）
 *
 * 为什么需要：
 *   calculate-population 不传 shapefileId 时要取该 category 下**全部**文件。
 *   现网 26 个人口文件 = 313MB / 32.8 万要素，逐个 getGeoObject 解析 ⇒ 单档约 4 秒，
 *   而一次分析通常只跟 1~2 个城市相交（人民广场 5km 圈只有上海）。
 *   有了 bbox 就能在 SQL 里先筛掉不相交的城市。
 *
 * 🔴 这里单独成一个模块，是因为**参数顺序**和**NULL 语义**都极易写错，
 *   且错了不会报错、只会静默少算一块人口。集中到一处才能被单测钉住。
 */

/**
 * 相交条件：文件 bbox 与查询 bbox 有重叠。
 *
 * 🔴 `minx IS NULL OR ...` 这一段不能省：
 *   历史数据没有 bbox（本批之前的 26 个文件全部为空）、空文件也算不出 bbox。
 *   若只写 `NOT (minx > ? OR ...)`，NULL 参与比较会得到 NULL（既非真也非假），
 *   这些文件会被**静默跳过**，总人口凭空少一块且没有任何报错。
 *   ⇒ 语义是「拿不准就算相交」，宁可多解析一个文件，不能少算人口。
 *
 * 占位符顺序见 bboxParams()。
 */
export const BBOX_INTERSECT_SQL = `(minx IS NULL OR miny IS NULL OR maxx IS NULL OR maxy IS NULL
                 OR NOT (minx > ? OR maxx < ? OR miny > ? OR maxy < ?))`

/**
 * 把 turf.bbox() 的结果 [minLng, minLat, maxLng, maxLat]
 * 摊成 SQL 占位符顺序 [maxLng, minLng, maxLat, minLat]。
 *
 * ⚠️ 顺序为什么是反的：条件是「文件 minx > 查询 maxLng ⇒ 不相交」，
 *   所以第 1 个 ? 是查询的**最大经度**，第 2 个是**最小经度**。
 *   写反了不会报错，只会把相邻城市错误地排除掉（或反过来全量解析）。
 *
 * @param {number[]} bbox [minLng, minLat, maxLng, maxLat]
 * @returns {number[]} [maxLng, minLng, maxLat, minLat]
 */
export function bboxParams(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    throw new Error('bboxParams 需要 [minLng, minLat, maxLng, maxLat]')
  }
  return [bbox[2], bbox[0], bbox[3], bbox[1]]
}

/** JS 侧同口径判断（供脚本 / 测试与 SQL 对照，避免两套语义漂移） */
export function bboxIntersects(a, b) {
  if (!a || !b) return true            // 任一侧缺失 ⇒ 视为可能相交（同 SQL 的 NULL 语义）
  return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1])
}
