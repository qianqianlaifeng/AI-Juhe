/**
 * 白日梦深度视频转换器 - 视频转黑白深度视频转换器
 *
 * 使用 Transformers.js + Depth Anything 模型在浏览器中
 * 逐帧进行深度估计，生成黑白深度视频。
 *
 * 兼容 file:// 协议：双击 index.html 即可直接使用，无需搭建服务器。
 */

// Transformers.js 模块引用（动态加载）
let _transformers = null;

// CDN 源（按优先顺序尝试）— 使用 dist/transformers.js（自包含 ESM，无外部 import）
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.js';
const TRANSFORMERS_BACKUPS = [
    'https://unpkg.com/@huggingface/transformers@3.7.5/dist/transformers.js',
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js',
];

// 模型源配置：国内优先，依次尝试；任一源失败自动回退下一个。
// 已在国内部署环境用真实浏览器实测：
//   - ModelScope：返回 CORS *，跨域直连可用（首选，国内最稳）
//   - HuggingFace：国内常被墙，仅作兜底（需可访问 HF 的网络/VPN）
// 注：hf-mirror.com 虽在 curl 下可见 CORS，但浏览器中其 307 相对路径跳转
//     + Range 请求会触发 CORS 预检失败（实测 config.json 直接 ERR_FAILED），故不采用。
const MODEL_SOURCES = [
    {
        key: 'modelscope',
        name: 'ModelScope 国内镜像',
        host: 'https://www.modelscope.cn/models/',
        pathTemplate: '{model}/resolve/master/',
        // 已实测：以下三个 V2 ONNX 模型在 ModelScope 均有完整镜像（含 fp16/q8/q4 量化文件）
        supports: [
            'onnx-community/depth-anything-v2-small-ONNX',
            'onnx-community/depth-anything-v2-base-ONNX',
            'onnx-community/depth-anything-v2-large-ONNX',
        ],
    },
    {
        key: 'huggingface',
        name: 'HuggingFace 官方',
        host: 'https://huggingface.co/',
        pathTemplate: '{model}/resolve/{revision}/',
        supports: '*', // 支持任意模型 ID
    },
];

// ============================================
// 处理质量预设（决定「用哪个模型」+「喂给模型的尺寸」）
// ============================================
// 实测依据（Chrome + Intel iGPU / WebGPU，1470×630 真实视频帧，361 帧素材）：
//   small 模型 ≈ 0.63 秒/帧（模型输入 115k 像素）
//   base  模型 ≈ 1.5  秒/帧（同尺寸，约 small 的 2.2 倍耗时）
//   large 模型 ≈ 3.0  秒/帧（同尺寸）
//   耗时随「模型输入像素数」近似 1.87 次方增长 → 输入尺寸是最大的速度杠杆。
//
// 关于尺寸：Depth Anything 用 DPT 图像处理器，它按「最短边」把画面缩放到
// 设定值（scale 取最接近 1 的那个方向，即等比铺满），并保证是 14 的整数倍。
// 所以这里 modelSize 控制的是「模型输入的最短边像素」。
// Depth Anything V2 原生训练尺寸是 518，输入越大细节越准、越慢。
const QUALITY_PRESETS = {
    fast: {
        key: 'fast',
        modelId: 'onnx-community/depth-anything-v2-small-ONNX',
        modelSize: 266,
        name: '快速',
        // 相对速度说明（用倍数表述，跨机器基本稳定；绝对秒数随显卡变化）
        speedNote: '速度最快（约「标准」的 4 倍）',
        icon: '⚡',
    },
    standard: {
        key: 'standard',
        modelId: 'onnx-community/depth-anything-v2-base-ONNX',
        modelSize: 322,
        name: '标准',
        speedNote: '清晰度与速度平衡（推荐）',
        icon: '⚖️',
    },
    high: {
        key: 'high',
        modelId: 'onnx-community/depth-anything-v2-base-ONNX',
        modelSize: 518,
        name: '高清',
        speedNote: '细节最准，约为「标准」的 1/3 速度',
        icon: '🔍',
    },
    ultra: {
        key: 'ultra',
        modelId: 'onnx-community/depth-anything-v2-large-ONNX',
        modelSize: 518,
        name: '极致',
        speedNote: '效果最好，但很慢（约「标准」的 1/10 速度）',
        icon: '💎',
    },
};

// ============================================
// State
// ============================================
const state = {
    videoFile: null,
    videoElement: null,
    depthEstimator: null,
    modelLoaded: false,
    loadedModelId: null,
    isProcessing: false,
    resultBlob: null,
    resultUrl: null,
    settings: {
        quality: 'standard', // fast | standard | high | ultra
        modelId: 'onnx-community/depth-anything-v2-base-ONNX',
        sourceMode: 'auto', // auto | modelscope | huggingface
        modelSize: 322, // 喂给模型的输入「最短边」像素（处理器会自动对齐到 14 的倍数）
        invert: false,
        contrast: 0,
        brightness: 0,
        fps: 24,
        resolution: 0.75,
        keepAudio: false,
    },
    processing: {
        startTime: 0,
        totalFrames: 0,
        processedFrames: 0,
        lastUpdate: 0,
    },
};

// ============================================
// DOM Helper
// ============================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================
// file:// Protocol Detection
// ============================================
const IS_FILE_PROTOCOL = window.location.protocol === 'file:';

/**
 * 从 CDN 加载 ES 模块，兼容 file:// 协议。
 *
 * 策略（按顺序尝试）：
 * 1. 直接 import(url) — 在 http:// 或部分 file:// 环境下可用
 * 2. fetch(url) → Blob URL → import(blobUrl) — file:// 下 import() 被阻止时的回退方案
 *    原理：fetch 对 https CDN 的跨域请求不受 file:// 同源限制影响（CDN 返回 CORS *），
 *    Blob URL 属于同源，import(blobUrl) 不受 file:// ES Module 限制。
 *
 * @param {string[]} urls — CDN URL 列表，按优先级排列
 * @returns {Promise<Object>} — 模块的命名空间对象
 */
async function loadESModule(urls) {
    let lastError = null;

    // 策略 1：直接 import()
    for (const url of urls) {
        try {
            const mod = await import(url);
            console.log(`[模块加载] import() 成功: ${url}`);
            return mod;
        } catch (err) {
            console.warn(`[模块加载] import() 失败: ${url}`, err.message);
            lastError = err;
        }
    }

    // 策略 2：fetch → Blob URL → import()
    for (const url of urls) {
        try {
            console.log(`[模块加载] 尝试 fetch+blob 回退: ${url}`);
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`[模块加载] fetch 返回 ${response.status}: ${url}`);
                continue;
            }
            const text = await response.text();
            const blob = new Blob([text], { type: 'text/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const mod = await import(blobUrl);
            // 注意：不立即 revoke，模块可能内部引用 blobUrl
            console.log(`[模块加载] fetch+blob 成功: ${url}`);
            return mod;
        } catch (err) {
            console.warn(`[模块加载] fetch+blob 失败: ${url}`, err.message);
            lastError = err;
        }
    }

    // 所有策略均失败
    const protocolHint = IS_FILE_PROTOCOL
        ? '\n\n当前正在使用 file:// 协议打开。如果浏览器阻止了模块加载，请尝试以下方案：\n'
          + '1. 使用最新版 Chrome 或 Edge 浏览器\n'
          + '2. 或运行 start-server.bat 启动本地静态服务器\n'
          + '3. 或通过命令行执行 python -m http.server 8000 后访问 http://localhost:8000'
        : '';
    throw new Error(`无法加载 ES 模块，所有 CDN 源和回退策略均失败。\n原始错误: ${lastError?.message || 'Unknown'}${protocolHint}`);
}

// ============================================
// UI State Management
// ============================================
function showSection(id) {
    $$('.section').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
}

function showToast(message, type = 'info', duration = 4000) {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function log(message, type = 'info') {
    const logEl = $('processing-log');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
}

function formatTime(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    // 超过 1 小时就用中文表述（「76:44」对普通用户不直观）
    if (h > 0) return `${h} 小时 ${m} 分`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ============================================
// 处理质量 / 设备 文案
// ============================================

// 各模型需要下载的体积（fp16 用于 WebGPU，q8 用于 CPU/WASM）
const MODEL_DOWNLOAD_MB = {
    'onnx-community/depth-anything-v2-small-ONNX': { fp16: 49, q8: 37 },
    'onnx-community/depth-anything-v2-base-ONNX': { fp16: 188, q8: 141 },
    'onnx-community/depth-anything-v2-large-ONNX': { fp16: 641, q8: 456 },
};

function estimateModelDownload() {
    const sizes = MODEL_DOWNLOAD_MB[state.settings.modelId];
    if (!sizes) return '约 240MB';
    const mb = state.device === 'webgpu' ? sizes.fp16 : sizes.q8;
    return `约 ${mb}MB`;
}

/**
 * 更新「处理质量」下方的说明文案。
 */
function updateQualityDesc() {
    const el = $('quality-desc');
    if (!el) return;
    const p = QUALITY_PRESETS[state.settings.quality] || QUALITY_PRESETS.standard;
    const id = p.modelId;
    const modelName = id.includes('-small') ? 'Depth Anything V2 Small'
        : id.includes('-large') ? 'Depth Anything V2 Large'
            : 'Depth Anything V2 Base';

    let text = `当前：${modelName} · 模型输入最短边 ${p.modelSize}px · 首次需下载 ${estimateModelDownload()} · ${p.speedNote}`;

    // 若已载入视频，给出「预计耗时」（按实测吞吐估算，仅当能拿到视频尺寸时显示）
    const eta = estimateProcessingSeconds(p);
    if (eta) {
        text += ` ｜ 你这段视频约 ${eta.frames} 帧，预计 ≈ ${eta.perFrame} 秒/帧，共 ${formatTime(eta.total)}`;
    }
    el.textContent = text;
}

// 实测吞吐：毫秒 / 每 1000 个「模型输入像素」（Intel Gen-12LP 核显 + WebGPU，样本 1470×630）
//   快速 small@266 → 741ms ÷ 165k px ≈ 4.5
//   标准 base@322  → 3237ms ÷ 242k px ≈ 13.4（高清同为 base 模型，沿用同一系数）
const PRESET_MS_PER_KPX = { fast: 4.5, standard: 13.4, high: 13.4 };

/**
 * 估算处理耗时（返回 { frames, perFrame, total } 或 null）。
 * 说明：绝对秒数依显卡而异，这里是「同款核显 + WebGPU」的实测值；换独显会更快。
 */
function estimateProcessingSeconds(preset) {
    const msPerKpx = PRESET_MS_PER_KPX[preset.key];
    if (!msPerKpx) return null;                       // 极致档太慢，不给具体秒数

    const video = $('preview-video');
    const w = video && video.videoWidth, h = video && video.videoHeight;
    if (!w || !h || !isFinite(video.duration) || video.duration <= 0) return null;

    // DPT 按「最短边」等比缩放，且尺寸对齐到 14 的倍数；不放大
    const srcShort = Math.min(w, h), srcLong = Math.max(w, h);
    const short = Math.min(Math.floor(Math.min(preset.modelSize, srcShort) / 14) * 14, srcShort);
    if (short < 28) return null;
    const long = Math.max(28, Math.round(short * srcLong / srcShort));
    const inputPx = short * long;

    const perFrameMs = msPerKpx * inputPx / 1000;
    const fps = state.settings.fps || 24;
    const frames = Math.min(Math.floor(video.duration * fps), 720);   // 与处理时的上限一致
    if (frames <= 0) return null;

    return {
        frames,
        perFrame: (perFrameMs / 1000).toFixed(1),
        total: (frames * perFrameMs) / 1000,          // 秒
    };
}

/**
 * 顶部「运行设备」提示条：让用户一眼看到有没有用上显卡。
 */
function updateDeviceBadge() {
    const el = $('device-badge');
    if (!el) return;
    const isGpu = state.device === 'webgpu';
    el.className = 'device-badge ' + (isGpu ? 'ok' : 'warn');
    if (isGpu) {
        el.innerHTML = `<span class="device-dot"></span><div><strong>GPU 加速已启用</strong>${state.gpuInfo ? ` · ${state.gpuInfo}` : ''} — 推理在你的显卡上运行，速度最快。</div>`;
    } else {
        el.innerHTML = `<span class="device-dot"></span><div>
            <strong>未启用 GPU 加速：正在用 CPU 计算，速度可能慢 10 倍以上</strong>
            <ul class="device-tips">
                <li>请用 <b>Chrome 113+</b> 或 <b>Edge 113+</b> 打开（微信 / QQ / 360 等内置浏览器不支持）</li>
                <li>地址栏输入 <code>chrome://settings/system</code>，打开「<b>使用图形加速功能（如果可用）</b>」后重启浏览器</li>
                <li>地址栏输入 <code>chrome://gpu</code>，确认 <b>WebGPU</b> 显示为 Enabled</li>
                <li>实在不行就把「处理质量」调到「快速」，或先把视频剪短一点</li>
            </ul>
        </div>`;
    }
}

// ============================================
// WebGPU Detection
// ============================================
async function checkWebGPU() {
    if (!navigator.gpu) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return !!adapter;
    } catch {
        return false;
    }
}

// Check WebCodecs support
function checkWebCodecs() {
    return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// ============================================
// Model Download UI
// ============================================

/** Show the model download panel and reset its state */
function showModelDownloadPanel(sourceName) {
    const panel = $('model-download-panel');
    const progressSection = $('progress-section');
    if (panel) {
        panel.style.display = 'block';
        // Reset to downloading state
        const icon = $('model-dl-icon');
        icon.classList.remove('done');
        $('model-dl-title').textContent = '正在下载 AI 深度模型';
        $('model-dl-subtitle').innerHTML = `首次使用需要从 <strong>${sourceName}</strong> 下载约 <strong>${estimateModelDownload()}</strong> 模型文件。下载完成后会<strong>自动永久缓存</strong>到浏览器，之后任何时候打开网页都无需重复下载`;
        $('model-dl-fill').classList.remove('done');
        $('model-dl-fill').style.width = '0%';
        $('model-dl-fill').style.background = '';
        $('model-dl-percent').classList.remove('done');
        $('model-dl-percent').textContent = '0%';
        $('model-dl-speed').textContent = '';
        $('model-dl-files').innerHTML = '';
    }
    // Hide frame processing progress during model download
    if (progressSection) {
        progressSection.style.display = 'none';
    }
    $('processing-status').textContent = '正在下载 AI 模型，请耐心等待...';
}

/** Update the model download panel with per-file progress */
function updateModelDownloadUI(fileProgress, startTime, sourceName) {
    const files = Object.entries(fileProgress);
    if (files.length === 0) return;

    // Calculate overall progress (weighted by file count)
    const totalProgress = files.reduce((sum, [_, f]) => sum + (f.progress || 0), 0);
    const overallPct = Math.round(totalProgress / files.length);

    // Update overall bar
    $('model-dl-fill').style.width = `${overallPct}%`;
    $('model-dl-percent').textContent = `${overallPct}%`;

    // Calculate download speed
    if (startTime) {
        const elapsed = (Date.now() - startTime) / 1000;
        const totalLoaded = files.reduce((sum, [_, f]) => sum + (f.loaded || 0), 0);
        if (elapsed > 0.5 && totalLoaded > 0) {
            const speed = totalLoaded / elapsed;
            $('model-dl-speed').textContent = `已下载 ${formatBytes(totalLoaded)} · 速度 ${formatBytes(speed)}/s`;
        }
    }

    // Update subtitle with live progress hint
    const allDone = files.every(([_, f]) => f.done);
    if (!allDone && overallPct > 0) {
        $('model-dl-title').textContent = `正在下载 AI 深度模型 · ${overallPct}%`;
    }

    // Render file list
    const filesContainer = $('model-dl-files');
    filesContainer.innerHTML = files.map(([name, f]) => {
        const shortName = name.split('/').pop();
        const pct = Math.round(f.progress || 0);
        const fileSize = f.total ? formatBytes(f.total) : '';
        return `
            <div class="model-dl-file">
                <div class="model-dl-file-name" title="${name}">${shortName}</div>
                <div class="model-dl-file-bar">
                    <div class="model-dl-file-fill ${f.done ? 'done' : ''}" style="width: ${pct}%"></div>
                </div>
                <span class="model-dl-file-status ${f.done ? 'done' : ''}">
                    ${f.done ? '✓ 完成' : (pct > 0 ? pct + '%' : '等待中')}
                </span>
            </div>
        `;
    }).join('');
}

/** Show completion state for model download */
function completeModelDownloadPanel() {
    const icon = $('model-dl-icon');
    icon.classList.add('done');
    // Change icon to checkmark
    icon.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    $('model-dl-title').textContent = 'AI 模型下载完成！';
    $('model-dl-subtitle').textContent = '模型已自动缓存到浏览器，下次打开网页无需重复下载，即将开始处理视频...';
    $('model-dl-fill').classList.add('done');
    $('model-dl-fill').style.width = '100%';
    $('model-dl-percent').classList.add('done');
    $('model-dl-percent').textContent = '100%';
    $('model-dl-speed').textContent = '下载完成，正在初始化模型...';

    // Mark all files as done
    const fileItems = $('model-dl-files').querySelectorAll('.model-dl-file');
    fileItems.forEach(item => {
        const fill = item.querySelector('.model-dl-file-fill');
        const status = item.querySelector('.model-dl-file-status');
        fill.classList.add('done');
        fill.style.width = '100%';
        status.classList.add('done');
        status.textContent = '✓ 完成';
    });

    // After a short delay, hide the panel and show frame processing progress
    setTimeout(() => {
        $('model-download-panel').style.display = 'none';
        $('progress-section').style.display = 'block';
        $('processing-status').textContent = '正在逐帧处理深度估计...';
    }, 1500);
}

/** Hide the model download panel (used on error) */
function hideModelDownloadPanel() {
    const panel = $('model-download-panel');
    if (panel) panel.style.display = 'none';
    const progressSection = $('progress-section');
    if (progressSection) progressSection.style.display = 'block';
}

// ============================================
// Persistent Model Cache
// ============================================
// 原实现依赖 Transformers.js 的 env.useBrowserCache（浏览器 Cache Storage API），
// 但该 API 在 file://（双击打开）等场景下不可用或不持久，导致每次打开都重新下载模型。
// 这里改为通过 Transformers.js 官方扩展点 env.customCache，
// 实现「IndexedDB 持久缓存 + 可选本地文件夹落盘」的双层缓存：
//   1. 本地文件夹（用户通过"选择模型保存文件夹"授权，模型文件直接保存到磁盘）
//   2. IndexedDB（file:// 协议下可持久化，关闭网页后仍然有效）
//   3. 网络下载（兜底，下载完成后自动写入以上两层）
// 一次下载，任何时间打开网页都直接使用，无需重复下载。

const IDB_CACHE_NAME = 'depth-video-converter-model-cache';
const IDB_CACHE_STORE = 'files';   // key: 完整模型文件 URL, value: { blob, savedAt }
const IDB_META_STORE = 'meta';     // key: 元数据 key, value: 任意值
const IDB_DIR_KEY = 'models-dir-handle'; // 保存 FileSystemDirectoryHandle

let _cacheDb = null;

function openCacheDb() {
    return new Promise((resolve, reject) => {
        if (_cacheDb) return resolve(_cacheDb);
        if (!window.indexedDB) return reject(new Error('IndexedDB 不可用'));
        const req = indexedDB.open(IDB_CACHE_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_CACHE_STORE)) {
                db.createObjectStore(IDB_CACHE_STORE);
            }
            if (!db.objectStoreNames.contains(IDB_META_STORE)) {
                db.createObjectStore(IDB_META_STORE);
            }
        };
        req.onsuccess = (e) => { _cacheDb = e.target.result; resolve(_cacheDb); };
        req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
    });
}

function idbOp(db, store, method, key, value) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(store, method === 'put' || method === 'delete' ? 'readwrite' : 'readonly');
            const os = tx.objectStore(store);
            let req;
            if (method === 'get') req = os.get(key);
            else if (method === 'put') req = os.put(value, key);
            else if (method === 'delete') req = os.delete(key);
            else if (method === 'getAll') req = os.getAll();
            else return reject(new Error('未知操作: ' + method));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (err) {
            reject(err);
        }
    });
}

/** 从 IndexedDB 读取缓存项 */
async function cacheGet(url) {
    try {
        const db = await openCacheDb();
        const item = await idbOp(db, IDB_CACHE_STORE, 'get', url);
        return (item && item.blob && item.blob.size > 0) ? item : null;
    } catch (err) {
        console.warn('[模型缓存] IndexedDB 读取失败:', err);
        return null;
    }
}

/** 写入 IndexedDB 缓存 */
async function cacheSet(url, blob) {
    try {
        const db = await openCacheDb();
        await idbOp(db, IDB_CACHE_STORE, 'put', url, { blob, savedAt: Date.now() });
        return true;
    } catch (err) {
        console.warn('[模型缓存] IndexedDB 写入失败:', err);
        return false;
    }
}

/** 读取全部缓存项（用于迁移到本地文件夹） */
async function cacheGetAll() {
    try {
        const db = await openCacheDb();
        const entries = await idbOp(db, IDB_CACHE_STORE, 'getAll');
        const keys = await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_CACHE_STORE, 'readonly');
            const req = tx.objectStore(IDB_CACHE_STORE).getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return entries.map((item, i) => ({ url: keys[i], blob: item.blob })).filter(x => x.url && x.blob && x.blob.size > 0);
    } catch (err) {
        console.warn('[模型缓存] 读取全部缓存失败:', err);
        return [];
    }
}

/** 清空 IndexedDB 中的全部模型缓存（用于修复「缓存损坏导致反复加载失败」） */
async function clearModelCache() {
    try {
        const db = await openCacheDb();
        await idbOp(db, IDB_CACHE_STORE, 'clear');
        log('模型缓存已清空（下次加载将重新下载）', 'success');
        return true;
    } catch (err) {
        console.warn('[模型缓存] 清空失败:', err);
        return false;
    }
}

async function metaGet(key) {
    try {
        const db = await openCacheDb();
        return await idbOp(db, IDB_META_STORE, 'get', key);
    } catch (err) {
        return undefined;
    }
}

async function metaSet(key, value) {
    try {
        const db = await openCacheDb();
        await idbOp(db, IDB_META_STORE, 'put', key, value);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * 从模型文件 URL 解析出「模型 ID + 文件相对路径」，
 * 用于在本地文件夹中以 {模型ID}/{文件路径} 的结构保存，多个模型互不冲突。
 */
function parseModelUrl(url) {
    try {
        // ModelScope: https://www.modelscope.cn/models/{modelId}/resolve/{revision}/{path}
        let m = url.match(/\/models\/(.+?)\/resolve\/(?:master|main|v?[\w.-]+)\/(.+)$/i);
        if (m) return { modelId: m[1].replace(/\/+$/, ''), relPath: m[2].split('?')[0] };
        // HuggingFace / hf-mirror: https://huggingface.co/{modelId}/resolve/{revision}/{path}
        m = url.match(/^https?:\/\/(?:huggingface\.co|hf-mirror\.com)\/(.+?)\/resolve\/(?:main|v?[\w.-]+)\/(.+)$/i);
        if (m) return { modelId: m[1].replace(/\/+$/, ''), relPath: m[2].split('?')[0] };
        // 其他（WASM 运行时等）：统一放入 _runtime 目录，按文件名区分
        const filename = decodeURIComponent(url.split('/').pop() || 'file.bin').split('?')[0];
        return { modelId: '_runtime', relPath: filename };
    } catch (err) {
        return { modelId: '_runtime', relPath: 'file.bin' };
    }
}

/** 读取本地文件夹中的模型文件（返回 Blob/File 或 null） */
async function readFileFromDir(url) {
    const dirHandle = await metaGet(IDB_DIR_KEY);
    if (!dirHandle) return null;
    try {
        const perm = await dirHandle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') return null;
        const { modelId, relPath } = parseModelUrl(url);
        let current = dirHandle;
        const segments = [...modelId.split('/').filter(Boolean), ...relPath.split('/').filter(Boolean)];
        for (let i = 0; i < segments.length - 1; i++) {
            current = await current.getDirectoryHandle(segments[i]);
        }
        const fileHandle = await current.getFileHandle(segments[segments.length - 1]);
        const file = await fileHandle.getFile();
        return (file && file.size > 0) ? file : null;
    } catch (err) {
        return null; // 文件不存在 / 权限不足 / 目录结构不符
    }
}

/** 将模型文件写入本地文件夹 */
async function writeFileToDir(url, blob) {
    const dirHandle = await metaGet(IDB_DIR_KEY);
    if (!dirHandle) return false;
    try {
        const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return false;
        const { modelId, relPath } = parseModelUrl(url);
        let current = dirHandle;
        const segments = [...modelId.split('/').filter(Boolean), ...relPath.split('/').filter(Boolean)];
        for (let i = 0; i < segments.length - 1; i++) {
            current = await current.getDirectoryHandle(segments[i], { create: true });
        }
        const fileHandle = await current.getFileHandle(segments[segments.length - 1], { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
    } catch (err) {
        console.warn('[模型缓存] 写入本地文件夹失败:', err);
        return false;
    }
}

/** 加载模型前确保本地文件夹的读取权限（用户未设置过文件夹则直接跳过，不打扰） */
let _dirPermissionChecked = false; // 同一会话只尝试授权一次，避免重复弹窗
async function ensureDirReadPermission() {
    if (_dirPermissionChecked) return false;
    _dirPermissionChecked = true;

    const dirHandle = await metaGet(IDB_DIR_KEY);
    if (!dirHandle) return false;
    try {
        let perm = await dirHandle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') {
            perm = await dirHandle.requestPermission({ mode: 'read' });
        }
        return perm === 'granted';
    } catch (err) {
        return false;
    }
}

/** 在加载模型前快速检测网络是否可达 */
async function checkNetworkConnection() {
    try {
        // 尝试 fetch CDN 上的一个小文件（package.json 只有几 KB）来检测网络是否可用
        await fetch(TRANSFORMERS_CDN.replace('/dist/transformers.js', '/package.json'), {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-store',
        });
        return true;
    } catch {
        return false;
    }
}

/** 将 Blob/File 构造成带 content-length 的 Response，供 Transformers.js 消费 */
function cachedResponse(blob) {
    return new Response(blob, {
        status: 200,
        headers: {
            'Content-Length': String(blob.size),
            'Content-Type': blob.type || 'application/octet-stream',
        },
    });
}

/** Transformers.js 官方扩展点：env.customCache 需要实现 match / put（Web Cache API 接口） */
const modelCache = {
    async match(request) {
        const url = typeof request === 'string' ? request : (request && request.url);
        if (!url) return undefined;

        // 1) 优先本地文件夹（真正保存到磁盘的模型）
        try {
            const localFile = await readFileFromDir(url);
            if (localFile) {
                console.log(`[模型缓存] 从本地文件夹命中: ${url.split('/').pop()}`);
                return cachedResponse(localFile);
            }
        } catch (e) { /* 忽略 */ }

        // 2) IndexedDB 持久缓存
        try {
            const item = await cacheGet(url);
            if (item) {
                console.log(`[模型缓存] 从 IndexedDB 命中: ${url.split('/').pop()}`);
                return cachedResponse(item.blob);
            }
        } catch (e) { /* 忽略 */ }

        return undefined; // 未命中，走网络下载
    },

    async put(request, response) {
        const url = typeof request === 'string' ? request : (request && request.url);
        if (!url || !response || !response.ok) return;

        try {
            const blob = await response.clone().blob();
            if (!blob || blob.size === 0) return;

            // 写入 IndexedDB（必须成功，这是核心持久层）
            await cacheSet(url, blob);

            // 若用户已授权本地文件夹，同时落盘到磁盘（不阻塞下载流程）
            writeFileToDir(url, blob).then((written) => {
                if (written) {
                    console.log(`[模型缓存] 已保存到本地文件夹: ${url.split('/').pop()}`);
                }
            }).catch(() => { /* 忽略 */ });
        } catch (err) {
            console.warn('[模型缓存] 缓存写入失败:', err);
        }
    },
};

/** 将 IndexedDB 中已有缓存迁移到本地文件夹 */
async function migrateCacheToDir() {
    const items = await cacheGetAll();
    if (items.length === 0) return;
    let ok = 0;
    for (const item of items) {
        if (await writeFileToDir(item.url, item.blob)) ok++;
    }
    showToast(
        ok === items.length
            ? `已将 ${ok} 个模型缓存文件保存到本地文件夹，之后可完全离线使用`
            : `已保存 ${ok}/${items.length} 个缓存文件到本地文件夹`,
        ok === items.length ? 'success' : 'warning',
        6000
    );
}

/** 刷新"选择模型保存文件夹"区域的 UI 状态 */
async function updateModelDirUI() {
    const btn = $('choose-model-dir-btn');
    const statusEl = $('model-dl-local-status');
    if (!btn || !statusEl) return;

    const dirHandle = await metaGet(IDB_DIR_KEY);
    if (dirHandle) {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 11v6"/><path d="M9 14l3 3 3-3"/></svg> 更改保存文件夹`;
        statusEl.textContent = `模型将保存到文件夹：「${dirHandle.name}」，以后打开网页将直接从磁盘加载，无需网络`;
        statusEl.className = 'model-dl-local-status ok';
    } else {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 11v6"/><path d="M9 14l3 3 3-3"/></svg> 选择模型保存文件夹（推荐）`;
        statusEl.textContent = '模型会自动缓存到浏览器（IndexedDB），下次打开无需重复下载；选择文件夹后模型文件将直接保存到磁盘，永久离线可用';
        statusEl.className = 'model-dl-local-status';
    }
}

/** 让用户选择一个本地文件夹用于保存模型文件（可选功能，不强制） */
async function chooseModelDir() {
    if (typeof window.showDirectoryPicker !== 'function') {
        showToast('当前浏览器不支持选择文件夹，模型已自动缓存到浏览器，无需操作', 'info', 4000);
        return;
    }
    try {
        const handle = await window.showDirectoryPicker({
            id: 'depth-video-converter-models',
            mode: 'readwrite',
        });
        await metaSet(IDB_DIR_KEY, handle);
        await updateModelDirUI();
        showToast(`模型保存文件夹已设置为：「${handle.name}」`, 'success', 4000);
        // 把已缓存好的模型文件同步到新文件夹（不阻塞后续流程）
        migrateCacheToDir().catch(() => { /* 忽略迁移错误，不影响主流程 */ });
    } catch (err) {
        if (err.name === 'AbortError') return; // 用户取消
        showToast(`设置保存文件夹失败: ${err.message}`, 'error', 5000);
    }
}


// ============================================
// Model Loading
// ============================================

/**
 * 把「处理质量」预设写入 settings（模型 ID + 模型输入尺寸）。
 */
function applyQualityPreset(key) {
    const preset = QUALITY_PRESETS[key] || QUALITY_PRESETS.standard;
    state.settings.quality = preset.key;
    state.settings.modelId = preset.modelId;
    state.settings.modelSize = preset.modelSize;
    return preset;
}

/**
 * 把「模型输入尺寸」写进 transformers.js 的图像处理器。
 *
 * Depth Anything 的 processor 会按最短边把画面缩放到 size，并且保证是 14 的倍数。
 * 这个尺寸直接决定推理耗时（近似 1.87 次方关系），是最大的速度杠杆。
 */
function applyModelInputSize(estimator, srcW, srcH) {
    // 允许传入包装过的 estimator：拿不到 processor 时回退到全局已加载的实例
    const est = (estimator && estimator.processor) ? estimator : state.depthEstimator;
    if (!est) return null;
    const proc = est.processor && (est.processor.image_processor || est.processor);
    if (!proc || !proc.size) return null;

    let size = state.settings.modelSize || 518;
    // 源视频本身就很小时不要放大（放大只是白算，画质也不会变好）
    if (srcW && srcH) {
        const shortSide = Math.min(srcW, srcH);
        if (size > shortSide) size = shortSide;
    }
    // 14 的倍数（patch size）
    size = Math.max(14, Math.round(size / 14) * 14);
    proc.size = { height: size, width: size };
    return size;
}

async function loadModel(requestedModelId) {
    // 根据模型 ID 与用户选择的「模型源」决定尝试顺序
    let candidateSources = MODEL_SOURCES.filter(s => s.supports === '*' || s.supports.includes(requestedModelId));
    const mode = state.settings.sourceMode || 'auto';
    if (mode !== 'auto') {
        const chosen = MODEL_SOURCES.find(s => s.key === mode);
        candidateSources = chosen ? [chosen] : candidateSources;
    }
    const sourcesToTry = candidateSources;
    if (sourcesToTry.length === 0) {
        throw new Error(`没有可用的模型源支持 ${requestedModelId}`);
    }
    log(`模型源模式: ${mode === 'auto' ? '自动（国内优先）' : sourcesToTry.map(s => s.name).join(' / ')}`, 'info');

    if (state.modelLoaded && state.loadedModelId === requestedModelId) {
        return state.depthEstimator;
    }

    log(`准备加载模型: ${requestedModelId}`, 'info');

    // 动态加载 Transformers.js，依次尝试多个 CDN 源
    if (!_transformers) {
        log('正在加载 Transformers.js 运行时...', 'info');
        const sources = [TRANSFORMERS_CDN, ...TRANSFORMERS_BACKUPS];

        try {
            _transformers = await loadESModule(sources);
            log('Transformers.js 运行时加载成功', 'success');
        } catch (err) {
            console.error('All Transformers.js CDN sources failed:', err);
            throw new Error(
                '无法加载 AI 运行时。可能原因：\n' +
                '1. 网络连接问题或 CDN 被拦截\n' +
                '2. 浏览器扩展（广告拦截、隐私保护）阻止了脚本加载\n' +
                '3. 公司网络/防火墙限制\n' +
                (IS_FILE_PROTOCOL ? '4. file:// 协议下浏览器阻止了模块加载，请尝试运行 start-server.bat\n' : '') +
                '\n建议：检查网络、关闭广告拦截扩展、或使用本地静态服务器。'
            );
        }
    }

    const { pipeline, env } = _transformers;
    env.allowLocalModels = false;

    // 持久化缓存：使用自定义缓存（IndexedDB + 可选本地文件夹），
    // 不再依赖在 file:// 下不可靠的浏览器 Cache Storage API（useBrowserCache）。
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = modelCache;

    // 若用户之前设置过本地模型文件夹，先请求读取权限（未设置过则直接跳过）
    await ensureDirReadPermission();

    const hasWebGPU = await checkWebGPU();
    const device = hasWebGPU ? 'webgpu' : 'wasm';
    state.device = device;
    log(`使用设备: ${device.toUpperCase()}`, 'info');

    if (hasWebGPU) {
        // 把显卡型号记下来：如果是集成显卡（Intel/AMD），Windows 图像设置里
        // 可以把 Chrome 指定为「高性能（独显）」，推理速度通常能翻好几倍。
        try {
            const adapter = await navigator.gpu.requestAdapter();
            const info = adapter && adapter.info;
            state.gpuInfo = info
                ? [info.vendor, info.architecture, info.description].filter(Boolean).join(' / ')
                : '';
            if (state.gpuInfo) log(`GPU 适配器: ${state.gpuInfo}`, 'info');
        } catch { /* 忽略 */ }
        showToast('检测到 WebGPU 支持，将使用 GPU 加速推理', 'success');
    } else {
        state.gpuInfo = '';
        log('未检测到 WebGPU：将使用 CPU（WASM）推理，速度可能慢 10 倍以上', 'warning');
        showToast('未启用 GPU 加速，正在用 CPU 计算，速度会慢很多（见下方提示）', 'warning', 8000);
    }
    updateDeviceBadge();

    // 提前检查网络连接，避免 Transformers.js 内部产生未捕获的 fetch 失败
    const networkOk = await checkNetworkConnection();
    if (!networkOk) {
        log('网络连接检测失败，CDN 可能不可访问', 'warning');
        showToast('网络连接不可用，模型下载可能失败。请检查网络或关闭广告拦截扩展', 'warning', 6000);
    } else {
        log('网络连接检测通过，CDN 可访问', 'success');
    }

    // 依次尝试各个模型源
    let lastError = null;
    for (const source of sourcesToTry) {
        try {
            log(`尝试从 ${source.name} 加载模型...`, 'info');

            // 设置模型下载源
            env.remoteHost = source.host;
            env.remotePathTemplate = source.pathTemplate;
            log(`模型基础 URL: ${source.host}${source.pathTemplate.replace('{model}', requestedModelId).replace('{revision}', 'main').slice(0, -1)}`, 'info');

            // 显示模型下载面板
            showModelDownloadPanel(source.name);

            // 用于追踪多文件下载进度
            const fileProgress = {}; // { filename: { progress, loaded, total, done } }
            let downloadStartTime = null;

            // dtype 选择：WebGPU 优先 fp16（比 fp32 快数倍、显存更省，画质几乎无差）；
            // 若 fp16 不可用则自动回退 fp32。WASM 仍用 q8。
            const dtypeCandidates = hasWebGPU ? ['fp16', 'fp32'] : ['q8'];
            let estimator = null;
            let lastDtypeErr = null;
            for (const tryDtype of dtypeCandidates) {
                try {
                    log(`加载模型（device=${device}, dtype=${tryDtype}）...`, 'info');
                    estimator = await pipeline('depth-estimation', requestedModelId, {
                        device: device,
                        dtype: tryDtype,
                        progress_callback: (progress) => {
                    try {
                        const file = progress.file || 'unknown';

                        if (progress.status === 'initiate') {
                            // 文件开始下载
                            if (!downloadStartTime) downloadStartTime = Date.now();
                            fileProgress[file] = { progress: 0, loaded: 0, total: 0, done: false };
                            updateModelDownloadUI(fileProgress, downloadStartTime, source.name);
                            log(`开始下载: ${file}`, 'info');

                        } else if (progress.status === 'progress') {
                            // 文件下载进度更新
                            if (!downloadStartTime) downloadStartTime = Date.now();
                            if (!fileProgress[file]) {
                                fileProgress[file] = { progress: 0, loaded: 0, total: 0, done: false };
                            }
                            fileProgress[file].progress = progress.progress || 0;
                            fileProgress[file].loaded = progress.loaded || 0;
                            fileProgress[file].total = progress.total || 0;
                            fileProgress[file].done = false;
                            updateModelDownloadUI(fileProgress, downloadStartTime, source.name);

                        } else if (progress.status === 'done') {
                            // 单个文件下载完成
                            if (fileProgress[file]) {
                                fileProgress[file].progress = 100;
                                fileProgress[file].done = true;
                            } else {
                                fileProgress[file] = { progress: 100, loaded: 0, total: 0, done: true };
                            }
                            updateModelDownloadUI(fileProgress, downloadStartTime, source.name);
                            log(`下载完成: ${file}`, 'info');
                        }
                    } catch (callbackErr) {
                        // 确保 progress_callback 不会抛出错误导致未捕获的 Promise rejection
                        console.warn('[模型下载进度回调] 错误:', callbackErr);
                    }
                },
                    });
                    break; // fp16/fp32 任一成功即跳出精度循环
                } catch (dtypeErr) {
                    lastDtypeErr = dtypeErr;
                    log(`dtype=${tryDtype} 加载失败: ${dtypeErr.message}，尝试下一个精度`, 'warning');
                }
            }
            if (!estimator) {
                throw lastDtypeErr || new Error('模型加载失败（所有精度均不可用）');
            }
            state.depthEstimator = estimator;

            // 应用「模型输入尺寸」并记录实际生效值（处理器会自己对齐到 14 的倍数）
            const effSize = applyModelInputSize(estimator);
            log(`模型输入尺寸: 最短边 ${effSize}px（可在「处理质量」里调整）`, 'info');

            // 模型下载完成
            state.modelLoaded = true;
            state.loadedModelId = requestedModelId;
            log(`模型加载完成（来自 ${source.name}）`, 'success');
            completeModelDownloadPanel();
            showToast('AI 模型下载完成，开始处理视频！', 'success', 4000);
            return state.depthEstimator;

        } catch (err) {
            lastError = err;
            console.warn(`Failed to load model from ${source.name}:`, err);
            log(`从 ${source.name} 加载失败: ${err.message}`, 'warning');
            hideModelDownloadPanel();
        }
    }

    // 所有源都失败
    console.error('All model sources failed:', lastError);
    const triedNames = sourcesToTry.map(s => s.name).join('、');
    throw new Error(
        '模型加载失败，以下模型源均无法下载：\n' +
        triedNames + '\n\n' +
        '常见原因与解决办法：\n' +
        '1. 浏览器本地模型缓存损坏（最常见）—— 请点击设置里的「清空模型缓存」按钮后重试\n' +
        '2. 当前网络无法访问所选模型源\n' +
        '3. 浏览器扩展（广告拦截/隐私保护）拦截了跨域请求\n' +
        '4. 模型文件较大（约 240MB），下载超时\n' +
        (IS_FILE_PROTOCOL ? '5. file:// 协议下部分浏览器会阻止跨域请求，请运行 start-server.bat 后用 http://localhost:8000 访问\n' : '') +
        '\n建议：\n' +
        '• 先点「清空模型缓存」再重试（可解决绝大多数失败）\n' +
        '• 在「模型源」里切换到「仅 ModelScope 国内镜像」（国内直连最稳）\n' +
        '• 关闭广告拦截/隐私保护扩展\n' +
        '• 切换网络（手机热点 / 公司网络）\n' +
        '• 若需使用 HuggingFace 官方源，请开启可访问 HF 的 VPN/代理\n' +
        (IS_FILE_PROTOCOL ? '• 或运行 start-server.bat 启动本地服务器后访问 http://localhost:8000\n' : '') +
        `\n原始错误: ${lastError?.message || 'Unknown error'}`
    );
}

// ============================================
// Video Loading
// ============================================
function loadVideoFile(file) {
    if (!file.type.startsWith('video/')) {
        showToast('请选择视频文件', 'error');
        return;
    }

    state.videoFile = file;

    const url = URL.createObjectURL(file);
    const video = $('preview-video');
    video.src = url;

    video.onloadedmetadata = () => {
        const info = $('video-info');
        const duration = video.duration;
        const width = video.videoWidth;
        const height = video.videoHeight;

        info.innerHTML = `
            <div class="video-info-item">
                <span class="label">分辨率</span>
                <span class="value">${width} × ${height}</span>
            </div>
            <div class="video-info-item">
                <span class="label">时长</span>
                <span class="value">${formatTime(duration)}</span>
            </div>
            <div class="video-info-item">
                <span class="label">大小</span>
                <span class="value">${formatBytes(file.size)}</span>
            </div>
            <div class="video-info-item">
                <span class="label">格式</span>
                <span class="value">${file.name.split('.').pop().toUpperCase()}</span>
            </div>
        `;

        // Warn for long videos
        if (duration > 60) {
            showToast('视频较长，处理可能需要较长时间，建议先裁剪到 1 分钟以内', 'warning', 6000);
        }

        // 视频已就绪 → 刷新「预计耗时」
        updateQualityDesc();
    };

    showSection('settings-section');
}

// ============================================
// Depth Frame Processing
// ============================================

// 深度归一化参数
//   Depth Anything 输出的是「相对逆深度」（数值越大＝越近），逐帧数值范围会随画面漂移。
//   transformers.js 的 pipeline 默认对「每一帧」做 min-max 拉满，问题在于：
//   极少数离群像素（灯、反光、极近物体边缘、噪点）会把 max/min 拉飞，
//   导致整幅画面被压扁到中间一小段灰阶 —— 看起来「发灰、没层次、深度不准」。
//
//   这里改成：用原始浮点深度（predicted_depth）+ 直方图分位裁剪，掐掉两端各 0.5% 的
//   离群值再拉满，既保住层次又不会因为个别噪点把画面压扁。
//
//   ⚠️ 不要加「跨帧平滑」：实测过（EMA α=0.25），一旦切镜头或景深范围突变，
//   平滑后的范围会滞后于当前帧，近处物体直接被裁成一片死白，比逐帧归一化更差。
const NORM_HIST_BINS = 512;
const NORM_P_LOW = 0.005;   // 掐掉最暗的 0.5%
const NORM_P_HIGH = 0.995;  // 掐掉最亮的 0.5%

// 复用的直方图缓冲，避免每帧分配
const normHist = new Float64Array(NORM_HIST_BINS);

/**
 * 挑一个用于出图的深度结果。
 *
 * 优先用 predicted_depth（Tensor，float32 原始相对深度）：
 *   - 没有被拍成 8bit，没有量化台阶；
 *   - 可以自己做分位裁剪，避免离群值把画面压扁。
 * 只有在拿不到浮点结果时，才退回 pipeline 已归一化的 8bit 深度图。
 */
function pickDepthResult(result) {
    const pd = result && result.predicted_depth;
    if (pd && pd.data && pd.dims && pd.dims.length >= 2) return pd;
    return (result && (result.depth || pd)) || null;
}

/**
 * 用直方图求分位值（避免对 15 万个浮点数做完整排序）。
 */
function percentileFromHist(hist, total, p, min, range) {
    const target = p * total;
    let acc = 0;
    for (let b = 0; b < NORM_HIST_BINS; b++) {
        acc += hist[b];
        if (acc >= target) return min + ((b + 1) / NORM_HIST_BINS) * range;
    }
    return min + range;
}

/**
 * 浮点深度 → 灰阶 RGBA（分位裁剪归一化，逐帧自适应）。
 */
function floatDepthToRGBA(values, width, height) {
    const n = width * height;
    if (values.length !== n) {
        throw new Error(`深度数据长度不匹配: 期望 ${n} (w=${width}, h=${height}), 实际 ${values.length}`);
    }

    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
    }
    const range = (mx - mn) || 1;

    // 直方图 → 稳健分位（掐掉两端离群值）
    normHist.fill(0);
    for (let i = 0; i < n; i++) {
        let b = ((values[i] - mn) / range) * NORM_HIST_BINS | 0;
        if (b < 0) b = 0;
        else if (b >= NORM_HIST_BINS) b = NORM_HIST_BINS - 1;
        normHist[b]++;
    }
    const lo = percentileFromHist(normHist, n, NORM_P_LOW, mn, range);
    const hi = percentileFromHist(normHist, n, NORM_P_HIGH, mn, range);

    const span = (hi - lo) || 1;
    const scale = 255 / span;

    const pixels = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
        // 数值越大＝越近 → 越亮（与「近亮远暗」一致）
        let g = (values[i] - lo) * scale;
        if (g < 0) g = 0;
        else if (g > 255) g = 255;
        const j = i * 4;
        pixels[j] = g;
        pixels[j + 1] = g;
        pixels[j + 2] = g;
        pixels[j + 3] = 255;
    }
    return new ImageData(pixels, width, height);
}

/**
 * Convert a depth estimation result to a grayscale ImageData.
 * Supports RawImage, Tensor, ImageData, HTMLCanvasElement, ImageBitmap.
 */
function depthResultToImageData(depthResult) {
    if (!depthResult) {
        throw new Error('深度估计结果为空');
    }

    // ImageData directly
    if (depthResult instanceof ImageData) {
        return depthResult;
    }

    // Helper: convert grayscale values to RGBA Uint8ClampedArray
    function grayToRGBA(values, width, height, isFloat = false) {
        const pixelCount = width * height;
        if (values.length !== pixelCount) {
            throw new Error(`深度数据长度不匹配: 期望 ${pixelCount} (w=${width}, h=${height}), 实际 ${values.length}`);
        }

        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < values.length; i++) {
            const v = isFloat ? values[i] : values[i] / 255;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        const range = max - min || 1;

        const pixels = new Uint8ClampedArray(pixelCount * 4);
        for (let i = 0; i < values.length; i++) {
            const v = isFloat ? values[i] : values[i] / 255;
            const normalized = (v - min) / range;
            const gray = Math.max(0, Math.min(255, Math.round(normalized * 255)));
            pixels[i * 4] = gray;
            pixels[i * 4 + 1] = gray;
            pixels[i * 4 + 2] = gray;
            pixels[i * 4 + 3] = 255;
        }
        return new ImageData(pixels, width, height);
    }

    // RawImage from Transformers.js { data, width, height, channels }
    if (depthResult.width && depthResult.height && depthResult.data) {
        const width = depthResult.width;
        const height = depthResult.height;
        const data = depthResult.data;
        const channels = depthResult.channels || (depthResult.data.length / (width * height));
        const expectedRGBA = width * height * 4;

        if (data.length === expectedRGBA) {
            // Already RGBA bytes
            const rgba = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
            return new ImageData(rgba, width, height);
        }

        if (channels === 1 || data.length === width * height) {
            // Single-channel grayscale (could be uint8 or float32)
            const isFloat = data instanceof Float32Array || depthResult.format?.includes('float');
            return grayToRGBA(data, width, height, isFloat);
        }

        // Unknown channels: try to interpret as single-channel if divisible
        if (data.length % (width * height) === 0) {
            const perPixel = data.length / (width * height);
            console.warn(`RawImage has unexpected channels=${perPixel}, interpreting first channel as grayscale`);
            const pixelCount = width * height;
            const firstChannel = new Array(pixelCount);
            for (let i = 0; i < pixelCount; i++) {
                firstChannel[i] = data[i * perPixel];
            }
            const isFloat = data instanceof Float32Array || depthResult.format?.includes('float');
            return grayToRGBA(firstChannel, width, height, isFloat);
        }

        throw new Error(`RawImage 数据长度不匹配: w=${width}, h=${height}, data.length=${data.length}`);
    }

    // Tensor { data: Float32Array/Uint8Array, dims: [...], type: 'float32' }
    if (depthResult.data && depthResult.dims) {
        const values = depthResult.data;
        const dims = depthResult.dims;

        // Find H and W from dims. Common shapes: [H,W], [1,H,W], [1,1,H,W], [B,C,H,W]
        let width, height;
        if (dims.length >= 2) {
            width = dims[dims.length - 1];
            height = dims[dims.length - 2];
        } else {
            throw new Error(`无法从 dims 解析尺寸: [${dims.join(', ')}]`);
        }

        const isFloat = depthResult.type?.startsWith('float') || values instanceof Float32Array || values instanceof Float64Array;

        // 单通道浮点原始深度 → 稳健归一化（主力路径）
        if (isFloat && values.length === width * height) {
            return floatDepthToRGBA(values, width, height);
        }

        return grayToRGBA(values, width, height, isFloat);
    }

    throw new Error('Unsupported depth result type: ' + Object.prototype.toString.call(depthResult));
}

/**
 * Draw depth result to canvas with effects
 */
// 复用一张临时画布：每帧新建 canvas 会反复分配显存/内存，帧数一多很浪费
let _depthTempCanvas = null;
let _depthTempCtx = null;

function drawDepthToCanvas(ctx, depthResult, targetWidth, targetHeight, settings) {
    const imageData = depthResultToImageData(depthResult);

    if (!_depthTempCanvas) {
        _depthTempCanvas = document.createElement('canvas');
        _depthTempCtx = _depthTempCanvas.getContext('2d');
    }
    const tempCanvas = _depthTempCanvas;
    const tempCtx = _depthTempCtx;
    if (tempCanvas.width !== imageData.width || tempCanvas.height !== imageData.height) {
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
    }
    tempCtx.putImageData(imageData, 0, 0);

    // Draw scaled to target canvas（高质量插值，放大后边缘更干净）
    const prevSmoothing = ctx.imageSmoothingEnabled;
    const prevQuality = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.imageSmoothingQuality = prevQuality;

    // Apply post-processing effects
    if (settings.invert || settings.contrast !== 0 || settings.brightness !== 0) {
        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imageData.data;

        const contrastFactor = (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast));
        const brightness = settings.brightness;

        for (let i = 0; i < data.length; i += 4) {
            let gray = data[i]; // Depth image is grayscale, R=G=B

            if (settings.invert) {
                gray = 255 - gray;
            }

            // Apply contrast
            gray = contrastFactor * (gray - 128) + 128;

            // Apply brightness
            gray += brightness;

            // Clamp
            gray = Math.max(0, Math.min(255, gray));

            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
        }

        ctx.putImageData(imageData, 0, 0);
    }
}

/**
 * Extract a single frame from a video element into a canvas.
 * Transformers.js pipeline does not always accept HTMLVideoElement directly.
 */
function videoFrameToCanvas(video, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);
    return canvas;
}

/**
 * Seek video to specific time
 */
function seekTo(video, time) {
    return new Promise((resolve) => {
        const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = Math.min(time, video.duration);
    });
}

/**
 * Get supported MIME type for MediaRecorder
 */
function getSupportedMimeType() {
    // Prefer MP4 (H.264) to match the WebCodecs path output format
    const types = [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4;codecs=avc1.4D401F',
        'video/mp4;codecs=avc1.640028',
        'video/mp4;codecs=avc1',
        'video/mp4',
    ];
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    // Last resort: WebM (only if no MP4 support at all)
    const fallback = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
    ];
    for (const type of fallback) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    return 'video/mp4';
}

// ============================================
// Audio Extraction & Encoding
// ============================================

/**
 * Extract audio from a video file using AudioContext.decodeAudioData.
 * Returns an AudioBuffer or null if the video has no audio track.
 */
async function extractAudioBuffer(videoFile) {
    try {
        const arrayBuffer = await videoFile.arrayBuffer();
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        audioCtx.close();
        return audioBuffer;
    } catch (err) {
        console.warn('Failed to extract audio from video:', err);
        return null;
    }
}

/**
 * Encode an AudioBuffer into AAC chunks and add them to the muxer.
 * Returns a promise that resolves when all audio has been encoded.
 */
async function encodeAudioToMuxer(muxer, audioBuffer, durationSec) {
    if (typeof AudioEncoder === 'undefined') {
        console.warn('AudioEncoder not supported, skipping audio');
        return false;
    }

    const sampleRate = audioBuffer.sampleRate;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const totalSamples = audioBuffer.length;

    // Find supported AAC codec (mp4a.40.2 = AAC-LC)
    let codec = 'mp4a.40.2';
    const codecCandidates = ['mp4a.40.2', 'mp4a.40.5'];
    for (const c of codecCandidates) {
        try {
            const support = await AudioEncoder.isConfigSupported({
                codec: c,
                sampleRate,
                numberOfChannels,
                bitrate: 128_000,
            });
            if (support.supported) {
                codec = c;
                break;
            }
        } catch (e) { /* try next */ }
    }

    let audioEncoderError = null;
    let lastAudioTs = -1;
    const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
            // 保底单调：极少数编码器可能输出重复/回退的时间戳，会让 mp4-muxer 抛
            // "Timestamps must be monotonically increasing"。仅在必要时 +1µs 兜底。
            let ts = chunk.timestamp;
            if (ts <= lastAudioTs) ts = lastAudioTs + 1;
            lastAudioTs = ts;
            muxer.addAudioChunk(chunk, meta, ts);
        },
        error: (e) => {
            audioEncoderError = e;
            console.error('Audio encoder error:', e);
        },
    });

    try {
        audioEncoder.configure({
            codec,
            sampleRate,
            numberOfChannels,
            bitrate: 128_000,
        });
    } catch (err) {
        console.error('Failed to configure audio encoder:', err);
        return false;
    }

    // Feed audio data in chunks of ~20ms
    const chunkSize = Math.floor(sampleRate * 0.02); // 20ms frames
    const channelData = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
        channelData.push(audioBuffer.getChannelData(ch));
    }

    for (let offset = 0; offset < totalSamples; offset += chunkSize) {
        if (audioEncoderError) {
            console.error('Aborting audio encoding due to error');
            return false;
        }

        const frames = Math.min(chunkSize, totalSamples - offset);
        const timestamp = Math.round((offset / sampleRate) * 1_000_000); // microseconds

        // Build interleaved or planar data for AudioData
        // AudioData supports 'f32-planar' format
        const planarData = new Float32Array(frames * numberOfChannels);
        for (let ch = 0; ch < numberOfChannels; ch++) {
            const src = channelData[ch];
            for (let i = 0; i < frames; i++) {
                planarData[ch * frames + i] = src[offset + i];
            }
        }

        const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate,
            numberOfFrames: frames,
            numberOfChannels,
            timestamp,
            data: planarData,
        });

        audioEncoder.encode(audioData);
        audioData.close();

        // Control encode queue depth
        if (audioEncoder.encodeQueueSize > 10) {
            await new Promise(r => setTimeout(r, 1));
        }
    }

    await audioEncoder.flush();
    audioEncoder.close();

    if (audioEncoderError) {
        console.error('Audio encoding completed with errors');
        return false;
    }

    console.log('Audio encoding complete');
    return true;
}

// ============================================
// Video Processing - WebCodecs Path (preferred)
// ============================================
async function processWithWebCodecs(video, estimator, settings, callbacks) {
    // 加载 mp4-muxer（输出 MP4 容器，含 H.264 + AAC）
    // 优先使用全局变量（已通过 <script> 标签预加载的 IIFE 版本，兼容 file://）
    // 回退到 loadESModule（import() 或 fetch+blob）
    let Muxer, ArrayBufferTarget;
    if (window.Mp4Muxer && window.Mp4Muxer.Muxer) {
        Muxer = window.Mp4Muxer.Muxer;
        ArrayBufferTarget = window.Mp4Muxer.ArrayBufferTarget;
        log('mp4-muxer 已通过预加载就绪', 'info');
    } else {
        log('mp4-muxer 预加载未就绪，尝试动态加载...', 'info');
        const mod = await loadESModule([
            'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm',
            'https://unpkg.com/mp4-muxer@5.1.3/build/mp4-muxer.mjs',
        ]);
        Muxer = mod.Muxer;
        ArrayBufferTarget = mod.ArrayBufferTarget;
    }

    const srcWidth = video.videoWidth;
    const srcHeight = video.videoHeight;
    // H.264 要求宽高为偶数：1470×630 在 75% 下会得到 1103×473（奇数），
    // 部分机器上编码器会直接卡死。这里统一向下取偶数并保证 ≥2。
    const outWidth = Math.max(2, Math.round(srcWidth * settings.resolution / 2) * 2);
    const outHeight = Math.max(2, Math.round(srcHeight * settings.resolution / 2) * 2);
    const fps = settings.fps;
    const frameDurationUs = Math.round(1_000_000 / fps);
    const duration = video.duration;
    const totalFrames = Math.min(Math.floor(duration * fps), 720); // Cap at 720 frames

    callbacks.onStart(totalFrames);

    // Extract audio if requested
    let audioBuffer = null;
    if (settings.keepAudio) {
        log('正在提取原始音频...', 'info');
        audioBuffer = await extractAudioBuffer(state.videoFile);
        if (audioBuffer) {
            log(`音频提取成功: ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}声道, ${audioBuffer.duration.toFixed(1)}秒`, 'success');
        } else {
            log('该视频没有音轨或音频提取失败，将输出无声视频', 'warning');
        }
    }

    // Setup canvases
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outWidth;
    outputCanvas.height = outHeight;
    const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });

    const originalCanvas = $('original-canvas');
    const depthCanvas = $('depth-canvas');
    // 预览画布尺寸只需设置一次（每帧改 width/height 会清空并重分配显存，极浪费）
    const originalCtx = originalCanvas.getContext('2d');
    const depthCtx = depthCanvas.getContext('2d');
    originalCanvas.width = srcWidth;
    originalCanvas.height = srcHeight;
    depthCanvas.width = outWidth;
    depthCanvas.height = outHeight;

    // 确定「模型输入尺寸」：直接喂全分辨率整帧，由模型内部的图像处理器
    // 做一次双三次缩放（比先缩再喂少一次重采样，边缘更干净）。
    // 尺寸按视频短边取，且不超过源视频短边（不放大）。
    const effectiveModelSize = applyModelInputSize(estimator, srcWidth, srcHeight);
    log(`模型输入: 最短边 ${effectiveModelSize}px（源 ${srcWidth}×${srcHeight}）`, 'info');

    // Setup muxer (with optional audio track) — MP4 container
    const muxerConfig = {
        target: new ArrayBufferTarget(),
        video: {
            codec: 'avc',
            width: outWidth,
            height: outHeight,
            frameRate: fps,
        },
        fastStart: 'in-memory',
        // 关键：mp4-muxer 默认 'strict'，要求每条轨首帧时间戳必须为 0；
        // 实际编码器（尤其音频轨/AAC priming）首块时间戳常非 0，会直接抛
        // "The first chunk for your media track must have a timestamp of 0"。
        // 用 'offset' 让每条轨按各自首时间戳归零（首个已是 0 时无影响）。
        firstTimestampBehavior: 'offset',
    };
    if (audioBuffer) {
        muxerConfig.audio = {
            // 注意：mp4-muxer 的 audio.codec 只认 'aac' / 'opus'，
            // 不是 WebCodecs 的 'mp4a.40.2'（后者是 AudioEncoder.configure 用的）。
            codec: 'aac',
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels,
        };
    }
    const muxer = new Muxer(muxerConfig);

    // Setup encoder
    let encoderError = null;
    // 显式维护「单调递增」的时间戳：mp4-muxer 要求每轨 DTS 严格递增、首块为 0，
    // 但部分浏览器/编码器会输出乱序或非 0 起点的 chunk，导致
    //   "Timestamps must be monotonically increasing (DTS went from A to B)"
    //   "The first chunk for your media track must have a timestamp of 0"
    // 用「自增序号 × 帧时长」覆盖时间戳，保证从 0 开始且严格递增。
    // （正常不乱序时，该值与原 chunk 时间戳完全等价，输出无变化。）
    let videoChunkCount = 0;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => {
            muxer.addVideoChunk(chunk, meta, videoChunkCount * frameDurationUs);
            videoChunkCount++;
        },
        error: (e) => {
            encoderError = e;
            console.error('Encoder error:', e);
        },
    });

    // Determine codec string — H.264 (AVC) for MP4 output
    let codecString = 'avc1.4D401F';
    let codecConfigured = false;
    // Try to find a supported H.264 codec (Main → High → Baseline profiles)
    const codecs = [
        'avc1.4D401F', // Main profile, level 3.1
        'avc1.4D0028', // Main profile, level 4.0
        'avc1.640028', // High profile, level 4.0
        'avc1.640033', // High profile, level 5.1
        'avc1.42E01F', // Baseline profile, level 3.1
    ];
    for (const cs of codecs) {
        try {
            const config = {
                codec: cs,
                width: outWidth,
                height: outHeight,
                bitrate: 8_000_000,
                framerate: fps,
            };
            const support = await VideoEncoder.isConfigSupported(config);
            if (support.supported) {
                codecString = cs;
                encoder.configure(config);
                codecConfigured = true;
                break;
            }
        } catch (e) {
            // continue
        }
    }
    if (!codecConfigured) {
        throw new Error(`浏览器不支持 ${outWidth}×${outHeight} 的 H.264 编码。请把「输出尺寸」调小（例如 50%）后重试。`);
    }

    log(`编码器: WebCodecs (${codecString})`, 'info');
    log(`输出尺寸: ${outWidth}×${outHeight} @ ${fps}fps`, 'info');

    for (let i = 0; i < totalFrames; i++) {
        if (encoderError) throw encoderError;

        const time = (i / fps);
        await seekTo(video, time);

        // 整帧画到全分辨率画布：既用于原始帧预览，也直接作为模型输入
        originalCtx.drawImage(video, 0, 0, srcWidth, srcHeight);

        // Run depth estimation
        let result;
        try {
            result = await estimator(originalCanvas);
        } catch (err) {
            console.warn('Estimator failed on canvas input:', err);
            throw new Error(`深度估计失败: ${err.message}`);
        }

        if (!result) {
            throw new Error('深度估计返回空结果');
        }

        // 优先用原始浮点深度（predicted_depth）做稳健归一化；退回 8bit depth
        const depthData = pickDepthResult(result);
        if (!depthData) {
            console.error('Unexpected estimator result:', result);
            throw new Error('深度估计结果缺少 predicted_depth / depth 字段');
        }

        // Draw depth to output canvas（内部会按 outWidth×outHeight 上采样）
        drawDepthToCanvas(outputCtx, depthData, outWidth, outHeight, settings);

        // Update preview canvas（尺寸已在循环外设置，这里只重绘深度预览）
        depthCtx.drawImage(outputCanvas, 0, 0);

        // Create VideoFrame and encode
        const frame = new VideoFrame(outputCanvas, {
            timestamp: i * frameDurationUs,
            duration: frameDurationUs,
        });

        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();

        // Control encode queue（带看门狗：编码器出错时 encodeQueueSize 可能永远不下降，
        // 原来的 while 循环会死等，表现为「界面卡住、进度不动」）
        if (encoder.encodeQueueSize > 8) {
            const drainStart = Date.now();
            while (encoder.encodeQueueSize > 4) {
                if (encoderError) throw encoderError;
                if (Date.now() - drainStart > 30000) {
                    throw new Error('视频编码器无响应（可能是分辨率/编码格式不被支持）。请把「输出尺寸」改成 50% 或换个视频再试。');
                }
                await new Promise(r => setTimeout(r, 10));
            }
        }

        callbacks.onProgress(i + 1, totalFrames);
    }

    log('正在编码视频...', 'info');
    await encoder.flush();

    // Encode audio if available
    if (audioBuffer) {
        log('正在编码音频...', 'info');
        const audioOk = await encodeAudioToMuxer(muxer, audioBuffer, duration);
        if (audioOk) {
            log('音频编码完成', 'success');
        } else {
            log('音频编码失败，将输出无声视频', 'warning');
        }
    }

    muxer.finalize();

    const { buffer } = muxer.target;
    const blob = new Blob([buffer], { type: 'video/mp4' });

    log(`编码完成，文件大小: ${formatBytes(blob.size)}`, 'success');

    return blob;
}

// ============================================
// Video Processing - MediaRecorder Path (fallback)
// ============================================
async function processWithMediaRecorder(video, estimator, settings, callbacks) {
    const srcWidth = video.videoWidth;
    const srcHeight = video.videoHeight;
    // H.264 要求宽高为偶数：1470×630 在 75% 下会得到 1103×473（奇数），
    // 部分机器上编码器会直接卡死。这里统一向下取偶数并保证 ≥2。
    const outWidth = Math.max(2, Math.round(srcWidth * settings.resolution / 2) * 2);
    const outHeight = Math.max(2, Math.round(srcHeight * settings.resolution / 2) * 2);
    const fps = settings.fps;
    const duration = video.duration;
    const totalFrames = Math.min(Math.floor(duration * fps), 720);

    callbacks.onStart(totalFrames);

    log('使用 MediaRecorder 编码（兼容模式）', 'info');
    log(`输出尺寸: ${outWidth}×${outHeight} @ ${fps}fps`, 'info');

    // Setup canvases
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outWidth;
    outputCanvas.height = outHeight;
    const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });

    // Setup preview canvases
    const originalCanvas = $('original-canvas');
    const depthCanvas = $('depth-canvas');
    // 预览画布尺寸只需设置一次
    const originalCtx = originalCanvas.getContext('2d');
    const depthCtx = depthCanvas.getContext('2d');
    originalCanvas.width = srcWidth;
    originalCanvas.height = srcHeight;
    depthCanvas.width = outWidth;
    depthCanvas.height = outHeight;

    const effectiveModelSize = applyModelInputSize(estimator, srcWidth, srcHeight);
    log(`模型输入: 最短边 ${effectiveModelSize}px（源 ${srcWidth}×${srcHeight}）`, 'info');

    // Setup MediaRecorder
    const stream = outputCanvas.captureStream(0);
    const track = stream.getVideoTracks()[0];

    // If keeping audio, extract audio from video file and add to stream
    let audioContext = null;
    let audioSourceNode = null;
    let mediaStreamDest = null;
    if (settings.keepAudio) {
        try {
            log('正在提取原始音频（兼容模式）...', 'info');
            const audioBuffer = await extractAudioBuffer(state.videoFile);
            if (audioBuffer) {
                log(`音频提取成功: ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}声道`, 'success');
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                audioContext = new AudioContextClass();
                mediaStreamDest = audioContext.createMediaStreamDestination();
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(mediaStreamDest);
                source.start();
                // Add audio track to the output stream
                const audioTrack = mediaStreamDest.stream.getAudioTracks()[0];
                if (audioTrack) {
                    stream.addTrack(audioTrack);
                    log('已添加音频轨道到输出流', 'info');
                }
            } else {
                log('该视频没有音轨，将输出无声视频', 'warning');
            }
        } catch (err) {
            log(`音频提取失败: ${err.message}`, 'warning');
        }
    }

    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 8_000_000,
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.start(2000);
    // Wait a bit for recorder to initialize
    await new Promise(r => setTimeout(r, 100));

    for (let i = 0; i < totalFrames; i++) {
        const time = (i / fps);
        await seekTo(video, time);

        // 整帧画到全分辨率画布：既用于预览，也直接作为模型输入
        originalCtx.drawImage(video, 0, 0, srcWidth, srcHeight);

        // Run depth estimation
        let result;
        try {
            result = await estimator(originalCanvas);
        } catch (err) {
            console.warn('Estimator failed on canvas input:', err);
            throw new Error(`深度估计失败: ${err.message}`);
        }

        if (!result) {
            throw new Error('深度估计返回空结果');
        }

        const depthData = pickDepthResult(result);
        if (!depthData) {
            console.error('Unexpected estimator result:', result);
            throw new Error('深度估计结果缺少 predicted_depth / depth 字段');
        }

        // Draw depth to output canvas
        drawDepthToCanvas(outputCtx, depthData, outWidth, outHeight, settings);

        // Update preview（尺寸已在循环外设置，这里只重绘深度预览）
        depthCtx.drawImage(outputCanvas, 0, 0);

        // Capture frame
        if (track.requestFrame) {
            track.requestFrame();
        }

        // Small delay to ensure frame capture
        await new Promise(r => setTimeout(r, 5));

        callbacks.onProgress(i + 1, totalFrames);
    }

    log('正在编码视频...', 'info');

    // Stop recording
    await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
    });

    // Cleanup audio context
    if (audioContext) {
        try { audioContext.close(); } catch (e) { /* ignore */ }
    }

    const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
    log(`编码完成，文件大小: ${formatBytes(blob.size)}`, 'success');

    return blob;
}

// ============================================
// Main Processing Flow
// ============================================
async function startProcessing() {
    if (state.isProcessing) return;
    state.isProcessing = true;

    const startBtn = $('start-btn');
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="spinner"></span> 正在准备...';

    showSection('processing-section');
    $('processing-log').innerHTML = '';

    const video = $('preview-video');
    video.pause();

    // 重置错误显示区域
    $('error-detail').style.display = 'none';

    // 如果模型已加载，直接显示帧处理进度；否则显示模型下载面板
    if (state.modelLoaded && state.loadedModelId === state.settings.modelId) {
        $('model-download-panel').style.display = 'none';
        $('progress-section').style.display = 'block';
    } else {
        $('model-download-panel').style.display = 'none';
        $('progress-section').style.display = 'none';
    }

    try {
        // Load model
        $('processing-status').textContent = '正在加载 AI 模型...';
        $('progress-fill').style.width = '0%';
        $('progress-percent').textContent = '0%';

        const estimator = await loadModel(state.settings.modelId);

        // Start processing
        $('processing-status').textContent = '正在逐帧处理深度估计...';

        const useWebCodecs = checkWebCodecs();
        log(`浏览器支持 WebCodecs: ${useWebCodecs ? '是' : '否'}`, 'info');

        const callbacks = {
            onStart: (totalFrames) => {
                state.processing.startTime = Date.now();
                state.processing.totalFrames = totalFrames;
                state.processing.processedFrames = 0;
                state.processing.lastUpdate = Date.now();
                log(`开始处理 ${totalFrames} 帧`, 'info');
            },
            onProgress: (current, total) => {
                state.processing.processedFrames = current;

                const pct = Math.round((current / total) * 100);
                $('progress-fill').style.width = `${pct}%`;
                $('progress-percent').textContent = `${pct}%`;
                $('stat-frames').textContent = `${current} / ${total}`;

                const elapsed = (Date.now() - state.processing.startTime) / 1000;
                const speed = current / elapsed;
                $('stat-speed').textContent = `${speed.toFixed(1)} fps`;
                $('stat-elapsed').textContent = formatTime(elapsed);

                const remaining = (total - current) / speed;
                if (isFinite(remaining) && remaining > 0) {
                    $('stat-eta').textContent = formatTime(remaining);
                }

                if (current % 10 === 0 || current === total) {
                    log(`已处理 ${current}/${total} 帧 (${pct}%)`, 'info');
                }
            },
        };

        let blob;
        if (useWebCodecs) {
            try {
                blob = await processWithWebCodecs(video, estimator, state.settings, callbacks);
            } catch (e) {
                log(`WebCodecs 处理失败: ${e.message}，切换到兼容模式`, 'error');
                console.error(e);
                // Reset progress
                state.processing.startTime = Date.now();
                blob = await processWithMediaRecorder(video, estimator, state.settings, callbacks);
            }
        } else {
            blob = await processWithMediaRecorder(video, estimator, state.settings, callbacks);
        }

        state.resultBlob = blob;
        if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
        state.resultUrl = URL.createObjectURL(blob);

        // Show result
        showResult();

    } catch (err) {
        console.error('Processing error:', err);
        log(`处理出错: ${err.message}`, 'error');
        showToast(`处理失败: ${err.message}`, 'error', 6000);

        // 隐藏模型下载面板和进度条，显示错误面板
        $('model-download-panel').style.display = 'none';
        $('processing-status').textContent = '处理失败';
        $('progress-section').style.display = 'none';
        $('error-message').textContent = err.message || '未知错误';
        $('error-detail').style.display = 'block';
    } finally {
        state.isProcessing = false;
        startBtn.disabled = false;
        startBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg> 开始转换`;
    }
}

// ============================================
// Result Display
// ============================================
function showResult() {
    const video = $('result-video');
    video.src = state.resultUrl;

    const elapsed = (Date.now() - state.processing.startTime) / 1000;
    const stats = $('result-stats');
    stats.innerHTML = `
        <div class="result-stat">
            <span class="label">总帧数</span>
            <span class="value">${state.processing.processedFrames}</span>
        </div>
        <div class="result-stat">
            <span class="label">处理耗时</span>
            <span class="value">${formatTime(elapsed)}</span>
        </div>
        <div class="result-stat">
            <span class="label">输出大小</span>
            <span class="value">${formatBytes(state.resultBlob.size)}</span>
        </div>
        <div class="result-stat">
            <span class="label">输出格式</span>
            <span class="value">${state.resultBlob.type.includes('mp4') ? 'MP4' : 'WebM'}</span>
        </div>
    `;

    showSection('result-section');
    showToast('深度视频转换完成！', 'success');
}

// ============================================
// Download
// ============================================
async function downloadResult() {
    if (!state.resultBlob) return;

    const originalName = state.videoFile?.name || 'video';
    const baseName = originalName.replace(/\.[^.]+$/, '');
    // Determine extension from actual blob type (MP4 primary, WebM last-resort fallback)
    const isMp4 = state.resultBlob.type.includes('mp4');
    const ext = isMp4 ? 'mp4' : 'webm';
    const mimeMain = isMp4 ? 'video/mp4' : 'video/webm';
    const typeLabel = isMp4 ? 'MP4 视频' : 'WebM 视频';
    const fileName = `${baseName}_depth.${ext}`;

    const btn = $('download-btn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 准备下载...`;

    try {
        // 优先使用 File System Access API：直接弹出保存对话框，最稳定
        if (typeof window.showSaveFilePicker === 'function') {
            const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                    description: typeLabel,
                    accept: { [mimeMain]: ['.' + ext] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(state.resultBlob);
            await writable.close();
            showToast('文件已保存', 'success');
            return;
        }

        // 备用方案 1：IE/Edge 旧版 msSaveOrOpenBlob
        if (typeof navigator.msSaveOrOpenBlob === 'function') {
            navigator.msSaveOrOpenBlob(state.resultBlob, fileName);
            showToast('下载已启动', 'success');
            return;
        }

        // 备用方案 2：创建临时 <a download> 触发下载
        // 为下载单独创建新的 Object URL，避免与预览视频共用 URL 被提前释放
        const downloadUrl = URL.createObjectURL(state.resultBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName;
        a.rel = 'noopener noreferrer';
        a.style.display = 'none';
        document.body.appendChild(a);

        // 使用 MouseEvent 触发，比 a.click() 更可靠
        const event = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
        });
        a.dispatchEvent(event);

        // 延迟清理 DOM 和 Object URL
        setTimeout(() => {
            if (a.parentNode) document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
        }, 200);

        showToast('下载已启动', 'success');
    } catch (err) {
        console.error('Download failed:', err);
        if (err.name === 'AbortError') {
            showToast('已取消保存', 'info');
        } else {
            showToast(`下载失败: ${err.message}`, 'error', 5000);
        }
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }, 600);
    }
}

// ============================================
// Reset
// ============================================
function reset() {
    // Revoke URLs
    if (state.resultUrl) {
        URL.revokeObjectURL(state.resultUrl);
        state.resultUrl = null;
    }

    // Reset video
    const video = $('preview-video');
    if (video.src) {
        URL.revokeObjectURL(video.src);
        video.src = '';
    }

    // Reset state
    state.videoFile = null;
    state.resultBlob = null;
    state.isProcessing = false;

    // Reset progress display
    $('progress-fill').style.width = '0%';
    $('progress-percent').textContent = '0%';
    $('stat-frames').textContent = '0 / 0';
    $('stat-speed').textContent = '-- fps';
    $('stat-eta').textContent = '--';
    $('stat-elapsed').textContent = '0:00';
    $('processing-log').innerHTML = '';

    // Reset file input
    $('file-input').value = '';

    showSection('upload-section');
}

// ============================================
// Event Listeners
// ============================================
function bindEvents() {
    // File upload - click
    $('upload-area').addEventListener('click', () => {
        $('file-input').click();
    });

    // File upload - change
    $('file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadVideoFile(file);
    });

    // File upload - drag & drop
    const uploadArea = $('upload-area');
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) loadVideoFile(file);
    });

    // Back to upload
    $('back-to-upload-btn').addEventListener('click', () => {
        showSection('upload-section');
    });

    // Model source select（模型源：自动/指定）
    const savedSource = (() => { try { return localStorage.getItem('dv_source_mode'); } catch { return null; } })();
    if (savedSource) {
        state.settings.sourceMode = savedSource;
        const ss = $('source-select');
        if (ss) ss.value = savedSource;
        const so = ss && ss.selectedOptions[0];
        if (so) $('source-desc').textContent = so.dataset.desc || '';
    }
    $('source-select').addEventListener('change', (e) => {
        state.settings.sourceMode = e.target.value;
        const option = e.target.selectedOptions[0];
        $('source-desc').textContent = option.dataset.desc || '';
        try { localStorage.setItem('dv_source_mode', e.target.value); } catch { /* 忽略 */ }
        log(`已切换模型源模式: ${e.target.value}`, 'info');
    });

    // 处理质量预设（同时决定「用哪个模型」和「模型输入尺寸」）
    const savedQuality = (() => { try { return localStorage.getItem('dv_quality'); } catch { return null; } })();
    const sel = $('quality-select');
    if (savedQuality && QUALITY_PRESETS[savedQuality]) {
        applyQualityPreset(savedQuality);
        if (sel) sel.value = savedQuality;
    } else {
        applyQualityPreset(state.settings.quality || 'standard');
        if (sel) sel.value = state.settings.quality;
    }
    updateQualityDesc();
    if (sel) {
        sel.addEventListener('change', (e) => {
            const preset = applyQualityPreset(e.target.value);
            updateQualityDesc();
            try { localStorage.setItem('dv_quality', preset.key); } catch { /* 忽略 */ }
            log(`处理质量已切换为「${preset.name}」：模型 ${preset.modelId.split('/').pop()}，输入最短边 ${preset.modelSize}px`, 'info');
            // 换了模型 → 下次开始转换会重新加载
            if (state.loadedModelId && state.loadedModelId !== preset.modelId) {
                state.modelLoaded = false;
            }
        });
    }

    // Clear model cache（清空本地模型缓存，修复缓存损坏导致的反复失败）
    $('clear-cache-btn').addEventListener('click', async () => {
        const btn = $('clear-cache-btn');
        const oldText = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = '清空中…';
        const ok = await clearModelCache();
        btn.disabled = false;
        btn.innerHTML = oldText;
        if (ok) {
            showToast('模型缓存已清空，请重新点击「开始转换」', 'success', 4000);
        } else {
            showToast('清空缓存失败，请刷新页面后重试', 'error', 4000);
        }
    });

    // Depth direction toggle
    $('depth-direction').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        $('depth-direction').querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.invert = btn.dataset.invert === 'true';
    });

    // Contrast slider
    $('contrast-slider').addEventListener('input', (e) => {
        state.settings.contrast = parseInt(e.target.value);
        $('contrast-value').textContent = e.target.value;
    });

    // Brightness slider
    $('brightness-slider').addEventListener('input', (e) => {
        state.settings.brightness = parseInt(e.target.value);
        $('brightness-value').textContent = e.target.value;
    });

    // FPS toggle
    $('fps-group').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        $('fps-group').querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.fps = parseInt(btn.dataset.fps);
        updateQualityDesc();   // 帧率影响总帧数 → 刷新预计耗时
    });

    // Resolution toggle
    $('resolution-group').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        $('resolution-group').querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.resolution = parseFloat(btn.dataset.res);
    });

    // Audio toggle
    $('audio-group').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        $('audio-group').querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.keepAudio = btn.dataset.audio === 'true';
    });

    // Start processing
    $('start-btn').addEventListener('click', () => {
        console.log('[白日梦深度视频转换器] Start button clicked');
        startProcessing();
    });

    // Download
    $('download-btn').addEventListener('click', downloadResult);

    // Reset
    $('reset-btn').addEventListener('click', reset);

    // Retry from error panel
    $('retry-btn')?.addEventListener('click', () => {
        $('error-detail').style.display = 'none';
        $('progress-section').style.display = 'block';
        startProcessing();
    });

    // Back to settings from error panel
    $('back-from-error-btn')?.addEventListener('click', () => {
        showSection('settings-section');
    });

    // 选择模型保存文件夹（将模型真正保存到磁盘，永久离线可用）
    $('choose-model-dir-btn')?.addEventListener('click', () => {
        chooseModelDir();
    });
}

// ============================================
// Init
// ============================================

// 全局错误捕获 — 确保任何未捕获的错误都能被看到
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error || e.message);
    showToast(`脚本错误: ${e.message}`, 'error', 8000);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled rejection:', e.reason);
    const msg = e.reason?.message || e.reason;
    if (msg && (String(msg).includes('Failed to fetch') || String(msg).includes('NetworkError'))) {
        showToast('网络请求失败，请检查网络连接或关闭广告拦截扩展后重试', 'error', 8000);
    } else {
        showToast(`异步错误: ${msg}`, 'error', 8000);
    }
});

async function init() {
    console.log('[白日梦深度视频转换器] Script loaded successfully');

    // 检查关键 DOM 元素是否存在
    const criticalIds = ['start-btn', 'upload-area', 'file-input', 'preview-video',
                         'quality-select', 'contrast-slider', 'brightness-slider',
                         'progress-fill', 'progress-percent', 'processing-log',
                         'download-btn', 'reset-btn', 'error-detail', 'retry-btn',
                         'back-from-error-btn'];
    const missing = criticalIds.filter(id => !$(id));
    if (missing.length > 0) {
        console.error('[白日梦深度视频转换器] Missing DOM elements:', missing);
        showToast(`缺少页面元素: ${missing.join(', ')}`, 'error', 8000);
        return;
    }
    console.log('[白日梦深度视频转换器] All DOM elements verified');

    // 绑定事件监听器
    bindEvents();
    console.log('[白日梦深度视频转换器] Event listeners bound');

    // 检查浏览器能力
    const hasWebGPU = await checkWebGPU();
    const hasWebCodecs = checkWebCodecs();
    console.log('[白日梦深度视频转换器] WebGPU:', hasWebGPU, '| WebCodecs:', hasWebCodecs);

    // 提前探测设备：让用户在点「开始转换」之前就能看到是否用上了显卡
    state.device = hasWebGPU ? 'webgpu' : 'wasm';
    if (hasWebGPU) {
        try {
            const adapter = await navigator.gpu.requestAdapter();
            const info = adapter && adapter.info;
            state.gpuInfo = info
                ? [info.vendor, info.architecture, info.description].filter(Boolean).join(' / ')
                : '';
        } catch { /* 忽略 */ }
    }
    updateDeviceBadge();
    updateQualityDesc();

    if (IS_FILE_PROTOCOL) {
        console.log('[白日梦深度视频转换器] file:// 协议检测到，已启用兼容模式');
        showToast('双击打开模式已就绪，请上传视频开始', 'info', 4000);
    } else {
        showToast('白日梦深度视频转换器 已就绪，请上传视频开始', 'info', 3000);
    }
}

init();
