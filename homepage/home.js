/* ============================================================================
 * 选址赢家Online 产品主页（/home/）交互脚本
 *
 * 🔴 为什么必须外置成独立文件，而不是写在 index.html 里：
 *    nginx 对本站下发的内容安全策略为
 *      Content-Security-Policy: … script-src 'self'; …
 *    其中「不含 'unsafe-inline'」⇒ 浏览器会**直接拒绝执行**页面内的
 *    <script>…</script> 内联块（既包括外链前的老轮播脚本，也包括任何
 *    后加的内联交互）。
 *    症状：页面样式正常（style-src 有 'unsafe-inline'），但所有 JS 静默失效，
 *    console 里既不抛异常、`errors` 也抓不到 —— 极易误判成"代码没写对"。
 *    ⇒ 新增交互请一律写进本文件（同源加载，命中 script-src 'self'）。
 *
 * 回滚/排查：若本文件 404，页面交互全部失效；用
 *    curl -sI https://mka-online.cn/home/home.js
 * 探活，并核对 <script src="home.js" defer> 是否在 </body> 之前。
 * ========================================================================== */
(function () {
  'use strict';

  /* ======================== 1. 主视觉轮播 ======================== */
  var track = document.getElementById('bannerTrack');
  if (track) {
    var dots = Array.prototype.slice.call(document.querySelectorAll('#bannerDots button'));
    var prevBtn = document.querySelector('.banner-prev');
    var nextBtn = document.querySelector('.banner-next');
    var slider = document.getElementById('mainBanner');
    var idx = 0;
    var timer = null;
    var SLIDES = 3;
    var INTERVAL = 4000;

    var stop = function () {
      if (timer) { clearInterval(timer); timer = null; }
    };
    var goTo = function (n) {
      idx = (n + SLIDES) % SLIDES;
      track.style.transform = 'translateX(-' + (idx * 100 / SLIDES) + '%)';
      dots.forEach(function (d, i) { d.classList.toggle('active', i === idx); });
    };
    var next = function () { goTo(idx + 1); };
    var start = function () { stop(); timer = setInterval(next, INTERVAL); };

    if (nextBtn) nextBtn.addEventListener('click', function () { next(); start(); });
    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(idx - 1); start(); });
    dots.forEach(function (d) {
      d.addEventListener('click', function () { goTo(parseInt(d.dataset.i, 10)); start(); });
    });

    if (slider) {
      // 悬停暂停，移出恢复
      slider.addEventListener('mouseenter', stop);
      slider.addEventListener('mouseleave', start);
      // 触摸滑动支持
      var touchX = null;
      slider.addEventListener('touchstart', function (e) {
        touchX = e.touches[0].clientX;
        stop();
      }, { passive: true });
      slider.addEventListener('touchend', function (e) {
        if (touchX === null) return;
        var dx = e.changedTouches[0].clientX - touchX;
        if (dx > 40) { goTo(idx - 1); } else if (dx < -40) { goTo(idx + 1); }
        touchX = null;
        start();
      }, { passive: true });
    }

    start();
  }

  /* ======================== 2. 移动端导航菜单 ========================
   * 修复前：≤960px 时 .nav 被 display:none 隐藏，而 .menu-toggle（☰）没有任何
   * 点击绑定 ⇒ 手机访客既点不动汉堡、也拿不到全部区块锚点。
   * a11y：按钮带 aria-label 与 aria-expanded 动态切换（读屏可播报展开状态）。 */
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.setAttribute('type', 'button');
    toggle.setAttribute('aria-label', '展开导航菜单');
    toggle.setAttribute('aria-expanded', 'false');

    var closeMenu = function () {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', '展开导航菜单');
      toggle.textContent = '☰';
    };

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var opened = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', opened ? 'true' : 'false');
      toggle.setAttribute('aria-label', opened ? '收起导航菜单' : '展开导航菜单');
      toggle.textContent = opened ? '✕' : '☰';
    });

    // 点击任一锚点后自动收起
    nav.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'A') closeMenu();
    });

    // 点击面板外部收起
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target) && !toggle.contains(e.target)) closeMenu();
    });

    // 视口放大回桌面布局时收起
    window.addEventListener('resize', function () {
      if (window.innerWidth > 960) closeMenu();
    });
  }
})();
