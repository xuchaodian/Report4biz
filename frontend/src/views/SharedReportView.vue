<template>
  <div class="sr-page">
    <header class="sr-top">
      <div class="sr-brand">
        <span class="sr-brand-mark">选址赢家</span>
        <span class="sr-brand-sub">Online</span>
      </div>
      <span v-if="snapshot" class="sr-tag">只读快照</span>
    </header>

    <!-- 加载中 -->
    <div v-if="loading" class="sr-center">
      <div class="sr-spin" aria-hidden="true"></div>
      <p>正在打开报告…</p>
    </div>

    <!-- 打不开：404 / 已撤销 / 已过期 / 网络异常 -->
    <div v-else-if="fail" class="sr-center sr-fail">
      <div v-if="fail.tag" class="sr-fail-code" aria-hidden="true">{{ fail.tag }}</div>
      <h1>{{ fail.title }}</h1>
      <p>{{ fail.desc }}</p>
      <p class="sr-fail-hint">如需查看，请联系把链接发给你的同事重新分享。</p>
    </div>

    <!-- 正常 -->
    <template v-else-if="snapshot">
      <div class="sr-note">
        <span class="sr-note-l">
          {{ share.authorName || '同事' }} 分享的选址立项报告
          <template v-if="share.title">· {{ share.title }}</template>
        </span>
        <span class="sr-note-r">
          内容快照于 {{ fmtTime(share.updatedAt || share.createdAt) }}
          · {{ share.expiresInDays }} 天后到期
        </span>
      </div>

      <!-- 源资料在本快照之后有更新：只提示，⛔ 不自动换内容（同事看到的必须是作者发出的那份） -->
      <div v-if="share.stale" class="sr-stale">
        发起人的原始资料在本快照之后有更新。如需最新数据，请联系发起人重新分享。
      </div>

      <div class="sr-scroll">
        <ReportPaper
          :model="snapshot"
          :map-img="mapImg"
          :ai-text="aiText"
          :author-name="share.authorName"
        />
      </div>
      <p class="sr-scroll-hint">屏幕较窄时可左右滑动查看完整版面</p>

      <footer class="sr-foot">
        <span>本页为只读快照，不可编辑。内容由「选址赢家Online」生成。</span>
        <span class="sr-foot-warn">含商业分析内容，请勿转发给无关人员。</span>
      </footer>
    </template>
  </div>
</template>

<script setup>
/**
 * 立项报告分享页（免登录，v1.13.392）
 *
 * 路由 `/s/:token`。业主定的交付形态：**链接 + 邮件发链接**（⛔ 不做 PDF 附件）。
 * 同事/领导在微信或邮件里点开就能看，不需要账号 —— 这正是"分享"的意义，
 * 所以这个页面**只有纸面内容 + 三行说明**，没有任何系统入口。
 *
 * 🔴🔴 四条不能破的约束
 *   ① **用裸 axios，⛔ 不用 utils/api.js**：那个实例的 401 拦截器会 `window.location.href='/login'`，
 *      匿名访客一旦被弹去登录页，就等于把内部系统的入口暴露给外部人，且链接直接失效。
 *   ② **内容只来自快照**（后端 report_shares.snapshot_json），⛔ 不现场重算：
 *      访客没有取数权限，也不该让他看到与作者发出时不同的数字。
 *   ③ **不显示任何账号信息**：user_id / 配额 / 手机号一律不出现（后端也没返回）。
 *   ④ **noindex**（路由 meta 已设）：页面含联通人口与商圈数据，绝不能被搜索引擎收录。
 *
 * ⚠️ 纸张固定 794px（A4 @96dpi），窄屏用横向滚动而不是缩放：
 *    缩放会让字号变成 8px 级别的"看起来有、其实读不了"，横滑至少是完整可读的版面。
 */
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import ReportPaper from '@/components/ReportPaper.vue'
import { formatUtcDateTime } from '@/utils/datetime.js'

const route = useRoute()

const loading = ref(true)
const fail = ref(null)
const share = ref({})
const snapshot = ref(null)
const mapImg = ref('')
const aiText = ref('')

function fmtTime(s) {
  if (!s) return '—'
  try {
    return formatUtcDateTime(s) || String(s).slice(0, 16)
  } catch {
    return String(s).slice(0, 16)
  }
}

/** 错误态文案：⛔ 不区分"不存在"与"你没权限"，避免猜测式探测 */
function setFail(status, code) {
  // ⚠️ `tag` 只在真正的 404 显示大号数字。撤销/过期**不显示大号灰字**：
  //    那是用户最常碰到的两种状态，屏幕上顶着一个巨型"已撤销"只会让人以为页面坏了。
  if (code === 'revoked') {
    fail.value = { tag: '', title: '这条分享已被发起人撤销', desc: '发起人可以随时收回分享，撤销后链接立即失效。' }
  } else if (code === 'expired') {
    fail.value = { tag: '', title: '这条分享链接已过期', desc: '分享链接有效期为 30 天，到期后自动失效。' }
  } else if (status === 404) {
    fail.value = { tag: '404', title: '链接不存在或已失效', desc: '请确认链接是否完整（末段那串字符不能缺）。' }
  } else {
    fail.value = { tag: '', title: '报告暂时打不开', desc: '可能是网络波动或服务繁忙，稍后刷新页面再试。' }
  }
}

onMounted(async () => {
  const token = String(route.params.token || '')
  if (!token) { setFail(404); loading.value = false; return }

  try {
    // 🔴 裸 axios：⛔ 不要换成 api.js（见文件头 ①）
    const { data } = await axios.get(`/api/report-shares/public/${encodeURIComponent(token)}`, { timeout: 20000 })
    if (!data?.snapshot) {
      setFail(500)
    } else {
      share.value = data.share || {}
      snapshot.value = data.snapshot
      mapImg.value = data.mapImg || ''
      aiText.value = data.aiText || ''
    }
  } catch (e) {
    setFail(e?.response?.status || 0, e?.response?.data?.code)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
/* 这一页刻意不套后台布局：没有左侧菜单、没有顶部导航、没有登录入口 */
/* 🔴🔴 页面根容器必须自己滚（v1.13.392 真机踩到）：
   stores 的全局样式是 `html, body, #app { height:100%; overflow:hidden }`
   （App.vue:23），那是给后台 SPA 布局用的。分享页不套 MainLayout，
   若只写 `min-height: 100vh`，内容会被 #app 的 overflow:hidden 直接裁掉 ——
   实测 document.scrollHeight 恒等于视口高度 577px，页面**滚不动**，
   报告底下 2/3 永远看不到（截图只拍到人口块就到底了）。
   ⇒ 根容器 `height:100vh + overflow-y:auto`，滚动发生在这里，与 375c 同一条铁律。 */
.sr-page {
  height: 100vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: #f2f3f5;
  padding: 0 0 28px;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #1f2329;
}

.sr-top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; background: #1f2329; color: #fff;
}
.sr-brand { display: flex; align-items: baseline; gap: 5px; }
.sr-brand-mark { font-size: 15px; font-weight: 600; letter-spacing: .02em; }
.sr-brand-sub { font-size: 11px; color: rgba(255, 255, 255, .62); letter-spacing: .12em; }
.sr-tag {
  font-size: 11px; padding: 2px 9px; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, .28); color: rgba(255, 255, 255, .82);
}

.sr-note {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  max-width: 794px; margin: 14px auto 0; padding: 0;
  font-size: 12.5px; color: #646a73;
}
.sr-note-l { font-weight: 500; color: #1f2329; }
.sr-note-r { color: #8a9099; }

.sr-stale {
  max-width: 794px; margin: 10px auto 0; padding: 9px 14px;
  background: #fff8e6; border: 1px solid #e8c07d; border-radius: 6px;
  font-size: 12.5px; line-height: 1.6; color: #7a5b1e;
}

/* 纸张 794px 固定：窄屏横滑，⛔ 不缩放（缩到 8px 字号等于不可读） */
.sr-scroll {
  margin: 14px 0 0; padding: 16px;
  overflow-x: auto;
}
.sr-scroll-hint {
  display: none; margin: 6px 0 0; text-align: center;
  font-size: 11.5px; color: #a0a5ad;
}
@media (max-width: 860px) {
  .sr-scroll { padding: 12px 8px; }
  .sr-scroll-hint { display: block; }
  .sr-note, .sr-foot, .sr-stale { margin-left: 10px; margin-right: 10px; }
}

.sr-foot {
  max-width: 794px; margin: 16px auto 0; padding: 0;
  display: flex; flex-direction: column; gap: 4px;
  font-size: 11.5px; line-height: 1.7; color: #a0a5ad;
}
.sr-foot-warn { color: #c98a1e; }

.sr-center {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 60vh; padding: 24px; text-align: center; color: #646a73;
}
.sr-center p { margin: 6px 0; font-size: 13px; line-height: 1.7; }

.sr-spin {
  width: 26px; height: 26px; margin-bottom: 10px;
  border: 2px solid #dcdfe6; border-top-color: #2563eb; border-radius: 50%;
  animation: sr-spin .8s linear infinite;
}
@keyframes sr-spin { to { transform: rotate(360deg); } }

.sr-fail-code {
  font-size: 34px; font-weight: 600; color: #c9ccd1; letter-spacing: .04em; margin-bottom: 6px;
}
.sr-fail h1 { margin: 0 0 8px; font-size: 17px; font-weight: 600; color: #1f2329; }
.sr-fail p { max-width: 420px; }
.sr-fail .sr-fail-hint { margin-top: 14px; font-size: 12px; color: #a0a5ad; }
</style>
