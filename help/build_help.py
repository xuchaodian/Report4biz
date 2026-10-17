#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把《选址赢家Online用户手册.docx》转成静态帮助页 help/index.html

用法（在 Report4biz 目录下）：
    /Users/xuchaodian/.workbuddy/binaries/python/envs/default/bin/python help/build_help.py

产物：help/index.html —— 独立静态页（左侧章节目录 + 右侧正文），
     可原样 scp 到 /var/www/Report4biz/frontend/help/，与 SPA 构建链无关。
"""
import os, re, sys, html, io

try:
    import mammoth
except ImportError:
    sys.exit("缺少 mammoth：请先执行\n"
             "  /Users/xuchaodian/.workbuddy/binaries/python/envs/default/bin/pip install mammoth")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                                   # .../Report4biz
SRC = os.path.join(ROOT, "..", "..", "5. 使用方法技巧", "#选址赢家Online用户手册.docx")
OUT = os.path.join(HERE, "index.html")

if not os.path.exists(SRC):
    sys.exit("找不到源文件：%s" % SRC)

# ── 1) docx → HTML 片段 ────────────────────────────────────────
with io.open(SRC, "rb") as f:
    res = mammoth.convert_to_html(
        f,
        convert_image=mammoth.images.img_element(lambda img: {"src": img.to_data_uri()}),
    )
body = res.value

# ── 2) 给 h1/h2 加锚点 id，并抽取目录 ──────────────────────────
toc = []
counter = [0]

def add_id(m):
    tag, attrs, text = m.group(1), m.group(2), m.group(3)
    counter[0] += 1
    sid = "s%d" % counter[0]
    plain = re.sub(r"<[^>]+>", "", text).strip()
    if plain == "目录":          # 文档自带的目录标题：页面已有左侧目录 ⇒ 直接移除
        return ""
    if tag == "h1":
        toc.append(("h1", sid, plain))
    elif tag == "h2":
        toc.append(("h2", sid, plain))
    return '<%s%s id="%s">%s</%s>' % (tag, attrs, sid, text, tag)

body = re.sub(r"<(h1|h2)([^>]*)>(.*?)</\1>", add_id, body, flags=re.S)

# ── 3) 生成左侧目录 ────────────────────────────────────────────
toc_html = []
for lv, sid, text in toc:
    cls = "toc-l1" if lv == "h1" else "toc-l2"
    toc_html.append('      <a class="%s" href="#%s">%s</a>' % (cls, sid, html.escape(text)))
toc_html = "\n".join(toc_html)

CSS = """
:root{
  --brand:#0d579c; --brand-dark:#0a4479; --brand-soft:#e8f1fa;
  --ink:#1f2937; --ink-2:#4b5563; --line:#e5e7eb; --bg:#f7f9fc; --card:#ffffff;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;
  font-size:15px;line-height:1.78;-webkit-font-smoothing:antialiased}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
/* 顶栏 */
.topbar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.92);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.topbar-inner{max-width:1280px;margin:0 auto;padding:0 24px;height:56px;
  display:flex;align-items:center;gap:16px}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--brand-dark);font-size:16px}
.brand .dot{width:9px;height:9px;border-radius:50%;background:var(--brand)}
.topbar .tag{font-size:12px;color:var(--ink-2);background:var(--brand-soft);
  padding:2px 8px;border-radius:999px}
.topbar nav{margin-left:auto;display:flex;gap:18px;font-size:13.5px}
/* 布局 */
.wrap{max-width:1280px;margin:0 auto;padding:24px;display:grid;
  grid-template-columns:286px minmax(0,1fr);gap:28px;align-items:start}
.toc{position:sticky;top:80px;max-height:calc(100vh - 104px);overflow:auto;
  background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 10px}
.toc-title{font-size:12px;letter-spacing:.08em;color:var(--ink-2);
  text-transform:uppercase;padding:0 8px 8px}
.toc a{display:block;padding:5px 8px;border-radius:7px;color:var(--ink-2);font-size:13.5px}
.toc a:hover{background:var(--brand-soft);color:var(--brand-dark);text-decoration:none}
.toc-l1{font-weight:600;color:var(--ink)!important;margin-top:5px}
.toc-l2{padding-left:20px!important;font-size:13px!important}
/* 正文 */
.doc{background:var(--card);border:1px solid var(--line);border-radius:12px;
  padding:34px 40px 48px;min-width:0}
.doc h1{font-size:23px;color:var(--brand-dark);margin:34px 0 14px;padding-bottom:9px;
  border-bottom:2px solid var(--brand-soft);scroll-margin-top:76px}
.doc h1:first-child{margin-top:0}
.doc h2{font-size:17.5px;color:var(--brand);margin:26px 0 10px;scroll-margin-top:76px}
.doc h3{font-size:15.5px;margin:20px 0 8px}
.doc p{margin:9px 0}
.doc ul,.doc ol{margin:9px 0;padding-left:24px}
.doc li{margin:5px 0}
.doc strong{color:var(--brand-dark)}
.doc table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px;
  display:block;overflow-x:auto}
.doc th,.doc td{border:1px solid var(--line);padding:8px 11px;text-align:left;vertical-align:top}
.doc th{background:var(--brand-soft);color:var(--brand-dark);font-weight:600;white-space:nowrap}
.doc tr:nth-child(even) td{background:#fbfcfe}
.doc code{background:#f1f5f9;border:1px solid var(--line);border-radius:5px;
  padding:1px 5px;font-size:13px}
.doc blockquote{margin:12px 0;padding:10px 14px;border-left:3px solid var(--brand);
  background:var(--brand-soft);border-radius:0 8px 8px 0;color:var(--ink-2)}
.doc hr{border:0;border-top:1px solid var(--line);margin:26px 0}
.doc img{max-width:100%;height:auto}
/* 页脚 */
.foot{max-width:1280px;margin:0 auto;padding:8px 24px 40px;color:var(--ink-2);font-size:12.5px}
/* 响应式 */
@media (max-width:980px){
  .wrap{grid-template-columns:1fr;padding:16px}
  .toc{position:static;max-height:none}
  .doc{padding:22px 18px 34px}
  .doc h1{font-size:20px}
  .topbar nav{display:none}
}
"""

TPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>用户手册 - 选址赢家Online</title>
<meta name="description" content="选址赢家Online 用户手册：产品概述、快速入门、门户导航、地图中心、门店管理、选址工作台、联通人口分析、AI 助手、集团与子公司、API 开放等完整操作说明。">
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" href="/favicon.png" sizes="190x176" />
<link rel="shortcut icon" type="image/x-icon" href="/favicon.ico" />
<style>__CSS__</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <span class="brand"><span class="dot"></span>选址赢家Online</span>
    <span class="tag">用户手册</span>
    <nav>
      <a href="/">进入系统</a>
      <a href="/home/">产品主页</a>
      <a href="#top">回到顶部</a>
    </nav>
  </div>
</header>

<a id="top"></a>
<div class="wrap">
  <aside class="toc">
    <div class="toc-title">目录</div>
__TOC__
  </aside>
  <main class="doc">
__BODY__
  </main>
</div>

<footer class="foot">
  本手册随系统更新，如需 PDF / Word 版本或发现说明与界面不一致，请联系管理员（徐经理 138 1779 1741）。
</footer>
</body>
</html>
"""

out = TPL.replace("__CSS__", CSS).replace("__TOC__", toc_html).replace("__BODY__", body)
with io.open(OUT, "w", encoding="utf-8") as f:
    f.write(out)

n_h1 = sum(1 for lv, _, _ in toc if lv == "h1")
n_h2 = sum(1 for lv, _, _ in toc if lv == "h2")
print("✅ 已生成 %s" % OUT)
print("   章节 h1=%d  h2=%d  目录项=%d  表格=%d  大小=%d B"
      % (n_h1, n_h2, len(toc), body.count("<table>"), len(out.encode("utf-8"))))
if res.messages:
    print("   mammoth 提示：%s" % res.messages[:3])
