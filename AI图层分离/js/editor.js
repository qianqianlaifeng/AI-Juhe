/* ============================================================
 * AI 图层分离 · 改图编辑器（第三大功能）
 *  - 在「已分离的透明图层」或「一张普通图」之上做图像编辑
 *  - 支持：拖动移动 / 缩放 / 旋转 / 不透明度 / 图层排序
 *          背景替换（保留原背景 / 纯色 / 图片 / 透明）
 *          调色（亮度·对比度·饱和度·模糊）+ 滤镜预设
 *          加文字 / 加图片 / 裁剪 / 导出 合成PNG·JPG·分层PSD
 *  - 全程浏览器本地处理，图片不上传
 *  依赖：window.__app（由 app.js 暴露），PSDWriter
 * ============================================================ */
(function () {
  'use strict';
  var A = window.__app;
  var S = A.S;
  var $ = function (id) { return document.getElementById(id); };
  var mkCanvas = A.mkCanvas, ctx2d = A.ctx2d, clamp = A.clamp, downloadBlob = A.downloadBlob, stamp = A.stamp;

  var E = {
    sel: null,                       /* 当前选中图层对象 */
    bg: { mode: 'keep', color: '#ffffff', image: null },
    crop: null,                      /* {x,y,w,h}（图像坐标） */
    cropMode: false,
    rect: null,                      /* 裁剪框（cropMode 时） */
    drag: null,                      /* 拖动 / 缩放状态 */
    fileInput: null
  };

  /* ---------------- 基础 ---------------- */
  function hasContent() { return S.layers && S.layers.length > 0; }
  function outSize() { return E.crop ? { w: E.crop.w, h: E.crop.h } : { w: S.W, h: S.H }; }
  function outOffset() { return E.crop ? { x: E.crop.x, y: E.crop.y } : { x: 0, y: 0 }; }

  function setEditStatus(msg, cls) {
    var el = $('editStatus');
    el.textContent = msg || '';
    el.className = 'status-line' + (cls ? ' ' + cls : '');
  }

  /* ---------------- 背景绘制（fw/fh 为本画布尺寸） ---------------- */
  function paintBg(cx, fw, fh) {
    if (E.bg.mode === 'transparent') return;
    if (E.bg.mode === 'color') { cx.fillStyle = E.bg.color; cx.fillRect(0, 0, fw, fh); return; }
    if (E.bg.mode === 'image' && E.bg.image) {
      var iw = E.bg.image.width, ih = E.bg.image.height;
      var sc = Math.max(fw / iw, fh / ih);
      var dw = iw * sc, dh = ih * sc;
      cx.drawImage(E.bg.image, (fw - dw) / 2, (fh - dh) / 2, dw, dh);
      return;
    }
    /* keep：由普通图层里的背景层绘制，这里不画 */
  }

  /* ---------------- 调色 / 滤镜 ---------------- */
  function adjFilter(adj) {
    if (!adj) return 'none';
    var f = [];
    if (adj.bright) f.push('brightness(' + ((100 + adj.bright) / 100) + ')');
    if (adj.contrast) f.push('contrast(' + ((100 + adj.contrast) / 100) + ')');
    if (adj.sat) f.push('saturate(' + ((100 + adj.sat) / 100) + ')');
    if (adj.blur > 0) f.push('blur(' + adj.blur + 'px)');
    if (adj.filter === 'gray') f.push('grayscale(1)');
    else if (adj.filter === 'sepia') f.push('sepia(1)');
    else if (adj.filter === 'invert') f.push('invert(1)');
    else if (adj.filter === 'cool') f.push('hue-rotate(-18deg) saturate(1.25)');
    else if (adj.filter === 'warm') f.push('hue-rotate(18deg) saturate(1.2) brightness(1.05)');
    return f.length ? f.join(' ') : 'none';
  }

  /* ---------------- 单层绘制（含变换 + 调色） ---------------- */
  function drawLayer(cx, L) {
    cx.save();
    var cxp = L.x + L.w / 2 + (L.tx || 0);
    var cyp = L.y + L.h / 2 + (L.ty || 0);
    cx.translate(cxp, cyp);
    cx.rotate((L.rot || 0) * Math.PI / 180);
    var sc = (L.scale || 1);
    cx.scale((L.flipH ? -sc : sc), sc);
    cx.globalAlpha = (L.opacity == null ? 1 : L.opacity);
    cx.filter = adjFilter(L.adj);
    cx.drawImage(L.canvas, -L.w / 2, -L.h / 2);
    cx.restore();
  }

  /* 把某层烤进「裁剪后尺寸」的画布（用于导出 PSD / 合成） */
  function bakeLayerToCanvas(L) {
    var os = outSize(), off = outOffset();
    var c = mkCanvas(os.w, os.h), cx = ctx2d(c);
    cx.save(); cx.translate(-off.x, -off.y);
    drawLayer(cx, L);
    cx.restore();
    return c;
  }

  /* ---------------- 合成（用于 PNG/JPG） ---------------- */
  function renderComposite(flattenWhite) {
    var os = outSize(), off = outOffset();
    var c = mkCanvas(os.w, os.h), cx = ctx2d(c);
    cx.clearRect(0, 0, os.w, os.h);
    if (flattenWhite) { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, os.w, os.h); }
    cx.save(); cx.translate(-off.x, -off.y);
    paintBg(cx, S.W, S.H);
    for (var i = 0; i < S.layers.length; i++) {
      var L = S.layers[i];
      if (L.tag === 'bg' && E.bg.mode !== 'keep') continue;
      if (!L.visible) continue;
      drawLayer(cx, L);
    }
    cx.restore();
    return c;
  }

  /* ---------------- 预览渲染 ---------------- */
  function fitEditCanvas(cv) {
    var wrap = $('editWrap');
    var fit = Math.min((wrap.clientWidth - 2) / cv.width, 560 / cv.height, 1.6);
    cv.style.width = Math.round(cv.width * fit) + 'px';
    cv.style.height = Math.round(cv.height * fit) + 'px';
  }

  function layerCornersCanvas(L, off) {
    var cxp = L.x + L.w / 2 + (L.tx || 0), cyp = L.y + L.h / 2 + (L.ty || 0);
    var a = (L.rot || 0) * Math.PI / 180, sc = (L.scale || 1), fx = L.flipH ? -1 : 1;
    var pts = [[-L.w / 2, -L.h / 2], [L.w / 2, -L.h / 2], [L.w / 2, L.h / 2], [-L.w / 2, L.h / 2]];
    return pts.map(function (p) {
      var x = p[0] * fx, y = p[1];
      x *= sc; y *= sc;
      var rx = x * Math.cos(a) - y * Math.sin(a);
      var ry = x * Math.sin(a) + y * Math.cos(a);
      return [rx + cxp - off.x, ry + cyp - off.y];
    });
  }

  function renderEdit() {
    if (!S.img && !hasContent()) return;
    var os = outSize(), off = outOffset();
    var cv = $('editCv');
    cv.width = os.w; cv.height = os.h;
    var cx = ctx2d(cv);
    cx.clearRect(0, 0, os.w, os.h);
    cx.save(); cx.translate(-off.x, -off.y);
    paintBg(cx, S.W, S.H);
    for (var i = 0; i < S.layers.length; i++) {
      var L = S.layers[i];
      if (L.tag === 'bg' && E.bg.mode !== 'keep') continue;
      if (!L.visible) continue;
      drawLayer(cx, L);
    }
    cx.restore();

    /* 选中描边 */
    if (E.sel) {
      var cs = layerCornersCanvas(E.sel, off);
      cx.save();
      cx.strokeStyle = '#4c6fff';
      cx.lineWidth = Math.max(1.5, 2 * cv.width / S.W);
      cx.setLineDash([6, 4]);
      cx.beginPath();
      cx.moveTo(cs[0][0], cs[0][1]);
      for (var k = 1; k < cs.length; k++) cx.lineTo(cs[k][0], cs[k][1]);
      cx.closePath(); cx.stroke();
      cx.restore();
    }

    /* 裁剪框 */
    if (E.cropMode && E.rect) drawCropOverlay(cx, off);
    fitEditCanvas(cv);
  }

  /* ---------------- 坐标换算 ---------------- */
  function clientToImg(e) {
    var cv = $('editCv'), rect = cv.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (cv.width / rect.width);
    var y = (e.clientY - rect.top) * (cv.height / rect.height);
    var off = outOffset();
    return { x: x + off.x, y: y + off.y };
  }

  function hitLayer(ix, iy) {
    for (var i = S.layers.length - 1; i >= 0; i--) {
      var L = S.layers[i];
      if (L.tag === 'bg' && E.bg.mode !== 'keep') continue;
      if (!L.visible) continue;
      var cxp = L.x + L.w / 2 + (L.tx || 0), cyp = L.y + L.h / 2 + (L.ty || 0);
      var dx = ix - cxp, dy = iy - cyp;
      var a = -(L.rot || 0) * Math.PI / 180, sc = (L.scale || 1), fx = L.flipH ? -1 : 1;
      var lx = dx * Math.cos(a) - dy * Math.sin(a);
      var ly = dx * Math.sin(a) + dy * Math.cos(a);
      lx /= sc; ly /= sc; lx *= fx;
      if (Math.abs(lx) <= L.w / 2 && Math.abs(ly) <= L.h / 2) return L;
    }
    return null;
  }

  /* ---------------- 图层列表（编辑版） ---------------- */
  function renderEditList() {
    var box = $('editLayerList');
    box.innerHTML = '';
    $('editLayerCount').textContent = S.layers.length;
    for (var i = 0; i < S.layers.length; i++) {
      (function (idx) {
        var L = S.layers[idx];
        var row = document.createElement('div');
        row.className = 'layer-row' + (L.visible ? '' : ' off') + (E.sel === L ? ' sel' : '');
        var th = document.createElement('div'); th.className = 'layer-thumb';
        var tc = mkCanvas(44, 44), tcx = ctx2d(tc);
        var fit = Math.min(44 / L.canvas.width, 44 / L.canvas.height);
        var tw = L.canvas.width * fit, thh = L.canvas.height * fit;
        tcx.drawImage(L.canvas, (44 - tw) / 2, (44 - thh) / 2, tw, thh);
        th.appendChild(tc);
        var nameBox = document.createElement('div'); nameBox.className = 'layer-name';
        nameBox.textContent = L.name + (L.kind === 'text' ? ' ✎' : (L.tag === 'bg' ? ' 🖼' : ''));
        var sizeSpan = document.createElement('span'); sizeSpan.className = 'layer-size';
        sizeSpan.textContent = L.canvas.width + '×' + L.canvas.height;
        nameBox.appendChild(sizeSpan);
        th.onclick = function () { selectLayer(L); };
        nameBox.onclick = function () { selectLayer(L); };

        var eye = document.createElement('button'); eye.className = 'icon-btn'; eye.type = 'button';
        eye.textContent = L.visible ? '👁' : '🚫'; eye.title = '显示 / 隐藏';
        eye.onclick = function () { L.visible = !L.visible; renderEditList(); renderEdit(); };

        var up = document.createElement('button'); up.className = 'icon-btn'; up.type = 'button';
        up.textContent = '▲'; up.title = '上移一层'; up.disabled = idx >= S.layers.length - 1;
        up.onclick = function () { if (idx < S.layers.length - 1) { S.layers.splice(idx, 1); S.layers.splice(idx + 1, 0, L); renderEditList(); renderEdit(); } };

        var down = document.createElement('button'); down.className = 'icon-btn'; down.type = 'button';
        down.textContent = '▼'; down.title = '下移一层'; down.disabled = idx <= 0;
        down.onclick = function () { if (idx > 0) { S.layers.splice(idx, 1); S.layers.splice(idx - 1, 0, L); renderEditList(); renderEdit(); } };

        var dl = document.createElement('button'); dl.className = 'icon-btn'; dl.type = 'button';
        dl.textContent = '⬇'; dl.title = '下载这一层（PNG）';
        dl.onclick = function () { L.canvas.toBlob(function (b) { downloadBlob(b, L.name + '.png'); }, 'image/png'); };

        var del = document.createElement('button'); del.className = 'icon-btn'; del.type = 'button';
        del.textContent = '✕'; del.title = '删除这一层';
        del.onclick = function () {
          var k = S.layers.indexOf(L);
          if (k >= 0) S.layers.splice(k, 1);
          if (E.sel === L) { E.sel = null; updatePropPanel(); }
          renderEditList(); renderEdit();
        };
        row.appendChild(th); row.appendChild(nameBox);
        row.appendChild(eye); row.appendChild(up); row.appendChild(down); row.appendChild(dl); row.appendChild(del);
        box.appendChild(row);
      })(i);
    }
    $('expPngBtn').disabled = !hasContent();
    $('expJpgBtn').disabled = !hasContent();
    $('expPsdBtn').disabled = !hasContent();
  }

  function selectLayer(L) {
    E.sel = L;
    renderEditList();
    renderEdit();
    updatePropPanel();
  }

  /* ---------------- 属性面板 ---------------- */
  function updatePropPanel() {
    var L = E.sel;
    var has = !!L;
    $('xfPanel').classList.toggle('disabled', !has);
    $('adjPanel').classList.toggle('disabled', !has);
    $('txtUpdateRow').classList.toggle('hidden', !(has && L.kind === 'text'));
    if (!has) return;
    $('xfX').value = Math.round(L.tx || 0); $('xfXv').textContent = $('xfX').value;
    $('xfY').value = Math.round(L.ty || 0); $('xfYv').textContent = $('xfY').value;
    $('xfScale').value = Math.round((L.scale || 1) * 100); $('xfScalev').textContent = $('xfScale').value + '%';
    $('xfRot').value = Math.round(L.rot || 0); $('xfRotv').textContent = $('xfRot').value + '°';
    $('xfOpacity').value = Math.round((L.opacity == null ? 1 : L.opacity) * 100); $('xfOpacityv').textContent = $('xfOpacity').value + '%';
    var a = L.adj || (L.adj = { bright: 0, contrast: 0, sat: 0, blur: 0, filter: 'none' });
    $('adjBright').value = a.bright; $('adjBrightv').textContent = a.bright;
    $('adjContrast').value = a.contrast; $('adjContrastv').textContent = a.contrast;
    $('adjSat').value = a.sat; $('adjSatv').textContent = a.sat;
    $('adjBlur').value = a.blur; $('adjBlurv').textContent = a.blur;
    Array.prototype.forEach.call(document.querySelectorAll('.filter-chip'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-filter') === (a.filter || 'none'));
    });
    if (L.kind === 'text' && L.textCfg) {
      $('txtText').value = L.textCfg.text;
      $('txtSize').value = L.textCfg.size;
      $('txtColor').value = L.textCfg.color;
      $('txtBold').checked = !!L.textCfg.bold;
    }
  }

  /* ---------------- 加文字 ---------------- */
  function renderTextCanvas(t, size, color, bold) {
    var cv = mkCanvas(10, 10);
    var c = cv.getContext('2d');
    var font = (bold ? '700 ' : '400 ') + size + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    c.font = font;
    var m = c.measureText(t);
    var tw = Math.ceil(m.width) + Math.ceil(size * 0.4);
    var th = Math.ceil(size * 1.4);
    cv.width = tw; cv.height = th;
    c = cv.getContext('2d'); c.font = font;
    c.fillStyle = color; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText(t, tw / 2, th / 2);
    return cv;
  }
  function addText() {
    var t = ($('txtText').value || '').trim() || '文字';
    var size = parseInt($('txtSize').value, 10) || 48;
    var color = $('txtColor').value || '#ffffff';
    var bold = $('txtBold').checked;
    var cv = renderTextCanvas(t, size, color, bold);
    var L = E.sel;
    if (L && L.kind === 'text') {
      L.canvas = cv; L.w = cv.width; L.h = cv.height; L.textCfg = { text: t, size: size, color: color, bold: bold };
    } else {
      L = {
        canvas: cv, x: Math.round((S.W - cv.width) / 2), y: Math.round((S.H - cv.height) / 2),
        w: cv.width, h: cv.height, name: '文字图层', visible: true, kind: 'text',
        tx: 0, ty: 0, scale: 1, rot: 0, opacity: 1, flipH: false,
        adj: { bright: 0, contrast: 0, sat: 0, blur: 0, filter: 'none' },
        textCfg: { text: t, size: size, color: color, bold: bold }
      };
      S.layers.push(L);
      E.sel = L;
    }
    renderEditList(); renderEdit(); updatePropPanel();
    setEditStatus('已添加文字图层，可拖动 / 缩放 / 旋转，也能继续调色', 'ok');
  }

  /* ---------------- 加图片 ---------------- */
  function addImageFile(file) {
    if (!file || !/^image\//.test(file.type)) { setEditStatus('这不是图片文件', 'err'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        var maxw = Math.round(S.W * 0.5);
        var sc = im.width > maxw ? maxw / im.width : 1;
        var w = Math.round(im.width * sc), h = Math.round(im.height * sc);
        var cv = mkCanvas(w, h); ctx2d(cv).drawImage(im, 0, 0, w, h);
        var L = {
          canvas: cv, x: Math.round((S.W - w) / 2), y: Math.round((S.H - h) / 2), w: w, h: h,
          name: '图片图层', visible: true, kind: 'image', tx: 0, ty: 0, scale: 1, rot: 0, opacity: 1, flipH: false,
          adj: { bright: 0, contrast: 0, sat: 0, blur: 0, filter: 'none' }
        };
        S.layers.push(L); E.sel = L;
        renderEditList(); renderEdit(); updatePropPanel();
        setEditStatus('已添加图片图层', 'ok');
      };
      im.onerror = function () { setEditStatus('图片解析失败', 'err'); };
      im.src = fr.result;
    };
    fr.onerror = function () { setEditStatus('图片读取失败', 'err'); };
    fr.readAsDataURL(file);
  }

  function setBgImageFile(file) {
    if (!file || !/^image\//.test(file.type)) { setEditStatus('这不是图片文件', 'err'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () { E.bg.image = im; E.bg.mode = 'image'; $('bgMode').value = 'image'; renderEdit(); setEditStatus('已替换背景为图片', 'ok'); };
      im.onerror = function () { setEditStatus('背景图解析失败', 'err'); };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  /* ---------------- 入口：从一张普通图开始编辑 ---------------- */
  function startFromImage(dataURL) {
    /* 立即使旧内容失效并清空，避免与上一轮拆分/编辑内容混在一起（onload 是异步的） */
    S.editReady = false;
    S.layers = []; S.elements = []; E.sel = null;
    E.crop = null; E.cropMode = false; E.rect = null;
    var im = new Image();
    im.onload = function () {
      var w = im.naturalWidth, h = im.naturalHeight;
      if (w * h > 40000000) { setEditStatus('图片太大了（超过 4000 万像素），换小一点的试试', 'err'); S.editReady = true; return; }
      S.img = im; S.W = w; S.H = h;
      S.elements = []; S.emb = null; S.fullData = null; S.unionMask = null;
      var bg = { canvas: mkCanvas(w, h), x: 0, y: 0, w: w, h: h, name: '背景（原图）', visible: true, tag: 'bg', kind: 'bg', tx: 0, ty: 0, scale: 1, rot: 0, opacity: 1, flipH: false, adj: { bright: 0, contrast: 0, sat: 0, blur: 0, filter: 'none' } };
      ctx2d(bg.canvas).drawImage(im, 0, 0, w, h);
      S.layers = [bg];
      E.bg.mode = 'keep'; $('bgMode').value = 'keep';
      enterEditorWorkspace();
      setEditStatus('图片已载入，开始编辑吧：拖动图层、调色、换背景、加文字都可以', 'ok');
      S.editReady = true;
    };
    im.onerror = function () { setEditStatus('图片解析失败', 'err'); S.editReady = true; };
    im.src = dataURL;
  }

  /* ---------------- 进入 / 切换 ---------------- */
  function enterEditor() {
    if (hasContent()) { enterEditorWorkspace(); }
    else {
      $('dropZone3').classList.remove('hidden');
      $('workspace3').classList.add('hidden');
    }
  }
  function enterEditorWorkspace() {
    $('dropZone3').classList.add('hidden');
    $('workspace3').classList.remove('hidden');
    renderEdit(); renderEditList(); updatePropPanel();
  }

  /* ---------------- 裁剪 ---------------- */
  function setCropPreset(aspect) {
    var W = S.W, H = S.H;
    if (aspect === 'free') { E.rect = { x: 0, y: 0, w: W, h: H }; renderEdit(); return; }
    var ar = ({ '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9 })[aspect] || 1;
    var w = W, h = Math.round(w / ar);
    if (h > H) { h = H; w = Math.round(h * ar); }
    E.rect = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: w, h: h };
    renderEdit();
  }
  function drawCropOverlay(cx, off) {
    var r = E.rect;
    var x = r.x - off.x, y = r.y - off.y, w = r.w, h = r.h;
    cx.save();
    cx.fillStyle = 'rgba(15,18,30,0.42)';
    cx.fillRect(0, 0, cx.canvas.width, y);
    cx.fillRect(0, y + h, cx.canvas.width, cx.canvas.height - (y + h));
    cx.fillRect(0, y, x, h);
    cx.fillRect(x + w, y, cx.canvas.width - (x + w), h);
    cx.strokeStyle = '#ffffff'; cx.lineWidth = 2; cx.setLineDash([]);
    cx.strokeRect(x, y, w, h);
    var hs = Math.max(9, 13 * cx.canvas.width / S.W);
    cx.fillStyle = '#4c6fff';
    [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].forEach(function (p) {
      cx.beginPath(); cx.arc(p[0], p[1], hs / 2, 0, 7); cx.fill();
    });
    cx.restore();
  }
  function cropHandleAt(ix, iy) {
    var r = E.rect, hw = 16;
    var pts = { tl: [r.x, r.y], tr: [r.x + r.w, r.y], br: [r.x + r.w, r.y + r.h], bl: [r.x, r.y + r.h] };
    var names = ['tl', 'tr', 'br', 'bl'];
    for (var i = 0; i < names.length; i++) {
      var p = pts[names[i]];
      if (Math.abs(ix - p[0]) <= hw && Math.abs(iy - p[1]) <= hw) return names[i];
    }
    if (ix >= r.x && ix <= r.x + r.w && iy >= r.y && iy <= r.y + r.h) return 'move';
    return null;
  }
  function applyCrop() {
    E.crop = { x: clamp(Math.round(E.rect.x), 0, S.W), y: clamp(Math.round(E.rect.y), 0, S.H), w: clamp(Math.round(E.rect.w), 1, S.W), h: clamp(Math.round(E.rect.h), 1, S.H) };
    E.cropMode = false;
    $('cropApply').classList.add('hidden'); $('cropCancel').classList.add('hidden'); $('cropPresets').classList.add('hidden');
    $('cropBtn').textContent = '✂ 裁剪'; $('cropBtn').classList.remove('btn-primary');
    renderEdit(); setEditStatus('已应用裁剪（' + E.crop.w + '×' + E.crop.h + '），可继续编辑或导出', 'ok');
  }
  function cancelCrop() {
    E.cropMode = false; E.rect = null;
    $('cropApply').classList.add('hidden'); $('cropCancel').classList.add('hidden'); $('cropPresets').classList.add('hidden');
    $('cropBtn').textContent = '✂ 裁剪'; $('cropBtn').classList.remove('btn-primary');
    renderEdit();
  }

  /* ---------------- 导出 ---------------- */
  async function exportPng() {
    if (!hasContent() || E.busyE) return null;
    E.busyE = true;
    setEditStatus('正在导出 PNG…');
    try {
      var c = renderComposite(false);
      var blob = await new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/png'); });
      downloadBlob(blob, '改图_' + stamp() + '.png');
      setEditStatus('PNG 已导出（' + A.fmtBytes(blob.size) + '，含透明通道）', 'ok');
      E.busyE = false;
      return blob;
    } catch (e) { setEditStatus('导出 PNG 出错：' + (e && e.message ? e.message : e), 'err'); E.busyE = false; return null; }
  }
  async function exportJpg() {
    if (!hasContent() || E.busyE) return null;
    E.busyE = true;
    setEditStatus('正在导出 JPG…');
    try {
      var c = renderComposite(true);
      var blob = await new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/jpeg', 0.92); });
      downloadBlob(blob, '改图_' + stamp() + '.jpg');
      setEditStatus('JPG 已导出（' + A.fmtBytes(blob.size) + '）', 'ok');
      E.busyE = false;
      return blob;
    } catch (e) { setEditStatus('导出 JPG 出错：' + (e && e.message ? e.message : e), 'err'); E.busyE = false; return null; }
  }
  async function exportPsd() {
    if (!hasContent() || E.busyE) return;
    E.busyE = true;
    setEditStatus('正在导出分层 PSD…');
    await new Promise(function (r) { setTimeout(r, 10); });
    try {
      var os = outSize();
      var arr = [];
      if (E.bg.mode !== 'keep') {
        var bgc = mkCanvas(os.w, os.h), bc = ctx2d(bgc);
        paintBg(bc, os.w, os.h);
        arr.push({ canvas: bgc, x: 0, y: 0, name: '背景', visible: true });
      }
      for (var i = 0; i < S.layers.length; i++) {
        var L = S.layers[i];
        if (L.tag === 'bg' && E.bg.mode !== 'keep') continue;
        if (!L.visible) continue;
        arr.push({ canvas: bakeLayerToCanvas(L), x: 0, y: 0, name: L.name || ('图层' + (i + 1)), visible: true });
      }
      if (!arr.length) { setEditStatus('没有可导出的图层', 'err'); E.busyE = false; return; }
      var blob = await PSDWriter.buildPsdBlob(arr, os.w, os.h);
      window.__appTest.lastPsd = blob;
      downloadBlob(blob, '改图_' + stamp() + '.psd');
      setEditStatus('PSD 已导出（' + A.fmtBytes(blob.size) + '），每层独立，可在 Photoshop / Photopea 继续编辑', 'ok');
    } catch (e) { setEditStatus('导出 PSD 出错：' + (e && e.message ? e.message : e), 'err'); }
    E.busyE = false;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindDrop(zoneId, inputId, cb) {
    var zone = $(zoneId), input = $(inputId);
    zone.addEventListener('click', function (e) { if (e.target.tagName !== 'BUTTON') input.click(); });
    input.addEventListener('change', function () { if (input.files && input.files[0]) cb(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drag'); }); });
    zone.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) cb(e.dataTransfer.files[0]); });
  }
  bindDrop('dropZone3', 'fileInput3', function (f) {
    if (!f || !/^image\//.test(f.type)) { setEditStatus('这不是图片文件', 'err'); return; }
    var fr = new FileReader();
    fr.onload = function () { startFromImage(fr.result); };
    fr.readAsDataURL(f);
  });
  $('demoBtn3').addEventListener('click', function () { startFromImage('data:image/jpeg;base64,' + window.__DEMO_B64); });

  $('tabEdit').addEventListener('click', function () {
    $('tabEdit').classList.add('active'); $('tabSplit').classList.remove('active'); $('tabScale').classList.remove('active');
    $('panelEdit').classList.remove('hidden'); $('panelSplit').classList.add('hidden'); $('panelScale').classList.add('hidden');
    enterEditor();
  });

  /* 背景控制 */
  $('bgMode').addEventListener('change', function () {
    E.bg.mode = $('bgMode').value;
    $('bgColorRow').classList.toggle('hidden', E.bg.mode !== 'color');
    if (E.bg.mode === 'image' && !E.bg.image) { $('bgImgInput').click(); }
    renderEdit();
  });
  $('bgColor').addEventListener('input', function () { E.bg.color = $('bgColor').value; if (E.bg.mode === 'color') renderEdit(); });
  $('bgImgBtn').addEventListener('click', function () { $('bgImgInput').click(); });
  $('bgImgInput').addEventListener('change', function () { if ($('bgImgInput').files && $('bgImgInput').files[0]) setBgImageFile($('bgImgInput').files[0]); $('bgImgInput').value = ''; });

  /* 调色 */
  function bindAdj(id, key) {
    $(id).addEventListener('input', function () {
      if (!E.sel) return;
      E.sel.adj = E.sel.adj || { bright: 0, contrast: 0, sat: 0, blur: 0, filter: 'none' };
      E.sel.adj[key] = parseInt($(id).value, 10);
      $(id + 'v').textContent = $(id).value;
      renderEdit();
    });
  }
  bindAdj('adjBright', 'bright'); bindAdj('adjContrast', 'contrast'); bindAdj('adjSat', 'sat'); bindAdj('adjBlur', 'blur');
  Array.prototype.forEach.call(document.querySelectorAll('.filter-chip'), function (b) {
    b.addEventListener('click', function () {
      if (!E.sel) return;
      E.sel.adj = E.sel.adj || { bright: 0, contrast: 0, sat: 0, blur: 0, filter: 'none' };
      E.sel.adj.filter = b.getAttribute('data-filter');
      Array.prototype.forEach.call(document.querySelectorAll('.filter-chip'), function (x) { x.classList.toggle('active', x === b); });
      renderEdit();
    });
  });

  /* 变换 */
  function bindXf(id, key, scale) {
    $(id).addEventListener('input', function () {
      if (!E.sel) return;
      var v = parseInt($(id).value, 10) * (scale || 1);
      if (key === 'tx' || key === 'ty') E.sel[key] = v;
      else E.sel[key] = v;
      var lbl = $(id + 'v'); if (lbl) lbl.textContent = (key === 'scale' || key === 'opacity') ? $(id).value + '%' : (key === 'rot' ? $(id).value + '°' : $(id).value);
      renderEdit();
    });
  }
  bindXf('xfX', 'tx'); bindXf('xfY', 'ty'); bindXf('xfScale', 'scale', 0.01); bindXf('xfRot', 'rot'); bindXf('xfOpacity', 'opacity', 0.01);

  /* 加文字 / 图片 */
  $('addTextBtn').addEventListener('click', addText);
  $('updateTextBtn').addEventListener('click', addText);
  $('addImgBtn').addEventListener('click', function () { $('addImgInput').click(); });
  $('addImgInput').addEventListener('change', function () { if ($('addImgInput').files && $('addImgInput').files[0]) addImageFile($('addImgInput').files[0]); $('addImgInput').value = ''; });

  /* 导出 */
  $('expPngBtn').addEventListener('click', exportPng);
  $('expJpgBtn').addEventListener('click', exportJpg);
  $('expPsdBtn').addEventListener('click', exportPsd);

  /* 上传新图（清空重来） */
  $('resetEditBtn').addEventListener('click', function () {
    S.layers = []; E.sel = null; E.crop = null; E.cropMode = false; E.rect = null;
    E.bg = { mode: 'keep', color: '#ffffff', image: null };
    $('bgMode').value = 'keep'; $('bgColorRow').classList.add('hidden');
    enterEditor();
    setEditStatus('已清空，上传一张新图重新开始');
  });

  /* 裁剪 */
  $('cropBtn').addEventListener('click', function () {
    if (!hasContent()) return;
    E.cropMode = !E.cropMode;
    if (E.cropMode) {
      E.rect = E.crop ? { x: E.crop.x, y: E.crop.y, w: E.crop.w, h: E.crop.h } : { x: 0, y: 0, w: S.W, h: S.H };
      $('cropApply').classList.remove('hidden'); $('cropCancel').classList.remove('hidden'); $('cropPresets').classList.remove('hidden');
      $('cropBtn').textContent = '✂ 裁剪中…'; $('cropBtn').classList.add('btn-primary');
      renderEdit();
    } else { cancelCrop(); }
  });
  $('cropApply').addEventListener('click', applyCrop);
  $('cropCancel').addEventListener('click', cancelCrop);
  Array.prototype.forEach.call(document.querySelectorAll('.crop-preset'), function (b) {
    b.addEventListener('click', function () { setCropPreset(b.getAttribute('data-aspect')); });
  });

  /* 画布交互：选中 / 拖动 / 裁剪 */
  (function () {
    var cv = $('editCv');
    function down(e) {
      if (E.cropMode) {
        var p = clientToImg(e);
        var which = cropHandleAt(p.x, p.y);
        if (which) { E.drag = { type: which }; e.preventDefault(); }
        return;
      }
      var p2 = clientToImg(e);
      var hit = hitLayer(p2.x, p2.y);
      if (hit) { E.sel = hit; E.drag = { type: 'move', lx: p2.x, ly: p2.y }; renderEditList(); renderEdit(); updatePropPanel(); e.preventDefault(); }
      else { E.sel = null; renderEditList(); renderEdit(); updatePropPanel(); }
    }
    function move(e) {
      if (!E.drag) return;
      var p = clientToImg(e);
      if (E.drag.type === 'move') {
        var L = E.sel; if (!L) return;
        L.tx = (L.tx || 0) + (p.x - E.drag.lx); L.ty = (L.ty || 0) + (p.y - E.drag.ly);
        E.drag.lx = p.x; E.drag.ly = p.y;
        renderEdit(); updatePropPanel();
      } else {
        resizeCrop(E.drag.type, p.x, p.y);
        renderEdit();
      }
      e.preventDefault();
    }
    function up() { E.drag = null; }
    cv.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', function (e) { if (e.touches[0]) down(e.touches[0]); }, { passive: false });
    window.addEventListener('touchmove', function (e) { if (e.touches[0]) move(e.touches[0]); }, { passive: false });
    window.addEventListener('touchend', up);
  })();

  function resizeCrop(which, ix, iy) {
    var r = E.rect; if (!r) return;
    var x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    if (which === 'tl') { x0 = clamp(ix, 0, x1 - 20); y0 = clamp(iy, 0, y1 - 20); }
    else if (which === 'tr') { x1 = clamp(ix, x0 + 20, S.W); y0 = clamp(iy, 0, y1 - 20); }
    else if (which === 'br') { x1 = clamp(ix, x0 + 20, S.W); y1 = clamp(iy, y0 + 20, S.H); }
    else if (which === 'bl') { x0 = clamp(ix, 0, x1 - 20); y1 = clamp(iy, y0 + 20, S.H); }
    else if (which === 'move') {
      var dx = ix - (r.x + r.w / 2), dy = iy - (r.y + r.h / 2);
      r.x = clamp(r.x + dx, 0, S.W - r.w); r.y = clamp(r.y + dy, 0, S.H - r.h);
      return;
    }
    r.x = x0; r.y = y0; r.w = x1 - x0; r.h = y1 - y0;
  }

  window.addEventListener('resize', function () { if (!E.cropMode) renderEdit(); });

  /* ---------------- 测试钩子 ---------------- */
  window.__appTest.editor = {
    hasContent: hasContent,
    addText: addText,
    startFromImage: startFromImage,
    setBgMode: function (m) { E.bg.mode = m; if ($('bgMode')) $('bgMode').value = m; renderEdit(); },
    setAdj: function (k, v) { if (E.sel) { E.sel.adj = E.sel.adj || {}; E.sel.adj[k] = v; renderEdit(); } },
    setXf: function (k, v) { if (E.sel) { E.sel[k] = v; renderEdit(); } },
    selectLayer: selectLayer,
    exportPng: exportPng,
    exportJpg: exportJpg,
    exportPsd: exportPsd,
    getState: function () {
      return {
        layers: S.layers.length,
        sel: E.sel ? E.sel.name : null,
        bg: E.bg.mode,
        crop: E.crop,
        size: S.W + '×' + S.H,
        names: S.layers.map(function (L) { return L.name; })
      };
    },
    E: E
  };
})();
