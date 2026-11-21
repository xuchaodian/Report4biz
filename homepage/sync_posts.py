# -*- coding: utf-8 -*-
"""
公众号文章同步器： Weekly WeChat article → official homepage.

用法（每周三发文后，把文章链接丢进来即可）：
    python3 homepage/sync_posts.py "https://mp.weixin.qq.com/s/XXXX"
    python3 homepage/sync_posts.py URL1 URL2      # 可一次补多篇

做了四件事：
1. GET 公开文章页，解析 og:title / og:description / og:image / 发布时间。
2. 封面图下载到 assets/posts/<id>.<ext>，绕开 mmbiz.qpic.cn 防盗链
   （官网直接 <img src=qpic> 会 403，必须转存本地）。
3. 写回 posts.json：按 URL 去重、发布时间倒序，最多保留 MAX_POSTS 条。
4. 调 build_posts.py 重建首页卡片 + /insights/ 列表页。

🔴 设计边界：
- 只抓 og meta（公开可见字段），不解析正文 → 第一阶段是「卡片 + 跳原文」，
  正文留在微信，不镜像、不搬运，规避版权/排版/视频失效问题。
- 无第三方依赖，纯标准库（urllib/re/json），徐工本机 + 沙箱都能跑。
- 抓取失败宁可报错退出，绝不写半成品进 posts.json。
"""
import os, re, sys, json, html, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
POSTS_JSON = os.path.join(HERE, "posts.json")
ASSETS = os.path.join(HERE, "assets", "posts")
MAX_POSTS = 50  # 2026-11-21 上调（原 12）：首批 10 + 第二批 21 = 31 篇，留未来空间

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


def fetch(url, referer="https://mp.weixin.qq.com/"):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": referer,
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read(), r.headers


def meta(htm, *keys):
    """按 og:/name 顺序取第一个非空 meta content。"""
    for k in keys:
        m = re.search(r'<meta[^>]+(?:property|name)="%s"[^>]+content="([^"]*)"' % re.escape(k), htm, re.I)
        if not m:
            m = re.search(r'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="%s"' % re.escape(k), htm, re.I)
        if m and m.group(1).strip():
            return html.unescape(m.group(1).strip())
    return ""


def pub_date(htm):
    """发布时间：优先 og:article:published_time / weibo meta，再回退 JS var ct / publish_time。"""
    for k in ("article:published_time", "weibo:article:create_at"):
        v = meta(htm, k)
        if v:
            return v[:10].replace("/", "-")
    m = re.search(r'var\s+(?:ct|publish_time)\s*=\s*["\']?(\d{10})', htm)
    if m:
        import datetime
        return datetime.datetime.fromtimestamp(int(m.group(1))).strftime("%Y-%m-%d")
    m = re.search(r'(20\d{2})[-年](\d{1,2})[-月](\d{1,2})', htm)
    if m:
        return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))
    import datetime
    return datetime.date.today().isoformat()


def post_id(url):
    m = re.search(r'/s/([A-Za-z0-9_-]+)', url)
    return (m.group(1)[:16] if m else re.sub(r'\W+', '', url)[:16]) or "wx"


def save_cover(img_url, pid):
    if not img_url:
        return ""
    os.makedirs(ASSETS, exist_ok=True)
    try:
        data, hdr = fetch(img_url)
    except Exception as e:
        print("  ⚠️ 封面下载失败（文章仍会入库，卡片用纯文字）:", e)
        return ""
    ct = hdr.get("Content-Type", "")
    ext = "jpg"
    if "png" in ct:
        ext = "png"
    elif "gif" in ct:
        ext = "gif"
    elif "webp" in ct:
        ext = "webp"
    name = "%s.%s" % (pid, ext)
    with open(os.path.join(ASSETS, name), "wb") as f:
        f.write(data)
    return "/assets/posts/" + name


def load():
    with open(POSTS_JSON, encoding="utf-8") as f:
        return json.load(f)


def save(obj):
    obj["posts"] = obj["posts"][:MAX_POSTS]
    with open(POSTS_JSON, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    urls = [u.strip() for u in sys.argv[1:] if u.strip()]
    if not urls:
        print(__doc__)
        sys.exit(1)

    data = load()
    known = {p.get("url") for p in data["posts"]}
    added = 0
    for url in urls:
        print("→ 抓取:", url)
        try:
            htm = ""
            # 🔴 微信偶发返回 4MB 页面但 og meta 解析为空（2026-11-21 实测第17篇）
            #    ⇒ 标题为空即重试，最多 3 次；否则该篇被静默跳过，文章永久缺失。
            for attempt in range(1, 4):
                raw, _ = fetch(url)
                htm = raw.decode("utf-8", "ignore")
                title = meta(htm, "og:title", "twitter:title") or meta(htm, "msg_title")
                if not title:
                    m = re.search(r'<h1[^>]*id="activity-name"[^>]*>([\s\S]*?)</h1>', htm)
                    title = re.sub(r'<[^>]+>', '', m.group(1)).strip() if m else ""
                if title:
                    break
                if attempt < 3:
                    import time
                    time.sleep(1.5)
        except Exception as e:
            print("  ✗ 抓取失败，跳过:", e)
            continue
        title = re.sub(r'\s+', ' ', title).strip()
        summary = meta(htm, "og:description", "description", "twitter:description")
        summary = re.sub(r'\s+', ' ', summary).strip()[:120]
        cover_url = meta(htm, "og:image", "twitter:image")
        date = pub_date(htm)
        pid = post_id(url)
        if not title:
            print("  ✗ 未解析到标题，跳过（可能被反爬拦截，请人工核对链接）")
            continue
        if url in known:
            print("  = 已存在，跳过:", title)
            continue
        cover = save_cover(cover_url, pid)
        data["posts"].append({
            "id": pid, "title": title, "date": date,
            "summary": summary, "cover": cover, "url": url,
        })
        known.add(url)
        added += 1
        print("  ✓ 已入库:", date, title)

    data["posts"].sort(key=lambda p: p.get("date", ""), reverse=True)
    import datetime
    data["updated"] = datetime.date.today().isoformat()
    save(data)
    print("\n本次新增 %d 篇，当前共 %d 篇。" % (added, len(data["posts"])))

    # 自动重建静态页
    build = os.path.join(HERE, "build_posts.py")
    if os.path.exists(build):
        import subprocess
        print("→ 重建首页卡片 + 列表页 …")
        subprocess.run([sys.executable, build], check=True)


if __name__ == "__main__":
    main()
