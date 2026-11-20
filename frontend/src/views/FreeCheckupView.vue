<template>
  <div class="fc-page">
    <!-- 顶栏：与官网调性一致，免登录可见 -->
    <header class="fc-top">
      <a class="fc-brand" href="https://www.mka-online.cn/" aria-label="返回选址赢家官网">
        <span class="fc-brand-mark">选</span>
        <span>选址赢家 Online</span>
      </a>
      <nav class="fc-nav" aria-label="账户导航">
        <a href="https://mka-online.cn/login">登录</a>
        <a class="fc-nav-reg" href="https://mka-online.cn/register">免费注册</a>
      </nav>
    </header>

    <main class="fc-main">
      <div class="fc-hero">
        <h1>同品牌蚕食预警 · 免费门店体检</h1>
        <p class="fc-lead">
          在地图上点出你的门店位置，即时看到哪些门店贴得太近、可能自己抢自己。
          <b>免登录、不上传、不花钱</b>——坐标只在你浏览器本地计算，不离开这台设备。
        </p>
      </div>

      <div class="fc-layout">
        <!-- 左：地图点选 -->
        <section class="fc-map-card" aria-label="门店地图">
          <div class="fc-map-bar">
            <span class="fc-map-title">点击地图添加门店</span>
            <span class="fc-count">已标记 <b>{{ points.length }}</b> / {{ MAX_POINTS }}</span>
          </div>
          <div ref="mapRef" class="fc-map"></div>
          <div class="fc-map-actions">
            <button type="button" class="fc-btn" @click="undo" :disabled="!points.length">撤销上一个</button>
            <button type="button" class="fc-btn" @click="clearAll" :disabled="!points.length">清空</button>
            <span class="fc-tip">提示：点击地图任意位置放下门店图钉</span>
          </div>
        </section>

        <!-- 右：结论 -->
        <section class="fc-result" aria-label="体检结果">
          <div v-if="!result.total" class="fc-empty">
            <div class="fc-empty-ic">◎</div>
            <p>还没有门店</p>
            <span>在左侧地图上点几下，标记你要体检的门店位置</span>
          </div>

          <template v-else>
            <div class="fc-result-bar">
              <span class="fc-result-title">体检结果</span>
              <button type="button" class="fc-export" :disabled="exporting" @click="exportPdf">
                {{ exporting ? '生成中…' : '导出可分享 PDF' }}
              </button>
            </div>
            <div class="fc-kpis">
              <div class="fc-kpi">
                <div class="fc-kpi-lab">已标记门店</div>
                <div class="fc-kpi-num">{{ result.total }}<em>家</em></div>
              </div>
              <div class="fc-kpi">
                <div class="fc-kpi-lab">贴邻对 ≤300m</div>
                <div class="fc-kpi-num n-amber">{{ result.nearPairs.length }}<em>对</em></div>
              </div>
              <div class="fc-kpi">
                <div class="fc-kpi-lab">同址 &lt;50m</div>
                <div class="fc-kpi-num n-red">{{ result.sameAddrPairs.length }}<em>对</em></div>
              </div>
            </div>

            <div class="fc-verdict" :class="verdictClass">
              <b>{{ verdictTitle }}</b>
              <p>{{ verdictText }}</p>
            </div>

            <div v-if="result.nearPairs.length" class="fc-block">
              <h2 class="fc-h2">贴邻门店清单</h2>
              <p class="fc-h2sub">按距离由近到远，只列直线距离 ≤300m 的对</p>
              <ul class="fc-pairs">
                <li v-for="(p, i) in result.nearPairs" :key="i" class="fc-pair">
                  <span class="fc-pair-no">{{ i + 1 }}</span>
                  <div class="fc-pair-body">
                    <div class="fc-pair-dist">
                      {{ formatDist(p.distance) }}
                      <span class="fc-tag" :class="'fc-tag-' + p.bucket">{{ bucketLabel(p.bucket) }}</span>
                    </div>
                    <div class="fc-pair-note">
                      <template v-if="p.sameAddr">
                        同址——<b>先别当重复合并</b>。请到系统里核对编码与面积，确认是否为大店+小店两种店型。
                      </template>
                      <template v-else>
                        贴邻——是否真的互相蚕食，需要面积与销售数据进一步确认。
                      </template>
                    </div>
                  </div>
                </li>
              </ul>
            </div>

            <div class="fc-block fc-boundary">
              <h2 class="fc-h2">免费看到这里，深入判断需要完整数据</h2>
              <p>
                免费体检只用门店坐标，能告诉你<b>“哪里贴得近”</b>；但要回答
                <b>“是不是误报、是不是双店型、到底抢走多少生意”</b>，需要门店编码、面积和销售记录。
              </p>
              <a class="fc-cta" href="https://mka-online.cn/register">
                免费注册，导入完整台账 →
              </a>
              <p class="fc-fine">注册后可一键得到双店型识别、蚕食归因、竞品密度等完整结论。免费层不消耗任何付费额度。</p>
            </div>
          </template>
        </section>
      </div>

      <footer class="fc-foot">
        距离为门店坐标的球面直线距离（Haversine），仅作初步筛查；距离近不等于一定蚕食，商场内外、楼层、动线都会影响。
        你的门店坐标只在本地浏览器参与计算，本页不上传、不存储、不共享任何位置数据。
      </footer>
    </main>

    <!--
      可分享报告纸张：⛔ 不显示在主界面，仅导出时临时移入视口供 html2canvas 截图。
      报告只写「相对距离 + 分档」，⛔ 不含精确经纬度/地址，分享出去也不泄露门店位置。
      `.bf-sec / .bf-foot` 是 utils/exportPaperPdf.js 的安全切页锚点，⛔ 不要改名。
    -->
    <div v-if="result.total" class="fc-report-stage" aria-hidden="true">
      <div ref="paperRef" class="fc-paper bf-paper">
        <div class="fc-rp-head bf-sec">
          <div class="fc-rp-kicker">选址赢家Online · 同品牌蚕食免费体检</div>
          <h1>门店贴邻预警报告</h1>
          <div class="fc-rp-meta">
            <span>生成日期 {{ reportDate }}</span>
            <span>标记门店 {{ result.total }} 家</span>
            <span>免费体检 · 本地生成</span>
          </div>
        </div>

        <div class="fc-rp-kpis bf-sec">
          <div class="fc-rp-kpi"><b>{{ result.total }}</b><span>标记门店</span></div>
          <div class="fc-rp-kpi"><b>{{ result.nearPairs.length }}</b><span>贴邻对 ≤300m</span></div>
          <div class="fc-rp-kpi"><b>{{ result.sameAddrPairs.length }}</b><span>同址对 &lt;50m</span></div>
        </div>

        <div class="fc-rp-verdict bf-sec">
          <h2>{{ verdictTitle }}</h2>
          <p>{{ verdictText }}</p>
        </div>

        <div v-if="result.nearPairs.length" class="fc-rp-list bf-sec">
          <h2>贴邻门店清单</h2>
          <p class="fc-rp-note">按直线距离由近到远，只列 ≤300m 的对；编号对应地图上的图钉顺序。</p>
          <table class="fc-rp-table">
            <thead><tr><th>序号</th><th>距离</th><th>分档</th><th>说明</th></tr></thead>
            <tbody>
              <tr v-for="(p, i) in result.nearPairs" :key="i">
                <td>{{ i + 1 }}</td>
                <td>{{ formatDist(p.distance) }}</td>
                <td>{{ bucketLabel(p.bucket) }}</td>
                <td>{{ p.sameAddr ? '同址，需核对编码与面积' : '贴邻，需结合店型与销售判断' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="fc-rp-bound bf-sec">
          <h2>免费看到这里，深入判断需要完整数据</h2>
          <p>
            本报告只用坐标回答「哪里贴得近」；要回答「是不是误报、是不是双店型、到底抢走多少生意」，
            需要门店编码、面积和销售记录。
          </p>
        </div>

        <div class="fc-rp-cta bf-sec">
          <div class="fc-rp-url">mka-online.cn/free-checkup</div>
          <p>打开上面的地址，免费测你自己的门店；注册后导入完整台账，可得双店型识别、蚕食归因、竞品密度等完整结论。</p>
        </div>

        <div class="fc-rp-foot bf-foot">
          <p>
            隐私声明：本报告在你的浏览器本地生成，⛔ 未上传、⛔ 未存储、⛔ 未共享任何坐标数据；
            报告内不含精确经纬度与门店地址。距离为球面直线距离（Haversine），仅作初步筛查；
            距离近不等于一定蚕食，商场内外、楼层、动线都会影响。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { buildFreeCheckup } from '@/utils/freeCheckupGeo.js'
import { exportPaperPdf, fileStamp } from '@/utils/exportPaperPdf.js'

const MAX_POINTS = 20
const mapRef = ref(null)
const paperRef = ref(null)
const points = ref([])
const exporting = ref(false)
let map = null
let markers = L.layerGroup()
let seq = 0

const result = computed(() => buildFreeCheckup(points.value))
const reportDate = computed(() => new Date().toLocaleDateString('zh-CN'))

const verdictClass = computed(() => {
  if (!result.value.sameAddrPairs.length && !result.value.nearPairs.length) return 'v-ok'
  if (result.value.sameAddrPairs.length) return 'v-warn'
  return 'v-watch'
})
const verdictTitle = computed(() => {
  if (!result.value.sameAddrPairs.length && !result.value.nearPairs.length) return '暂未发现贴邻门店'
  if (result.value.sameAddrPairs.length) return '发现同址门店，请重点核对'
  return '发现贴邻门店，建议复核'
})
const verdictText = computed(() => {
  const r = result.value
  if (!r.nearPairs.length) return '当前标记的门店之间都超过 300m。继续添加更多门店，或换一个区域试试。'
  if (r.sameAddrPairs.length) {
    return `有 ${r.sameAddrPairs.length} 对门店距离小于 50m。它们可能是「大店+小店」两种店型开在同一商场（真实门店，不能合并），也可能是重复录入——仅凭坐标无法区分，请到系统里补编码与面积后确认。`
  }
  return `有 ${r.nearPairs.length} 对门店距离在 50–300m。贴身不等于蚕食，需结合面积、店型与销售数据判断。`
})

function onMapClick(e) {
  if (points.value.length >= MAX_POINTS) return
  const p = { id: ++seq, lat: e.latlng.lat, lng: e.latlng.lng }
  points.value = [...points.value, p]
  redrawMarkers()
}

function redrawMarkers() {
  if (!map) return
  markers.clearLayers()
  points.value.forEach((p, i) => {
    const icon = L.divIcon({
      className: 'fc-pin-wrap',
      html: `<span class="fc-pin"><i>${i + 1}</i></span>`,
      iconSize: [26, 34],
      iconAnchor: [13, 34]
    })
    L.marker([p.lat, p.lng], { icon }).addTo(markers)
  })
}

function undo() {
  if (!points.value.length) return
  points.value = points.value.slice(0, -1)
  redrawMarkers()
}
function clearAll() {
  points.value = []
  redrawMarkers()
}

/**
 * 导出可分享 PDF（v1.13.387 获客 P0）
 * ⛔ 纯前端：html2canvas + jsPDF 都在浏览器里跑，不发任何请求、不烧配额、坐标不上传。
 * 纸张平时藏在视口外（html2canvas 对视口外元素会截成空白），导出前临时挪进视口，
 * 截图后原样还原——不能改成 display:none，html2canvas 截不到。
 */
async function exportPdf() {
  if (exporting.value || !result.value.total || !paperRef.value) return
  exporting.value = true
  const paper = paperRef.value
  const prev = {
    position: paper.style.position,
    left: paper.style.left,
    top: paper.style.top,
    zIndex: paper.style.zIndex
  }
  paper.style.position = 'fixed'
  paper.style.left = '0'
  paper.style.top = '0'
  paper.style.zIndex = '-1'
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  try {
    await exportPaperPdf(paper, `同品牌蚕食体检_${fileStamp()}.pdf`)
  } finally {
    paper.style.position = prev.position
    paper.style.left = prev.left
    paper.style.top = prev.top
    paper.style.zIndex = prev.zIndex
    exporting.value = false
  }
}

function formatDist(d) {
  return d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(2)} km`
}
const BUCKET_LABELS = { same: '同址', close: '贴身', overlap: '部分重叠', weak: '弱重叠', alone: '基本独立' }
function bucketLabel(key) {
  return BUCKET_LABELS[key] || key
}

onMounted(() => {
  map = L.map(mapRef.value, { center: [31.2304, 121.4737], zoom: 11, zoomControl: true })
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
    subdomains: [1, 2, 3, 4],
    maxZoom: 18,
    attribution: '&copy; 高德地图'
  }).addTo(map)
  markers.addTo(map)
  map.on('click', onMapClick)
})
onBeforeUnmount(() => {
  if (map) { map.off('click', onMapClick); map.remove(); map = null }
})
</script>

<style scoped>
.fc-page{height:100%;overflow-y:auto;min-height:100vh;background:#f5f7fa;color:#303133;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.fc-top{height:56px;background:#fff;border-bottom:1px solid #e4e7ed;display:flex;align-items:center;justify-content:space-between;padding:0 24px}
.fc-brand{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:600;color:#303133;text-decoration:none}
.fc-brand-mark{width:26px;height:26px;border-radius:6px;background:#2563eb;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:14px}
.fc-nav{display:flex;align-items:center;gap:18px}
.fc-nav a{color:var(--text-regular);text-decoration:none;font-size:13px}
.fc-nav-reg{background:#2563eb;color:#fff!important;padding:6px 14px;border-radius:6px}
.fc-main{max-width:1280px;margin:0 auto;padding:28px 24px 48px}
.fc-hero{text-align:center;margin:8px 0 26px}
.fc-hero h1{font-size:26px;margin:0 0 10px;color:#1a1a1a}
.fc-lead{max-width:760px;margin:0 auto;color:var(--text-regular);font-size:14px}
.fc-lead b{color:#2563eb}
.fc-layout{display:grid;grid-template-columns:1.15fr 1fr;gap:18px;align-items:start}
.fc-map-card{background:#fff;border:1px solid #e4e7ed;border-radius:10px;overflow:hidden}
.fc-map-bar{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #eef0f3}
.fc-map-title{font-weight:600}
.fc-count{font-size:12px;color:var(--text-secondary)}
.fc-count b{color:#2563eb}
.fc-map{height:520px;width:100%}
.fc-map-actions{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid #eef0f3}
.fc-btn{border:1px solid #dcdfe6;background:#fff;color:var(--text-regular);border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer}
.fc-btn:hover:not(:disabled){border-color:#2563eb;color:#2563eb}
.fc-btn:disabled{opacity:.5;cursor:not-allowed}
.fc-btn:focus-visible,.fc-cta:focus-visible,.fc-nav a:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.fc-tip{margin-left:auto;font-size:12px;color:#c0c4cc}
.fc-result{background:#fff;border:1px solid #e4e7ed;border-radius:10px;padding:18px 20px;min-height:520px}
.fc-empty{height:480px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-secondary);text-align:center}
.fc-empty-ic{font-size:52px;color:#dcdfe6;line-height:1}
.fc-empty p{font-size:15px;color:var(--text-regular);margin:12px 0 4px}
.fc-empty span{font-size:12px}
.fc-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.fc-kpi{background:#fafbfc;border:1px solid #eef0f3;border-radius:8px;padding:12px}
.fc-kpi-lab{font-size:12px;color:var(--text-secondary);margin-bottom:4px}
.fc-kpi-num{font-size:24px;font-weight:600;line-height:1.1}
.fc-kpi-num em{font-size:12px;font-weight:400;font-style:normal;color:var(--text-secondary);margin-left:3px}
.n-amber{color:#e6a23c}.n-red{color:#f56c6c}
.fc-result-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.fc-result-title{font-weight:600}
.fc-export{border:1px solid var(--el-color-primary);background:#fff;color:var(--el-color-primary);border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer}
.fc-export:hover:not(:disabled){background:var(--el-color-primary-light-9)}
.fc-export:disabled{opacity:.5;cursor:not-allowed}
.fc-export:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}
.fc-verdict{border-radius:8px;padding:12px 14px;margin-bottom:18px;font-size:13px}
.fc-verdict b{font-size:14px}
.fc-verdict p{margin:5px 0 0;color:var(--text-regular)}
.v-ok{background:#f0f9eb;border:1px solid #e1f3d8}
.v-ok b{color:#529b2e}
.v-warn{background:#fef0f0;border:1px solid #fde2e2}
.v-warn b{color:#c45656}
.v-watch{background:#fdf6ec;border:1px solid #faecd8}
.v-watch b{color:#b88230}
.fc-block{margin-bottom:20px}
.fc-h2{font-size:14px;margin:0 0 3px;display:flex;align-items:center;gap:8px}
.fc-h2::before{content:"";width:3px;height:13px;background:#2563eb;border-radius:2px}
.fc-h2sub{font-size:12px;color:var(--text-secondary);margin:0 0 12px 11px}
.fc-pairs{list-style:none;margin:0;padding:0;max-height:230px;overflow-y:auto}
.fc-pair{display:flex;gap:10px;padding:10px 0;border-bottom:1px dashed #eef0f3}
.fc-pair:last-child{border-bottom:none}
.fc-pair-no{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:#f4f4f5;color:var(--text-secondary);font-size:12px;display:inline-flex;align-items:center;justify-content:center}
.fc-pair-dist{font-weight:600;color:#303133}
.fc-pair-note{font-size:12px;color:var(--text-secondary);margin-top:3px}
.fc-pair-note b{color:#c45656}
.fc-tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:4px;margin-left:8px;font-weight:400}
.fc-tag-same{background:#fef0f0;color:#c45656;border:1px solid #fde2e2}
.fc-tag-close{background:#fdf6ec;color:#b88230;border:1px solid #faecd8}
.fc-boundary{background:var(--el-color-primary-light-9);border:1px solid var(--el-color-primary-light-8);border-radius:8px;padding:14px 16px}
.fc-boundary p{font-size:13px;color:var(--text-regular);margin:0 0 12px}
.fc-boundary p b{color:#303133}
.fc-cta{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:9px 18px;border-radius:6px;font-size:13px}
.fc-cta:hover{background:#1d4ed8}
.fc-fine{font-size:11px!important;color:#a8abb2!important;margin:10px 0 0!important}
.fc-foot{max-width:900px;margin:24px auto 0;text-align:center;font-size:12px;color:#a8abb2;line-height:1.8}
@media(max-width:960px){.fc-layout{grid-template-columns:1fr}.fc-map{height:400px}.fc-hero h1{font-size:21px}}
</style>

<style scoped>
/* 可分享报告纸张：平时藏在视口外，导出前由 exportPdf() 临时挪进视口。
   ⛔ 不要改成 display:none / v-show —— html2canvas 对不可见元素截出空白。 */
.fc-report-stage{position:absolute;left:-10000px;top:0;width:794px;pointer-events:none}
.fc-paper{width:794px;margin:0;background:#fff;padding:26px 34px 20px;color:#1f2329;font:13px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.fc-rp-head{border-bottom:2px solid var(--el-color-primary);padding-bottom:12px;margin-bottom:16px}
.fc-rp-kicker{font-size:11px;color:var(--el-color-primary);letter-spacing:.5px}
.fc-rp-head h1{font-size:22px;margin:6px 0 8px;color:#1f2329}
.fc-rp-meta{display:flex;gap:18px;font-size:11px;color:#8a9099}
.fc-rp-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.fc-rp-kpi{border:1px solid #e8ebf0;border-radius:8px;padding:12px;text-align:center;background:#f8fafc}
.fc-rp-kpi b{display:block;font-size:26px;line-height:1.2;color:var(--el-color-primary)}
.fc-rp-kpi span{font-size:11px;color:#8a9099}
.fc-rp-verdict{background:var(--el-color-primary-light-9);border:1px solid var(--el-color-primary-light-8);border-radius:8px;padding:13px 16px}
.fc-rp-verdict h2{font-size:15px;margin:0 0 6px}
.fc-rp-verdict p{font-size:12px;margin:0;color:#1f2329}
.fc-rp-list h2,.fc-rp-bound h2{font-size:14px;margin:0 0 6px}
.fc-rp-note{font-size:11px;color:#8a9099;margin:0 0 8px}
.fc-rp-table{width:100%;border-collapse:collapse;font-size:11px}
.fc-rp-table th,.fc-rp-table td{border:1px solid #e8ebf0;padding:6px 8px;text-align:left}
.fc-rp-table th{background:#f8fafc;font-weight:600}
.fc-rp-bound{border-top:1px solid #e8ebf0;padding-top:12px}
.fc-rp-bound p{font-size:12px;margin:0}
.fc-rp-cta{background:var(--el-color-primary-light-9);border-radius:8px;padding:12px 16px;text-align:center}
.fc-rp-url{font-size:19px;font-weight:600;color:var(--el-color-primary);letter-spacing:.3px}
.fc-rp-cta p{font-size:11px;color:#1f2329;margin:6px 0 0}
.fc-rp-foot{border-top:1px solid #e8ebf0;padding-top:9px;margin-top:14px}
.fc-rp-foot p{font-size:10px;line-height:1.6;color:#8a9099;margin:0}
</style>

<style>
/* 全局：Leaflet 图钉（scoped 下 divIcon 的 innerHTML 不受 scoped 样式作用） */
.fc-pin-wrap{background:transparent;border:none}
.fc-pin{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2563eb;box-shadow:0 2px 6px rgba(0,0,0,.25)}
.fc-pin i{font-style:normal;transform:rotate(45deg);color:#fff;font-size:12px;font-weight:600}
</style>
