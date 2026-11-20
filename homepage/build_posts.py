# -*- coding: utf-8 -*-
"""
公众号卡片构建器：posts.json → 三语首页卡片 + /insights/ 列表页。

🔴 构建顺序：
    python3 homepage/build_i18n.py     # 生成三语 index.html（卡片区标记作为注释被原样保留）
    python3 homepage/build_posts.py    # 把卡片 HTML 填进标记之间，并生成 insights/index.html

- 周期性更新（sync_posts.py）只需重跑本脚本：用成对标记包裹，可重复覆盖，无需先跑 build_i18n。
- 🔴 必须用「起始+结束」成对标记，早期单占位符 replace 一次即消失 → 第二次更新填不进去。
- 卡片标题/摘要保留中文原文（公众号是中文的，不进 i18n）；只做 UI 文案三语 + html.escape 防破版。
- /insights/ 是 www 静态站独立页，样式自成一体，不依赖 SPA/dist/pm2。
"""
import os, re, json, html

HERE = os.path.dirname(os.path.abspath(__file__))
POSTS_JSON = os.path.join(HERE, "posts.json")
ROOT = "https://www.mka-online.cn"

# 成对标记：填充区间内容，标记本身保留 → 可无限次重复构建
START = "<!--POSTS_CARDS_START-->"
END = "<!--POSTS_CARDS_END-->"
MARK_RE = re.compile(re.escape(START) + r'[\s\S]*?' + re.escape(END))

# UI 文案三语（数据标题/摘要保持中文原文）
UI = {
    "zh": {"read": "阅读原文", "cadence": "每周三更新", "empty": "首批文章整理中，敬请关注",
           "more": "查看全部文章", "date": "发布"},
    "en": {"read": "Read original", "cadence": "Updated every Wednesday", "empty": "First articles coming soon",
           "more": "View all articles", "date": "Published"},
    "ja": {"read": "原文を読む", "cadence": "毎週水曜日更新", "empty": "最初の記事を準備中です",
           "more": "すべての記事を見る", "date": "公開日"},
}
DIRS = {"zh": HERE, "en": os.path.join(HERE, "en"), "ja": os.path.join(HERE, "ja")}


def esc(s):
    return html.escape(str(s or ""), quote=True)


def load():
    with open(POSTS_JSON, encoding="utf-8") as f:
        return json.load(f)


def card_html(p, ui):
    cover = p.get("cover") or ""
    # 首页/列表页在子目录时用绝对路径；封面已是 /assets/posts/... 绝对路径，无需改写
    thumb = ('<a class="pc-thumb" href="%s" target="_blank" rel="noopener noreferrer">'
             '<img src="%s" alt="" loading="lazy"></a>' % (esc(p["url"]), esc(cover))) if cover else \
            '<div class="pc-thumb pc-thumb-ph" aria-hidden="true">选址</div>'
    return (
        '<article class="post-card">\n'
        '  %s\n'
        '  <div class="pc-body">\n'
        '    <div class="pc-meta"><time datetime="%s">%s</time><span class="pc-dot">·</span><span>%s</span></div>\n'
        '    <h3><a href="%s" target="_blank" rel="noopener noreferrer">%s</a></h3>\n'
        '    %s\n'
        '    <a class="pc-link" href="%s" target="_blank" rel="noopener noreferrer">%s <span aria-hidden="true">→</span></a>\n'
        '  </div>\n'
        '</article>'
    ) % (thumb, esc(p.get("date", "")), esc(p.get("date", "")), esc(ui["cadence"]),
         esc(p["url"]), esc(p.get("title", "")),
         ('<p class="pc-sum">' + esc(p.get("summary", "")) + '</p>') if p.get("summary") else "",
         esc(p["url"]), esc(ui["read"]))


def cards_block(posts, ui, limit=None):
    use = posts[:limit] if limit else posts
    if not use:
        return '<div class="posts-empty">%s</div>' % esc(ui["empty"])
    return '\n'.join(card_html(p, ui) for p in use)


def inject_home(posts):
    for lang, d in DIRS.items():
        path = os.path.join(d, "index.html")
        if not os.path.exists(path):
            print("  ⚠️ 跳过（不存在）:", path)
            continue
        s = open(path, encoding="utf-8").read()
        if not MARK_RE.search(s):
            print("  ⚠️ 卡片标记缺失，跳过（需先跑 build_i18n.py 从源重建）:", path)
            continue
        block = START + cards_block(posts, UI[lang], limit=3) + END
        s = MARK_RE.sub(lambda _: block, s, count=1)
        open(path, "w", encoding="utf-8").write(s)
        print("  ✓ 注入卡片:", path)


LIST_CSS = """
  :root{--bg:#f5f7fa;--card:#fff;--line:#e4e7ed;--text:#303133;--sub:#606266;--hint:#909399;--blue:#2563eb}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:1000px;margin:0 auto;padding:24px 24px 56px}
  .site-nav{background:#fff;border-bottom:1px solid var(--line)}
  .site-nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px;padding-bottom:14px}
  .brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;color:var(--text);text-decoration:none;font-size:15px}
  .brand img{width:30px;height:30px}
  .nav-links{display:flex;gap:18px;align-items:center;font-size:13px}
  .nav-links a{color:var(--sub);text-decoration:none}
  .nav-links a:hover{color:var(--blue)}
  .nav-links a.primary{background:var(--blue);color:#fff;padding:7px 14px;border-radius:6px}
  .page-hd{margin:28px 0 22px}
  .page-hd h1{font-size:24px;margin:0 0 8px}
  .page-hd h1 em{font-style:normal;color:var(--blue)}
  .page-hd p{color:var(--sub);margin:0;font-size:14px}
  .posts-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .post-card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;transition:transform .2s,box-shadow .2s}
  .post-card:hover{transform:translateY(-3px);box-shadow:0 14px 30px -18px rgba(16,32,64,.4)}
  .pc-thumb{display:block;aspect-ratio:16/9;background:#eef2f7;overflow:hidden}
  .pc-thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .pc-thumb-ph{display:flex;align-items:center;justify-content:center;color:#c4cede;font-weight:700;font-size:22px;letter-spacing:2px}
  .pc-body{padding:14px 16px 16px;display:flex;flex-direction:column;flex:1}
  .pc-meta{font-size:12px;color:var(--hint);display:flex;gap:6px;align-items:center}
  .pc-dot{opacity:.6}
  .pc-body h3{font-size:15px;line-height:1.45;margin:8px 0 0}
  .pc-body h3 a{color:var(--text);text-decoration:none}
  .pc-body h3 a:hover{color:var(--blue)}
  .pc-sum{font-size:12.5px;color:var(--sub);line-height:1.65;margin:8px 0 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .pc-link{margin-top:auto;padding-top:12px;font-size:12.5px;color:var(--blue);text-decoration:none;font-weight:600}
  .pc-link:hover{text-decoration:underline;text-underline-offset:3px}
  .posts-empty{grid-column:1/-1;text-align:center;color:var(--hint);padding:60px 20px;background:#fff;border:1px dashed var(--line);border-radius:10px}
  .foot{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--hint);line-height:1.8}
  .foot a{color:var(--hint)}
  @media(max-width:720px){.posts-grid{grid-template-columns:1fr}.nav-links a:not(.primary){display:none}}
"""


def list_page(data):
    posts = data.get("posts", [])
    ui = UI["zh"]
    cards = cards_block(posts, ui)
    updated = esc(data.get("updated", ""))
    account = esc(data.get("account", "选址赢家Online"))
    return """<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>最新动态 · 公众号精选 · 选址赢家Online</title>
<meta name="description" content="选址赢家Online 公众号文章精选：选址方法、商圈人口分析、门店竞争与经营决策干货，每周三更新。">
<link rel="canonical" href="%s/insights/">
<meta name="robots" content="index,follow">
<style>%s</style>
</head>
<body>
<header class="site-nav"><div class="wrap">
  <a class="brand" href="%s/"><img src="/assets/logo.png" alt="">选址赢家Online</a>
  <nav class="nav-links" aria-label="页面导航">
    <a href="%s/">返回官网</a>
    <a href="%s/free-checkup">免费门店体检</a>
    <a class="primary" href="%s/register">免费注册</a>
  </nav>
</div></header>
<div class="wrap">
  <div class="page-hd">
    <h1>最新动态 <em>· %s</em></h1>
    <p>%s 每周三更新 · 点击卡片阅读公众号原文。文章观点仅供选址决策参考。</p>
  </div>
  <div class="posts-grid">
%s
  </div>
  <div class="foot">
    <p>本站文章为选址方法与产品动态分享，不构成任何投资建议。原文版权归选址赢家Online所有。</p>
    <p><a href="%s/">返回官网</a> · <a href="%s/help/">用户手册</a> · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">沪ICP备2026010607号-1</a></p>
  </div>
</div>
</body>
</html>
""" % (ROOT, LIST_CSS, ROOT, ROOT, ROOT.replace("www.", ""), ROOT.replace("www.", ""),
       ui["cadence"], account, cards, ROOT, ROOT)


def main():
    data = load()
    posts = data.get("posts", [])
    print("posts.json: %d 篇，updated=%s" % (len(posts), data.get("updated")))
    inject_home(posts)
    d = os.path.join(HERE, "insights")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "index.html")
    open(path, "w", encoding="utf-8").write(list_page(data))
    print("  ✓ 列表页:", path)


if __name__ == "__main__":
    main()
