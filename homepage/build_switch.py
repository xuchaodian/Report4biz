#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
连锁品牌开关店分析看板构建器（静态站 /switch-analysis/）

真源 switch_data.json（聚合统计：品牌级门店数/开关店，来自用户提供的 demo 数据）
→ 生成三语独立页 switch-analysis/index.html、en/switch-analysis/index.html、
   ja/switch-analysis/index.html。

设计铁律：
- 🔴 数据来源隐去：页面文案不得出现「大众点评」「点评ID」「点评」字样（用户 2026-11-21 拍板）。
  只写「基于门店位置快照、以唯一门店 ID 跨期匹配」的中性口径。
- 🔴 品牌名/城市名保留中文原文（数据是中文的，不进 i18n）；只做 UI 文案三语。
- 🔴 ECharts 用本地 /assets/echarts.min.js（UMD），⛔ 不用 jsdelivr CDN（境内不稳+guard 会拦）。
- 🔴 官网主色 #1e6fff；红涨绿跌（净增红/净减绿）符合中文直觉。
- 🔴 页尾转化 CTA → 主域免费体检页（免登录）。
- 幂等：每次全量覆盖三份 index.html，不叠加。

🔴 nginx 落点（必配 ^~ + alias）：www 的 location / 末尾有 return 301 弹回主域 SPA，
   /switch-analysis/ 必须加独立 location ^~ /switch-analysis/ { alias .../switch-analysis/; }
   否则被 301 弹回主域登录墙（与 cases/insights 同一坑）。

构建顺序：换 switch_data.json → 跑本脚本 → scp 三份页面 + echarts.min.js 到 www。
"""
import os, json, html

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_JSON = os.path.join(HERE, "switch_data.json")
ROOT = "https://www.mka-online.cn"
FREE_CHECKUP = "https://mka-online.cn/free-checkup"

# 三语 UI 文案（数据本身不翻译）
UI = {
    "zh": {
        "lang": "zh-CN", "title": "连锁品牌开关店分析 · 选址赢家Online",
        "desc": "184 个连锁品牌、6 期门店快照的开关店与净增趋势，选址决策的市场大盘参考。",
        "brand": "选址赢家Online", "home": "返回官网", "checkup": "免费门店体检", "register": "免费注册",
        "h1": "连锁品牌开关店分析", "tag": "6期 · 15个月",
        "sub": "数据区间 2025/03 – 2026/06 · 184 个连锁品牌 · 基于门店位置快照，以唯一门店 ID 跨期匹配",
        "kpi_total": "期末门店总数", "kpi_brand": "覆盖品牌", "kpi_new": "累计新开", "kpi_closed": "累计关闭",
        "kpi_brand_sub": "全国连锁品牌", "kpi_new_sub": "含中途重开", "kpi_closed_sub": "快照未出现",
        "trend": "品牌门店数趋势", "trend_tag": "在上方勾选品牌，默认展示净增前 8", "pick": "选择品牌（默认净增Top8）",
        "search": "搜索品牌…", "top8": "净增Top8", "clear": "清空", "ok": "确定", "reset": "重置",
        "no_match": "无匹配品牌", "flow": "全市场逐期新开 / 关闭", "total": "门店总量变化",
        "rank": "品牌净增 Top 15", "city": "城市门店数 Top 15", "table": "品牌明细表", "sort_tag": "点击表头排序",
        "c_brand": "品牌", "c_net": "净增", "c_new": "新开", "c_closed": "关闭", "c_reopen": "重开",
        "note": "口径说明：门店在某期快照中未出现即记为「关闭」，可能包含少量临时未采集；「重开」指中途消失后又出现的门店。关闭/新开数字因中途进出而偏大，<b>净增</b>更能反映真实扩张。",
        "cta_h": "市场在洗牌，你的门店呢？",
        "cta_p": "看到品牌大盘的开关店，不如看看自己的门店有没有被同品牌贴邻蚕食。「免费门店体检」免登录、不上传数据，地图点选当场出结果。",
        "cta_btn": "免费门店体检（免登录） →", "foot1": "本页为市场聚合统计，仅供选址决策参考，不构成投资建议。数据截至 2026/06。",
        "foot2": "数据来源说明：基于门店位置快照聚合，不涉及个体经营数据。",
    },
    "en": {
        "lang": "en", "title": "Chain Brand Store Openings & Closures · SiteWinner",
        "desc": "Opening, closing and net-growth trends across 184 chain brands over 6 snapshots — a market benchmark for site decisions.",
        "brand": "SiteWinner", "home": "Home", "checkup": "Free Store Checkup", "register": "Sign Up Free",
        "h1": "Chain Brand Store Openings & Closures", "tag": "6 waves · 15 months",
        "sub": "Coverage 2025/03 – 2026/06 · 184 chain brands · matched across snapshots by unique store ID",
        "kpi_total": "Stores at latest wave", "kpi_brand": "Brands covered", "kpi_new": "Cumulative openings", "kpi_closed": "Cumulative closures",
        "kpi_brand_sub": "nationwide chains", "kpi_new_sub": "incl. reopenings", "kpi_closed_sub": "absent in snapshot",
        "trend": "Store Count by Brand", "trend_tag": "Select brands above; top 8 by net growth by default", "pick": "Select brands (Top 8 by net)",
        "search": "Search brands…", "top8": "Top 8 net", "clear": "Clear", "ok": "Apply", "reset": "Reset",
        "no_match": "No matching brand", "flow": "Market-wide Openings / Closures", "total": "Total Store Count",
        "rank": "Top 15 by Net Growth", "city": "Top 15 Cities by Store Count", "table": "Brand Details", "sort_tag": "Click a header to sort",
        "c_brand": "Brand", "c_net": "Net", "c_new": "Opened", "c_closed": "Closed", "c_reopen": "Reopened",
        "note": "Method: a store absent in a given snapshot is counted as \"closed\" (some may be temporarily uncollected); \"reopened\" means it disappeared and reappeared. Open/close counts are inflated by such churn — <b>net growth</b> better reflects real expansion.",
        "cta_h": "The market is reshuffling. What about your stores?",
        "cta_p": "Instead of watching market aggregates, check whether your own stores cannibalize each other. Free Store Checkup needs no login or data upload — pick stores on the map and get instant results.",
        "cta_btn": "Free Store Checkup (no login) →", "foot1": "Market-level aggregate statistics for reference only; not investment advice. Data through 2026/06.",
        "foot2": "Method: aggregated from location snapshots; no individual store operating data involved.",
    },
    "ja": {
        "lang": "ja", "title": "チェーンブランドの出店・閉店分析 · サイトウィナー",
        "desc": "184チェーンブランド・6期の店舗スナップショットによる出店・閉店・純増の推移。出店判断の市場baseline。",
        "brand": "サイトウィナー", "home": "ホームへ戻る", "checkup": "無料店舗チェック", "register": "無料登録",
        "h1": "チェーンブランドの出店・閉店分析", "tag": "6期 · 15か月",
        "sub": "対象期間 2025/03 – 2026/06 · 184チェーンブランド · 店舗位置スナップショットを一意IDで期間突合",
        "kpi_total": "期末店舗数", "kpi_brand": "対象ブランド", "kpi_new": "累計出店", "kpi_closed": "累計閉店",
        "kpi_brand_sub": "全国チェーン", "kpi_new_sub": "再開店を含む", "kpi_closed_sub": "スナップショット未出現",
        "trend": "ブランド別店舗数推移", "trend_tag": "上でブランドを選択。既定は純増Top8", "pick": "ブランドを選択（既定：純増Top8）",
        "search": "ブランド検索…", "top8": "純増Top8", "clear": "クリア", "ok": "確定", "reset": "リセット",
        "no_match": "一致するブランドなし", "flow": "市場全体の出店／閉店", "total": "店舗総数の推移",
        "rank": "純増 Top 15", "city": "都市別店舗数 Top 15", "table": "ブランド明細", "sort_tag": "見出しをクリックで並替",
        "c_brand": "ブランド", "c_net": "純増", "c_new": "出店", "c_closed": "閉店", "c_reopen": "再開店",
        "note": "算出方法：ある期のスナップショットに無い店舗を「閉店」とカウント（一時的な未取得を含む場合あり）。「再開店」は一度消えて再出現した店舗。出店・閉店数は変動により大きめになるため、<b>純増</b>が実質的な拡大を反映します。",
        "cta_h": "市場は再編中。あなたの店舗は？",
        "cta_p": "市場の集計を見るより、自店舗同士のカニバリゼーションを確認しましょう。無料店舗チェックはログイン・データアップロード不要、地図で点選するだけですぐ結果が出ます。",
        "cta_btn": "無料店舗チェック（ログイン不要） →", "foot1": "本ページは市場の集計統計で、参考情報のみです。投資助言ではありません。データは2026/06まで。",
        "foot2": "データ方法：位置スナップショットの集計であり、個店の経営データは含まれません。",
    },
}

DIRS = {
    "zh": HERE,
    "en": os.path.join(HERE, "en"),
    "ja": os.path.join(HERE, "ja"),
}


def esc(s):
    return html.escape(str(s), quote=True)


def load_data():
    with open(DATA_JSON, encoding="utf-8") as f:
        return json.load(f)


def kpis(data, ui):
    t = data["timeline"]
    total_new = sum(x["new"] for x in t[1:])
    total_closed = sum(x["closed"] for x in t[1:])
    last, first = t[-1]["total"], t[0]["total"]
    sign = ("+" if last - first > 0 else "") + format(last - first, ",")
    return [
        (ui["kpi_total"], format(last, ","), "15m %s" % sign if ui["lang"] != "zh-CN" else "15个月 %s 家" % sign),
        (ui["kpi_brand"], str(data["meta"]["brand_count"]), ui["kpi_brand_sub"]),
        (ui["kpi_new"], format(total_new, ","), ui["kpi_new_sub"]),
        (ui["kpi_closed"], format(total_closed, ","), ui["kpi_closed_sub"]),
    ]


PAGE = r"""<!DOCTYPE html>
<html lang="%(lang)s">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
<link rel="canonical" href="%(root)s/switch-analysis/">
<meta name="robots" content="index,follow">
<style>
:root{--bg:#f5f7fa;--card:#fff;--line:#e4e7ed;--text:#303133;--sub:#606266;--hint:#909399;--brand:#1e6fff;--up:#d92b2b;--down:#1a9e5c}
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text)}
.wrap{max-width:1200px;margin:0 auto;padding:0 20px 56px}
.site-nav{background:#fff;border-bottom:1px solid var(--line)}
.site-nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}
.brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;color:var(--text);text-decoration:none;font-size:15px}
.brand img{width:30px;height:30px}
.nav-links{display:flex;gap:18px;align-items:center;font-size:13px;flex-wrap:wrap}
.nav-links a{color:var(--sub);text-decoration:none}
.nav-links a:hover{color:var(--brand)}
.nav-links a.primary{background:var(--brand);color:#fff;padding:7px 14px;border-radius:6px}
.page-hd{padding:28px 0 20px}
.page-hd h1{font-size:26px;font-weight:700;line-height:1.35}
.page-hd h1 em{font-style:normal;font-size:13px;color:var(--brand);font-weight:600;margin-left:8px}
.page-hd .sub{color:var(--sub);font-size:13px;margin-top:8px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.kpi .label{font-size:12px;color:var(--hint)}
.kpi .val{font-size:26px;font-weight:700;margin-top:6px}
.kpi .delta{font-size:12px;margin-top:4px;color:var(--hint)}
.kpi .delta.up{color:var(--up)}.kpi .delta.down{color:var(--down)}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:18px}
.panel h2{font-size:15px;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.panel h2::before{content:"";width:3px;height:15px;background:var(--brand);border-radius:2px}
.tag{display:inline-block;background:#eef4ff;color:var(--brand);border-radius:5px;padding:2px 8px;font-size:11px;font-weight:500}
.ctrl{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.ctrl label{font-size:13px;color:var(--sub)}
.dd{position:relative}
.dd-btn{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;min-width:230px;text-align:left;color:var(--text)}
.dd-btn:hover{border-color:var(--brand)}
.dd-panel{display:none;position:absolute;top:calc(100%% + 6px);left:0;z-index:20;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.1);width:320px;padding:12px}
.dd-panel.open{display:block}
.dd-search{width:100%%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;margin-bottom:8px}
.dd-list{max-height:260px;overflow:auto}
.dd-item{display:flex;align-items:center;gap:8px;padding:5px 4px;font-size:13px;cursor:pointer;border-radius:5px}
.dd-item:hover{background:#f0f5ff}
.dd-item input{cursor:pointer}
.dd-item .c{margin-left:auto;color:var(--hint);font-size:11px}
.btn{background:var(--brand);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer}
.btn.ghost{background:#fff;color:var(--text);border:1px solid var(--line)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.chart{width:100%%;height:340px}
table{width:100%%;border-collapse:collapse;font-size:12px}
th,td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{background:#fafafa;color:var(--sub);font-weight:500;position:sticky;top:0;cursor:pointer;user-select:none}
tbody tr:hover{background:#fafafa}
.tbl-wrap{max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:8px}
.note{font-size:12px;color:var(--sub);margin-top:10px;padding:10px 12px;background:#fffbeb;border-radius:6px;border:1px solid #fde68a}
.cta{background:linear-gradient(135deg,#eef4ff,#f0f5ff);border:1px solid #d7e5ff;border-radius:12px;padding:24px;margin-top:8px;text-align:center}
.cta h2{font-size:18px;margin-bottom:8px}
.cta h2::before{display:none}
.cta p{font-size:13px;color:var(--sub);max-width:640px;margin:0 auto 14px}
.cta a{display:inline-block;background:var(--brand);color:#fff;padding:11px 22px;border-radius:8px;font-weight:600;text-decoration:none}
.foot{text-align:center;color:var(--hint);font-size:12px;margin-top:24px;line-height:1.9}
.foot a{color:var(--sub)}
@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}.page-hd h1{font-size:21px}}
</style>
</head>
<body>
<header class="site-nav"><div class="wrap">
  <a class="brand" href="%(root)s/"><img src="/assets/logo.png" alt="">%(brand)s</a>
  <nav class="nav-links" aria-label="导航">
    <a href="%(root)s/">%(home)s</a>
    <a href="%(checkup)s">%(checkup)s</a>
    <a class="primary" href="%(root)sregister">%(register)s</a>
  </nav>
</div></header>
<div class="wrap">
  <div class="page-hd">
    <h1>%(h1)s <em>%(tag)s</em></h1>
    <div class="sub">%(sub)s</div>
  </div>
  <div class="kpis" id="kpis"></div>
  <div class="panel">
    <h2>%(trend)s <span class="tag">%(trend_tag)s</span></h2>
    <div class="ctrl">
      <div class="dd">
        <button class="dd-btn" id="ddBtn" data-act="toggleDD" aria-expanded="false">%(pick)s ▾</button>
        <div class="dd-panel" id="ddPanel">
          <input type="text" class="dd-search" id="ddSearch" data-act="brandSearch" placeholder="%(search)s">
          <div class="dd-list" id="ddList"></div>
          <div style="margin-top:8px;display:flex;gap:8px">
            <button class="btn ghost" style="flex:1" data-act="top8">%(top8)s</button>
            <button class="btn ghost" style="flex:1" data-act="clear">%(clear)s</button>
            <button class="btn" style="flex:1" data-act="closeDD">%(ok)s</button>
          </div>
        </div>
      </div>
      <button class="btn ghost" data-act="top8">%(reset)s</button>
    </div>
    <div id="trendChart" class="chart" style="height:380px" role="img" aria-label="%(trend)s"></div>
  </div>
  <div class="grid2">
    <div class="panel"><h2>%(flow)s</h2><div id="flowChart" class="chart" role="img" aria-label="%(flow)s"></div></div>
    <div class="panel"><h2>%(total)s</h2><div id="totalChart" class="chart" role="img" aria-label="%(total)s"></div></div>
  </div>
  <div class="grid2">
    <div class="panel"><h2>%(rank)s</h2><div id="rankChart" class="chart" style="height:440px" role="img" aria-label="%(rank)s"></div></div>
    <div class="panel"><h2>%(city)s</h2><div id="cityChart" class="chart" style="height:440px" role="img" aria-label="%(city)s"></div></div>
  </div>
  <div class="panel">
    <h2>%(table)s <span class="tag">%(sort_tag)s</span></h2>
    <div class="tbl-wrap"><table id="tbl"><thead></thead><tbody></tbody></table></div>
    <div class="note">%(note)s</div>
  </div>
  <div class="cta">
    <h2>%(cta_h)s</h2>
    <p>%(cta_p)s</p>
    <a href="%(checkup)s">%(cta_btn)s</a>
  </div>
  <div class="foot">
    <p>%(foot1)s</p>
    <p>%(foot2)s</p>
    <p><a href="%(root)s/">%(home)s</a> · <a href="%(root)ssitemap.xml">Sitemap</a> · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">沪ICP备2026010607号-1</a></p>
  </div>
</div>
<script src="/assets/echarts.min.js"></script>
<script src="./switch.js"></script>
</body>
</html>
"""


# 看板逻辑独立 JS（CSP script-src self ⇒ 内联 script 会被静默拦掉，必须外置）
SCRIPT_JS = r"""const DATA = %(data_json)s;
const P = DATA.meta.periods;
const RED='#d92b2b', GREEN='#1a9e5c', PRIMARY='#1e6fff';
const L = %(ui_json)s;
let selected = new Set();
let charts = {};
let sortCol = 'net', sortAsc = false;

function fmt(n){return n.toLocaleString('en-US')}
function sign(n){return (n>0?'+':'')+fmt(n)}
function color(n){return n>0?RED:(n<0?GREEN:'#909399')}

(function(){
  const t=DATA.timeline, first=t[0].total, last=t[t.length-1].total;
  const totalNew=t.slice(1).reduce((s,x)=>s+x.new,0);
  const totalClosed=t.slice(1).reduce((s,x)=>s+x.closed,0);
  document.getElementById('kpis').innerHTML=
  '<div class="kpi"><div class="label">'+L.kpi_total+'</div><div class="val">'+fmt(last)+'</div><div class="delta up">'+L.delta15+' '+sign(last-first)+'</div></div>'+
  '<div class="kpi"><div class="label">'+L.kpi_brand+'</div><div class="val">'+DATA.meta.brand_count+'</div><div class="delta">'+L.kpi_brand_sub+'</div></div>'+
  '<div class="kpi"><div class="label">'+L.kpi_new+'</div><div class="val" style="color:'+RED+'">'+fmt(totalNew)+'</div><div class="delta">'+L.kpi_new_sub+'</div></div>'+
  '<div class="kpi"><div class="label">'+L.kpi_closed+'</div><div class="val" style="color:'+GREEN+'">'+fmt(totalClosed)+'</div><div class="delta">'+L.kpi_closed_sub+'</div></div>';
})();

function initCharts(){
  ['trendChart','flowChart','totalChart','rankChart','cityChart'].forEach(id=>{
    charts[id]=echarts.init(document.getElementById(id));
  });
}
function renderTrend(){
  const brands=DATA.brands.filter(b=>selected.has(b.brand));
  const PALETTE=['#d92b2b','#1e6fff','#1a9e5c','#BA7517','#0F6E56','#993556','#00b3a4','#7F77DD','#D85A30','#0C447C'];
  const series=brands.map((b,i)=>({
    name:b.brand,type:'line',smooth:true,symbolSize:7,
    lineStyle:{width:2.5},data:b.counts,itemStyle:{color:PALETTE[i%%PALETTE.length]}
  }));
  charts.trendChart.setOption({
    tooltip:{trigger:'axis'},
    legend:{data:brands.map(b=>b.brand),top:0,type:'scroll'},
    grid:{left:60,right:30,top:50,bottom:40},
    xAxis:{type:'category',data:P,boundaryGap:false},
    yAxis:{type:'value',splitLine:{lineStyle:{color:'#f0f2f5'}}},
    series:series
  },true);
}
function renderFlow(){
  const t=DATA.timeline.slice(1);
  charts.flowChart.setOption({
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
    legend:{data:[L.c_new,L.c_closed,L.c_net],top:0},
    grid:{left:60,right:20,top:45,bottom:35},
    xAxis:{type:'category',data:t.map(x=>x.period)},
    yAxis:{type:'value',splitLine:{lineStyle:{color:'#f0f2f5'}}},
    series:[
      {name:L.c_new,type:'bar',data:t.map(x=>x.new),itemStyle:{color:RED}},
      {name:L.c_closed,type:'bar',data:t.map(x=>-x.closed),itemStyle:{color:GREEN}},
      {name:L.c_net,type:'line',data:t.map(x=>x.net),itemStyle:{color:PRIMARY},symbolSize:8}
    ]
  },true);
}
function renderTotal(){
  const t=DATA.timeline;
  charts.totalChart.setOption({
    tooltip:{trigger:'axis'},
    grid:{left:70,right:30,top:30,bottom:35},
    xAxis:{type:'category',data:t.map(x=>x.period)},
    yAxis:{type:'value',min:300000,splitLine:{lineStyle:{color:'#f0f2f5'}}},
    series:[{name:L.kpi_total,type:'line',smooth:true,data:t.map(x=>x.total),
      itemStyle:{color:PRIMARY},lineStyle:{width:3},areaStyle:{color:'rgba(30,111,255,.12)'},
      label:{show:true,position:'top',fontSize:10,formatter:p=>fmt(p.value)}}]
  },true);
}
function renderRank(){
  const top=[...DATA.brands].sort((a,b)=>b.net-a.net).slice(0,15).reverse();
  charts.rankChart.setOption({
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>{
      const d=top[p[0].dataIndex];
      return '<b>'+d.brand+'</b><br/>'+P[0]+': '+fmt(d.counts[0])+'<br/>'+P[5]+': '+fmt(d.counts[5])+'<br/>'+L.c_net+': <span style="color:'+RED+'">'+sign(d.net)+'</span>';
    }},
    grid:{left:100,right:60,top:10,bottom:30},
    xAxis:{type:'value',splitLine:{lineStyle:{color:'#f0f2f5'}}},
    yAxis:{type:'category',data:top.map(x=>x.brand)},
    series:[{type:'bar',data:top.map(x=>x.net),itemStyle:{color:RED},
      label:{show:true,position:'right',formatter:p=>sign(p.value),fontSize:11}}]
  },true);
}
function renderCity(){
  const top=DATA.city_top.slice(0,15).reverse();
  charts.cityChart.setOption({
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
    grid:{left:80,right:50,top:10,bottom:30},
    xAxis:{type:'value',splitLine:{lineStyle:{color:'#f0f2f5'}}},
    yAxis:{type:'category',data:top.map(x=>x.city)},
    series:[{type:'bar',data:top.map(x=>x.last),itemStyle:{color:PRIMARY},
      label:{show:true,position:'right',formatter:p=>fmt(p.value),fontSize:11}}]
  },true);
}
function renderTable(){
  const cols=[['brand',L.c_brand],['counts_0',P[0]],['counts_2',P[2]],['counts_5',P[5]],['net',L.c_net],['new',L.c_new],['closed',L.c_closed],['reopen',L.c_reopen]];
  let rows=DATA.brands.filter(b=>selected.size===0||selected.has(b.brand));
  rows.sort((a,b)=>{
    const va=sortCol.startsWith('counts_')?a.counts[+sortCol.split('_')[1]]:a[sortCol];
    const vb=sortCol.startsWith('counts_')?b.counts[+sortCol.split('_')[1]]:b[sortCol];
    return (va>vb?1:va<vb?-1:0)*(sortAsc?1:-1);
  });
  document.querySelector('#tbl thead').innerHTML='<tr>'+cols.map(c=>'<th data-act="sort" data-col="'+c[0]+'">'+c[1]+(sortCol===c[0]?(sortAsc?' ▲':' ▼'):'')+'</th>').join('')+'</tr>';
  document.querySelector('#tbl tbody').innerHTML=rows.map(b=>'<tr>'+
    '<td><b>'+b.brand+'</b></td><td>'+fmt(b.counts[0])+'</td><td>'+fmt(b.counts[2])+'</td><td>'+fmt(b.counts[5])+'</td>'+
    '<td style="color:'+color(b.net)+';font-weight:600">'+sign(b.net)+'</td>'+
    '<td style="color:'+RED+'">'+fmt(b.new)+'</td><td style="color:'+GREEN+'">'+fmt(b.closed)+'</td><td>'+fmt(b.reopen)+'</td></tr>').join('');
}
function sortBy(c){if(sortCol===c)sortAsc=!sortAsc;else{sortCol=c;sortAsc=false}renderTable()}
function toggleDD(){var p=document.getElementById('ddPanel');p.classList.toggle('open');document.getElementById('ddBtn').setAttribute('aria-expanded',p.classList.contains('open'))}
function closeDD(){document.getElementById('ddPanel').classList.remove('open');document.getElementById('ddBtn').setAttribute('aria-expanded','false')}
// 事件委托（CSP script-src 'self' ⛔ 内联 on*= 会被静默拦掉，必须 data-* + 委托）
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-act]');
  if(!el){if(!e.target.closest('.dd'))closeDD();return}
  var a=el.getAttribute('data-act');
  if(a==='toggleDD'){e.stopPropagation();toggleDD()}
  else if(a==='closeDD')closeDD();
  else if(a==='top8')selectTop(8);
  else if(a==='clear')selectAll(false);
  else if(a==='sort')sortBy(el.getAttribute('data-col'));
  if(!e.target.closest('.dd')&&a!=='toggleDD')closeDD();
});
document.addEventListener('input',function(e){
  if(e.target.getAttribute('data-act')==='brandSearch')renderBrandList();
});
document.addEventListener('change',function(e){
  var el=e.target;
  if(el.getAttribute('data-act')==='brand')toggleBrand(el.getAttribute('data-brand'),el.checked);
});
function renderBrandList(){
  const q=(document.getElementById('ddSearch').value||'').trim();
  const list=DATA.brands.filter(b=>b.brand.includes(q)).slice(0,150);
  document.getElementById('ddList').innerHTML=list.map(b=>
    '<label class="dd-item"><input type="checkbox" data-act="brand" data-brand="'+b.brand+'" '+(selected.has(b.brand)?'checked':'')+'><span>'+b.brand+'</span><span class="c">'+fmt(b.counts[5])+'</span></label>'
  ).join('')||'<div style="color:#909399;padding:8px">'+L.no_match+'</div>';
}
function toggleBrand(b,on){on?selected.add(b):selected.delete(b);renderTrend();renderTable()}
function selectTop(n){selected=new Set([...DATA.brands].sort((a,b)=>b.net-a.net).slice(0,n).map(b=>b.brand));renderBrandList();renderTrend();renderTable()}
function selectAll(on){selected=on?new Set(DATA.brands.map(b=>b.brand)):new Set();renderBrandList();renderTrend();renderTable()}
window.addEventListener('load',()=>{
  initCharts();
  selectTop(8);
  renderFlow();renderTotal();renderRank();renderCity();
  window.addEventListener('resize',()=>Object.values(charts).forEach(c=>c.resize()));
});

"""


def page(data, lang):
    ui = UI[lang]
    # UI 文案 JSON（喂给图表 JS；含 KPI 的子串）
    ui_js = {k: ui[k] for k in (
        "kpi_total", "kpi_brand", "kpi_brand_sub", "kpi_new", "kpi_new_sub",
        "kpi_closed", "kpi_closed_sub", "c_new", "c_closed", "c_net",
        "c_brand", "c_reopen", "no_match"
    )}
    ui_js["delta15"] = "15个月" if lang == "zh" else ("15m" if lang == "en" else "15か月")
    ctx = {
        "lang": ui["lang"], "title": esc(ui["title"]), "desc": esc(ui["desc"]),
        "root": ROOT, "checkup": FREE_CHECKUP, "brand": esc(ui["brand"]),
        "home": esc(ui["home"]), "register": esc(ui["register"]),
        "h1": esc(ui["h1"]), "tag": esc(ui["tag"]), "sub": esc(ui["sub"]),
        "trend": esc(ui["trend"]), "trend_tag": esc(ui["trend_tag"]), "pick": esc(ui["pick"]),
        "search": esc(ui["search"]), "top8": esc(ui["top8"]), "clear": esc(ui["clear"]),
        "ok": esc(ui["ok"]), "reset": esc(ui["reset"]),
        "flow": esc(ui["flow"]), "total": esc(ui["total"]), "rank": esc(ui["rank"]),
        "city": esc(ui["city"]), "table": esc(ui["table"]), "sort_tag": esc(ui["sort_tag"]),
        "note": ui["note"],  # 含 <b>，故意不转义
        "cta_h": esc(ui["cta_h"]), "cta_p": esc(ui["cta_p"]), "cta_btn": esc(ui["cta_btn"]),
        "foot1": esc(ui["foot1"]), "foot2": esc(ui["foot2"]),
    }
    html_out = PAGE % ctx
    js_out = SCRIPT_JS % {
        "data_json": json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        "ui_json": json.dumps(ui_js, ensure_ascii=False),
    }
    return html_out, js_out


def main():
    data = load_data()
    print("switch_data.json: %d 品牌 / %d 期 / %d 城市" % (
        len(data["brands"]), len(data["meta"]["periods"]), len(data["city_top"])))
    for lang, d in DIRS.items():
        out_dir = os.path.join(d, "switch-analysis")
        os.makedirs(out_dir, exist_ok=True)
        html_out, js_out = page(data, lang)
        open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8").write(html_out)
        open(os.path.join(out_dir, "switch.js"), "w", encoding="utf-8").write(js_out)
        print("  %s → %s (html+js)" % (lang, os.path.relpath(out_dir, HERE)))


if __name__ == "__main__":
    main()
