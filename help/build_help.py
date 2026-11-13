#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把《选址赢家Online用户手册.docx》转成静态帮助页 help/index.html

用法（在 Report4biz 目录下）：
    /Users/xuchaodian/.workbuddy/binaries/python/envs/default/bin/python help/build_help.py

产物：help/index.html —— 独立静态页（左侧章节目录 + 右侧正文）
      help/img/shot-*.jpg —— 从 docx 内嵌图片导出的外部图片（可缓存、lazy 加载）

部署：把整个 help/ 目录（index.html + img/）同步到
      /var/www/Report4biz/frontend/help/，与 SPA 构建链无关。

🔴 图片链路（v1.13.354 / 2026-11-13 起）：
  Word 里插图 → mammoth 回调把图片字节**直接写成 img/shot-NN.jpg**（不进 HTML），
  HTML 里只有 <img src="img/shot-NN.jpg" loading="lazy"> ⇒ 页面体积小、图片可缓存。
  图注取自图片「替代文字」（docPr.descr），与 Word 里紧跟图片的那段说明同源。
  ⛔ 不要用 img.to_data_uri()：本机 mammoth 版本的 Image 对象没有该方法
     （老脚本里写了但从没被调用过，因为旧手册无图）。
🔴 lazy 图必须带 width/height：不写宽高时图片加载前不占位，长目录页点锚点
   会被随后加载的图挤下去（2026-11-13 实测 scrollIntoView 从第 2 章漂到第 4 章）。
   宽高由图片字节直接解析，不依赖 Pillow / 不读磁盘文件。
"""
import os, re, sys, html, io, glob, struct

try:
    import mammoth
except ImportError:
    sys.exit("缺少 mammoth：请先执行\n"
             "  /Users/xuchaodian/.workbuddy/binaries/python/envs/default/bin/pip install mammoth")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                                   # .../Report4biz
SRC = os.path.join(ROOT, "..", "..", "5. 使用方法技巧", "#选址赢家Online用户手册.docx")
OUT = os.path.join(HERE, "index.html")
IMG_DIR = os.path.join(HERE, "img")

if not os.path.exists(SRC):
    sys.exit("找不到源文件：%s" % SRC)

# ── 1) docx → HTML 片段；内嵌图片导出为 help/img/ 外部文件 ──
image_counter = [0]
image_blobs = []
image_dims = {}

EXT_BY_TYPE = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}


def image_size(blob):
    """从图片字节读 (宽, 高)，零第三方依赖：JPEG SOF / PNG IHDR / GIF LSD。
    🔴 只为给 lazy <img> 写 width/height 占位；解析不出就返回 None（宁可不写，不写错比例）。
    """
    try:
        if blob[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", blob[16:24])
        if blob[:3] == b"GIF":
            return struct.unpack("<HH", blob[6:10])
        if blob[:2] == b"\xff\xd8":              # JPEG：扫到 SOF0/SOF2 段
            i = 2
            while i + 9 < len(blob):
                if blob[i] != 0xFF:
                    i += 1
                    continue
                marker = blob[i + 1]
                i += 2
                if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
                    continue
                seglen = struct.unpack(">H", blob[i:i + 2])[0]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                              0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", blob[i + 3:i + 7])
                    return w, h
                i += seglen
    except Exception:
        pass
    return None


def convert_image(img):
    """mammoth.images.img_element 回调：写外部文件，返回相对路径 + alt 图注"""
    image_counter[0] += 1
    ext = EXT_BY_TYPE.get(img.content_type, "jpg")
    name = "shot-%02d.%s" % (image_counter[0], ext)
    with img.open() as f:                       # ⚠️ open() 返回 context manager，不是文件对象
        blob = f.read()
    image_blobs.append((name, blob))
    dims = image_size(blob)
    if dims:
        image_dims[name] = dims
    # alt 文本 = Word 里图片「替代文字」（docPr.descr），用作网页 figcaption
    return {"src": "img/" + name, "alt": img.alt_text or ""}


with io.open(SRC, "rb") as f:
    res = mammoth.convert_to_html(
        f,
        convert_image=mammoth.images.img_element(convert_image),
    )
body = res.value


# ── 1b) 「图片段落 + 紧随的图注段落」→ <figure>（点击可看原图） ──
def build_figure(tag, fallback_caption=""):
    sm = re.search(r'\bsrc="([^"]*)"', tag)
    am = re.search(r'\balt="([^"]*)"', tag)
    src = html.unescape(sm.group(1)) if sm else ""
    cap = html.unescape(am.group(1)) if am else ""
    cap = re.sub(r"<[^>]+>", "", (cap or fallback_caption)).strip()
    if not src:
        return tag
    # 🔴 写宽高 ⇒ 图片加载前按真实宽高比占位，目录锚点不会漂移（配合 CSS height:auto）
    dims = image_dims.get(os.path.basename(src))
    dim_attr = ' width="%d" height="%d"' % dims if dims else ""
    inner = '<img src="%s" alt="%s" loading="lazy"%s />' % (
        html.escape(src, quote=True), html.escape(cap, quote=True), dim_attr)
    figcaption = '<figcaption>%s</figcaption>' % html.escape(cap) if cap else ""
    return ('<figure class="shot">'
            '<a href="%s" target="_blank" rel="noopener noreferrer" title="点击查看原图">%s</a>'
            '%s</figure>') % (html.escape(src, quote=True), inner, figcaption)


# ① 标准形态：图片段落 + 紧随的「图 N：…」说明段落 ⇒ 两者合并成一个 figure
CAP_PAT = re.compile(
    r'<p>\s*(<img\b[^>]*>)\s*</p>\s*<p>\s*(图\s*\d+\s*[：:][^<]*?)\s*</p>', re.S)
body = CAP_PAT.sub(
    lambda m: build_figure(m.group(1), re.sub(r"<[^>]+>", "", m.group(2)).strip()),
    body)
# ② 兜底：图片段落没有紧跟图注时，单独成 figure（图注取 alt）
body = re.sub(r'<p>\s*(<img\b[^>]*>)\s*</p>',
              lambda m: build_figure(m.group(1)), body)

# 图片落地：先清旧文件，保证 img/ 与本次文档完全一致（不会残留旧批次图）
os.makedirs(IMG_DIR, exist_ok=True)
for old in glob.glob(os.path.join(IMG_DIR, "shot-*")):
    os.remove(old)
for name, blob in image_blobs:
    with io.open(os.path.join(IMG_DIR, name), "wb") as f:
        f.write(blob)

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
/* 插图（v1.13.354）：外部图片 + 图注 + 点击看原图；不用内联 JS（CSP script-src 'self'） */
.doc figure.shot{margin:20px 0 26px;text-align:center}
.doc figure.shot a{display:inline-block;max-width:100%;cursor:zoom-in;text-decoration:none}
.doc figure.shot img{display:block;max-width:100%;height:auto;
  border:1px solid var(--line);border-radius:8px;box-shadow:0 2px 10px rgba(15,23,42,.07);
  transition:box-shadow .18s ease}
.doc figure.shot a:hover img{box-shadow:0 4px 18px rgba(13,87,156,.2)}
.doc figure.shot figcaption{margin-top:9px;font-size:13px;color:var(--ink-2);line-height:1.65}
/* 页脚 */
.foot{max-width:1280px;margin:0 auto;padding:8px 24px 40px;color:var(--ink-2);font-size:12.5px}
/* ICP 备案号（工信部要求可达，链接指向 beian.miit.gov.cn） */
.foot .icp{display:inline-block;margin-top:8px;color:var(--ink-2);text-decoration:none}
.foot .icp:hover{color:var(--brand);text-decoration:underline}
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
<meta name="description" content="选址赢家Online 用户手册：产品概述、快速入门、门户导航、地图中心、门店管理、选址工作台、联通人口分析、AI 助手、集团与子公司、API 开放等完整操作说明（含界面截图）。">
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
  本手册随系统更新，如需 PDF / Word 版本或发现说明与界面不一致，请联系管理员（徐经理 138 1779 1741）。<br>
  界面截图为 2026 年 11 月版本，点击图片可查看原图。<br>
  <a class="icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">沪ICP备2026010607号-1</a>
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
print("   章节 h1=%d  h2=%d  目录项=%d  表格=%d  图片=%d  figure=%d  宽高=%d  大小=%d B"
      % (n_h1, n_h2, len(toc), body.count("<table>"), len(image_blobs),
         body.count('<figure class="shot">'), len(image_dims), len(out.encode("utf-8"))))
for name, blob in image_blobs:
    print("   img/%s  %.1f KB" % (name, len(blob) / 1024))
if res.messages:
    print("   mammoth 提示：%s" % res.messages[:3])
