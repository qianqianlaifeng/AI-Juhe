/* ===================== 人脸处理工具箱 ===================== */
/* 纯前端实现：face-api.js 自动检测 + Canvas 可拖动/可删除/可调密度的遮挡图层 */

(() => {
  "use strict";

  /* ---------- DOM ---------- */
  const dropZone    = document.getElementById("dropZone");
  const fileInput   = document.getElementById("fileInput");
  const pickBtn     = document.getElementById("pickBtn");
  const workspace   = document.getElementById("workspace");
  const canvas      = document.getElementById("canvas");
  const canvasWrap  = document.getElementById("canvasWrap");
  const canvasBox   = document.getElementById("canvasBox");
  const layerStack  = document.getElementById("layerStack");
  const statusEl    = document.getElementById("status");
  const rerollBtn   = document.getElementById("rerollBtn");
  const addBtn      = document.getElementById("addBtn");
  const manualBtn   = document.getElementById("manualBtn");
  const resetBtn    = document.getElementById("resetBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const undoBtn     = document.getElementById("undoBtn");
  const redoBtn     = document.getElementById("redoBtn");
  const effectList  = document.getElementById("effectList");
  const manualHint  = document.getElementById("manualHint");
  const loader      = document.getElementById("loader");
  const loaderText  = document.getElementById("loaderText");
  const editor      = document.getElementById("editor");
  const editorName  = document.getElementById("editorName");
  const density     = document.getElementById("density");
  const densityVal  = document.getElementById("densityVal");
  const opacity     = document.getElementById("opacity");
  const opacityVal  = document.getElementById("opacityVal");
  const delBtn      = document.getElementById("delBtn");
  const effectType  = document.getElementById("effectType");
  const dupBtn      = document.getElementById("dupBtn");
  const unifyBtn    = document.getElementById("unifyBtn");
  const cropBtn      = document.getElementById("cropBtn");
  const inpaintBtn   = document.getElementById("inpaintBtn");
  const inpaintPanel = document.getElementById("inpaintPanel");
  const maskCanvas   = document.getElementById("maskCanvas");
  const brushSize    = document.getElementById("brushSize");
  const brushVal     = document.getElementById("brushVal");
  const inpaintApply = document.getElementById("inpaintApply");
  const inpaintClear = document.getElementById("inpaintClear");
  const inpaintExit  = document.getElementById("inpaintExit");
  const brightness   = document.getElementById("brightness");
  const contrast     = document.getElementById("contrast");
  const saturation   = document.getElementById("saturation");
  const blur         = document.getElementById("blur");
  const grayToggle   = document.getElementById("grayToggle");
  const brightVal    = document.getElementById("brightVal");
  const contrastVal  = document.getElementById("contrastVal");
  const satVal       = document.getElementById("satVal");
  const blurVal      = document.getElementById("blurVal");
  const resetAdj     = document.getElementById("resetAdj");
  const matteBtn     = document.getElementById("matteBtn");
  const bgPanel      = document.getElementById("bgPanel");
  const ratioBtn     = document.getElementById("ratioBtn");
  const ratioPanel   = document.getElementById("ratioPanel");
  const ratioOptions = document.getElementById("ratioOptions");
  const matteReset   = document.getElementById("matteReset");

  /* ---------- 状态 ---------- */
  const state = {
    img: null,
    manual: false,
    tool: null,                         // null | 'manual' | 'crop' | 'inpaint'
    pickType: null,
    origCanvas: null,                   // 未调整前的原始底图（裁剪/去水印会写回它）
    adjust: { brightness: 0, contrast: 0, saturation: 0, blur: 0, gray: false },
    matted: false,                      // 是否已自动抠图
    matteCanvas: null,                  // 抠出的前景（含透明通道）
    bgColor: "#FFFFFF",                 // 抠图后底色
    cropRatio: null,                    // 比例裁剪锁定比例（宽/高），null 为自由
  };
  let currentRatioConfig = null;       // 当前选中的比例配置
  let layers = [];          // {id,type,x,y,w,h,density,opacity,seed,_el,_cv}
  let selectedId = null;
  let layerSeq = 0;
  let defaultDensity = 5;

  const undoStack = [];
  const redoStack = [];

  /* ---------- 效果定义 ---------- */
  const EFFECT_KEYS = [
    "grid", "stocking", "doodle", "puzzle", "bokeh", "metal",
    "doodleGrid", "fragment", "cyber",
  ];
  const EFFECT_NAMES = {
    grid:       "基础网格",
    stocking:   "面部丝袜",
    doodle:     "涂鸦风格",
    puzzle:     "拼图碎片",
    bokeh:      "光点散射",
    metal:      "金属网格",
    doodleGrid: "透明涂鸦",
    fragment:   "面部残缺",
    cyber:      "赛博金属",
  };

  /* ---------- 工具函数 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dmap(d, lo, hi) { return Math.round(lerp(lo, hi, (d - 1) / 9)); } // 密度1..10 → lo..hi
  function randomType() { return EFFECT_KEYS[Math.floor(Math.random() * EFFECT_KEYS.length)]; }
  function pickType() { return state.pickType || randomType(); }
  function clipFace(c, b) {
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const rx = b.width / 2 * 1.04, ry = b.height / 2 * 1.06;
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.clip();
  }
  function line(c, x1, y1, x2, y2) {
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  function roundRectPath(c, x, y, w, h, r) {
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function newLayer(type, x, y, w, h, density, seed) {
    return {
      id: ++layerSeq, type, x, y, w, h,
      density: density == null ? defaultDensity : density,
      opacity: 1,
      seed: seed == null ? ((Math.random() * 1e9) | 0) : seed,
    };
  }

  /* ===================== 九种遮挡效果（均接受 density） ===================== */

  // 1. 基础网格
  function drawGrid(c, b, rng, d) {
    c.save(); clipFace(c, b);
    c.fillStyle = "rgba(15,17,25,0.80)";
    c.fillRect(b.x, b.y, b.width, b.height);
    const cols = dmap(d, 4, 14);
    const rows = Math.max(3, Math.round(cols * b.height / b.width));
    const cw = b.width / cols, ch = b.height / rows;
    c.strokeStyle = "rgba(255,255,255,0.88)";
    c.lineWidth = Math.max(1.5, b.width / 90) * lerp(1.15, 0.7, (d - 1) / 9);
    for (let i = 0; i <= cols; i++) line(c, b.x + i * cw, b.y, b.x + i * cw, b.y + b.height);
    for (let j = 0; j <= rows; j++) line(c, b.x, b.y + j * ch, b.x + b.width, b.y + j * ch);
    c.restore();
  }

  // 2. 面部丝袜
  function drawStocking(c, b, rng, d) {
    c.save(); clipFace(c, b);
    c.fillStyle = "rgba(120,90,80,0.22)";
    c.fillRect(b.x, b.y, b.width, b.height);
    const step = lerp(b.width / 30, b.width / 12, (d - 1) / 9);
    c.strokeStyle = "rgba(35,25,25,0.55)"; c.lineWidth = 1;
    for (let s = -b.height; s < b.width; s += step) {
      line(c, b.x + s, b.y, b.x + s + b.height, b.y + b.height);
      line(c, b.x + s, b.y + b.height, b.x + s + b.height, b.y);
    }
    c.strokeStyle = "rgba(255,235,225,0.18)";
    for (let s = -b.height; s < b.width; s += step * 2) {
      line(c, b.x + s, b.y, b.x + s + b.height, b.y + b.height);
    }
    c.restore();
  }

  // 3. 涂鸦风格
  function drawDoodle(c, b, rng, d) {
    c.save(); clipFace(c, b);
    c.fillStyle = "rgba(250,249,245,0.94)";
    c.fillRect(b.x, b.y, b.width, b.height);
    const palette = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#111827"];
    c.lineCap = "round";
    const n = 5 + d * 2;
    for (let i = 0; i < n; i++) {
      c.strokeStyle = palette[Math.floor(rng() * palette.length)];
      c.lineWidth = Math.max(2, b.width / 40) * (0.6 + rng());
      const x0 = b.x + rng() * b.width, y0 = b.y + rng() * b.height;
      c.beginPath(); c.moveTo(x0, y0);
      const segs = 3 + Math.floor(rng() * 4);
      for (let s = 0; s < segs; s++) {
        const cx = x0 + (rng() - 0.5) * b.width * 0.8;
        const cy = y0 + (rng() - 0.5) * b.height * 0.8;
        const ex = x0 + (rng() - 0.5) * b.width;
        const ey = y0 + (rng() - 0.5) * b.height;
        c.quadraticCurveTo(cx, cy, ex, ey);
      }
      c.stroke();
    }
    const m = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < m; i++) {
      c.fillStyle = palette[Math.floor(rng() * palette.length)];
      const r = b.width * (0.04 + rng() * 0.06);
      c.beginPath(); c.arc(b.x + rng() * b.width, b.y + rng() * b.height, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  // 4. 拼图碎片
  function drawPiece(c, x, y, w, h, tab, rng) {
    const shade = 26 + Math.floor(rng() * 26);
    c.fillStyle = `rgb(${shade},${shade + 4},${shade + 12})`;
    roundRectPath(c, x, y, w, h, Math.min(w, h) * 0.12); c.fill();
    let bx, by, dx = 0, dy = 0;
    if (tab === "top") { bx = x + w / 2; by = y; dy = -1; }
    else if (tab === "bottom") { bx = x + w / 2; by = y + h; dy = 1; }
    else if (tab === "left") { bx = x; by = y + h / 2; dx = -1; }
    else { bx = x + w; by = y + h / 2; dx = 1; }
    const r = Math.min(w, h) * 0.18;
    c.beginPath(); c.arc(bx + dx * r * 0.6, by + dy * r * 0.6, r * 0.7, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(180,190,210,0.55)"; c.lineWidth = Math.max(1.5, w / 28);
    roundRectPath(c, x, y, w, h, Math.min(w, h) * 0.12); c.stroke();
  }
  function drawPuzzle(c, b, rng, d) {
    c.save(); clipFace(c, b);
    c.fillStyle = "rgba(20,22,30,0.95)";
    c.fillRect(b.x, b.y, b.width, b.height);
    const cols = dmap(d, 2, 6), rows = cols;
    const cw = b.width / cols, ch = b.height / rows;
    const dirs = ["top", "right", "bottom", "left"];
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++)
        drawPiece(c, b.x + i * cw, b.y + j * ch, cw, ch, dirs[Math.floor(rng() * 4)], rng);
    c.restore();
  }

  // 5. 光点散射
  function drawBokeh(c, b, rng, d) {
    c.save(); clipFace(c, b);
    c.fillStyle = "rgba(12,14,22,0.55)";
    c.fillRect(b.x, b.y, b.width, b.height);
    c.globalCompositeOperation = "lighter";
    const n = 10 + d * 4;
    const colors = ["255,255,255", "255,220,150", "150,200,255", "200,160,255"];
    for (let i = 0; i < n; i++) {
      const cx = b.x + rng() * b.width, cy = b.y + rng() * b.height;
      const r = b.width * (0.02 + rng() * 0.07);
      const col = colors[Math.floor(rng() * colors.length)];
      const a = 0.15 + rng() * 0.4;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  // 6. 金属网格
  function drawMetal(c, b, rng, d) {
    c.save(); clipFace(c, b);
    c.fillStyle = "rgba(18,20,28,0.92)";
    c.fillRect(b.x, b.y, b.width, b.height);
    const cols = dmap(d, 4, 16);
    const rows = Math.max(3, Math.round(cols * b.height / b.width));
    const cw = b.width / cols, ch = b.height / rows;
    const grad = c.createLinearGradient(b.x, b.y, b.x + b.width, b.y + b.height);
    grad.addColorStop(0, "#9aa3b2"); grad.addColorStop(0.5, "#e8edf5"); grad.addColorStop(1, "#7c8493");
    c.strokeStyle = grad;
    c.lineWidth = Math.max(2, b.width / 22) * lerp(1.1, 0.7, (d - 1) / 9);
    c.lineCap = "round";
    for (let i = 0; i <= cols; i++) line(c, b.x + i * cw, b.y, b.x + i * cw, b.y + b.height);
    for (let j = 0; j <= rows; j++) line(c, b.x, b.y + j * ch, b.x + b.width, b.y + j * ch);
    for (let i = 0; i <= cols; i++)
      for (let j = 0; j <= rows; j++) {
        c.fillStyle = "#cfd6e2";
        c.beginPath(); c.arc(b.x + i * cw, b.y + j * ch, Math.max(1.5, b.width / 60), 0, Math.PI * 2); c.fill();
      }
    c.restore();
  }

  // 7. 透明涂鸦网格
  function wavyLine(c, x1, y1, x2, y2, rng, amp) {
    const cx = (x1 + x2) / 2 + (rng() - 0.5) * amp;
    const cy = (y1 + y2) / 2 + (rng() - 0.5) * amp;
    c.beginPath(); c.moveTo(x1, y1); c.quadraticCurveTo(cx, cy, x2, y2); c.stroke();
  }
  function drawDoodleGrid(c, b, rng, d) {
    c.save(); clipFace(c, b);
    const cols = dmap(d, 3, 13);
    const rows = Math.max(3, Math.round(cols * b.height / b.width));
    const cw = b.width / cols, ch = b.height / rows;
    c.strokeStyle = "rgba(255, 122, 61, 0.92)";
    c.lineWidth = Math.max(1.5, b.width / 50) * lerp(1.1, 0.7, (d - 1) / 9);
    c.lineCap = "round"; c.lineJoin = "round";
    for (let i = 0; i <= cols; i++) { const x = b.x + i * cw; wavyLine(c, x, b.y, x, b.y + b.height, rng, cw * 0.35); }
    for (let j = 0; j <= rows; j++) { const y = b.y + j * ch; wavyLine(c, b.x, y, b.x + b.width, y, rng, ch * 0.35); }
    for (let i = 0; i < 5 + Math.floor(rng() * 4); i++) {
      c.fillStyle = "rgba(255, 122, 61, 0.25)";
      c.beginPath(); c.arc(b.x + rng() * b.width, b.y + rng() * b.height, b.width * (0.02 + rng() * 0.04), 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  // 8. 面部残缺白块
  function drawFragment(c, b, rng, d) {
    c.save(); clipFace(c, b);
    const count = dmap(d, 2, 9);
    for (let i = 0; i < count; i++) {
      const w = b.width * (0.2 + rng() * 0.45);
      const h = b.height * (0.15 + rng() * 0.4);
      const x = b.x + rng() * (b.width - w);
      const y = b.y + rng() * (b.height - h);
      c.fillStyle = "rgba(255, 255, 255, 0.96)"; c.fillRect(x, y, w, h);
      c.strokeStyle = "rgba(180, 185, 195, 0.6)"; c.lineWidth = Math.max(1, b.width / 120);
      c.strokeRect(x, y, w, h);
    }
    c.restore();
  }

  // 9. 赛博金属网格（六边形蜂巢）
  function drawHexPath(c, x, y, r) {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      c.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    c.closePath();
  }
  function drawCyber(c, b, rng, d) {
    c.save(); clipFace(c, b);
    c.fillStyle = "rgba(0, 8, 20, 0.35)";
    c.fillRect(b.x, b.y, b.width, b.height);
    const r = lerp(b.width / 9, b.width / 20, (d - 1) / 9);
    const h = r * Math.sqrt(3);
    c.lineWidth = Math.max(1, b.width / 120);
    c.lineCap = "round"; c.lineJoin = "round";
    c.strokeStyle = "rgba(0, 240, 255, 0.85)";
    c.shadowColor = "rgba(0, 240, 255, 0.7)"; c.shadowBlur = b.width / 30;
    for (let row = 0, cy = b.y - h; cy <= b.y + b.height + h; cy += h, row++) {
      const xOff = (row % 2 === 0) ? 0 : 0.75 * r;
      for (let cx = b.x - 1.5 * r + xOff; cx <= b.x + b.width + 1.5 * r; cx += 1.5 * r) {
        drawHexPath(c, cx, cy, r); c.stroke();
      }
    }
    c.shadowBlur = 0;
    c.fillStyle = "rgba(255, 0, 128, 0.7)";
    for (let i = 0; i < 6 + Math.floor(rng() * 6); i++) {
      c.beginPath(); c.arc(b.x + rng() * b.width, b.y + rng() * b.height, Math.max(1, b.width / 80), 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  const EFFECTS = {
    grid: drawGrid, stocking: drawStocking, doodle: drawDoodle,
    puzzle: drawPuzzle, bokeh: drawBokeh, metal: drawMetal,
    doodleGrid: drawDoodleGrid, fragment: drawFragment, cyber: drawCyber,
  };

  /* ===================== 模型加载 ===================== */
  let modelReady = false, modelLoading = null;
  async function ensureModel() {
    if (modelReady) return true;
    if (typeof faceapi === "undefined") return false;
    if (modelLoading) return modelLoading;
    const urls = [
      "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights",
      "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights",
    ];
    modelLoading = (async () => {
      for (const u of urls) {
        try {
          showLoader("正在加载人脸检测模型…");
          await faceapi.nets.tinyFaceDetector.loadFromUri(u);
          modelReady = true; hideLoader(); return true;
        } catch (_) { /* 尝试下一个源 */ }
      }
      hideLoader(); return false;
    })();
    return modelLoading;
  }

  /* ===================== 检测 ===================== */
  async function detectFaces(src) {
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 });
    const dets = await faceapi.detectAllFaces(src, opts);
    return dets.map((d) => ({
      x: Math.round(d.box.x), y: Math.round(d.box.y),
      width: Math.round(d.box.width), height: Math.round(d.box.height),
    }));
  }

  /* ===================== 图层渲染 ===================== */
  function scale() { return canvas.clientWidth / canvas.width || 1; }

  function drawLayer(layer) {
    const cv = layer._cv; if (!cv) return;
    const c = cv.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    c.save();
    c.translate(-layer.x, -layer.y); // 把绝对坐标映射进局部画布
    const draw = EFFECTS[layer.type];
    if (draw) draw(c, { x: layer.x, y: layer.y, width: layer.w, height: layer.h }, mulberry32(layer.seed), layer.density);
    c.restore();
    cv.style.opacity = layer.opacity;
  }

  function positionLayer(layer) {
    const el = layer._el; if (!el) return;
    const s = scale();
    el.style.left   = (layer.x * s) + "px";
    el.style.top    = (layer.y * s) + "px";
    el.style.width  = (layer.w * s) + "px";
    el.style.height = (layer.h * s) + "px";
  }

  function createLayerEl(layer) {
    const el = document.createElement("div");
    el.className = "effect-layer";
    el.dataset.id = layer.id;
    const cv = document.createElement("canvas");
    cv.className = "layer-canvas";
    cv.width = Math.max(1, Math.round(layer.w));
    cv.height = Math.max(1, Math.round(layer.h));
    el.appendChild(cv);
    const del = document.createElement("button");
    del.className = "layer-del"; del.type = "button"; del.textContent = "×";
    del.title = "删除该效果"; del.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteLayer(layer.id); });
    el.appendChild(del);
    const handle = document.createElement("div");
    handle.className = "layer-handle"; handle.title = "拖动缩放";
    el.appendChild(handle);
    layer._el = el; layer._cv = cv;
    drawLayer(layer);
    el.addEventListener("pointerdown", (e) => onLayerPointerDown(e, layer));
    el.addEventListener("pointermove", onLayerPointerMove);
    el.addEventListener("pointerup", onLayerPointerUp);
    el.addEventListener("pointercancel", onLayerPointerUp);
    return el;
  }

  function rebuildLayers() {
    layerStack.innerHTML = "";
    layers.forEach((l) => layerStack.appendChild(createLayerEl(l)));
    layers.forEach((l) => positionLayer(l));
    layers.forEach((l) => l._el && l._el.classList.toggle("selected", l.id === selectedId));
    requestAnimationFrame(() => layers.forEach(positionLayer));
  }

  function setStatus(t) { statusEl.textContent = t; }

  /* ===================== 底图渲染（调参重绘） ===================== */
  function renderBase() {
    const c = ctx();
    const a = state.adjust;
    const f = [];
    if (a.brightness) f.push(`brightness(${1 + a.brightness / 100})`);
    if (a.contrast)   f.push(`contrast(${1 + a.contrast / 100})`);
    if (a.saturation) f.push(`saturate(${1 + a.saturation / 100})`);
    if (a.gray)       f.push("grayscale(1)");
    if (a.blur)       f.push(`blur(${a.blur}px)`);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.filter = f.length ? f.join(" ") : "none";
    if (state.matted && state.matteCanvas) {
      if (state.bgColor !== "transparent") {
        c.fillStyle = state.bgColor;
        c.fillRect(0, 0, canvas.width, canvas.height);
      }
      c.drawImage(state.matteCanvas, 0, 0, canvas.width, canvas.height);
    } else if (state.origCanvas) {
      c.drawImage(state.origCanvas, 0, 0, canvas.width, canvas.height);
    }
    c.filter = "none";
  }
  // 取得当前合成底图（抠图时为「前景+底色」，否则为 origCanvas），供裁剪/去水印/导出复用
  function getBaseCanvas() {
    if (state.matted && state.matteCanvas) {
      const t = document.createElement("canvas");
      t.width = canvas.width; t.height = canvas.height;
      const tc = t.getContext("2d");
      if (state.bgColor !== "transparent") {
        tc.fillStyle = state.bgColor;
        tc.fillRect(0, 0, canvas.width, canvas.height);
      }
      tc.drawImage(state.matteCanvas, 0, 0, canvas.width, canvas.height);
      return t;
    }
    return state.origCanvas;
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  }

  /* ===================== 历史记录（撤销/重做，含底图与调参） ===================== */
  function serialize() {
    return layers.map((l) => ({
      id: l.id, type: l.type, x: l.x, y: l.y, w: l.w, h: l.h,
      density: l.density, opacity: l.opacity, seed: l.seed,
    }));
  }
  // 完整快照：同时记录遮挡层、调参与底图（用于裁剪/去水印的统一撤销）
  function snapshot() {
    return {
      layers: serialize(),
      adjust: { ...state.adjust },
      cw: canvas.width,
      ch: canvas.height,
      img: state.matteCanvas
        ? { matted: true, bg: state.bgColor, w: state.matteCanvas.width, h: state.matteCanvas.height, data: state.matteCanvas.toDataURL() }
        : (state.origCanvas
            ? { matted: false, w: state.origCanvas.width, h: state.origCanvas.height, data: state.origCanvas.toDataURL() }
            : null),
    };
  }
  async function restore(snap) {
    layers = snap.layers.map((d) => ({ ...d }));
    state.adjust = { ...snap.adjust };
    if (snap.img) {
      const im = await loadImage(snap.img.data);
      const oc = document.createElement("canvas");
      oc.width = snap.img.w; oc.height = snap.img.h;
      oc.getContext("2d").drawImage(im, 0, 0);
      if (snap.img.matted) { state.matted = true; state.bgColor = snap.img.bg; state.matteCanvas = oc; }
      else { state.matted = false; state.matteCanvas = null; state.origCanvas = oc; }
    }
    canvas.width = snap.cw; canvas.height = snap.ch;
    selectedId = null;
    syncAdjustUI();
    rebuildLayers(); updateEffectList(); updateEditor(); renderBase();
  }
  function pushHistory(before) { undoStack.push(before); redoStack.length = 0; updateUndoRedo(); }
  function updateUndoRedo() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); updateUndoRedo(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); updateUndoRedo(); }
  // 包裹一次性变更：变更前记快照，变更后若不同则入栈
  function withHistory(fn) {
    const before = snapshot();
    fn();
    const after = snapshot();
    const changed =
      JSON.stringify(before.layers) !== JSON.stringify(after.layers) ||
      before.img?.data !== after.img?.data ||
      JSON.stringify(before.adjust) !== JSON.stringify(after.adjust);
    if (changed) pushHistory(before);
    rebuildLayers(); updateEffectList(); updateEditor(); renderBase();
  }

  /* ===================== 图层操作 ===================== */
  function selectLayer(id) {
    selectedId = id;
    layers.forEach((l) => l._el && l._el.classList.toggle("selected", l.id === id));
    updateEffectList(); updateEditor();
  }
  function deselect() { if (selectedId !== null) { selectedId = null; selectLayer(null); } }
  function selectedLayer() { return layers.find((l) => l.id === selectedId) || null; }

  function deleteLayer(id) {
    withHistory(() => {
      layers = layers.filter((l) => l.id !== id);
      if (selectedId === id) selectedId = null;
    });
  }
  function addLayerAt(box) {
    withHistory(() => {
      const l = newLayer(pickType(), box.x, box.y, box.width, box.height, defaultDensity);
      layers.push(l); selectedId = l.id;
    });
  }
  function rerollAll() {
    withHistory(() => layers.forEach((l) => { l.type = randomType(); l.seed = (Math.random() * 1e9) | 0; }));
  }
  // 复制同款：克隆选中遮挡（同效果+同密度+同透明度），偏移一点避免完全重叠
  function dupLayer() {
    const src = selectedLayer(); if (!src) return;
    withHistory(() => {
      const l = newLayer(src.type, src.x + 28, src.y + 28, src.w, src.h, src.density);
      l.opacity = src.opacity; l.seed = src.seed;
      l.x = clamp(l.x, 0, canvas.width - l.w);
      l.y = clamp(l.y, 0, canvas.height - l.h);
      layers.push(l); selectedId = l.id;
    });
  }
  // 一键统一：把所有遮挡改成与选中遮挡完全相同的样式
  function unifyAll() {
    const src = selectedLayer(); if (!src) return;
    withHistory(() => layers.forEach((l) => {
      l.type = src.type; l.density = src.density; l.opacity = src.opacity; l.seed = src.seed;
    }));
  }

  /* ===================== 拖动 / 缩放 ===================== */
  let drag = null;
  function clientToInternal(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }
  function onLayerPointerDown(e, layer) {
    if (state.tool) return;
    e.stopPropagation();
    const p = clientToInternal(e);
    const mode = e.target.classList.contains("layer-handle") ? "resize" : "move";
    drag = { layer, mode, offX: p.x - layer.x, offY: p.y - layer.y, start: snapshot() };
    selectLayer(layer.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onLayerPointerMove(e) {
    if (!drag) return;
    const p = clientToInternal(e);
    if (drag.mode === "move") {
      let nx = p.x - drag.offX, ny = p.y - drag.offY;
      nx = clamp(nx, 0, canvas.width - drag.layer.w);
      ny = clamp(ny, 0, canvas.height - drag.layer.h);
      drag.layer.x = nx; drag.layer.y = ny;
    } else {
      let nw = p.x - drag.layer.x, nh = p.y - drag.layer.y;
      nw = clamp(nw, 20, canvas.width - drag.layer.x);
      nh = clamp(nh, 20, canvas.height - drag.layer.y);
      drag.layer.w = nw; drag.layer.h = nh;
      drag.layer._cv.width = Math.max(1, Math.round(nw));
      drag.layer._cv.height = Math.max(1, Math.round(nh));
      drawLayer(drag.layer);
    }
    positionLayer(drag.layer);
    e.preventDefault();
  }
  function onLayerPointerUp(e) {
    if (!drag) return;
    pushHistory(drag.start);
    drag = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  /* ===================== 手动框选 ===================== */
  let manDrag = null, tempBox = null;
  function startManual(e) {
    const p = clientToInternal(e);
    manDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    tempBox = document.createElement("div");
    tempBox.className = "temp-box";
    layerStack.appendChild(tempBox);
    canvasBox.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function moveManual(e) {
    if (!manDrag) return;
    const p = clientToInternal(e);
    manDrag.x1 = p.x; manDrag.y1 = p.y;
    const s = scale();
    const x = Math.min(manDrag.x0, p.x), y = Math.min(manDrag.y0, p.y);
    const w = Math.abs(p.x - manDrag.x0), h = Math.abs(p.y - manDrag.y0);
    tempBox.style.left = (x * s) + "px"; tempBox.style.top = (y * s) + "px";
    tempBox.style.width = (w * s) + "px"; tempBox.style.height = (h * s) + "px";
    e.preventDefault();
  }
  function endManual(e) {
    if (!manDrag) return;
    const x = Math.round(Math.min(manDrag.x0, manDrag.x1));
    const y = Math.round(Math.min(manDrag.y0, manDrag.y1));
    const w = Math.round(Math.abs(manDrag.x1 - manDrag.x0));
    const h = Math.round(Math.abs(manDrag.y1 - manDrag.y0));
    if (tempBox) { tempBox.remove(); tempBox = null; }
    manDrag = null;
    if (w > 10 && h > 10) addLayerAt({ x, y, width: w, height: h });
  }
  canvasBox.addEventListener("pointerdown", (e) => {
    if (state.tool === "crop") { startCrop(e); return; }
    if (state.tool === "inpaint") { startPaint(e); return; }
    if (state.tool === "ratiocrop") { return; }
    if (state.manual) { startManual(e); return; }
    if (e.target === canvas || e.target === canvasBox) deselect();
  });
  canvasBox.addEventListener("pointermove", (e) => {
    if (state.tool === "crop") moveCrop(e);
    else if (state.tool === "inpaint") movePaint(e);
    else moveManual(e);
  });
  canvasBox.addEventListener("pointerup", (e) => {
    if (state.tool === "crop") endCrop(e);
    else if (state.tool === "inpaint") endPaint(e);
    else endManual(e);
  });
  canvasBox.addEventListener("pointercancel", (e) => {
    if (state.tool === "crop") { if (cropTemp) { cropTemp.remove(); cropTemp = null; } cropDrag = null; }
    else if (state.tool === "inpaint") endPaint(e);
    else endManual(e);
  });

  /* ===================== 编辑面板 ===================== */
  function updateEditor() {
    const l = selectedLayer();
    if (dupBtn) dupBtn.disabled = !l;
    if (unifyBtn) unifyBtn.disabled = !l;
    if (!l) { editor.classList.add("hidden"); return; }
    editor.classList.remove("hidden");
    editorName.textContent = EFFECT_NAMES[l.type] || l.type;
    density.value = l.density; densityVal.textContent = l.density;
    const op = Math.round(l.opacity * 100);
    opacity.value = op; opacityVal.textContent = op + "%";
  }
  let sliderSnap = null;
  function onSliderInput(which) {
    const l = selectedLayer(); if (!l) return;
    if (sliderSnap === null) sliderSnap = snapshot();
    if (which === "density") {
      l.density = parseInt(density.value, 10);
      densityVal.textContent = l.density;
      drawLayer(l);
    } else {
      l.opacity = parseInt(opacity.value, 10) / 100;
      opacityVal.textContent = opacity.value + "%";
      l._cv.style.opacity = l.opacity;
    }
  }
  function onSliderChange() {
    if (sliderSnap !== null) { pushHistory(sliderSnap); sliderSnap = null; }
  }
  density.addEventListener("input", () => onSliderInput("density"));
  density.addEventListener("change", onSliderChange);
  opacity.addEventListener("input", () => onSliderInput("opacity"));
  opacity.addEventListener("change", onSliderChange);

  /* ===================== 效果列表 ===================== */
  function updateEffectList() {
    effectList.innerHTML = "";
    layers.forEach((l, i) => {
      const div = document.createElement("div");
      div.className = "effect-item" + (l.id === selectedId ? " selected" : "");
      const dot = document.createElement("span"); dot.className = "effect-dot";
      const name = document.createElement("span"); name.className = "e-name";
      name.textContent = EFFECT_NAMES[l.type] || l.type;
      const idx = document.createElement("span"); idx.className = "e-idx";
      idx.textContent = "遮挡 " + (i + 1);
      const del = document.createElement("button");
      del.className = "e-del"; del.type = "button"; del.textContent = "✕";
      del.title = "删除"; del.addEventListener("click", (e) => { e.stopPropagation(); deleteLayer(l.id); });
      div.append(dot, name, idx, del);
      div.addEventListener("click", () => selectLayer(l.id));
      effectList.appendChild(div);
    });
  }

  /* ===================== 文件 / 检测 ===================== */
  function setupCanvasSize(img) {
    const maxDim = 1600;
    const w = img.naturalWidth, h = img.naturalHeight;
    const s = Math.min(1, maxDim / Math.max(w, h));
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
  }
  function showWorkspace() {
    dropZone.classList.add("hidden");
    workspace.classList.remove("hidden");
  }
  function clearAll() {
    layers = []; selectedId = null; layerSeq = 0;
    undoStack.length = 0; redoStack.length = 0; updateUndoRedo();
    state.adjust = { brightness: 0, contrast: 0, saturation: 0, blur: 0, gray: false };
    state.origCanvas = null;
    state.matted = false; state.matteCanvas = null; state.bgColor = "#FFFFFF"; state.cropRatio = null;
    syncAdjustUI();
  }
  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) { alert("请选择图片文件"); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      state.img = img;
      // 载入新图时重置抠图状态
      state.matted = false; state.matteCanvas = null; state.bgColor = "#FFFFFF"; setToolBg(false);
      setupCanvasSize(img);
      ctx().drawImage(img, 0, 0, canvas.width, canvas.height);
      // 备份原始底图，供裁剪 / 去水印 / 调参使用
      state.adjust = { brightness: 0, contrast: 0, saturation: 0, blur: 0, gray: false };
      state.origCanvas = document.createElement("canvas");
      state.origCanvas.width = canvas.width;
      state.origCanvas.height = canvas.height;
      state.origCanvas.getContext("2d").drawImage(canvas, 0, 0);
      renderBase();
      showLoader("正在检测人脸…");
      let boxes = [];
      const ok = await ensureModel();
      if (ok) { try { boxes = await detectFaces(canvas); } catch (_) { boxes = []; } }
      hideLoader();
      // 仅重置遮挡层与历史，保留原始底图 origCanvas（裁剪/去水印/调参都依赖它）
      layers = []; selectedId = null; layerSeq = 0;
      undoStack.length = 0; redoStack.length = 0; updateUndoRedo();
      syncAdjustUI();
      layers = boxes.map((b) => newLayer(randomType(), b.x, b.y, b.width, b.height, defaultDensity));
      showWorkspace();
      if (matteBtn) matteBtn.disabled = false;
      if (ratioBtn) ratioBtn.disabled = false;
      if (ok && boxes.length === 0) setStatus("未检测到人脸，可用「✏️ 手动框选」或「➕ 添加遮挡」");
      else if (!ok) { setStatus("自动检测不可用，请用手动框选 / 添加遮挡"); enableManual(); }
      else setStatus("检测到 " + boxes.length + " 张人脸，可拖动遮挡块微调位置");
      rebuildLayers(); updateEffectList(); updateEditor();
    };
    img.onerror = () => { hideLoader(); alert("图片加载失败"); };
    img.src = url;
  }
  // 基础画布上下文（仅用于绘制原图；效果绘制在独立图层上）
  function ctx() { return canvas.getContext("2d"); }

  function enableManual() { setTool("manual"); }
  function disableManual() { setTool(null); }

  /* ===================== 导出 ===================== */
  function composeCanvas() {
    const out = document.createElement("canvas");
    out.width = canvas.width; out.height = canvas.height;
    const o = out.getContext("2d");
    o.drawImage(canvas, 0, 0);
    layers.forEach((l) => {
      if (!l._cv) return;
      o.save();
      o.globalAlpha = l.opacity;
      o.drawImage(l._cv, l.x, l.y, l.w, l.h);
      o.restore();
    });
    return out;
  }

  /* ===================== 工具模式切换 ===================== */
  let cropDrag = null, cropTemp = null, cropActions = null, cropRect = null;
  let maskCtx = null, painting = false, lastPt = null, adjSnap = null;

  function syncAdjustUI() {
    if (!brightness) return;
    brightness.value = state.adjust.brightness; brightVal.textContent = state.adjust.brightness;
    contrast.value = state.adjust.contrast;   contrastVal.textContent = state.adjust.contrast;
    saturation.value = state.adjust.saturation; satVal.textContent = state.adjust.saturation;
    blur.value = state.adjust.blur;           blurVal.textContent = state.adjust.blur;
    grayToggle.checked = state.adjust.gray;
  }

  function setTool(t) {
    state.tool = t;
    state.manual = (t === "manual");
    canvasWrap.classList.toggle("manual-active", t === "manual");
    canvasWrap.classList.toggle("inpaint-active", t === "inpaint");
    manualHint.classList.toggle("hidden", t !== "manual");
    manualBtn.textContent = t === "manual" ? "✏️ 完成框选" : "✏️ 手动框选";
    if (inpaintPanel) inpaintPanel.classList.toggle("hidden", t !== "inpaint");
    if (maskCanvas)   maskCanvas.classList.toggle("hidden", t !== "inpaint");
    if (cropBtn)      cropBtn.classList.toggle("active", t === "crop");
    if (inpaintBtn)   inpaintBtn.classList.toggle("active", t === "inpaint");
    if (ratioBtn)     ratioBtn.classList.toggle("active", t === "ratiocrop");
    if (ratioPanel)   ratioPanel.classList.toggle("hidden", t !== "ratiocrop");
    if (t !== "inpaint") clearMask();
    if (t !== "crop") removeCropActions();
    if (t !== "ratiocrop") { removeRatioBox(); removeRatioActions(); }
    if (t === "inpaint") initMask();
  }

  /* ===================== 裁剪 ===================== */
  function startCrop(e) {
    const p = clientToInternal(e);
    cropDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    cropTemp = document.createElement("div");
    cropTemp.className = "temp-box";
    layerStack.appendChild(cropTemp);
    try { canvasBox.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }
  function moveCrop(e) {
    if (!cropDrag) return;
    const p = clientToInternal(e);
    cropDrag.x1 = p.x; cropDrag.y1 = p.y;
    const s = scale();
    const x = Math.min(cropDrag.x0, p.x), y = Math.min(cropDrag.y0, p.y);
    const w = Math.abs(p.x - cropDrag.x0), h = Math.abs(p.y - cropDrag.y0);
    cropTemp.style.left = (x * s) + "px"; cropTemp.style.top = (y * s) + "px";
    cropTemp.style.width = (w * s) + "px"; cropTemp.style.height = (h * s) + "px";
    e.preventDefault();
  }
  function endCrop(e) {
    if (!cropDrag) return;
    const x = Math.round(Math.min(cropDrag.x0, cropDrag.x1));
    const y = Math.round(Math.min(cropDrag.y0, cropDrag.y1));
    const w = Math.round(Math.abs(cropDrag.x1 - cropDrag.x0));
    const h = Math.round(Math.abs(cropDrag.y1 - cropDrag.y0));
    cropDrag = null;
    if (cropTemp) { cropTemp.remove(); cropTemp = null; }
    if (w < 10 || h < 10) { removeCropActions(); return; }
    cropRect = { x, y, width: w, height: h };
    showCropActions();
  }
  function showCropActions() {
    removeCropActions();
    cropActions = document.createElement("div");
    cropActions.className = "crop-actions";
    const ok = document.createElement("button");
    ok.className = "btn btn-primary"; ok.type = "button"; ok.textContent = "✅ 应用裁剪";
    const cancel = document.createElement("button");
    cancel.className = "btn btn-ghost"; cancel.type = "button"; cancel.textContent = "✕ 取消";
    ok.addEventListener("click", applyCrop);
    cancel.addEventListener("click", () => { removeCropActions(); cropRect = null; });
    cropActions.append(ok, cancel);
    canvasWrap.appendChild(cropActions);
  }
  function removeCropActions() { if (cropActions) { cropActions.remove(); cropActions = null; } }
  function applyCrop() {
    if (!cropRect) return;
    const before = snapshot();
    const { x, y, width: w, height: h } = cropRect;
    const base = getBaseCanvas();
    const tmp = document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    tmp.getContext("2d").drawImage(base, x, y, w, h, 0, 0, w, h);
    state.origCanvas = tmp;
    state.matted = false; state.matteCanvas = null;
    canvas.width = w; canvas.height = h;
    layers = layers
      .filter((l) => {
        const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
        return cx >= 0 && cx <= w && cy >= 0 && cy <= h;
      })
      .map((l) => ({ ...l, x: l.x - x, y: l.y - y }));
    selectedId = null;
    cropRect = null; removeCropActions(); setTool(null);
    rebuildLayers(); updateEffectList(); updateEditor(); renderBase();
    pushHistory(before);
    setStatus("已裁剪，可继续编辑或导出");
  }

  /* ===================== 涂抹去水印 ===================== */
  function initMask() {
    if (!maskCanvas) return;
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    maskCtx = maskCanvas.getContext("2d");
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  }
  function clearMask() {
    if (maskCtx) maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  }
  function startPaint(e) {
    if (state.tool !== "inpaint") return;
    painting = true; lastPt = null;
    try { maskCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    paintAt(e); e.preventDefault();
  }
  function paintAt(e) {
    if (!painting || !maskCtx) return;
    const rect = maskCanvas.getBoundingClientRect();
    const sx = maskCanvas.width / rect.width, sy = maskCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
    const r = (parseInt(brushSize.value, 10) / 2) * (maskCanvas.width / rect.width);
    maskCtx.strokeStyle = "rgba(255,40,80,0.6)";
    maskCtx.fillStyle = "rgba(255,40,80,0.6)";
    maskCtx.lineWidth = r * 2; maskCtx.lineCap = "round"; maskCtx.lineJoin = "round";
    if (lastPt) {
      maskCtx.beginPath(); maskCtx.moveTo(lastPt.x, lastPt.y); maskCtx.lineTo(x, y); maskCtx.stroke();
    } else {
      maskCtx.beginPath(); maskCtx.arc(x, y, r, 0, Math.PI * 2); maskCtx.fill();
    }
    lastPt = { x, y };
  }
  function movePaint(e) { if (painting) paintAt(e); }
  function endPaint(e) {
    painting = false; lastPt = null;
    try { maskCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  // 拉普拉斯扩散修补：对蒙版区域用邻域已知像素迭代平均，平滑填补
  function inpaintRegion(srcCanvas, mask, w, h) {
    const c = srcCanvas.getContext("2d");
    const img = c.getImageData(0, 0, w, h);
    const d = img.data;
    const N = w * h;
    let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mask[i]) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
    if (count === 0) return;
    minX = Math.max(1, minX); maxX = Math.min(w - 2, maxX);
    minY = Math.max(1, minY); maxY = Math.min(h - 2, maxY);
    const r = new Float32Array(N), g = new Float32Array(N), b = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (mask[i]) continue;
      const k = i * 4;
      r[i] = d[k]; g[i] = d[k + 1]; b[i] = d[k + 2];
    }
    const iters = Math.min(80, 12 + Math.round(Math.sqrt(count)));
    for (let it = 0; it < iters; it++) {
      const nr = new Float32Array(r), ng = new Float32Array(g), nb = new Float32Array(b);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const i = y * w + x;
          if (!mask[i]) continue;
          let sr = 0, sg = 0, sb = 0, cnt = 0;
          const nbIdx = [i - 1, i + 1, i - w, i + w];
          for (let n = 0; n < 4; n++) { const j = nbIdx[n]; sr += r[j]; sg += g[j]; sb += b[j]; cnt++; }
          nr[i] = sr / cnt; ng[i] = sg / cnt; nb[i] = sb / cnt;
        }
      }
      r.set(nr); g.set(ng); b.set(nb);
    }
    for (let i = 0; i < N; i++) {
      if (!mask[i]) continue;
      const k = i * 4;
      d[k] = clamp(r[i], 0, 255); d[k + 1] = clamp(g[i], 0, 255); d[k + 2] = clamp(b[i], 0, 255); d[k + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }
  function applyInpaint() {
    if (!maskCtx) return;
    const w = maskCanvas.width, h = maskCanvas.height;
    const mdata = maskCtx.getImageData(0, 0, w, h);
    const m = mdata.data;
    const maskArr = new Uint8Array(w * h);
    let count = 0;
    for (let i = 0; i < w * h; i++) { if (m[i * 4 + 3] > 20) { maskArr[i] = 1; count++; } }
    if (count === 0) { alert("请先涂抹要去除的水印区域"); return; }
    const before = snapshot();
    const base = getBaseCanvas();
    inpaintRegion(base, maskArr, w, h);
    state.origCanvas = base; state.matted = false; state.matteCanvas = null;
    renderBase();
    clearMask();
    pushHistory(before);
    setStatus("已去除水印，可继续涂抹或导出");
  }

  /* ===================== 自动抠图（背景移除） ===================== */
  let selfie = null, segResolve = null, segLoading = null;
  const SEG_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation";
  function loadSelfieScript() {
    return new Promise((resolve, reject) => {
      if (window.SelfieSegmentation) { resolve(); return; }
      const s = document.createElement("script");
      s.src = SEG_CDN + "/selfie_segmentation.js";
      s.crossOrigin = "anonymous";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("抠图模型脚本加载失败，请检查网络"));
      document.head.appendChild(s);
    });
  }
  async function ensureSelfie() {
    if (selfie) return selfie;
    if (segLoading) return segLoading;
    segLoading = (async () => {
      await loadSelfieScript();
      selfie = new SelfieSegmentation({ locateFile: (f) => SEG_CDN + "/" + f });
      selfie.setOptions({ modelSelection: 1, selfieMode: false });
      selfie.onResults((results) => { if (segResolve) { const r = segResolve; segResolve = null; r(results); } });
      return selfie;
    })();
    return segLoading;
  }
  async function runSegmentation(srcCanvas) {
    return new Promise((resolve, reject) => {
      segResolve = resolve;
      selfie.send({ image: srcCanvas }).catch(reject);
    });
  }
  async function runMatting() {
    if (!state.img) return;
    try {
      showLoader("正在加载抠图模型…");
      await ensureSelfie();
      showLoader("正在抠图（首次约需几秒）…");
      const results = await runSegmentation(canvas);
      const srcW = canvas.width, srcH = canvas.height;
      const mask = results.segmentationMask;
      const img = results.image;
      // 读取蒙版亮度作为 alpha（不依赖蒙版 alpha 通道格式，更稳健）
      const mcv = document.createElement("canvas");
      mcv.width = srcW; mcv.height = srcH;
      const mcx = mcv.getContext("2d");
      mcx.drawImage(mask, 0, 0, srcW, srcH);
      const md = mcx.getImageData(0, 0, srcW, srcH).data;
      const fcv = document.createElement("canvas");
      fcv.width = srcW; fcv.height = srcH;
      const fcx = fcv.getContext("2d");
      fcx.drawImage(img, 0, 0, srcW, srcH);
      const fd = fcx.getImageData(0, 0, srcW, srcH);
      for (let i = 0; i < fd.data.length; i += 4) {
        const lum = md[i] * 0.299 + md[i + 1] * 0.587 + md[i + 2] * 0.114;
        fd.data[i + 3] = lum;
      }
      fcx.putImageData(fd, 0, 0);
      const before = snapshot();
      state.matteCanvas = fcv;
      state.matted = true;
      state.bgColor = "#FFFFFF";
      renderBase();
      hideLoader();
      setToolBg(true);
      syncBgSwatches();
      setStatus("抠图完成！可选 白底 / 蓝底 / 红底 / 透明，或继续编辑");
      pushHistory(before);
    } catch (e) {
      hideLoader();
      alert("抠图失败：" + (e && e.message ? e.message : e) + "\n（模型需联网从 CDN 加载，请检查网络后重试）");
    }
  }
  function setToolBg(show) { if (bgPanel) bgPanel.classList.toggle("hidden", !show); }
  function syncBgSwatches() {
    document.querySelectorAll(".bg-swatch").forEach((b) => {
      b.classList.toggle("active", b.dataset.bg === state.bgColor);
    });
  }

  /* ===================== 比例裁剪 ===================== */
  const CROP_RATIOS = [
    { key: "1inch",  label: "1寸",   sub: "295×413 证件照", ratio: 295 / 413, out: [295, 413] },
    { key: "2inch",  label: "2寸",   sub: "413×579 证件照", ratio: 413 / 579, out: [413, 579] },
    { key: "small2", label: "小2寸", sub: "413×531 证件照", ratio: 413 / 531, out: [413, 531] },
    { key: "1_1",    label: "1:1",   sub: "正方形",         ratio: 1 },
    { key: "3_4",    label: "3:4",   sub: "竖版",           ratio: 3 / 4 },
    { key: "4_3",    label: "4:3",   sub: "横版",           ratio: 4 / 3 },
    { key: "9_16",   label: "9:16",  sub: "手机竖屏",       ratio: 9 / 16 },
    { key: "16_9",   label: "16:9",  sub: "宽屏",           ratio: 16 / 9 },
  ];
  let ratioRect = null, ratioBox = null, ratioHandle = null, ratioDrag = null, ratioActions = null;
  function buildRatioOptions() {
    if (!ratioOptions) return;
    ratioOptions.innerHTML = "";
    CROP_RATIOS.forEach((cfg, idx) => {
      const btn = document.createElement("button");
      btn.className = "ratio-btn" + (idx === 0 ? " active" : "");
      btn.type = "button";
      btn.innerHTML = `${cfg.label}<small>${cfg.sub}</small>`;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".ratio-btn").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        currentRatioConfig = cfg;
        state.cropRatio = cfg.ratio;
        createRatioBox(cfg.ratio);
      });
      ratioOptions.appendChild(btn);
    });
    const first = ratioOptions.querySelector(".ratio-btn");
    if (first) first.click();
  }
  function createRatioBox(ratio) {
    removeRatioBox();
    const cw = canvas.width, ch = canvas.height;
    let w, h;
    if (cw / ch > ratio) { h = ch * 0.9; w = h * ratio; } else { w = cw * 0.9; h = w / ratio; }
    w = Math.round(w); h = Math.round(h);
    const x = Math.round((cw - w) / 2), y = Math.round((ch - h) / 2);
    ratioRect = { x, y, w, h };
    ratioBox = document.createElement("div");
    ratioBox.className = "ratio-box";
    ratioHandle = document.createElement("div");
    ratioHandle.className = "ratio-handle";
    ratioBox.appendChild(ratioHandle);
    canvasBox.appendChild(ratioBox);
    positionRatioBox();
    ratioBox.addEventListener("pointerdown", onRatioBoxDown);
    ratioBox.addEventListener("pointermove", onRatioMove);
    ratioBox.addEventListener("pointerup", onRatioUp);
    ratioBox.addEventListener("pointercancel", onRatioUp);
    ratioHandle.addEventListener("pointerdown", onRatioHandleDown);
    ratioHandle.addEventListener("pointermove", onRatioMove);
    ratioHandle.addEventListener("pointerup", onRatioUp);
    ratioHandle.addEventListener("pointercancel", onRatioUp);
    showRatioActions();
  }
  function positionRatioBox() {
    if (!ratioBox || !ratioRect) return;
    const s = scale();
    ratioBox.style.left = (ratioRect.x * s) + "px";
    ratioBox.style.top = (ratioRect.y * s) + "px";
    ratioBox.style.width = (ratioRect.w * s) + "px";
    ratioBox.style.height = (ratioRect.h * s) + "px";
  }
  function onRatioBoxDown(e) {
    e.stopPropagation();
    const p = clientToInternal(e);
    ratioDrag = { mode: "move", offX: p.x - ratioRect.x, offY: p.y - ratioRect.y };
    try { ratioBox.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }
  function onRatioHandleDown(e) {
    e.stopPropagation();
    ratioDrag = { mode: "resize" };
    try { ratioHandle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }
  function onRatioMove(e) {
    if (!ratioDrag || !ratioRect) return;
    const p = clientToInternal(e);
    const cw = canvas.width, ch = canvas.height;
    if (ratioDrag.mode === "move") {
      let nx = p.x - ratioDrag.offX, ny = p.y - ratioDrag.offY;
      nx = clamp(nx, 0, cw - ratioRect.w);
      ny = clamp(ny, 0, ch - ratioRect.h);
      ratioRect.x = nx; ratioRect.y = ny;
    } else {
      let nw = clamp(p.x - ratioRect.x, 20, cw - ratioRect.x);
      let nh = nw / state.cropRatio;
      if (ratioRect.y + nh > ch) { nh = ch - ratioRect.y; nw = nh * state.cropRatio; }
      ratioRect.w = nw; ratioRect.h = nh;
    }
    positionRatioBox();
    e.preventDefault();
  }
  function onRatioUp(e) {
    ratioDrag = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  function showRatioActions() {
    removeRatioActions();
    ratioActions = document.createElement("div");
    ratioActions.className = "crop-actions";
    const ok = document.createElement("button");
    ok.className = "btn btn-primary"; ok.type = "button"; ok.textContent = "✅ 应用裁剪";
    const cancel = document.createElement("button");
    cancel.className = "btn btn-ghost"; cancel.type = "button"; cancel.textContent = "✕ 取消";
    ok.addEventListener("click", applyRatioCrop);
    cancel.addEventListener("click", () => { removeRatioBox(); ratioRect = null; removeRatioActions(); });
    ratioActions.append(ok, cancel);
    canvasWrap.appendChild(ratioActions);
  }
  function removeRatioActions() { if (ratioActions) { ratioActions.remove(); ratioActions = null; } }
  function removeRatioBox() {
    if (ratioBox) { ratioBox.remove(); ratioBox = null; ratioHandle = null; }
  }
  function applyRatioCrop() {
    if (!ratioRect) return;
    const before = snapshot();
    const { x, y, w, h } = ratioRect;
    const base = getBaseCanvas();
    const cfg = currentRatioConfig;
    let outW, outH;
    if (cfg && cfg.out) { outW = cfg.out[0]; outH = cfg.out[1]; }
    else { outW = Math.round(w); outH = Math.round(h); }
    const tmp = document.createElement("canvas");
    tmp.width = outW; tmp.height = outH;
    tmp.getContext("2d").drawImage(base, x, y, w, h, 0, 0, outW, outH);
    state.origCanvas = tmp;
    state.matted = false; state.matteCanvas = null;
    canvas.width = outW; canvas.height = outH;
    layers = []; selectedId = null;
    removeRatioBox(); ratioRect = null; removeRatioActions();
    setTool(null);
    rebuildLayers(); updateEffectList(); updateEditor(); renderBase();
    pushHistory(before);
    setStatus(`已按${cfg ? cfg.label : "该比例"}裁剪（${outW}×${outH}）`);
  }

  /* ===================== 基本图片处理（调参） ===================== */
  function onAdjustInput() {
    if (adjSnap === null) adjSnap = snapshot();
    state.adjust.brightness = parseInt(brightness.value, 10);
    state.adjust.contrast = parseInt(contrast.value, 10);
    state.adjust.saturation = parseInt(saturation.value, 10);
    state.adjust.blur = parseInt(blur.value, 10);
    brightVal.textContent = brightness.value;
    contrastVal.textContent = contrast.value;
    satVal.textContent = saturation.value;
    blurVal.textContent = blur.value;
    renderBase();
  }
  function onAdjustChange() { if (adjSnap !== null) { pushHistory(adjSnap); adjSnap = null; } }
  function resetSliders() {
    brightness.value = 0; contrast.value = 0; saturation.value = 0; blur.value = 0; grayToggle.checked = false;
    brightVal.textContent = "0"; contrastVal.textContent = "0"; satVal.textContent = "0"; blurVal.textContent = "0";
  }

  /* ===================== 事件绑定 ===================== */
  pickBtn.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("click", (e) => { if (e.target === dropZone || e.target.closest(".drop-inner")) fileInput.click(); });
  dropZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  fileInput.addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  ["dragenter", "dragover"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); }));
  dropZone.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

  rerollBtn.addEventListener("click", () => { if (layers.length) rerollAll(); });
  addBtn.addEventListener("click", () => {
    if (!state.img) return;
    const w = canvas.width * 0.3, h = canvas.height * 0.3;
    addLayerAt({ x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, width: w, height: h });
    setStatus("已添加遮挡块，可拖动到需要的位置并调节密度");
  });
  manualBtn.addEventListener("click", () => { state.manual ? disableManual() : enableManual(); });
  resetBtn.addEventListener("click", () => {
    state.img = null; clearAll();
    if (state.manual) disableManual();
    setTool(null);
    setToolBg(false);
    if (matteBtn) matteBtn.disabled = true;
    if (ratioBtn) ratioBtn.disabled = true;
    workspace.classList.add("hidden");
    dropZone.classList.remove("hidden");
    fileInput.value = "";
  });
  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);
  delBtn.addEventListener("click", () => { if (selectedId !== null) deleteLayer(selectedId); });
  dupBtn.addEventListener("click", () => { if (selectedId !== null) dupLayer(); });
  unifyBtn.addEventListener("click", () => { if (selectedId !== null) unifyAll(); });
  if (effectType) effectType.addEventListener("change", () => { state.pickType = effectType.value || null; });

  if (cropBtn) cropBtn.addEventListener("click", () => setTool(state.tool === "crop" ? null : "crop"));
  if (inpaintBtn) inpaintBtn.addEventListener("click", () => setTool(state.tool === "inpaint" ? null : "inpaint"));
  if (inpaintApply) inpaintApply.addEventListener("click", applyInpaint);
  if (inpaintClear) inpaintClear.addEventListener("click", clearMask);
  if (inpaintExit) inpaintExit.addEventListener("click", () => setTool(null));
  if (matteBtn) matteBtn.addEventListener("click", runMatting);
  if (matteReset) matteReset.addEventListener("click", () => {
    if (!state.matteCanvas) return;
    state.matted = false; state.matteCanvas = null; state.bgColor = "#FFFFFF";
    setToolBg(false);
    renderBase();
    setStatus("已恢复原始图，可重新抠图");
  });
  if (ratioBtn) ratioBtn.addEventListener("click", () => {
    if (state.tool === "ratiocrop") setTool(null);
    else { setTool("ratiocrop"); buildRatioOptions(); }
  });
  document.querySelectorAll(".bg-swatch").forEach((b) => {
    b.addEventListener("click", () => {
      if (!state.matted) return;
      state.bgColor = b.dataset.bg;
      renderBase();
      syncBgSwatches();
    });
  });
  if (brushSize) brushSize.addEventListener("input", () => { if (brushVal) brushVal.textContent = brushSize.value; });
  if (brightness) { brightness.addEventListener("input", onAdjustInput); brightness.addEventListener("change", onAdjustChange); }
  if (contrast) { contrast.addEventListener("input", onAdjustInput); contrast.addEventListener("change", onAdjustChange); }
  if (saturation) { saturation.addEventListener("input", onAdjustInput); saturation.addEventListener("change", onAdjustChange); }
  if (blur) { blur.addEventListener("input", onAdjustInput); blur.addEventListener("change", onAdjustChange); }
  if (grayToggle) grayToggle.addEventListener("change", () => {
    if (adjSnap === null) adjSnap = snapshot();
    state.adjust.gray = grayToggle.checked; renderBase(); onAdjustChange();
  });
  if (resetAdj) resetAdj.addEventListener("click", () => {
    const b = snapshot();
    resetSliders();
    state.adjust = { brightness: 0, contrast: 0, saturation: 0, blur: 0, gray: false };
    renderBase(); syncAdjustUI(); pushHistory(b);
  });

  downloadBtn.addEventListener("click", () => {
    if (!state.img) return;
    const out = composeCanvas();
    out.toBlob((blob) => {
      if (!blob) { alert("导出失败，请重试"); return; }
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = "face-toolbox-" + Date.now() + ".png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    }, "image/png");
  });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId !== null) {
      e.preventDefault(); deleteLayer(selectedId);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault(); redo();
    }
  });

  window.addEventListener("resize", () => layers.forEach(positionLayer));

  /* ---------- Loader ---------- */
  function showLoader(t) { loaderText.textContent = t; loader.classList.remove("hidden"); }
  function hideLoader() { loader.classList.add("hidden"); }

  updateUndoRedo();
  if (dupBtn) dupBtn.disabled = true;
  if (unifyBtn) unifyBtn.disabled = true;
})();
