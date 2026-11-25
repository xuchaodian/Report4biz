/**
 * 417 守卫：已购半径档位的「角色判定」（近场动线 / 步行客群 / 片区基本盘）
 *
 * 业主口径（2026-11-25）：
 *   小半径看动态到访，1km 以上看静态居民与画像；但**明确否掉写死 500m/1km**。
 * ⇒ 判据 = 档位相对位置（最小档/最大档/中间档）+ 到访强度校验。
 *
 * 本测试钉住三件事：
 *   ① 不写死半径：同样 300m，在 2 档场景里是动线档、在 5 档场景里也是，但判据文字随数据变；
 *   ② 最小档"到访强度不占优"时必须降级成 near，⛔ 不许硬说它是动线档；
 *   ③ 可比性说明必须出现（绝对值随半径膨胀，只有密度/职住比/到访强度能横向比）。
 */
import { describe, it, expect } from 'vitest'
import { assignTierRoles, tierCompareNote, TIER_ROLES } from '../../frontend/src/utils/tierRoles.js'

const row = (radius, live, work, visit) => ({
  radius,
  radiusText: radius >= 1000 ? `${radius / 1000}km` : `${radius}m`,
  live,
  work,
  visit,
  density: live !== null ? Math.round((live / ((Math.PI * radius * radius) / 1e6)) * 10) / 10 : null
})

describe('角色判定：档位数形态', () => {
  it('单档 ⇒ single（无对比）', () => {
    const rows = assignTierRoles([row(1000, 8600, 5400, 21500)])
    expect(rows[0].role).toBe('single')
    expect(rows[0].roleLabel).toBe(TIER_ROLES.single.label)
    expect(rows[0].roleBasis).toContain('仅买过')
  })

  it('两档 ⇒ 最小档 flow、最大档 static', () => {
    const rows = assignTierRoles([row(500, 1200, 400, 9000), row(3000, 56000, 35000, 142000)])
    expect(rows.map((r) => r.role)).toEqual(['flow', 'static'])
  })

  it('🔴 五档：片区侧从「密度峰值档」开始 ⇒ 1km 就是static（业主口径：1km 以上看静态）', () => {
    // 密度：500m 1527.9 / 1km 2737.5(峰值) / 1.5km 2546.5 / 2km 2387.3 / 3km 1980.6
    const rows = assignTierRoles([
      row(500, 1200, 400, 9000),
      row(1000, 8600, 5400, 21500),
      row(1500, 18000, 12000, 40000),
      row(2000, 30000, 20000, 70000),
      row(3000, 56000, 35000, 142000)
    ])
    expect(rows.map((r) => r.role)).toEqual(['flow', 'static', 'static', 'static', 'static'])
    // 峰值档的判据要说清"为什么从这一档起算片区"
    expect(rows[1].roleBasis).toContain('为各档最高')
    // 峰值之后的档，判据对比的是峰值档而不是上一档
    expect(rows[2].roleBasis).toContain('较密度峰值档')
  })

  it('密度一路下降（最小档即峰值）⇒ 从第 2 档起就是片区侧', () => {
    const rows = assignTierRoles([
      row(300, 4000, 1200, 30000),
      row(1200, 9000, 5000, 24000),
      row(3000, 20000, 12000, 40000)
    ])
    expect(rows[1].role).toBe('static')
  })

  it('🔴 最小档到访强度不是各档最高 ⇒ 降级 near，不硬说它是动线档', () => {
    // 500m 到访强度 1.0（900/900），1000m 是 5.0（5000/1000）⇒ 最小档不占优
    const rows = assignTierRoles([row(500, 900, 300, 900), row(1000, 1000, 600, 5000)])
    expect(rows[0].role).toBe('near')
    expect(rows[0].roleLabel).toBe(TIER_ROLES.near.label)
    expect(rows[0].roleBasis).toContain('排第 2')
  })

  it('判据文字里带的是实际半径，不是写死的阈值', () => {
    const a = assignTierRoles([row(300, 800, 200, 6000), row(1200, 9000, 5000, 24000)])
    const b = assignTierRoles([row(2000, 30000, 20000, 70000), row(5000, 90000, 60000, 240000)])
    expect(a[0].roleBasis).toContain('300m')
    expect(b[0].roleBasis).toContain('2km')
    // 依据文字随实际半径变 ⇒ 证明没有"小于 X 米才算"的硬阈值
    expect(a[0].role).toBe('flow')
    expect(a[0].roleBasis).not.toBe(b[0].roleBasis)
    // b 组里 5km 档的到访强度反而更高 ⇒ 最小档必须降级 near，而不是硬判 flow
    expect(b[0].role).toBe('near')
  })

  it('最大档的判据带与上一档的密度对比', () => {
    const rows = assignTierRoles([row(500, 1200, 400, 9000), row(3000, 56000, 35000, 142000)])
    expect(rows[1].roleBasis).toContain('密度')
    expect(rows[1].roleBasis).toMatch(/为各档最高|较密度峰值档|较上一档/)
  })

  it('空数组 / 非数组不炸', () => {
    expect(assignTierRoles([])).toEqual([])
    expect(assignTierRoles(null)).toEqual([])
  })

  it('缺到访/居住数据时不编造强度', () => {
    const rows = assignTierRoles([row(500, null, null, null), row(1000, 8600, 5400, 21500)])
    expect(rows[0].visitIntensity).toBe(null)
    expect(rows[0].roleBasis).toContain('无法验证')
  })
})

describe('对比表可比性说明', () => {
  it('≥2 档必须给说明，且点明"绝对值不可跨档直比"', () => {
    const rows = assignTierRoles([row(500, 1200, 400, 9000), row(3000, 56000, 35000, 142000)])
    const note = tierCompareNote(rows)
    expect(note).toContain('不可直接跨档比较')
    expect(note).toContain('人口密度')
    expect(note).toContain('职住比')
    expect(note).toContain('到访强度')
    expect(note).toContain('近场动线档')
  })

  it('单档没有可比性说明', () => {
    expect(tierCompareNote(assignTierRoles([row(1000, 8600, 5400, 21500)]))).toBe('')
  })
})
