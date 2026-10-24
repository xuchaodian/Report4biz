/**
 * 场景引导完成率埋点（v1.13.264）
 * ---------------------------------------------------------------------------
 * 只回答一件事：**每个场景的第 i 步，有多少人真的走完了**。
 *
 * 🔴 四条铁律
 *   ① `trackStepDone()` **只能由「真实操作结果」调用** —— 它被 MapView 的
 *      `sceneDone` 置位 watcher 统一触发（商圈加载成功 / 人口分析出结果 / …）。
 *      ⛔ 绝不能挂在按钮 `@click` 上：点了但没跑出结果也算完成，漏斗就是假的。
 *   ② **fire-and-forget**：不 await、不弹错、不影响任何主流程。
 *      埋点挂了最多是丢几个数字，绝不能让用户看到红字或卡住。
 *   ③ **同一页面会话内同事件只报一次**（模块级 Set）；跨刷新靠服务端 24h 去重。
 *   ④ **只传行为坐标**（event / scene / step / index），⛔ 不传门店名、地址、评分等业务数据。
 *
 * ⭐ 「步骤 → 场景」的映射在这里统一算，调用方只传 stepKey。
 *    理由：MapView 里 10 处置位点分散，若每处都自己拼 scene 名，迟早有一处拼错；
 *    而 SCENES 配置是唯一权威（两场景的 step.key 不重叠，见 §6.72）。
 */
import axios from 'axios'
import { SCENES } from '@/utils/sceneGuides.js'

/** 同页面会话内已上报的 key，避免重复请求 */
const sent = new Set()

/** 找 step 属于哪个场景（两场景 key 不重叠 ⇒ 唯一） */
function resolveStep(stepKey) {
  for (const s of SCENES) {
    const i = s.steps.findIndex(st => st.key === stepKey)
    if (i >= 0) return { scene: s.key, step: stepKey, index: i }
  }
  return { scene: '', step: stepKey, index: null }
}

function send(event, scene = '', step = '', index = null) {
  const key = `${event}|${scene}|${step}`
  if (sent.has(key)) return
  sent.add(key)
  try {
    axios.post('/api/scene-events', { event, scene, step, step_index: index }, { timeout: 8000 })
      .catch(() => { sent.delete(key) })   // 失败允许下次再试（不重试、不提示）
  } catch (e) {
    sent.delete(key)
  }
}

/** 打开引导面板（入口有没有被看见） */
export function trackGuideOpen() {
  send('guide_open')
}

/** 选了某个场景（分母：谁对这类活儿感兴趣） */
export function trackSceneStart(sceneKey) {
  if (!sceneKey) return
  send('scene_start', sceneKey)
}

/** 某场景全部步骤完成 */
export function trackSceneFinish(sceneKey) {
  if (!sceneKey) return
  send('scene_finish', sceneKey)
}

/**
 * 某一步真实完成。**只能**由 MapView 的 sceneDone 置位处触发。
 * @param {string} stepKey 与 sceneGuides.js 配置里的 step.key 一致
 */
export function trackStepDone(stepKey) {
  if (!stepKey) return
  const r = resolveStep(stepKey)
  if (!r.scene) return          // 配置里没有的 key（未来新增忘了登记）⇒ 不报
  send('step_done', r.scene, r.step, r.index)
}
