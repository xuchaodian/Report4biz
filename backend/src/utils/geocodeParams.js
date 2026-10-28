/**
 * 搜索建议的坐标参数归一化（v1.13.287）
 *
 * 背景：高德/腾讯的「输入提示」都是**全国范围**的，默认按各自的相关度排序 ——
 * 实测在「寿司郎」上，无偏置的前 10 条是北京/武汉/深圳/宁波，**一条上海都没有**；
 * 传入 `location=当前地图中心` 后，前 6 条立刻变成上海各分店。
 * ⇒ 「优先当前城市」必须做在**查询阶段**（location 偏置），光在前端重排是无效的，
 *    因为结果集里根本没有本城市的店。
 *
 * 本函数只做一件事：把 query 里的 lng/lat 校验成可用坐标。
 * ⛔ 不做「缺省用某个城市」的兜底 —— 传不了就不偏置，别伪造坐标。
 */

/**
 * @param {unknown} lngRaw 经度（query string）
 * @param {unknown} latRaw 纬度（query string）
 * @returns {{lng:number, lat:number}|null} 合法返回坐标，否则 null
 */
export function normalizeLngLat(lngRaw, latRaw) {
  // 注意：Number('') === 0，所以空串必须显式挡掉，否则会被当成 (0,0)
  if (lngRaw === undefined || lngRaw === null || String(lngRaw).trim() === '') return null
  if (latRaw === undefined || latRaw === null || String(latRaw).trim() === '') return null
  const lng = Number(lngRaw)
  const lat = Number(latRaw)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null
  // (0,0) 是几内亚湾，业务上等价于「未定位」的脏数据
  if (lng === 0 && lat === 0) return null
  return { lng, lat }
}
