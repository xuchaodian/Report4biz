# -*- coding: utf-8 -*-
"""从中文源精确提取所有需要翻译的中文串，按来源分类，输出唯一清单。
来源：html_text / html_attr / jsonld / js
"""
import re, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "index.html")
raw = open(SRC, encoding="utf-8").read()
ZH = re.compile(r'[\u4e00-\u9fff]')

records = []  # {src, zh}
def rec(src, s):
    s2 = s.strip()
    if s2 and ZH.search(s2):
        records.append({"src": src, "zh": s2, "raw": s})

# 保护 style / 注释（保留 JSON-LD 供单独提取）
work = re.sub(r'<!--[\s\S]*?-->', '', raw)
work = re.sub(r'<style\b[\s\S]*?</style>', '', work)

# HTML 属性
attr_re = re.compile(r'\b(?:alt|aria-label|title|placeholder|content|data-label)="([^"]*[\u4e00-\u9fff][^"]*)"')
for m in attr_re.finditer(work):
    rec("html_attr", m.group(1))

# HTML 文本节点
text_re = re.compile(r'>([^<>]*[\u4e00-\u9fff][^<>]*)<')
for m in text_re.finditer(work):
    rec("html_text", m.group(1))

# JSON-LD：解析所有字符串值
m = re.search(r'<script type="application/ld\+json">([\s\S]*?)</script>', raw)
if m:
    def walk(o):
        if isinstance(o, str):
            rec("jsonld", o)
        elif isinstance(o, dict):
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    try:
        walk(json.loads(m.group(1)))
    except Exception as e:
        print("JSON-LD parse warn:", e)

# JS：单引号字符串字面量（不含换行，排除注释块已由换行限制规避）
js = open(os.path.join(HERE, "home_v2.js"), encoding="utf-8").read()
js_no_comment = re.sub(r'/\*[\s\S]*?\*/', '', js)  # 去块注释
js_no_comment = re.sub(r'//[^\n]*', '', js_no_comment)  # 去行注释
for m in re.finditer(r"'([^'\n]*[\u4e00-\u9fff][^'\n]*)'", js_no_comment):
    rec("js", m.group(1))

# 去重（按 zh，保留来源集合）
uniq = {}
for r in records:
    z = r["zh"]
    if z not in uniq:
        uniq[z] = {"zh": z, "src": set()}
    uniq[z]["src"].add(r["src"])
out = []
for z, v in uniq.items():
    v["src"] = sorted(v["src"])
    out.append(v)
# 按来源+字符串排序，便于阅读
out.sort(key=lambda x: (x["src"][0], x["zh"]))
json.dump(out, open(os.path.join(HERE, "_unique_zh.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump(records, open(os.path.join(HERE, "_all_records.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("记录总数:", len(records), " 唯一串:", len(out))
from collections import Counter
print("按来源(记录):", dict(Counter(r["src"] for r in records)))
print("--- 唯一清单 ---")
for i, v in enumerate(out):
    print("%3d[%s] %s" % (i, ",".join(s[0] for s in v["src"]), v["zh"][:64]))
