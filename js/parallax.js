/**
 * 视差滚动引擎 —— 只服务「内容层」
 * ---------------------------------------------------------------------------
 * ⚠️ 不触碰固定背景视频（.bg-layer / #bg-video / #video-canvas 等），
 *    背景视频自始至终保持原样；视差全部作用在随页面滚动的正文元素上。
 *
 * 用法：给元素加 data-plx="<速度>" 即可
 *    <div data-plx="0.15">          → 位移 = 与视口中心的距离 × 0.15（带上下限）
 *    可选：data-plx-max="120"       → 位移上限（px，默认 120）
 *          data-plx-rot="0.02"      → 顺带按距离旋转（deg/px）
 *
 * 为什么用 transform 而不是独立 translate 属性：本文件刻意只挑
 * 「自身没有别的 transform」的元素做视差（需要自转/呼吸的元素都在 CSS 里
 * 另套了一层），这样 transform 就不会互相覆盖，老版 X5 内核也能跑。
 */
(function () {
  'use strict';

  if (window.__plxReady) return;
  window.__plxReady = true;

  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  var items = [];
  var vh = 0;
  var vw = 0;
  var ticking = false;
  var measured = false;

  /* ------------------------------------------------------------------ */
  /* 工具                                                                */
  /* ------------------------------------------------------------------ */

  function scrollY() {
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  /** 元素在文档里的纵向位置；用 offsetTop 累加 —— 不受 transform 影响，
   *  所以「已经带上视差位移」也能测准，无需先清零再测（免得每帧回流）。 */
  function docTop(el) {
    var y = 0;
    var n = el;
    var guard = 0;
    while (n && guard++ < 60) {
      y += n.offsetTop || 0;
      n = n.offsetParent;
    }
    return y;
  }

  function isSmallScreen() {
    return vw <= 760;
  }

  /* ------------------------------------------------------------------ */
  /* 收集 & 测量                                                         */
  /* ------------------------------------------------------------------ */

  function collect() {
    items = [];

    // 1) 显式标记的元素
    var marked = document.querySelectorAll('[data-plx]');
    for (var i = 0; i < marked.length; i++) {
      var el = marked[i];
      var depth = parseFloat(el.getAttribute('data-plx'));
      if (!depth || !isFinite(depth)) continue;
      items.push({
        el: el,
        depth: depth,
        max: parseFloat(el.getAttribute('data-plx-max')) || 120,
        rot: parseFloat(el.getAttribute('data-plx-rot')) || 0,
        lastY: null,
        lastR: null
      });
    }

    // 2) 各段落标题的内部分层（挂在 .section-header 的子节点上：
    //    父节点被 initReveal() 加了 .reveal，带 transform + transition，不能动）
    var headers = document.querySelectorAll('.section-header');
    var layers = [
      ['.section-eyebrow', 0.14, 26],
      ['.section-title', 0.06, 12],
      ['.section-desc', 0.10, 20]
    ];
    for (var h = 0; h < headers.length; h++) {
      for (var l = 0; l < layers.length; l++) {
        var t = headers[h].querySelector(layers[l][0]);
        if (!t) continue;
        items.push({
          el: t,
          depth: layers[l][1],
          max: layers[l][2],
          rot: 0,
          lastY: null,
          lastR: null,
          header: true
        });
      }
    }

    measure();
    if (window.__plx) window.__plx.items = items;   // 重新收集后同步给测试出口
    return items.length;
  }

  function measure() {
    vh = window.innerHeight || 1;
    vw = window.innerWidth || 1;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var box = it.el.offsetHeight || 0;
      it.center = docTop(it.el) + box / 2;
      // 视口之外很远的地方直接跳过 DOM 写入（省一半以上开销）
      it.limit = vh * 1.9;
    }
    measured = true;
  }

  /* ------------------------------------------------------------------ */
  /* 应用位移                                                            */
  /* ------------------------------------------------------------------ */

  function apply() {
    ticking = false;
    if (!measured || !items.length) return;

    var mid = scrollY() + vh / 2;
    var scale = isSmallScreen() ? 0.55 : 1;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var delta = mid - it.center;

      // 离视口太远：保持边界值即可（lastY 缓存会挡住重复写入）
      if (delta > it.limit) delta = it.limit;
      else if (delta < -it.limit) delta = -it.limit;

      var y = delta * it.depth * scale;
      if (y > it.max) y = it.max;
      else if (y < -it.max) y = -it.max;
      y = Math.round(y * 100) / 100;

      var r = it.rot ? Math.round(delta * it.rot * 100) / 100 : 0;

      if (y === it.lastY && r === it.lastR) continue;

      if (r !== 0) {
        it.el.style.transform = 'translate3d(0,' + y + 'px,0) rotate(' + r + 'deg)';
      } else {
        it.el.style.transform = 'translate3d(0,' + y + 'px,0)';
      }
      it.lastY = y;
      it.lastR = r;
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(apply);
  }

  var resizeTimer = 0;
  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      measure();
      apply();
    }, 140);
  }

  /* ------------------------------------------------------------------ */
  /* 引力场：指针光晕 + 真实数字                                            */
  /* ------------------------------------------------------------------ */

  function initField() {
    var field = document.querySelector('.plx-field');
    if (!field) return;

    // 指针跟随光晕（只在高精度指针设备上开）
    var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (canHover && !reduceMQ.matches) {
      field.addEventListener('pointermove', function (e) {
        var r = field.getBoundingClientRect();
        if (!r.width || !r.height) return;
        field.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(2) + '%');
        field.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(2) + '%');
      }, { passive: true });
    }

    initStats();
  }

  /** 数字滚动：直接从页面上真实渲染出来的卡片取数，永远和数据一致。
   *  ⚠️ 取数时机必须在「卡片渲染完成之后」——所以放在进入视口的那一刻才算，
   *     而不是脚本初始化时（本脚本是 defer 的，readyState 已是 interactive，
   *     执行时 main.js 的 DOMContentLoaded 处理还没跑，这时数项目是 0）。 */
  function initStats() {
    var nodes = document.querySelectorAll('.plx-stat-value');
    if (!nodes.length) return;

    var resolved = false;
    var targets = [];

    function resolve() {
      if (resolved) return targets;
      resolved = true;
      targets = [];
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var sel = node.getAttribute('data-src');
        var n = 0;
        if (sel) {
          try {
            n = document.querySelectorAll(sel).length;
          } catch (e) {
            n = 0;
          }
        } else {
          n = parseInt(node.getAttribute('data-target'), 10) || 0;
        }
        var wrap = node.closest ? node.closest('.plx-stat') : null;
        if (!n) {
          // 拿不到真实数字就把这一格藏起来，不摆假数据
          if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
          continue;
        }
        targets.push({ node: node, end: n, suffix: node.getAttribute('data-suffix') || '' });
      }
      return targets;
    }

    function run() {
      resolve().forEach(function (t) {
        if (reduceMQ.matches) {
          t.node.textContent = t.end + t.suffix;
          return;
        }
        var duration = 1300;
        var t0 = performance.now();
        function tick(now) {
          var p = Math.min((now - t0) / duration, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          t.node.textContent = Math.floor(eased * t.end) + t.suffix;
          if (p < 1) window.requestAnimationFrame(tick);
          else t.node.textContent = t.end + t.suffix;
        }
        window.requestAnimationFrame(tick);
      });
    }

    if (!('IntersectionObserver' in window)) { run(); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          run();
          io.disconnect();
        }
      });
    }, { threshold: 0.15 });

    io.observe(document.querySelector('.plx-stats') || nodes[0]);
  }

  /* ------------------------------------------------------------------ */
  /* 启动                                                                */
  /* ------------------------------------------------------------------ */

  function init() {
    if (reduceMQ.matches) {
      // 尊重系统「减弱动态效果」：不注册任何位移逻辑
      document.documentElement.classList.add('plx-reduced');
      initField();     // 只保留数字填充（不滚动动画）
      return;
    }

    collect();
    apply();
    initField();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });

    // 图片 / 字体 / 动态卡片加载后版面会变高，重新测量一次
    window.addEventListener('load', function () {
      collect();
      apply();
    });

    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () { measure(); apply(); }, 160);
      });
      ro.observe(document.body);
    }

    reduceMQ.addEventListener && reduceMQ.addEventListener('change', function (e) {
      if (e.matches) {
        // 用户中途改成「减弱动态效果」→ 清掉所有位移
        items.forEach(function (it) { it.el.style.transform = ''; });
        document.documentElement.classList.add('plx-reduced');
      }
    });

    // 供测试脚本读取真实状态
    window.__plx = {
      items: items,
      collect: collect,
      measure: measure,
      apply: apply,
      count: function () { return items.length; },
      read: function () {
        return items.map(function (it) {
          return {
            el: it.el,
            cls: it.el.className,
            depth: it.depth,
            y: it.lastY,
            center: Math.round(it.center)
          };
        });
      }
    };
  }

  var started = false;
  function bootstrap() {
    if (started) return;
    started = true;
    init();
  }

  // ⚠️ 关键：必须排到 main.js 的 DOMContentLoaded 处理之后。
  //    本脚本是 defer 的，执行时 document.readyState 已经是 'interactive'
  //    （规范：解析完成 → 置 interactive → 跑 defer 脚本 → 才触发 DOMContentLoaded），
  //    所以这里不能写成「非 loading 就直接跑」，否则会早于卡片渲染，
  //    统计数字会因为「取不到数」被当成 0 处理。
  if (document.readyState === 'loading' || document.readyState === 'interactive') {
    document.addEventListener('DOMContentLoaded', bootstrap);
    // 兜底：脚本若是在 DOMContentLoaded 之后才被注入，保证仍会初始化
    window.setTimeout(function () {
      if (!started && document.readyState !== 'loading') bootstrap();
    }, 1500);
  } else {
    bootstrap();
  }
})();
