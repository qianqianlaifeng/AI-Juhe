/* ============================================================
 * AI 图层分离 · 主逻辑（MobileSAM 版）
 *  - 本地 AI 引擎（onnxruntime-web + MobileSAM 编码器/解码器，无外部请求）
 *  - 一键拆分：在图上撒网格点，AI 自动把每个独立元素各自拆成透明图层
 *  - 点哪拆哪：在图上点一下，就把点中的元素拆成新图层
 *  - 背景 = 原图扣掉所有元素（真实残留，不伪造补全）
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
  function tick() { return new Promise(function (r) { setTimeout(r, 20); }); }

  /* ---------------- 状态 ---------------- */
  var S = {
    engineReady: false,
    enc: null, dec: null,           /* onnx 会话 */
    encIn: '', encOut: '',          /* 编码器的输入/输出名 */
    busy: false,
    emb: null,                      /* 图像嵌入 [1,256,64,64] */
    info: null,                     /* {resizeW, resizeH} */
    /* 拆分 */
    img: null, W: 0, H: 0,
    fullData: null,                 /* 原图 RGBA（Uint8Clamped） */
    unionMask: null,                /* 已拆元素并集 Uint8 */
    elements: [],                   /* 元素图层（不含背景） */
    layers: [],                     /* 自底向上，含背景 */
    pickSeq: 0,
    /* 放大 */
    img2: null, W2: 0, H2: 0, out2: null
  };
  window.__appTest = { S: S };   /* 测试钩子 */
  /* 暴露给编辑器模块（editor.js）的共享接口 */
  window.__app = {
    S: S, mkCanvas: mkCanvas, ctx2d: ctx2d, clamp: clamp,
    downloadBlob: downloadBlob, stamp: stamp, fmtBytes: fmtBytes, PSDWriter: PSDWriter
  };

  /* ---------------- 状态条 ---------------- */
  function setModel(pct, txt, cls) {
    $('modelPct').textContent = Math.round(pct) + '%';
    $('modelProgress').style.width = Math.round(pct) + '%';
    if (txt) $('modelStatus').textContent = txt;
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

  /* ---------------- 引擎启动（下载 + 加载两个 onnx） ---------------- */
  var engineStarted = false;
  async function fetchProgress(url, onProg) {
    var res = await fetch(url);
    if (!res.ok) throw new Error('模型文件下载失败 HTTP ' + res.status + '（' + url + '）');
    var total = parseInt(res.headers.get('content-length') || '0', 10);
    var reader = res.body.getReader();
    var chunks = [], got = 0;
    while (true) {
      var r = await reader.read();
      if (r.done) break;
      chunks.push(r.value); got += r.value.length;
      if (total) onProg(got / total);
    }
    var buf = new Uint8Array(got);
    var off = 0;
    for (var i = 0; i < chunks.length; i++) { buf.set(chunks[i], off); off += chunks[i].length; }
    return buf;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function initEngine() {
    if (engineStarted) return;
    engineStarted = true;
    try {
      setModel(5, '正在启动本地 AI 引擎…');
      ort.env.wasm.wasmBinary = b64ToBytes(window.__ORT_WASM_B64);
      ort.env.wasm.numThreads = 1;

      /* 编码器 */
      setModel(12, '正在下载拆图模型（编码器）…');
      var encBuf = await fetchProgress('vendor/vit_t_encoder.onnx', function (p) { setModel(12 + p * 30, '正在下载拆图模型（编码器） ' + Math.round(p * 100) + '%'); });
      $('modelDetail').textContent = '首次加载后浏览器会缓存，第二次就快了';
      setModel(45, '正在加载编码器…');
      S.enc = await ort.InferenceSession.create(encBuf, { executionProviders: ['wasm'] });
      S.encIn = S.enc.inputNames[0];
      S.encOut = S.enc.outputNames[0];

      /* 解码器 */
      setModel(50, '正在下载拆图模型（解码器）…');
      var decBuf = await fetchProgress('vendor/vit_t_decoder.onnx', function (p) { setModel(50 + p * 35, '正在下载拆图模型（解码器） ' + Math.round(p * 100) + '%'); });
      setModel(85, '正在加载解码器…');
      S.dec = await ort.InferenceSession.create(decBuf, { executionProviders: ['wasm'] });

      S.engineReady = true;
      setModel(100, '本地 AI 引擎已就绪', 'ok');
      $('modelDetail').textContent = '模型已在本地加载完成，图片全程不上传';
      $('splitBtn').disabled = false;
    } catch (e) {
      setModel(100, 'AI 引擎启动失败', 'err');
      $('modelDetail').textContent = '建议用最新版 Chrome 或 Edge 打开本页面';
      setStatus('AI 引擎没跑起来：' + (e && e.message ? e.message : e), 'err');
    }
  }

  if (document.readyState === 'complete') initEngine();
  else window.addEventListener('load', initEngine);

  /* ---------------- 编码器预处理（对齐 Kazuhito00 demo） ---------------- */
  var MEAN = [123.675, 116.28, 103.53];
  var STD = [58.395, 57.12, 57.375];
  var ENC = 1024;

  /* 原图画布 -> [1,3,1024,1024] Float32（长边缩到 1024，短边 pad 0） */
  function preprocessImage(srcCanvas) {
    var W = S.W, H = S.H;
    var resizeW, resizeH;
    if (W >= H) { resizeW = ENC; resizeH = Math.round(ENC / W * H); }
    else { resizeH = ENC; resizeW = Math.round(ENC / H * W); }
    var rc = mkCanvas(resizeW, resizeH);
    ctx2d(rc).drawImage(srcCanvas, 0, 0, resizeW, resizeH);
    var d = ctx2d(rc).getImageData(0, 0, resizeW, resizeH).data;
    var input = new Float32Array(3 * ENC * ENC);
    for (var y = 0; y < resizeH; y++) {
      for (var x = 0; x < resizeW; x++) {
        var p = (y * resizeW + x) * 4;
        var i = y * ENC + x;
        input[i] = (d[p] - MEAN[0]) / STD[0];
        input[ENC * ENC + i] = (d[p + 1] - MEAN[1]) / STD[1];
        input[2 * ENC * ENC + i] = (d[p + 2] - MEAN[2]) / STD[2];
      }
    }
    return { input: input, resizeW: resizeW, resizeH: resizeH };
  }

  /* 原图坐标 -> 1024 空间坐标（对齐 demo 的 preprocess_point） */
  function preprocessPoint(x, y) {
    var px = x * (S.info.resizeW / S.W);
    var py = y * (S.info.resizeH / S.H);
    return { coords: new Float32Array([px, py]), labels: new Float32Array([1]) };
  }

  async function runEncoder(srcCanvas) {
    var pp = preprocessImage(srcCanvas);
    S.info = { resizeW: pp.resizeW, resizeH: pp.resizeH };
    var feeds = {};
    feeds[S.encIn] = new ort.Tensor('float32', pp.input, [1, 3, ENC, ENC]);
    var res = await S.enc.run(feeds);
    S.emb = Float32Array.from(res[S.encOut].data);
    return S.emb;
  }

  /* 单点 -> 掩码概率（全分辨率，sigmoid 后 0..1） */
  async function runDecoder(x, y) {
    if (!S.emb) return null;
    var pt = preprocessPoint(x, y);
    var feeds = {
      'image_embedding': new ort.Tensor('float32', S.emb, [1, 256, 64, 64]),
      'point_coords': new ort.Tensor('float32', pt.coords, [1, 1, 2]),
      'point_labels': new ort.Tensor('float32', pt.labels, [1, 1]),
      'mask_input': new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
      'has_mask_input': new ort.Tensor('float32', new Float32Array([0]), [1]),
      'orig_im_size': new ort.Tensor('float32', new Float32Array([S.H, S.W]), [2])
    };
    var res = await S.dec.run(feeds);
    var outNames = S.dec.outputNames;
    var masksT = res[outNames[0]];
    var dims = masksT.dims;            /* [1, M, H, W] 或 [1,1,H,W] */
    var M = dims[1], Hm = dims[2], Wm = dims[3];
    var data = masksT.data;
    /* 多个候选掩码时挑面积最大的 */
    var best = 0, bestArea = -1;
    if (M > 1) {
      for (var m = 0; m < M; m++) {
        var area = 0, off = m * Hm * Wm;
        for (var q = 0; q < Hm * Wm; q++) if (data[off + q] > 0) area++;
        if (area > bestArea) { bestArea = area; best = m; }
      }
    }
    var bo = best * Hm * Wm;
    var prob = new Float32Array(Hm * Wm);
    for (var k = 0; k < Hm * Wm; k++) {
      var v = data[bo + k];
      prob[k] = 1 / (1 + Math.exp(-v));  /* sigmoid */
    }
    return prob;   /* 全分辨率概率图 */
  }

  /* 概率图 -> 羽化 alpha（Uint8 全分辨率） */
  function buildAlpha(prob, W, H, blurPx) {
    var c1 = mkCanvas(W, H), id = ctx2d(c1).createImageData(W, H);
    for (var i = 0; i < W * H; i++) {
      var v = clamp(prob[i], 0, 1) * 255;
      id.data[i * 4] = 255; id.data[i * 4 + 1] = 255; id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = v;
    }
    ctx2d(c1).putImageData(id, 0, 0);
    var c2 = mkCanvas(W, H), cx = ctx2d(c2);
    cx.filter = 'blur(' + (blurPx || 1.6) + 'px)';
    cx.drawImage(c1, 0, 0);
    cx.filter = 'none';
    var d = cx.getImageData(0, 0, W, H).data;
    var a = new Uint8Array(W * H);
    for (var p = 0; p < W * H; p++) a[p] = d[p * 4 + 3];
    return a;
  }

  /* alpha -> 抠出图层（含 bbox 裁剪） */
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

  /* 概率图 -> 元素图层 + 硬掩码 */
  function probToElement(prob, W, H, srcData, name, blur) {
    var alpha = buildAlpha(prob, W, H, blur || 1.6);
    var layer = extractLayer(alpha, W, H, srcData, name);
    if (!layer) return null;
    var hard = new Uint8Array(W * H);
    for (var i = 0; i < W * H; i++) hard[i] = prob[i] > 0.5 ? 1 : 0;
    return { layer: layer, hard: hard };
  }

  /* 由元素硬掩码并集 -> 真实背景层（原图抠洞，不伪造） */
  function buildBackground(W, H, srcData, union) {
    var c = mkCanvas(W, H), id = ctx2d(c).createImageData(W, H);
    for (var i = 0; i < W * H; i++) {
      var s = i * 4;
      if (union[i]) { id.data[s] = id.data[s + 1] = id.data[s + 2] = 0; id.data[s + 3] = 0; }
      else { id.data[s] = srcData[s]; id.data[s + 1] = srcData[s + 1]; id.data[s + 2] = srcData[s + 2]; id.data[s + 3] = 255; }
    }
    ctx2d(c).putImageData(id, 0, 0);
    return { canvas: c, x: 0, y: 0, name: '背景（其余部分）', visible: true, w: W, h: H, tag: 'bg' };
  }

  function rebuildLayers() {
    S.unionMask = new Uint8Array(S.W * S.H);
    for (var e = 0; e < S.elements.length; e++) {
      var h = S.elements[e].hard;
      if (!h) continue;
      for (var i = 0; i < h.length; i++) if (h[i]) S.unionMask[i] = 1;
    }
    S.layers = [];
    if (S.elements.length) {
      S.layers.push(buildBackground(S.W, S.H, S.fullData, S.unionMask));
    }
    for (var k = 0; k < S.elements.length; k++) S.layers.push(S.elements[k].layer);
    renderLayerList();
    renderStage();
  }

  /* ---------------- 覆盖率网格（NMS 用，避免存全分辨率） ---------------- */
  var GRID = 64;
  function coverageGrid(prob, W, H) {
    var g = new Float32Array(GRID * GRID);
    var cw = W / GRID, ch = H / GRID;
    var bbox = [W, H, -1, -1], area = 0;
    for (var y = 0; y < H; y++) {
      var gy = Math.min(GRID - 1, (y / ch) | 0);
      for (var x = 0; x < W; x++) {
        if (prob[y * W + x] > 0.5) {
          area++;
          if (x < bbox[0]) bbox[0] = x; if (x > bbox[2]) bbox[2] = x;
          if (y < bbox[1]) bbox[1] = y; if (y > bbox[3]) bbox[3] = y;
          var gx = Math.min(GRID - 1, (x / cw) | 0);
          g[gy * GRID + gx] += 1;
        }
      }
    }
    for (var c = 0; c < g.length; c++) g[c] = Math.min(1, g[c] / (cw * ch));
    return { g: g, bbox: bbox, area: area };
  }
  function iouCov(a, b) {
    var inter = 0, uni = 0;
    for (var i = 0; i < a.g.length; i++) {
      var m = Math.min(a.g[i], b.g[i]), n = Math.max(a.g[i], b.g[i]);
      inter += m; uni += n;
    }
    return uni ? inter / uni : 0;
  }
  function contained(a, b) {
    /* a 是否被 b 包住（a 是 b 的一部分） */
    if (a.bbox[0] >= b.bbox[0] && a.bbox[2] <= b.bbox[2] && a.bbox[1] >= b.bbox[1] && a.bbox[3] <= b.bbox[3]) return true;
    return false;
  }

  /* ---------------- 一键拆分（网格多点 + NMS） ---------------- */
  async function autoSplit(fineness) {
    if (!S.img || S.busy || !S.engineReady) return;
    S.busy = true;
    $('splitBtn').disabled = true;
    try {
      var W = S.W, H = S.H;
      setStatus('AI 正在分析整张图…');
      await tick();
      var fullCv = mkCanvas(W, H);
      ctx2d(fullCv).drawImage(S.img, 0, 0, W, H);
      S.fullData = ctx2d(fullCv).getImageData(0, 0, W, H).data;
      await runEncoder(fullCv);

      /* 网格点 */
      var target = ({ 1: 28, 2: 48, 3: 72 })[fineness] || 48;
      var gx = Math.max(3, Math.min(14, Math.round(Math.sqrt(target * W / H))));
      var gy = Math.max(3, Math.min(14, Math.round(target / gx)));
      var pts = [];
      for (var iy = 0; iy < gy; iy++) for (var ix = 0; ix < gx; ix++) {
        pts.push([Math.round((ix + 0.5) * W / gx), Math.round((iy + 0.5) * H / gy)]);
      }

      setStatus('AI 正在逐个识别画面元素（' + pts.length + ' 个采样点）…');
      var metas = [];
      for (var pi = 0; pi < pts.length; pi++) {
        if (pi % 6 === 0) { setStatus('AI 正在识别元素 ' + (pi + 1) + '/' + pts.length + '…'); await tick(); }
        var prob = await runDecoder(pts[pi][0], pts[pi][1]);
        if (!prob) continue;
        var meta = coverageGrid(prob, W, H);
        meta.x = pts[pi][0]; meta.y = pts[pi][1];
        if (meta.area < W * H * 0.004) continue;           /* 太小忽略 */
        if (meta.area > W * H * 0.55) continue;            /* 太大=背景团，忽略 */
        metas.push(meta);
      }

      /* NMS：面积降序，去重 */
      metas.sort(function (a, b) { return b.area - a.area; });
      var kept = [];
      for (var mi = 0; mi < metas.length; mi++) {
        var m = metas[mi], dup = false;
        for (var ki = 0; ki < kept.length; ki++) {
          if (iouCov(m, kept[ki]) > 0.82 || (contained(m, kept[ki]) && m.area < kept[ki].area * 0.85)) { dup = true; break; }
        }
        if (!dup) kept.push(m);
      }

      if (!kept.length) {
        setStatus('这张图没识别到明显可分离的元素，试试点选模式在元素上点一下，或换张主体分明的图', 'err');
        S.busy = false; $('splitBtn').disabled = false; renderLayerList(); renderStage();
        return;
      }

      setStatus('已找到 ' + kept.length + ' 个元素，正在逐一抠出透明图层…');
      S.elements = [];
      for (var ki2 = 0; ki2 < kept.length; ki2++) {
        await tick();
        var prob2 = await runDecoder(kept[ki2].x, kept[ki2].y);
        if (!prob2) continue;
        var el = probToElement(prob2, W, H, S.fullData, '元素 ' + (ki2 + 1), 1.6);
        if (el) S.elements.push(el);
      }
      rebuildLayers();
      setStatus('拆好了！共 ' + S.elements.length + ' 个元素图层 + 1 个背景图层，可导出 PSD 继续编辑', 'ok');
    } catch (e) {
      setStatus('拆分时出错了：' + (e && e.message ? e.message : e), 'err');
    }
    S.busy = false;
    $('splitBtn').disabled = false;
  }

  /* ---------------- 点哪拆哪 ---------------- */
  async function pickAt(fx, fy) {
    if (!S.img || S.busy || !S.engineReady) return;
    S.busy = true;
    try {
      if (!S.fullData) {
        var fullCv = mkCanvas(S.W, S.H);
        ctx2d(fullCv).drawImage(S.img, 0, 0, S.W, S.H);
        S.fullData = ctx2d(fullCv).getImageData(0, 0, S.W, S.H).data;
        await runEncoder(fullCv);
      }
      setStatus('AI 正在拆分你点中的元素…');
      await tick();
      var prob = await runDecoder(fx, fy);
      if (!prob) { setStatus('拆分失败了，换个点再试试', 'err'); S.busy = false; return; }
      var el = probToElement(prob, S.W, S.H, S.fullData, '元素 ' + (S.elements.length + 1), 1.6);
      if (!el) { setStatus('这个点拆不出明显元素，靠近主体再点一下', 'err'); S.busy = false; return; }
      S.elements.push(el);
      S.pickSeq++;
      rebuildLayers();
      setStatus('已把点中的元素拆成新图层「' + el.layer.name + '」', 'ok');
    } catch (e) {
      setStatus('拆分时出错了：' + (e && e.message ? e.message : e), 'err');
    }
    S.busy = false;
  }

  /* ---------------- 图层管理 ---------------- */
  function clearLayers() { S.elements = []; S.pickSeq = 0; S.unionMask = new Uint8Array(S.W * S.H); S.layers = []; renderLayerList(); renderStage(); }
  function removeLayer(idx) {
    var L = S.layers[idx];
    S.layers.splice(idx, 1);
    if (L.tag !== 'bg') {
      S.elements = S.elements.filter(function (e) { return e.layer !== L; });
    }
    rebuildLayers();
  }

  function renderLayerList() {
    var box = $('layerList');
    box.innerHTML = '';
    $('layerCount').textContent = S.elements.length;
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
    var wrap = $('cmpWrap');
    var fit = Math.min((wrap.clientWidth - 2) / bw, 560 / bh, 1.6);
    var dw = Math.round(bw * fit), dh = Math.round(bh * fit);
    b.style.width = dw + 'px'; b.style.height = dh + 'px';
    a.style.width = dw + 'px'; a.style.height = dh + 'px';
    var clip = $('cmpClip');
    clip.style.width = dw + 'px'; clip.style.height = dh + 'px';
    clip.style.left = '50%'; clip.style.transform = 'translateX(-50%)';
    setCompare(50);
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
        S.elements = []; S.pickSeq = 0; S.emb = null; S.fullData = null; S.unionMask = null; S.layers = [];
        $('dropZone').classList.add('hidden');
        $('workspace').classList.remove('hidden');
        setStatus(S.engineReady ? '图片已就绪（' + w + '×' + h + '），点「一键拆分全部元素」或开启「点哪拆哪」' : '图片已就绪，AI 引擎还在加载，请稍候…');
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
    S.img = null; S.elements = []; S.layers = []; S.emb = null;
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
    S.elements = []; S.pickSeq = 0; rebuildLayers();
    setStatus('已清空已拆出的元素图层');
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

  /* ---------------- 测试钩子（无害，便于自动化验收） ---------------- */
  window.__appTest.runAuto = function (f) { return autoSplit(f || 2); };
  window.__appTest.runPick = function (x, y) { return pickAt(x, y); };
  window.__appTest.loadData = function (url) { return loadFromDataURL(url, 1); };
  window.__appTest.getLayers = function () {
    return {
      count: S.layers.length,
      elements: S.elements.length,
      names: S.layers.map(function (L) { return L.name; }),
      sizes: S.layers.map(function (L) { return [L.canvas.width, L.canvas.height]; })
    };
  };
  window.__appTest.engineReady = function () { return S.engineReady; };
})();
