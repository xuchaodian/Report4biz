# -*- coding: utf-8 -*-
"""三语产物本地校验：结构完整性、SEO 互指、FAQ 双源一致、CSP、资源路径、切换器。"""
import os, re, json, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "https://www.mka-online.cn"
fail = []
def ck(cond, msg):
    print(("  OK  " if cond else "  FAIL") + " " + msg)
    if not cond: fail.append(msg)

def load(lang):
    p = HERE if lang == "zh" else os.path.join(HERE, lang)
    return open(os.path.join(p, "index.html"), encoding="utf-8").read()

print("=== 1. 三语文件存在 ===")
for lang, path in [("zh", "index.html"), ("en", "en/index.html"), ("ja", "ja/index.html"),
                   ("en", "en/home_v2.js"), ("ja", "ja/home_v2.js")]:
    ck(os.path.exists(os.path.join(HERE, path)), "存在 " + path)

print("\n=== 2. 各语 html lang / canonical / og ===")
expect = {
    "zh": ("zh-CN", ROOT + "/", "zh_CN"),
    "en": ("en", ROOT + "/en/", "en_US"),
    "ja": ("ja", ROOT + "/ja/", "ja_JP"),
}
for lang, (code, canon, og) in expect.items():
    t = load(lang)
    ck('<html lang="%s">' % code in t, "%s html lang=%s" % (lang, code))
    ck('<link rel="canonical" href="%s">' % canon in t, "%s canonical=%s" % (lang, canon))
    ck('<meta property="og:url" content="%s">' % canon in t, "%s og:url" % lang)
    ck('<meta property="og:locale" content="%s">' % og in t, "%s og:locale=%s" % (lang, og))

print("\n=== 3. hreflang 互指（三语各 4 条：zh-CN/en/ja/x-default）===")
for lang in expect:
    t = load(lang)
    for hre, url in [("zh-CN", ROOT + "/"), ("en", ROOT + "/en/"),
                     ("ja", ROOT + "/ja/"), ("x-default", ROOT + "/")]:
        ck('<link rel="alternate" hreflang="%s" href="%s">' % (hre, url) in t,
           "%s hreflang %s" % (lang, hre))

print("\n=== 4. 语言切换器（三语各 3 个链接，本语 active）===")
for lang in expect:
    t = load(lang)
    ck(t.count('class="lang-sw-a') == 3, "%s 切换器 3 链接" % lang)
    ck(t.count('aria-current="page"') == 1, "%s 本语高亮 1 处" % lang)
    active = re.search(r'class="lang-sw-a is-active"[^>]*>([^<]+)<', t)
    label = {"zh": "中文", "en": "EN", "ja": "日本語"}[lang]
    ck(active and active.group(1) == label, "%s 高亮=%s" % (lang, label))

print("\n=== 5. 百度验证 meta 保留 ===")
for lang in expect:
    ck('baidu-site-verification' in load(lang), "%s 百度 meta" % lang)

print("\n=== 6. CSP：无内联 script / on* 事件 ===")
for lang in expect:
    t = load(lang)
    inline = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>', t)
    inline = [s for s in inline if 'application/ld+json' not in s]
    ck(len(inline) == 0, "%s 无内联执行 script" % lang)
    ck(len(re.findall(r'\son(?:click|load|error|change|submit)\s*=', t)) == 0, "%s 无内联 on* 事件" % lang)

print("\n=== 7. 资源路径：en/ja 用绝对 /assets，zh 用相对 assets ===")
t = load("zh")
ck('src="assets/logo.png"' in t, "zh 相对 assets")
for lang in ("en", "ja"):
    t = load(lang)
    ck('src="/assets/logo.png"' in t, "%s 绝对 /assets" % lang)
    # 🔴 必须按「任意属性名」查残留：只查 src= 会放过 <video poster="assets/…">（真踩过，en/ja 封面 404）
    ck(not re.search(r'\b[a-zA-Z][\w-]*="assets/', t), "%s 无残留相对 assets 属性" % lang)
    ck(t.count('poster="/assets/') == 2, "%s 2 处视频封面为绝对 /assets" % lang)
    ck('poster="assets/' not in t, "%s 无相对 poster" % lang)

print("\n=== 8. JSON-LD 有效 + FAQ 双源一致（每语）===")
for lang in expect:
    t = load(lang)
    d = json.loads(re.search(r'<script type="application/ld\+json">([\s\S]*?)</script>', t).group(1))
    faq_node = [n for n in d["@graph"] if n.get("@type") == "FAQPage"][0]
    qs_json = [q["name"] for q in faq_node["mainEntity"]]
    qs_visible = re.findall(r'<summary>([^<]+)</summary>', t)
    ck(len(qs_json) == 12, "%s JSON-LD 12 条 FAQ" % lang)
    ck(qs_json == qs_visible, "%s FAQ JSON-LD 与可见 details 逐条一致" % lang)
    # 每语种自己的语言码
    ws = [n for n in d["@graph"] if n.get("@type") == "WebSite"][0]
    lc = {"zh": "zh-CN", "en": "en", "ja": "ja"}[lang]
    ck(ws.get("inLanguage") == lc, "%s WebSite inLanguage=%s" % (lang, lc))

print("\n=== 9. 无占位符残留 / 无漏翻告警 ===")
for lang in expect:
    t = load(lang)
    ck('@@PROT' not in t and '@@I' not in t, "%s 无占位符残留" % lang)

print("\n=== 10. 视频/图片资源引用完整 ===")
for lang in expect:
    t = load(lang)
    for asset in ["demo-market.mp4", "demo-isochrone.mp4", "demo-market-cover.webp", "screen-hero.webp"]:
        ck(asset in t, "%s 引用 %s" % (lang, asset))

print("\n" + ("="*50))
if fail:
    print("❌ 失败 %d 项:" % len(fail))
    for f in fail: print("   -", f)
    sys.exit(1)
else:
    print("✅ 全部本地校验通过")
