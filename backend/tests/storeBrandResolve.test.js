/**
 * 门店品牌 → 业态 的解析守卫 —— v1.13.329
 *
 * 起因（业主 2026-11-07）：
 *   「购买履历详情弹窗里的『AI 选址建议』是识别门店品牌，还是用户账户里的公司名？
 *     比如食其家与滨寿司虽然是同一家公司，但分属两个完全不同业态的餐饮」
 *
 * 结论：**按门店品牌识别，⛔ 不读公司名**。本文件把这条口径和两个已知缺陷的修复钉住：
 *   ① 品牌白名单只有 34 个品牌，「滨寿司」不在其中 ⇒ 原先业态直接写"未知"交给模型猜；
 *   ② 门店名没有括号时品牌会带地名后缀（「滨寿司上海五角场店」→「滨寿司上海五角场」）。
 *
 * 本文件分两类：
 *   【运行时】直接 import `frontend/src/utils/storeBrand.js`（该模块刻意零依赖）跑边界用例；
 *   【源码】钉住两个弹窗都走同一份实现、未映射时必须先问用户再调 AI、请求体必须带用户填的业态。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRAND_CATEGORY_MAP, extractBrand, resolveBrandCategory } from '../../frontend/src/utils/storeBrand.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const ACCOUNT = read('frontend/src/views/MyAccountView.vue')
const STORE_DLG = read('frontend/src/components/StoreSmartstepsDialog.vue')

describe('A. 品牌提取（运行时：真实函数，不是复制逻辑）', () => {
  it('品牌白名单里的写法都能命中（括号/无括号/带编号）', () => {
    const cases = [
      ['食其家(上海五角场店)', '食其家'],
      ['食其家上海五角场店', '食其家'],
      ['食其家-001号店', '食其家'],
      ['星巴克(上海南京西路店)', '星巴克'],
      ['7-11便利店', '7-11'],
      ['全家便利店', '全家'],
      ['海底捞火锅(人民广场店)', '海底捞'],
    ]
    for (const [store, want] of cases) {
      expect(extractBrand(store, '上海'), `${store} 应提取为 ${want}`).toBe(want)
    }
  })

  it('最长优先：西塔老太太泥炉烤肉店 → 西塔老太太（⛔ 不能截成短品牌）', () => {
    expect(extractBrand('西塔老太太泥炉烤肉店', '沈阳')).toBe('西塔老太太')
  })

  it('🔴 未收录品牌 + 有城市名 ⇒ 剥掉地名（这是本批要修的核心缺陷）', () => {
    // 修复前：「滨寿司上海五角场」
    expect(extractBrand('滨寿司上海五角场店', '上海')).toBe('滨寿司')
    expect(extractBrand('滨寿司(上海五角场店)', '上海')).toBe('滨寿司')
  })

  it('🔴 品牌名本身以城市名开头时⛔不得被截断（南京大牌档）', () => {
    // 若用「只要包含城市名就截断」，这条会被截成空串
    expect(extractBrand('南京大牌档', '南京')).toBe('南京大牌档')
    expect(extractBrand('南京大牌档(南京德基店)', '南京')).toBe('南京大牌档')
  })

  it('同公司不同业态必须拿到不同结果（业主举的例子）', () => {
    const a = resolveBrandCategory('食其家(上海五角场店)', '上海')
    const b = resolveBrandCategory('滨寿司(上海五角场店)', '上海')
    expect(a.mapped).toBe(true)
    expect(a.category).toBe('日式牛肉盖饭快餐')
    expect(b.mapped, '滨寿司不在白名单 ⇒ 必须标记为未映射，交由用户确认').toBe(false)
    expect(b.category).toBe('')
    expect(a.brand).not.toBe(b.brand)
  })

  it('空门店名不得抛错（返回空串、未映射）', () => {
    const r = resolveBrandCategory('', '上海')
    expect(r.brand).toBe('')
    expect(r.mapped).toBe(false)
  })

  it('白名单非空且「食其家」必须是日式快餐类（防止误改成别的业态）', () => {
    expect(Object.keys(BRAND_CATEGORY_MAP).length).toBeGreaterThan(20)
    expect(BRAND_CATEGORY_MAP['食其家']).toContain('日式')
  })
})

describe('A2. 白名单扩表守卫（v1.13.330：34 → 117 个品牌）', () => {
  /** 业主 2026-11-08 给的候选清单 —— 这批必须全部命中，漏一个就说明 key 写法退化了 */
  const BATCH_20261108 = [
    '肯德基（中国）', '麦当劳（中国）', '必胜客（中国）', '华莱士', '达美乐比萨（中国）', '萨莉亚（中国）',
    '王品牛排', '豪客来牛排', '蜜雪冰城', '瑞幸咖啡', '星巴克（中国）', '古茗', '沪上阿姨', '茶百道',
    '霸王茶姬', '喜茶', '奈雪的茶', '茶颜悦色', 'CoCo 都可', '库迪咖啡', '幸运咖', '老乡鸡', '乡村基',
    '大米先生', '塔斯汀', '袁记云饺', '米村拌饭', '南城香', '超意兴・把子肉', '和府捞面', '遇见小面',
    '阿香米线', '蒙自源', '味千拉面', '李先生牛肉面', '喜家德虾仁水饺', '吉祥馄饨', '巴比', '三津汤包',
    '紫燕百味鸡', '绝味鸭脖', '周黑鸭', '正新鸡排', '张亮麻辣烫', '杨国福麻辣烫', '永和大王', '尊宝比萨',
    '小菜园', '西贝', '新荣记', '绿茶餐厅', '外婆家', '南京大排档', '广州酒家', '陶陶居酒家', '点都德',
    '廣順興', '客语', '费大厨辣椒炒肉', '徐记海鲜', '兰湘子・湘菜小炒', '全聚德', '紫光园', '大董',
    '云海肴', '外婆味道', '同庆楼', '西安饭庄', '眉州东坡', '醉得意', '甬府', '茄子恰恰', '农耕记',
    '海底捞', '呷哺呷哺', '巴奴毛肚火锅', '小龙坎火锅', '季季红火锅', '珮姐重庆火锅', '黄记煌三汁焖锅',
    '七欣天', '朱光玉火锅馆', '熊喵来了火锅', '许府牛', '太二酸菜鱼', '鱼你在一起', '半天妖烤鱼',
    '探鱼烤鱼', '烤匠麻辣烤鱼', '鱼酷活鱼烤鱼', '蛙来哒', '胖哥俩肉蟹煲', '很久以前羊肉串', '木屋烧烤',
    '西塔老太太泥炉烤肉', 'Helens 海伦司', '豪德亨牛排自助餐厅'
  ]

  it('候选清单里的品牌全部命中（门店名原样 + 去掉括号内容两种写法都要过）', () => {
    const missed = []
    for (const name of BATCH_20261108) {
      const bare = name.replace(/[（(][^）)]*[）)]/g, '').trim()
      if (!resolveBrandCategory(name).mapped && !resolveBrandCategory(bare).mapped) missed.push(name)
    }
    expect(missed, `这些品牌没命中白名单（漏 ⇒ 每家门店铺都要问用户一次业态）：${missed.join('、')}`)
      .toEqual([])
  })

  it('🔴 不同业态的 key ⛔ 不得互为子串（否则短 key 会抢走长品牌的业态）', () => {
    const keys = Object.keys(BRAND_CATEGORY_MAP)
    const conflicts = []
    for (const a of keys) {
      for (const b of keys) {
        if (a === b) continue
        if (b.toLowerCase().includes(a.toLowerCase()) && BRAND_CATEGORY_MAP[a] !== BRAND_CATEGORY_MAP[b]) {
          conflicts.push(`「${a}」⊂「${b}」(${BRAND_CATEGORY_MAP[a]} vs ${BRAND_CATEGORY_MAP[b]})`)
        }
      }
    }
    expect(conflicts, `子串冲突会被「最长优先」掩盖，一旦长 key 被删就串味：\n${conflicts.join('\n')}`)
      .toEqual([])
  })

  it('key 长度必须 ≥ 2（单字 key 会命中一大片无关门店）', () => {
    expect(Object.keys(BRAND_CATEGORY_MAP).filter((k) => k.length < 2)).toEqual([])
  })

  it('英文品牌大小写无关（Helens / HELENS / helens 都算命中）', () => {
    for (const n of ['Helens(上海静安店)', 'HELENS 海伦司', 'helens']) {
      expect(resolveBrandCategory(n).mapped, `${n} 应命中（大小写不该影响结果）`).toBe(true)
    }
  })

  it('业态文案不为空、不超过 30 字（前端直接展示，超长会撑破弹窗）', () => {
    for (const [k, v] of Object.entries(BRAND_CATEGORY_MAP)) {
      expect(typeof v, `${k} 的业态必须是字符串`).toBe('string')
      expect(v.trim().length, `${k} 的业态为空`).toBeGreaterThan(0)
      expect(v.length, `${k} 的业态太长`).toBeLessThanOrEqual(30)
    }
  })

  it('品牌主体名做 key：「XX火锅 / XX烤鱼」缩写也要能命中', () => {
    const cases = [
      ['巴奴(北京三里屯店)', '巴奴'],
      ['小龙坎(成都春熙路店)', '小龙坎'],
      ['太二(上海南京西路店)', '太二'],
      ['探鱼(深圳福田店)', '探鱼'],
      ['很久以前(杭州湖滨店)', '很久以前'],
      ['CoCo都可(南京西路店)', 'CoCo都可']
    ]
    for (const [store, want] of cases) {
      expect(extractBrand(store, ''), `${store} 应提取为 ${want}`).toBe(want)
    }
  })
})

describe('B. 单一来源：两个弹窗都必须引用 utils/storeBrand.js', () => {
  for (const [name, src] of [['MyAccountView.vue', ACCOUNT], ['StoreSmartstepsDialog.vue', STORE_DLG]]) {
    it(`${name} 引用统一模块`, () => {
      expect(src).toContain("from '@/utils/storeBrand.js'")
      expect(src).toContain("from '@/utils/storeBrandPrompt.js'")
    })

    it(`${name} ⛔ 不得再内联映射表或提取函数（改回去就会与另一处漂移）`, () => {
      expect(src, '又出现了内联的 BRAND_CATEGORY_MAP').not.toMatch(/const BRAND_CATEGORY_MAP\s*=\s*\{/)
      expect(src, '又出现了内联的 extractBrand').not.toMatch(/function extractBrand\s*\(/)
    })
  }
})

describe('C. 未映射时必须「先问用户、再调 AI」', () => {
  for (const [name, src] of [['MyAccountView.vue', ACCOUNT], ['StoreSmartstepsDialog.vue', STORE_DLG]]) {
    it(`${name} 有未映射分支且取消时不继续`, () => {
      expect(src).toContain('if (!mapped)')
      expect(src).toContain('await promptCategoryIfUnmapped(brand)')
      expect(src, '用户取消后必须中止（否则会拿空业态去调 AI = 让模型猜）')
        .toMatch(/if \(!finalCategory\) return/)
    })

    it(`${name} 🔴 确认必须在 aiAdviceLoading = true 之前（否则按钮一直转圈）`, () => {
      const iConfirm = src.indexOf('await promptCategoryIfUnmapped(brand)')
      const iLoading = src.indexOf('aiAdviceLoading.value = true')
      expect(iConfirm).toBeGreaterThan(-1)
      expect(iLoading).toBeGreaterThan(-1)
      expect(iConfirm, '确认弹框排在 loading 之后 ⇒ 弹框期间按钮会一直转圈').toBeLessThan(iLoading)
    })

    it(`${name} 🔴 请求体必须传用户确认后的业态（传回原 category 等于白问）`, () => {
      expect(src).toMatch(/category:\s*finalCategory/)
      expect(src, '请求体又传回了未经确认的 category')
        .not.toMatch(/body:\s*JSON\.stringify\(\{[^}]*category,\s*city/)
    })
  }
})

describe('D. 业态确认弹框（storeBrandPrompt.js）', () => {
  const promptRaw = read('frontend/src/utils/storeBrandPrompt.js')
  // 🔴 扫源码必须先剥注释 —— 否则注释里写「不写 localStorage」会被判成"用了 localStorage"
  const prompt = promptRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('取消/关闭返回空串（调用方据此中止，不消耗 AI 额度）', () => {
    expect(prompt).toMatch(/catch[\s\S]{0,80}return ''/)
  })

  it('有长度校验（避免一个字或超长文本污染 prompt）', () => {
    expect(prompt).toContain('至少 2 个字')
    expect(prompt).toContain('30 个字以内')
  })

  it('⛔ 不落盘记业态（陈旧值比空值更危险）', () => {
    expect(prompt).not.toContain('localStorage')
  })
})
