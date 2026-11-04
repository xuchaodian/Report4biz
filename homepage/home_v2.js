/* ============================================================================
 * 选址赢家Online 产品主页 /home/（v2 简洁版）交互脚本
 *
 * 🔴 为什么必须外置成独立文件：
 *    nginx 对本站下发 Content-Security-Policy: … script-src 'self' …
 *    （不含 'unsafe-inline'）⇒ 页面内联 <script> 会被浏览器直接拒绝执行，
 *    且不抛异常、不报错，极易误判成"代码没写对"。
 *    ⇒ 任何新交互一律写进本文件（同源加载，命中 script-src 'self'）。
 *
 * 🔴 同理禁止内联 on*="…"（CSP 也会拦），事件一律 addEventListener。
 *
 * 排查：curl -sI https://mka-online.cn/home/home_v2.js 探活；
 *       核对 index.html 里 <script src="home_v2.js" defer> 在 </body> 前。
 * ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 0. 标记 JS 可用 ----------
   * 进场动画的初始隐藏态只在 .js 下生效 ⇒ 脚本挂了页面依然完整可见（渐进增强）。*/
  document.documentElement.classList.add('js');

  /* ======================== 1. 操作演示（聚光灯引导） ========================
   * 每个 step 对应一张真实界面截图 + 一个矩形高亮区（百分比，相对截图本身）。
   * 坐标按 1200×750 的实际截图量取，改图必须重量。 */
  var STEPS = [
    { x: 61.3, y: 7.2,  w: 10.2, h: 33.5, tip: '「商圈工具」：半径 / 驾车 / 步行', below: true  },
    /* 02 看清人口：五角场万达为圆心、半径 3km 的圆 + 1km 网格整格着色
     * 🔴 用「方格完整、不按圆裁剪」那版图（裁剪版色块边缘碎成不规则多边形，观感差）。*/
    { x: 26.2, y: 23.4, w: 39.6, h: 55.3, tip: '半径 3km 内 72.2 万人，颜色越暖人口越密', below: false },
    /* 03 竞争追踪：竞品门店追踪图 ⇒ 框住左上「竞品门店追踪图例」卡片（图按 1.6 比例左对齐裁剪，图例未被切） */
    { x: 0.8,  y: 16.6, w: 17.6, h: 10.8, tip: '追踪圈按竞品分布生成，圈内竞品一图看清', below: true  },
    /* 04 得出结论：商圈分析报告（评分 + 数据洞察 + 可视化）⇒ 框住整块「商圈评分」卡片 */
    { x: 1.0,  y: 23.5, w: 59.5, h: 21.5, tip: '五个维度打分，商圈成色一眼看清',     below: true  },
    /* 05 大屏总览：深色数据大屏 ⇒ 框住左上四组 KPI（在营门店 / 竞品门店 / 闭店 / 覆盖）*/
    { x: 1.4,  y: 10.2, w: 19.6, h: 47.4, tip: '门店、竞品、覆盖城市，一屏汇总',      below: true  }
  ];

  var box = document.getElementById('demoBox');
  if (box) {
    var steps = Array.prototype.slice.call(box.querySelectorAll('.step'));
    var shots = Array.prototype.slice.call(box.querySelectorAll('.shot'));
    var spot = document.getElementById('spot');
    var tip = document.getElementById('spotTip');
    var cur = 0;
    var timer = null;
    var SWAP = 7000;

    var place = function (i) {
      var s = STEPS[i];
      if (!s || !spot) return;
      spot.style.left = s.x + '%';
      spot.style.top = s.y + '%';
      spot.style.width = s.w + '%';
      spot.style.height = s.h + '%';
      spot.classList.toggle('tip-below', !!s.below);
      if (tip) tip.textContent = s.tip;
    };

    var show = function (i) {
      cur = (i + steps.length) % steps.length;
      steps.forEach(function (b, k) {
        var on = k === cur;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      shots.forEach(function (img, k) { img.classList.toggle('is-on', k === cur); });

      if (spot) {
        // 先淡出，再瞬时换位，最后淡入 —— 避免高亮框在新旧两张图上"横穿"。
        spot.classList.remove('is-on');
        window.setTimeout(function () {
          place(cur);
          window.setTimeout(function () { spot.classList.add('is-on'); }, 90);
        }, 170);
      }
    };

    var stop = function () { if (timer) { window.clearInterval(timer); timer = null; } };
    var start = function () {
      stop();
      if (reduceMotion) return;
      timer = window.setInterval(function () { show(cur + 1); }, SWAP);
    };

    steps.forEach(function (b) {
      b.addEventListener('click', function () {
        show(parseInt(b.getAttribute('data-i'), 10) || 0);
        start();
      });
    });

    // 键盘：在步骤列表上按左右/上下切换
    box.querySelector('.steps').addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'ArrowDown' && k !== 'ArrowUp') return;
      e.preventDefault();
      var next = (k === 'ArrowRight' || k === 'ArrowDown') ? cur + 1 : cur - 1;
      steps[(next + steps.length) % steps.length].focus();
      show(next);
      start();
    });

    // 悬停 / 聚焦暂停，离开恢复
    box.addEventListener('mouseenter', stop);
    box.addEventListener('mouseleave', start);
    box.addEventListener('focusin', stop);
    box.addEventListener('focusout', start);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stop(); } else { start(); }
    });

    place(0);
    window.setTimeout(function () { if (spot) spot.classList.add('is-on'); }, 400);
    start();
  }

  /* ======================== 2. 滚动进场 ======================== */
  var rvs = Array.prototype.slice.call(document.querySelectorAll('.rv'));
  if (rvs.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      rvs.forEach(function (el) { el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
      rvs.forEach(function (el) { io.observe(el); });
    }
  }

  /* ======================== 3. 顶栏滚动阴影 ======================== */
  var hd = document.getElementById('hd');
  if (hd) {
    var onScroll = function () {
      hd.classList.toggle('is-stuck', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ======================== 4. 首屏演示视频 ========================
   * 默认停在封面截图上（不自动播），点中央播放键才加载并播放。
   * 播完 video 淡出、露出垫在下面的末帧截图 hero-end.webp —— 绝不留空白画面。
   * 状态机：idle（封面+播放键）→ playing（视频+暂停键）→ paused（画面+继续键）／ended（末帧+重播键）。 */
  var media = document.querySelector('.hero-media');
  var hv = document.querySelector('.hero-video');
  if (media && hv) {
    var playBtn = media.querySelector('.hv-play');
    var pauseBtn = document.querySelector('.hv-btn');
    var hvLbl = playBtn && playBtn.querySelector('.lbl');
    var hvSub = playBtn && playBtn.querySelector('.sub');
    var st = 'idle';

    var setState = function (s) {
      st = s;
      media.setAttribute('data-state', s);
      /* 中央大键只在 idle 显示（CSS 控制），播放/暂停/重播都走窗口条右侧的小键，
         这样暂停或播完时画面完全不被遮挡 —— 那一帧里的人口数字是重点 */
      if (pauseBtn) {
        pauseBtn.hidden = (s === 'idle');
        pauseBtn.setAttribute('data-state', s === 'playing' ? 'playing' : (s === 'ended' ? 'ended' : 'paused'));
        var bt = pauseBtn.querySelector('.hv-txt');
        if (bt) { bt.textContent = s === 'playing' ? '暂停' : (s === 'ended' ? '重播' : '继续'); }
        pauseBtn.setAttribute('aria-label',
          s === 'playing' ? '暂停产品演示视频'
            : (s === 'ended' ? '重新播放产品演示视频' : '继续播放产品演示视频'));
      }
      if (playBtn) {
        var lbl = s === 'ended' ? '重播演示' : (s === 'paused' ? '继续播放' : '播放演示');
        if (hvLbl && !playBtn.classList.contains('is-loading')) { hvLbl.textContent = lbl; }
        if (hvSub) { hvSub.textContent = s === 'ended' ? '再看一遍 18 秒演示' : '18 秒 · 车行 15 分钟可达范围'; }
        playBtn.setAttribute('aria-label',
          s === 'ended' ? '重新播放产品演示视频'
            : (s === 'paused' ? '继续播放产品演示视频' : '播放产品演示视频：车行 15 分钟可达范围，约 18 秒'));
      }
    };

    var doPlay = function () {
      if (st === 'ended' || hv.ended) {
        try { hv.currentTime = 0; } catch (e) { /* 元数据还没到位，忽略 */ }
      }
      /* 首次点：preload=none ⇒ 现拉 1MB，给个「加载中」反馈，别让用户以为没点到 */
      if (hv.readyState < 3 && playBtn) {
        playBtn.classList.add('is-loading');
        if (hvLbl) { hvLbl.textContent = '加载中…'; }
      }
      var pr = hv.play();
      if (pr && pr.catch) {
        pr.catch(function () {
          if (playBtn) { playBtn.classList.remove('is-loading'); }
          setState('idle');
        });
      }
    };

    hv.addEventListener('playing', function () {
      if (playBtn) { playBtn.classList.remove('is-loading'); }
      setState('playing');
    });
    hv.addEventListener('pause', function () {
      if (!hv.ended && st === 'playing') { setState('paused'); }
    });
    hv.addEventListener('ended', function () { setState('ended'); });

    if (playBtn) { playBtn.addEventListener('click', doPlay); }
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        if (st === 'playing') { hv.pause(); } else { doPlay(); }
      });
    }

    /* 切走标签页 / 滚出视口 ⇒ 暂停；回来不自动续播，等用户点（不跟用户抢） */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && !hv.paused) { hv.pause(); }
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting && !hv.paused) { hv.pause(); }
        });
      }, { threshold: 0.25 }).observe(hv);
    }

    setState('idle');
  }
})();
