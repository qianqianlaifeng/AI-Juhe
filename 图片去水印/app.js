/* AI 图片去水印 —— 浏览器端推理（onnxruntime-web）
 * 移植自 watermark_remover.py：
 *   1) YOLO 检测水印位置（yolo.onnx）
 *   2) 由检测框生成 mask
 *   3) MI-GAN 图像修复（migan.onnx）
 *   4) 按 mask 把修复结果合成回原图
 * 图片全程在本地处理，不上传服务器。
 */
(function () {
  'use strict';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const modelBar = $('modelBar');
  const modelStatus = $('modelStatus');
  const modelPct = $('modelPct');
  const modelProgress = $('modelProgress');
  const modelDetail = $('modelDetail');
  const dropZone = $('dropZone');
  const pickBtn = $('pickBtn');
  const fileInput = $('fileInput');
  const workspace = $('workspace');
  const srcImg = $('srcImg');
  const dstImg = $('dstImg');
  const dstPlaceholder = $('dstPlaceholder');
  const processBtn = $('processBtn');
  const downloadBtn = $('downloadBtn');
  const resetBtn = $('resetBtn');
  const logEl = $('log');

  // ---------- 状态 ----------
  let yoloSession = null;
  let miganSession = null;
  let ready = false;
  let currentImage = null;     // 当前 HTMLImageElement（原图，自然尺寸）
  let origImageData = null;    // 原图 RGBA（自然尺寸）
  let resultBlob = null;       // 处理结果 PNG blob

  const MODEL_BASE = 'models/';
  const YOLO_URL = MODEL_BASE + 'yolo.onnx';
  const MIGAN_URL = MODEL_BASE + 'migan.onnx';
  const INPUT_SIZE = 640;
  const MIGAN_SIZE = 512;
  const CONF_TH = 0.25;

  function log(msg) {
    logEl.textContent = msg;
  }

  // ---------- 工具：带进度的 fetch ----------
  async function fetchWithProgress(url, onProgress, label) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`下载模型失败 ${resp.status}: ${url}`);
    const total = Number(resp.headers.get('content-length')) || 0;
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) onProgress(received / total, label, received, total);
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out.buffer;
  }

  // ---------- 加载模型 ----------
  async function loadModel(url, onProgress, label) {
    const buf = await fetchWithProgress(url, onProgress, label);
    return await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  }

  async function initModels() {
    if (!window.ort) throw new Error('onnxruntime-web 未加载，请检查网络后刷新。');
    // 让 wasm 文件从 CDN 加载
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
    ort.env.wasm.numThreads = 1;

    const yoloSize = 5356006;
    const miganSize = 28079181;
    const totalSize = yoloSize + miganSize;
    let loaded = 0;

    const onYolo = (p, label, rec, tot) => {
      loaded = (p * yoloSize);
      updateProgress(loaded / totalSize, `YOLO 检测模型 ${label} ${(rec / 1048576).toFixed(1)}MB / ${(tot / 1048576).toFixed(1)}MB`);
    };
    const onMigan = (p, label, rec, tot) => {
      loaded = yoloSize + (p * miganSize);
      updateProgress(loaded / totalSize, `MI-GAN 修复模型 ${label} ${(rec / 1048576).toFixed(1)}MB / ${(tot / 1048576).toFixed(1)}MB`);
    };

    try {
      modelDetail.textContent = '加载 YOLO 水印检测模型…';
      yoloSession = await loadModel(YOLO_URL, onYolo, '下载中');
      modelDetail.textContent = '加载 MI-GAN 图像修复模型…';
      miganSession = await loadModel(MIGAN_URL, onMigan, '下载中');
      updateProgress(1, '模型加载完成');
      ready = true;
      modelBar.classList.add('ready');
      modelStatus.textContent = '✅ 模型已就绪，可开始处理';
      pickBtn.disabled = false;
      log('模型已就绪。请上传一张带水印的图片（建议使用 AI 生成图，如豆包 / 即梦 / 可灵 / Gemini 等平台水印）。');
    } catch (e) {
      modelStatus.textContent = '❌ 模型加载失败';
      modelDetail.textContent = '错误：' + e.message + '（请检查网络后刷新重试）';
      throw e;
    }
  }

  function updateProgress(p, detail) {
    const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
    modelProgress.style.width = pct + '%';
    modelPct.textContent = pct + '%';
    if (detail) modelDetail.textContent = detail;
  }

  // ---------- 图像缩放（对齐 cv2）----------
  // INTER_AREA 下采样（盒平均），用于 migan 输入图
  function areaResizeRGB(src, sw, sh, dw, dh) {
    const dst = new Uint8ClampedArray(dw * dh * 3);
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor((y * sh) / dh);
      const y1 = Math.ceil(((y + 1) * sh) / dh);
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor((x * sw) / dw);
        const x1 = Math.ceil(((x + 1) * sw) / dw);
        let r = 0, g = 0, b = 0, n = 0;
        for (let sy = y0; sy < y1; sy++) {
          for (let sx = x0; sx < x1; sx++) {
            const i = (sy * sw + sx) * 3;
            r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
          }
        }
        const o = (y * dw + x) * 3;
        dst[o] = r / n; dst[o + 1] = g / n; dst[o + 2] = b / n;
      }
    }
    return dst;
  }

  // INTER_NEAREST 下采样（最近邻），用于 mask
  function nearestResize(src, sw, sh, dw, dh) {
    const dst = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
        dst[y * dw + x] = src[sy * sw + sx];
      }
    }
    return dst;
  }

  // letterbox：等比缩放居中填充到 size×size（INTER_LINEAR ≈ canvas 双线性）
  function letterboxToCanvas(img, size) {
    const sw = img.naturalWidth, sh = img.naturalHeight;
    const scale = Math.min(size / sw, size / sh);
    const nw = Math.round(sw * scale), nh = Math.round(sh * scale);
    const padX = Math.round((size - nw) / 2), padY = Math.round((size - nh) / 2);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, padX, padY, nw, nh);
    return { canvas: c, scale, padX, padY, sw, sh };
  }

  // ---------- YOLO 检测（移植 detect）----------
  async function detect(imgData, sw, sh, lb) {
    const ctx = lb.canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
    const blob = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
    let idx = 0;
    // HWC -> CHW，RGB/255（canvas 已是 RGB 顺序）
    for (let y = 0; y < INPUT_SIZE; y++) {
      for (let x = 0; x < INPUT_SIZE; x++) {
        const p = (y * INPUT_SIZE + x) * 4;
        const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
        blob[(0 * INPUT_SIZE + y) * INPUT_SIZE + x] = r;
        blob[(1 * INPUT_SIZE + y) * INPUT_SIZE + x] = g;
        blob[(2 * INPUT_SIZE + y) * INPUT_SIZE + x] = b;
      }
    }
    const out = await yoloSession.run({ images: new ort.Tensor('float32', blob, [1, 3, INPUT_SIZE, INPUT_SIZE]) });
    const arr = out['output0'].data; // [1,5,8400]
    const N = 8400;
    // 找置信度 >= 阈值的框，取最高置信度
    let best = -1, bestConf = CONF_TH;
    for (let i = 0; i < N; i++) {
      const conf = arr[4 * N + i];
      if (conf >= bestConf) { bestConf = conf; best = i; }
    }
    const mask = new Uint8Array(sw * sh); // 水印区 = 255
    if (best < 0) return { boxes: [], mask };
    const cx = arr[0 * N + best], cy = arr[1 * N + best], w = arr[2 * N + best], h = arr[3 * N + best];
    let bx1 = cx - w / 2, by1 = cy - h / 2, bx2 = cx + w / 2, by2 = cy + h / 2;
    // 映射回原图坐标并钳制
    bx1 = Math.max(0, Math.min(sw, (bx1 - lb.padX) / lb.scale));
    by1 = Math.max(0, Math.min(sh, (by1 - lb.padY) / lb.scale));
    bx2 = Math.max(0, Math.min(sw, (bx2 - lb.padX) / lb.scale));
    by2 = Math.max(0, Math.min(sh, (by2 - lb.padY) / lb.scale));
    const l = Math.max(0, Math.round(bx1));
    const u = Math.max(0, Math.floor(by1));
    const d = Math.min(sw, Math.ceil(bx2));
    const f = Math.min(sh, Math.ceil(by2));
    if (d > l && f > u) {
      for (let y = u; y < f; y++)
        for (let x = l; x < d; x++) mask[y * sw + x] = 255;
    }
    return { boxes: [[bx1, by1, bx2, by2]], mask };
  }

  // ---------- MI-GAN 修复（移植 inpaint）----------
  async function inpaint(origRGB, sw, sh, mask) {
    // 输入图 512（area 下采样）
    const img512 = areaResizeRGB(origRGB, sw, sh, MIGAN_SIZE, MIGAN_SIZE);
    const imgT = new Uint8Array(1 * 3 * MIGAN_SIZE * MIGAN_SIZE);
    for (let i = 0; i < MIGAN_SIZE * MIGAN_SIZE; i++) {
      imgT[(0 * MIGAN_SIZE * MIGAN_SIZE) + i] = img512[i * 3];
      imgT[(1 * MIGAN_SIZE * MIGAN_SIZE) + i] = img512[i * 3 + 1];
      imgT[(2 * MIGAN_SIZE * MIGAN_SIZE) + i] = img512[i * 3 + 2];
    }
    // mask 512（nearest），并反色阈值化
    const mask512 = nearestResize(mask, sw, sh, MIGAN_SIZE, MIGAN_SIZE);
    const m = new Uint8Array(MIGAN_SIZE * MIGAN_SIZE);
    for (let i = 0; i < mask512.length; i++) {
      const v = 255 - mask512[i];
      m[i] = v < 255 ? 0 : 255;
    }
    const maskT = new Uint8Array(1 * 1 * MIGAN_SIZE * MIGAN_SIZE);
    maskT.set(m);

    const out = await miganSession.run({
      image: new ort.Tensor('uint8', imgT, [1, 3, MIGAN_SIZE, MIGAN_SIZE]),
      mask: new ort.Tensor('uint8', maskT, [1, 1, MIGAN_SIZE, MIGAN_SIZE]),
    });
    const res = out['result'].data; // uint8 [1,3,512,512]
    // 转 HWC RGB
    const resHWC = new Uint8ClampedArray(MIGAN_SIZE * MIGAN_SIZE * 3);
    const plane = MIGAN_SIZE * MIGAN_SIZE;
    for (let y = 0; y < MIGAN_SIZE; y++) {
      for (let x = 0; x < MIGAN_SIZE; x++) {
        const o = (y * MIGAN_SIZE + x) * 3;
        resHWC[o] = res[0 * plane + y * MIGAN_SIZE + x];
        resHWC[o + 1] = res[1 * plane + y * MIGAN_SIZE + x];
        resHWC[o + 2] = res[2 * plane + y * MIGAN_SIZE + x];
      }
    }
    // 放大回原图尺寸（INTER_AREA 上采样 ≈ 双线性），用 canvas
    const c512 = document.createElement('canvas');
    c512.width = MIGAN_SIZE; c512.height = MIGAN_SIZE;
    const ctx512 = c512.getContext('2d');
    const id512 = ctx512.createImageData(MIGAN_SIZE, MIGAN_SIZE);
    for (let i = 0; i < MIGAN_SIZE * MIGAN_SIZE; i++) {
      id512.data[i * 4] = resHWC[i * 3];
      id512.data[i * 4 + 1] = resHWC[i * 3 + 1];
      id512.data[i * 4 + 2] = resHWC[i * 3 + 2];
      id512.data[i * 4 + 3] = 255;
    }
    ctx512.putImageData(id512, 0, 0);
    const cUp = document.createElement('canvas');
    cUp.width = sw; cUp.height = sh;
    const ctxUp = cUp.getContext('2d');
    ctxUp.imageSmoothingEnabled = true;
    ctxUp.drawImage(c512, 0, 0, sw, sh);
    return ctxUp.getImageData(0, 0, sw, sh); // RGBA，原图尺寸
  }

  // ---------- 主流程 ----------
  async function processImage() {
    if (!ready || !currentImage) return;
    processBtn.disabled = true;
    downloadBtn.disabled = true;
    dstImg.hidden = true;
    dstPlaceholder.hidden = false;
    dstPlaceholder.textContent = '处理中…（YOLO 检测 → MI-GAN 修复）';
    resultBlob = null;
    try {
      const sw = currentImage.naturalWidth, sh = currentImage.naturalHeight;
      log('① YOLO 检测水印位置…');
      const lb = letterboxToCanvas(currentImage, INPUT_SIZE);
      const { boxes, mask } = await detect(lb.canvas, sw, sh, lb);
      if (!boxes.length) {
        log('未检测到水印区域，返回原图（该水印可能不在模型支持范围内）。');
        dstPlaceholder.hidden = true;
        dstImg.src = srcImg.src;
        dstImg.hidden = false;
        // 提供原图下载
        await prepareDownload(origImageData);
        return;
      }
      log('② MI-GAN 修复中（约需数秒）…');
      const resRGBA = await inpaint(origRGBFrom(origImageData), sw, sh, mask);
      // 合成：mask>128 区域用修复结果替换
      const out = new ImageData(
        new Uint8ClampedArray(origImageData.data),
        sw, sh
      );
      for (let i = 0; i < sw * sh; i++) {
        if (mask[i] > 128) {
          out.data[i * 4] = resRGBA.data[i * 4];
          out.data[i * 4 + 1] = resRGBA.data[i * 4 + 1];
          out.data[i * 4 + 2] = resRGBA.data[i * 4 + 2];
        }
      }
      const cOut = document.createElement('canvas');
      cOut.width = sw; cOut.height = sh;
      cOut.getContext('2d').putImageData(out, 0, 0);
      const url = cOut.toDataURL('image/png');
      dstImg.src = url;
      dstImg.hidden = false;
      dstPlaceholder.hidden = true;
      await prepareDownload(out);
      const b = boxes[0];
      log(`✅ 处理完成。检测到水印区域: [x1=${b[0].toFixed(0)}, y1=${b[1].toFixed(0)}, x2=${b[2].toFixed(0)}, y2=${b[3].toFixed(0)}]，已智能修复。`);
    } catch (e) {
      log('❌ 处理失败：' + e.message);
    } finally {
      processBtn.disabled = false;
    }
  }

  function origRGBFrom(imgData) {
    const n = imgData.width * imgData.height;
    const rgb = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = imgData.data[i * 4];
      rgb[i * 3 + 1] = imgData.data[i * 4 + 1];
      rgb[i * 3 + 2] = imgData.data[i * 4 + 2];
    }
    return rgb;
  }

  async function prepareDownload(imageData) {
    const c = document.createElement('canvas');
    c.width = imageData.width; c.height = imageData.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    resultBlob = await new Promise((res) => c.toBlob(res, 'image/png'));
    downloadBtn.disabled = false;
  }

  // ---------- 文件处理 ----------
  function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { log('请选择图片文件（JPG / PNG / WEBP）。'); return; }
    if (file.size > 40 * 1024 * 1024) { log('图片过大（上限 40MB）。'); return; }
    if (!ready) { log('模型仍在加载中，请稍候…'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      srcImg.src = url;
      // 取原图 RGBA（自然尺寸）
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      origImageData = ctx.getImageData(0, 0, c.width, c.height);
      workspace.classList.remove('hidden');
      dropZone.classList.add('hidden');
      dstImg.hidden = true;
      dstPlaceholder.hidden = false;
      dstPlaceholder.textContent = '已就绪，点击「开始去水印」';
      downloadBtn.disabled = true;
      resultBlob = null;
      log(`已载入: ${file.name}（${img.naturalWidth}×${img.naturalHeight}）。点击「开始去水印」。`);
    };
    img.onerror = () => log('图片读取失败，请换一张试试。');
    img.src = url;
  }

  function resetAll() {
    workspace.classList.add('hidden');
    dropZone.classList.remove('hidden');
    currentImage = null;
    origImageData = null;
    resultBlob = null;
    dstImg.src = '';
    fileInput.value = '';
    log('已重置，可重新上传。');
  }

  function downloadResult() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = '去水印结果.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- 事件绑定 ----------
  pickBtn.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('click', (e) => { if (e.target !== pickBtn) fileInput.click(); });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.style.borderColor = '';
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  processBtn.addEventListener('click', processImage);
  downloadBtn.addEventListener('click', downloadResult);
  resetBtn.addEventListener('click', resetAll);

  // ---------- 启动 ----------
  function waitForOrt(tries) {
    if (window.ort) return Promise.resolve();
    if (tries <= 0) return Promise.reject(new Error('onnxruntime-web 加载超时'));
    return new Promise((r) => setTimeout(r, 300)).then(() => waitForOrt(tries - 1));
  }

  window.addEventListener('DOMContentLoaded', () => {
    waitForOrt(40).then(initModels).catch((e) => {
      modelStatus.textContent = '❌ 初始化失败';
      modelDetail.textContent = e.message;
    });
  });
})();
