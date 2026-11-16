# -*- coding: utf-8 -*-
"""
官网三语静态页构建脚本：以中文 index.html 为源，生成 en/ 与 ja/ 两套独立页面。

设计（🔴 改动前必读）：
- 中文 index.html 是唯一源（默认语言，不改动其正文），本脚本只「另生成」两份。
- ⛔ 不用 lxml 序列化回写：它会把 SVG 的 viewBox 改成 viewbox（大小写敏感，图标消失）、
  破坏自闭合标签 ⇒ 采用「原始字节 + 占位符 + 整串精确替换」，只动文本节点与属性。
- 替换以 i18n.I18N[中文] = (en, ja) 为唯一依据；未覆盖的中文串会告警，防止漏翻。
- ⚠️ 资源路径：中文版在根 /，相对 assets/ 正常；en/ja 在子目录，必须改写为绝对 /assets/
  与 /home_v2.js，否则 /en/assets/xxx 404。og:image 本就是绝对 URL，不受影响。
- CSP script-src 'self'：切换器是纯 <a href> 链接，无内联 JS、无 on* 事件。
- FAQ：JSON-LD 的 Question/Answer 与可见 <details> 用同一字典整串替换，天然一致。

输出：
  en/index.html, en/home_v2.js
  ja/index.html, ja/home_v2.js
"""
import os, re, json, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from i18n import I18N

ZH = re.compile(r'[\u4e00-\u9fff]')
SRC_HTML = os.path.join(HERE, "_source_zh.html")   # 纯中文源（唯一 truth）
SRC_JS = os.path.join(HERE, "home_v2.js")

LANGS = {
    "zh": {"code": "zh-CN", "og": "zh_CN", "dir": "zh"},       # 中文输出到根目录 index.html
    "en": {"code": "en", "og": "en_US", "dir": "en"},
    "ja": {"code": "ja", "og": "ja_JP", "dir": "ja"},
}
ROOT = "https://www.mka-online.cn"
# 每种语言页面的规范地址与语言切换链接
URLS = {
    "zh": ROOT + "/",
    "en": ROOT + "/en/",
    "ja": ROOT + "/ja/",
}
LANG_LABELS = {"zh": "中文", "en": "EN", "ja": "日本語"}


_missing = set()


def tr(text, lang, *, soft=False):
    """整串替换一个中文文本；保留首尾空白。未覆盖时告警并返回原文。lang=zh 原样返回。"""
    if lang == "zh":
        return text
    lead = text[:len(text) - len(text.lstrip())]
    trail = text[len(text.rstrip()):]
    core = text.strip()
    if not core or not ZH.search(core):
        return text
    if core not in I18N:
        _missing.add(core)
        return text
    idx = 0 if lang == "en" else 1
    val = I18N[core][idx]
    return lead + val + trail


# ---------------- 语言切换器 HTML ----------------
def switcher_html(cur):
    parts = ['<div class="lang-sw" role="group" aria-label="Language / 言語 / 语言">']
    order = ["zh", "en", "ja"]
    for i, lg in enumerate(order):
        active = (lg == cur)
        cls = "lang-sw-a is-active" if active else "lang-sw-a"
        aria = ' aria-current="page"' if active else ''
        sep = '<span class="lang-sw-sep" aria-hidden="true">/</span>' if i else ''
        parts.append(sep)
        parts.append('<a class="%s" href="%s"%s>%s</a>' % (cls, URLS[lg], aria, LANG_LABELS[lg]))
    parts.append('</div>')
    return "".join(parts)


SWITCH_CSS = """
/* ---- 多语言切换器（构建脚本注入；纯 <a>，无 JS，符合 CSP） ---- */
.lang-sw{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--ink2);white-space:nowrap}
.lang-sw-a{padding:4px 2px;border-radius:5px;transition:color .2s;opacity:.72}
.lang-sw-a:hover{color:var(--brand);opacity:1}
.lang-sw-a.is-active{color:var(--brand);opacity:1;text-decoration:underline;text-underline-offset:3px}
.lang-sw-sep{color:var(--line2);font-weight:400}
@media(max-width:1000px){.lang-sw{font-size:12px}}
"""


# ---------------- HTML 处理 ----------------
def build_html(lang):
    raw = open(SRC_HTML, encoding="utf-8").read()
    prot = {}

    def stash(tag, s):
        k = "@@PROT_%s_%d@@" % (tag, len(prot))
        prot[k] = s
        return k

    # 保护：style（追加切换器 CSS 后整体保护）、HTML 注释、JSON-LD
    def style_hook(m):
        return stash("S", m.group(0).replace("</style>", SWITCH_CSS + "\n</style>"))
    work = re.sub(r'<style\b[\s\S]*?</style>', style_hook, raw, count=1)
    work = re.sub(r'<!--[\s\S]*?-->', lambda m: stash("C", m.group(0)), work)

    # JSON-LD：解析 -> 递归替换字符串 -> 结构化修正语言/URL -> 回写
    def jsonld_hook(m):
        block = m.group(0)
        data = json.loads(re.sub(r'^<script[^>]*>|</script>$', '', block))
        data = walk_replace(data, lang)  # 🔴 walk_replace 返回新对象，必须用返回值
        # 结构化修正：inLanguage / url / availableLanguage / @id 的 #website/#software/#faq 锚点
        lang_tag = {"zh": "zh-CN", "en": "en", "ja": "ja"}[lang]
        for node in data.get("@graph", []):
            t = node.get("@type")
            if "inLanguage" in node:
                node["inLanguage"] = lang_tag
            if "url" in node and isinstance(node["url"], str) and node["url"].rstrip("/") == ROOT:
                node["url"] = URLS[lang]
            aid = node.get("@id", "")
            if aid.startswith(ROOT + "/"):
                # WebSite / SoftwareApplication / FAQPage 的 @id 指向本语言页锚点
                node["@id"] = URLS[lang] + "#" + aid.split("#")[-1]
            # Organization 的 @id 用主域（mka-online.cn/#organization），保持跨语言为同一实体，不动
            if t == "Organization":
                for cp in node.get("contactPoint", []):
                    if "availableLanguage" in cp:
                        cp["availableLanguage"] = [lang_tag, "zh-CN"]
        new_inner = json.dumps(data, ensure_ascii=False, indent=2)
        return stash("J", '<script type="application/ld+json">\n' + new_inner + '\n</script>')
    work = re.sub(r'<script type="application/ld\+json">[\s\S]*?</script>', jsonld_hook, work, count=1)

    # 属性替换（alt / aria-label / content / title / data-label / placeholder）
    attr_re = re.compile(r'(?P<pre>\b(?:alt|aria-label|title|placeholder|content|data-label)=")(?P<val>[^"]*[\u4e00-\u9fff][^"]*)(?P<post>")')
    work = attr_re.sub(lambda m: m.group("pre") + tr(m.group("val"), lang) + m.group("post"), work)

    # 文本节点替换（标签之间）
    text_re = re.compile(r'(?P<pre>>)(?P<val>[^<>]*[\u4e00-\u9fff][^<>]*)(?P<post><)')
    work = text_re.sub(lambda m: m.group("pre") + tr(m.group("val"), lang) + m.group("post"), work)

    # 还原保护块
    for k, v in prot.items():
        work = work.replace(k, v)

    # head 注入多语言 SEO
    work = inject_head(work, lang)

    # 注入语言切换器到导航右侧（登录按钮前）
    work = inject_switcher(work, lang)

    # 资源路径：zh 在根目录保持相对；en/ja 在子目录改绝对，否则 /en/assets/xxx 404
    # 🔴 不能用「只替换 src/href 两个属性名」的写法：中文源里 <video poster="assets/…"> 有 2 处，
    #    漏改会让 en/ja 视频封面落到 /en/assets/… 而 404（imgBroken 检测不到 poster，只有资源列表能发现）。
    #    统一用「任意属性名 + ="assets/」正则，覆盖 poster/data-* 等将来新增的属性。
    if lang != "zh":
        work = re.sub(r'(\b[a-zA-Z][\w-]*=")assets/', r'\1/assets/', work)
        work = work.replace('href="./"', 'href="' + URLS[lang] + '"')  # 品牌 logo 回本语言首页
    # 各语言目录自带 home_v2.js，相对引用不变（zh 在根，en/ja 在各自子目录）
    return work


def walk_replace(o, lang):
    if lang == "zh":
        return o
    idx = 0 if lang == "en" else 1
    if isinstance(o, str):
        if ZH.search(o) and o.strip() in I18N:
            return I18N[o.strip()][idx]
        if ZH.search(o):
            _missing.add(o.strip()[:80])
        return o
    if isinstance(o, dict):
        return {k: walk_replace(v, lang) for k, v in o.items()}
    if isinstance(o, list):
        return [walk_replace(x, lang) for x in o]
    return o


def inject_head(html, lang):
    cfg = LANGS[lang]
    code = cfg["code"]
    og = cfg["og"]
    # html lang
    html = html.replace('<html lang="zh-CN">', '<html lang="%s">' % code, 1)
    # canonical / og:url 指向本语言
    html = html.replace('<link rel="canonical" href="%s/">' % ROOT,
                        '<link rel="canonical" href="%s">' % URLS[lang], 1)
    html = html.replace('<meta property="og:url" content="%s/">' % ROOT,
                        '<meta property="og:url" content="%s">' % URLS[lang], 1)
    html = html.replace('<meta property="og:locale" content="zh_CN">',
                        '<meta property="og:locale" content="%s">' % og, 1)
    # hreflang 互指 + x-default
    hreflang = [
        '<link rel="alternate" hreflang="zh-CN" href="%s">' % URLS["zh"],
        '<link rel="alternate" hreflang="en" href="%s">' % URLS["en"],
        '<link rel="alternate" hreflang="ja" href="%s">' % URLS["ja"],
        '<link rel="alternate" hreflang="x-default" href="%s">' % URLS["zh"],
    ]
    anchor = '<link rel="canonical"'
    idx = html.find(anchor)
    if idx >= 0:
        line_end = html.find('\n', idx)
        insert = "\n" + "\n".join(hreflang)
        html = html[:line_end] + insert + html[line_end:]
    return html


def inject_switcher(html, lang):
    sw = switcher_html(lang)
    # 插到 .hd-act 内、登录按钮之前
    needle = '<div class="hd-act">'
    idx = html.find(needle)
    if idx < 0:
        raise RuntimeError("未找到 .hd-act，无法注入语言切换器")
    insert_at = idx + len(needle)
    html = html[:insert_at] + "\n      " + sw + html[insert_at:]
    return html


# ---------------- JS 处理 ----------------
def build_js(lang):
    js = open(SRC_JS, encoding="utf-8").read()
    if lang == "zh":
        return js
    idx = 0 if lang == "en" else 1
    # 仅替换单引号字符串字面量中的中文（不含换行的字符串）
    def sub(m):
        inner = m.group(1)
        if inner.strip() in I18N:
            val = I18N[inner.strip()][idx]
            return "'" + val + "'"
        if ZH.search(inner):
            _missing.add("[js]" + inner.strip()[:60])
        return m.group(0)
    # 去注释只用于定位，但要保留原 js 结构：对整串做正则，注释里的中文串通常含换行或不在字典，不会被替换
    out = re.sub(r"'([^'\n]*[\u4e00-\u9fff][^'\n]*)'", sub, js)
    return out


# ---------------- 主流程 ----------------
def main():
    _missing.clear()
    for lang in LANGS:
        # zh 输出到根目录 index.html，en/ja 输出到各自子目录
        d = HERE if lang == "zh" else os.path.join(HERE, lang)
        os.makedirs(d, exist_ok=True)
        h = build_html(lang)
        j = build_js(lang)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(h)
        if lang != "zh":
            open(os.path.join(d, "home_v2.js"), "w", encoding="utf-8").write(j)
        # 校验
        zh_left = len(re.findall(r'[\u4e00-\u9fff]', re.sub(r'<style[\s\S]*?</style>|<script[^>]*>[\s\S]*?</script>|<!--[\s\S]*?-->', '', h)))
        print("[%s] %s %d B, 正文剩余中文字符 %d（品牌名/日文汉字属正常）" %
              (lang, "index.html(root)" if lang == "zh" else lang + "/index.html", len(h.encode('utf-8')), zh_left))
    if _missing:
        print("\n⚠️ 未覆盖中文串（需补 i18n.py）:")
        for m in sorted(_missing):
            print("   *", m)
    else:
        print("\n✅ 全部中文串已被字典覆盖")


if __name__ == "__main__":
    main()
