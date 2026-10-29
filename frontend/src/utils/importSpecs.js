/**
 * 导入字段单一来源（v1.13.292）
 *
 * 背景：这些字段原来散在四处各写一遍 ——
 *   ① `/data` 导入门店弹窗里一段 `<li>` 清单；
 *   ② `/data` 下载门店模板函数里一个逗号串；
 *   ③ 后端 `routes/markers.js` 的 `row.xxx` 取值；
 *   ④ 后端 `routes/store-sales.js` 的 Excel 表头取值。
 * 本文件 + `components/ImportGuideDialog.vue` 收口成一份，体检页与销售预测页都引用它，
 * 让「客户该填哪几个字段、填了能解锁什么」只有一处说法。
 *
 * 🔴 守卫 `backend/tests/importSpecsGuard.test.js` 会把本文件与后端**真正读取**的列做集合比对：
 *    这里多一个（客户填了没人用）、少一个（客户没机会填）都会红。
 *    ⇒ 改后端导入逻辑必须同步改这里，反之亦然。
 *
 * ⚠️ 本模块**必须保持零依赖**（不 import vue / axios / 任何 util）：
 *    守卫测试会在 Node 里直接 import 它，一引浏览器 API 就跑不起来。
 *    需要浏览器能力的下载函数放在 `utils/importTemplates.js`。
 */

/** 引擎门槛 —— 与后端 sales-forecast 的 L2/L3 判据同口径（守卫钉住） */
export const ENGINE_THRESHOLDS = {
  l2: 50,      // L2 回归启用门槛：门店×年样本行数
  l3: 150,     // L3 机器学习启用门槛：同上（数的是「行」不是门店）
  l3Stores: 5  // L3 分组交叉验证要求的最少门店数（forecast_server.py 的 uniq >= 5）
}

/**
 * 门店台账（CSV 导入 `/api/markers/import`）
 * key = CSV 列名，必须与后端 `row.<key>` 完全一致
 */
export const STORE_IMPORT_FIELDS = [
  { key: 'name', label: '门店名称', required: true, note: '没有名称的行会被整行跳过' },
  { key: 'latitude', label: '纬度', required: true, note: '体检的所有间距计算都依赖它；缺了这家店不参与任何几何判断' },
  { key: 'longitude', label: '经度', required: true, note: '同上；经纬度可先用「地址解析」从地址批量补' },
  { key: 'store_code', label: '门店编号', required: false, note: '与销售数据匹配的首选键；同品牌内应唯一，否则导入销售时要改用名称' },
  { key: 'brand', label: '品牌', required: false, note: '门店清洗与间距比较只在同品牌内进行；缺品牌则无法判断同业贴邻' },
  { key: 'store_type', label: '门店类型', required: false, note: '已开业 / 重点候选 / 一般候选；销售预测只对候选店出预测，参照店取已开业' },
  { key: 'city', label: '城市', required: false, note: '留空会按坐标就近补（city_source 记为 geocode）' },
  { key: 'district', label: '区县', required: false, note: '用于城市内的片区筛选' },
  { key: 'address', label: '地址', required: false, note: '体检复核清单里靠它人工确认「是不是同一个地址」' },
  { key: 'store_area', label: '门店面积（㎡）', required: false, note: '🔴 缺面积 ⇒ 判不了店型（大店/小店），体检面积分档不计它，销售预测也少一个特征' },
  { key: 'store_category', label: '门店区分', required: false, note: '🔴 是**选址形态**（社区店/临街店/商场店/写字楼店/交通枢纽店/校园店/景区店/专业市场店），⛔ 不是菜系业态；缺它销售预测仍能算，只是参照店的「类型匹配」少一个加分项' },
  { key: 'store_status', label: '门店状态', required: false, note: '正常 / 闭店 / 停业' },
  { key: 'open_date', label: '开店日期', required: false, note: '用于「开满一年才算成熟店」这类筛选' },
  { key: 'business_hours', label: '营业时间', required: false, note: '如 07:00-22:00' },
  { key: 'seats', label: '座位数', required: false, note: '堂食产能参考' },
  { key: 'frontage', label: '门幅（m）', required: false, note: '临街展示面宽度' },
  { key: 'mall_type', label: '商场类型', required: false, note: '购物中心 / 街铺 / 交通枢纽等' },
  { key: 'trade_area_type', label: '商圈类型', required: false, note: '办公 / 居住 / 混合等' },
  { key: 'description', label: '备注说明', required: false, note: '自由文本' },
  // 这一列后端认，但刻意不进模板：客户基本用不上，进模板只会让人困惑
  { key: 'icon_color', label: '图标颜色', required: false, inTemplate: false, note: '不填默认 #409eff' }
]

/**
 * 销售记录（Excel 导入 `/api/store-sales/import`）
 * key = Excel 表头，必须与后端 `r['<表头>']` 完全一致（中文表头）
 */
export const SALES_IMPORT_FIELDS = [
  { key: '门店编号', label: '门店编号', required: false, note: '优先按编号匹配；与「门店名称」至少填一个' },
  { key: '门店名称', label: '门店名称', required: false, note: '编号匹配不到时才用名称兜底；重名会报错，需补编号' },
  { key: '年份', label: '年份', required: true, note: '自然年（2000–2100）；同店同年重复导入会覆盖旧值' },
  { key: '年销售额(万元)', label: '年销售额（万元）', required: false, note: '与「销售档位」二选一，需 > 0' },
  { key: '销售档位', label: '销售档位', required: false, note: '不想暴露精确营业额时只填区间；填了档位就忽略「年销售额」' },
  { key: '面积(㎡)', label: '面积（㎡）', required: false, note: '留空则取门店台账里的面积' },
  { key: '外卖占比(%)', label: '外卖占比（%）', required: false, note: '0–100；留空按缺失处理，会影响有效坪效口径' },
  { key: '备注', label: '备注', required: false, note: '自由文本' }
]

/** 生成 CSV 模板时要写出的列（`inTemplate === false` 的列剔除） */
export function templateKeys(fields) {
  return fields.filter(f => f.inTemplate !== false).map(f => f.key)
}

/**
 * 门店导入模板（含两行示例）。
 * ⚠️ 示例行的值必须能通过后端校验：name / latitude / longitude 都不能空。
 */
export function buildStoreTemplateCsv() {
  const header = templateKeys(STORE_IMPORT_FIELDS)
  const sample = [
    {
      store_code: 'BJ001', brand: '星巴克', name: '星巴克国贸店', store_type: '已开业',
      city: '北京市', district: '朝阳区', address: '国贸大厦一层', open_date: '2023-01-15',
      business_hours: '07:00-22:00', store_area: 200, seats: 80, frontage: '',
      store_category: '直营', store_status: '正常', mall_type: '', trade_area_type: '',
      latitude: 39.9088, longitude: 116.4610, description: 'CBD核心区'
    },
    {
      store_code: 'BJ002', brand: '星巴克', name: '星巴克望京候选', store_type: '重点候选',
      city: '北京市', district: '朝阳区', address: '', open_date: '',
      business_hours: '', store_area: '', seats: '', frontage: '',
      store_category: '加盟', store_status: '正常', mall_type: '', trade_area_type: '',
      latitude: 39.9965, longitude: 116.4710, description: '重点跟进'
    }
  ]
  const lines = [header.join(',')]
  for (const row of sample) {
    lines.push(header.map(k => {
      const v = row[k]
      if (v === undefined || v === null) return ''
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(','))
  }
  return lines.join('\n')
}

/** 销售导入模板的表头（后端 /api/store-sales/template 生成的就是这一行，守卫钉住） */
export function salesTemplateHeaders() {
  return SALES_IMPORT_FIELDS.map(f => f.key)
}

/**
 * 「补哪几个字段能解锁什么」—— 体检页完备度表直接引用这段，
 * ⛔ 不要在各个页面里各写一份不同的说法。
 */
export const UNLOCK_HINTS = {
  sales: `录满 ${ENGINE_THRESHOLDS.l2} 行门店×年样本 ⇒ 销售预测启用 L2 回归；` +
    `满 ${ENGINE_THRESHOLDS.l3} 行且覆盖 ≥${ENGINE_THRESHOLDS.l3Stores} 家门店 ⇒ 可启用 L3 机器学习`,
  category: '补齐门店区分（选址形态）⇒ 销售预测的参照店「类型匹配」多一个加分项，同城/同商圈匹配更贴近；不填也能出预测',
  area: '补齐营业面积 ⇒ 才能区分大店/小店（双店型判定的关键线索），销售预测多一个特征',
  coord: '补齐经纬度 ⇒ 门店才进入间距计算；成批地址可用「地址解析」一次性补'
}
