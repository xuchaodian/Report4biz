/**
 * 场景引导配置（v1.13.256）
 *
 * 定位：**任务级引导**，不是说明书。
 *   - 与 `components/guide/OnboardingGuide.vue`（数据准备向导）互补：那个负责「把数据灌进来」，
 *     数据就绪后永久不再出现；这里负责「数据齐了之后，一次完整分析怎么做」。
 *   - 与 `/help/` 用户手册互补：手册按 UI 分区索引（"4.2 左侧面板：商圈工具"），
 *     这里按业务任务索引（"我要在浦东找 3 个点位"）。
 *
 * 🔴 两个铁律：
 *   1. 每个 step 的 `action` 必须对应 MapView 里**真实存在**的方法，且该方法自带成功提示；
 *      ⛔ 不要为引导新写业务逻辑 —— 引导只负责「把人送到正确的入口」。
 *   2. 完成状态必须由**真实结果**置位（见 MapView 的 `sceneDone`），
 *      ⛔ 绝不能以「点过按钮」为完成依据，否则引导变成自欺。
 *
 * 🔴 维护提示：改了 MapView 的置位行号请同步本文件注释；
 *    中文文案硬编码（业主明确只需中文，暂不走 i18n）；若日后要日文，把 title/desc/how 抽成 key 即可。
 */

export const SCENE_NETWORK_PLAN = 'network-plan'

export const SCENES = [
  {
    key: SCENE_NETWORK_PLAN,
    title: '网点规划',
    summary: '在一个城市里，筛出值得开的点位',
    duration: '约 10 分钟',
    steps: [
      {
        key: 'cityArea',
        title: '圈定候选范围',
        why: '先把要看的片区圈出来，后面的分析才有边界。',
        how: '打开「城市商圈」，选城市和商圈面。可以多选。',
        actionLabel: '打开城市商圈',
        action: 'cityArea'
      },
      {
        key: 'population',
        title: '看人口密度',
        why: '人口密度决定客流上限。同样租金，选人多的片区。',
        how: '打开「常住人口分布」，在地图上点圆心、设半径，看热力分档。',
        actionLabel: '看常住人口分布',
        action: 'population'
      },
      {
        key: 'competition',
        title: '叠竞品，找空白',
        why: '「无我的门店 + 有竞品」＝ 有需求但你没覆盖，这是最值得看的片区。',
        how: '打开「网点优化 → 周边竞争强度」，按半径算出四类门店。',
        actionLabel: '打开周边竞争强度',
        action: 'competition'
      },
      {
        key: 'potential',
        title: '算开店余地',
        why: '按人口、竞争、配套、交通四个维度筛出符合你条件的网格。',
        how: '打开「开店余地」，填城市和筛选条件，跑一次分析。',
        actionLabel: '打开开店余地',
        action: 'potential',
        vip: true
      },
      {
        key: 'overlap',
        title: '查自我蚕食',
        why: '候选点若和自家门店商圈高度重合，开出来等于自己抢自己。',
        how: '打开「网点优化 → 自家相互蚕食」，看重叠率高的点位。',
        actionLabel: '打开自家重叠度',
        action: 'overlap'
      }
    ]
  }
]

export const getScene = (key) => SCENES.find(s => s.key === key) || null

/** 场景里 VIP 专属步骤的数量（用于入口提前告知，避免走到第 4 步才被门禁拦） */
export const countVipSteps = (scene) =>
  (scene?.steps || []).filter(s => s.vip).length
