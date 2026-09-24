/* ============================================================
 * AI 图层分离 · 主逻辑
 *  - 本地 AI 引擎（onnxruntime-web + 内嵌显著性模型，无外部请求）
 *  - 一键拆分：主体 → 次要元素 → 背景（被挡住的背景自动补全）
 *  - 手动点选拆分（按颜色容差）
 *  - 导出分层 PSD（js/psd.js）
 *  - 高清放大：多步渐进重采样 + 锐化
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function ss(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function fmtBytes(n) {
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function stamp() {
    var d = new Date(), p = function (v) { return (v < 10 ? '0' : '') + v; };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* ---------------- 状态 ---------------- */
  var S = {
    engineReady: false,
    session: null,
    busy: false,
    /* 拆分 */
    img: null, W: 0, H: 0,
    layers: [],            /* 自底向上 */
    pickSeq: 0,
    /* 放大 */
    img2: null, W2: 0, H2: 0, out2: null
  };
  window.__appTest = { S: S };   /* 测试钩子 */

  /* ---------------- 状态条 ---------------- */
  function setModel(pct, txt, cls) {
    $('modelPct').textContent = pct + '%';
    $('modelProgress').style.width = pct + '%';
    if (txt) $('modelStatus').textContent = txt;
    $('modelDetail').textContent = '';
    if (cls === 'ok') $('modelBar').classList.add('ready');
    if (cls === 'err') $('modelBar').classList.add('error');
  }
  function setStatus(msg, cls) {
    var el = $('splitStatus');
    el.textContent = msg || '';
    el.className = 'status-line' + (cls ? ' ' + cls : '');
  }
  function setStatus2(msg, cls) {
    var el = $('scaleStatus');
    el.textContent = msg || '';
    el.className = 'status-line' + (cls ? ' ' + cls : '');
  }

  /* ---------------- 引擎启动 ---------------- */
  var engineStarted = false;
  async function initEngine() {
    if (engineStarted) return;
    engineStarted = true;
    try {
      setModel(10, '正在启动本地 AI 引擎…');
      ort.env.wasm.wasmBinary = b64ToBytes(window.__ORT_WASM_B64);
      ort.env.wasm.numThreads = 1;
      setModel(35, '正在加载拆图模型…');
      var bytes = b64ToBytes(window.__U2NETP_B64);
      S.session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      S.engineReady = true;
      setModel(100, '本地 AI 引擎已就绪', 'ok');
      $('modelDetail').textContent = '模型内嵌在页面里，首次加载后浏览器会缓存';
      $('splitBtn').disabled = false;
    } catch (e) {
      setModel(100, 'AI 引擎启动失败', 'err');
      $('modelDetail').textContent = '建议用最新版 Chrome 或 Edge 打开本页面';
      setStatus('AI 引擎没跑起来：' + (e && e.message ? e.message : e), 'err');
    }
  }

  /* defer 脚本在 load 前执行完，等 load 再启动（engineStarted 防重入） */
  if (document.readyState === 'complete') initEngine();
  else window.addEventListener('load', initEngine);

  /* ---------------- 模型推理 ---------------- */
  var IN = 320;
  async function runModel(srcCanvas) {
    var cv = mkCanvas(IN, IN);
    ctx2d(cv).drawImage(srcCanvas, 0, 0, IN, IN);
    var d = ctx2d(cv).getImageData(0, 0, IN, IN).data;
    var px = IN * IN;
    var t = new Float32Array(px * 3);
    var mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (var i = 0, p = 0; i < px; i++, p += 4) {
      t[i] = (d[p] / 255 - mean[0]) / std[0];
      t[px + i] = (d[p + 1] / 255 - mean[1]) / std[1];
      t[px * 2 + i] = (d[p + 2] / 255 - mean[2]) / std[2];
    }
    var feeds = {};
    feeds[S.session.inputNames[0]] = new ort.Tensor('float32', t, [1, 3, IN, IN]);
    var res = await S.session.run(feeds);
    var m = res[S.session.outputNames[0]].data;
    var mn = 1e9, mx = -1e9;
    for (var j = 0; j < m.length; j++) { if (m[j] < mn) mn = m[j]; if (m[j] > mx) mx = m[j]; }
    var r = mx - mn || 1;
    var norm = new Float32Array(px);
    for (var k = 0; k < px; k++) norm[k] = (m[k] - mn) / r;
    return norm;
  }

  /* norm(320²) -> 分析尺寸灰度图 */
  function normToGray(norm, aw, ah) {
    var c1 = mkCanvas(IN, IN), id = ctx2d(c1).createImageData(IN, IN);
    for (var i = 0; i < norm.length; i++) {
      var v = clamp(norm[i], 0, 1) * 255;
      id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    ctx2d(c1).putImageData(id, 0, 0);
    var c2 = mkCanvas(aw, ah);
    ctx2d(c2).drawImage(c1, 0, 0, aw, ah);
    return ctx2d(c2).getImageData(0, 0, aw, ah).data;
  }

  /* 连通域筛选：阈值 + 面积过滤，返回 Float32 软掩码（0..1） */
  function refineMask(gray, aw, ah, union, minAreaPct) {
    var n = aw * ah;
    var soft = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var v = ss(0.32, 0.72, gray[i * 4] / 255);
      if (union[i] > 0.5) v = 0;
      soft[i] = v;
    }
    /* 二值化后找连通域 */
    var bin = new Uint8Array(n);
    for (var b = 0; b < n; b++) bin[b] = soft[b] > 0.5 ? 1 : 0;
    var label = new Int32Array(n);
    var queue = new Int32Array(n);
    var minA = Math.max(80, Math.round(n * minAreaPct));
    var keep = new Uint8Array(n);
    var comp = 0;
    for (var s = 0; s < n; s++) {
      if (!bin[s] || label[s]) continue;
      comp++;
      var head = 0, tail = 0, area = 0;
      queue[tail++] = s; label[s] = comp;
      while (head < tail) {
        var cur = queue[head++];
        area++;
        var x = cur % aw, y = (cur / aw) | 0;
        if (x > 0 && bin[cur - 1] && !label[cur - 1]) { label[cur - 1] = comp; queue[tail++] = cur - 1; }
        if (x < aw - 1 && bin[cur + 1] && !label[cur + 1]) { label[cur + 1] = comp; queue[tail++] = cur + 1; }
        if (y > 0 && bin[cur - aw] && !label[cur - aw]) { label[cur - aw] = comp; queue[tail++] = cur - aw; }
        if (y < ah - 1 && bin[cur + aw] && !label[cur + aw]) { label[cur + aw] = comp; queue[tail++] = cur + aw; }
      }
      if (area >= minA) {
        for (var q = 0; q < tail; q++) keep[queue[q]] = 1;
      }
    }
    var out = new Float32Array(n), kept = 0;
    for (var o = 0; o < n; o++) {
      if (keep[o]) { out[o] = soft[o]; kept++; }
    }
    return { mask: out, area: kept };
  }

  /* 分析掩码 -> 全尺寸羽化 alpha（Uint8） */
  function maskToAlpha(mask, aw, ah, W, H, blurPx) {
    var c1 = mkCanvas(aw, ah), id = ctx2d(c1).createImageData(aw, ah);
    for (var i = 0; i < aw * ah; i++) {
      var v = clamp(mask[i], 0, 1) * 255;
      id.data[i * 4] = 255; id.data[i * 4 + 1] = 255; id.data[i * 4 + 2] = 255;
      id.data[i * 4 + 3] = v;
    }
    ctx2d(c1).putImageData(id, 0, 0);
    var c2 = mkCanvas(W, H), cx = ctx2d(c2);
    cx.filter = 'blur(' + (blurPx || 1.3) + 'px)';
    cx.drawImage(c1, 0, 0, W, H);
    cx.filter = 'none';
    var d = cx.getImageData(0, 0, W, H).data;
    var a = new Uint8Array(W * H);
    for (var p = 0; p < a.length; p++) a[p] = d[p * 4 + 3];
    return a;
  }

  /* 按全尺寸 alpha 抠出图层（含 bbox 裁剪） */
  function extractLayer(alpha, W, H, srcData, name) {
    var minx = W, miny = H, maxx = -1, maxy = -1;
    for (var y = 0; y < H; y++) {
      var row = y * W;
      for (var x = 0; x < W; x++) {
        if (alpha[row + x] > 12) {
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
    }
    if (maxx < 0) return null;
    var pad = Math.max(6, Math.round(Math.min(W, H) * 0.008));
    minx = Math.max(0, minx - pad); miny = Math.max(0, miny - pad);
    maxx = Math.min(W - 1, maxx + pad); maxy = Math.min(H - 1, maxy + pad);
    var w = maxx - minx + 1, h = maxy - miny + 1;
    var cv = mkCanvas(w, h), id = ctx2d(cv).createImageData(w, h);
    for (var yy = 0; yy < h; yy++) {
      var src = (yy + miny) * W, dst = yy * w;
      for (var xx = 0; xx < w; xx++) {
        var si = src + xx, di = (dst + xx) * 4;
        id.data[di] = srcData[si * 4];
        id.data[di + 1] = srcData[si * 4 + 1];
        id.data[di + 2] = srcData[si * 4 + 2];
        id.data[di + 3] = alpha[si];
      }
    }
    ctx2d(cv).putImageData(id, 0, 0);
    return { canvas: cv, x: minx, y: miny, name: name, visible: true, w: w, h: h };
  }

  /* 背景补全：把掩码区域用周围像素填回去（小图扩散 + 全尺寸融合） */
  function inpaint(fullCv, mask, aw, ah) {
    var W = fullCv.width, H = fullCv.height;
    var sLong = 256;
    var sc = Math.min(1, sLong / Math.max(W, H));
    var sw = Math.max(8, Math.round(W * sc)), sh = Math.max(8, Math.round(H * sc));
    /* 小图源 */
    var srcS = mkCanvas(sw, sh);
    ctx2d(srcS).drawImage(fullCv, 0, 0, sw, sh);
    var sd = ctx2d(srcS).getImageData(0, 0, sw, sh);
    /* 小图掩码（放大涂抹范围 2px，避免留边） */
    var mS = mkCanvas(sw, sh);
    ctx2d(mS).drawImage(mask, 0, 0, sw, sh);
    var md = ctx2d(mS).getImageData(0, 0, sw, sh).data;
    var hole = new Uint8Array(sw * sh);
    for (var i = 0; i < hole.length; i++) hole[i] = md[i * 4 + 3] > 100 ? 1 : 0;
    /* 膨胀 2 轮 */
    for (var it = 0; it < 2; it++) {
      var cp = new Uint8Array(hole);
      for (var y2 = 0; y2 < sh; y2++) for (var x2 = 0; x2 < sw; x2++) {
        var ii = y2 * sw + x2;
        if (!cp[ii] && ((x2 > 0 && cp[ii - 1]) || (x2 < sw - 1 && cp[ii + 1]) || (y2 > 0 && cp[ii - sw]) || (y2 < sh - 1 && cp[ii + sw]))) hole[ii] = 1;
      }
    }
    /* 扫描线扩散填充（Gauss-Seidel，四个方向轮着来） */
    for (var round = 0; round < 60; round++) {
      var changed = 0;
      var dirs = [[1, 0], [sw, 0], [-1, 0], [-sw, 0]];
      for (var di = 0; di < 4; di++) {
        var step = dirs[di][0];
        var start = dirs[di][0] > 0 ? 0 : hole.length - 1;
        for (var p2 = start; p2 >= 0 && p2 < hole.length; p2 += step) {
          if (!hole[p2]) continue;
          var x3 = p2 % sw, y3 = (p2 / sw) | 0, cnt = 0, r = 0, g = 0, b = 0;
          if (x3 > 0) { var q = p2 - 1; r += sd.data[q * 4]; g += sd.data[q * 4 + 1]; b += sd.data[q * 4 + 2]; cnt++; }
          if (x3 < sw - 1) { var q2 = p2 + 1; r += sd.data[q2 * 4]; g += sd.data[q2 * 4 + 1]; b += sd.data[q2 * 4 + 2]; cnt++; }
          if (y3 > 0) { var q3 = p2 - sw; r += sd.data[q3 * 4]; g += sd.data[q3 * 4 + 1]; b += sd.data[q3 * 4 + 2]; cnt++; }
          if (y3 < sh - 1) { var q4 = p2 + sw; r += sd.data[q4 * 4]; g += sd.data[q4 * 4 + 1]; b += sd.data[q4 * 4 + 2]; cnt++; }
          if (cnt) {
            sd.data[p2 * 4] = r / cnt; sd.data[p2 * 4 + 1] = g / cnt; sd.data[p2 * 4 + 2] = b / cnt;
            sd.data[p2 * 4 + 3] = 255; changed++;
          }
        }
      }
      if (!changed) break;
    }
    ctx2d(srcS).putImageData(sd, 0, 0);
    /* 全尺寸融合：羽化掩码 */
    var fill = mkCanvas(W, H);
    ctx2d(fill).drawImage(srcS, 0, 0, W, H);
    var mFull = mkCanvas(W, H), mf = ctx2d(mFull);
    mf.filter = 'blur(' + Math.max(2, Math.round(W / 600)) + 'px)';
    mf.drawImage(mask, 0, 0, W, H);
    mf.filter = 'none';
    var out = mkCanvas(W, H), oc = ctx2d(out);
    oc.drawImage(fullCv, 0, 0);
    oc.globalAlpha = 1;
    /* 先画 fill，再用源图 alpha 反向遮罩太绕 —— 直接：先 fill，后按掩码把源图盖回去（掩码外区域） */
    oc.drawImage(fill, 0, 0);                    /* 整块填充版 */
    var mTmp = ctx2d(mFull).getImageData(0, 0, W, H).data;
    /* 用「掩码的反向」把原内容贴回来 = 掩码内保留填充 */
    var rev = mkCanvas(W, H), rc = ctx2d(rev);
    var rid = rc.createImageData(W, H);
    for (var r2 = 0; r2 < W * H; r2++) {
      rid.data[r2 * 4] = 255; rid.data[r2 * 4 + 1] = 255; rid.data[r2 * 4 + 2] = 255;
      rid.data[r2 * 4 + 3] = 255 - mTmp[r2 * 4 + 3];
    }
    rc.putImageData(rid, 0, 0);
    var keepCv = mkCanvas(W, H), kc = ctx2d(keepCv);
    kc.drawImage(fullCv, 0, 0);
    kc.globalCompositeOperation = 'destination-in';
    kc.drawImage(rev, 0, 0);
    oc.globalCompositeOperation = 'source-over';
    oc.drawImage(keepCv, 0, 0);
    return out;
  }

  /* ---------------- 一键拆分 ---------------- */
  async function autoSplit(passes) {
    if (!S.img || S.busy || !S.engineReady) return;
    S.busy = true;
    $('splitBtn').disabled = true;
    clearLayers();
    try {
      var W = S.W, H = S.H;
      var fullCv = mkCanvas(W, H);
      ctx2d(fullCv).drawImage(S.img, 0, 0, W, H);
      var fullData = ctx2d(fullCv).getImageData(0, 0, W, H).data;
      var scaleA = Math.min(1, 512 / Math.max(W, H));
      var aw = Math.max(64, Math.round(W * scaleA)), ah = Math.max(64, Math.round(H * scaleA));
      var union = new Float32Array(aw * ah);
      var found = [];
      var names = ['主体', '元素 2', '元素 3'];

      for (var p = 0; p < passes; p++) {
        setStatus(p === 0 ? 'AI 正在识别画面里的主要元素…' : '正在分离第 ' + (p + 1) + ' 层元素…');
        await tick();
        var norm = await runModel(fullCv);
        var gray = normToGray(norm, aw, ah);
        var rm = refineMask(gray, aw, ah, union, 0.012);
        if (rm.area < aw * ah * 0.01) {
          if (p === 0) setStatus('这张图没有分离出明显元素，试试关闭其他软件后重试，或换一张元素更分明的图', 'err');
          break;
        }
        /* 掩码画布（分析尺寸） */
        var mCv = mkCanvas(aw, ah), mi = ctx2d(mCv).createImageData(aw, ah);
        for (var m = 0; m < aw * ah; m++) {
          mi.data[m * 4] = 255; mi.data[m * 4 + 1] = 255; mi.data[m * 4 + 2] = 255;
          mi.data[m * 4 + 3] = clamp(rm.mask[m], 0, 1) * 255;
        }
        ctx2d(mCv).putImageData(mi, 0, 0);
        for (var u = 0; u < union.length; u++) union[u] = Math.max(union[u], rm.mask[u] > 0.4 ? 1 : 0);
        var alpha = maskToAlpha(rm.mask, aw, ah, W, H, 1.3);
        var layer = extractLayer(alpha, W, H, fullData, names[p] || ('元素 ' + (p + 1)));
        if (layer) found.push(layer);
        setStatus('正在智能补全被挡住的背景…');
        await tick();
        fullCv = inpaint(fullCv, mCv, aw, ah);
      }

      if (!found.length) { S.busy = false; $('splitBtn').disabled = false; renderStage(); return; }

      /* 背景层（补全后的残图） */
      var bg = { canvas: fullCv, x: 0, y: 0, name: '背景（已补全）', visible: true, w: W, h: H };
      S.layers = [bg];
      for (var f = found.length - 1; f >= 0; f--) S.layers.push(found[f]);

      setStatus('拆好了！共 ' + S.layers.length + ' 个图层，可以导出 PSD 继续编辑', 'ok');
    } catch (e) {
      setStatus('拆分时出错了：' + (e && e.message ? e.message : e), 'err');
    }
    S.busy = false;
    $('splitBtn').disabled = false;
    renderLayerList();
    renderStage();
  }
  function tick() { return new Promise(function (r) { setTimeout(r, 30); }); }

  /* ---------------- 手动点选 ---------------- */
  function pickAt(fx, fy) {
    if (!S.img || S.busy) return;
    var W = S.W, H = S.H;
    var scaleA = Math.min(1, 512 / Math.max(W, H));
    var aw = Math.max(64, Math.round(W * scaleA)), ah = Math.max(64, Math.round(H * scaleA));
    var ax = clamp(Math.round(fx * scaleA), 0, aw - 1);
    var ay = clamp(Math.round(fy * scaleA), 0, ah - 1);
    var src = mkCanvas(W, H);
    ctx2d(src).drawImage(S.img, 0, 0, W, H);
    var ad = ctx2d(src).getImageData(0, 0, aw, ah);
    var tol = parseInt($('pickTol').value, 10) || 40;
    var si = (ay * aw + ax) * 4;
    var sr = ad.data[si], sg = ad.data[si + 1], sb = ad.data[si + 2];
    var tol2 = tol * tol * 3;
    var n = aw * ah;
    var bin = new Uint8Array(n);
    var stack = new Int32Array(n);
    var head = 0, tail = 0, area = 0;
    stack[tail++] = ay * aw + ax;
    bin[ay * aw + ax] = 1;
    while (head < tail) {
      var cur = stack[head++];
      area++;
      var x = cur % aw, y = (cur / aw) | 0;
      var nb = [x > 0 ? cur - 1 : -1, x < aw - 1 ? cur + 1 : -1, y > 0 ? cur - aw : -1, y < ah - 1 ? cur + aw : -1];
      for (var k = 0; k < 4; k++) {
        var q = nb[k];
        if (q < 0 || bin[q]) continue;
        var p4 = q * 4;
        var dr = ad.data[p4] - sr, dg = ad.data[p4 + 1] - sg, db2 = ad.data[p4 + 2] - sb;
        if (dr * dr + dg * dg + db2 * db2 <= tol2) { bin[q] = 1; stack[tail++] = q; }
      }
    }
    if (area < 24) { setStatus('点到的区域太小了，把「容差」调大一点再试试', 'err'); return; }
    var mask = new Float32Array(n);
    for (var m2 = 0; m2 < n; m2++) mask[m2] = bin[m2];
    var alpha = maskToAlpha(mask, aw, ah, W, H, 1.1);
    var fullData = ctx2d(src).getImageData(0, 0, W, H).data;
    S.pickSeq++;
    var layer = extractLayer(alpha, W, H, fullData, '选区 ' + S.pickSeq);
    if (layer) {
      S.layers.push(layer);
      setStatus('已把点中的区域拆成新图层「' + layer.name + '」', 'ok');
    }
    renderLayerList();
    renderStage();
  }

  /* ---------------- 图层管理 ---------------- */
  function clearLayers() { S.layers = []; S.pickSeq = 0; renderLayerList(); renderStage(); }
  function removeLayer(idx) { S.layers.splice(idx, 1); renderLayerList(); renderStage(); }

  function renderLayerList() {
    var box = $('layerList');
    box.innerHTML = '';
    $('layerCount').textContent = S.layers.length;
    for (var i = 0; i < S.layers.length; i++) {
      (function (idx) {
        var L = S.layers[idx];
        var row = document.createElement('div');
        row.className = 'layer-row' + (L.visible ? '' : ' off');
        var th = document.createElement('div');
        th.className = 'layer-thumb';
        var tc = mkCanvas(44, 44), tcx = ctx2d(tc);
        var fit = Math.min(44 / L.canvas.width, 44 / L.canvas.height);
        var tw = L.canvas.width * fit, thh = L.canvas.height * fit;
        tcx.drawImage(L.canvas, (44 - tw) / 2, (44 - thh) / 2, tw, thh);
        th.appendChild(tc);
        var nameBox = document.createElement('div');
        nameBox.className = 'layer-name';
        nameBox.textContent = L.name;
        var sizeSpan = document.createElement('span');
        sizeSpan.className = 'layer-size';
        sizeSpan.textContent = L.canvas.width + '×' + L.canvas.height;
        nameBox.appendChild(sizeSpan);
        var eye = document.createElement('button');
        eye.className = 'icon-btn'; eye.type = 'button';
        eye.textContent = L.visible ? '👁' : '🚫';
        eye.title = '显示 / 隐藏';
        eye.onclick = function () { L.visible = !L.visible; renderLayerList(); renderStage(); };
        var dl = document.createElement('button');
        dl.className = 'icon-btn'; dl.type = 'button'; dl.textContent = '⬇';
        dl.title = '下载这一层（PNG 透明图）';
        dl.onclick = function () {
          L.canvas.toBlob(function (b) { downloadBlob(b, L.name + '.png'); }, 'image/png');
        };
        var del = document.createElement('button');
        del.className = 'icon-btn'; del.type = 'button'; del.textContent = '✕';
        del.title = '删除这一层';
        del.onclick = function () { removeLayer(idx); };
        row.appendChild(th); row.appendChild(nameBox); row.appendChild(eye); row.appendChild(dl); row.appendChild(del);
        box.appendChild(row);
      })(i);
    }
    $('psdBtn').disabled = S.layers.length === 0;
  }

  function renderStage() {
    var cv = $('stageCv');
    if (!S.img) { cv.width = cv.height = 0; return; }
    cv.width = S.W; cv.height = S.H;
    var cx = ctx2d(cv);
    cx.clearRect(0, 0, S.W, S.H);
    for (var i = 0; i < S.layers.length; i++) {
      var L = S.layers[i];
      if (!L.visible) continue;
      cx.drawImage(L.canvas, L.x, L.y);
    }
  }

  /* ---------------- PSD 导出 ---------------- */
  async function exportPsd() {
    if (!S.layers.length || S.busy) return;
    S.busy = true;
    $('psdBtn').disabled = true;
    setStatus('正在打包 PSD 分层文件…');
    await tick();
    try {
      var list = [];
      for (var i = 0; i < S.layers.length; i++) {
        var L = S.layers[i];
        list.push({ canvas: L.canvas, x: L.x, y: L.y, name: L.name, visible: L.visible });
      }
      var blob = await PSDWriter.buildPsdBlob(list, S.W, S.H);
      window.__appTest.lastPsd = blob;
      downloadBlob(blob, '图层分离_' + stamp() + '.psd');
      setStatus('PSD 已导出（' + fmtBytes(blob.size) + '），可以用 Photoshop、Photopea 等打开继续编辑', 'ok');
    } catch (e) {
      setStatus('导出 PSD 出错了：' + (e && e.message ? e.message : e), 'err');
    }
    S.busy = false;
    $('psdBtn').disabled = false;
  }

  /* ---------------- 高清放大 ---------------- */
  function sharpenKernel(a) {
    return '0 ' + (-a) + ' 0 ' + (-a) + ' ' + (1 + 4 * a) + ' ' + (-a) + ' 0 ' + (-a) + ' 0';
  }
  function ensureSvgFilter() {
    if ($('usmFilterDef')) return $('usmFilterDef');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position:absolute;width:0;height:0');
    var f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', 'usmFilterDef');
    f.setAttribute('x', '-5%'); f.setAttribute('y', '-5%');
    f.setAttribute('width', '110%'); f.setAttribute('height', '110%');
    var cm = document.createElementNS('http://www.w3.org/2000/svg', 'feConvolveMatrix');
    cm.setAttribute('order', '3');
    cm.setAttribute('preserveAlpha', 'true');
    cm.setAttribute('kernelMatrix', sharpenKernel(0.4));
    cm.setAttribute('id', 'usmKernel');
    f.appendChild(cm);
    svg.appendChild(f);
    document.body.appendChild(svg);
    return f;
  }
  function setSharpAmount(a) {
    ensureSvgFilter();
    $('usmKernel').setAttribute('kernelMatrix', sharpenKernel(a));
  }

  async function doUpscale() {
    if (!S.img2 || S.busy) return;
    S.busy = true;
    $('scaleBtn').disabled = true;
    $('dlBtn2').disabled = true;
    try {
      var s = parseInt($('scaleSel').value, 10) || 2;
      var sharp = (parseInt($('sharpRange').value, 10) || 55) / 100;
      var outW = Math.round(S.W2 * s), outH = Math.round(S.H2 * s);
      if (outW * outH > 42000000) throw new Error('这张图放大后太大啦（' + outW + '×' + outH + '），浏览器装不下，换小一点的图或低一点的倍数');
      setStatus2('正在第 1 步渐进放大…');
      await tick();
      var n = Math.max(1, Math.ceil(Math.log(s) / Math.log(1.9)));
      var step = Math.pow(s, 1 / n);
      var cur = mkCanvas(S.W2, S.H2);
      ctx2d(cur).drawImage(S.img2, 0, 0, S.W2, S.H2);
      for (var i = 1; i <= n; i++) {
        var tw = (i === n) ? outW : Math.round(S.W2 * Math.pow(step, i));
        var th = (i === n) ? outH : Math.round(S.H2 * Math.pow(step, i));
        var nx = mkCanvas(tw, th), nc = ctx2d(nx);
        nc.imageSmoothingEnabled = true;
        nc.imageSmoothingQuality = 'high';
        nc.drawImage(cur, 0, 0, tw, th);
        var amt = (i === n) ? (0.15 + sharp * 1.05) : (0.12 + sharp * 0.25);
        setSharpAmount(amt);
        var fx = mkCanvas(tw, th), fc = ctx2d(fx);
        fc.imageSmoothingEnabled = true;
        fc.imageSmoothingQuality = 'high';
        fc.filter = 'url(#usmFilterDef)';
        fc.drawImage(nx, 0, 0);
        fc.filter = 'none';
        cur = fx;
        if (i < n) { setStatus2('正在第 ' + (i + 1) + ' 步渐进放大…'); await tick(); }
      }
      S.out2 = cur;
      renderCompare();
      $('dlBtn2').disabled = false;
      setStatus2('放大完成！' + S.W2 + '×' + S.H2 + ' → ' + outW + '×' + outH + '，拖动中间的线对比前后效果', 'ok');
    } catch (e) {
      setStatus2('放大时出错了：' + (e && e.message ? e.message : e), 'err');
    }
    S.busy = false;
    $('scaleBtn').disabled = false;
  }

  function renderCompare() {
    if (!S.img2) return;
    var bw = S.W2, bh = S.H2;
    var b = $('cmpBefore'), a = $('cmpAfter');
    b.width = bw; b.height = bh;
    ctx2d(b).drawImage(S.img2, 0, 0, bw, bh);
    if (S.out2) {
      a.width = S.out2.width; a.height = S.out2.height;
      ctx2d(a).drawImage(S.out2, 0, 0);
    }
    /* 显示尺寸对齐：两张 canvas 都用 CSS 压到同一显示框 */
    var wrap = $('cmpWrap');
    var fit = Math.min((wrap.clientWidth - 2) / bw, 560 / bh, 1.6);
    var dw = Math.round(bw * fit), dh = Math.round(bh * fit);
    b.style.width = dw + 'px'; b.style.height = dh + 'px';
    a.style.width = dw + 'px'; a.style.height = dh + 'px';
    var clip = $('cmpClip');
    clip.style.width = dw + 'px'; clip.style.height = dh + 'px';
    clip.style.left = '50%'; clip.style.transform = 'translateX(-50%)';
    setCompare($('cmpRange') ? 50 : 50);
    $('scaleInfo').textContent = S.out2 ? (S.W2 + '×' + S.H2 + ' → ' + S.out2.width + '×' + S.out2.height) : '';
  }
  function setCompare(pct) {
    var wrap = $('cmpWrap'), clip = $('cmpClip'), handle = $('cmpHandle');
    if (!wrap || !clip) return;
    var rect = wrap.getBoundingClientRect();
    var dw = parseFloat(clip.style.width) || rect.width;
    var left = (rect.width - dw) / 2;
    var x = left + dw * pct / 100;
    clip.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
    handle.style.left = x + 'px';
  }

  /* ---------------- 载入图片 ---------------- */
  function loadFile(file, which) {
    if (!file || !/^image\//.test(file.type)) { (which === 2 ? setStatus2 : setStatus)('这不是图片文件，换一张试试', 'err'); return; }
    var fr = new FileReader();
    fr.onload = function () { loadFromDataURL(fr.result, which); };
    fr.onerror = function () { (which === 2 ? setStatus2 : setStatus)('图片读取失败，换一张试试', 'err'); };
    fr.readAsDataURL(file);
  }

  function loadFromDataURL(dataURL, which) {
    var im = new Image();
    im.onload = function () {
      var w = im.naturalWidth, h = im.naturalHeight;
      if (w * h > 40000000) { (which === 2 ? setStatus2 : setStatus)('图片太大了（超过 4000 万像素），换小一点的试试', 'err'); return; }
      if (which === 2) {
        S.img2 = im; S.W2 = w; S.H2 = h; S.out2 = null;
        $('dropZone2').classList.add('hidden');
        $('workspace2').classList.remove('hidden');
        renderCompare();
        setStatus2('图片已就绪（' + w + '×' + h + '），选好倍数点「开始放大」');
      } else {
        S.img = im; S.W = w; S.H = h;
        clearLayers();
        $('dropZone').classList.add('hidden');
        $('workspace').classList.remove('hidden');
        setStatus('图片已就绪（' + w + '×' + h + '），点「一键拆分图层」开始');
      }
    };
    im.onerror = function () { (which === 2 ? setStatus2 : setStatus)('图片解析失败，换一张试试', 'err'); };
    im.src = dataURL;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindDrop(zoneId, inputId, which) {
    var zone = $(zoneId), input = $(inputId);
    zone.addEventListener('click', function (e) { if (e.target.tagName !== 'BUTTON') input.click(); });
    input.addEventListener('change', function () { if (input.files && input.files[0]) loadFile(input.files[0], which); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drag'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0], which);
    });
  }
  bindDrop('dropZone', 'fileInput', 1);
  bindDrop('dropZone2', 'fileInput2', 2);

  $('pickBtn').addEventListener('click', function (e) { e.stopPropagation(); $('fileInput').click(); });
  $('demoBtn').addEventListener('click', function (e) { e.stopPropagation(); loadFromDataURL('data:image/jpeg;base64,' + window.__DEMO_B64, 1); });
  $('pickBtn2').addEventListener('click', function (e) { e.stopPropagation(); $('fileInput2').click(); });
  $('demoBtn2').addEventListener('click', function (e) { e.stopPropagation(); loadFromDataURL('data:image/jpeg;base64,' + window.__DEMO_B64, 2); });

  $('splitBtn').addEventListener('click', function () {
    autoSplit(parseInt($('passSel').value, 10) || 2);
  });
  $('psdBtn').addEventListener('click', exportPsd);
  $('resetBtn').addEventListener('click', function () {
    S.img = null; S.layers = [];
    $('workspace').classList.add('hidden');
    $('dropZone').classList.remove('hidden');
    setStatus('');
  });
  $('resetBtn2').addEventListener('click', function () {
    S.img2 = null; S.out2 = null;
    $('workspace2').classList.add('hidden');
    $('dropZone2').classList.remove('hidden');
    setStatus2('');
  });
  $('scaleBtn').addEventListener('click', doUpscale);
  $('dlBtn2').addEventListener('click', function () {
    if (!S.out2) return;
    S.out2.toBlob(function (b) { downloadBlob(b, '高清放大_' + stamp() + '.png'); }, 'image/png');
  });
  $('sharpRange').addEventListener('input', function () { $('sharpVal').textContent = $('sharpRange').value; });
  $('pickTol').addEventListener('input', function () { $('pickTolVal').textContent = $('pickTol').value; });

  $('pickToggle').addEventListener('change', function () {
    var on = $('pickToggle').checked;
    $('pickHint').classList.toggle('hidden', !on);
    $('stageCv').style.cursor = on ? 'crosshair' : 'default';
  });
  $('stageCv').addEventListener('click', function (e) {
    if (!$('pickToggle').checked || !S.img) return;
    var rect = $('stageCv').getBoundingClientRect();
    var fx = (e.clientX - rect.left) * (S.W / rect.width);
    var fy = (e.clientY - rect.top) * (S.H / rect.height);
    pickAt(fx, fy);
  });
  $('resetPickBtn').addEventListener('click', function () {
    S.layers = S.layers.filter(function (L) { return L.name !== '背景（已补全）' || true; });
    S.layers = S.layers.filter(function (L) { return /^选区 /.test(L.name) === false; });
    S.pickSeq = 0;
    renderLayerList(); renderStage();
    setStatus('已清空手动点选的图层');
  });

  /* 对比滑杆：直接在对比区拖动 */
  (function () {
    var wrap = $('cmpWrap');
    var drag = false;
    function move(e) {
      var rect = wrap.getBoundingClientRect();
      var clip = $('cmpClip');
      var dw = parseFloat(clip.style.width) || rect.width;
      var left = (rect.width - dw) / 2;
      var pct = clamp(((e.clientX - rect.left) - left) / dw * 100, 0, 100);
      setCompare(pct);
    }
    wrap.addEventListener('mousedown', function (e) { drag = true; move(e); });
    window.addEventListener('mousemove', function (e) { if (drag) move(e); });
    window.addEventListener('mouseup', function () { drag = false; });
    wrap.addEventListener('touchstart', function (e) { drag = true; move(e.touches[0]); }, { passive: true });
    wrap.addEventListener('touchmove', function (e) { if (drag) move(e.touches[0]); }, { passive: true });
    window.addEventListener('touchend', function () { drag = false; });
  })();

  /* Tab 切换 */
  $('tabSplit').addEventListener('click', function () {
    $('tabSplit').classList.add('active'); $('tabScale').classList.remove('active');
    $('panelSplit').classList.remove('hidden'); $('panelScale').classList.add('hidden');
  });
  $('tabScale').addEventListener('click', function () {
    $('tabScale').classList.add('active'); $('tabSplit').classList.remove('active');
    $('panelScale').classList.remove('hidden'); $('panelSplit').classList.add('hidden');
  });

  window.addEventListener('resize', function () { if (S.img2) renderCompare(); });
})();
