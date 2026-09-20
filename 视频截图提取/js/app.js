/**
 * 视频截图提取 - 逐帧抓图 / 批量导出
 *
 * 全部在浏览器本地完成：
 *   - 视频用 <video> + ObjectURL 打开，不经过任何服务器
 *   - 抓帧走 canvas.drawImage(video) → toBlob()，纯本地
 *   - 批量下载的 ZIP 由本文件末尾的极简 ZIP 打包器现场生成（仅 STORE 存储，
 *     PNG/JPEG/WebP 本身已压缩，无需再压），因此零依赖、离线可用
 */

// ============================================
// 常量与状态
// ============================================

const MAX_SHOTS = 200;          // 一次性最多保留多少张（防爆内存）
const DEFAULT_FPS = 30;         // 还没探测到帧率时的兜底值

const FORMAT_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const state = {
    file: null,
    videoUrl: null,
    duration: 0,
    videoWidth: 0,
    videoHeight: 0,
    fps: DEFAULT_FPS,
    fpsMeasured: false,
    shots: [],             // { id, time, blob, url, width, height, name }
    batchRunning: false,
    batchCancel: false,
    shotSeq: 0,
    frameTimes: [],
};

// ============================================
// DOM 小工具
// ============================================

const $ = (id) => document.getElementById(id);

function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function log(msg) {
    // 保留一个可被测试脚本转发的出口
    try { console.log('[VSG] ' + msg); } catch (e) { /* ignore */ }
}

function toast(message, type = 'info', duration = 3200) {
    const container = $('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('removing');
        setTimeout(() => el.remove(), 240);
    }, duration);
}

function formatClock(seconds, withMs = true) {
    const s = Math.max(0, seconds || 0);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    const base = `${m}:${String(sec).padStart(2, '0')}`;
    return withMs ? `${base}.${String(ms).padStart(2, '0')}` : base;
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

/** 时间 → 文件名安全的时间戳，如 00-01-500（分-秒-毫秒） */
function stampForFile(t) {
    const s = Math.max(0, t || 0);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s % 1) * 1000);
    return [m, sec, ms].map((v, i) => String(v).padStart(i === 2 ? 3 : 2, '0')).join('-');
}

function baseName(name) {
    return String(name || 'video').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

function extOf(mime) {
    return FORMAT_EXT[mime] || 'png';
}

// ============================================
// 视频载入
// ============================================

function setupVideo(video) {
    const dropZone = $('drop-zone');
    const fileInput = $('file-input');

    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) loadVideoFile(f);
    });

    ['dragenter', 'dragover'].forEach((ev) => {
        dropZone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach((ev) => {
        dropZone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        if (!f.type.startsWith('video/')) {
            toast('这不是视频文件，请换一个（MP4 / MOV / WebM 等）', 'warning');
            return;
        }
        loadVideoFile(f);
    });

    // 页面任意位置也能拖入
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && f.type.startsWith('video/')) loadVideoFile(f);
    });
}

function loadVideoFile(file) {
    const video = $('video');

    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.file = file;
    state.frameTimes = [];
    state.fpsMeasured = false;
    state.fps = DEFAULT_FPS;
    clearAllShots(true);

    $('file-name').textContent = file.name;
    $('file-meta').textContent = formatBytes(file.size) + ' · 正在读取…';

    // 事件先挂好，再赋 src（避免极端情况下 metadata 事件比处理器先到）
    video.onloadedmetadata = () => {
        state.duration = isFinite(video.duration) ? video.duration : 0;
        state.videoWidth = video.videoWidth;
        state.videoHeight = video.videoHeight;

        $('file-meta').textContent =
            `${formatBytes(file.size)} · ${state.videoWidth}×${state.videoHeight} · ${formatClock(state.duration, false)}`;

        $('time-total').textContent = formatClock(state.duration);
        $('time-current').textContent = formatClock(0);
        $('seek-bar').value = 0;
        $('range-start').value = '0';
        $('range-end').value = state.duration.toFixed(2);
        $('fps-chip').textContent = state.fps + ' fps';

        $('upload-section').hidden = true;
        $('workspace').hidden = false;

        updateBatchPreview();
        renderShots();

        log(`视频载入: ${state.videoWidth}x${state.videoHeight} ${state.duration.toFixed(3)}s`);
    };

    video.onerror = () => {
        toast('这个视频浏览器打不开，换一个格式试试（推荐 MP4 / H.264）', 'error', 5000);
        $('file-meta').textContent = formatBytes(file.size) + ' · 读取失败';
    };

    state.videoUrl = URL.createObjectURL(file);
    video.src = state.videoUrl;
    video.load();
}

// ============================================
// 播放控制
// ============================================

/** 精确跳到某个时间点；resolve 时画面已经就绪（可用于抓帧） */
function seekTo(t) {
    const video = $('video');
    const target = Math.max(0, Math.min(t, Math.max(0, state.duration - 0.001)));
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            video.removeEventListener('seeked', onSeeked);
            // seeked 之后画面可能还没画上去，等一帧再返回，抓帧才不会抓到上一帧
            waitFramePaint().then(resolve);
        };
        const onSeeked = () => finish();

        if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) {
            // 已经在目标位置，不会再触发 seeked
            waitFramePaint().then(resolve);
            return;
        }

        video.addEventListener('seeked', onSeeked);
        video.currentTime = target;
        // 兜底：某些浏览器 seek 到同一个 keyframe 里不触发 seeked
        setTimeout(finish, 1500);
    });
}

/** 等到浏览器真正把这一帧画到 <video> 上 */
function waitFramePaint() {
    const video = $('video');
    return new Promise((resolve) => {
        if (typeof video.requestVideoFrameCallback === 'function') {
            let called = false;
            const cb = () => { if (!called) { called = true; resolve(); } };
            video.requestVideoFrameCallback(cb);
            setTimeout(cb, 220);
        } else {
            requestAnimationFrame(() => setTimeout(resolve, 30));
        }
    });
}

function setupPlayback(video) {
    const playBtn = $('play-btn');
    const seekBar = $('seek-bar');

    playBtn.addEventListener('click', togglePlay);
    video.addEventListener('click', togglePlay);

    video.addEventListener('play', () => {
        $('play-icon').innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
        startFpsProbe();
    });
    video.addEventListener('pause', () => {
        $('play-icon').innerHTML = '<path d="M8 5v14l11-7z"/>';
    });
    video.addEventListener('timeupdate', () => {
        if (!state.duration) return;
        $('time-current').textContent = formatClock(video.currentTime);
        seekBar.value = Math.round((video.currentTime / state.duration) * 1000);
    });
    video.addEventListener('ended', () => {
        $('play-icon').innerHTML = '<path d="M8 5v14l11-7z"/>';
    });

    seekBar.addEventListener('input', () => {
        if (!state.duration) return;
        const t = (Number(seekBar.value) / 1000) * state.duration;
        $('time-current').textContent = formatClock(t);
        video.currentTime = t;      // 拖动时连续 seek，松手即定格
    });

    $('prev-frame-btn').addEventListener('click', () => stepFrames(-1));
    $('next-frame-btn').addEventListener('click', () => stepFrames(1));
    $('jump-btn').addEventListener('click', () => {
        const v = parseFloat($('jump-input').value);
        if (!isFinite(v)) { toast('请输入一个时间（秒）', 'warning'); return; }
        seekTo(v).then(syncTimeUI);
    });
    $('capture-btn').addEventListener('click', () => captureCurrent());

    // 快捷键
    document.addEventListener('keydown', (e) => {
        if ($('workspace').hidden) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        if (!$('lightbox').hidden && (e.key === 'Escape')) { closeLightbox(); return; }

        if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (e.shiftKey) seekTo($('video').currentTime - 1).then(syncTimeUI);
            else stepFrames(-1);
            return;
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (e.shiftKey) seekTo($('video').currentTime + 1).then(syncTimeUI);
            else stepFrames(1);
            return;
        }
        if (e.key === 's' || e.key === 'S') { e.preventDefault(); captureCurrent(); }
    });
}

function togglePlay() {
    const video = $('video');
    if (video.paused) video.play().catch(() => { });
    else video.pause();
}

function syncTimeUI() {
    const video = $('video');
    $('time-current').textContent = formatClock(video.currentTime);
    if (state.duration) $('seek-bar').value = Math.round((video.currentTime / state.duration) * 1000);
}

/** 步进一帧（帧长优先用探测到的真实帧率） */
async function stepFrames(n) {
    const video = $('video');
    video.pause();
    const step = 1 / (state.fps || DEFAULT_FPS);
    await seekTo(video.currentTime + n * step);
    syncTimeUI();
}

/**
 * 通过 requestVideoFrameCallback 探测真实帧率。
 * 播放时连续采样相邻帧的 mediaTime 差值，取中位数换算帧率 —— 比猜靠谱。
 */
function startFpsProbe() {
    const video = $('video');
    if (typeof video.requestVideoFrameCallback !== 'function') return;

    const onFrame = (now, meta) => {
        state.frameTimes.push(meta.mediaTime);
        if (state.frameTimes.length > 2) {
            const deltas = [];
            for (let i = 1; i < state.frameTimes.length; i++) {
                const d = state.frameTimes[i] - state.frameTimes[i - 1];
                if (d > 0.0005) deltas.push(d);
            }
            if (deltas.length >= 3) {
                deltas.sort((a, b) => a - b);
                const median = deltas[Math.floor(deltas.length / 2)];
                const fps = Math.round(1 / median);
                if (fps >= 1 && fps <= 240) {
                    state.fps = fps;
                    state.fpsMeasured = true;
                    $('fps-chip').textContent = fps + ' fps';
                }
            }
            if (state.frameTimes.length > 60) state.frameTimes = state.frameTimes.slice(-20);
        }
        if (!video.paused) video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
}

// ============================================
// 抓帧
// ============================================

/** 复用一张画布，避免每张截图都新建 */
let _canvas = null;

function grabFrame() {
    const video = $('video');
    if (!video.videoWidth) return null;

    if (!_canvas) _canvas = document.createElement('canvas');
    const canvas = _canvas;

    const targetW = Number($('size-select').value) || 0;
    let outW = state.videoWidth;
    let outH = state.videoHeight;
    if (targetW > 0 && targetW < state.videoWidth) {
        outW = targetW;
        outH = Math.max(2, Math.round((state.videoHeight / state.videoWidth) * targetW / 2) * 2);
    }

    if (canvas.width !== outW) canvas.width = outW;
    if (canvas.height !== outH) canvas.height = outH;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(video, 0, 0, outW, outH);
    return { canvas, width: outW, height: outH };
}

function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('导出图片失败，可能是视频跨域受限或画布被清空'))),
            mime,
            mime === 'image/png' ? undefined : quality
        );
    });
}

function currentMime() { return $('format-select').value; }
function currentQuality() { return Number($('quality-range').value) / 100; }

/** 抓当前帧并放进结果列表 */
async function captureCurrent() {
    const video = $('video');
    if (!state.videoWidth) { toast('先载入一个视频', 'warning'); return null; }

    try {
        const grabbed = grabFrame();
        if (!grabbed) throw new Error('画面还没准备好，稍等一下再试');
        const blob = await canvasToBlob(grabbed.canvas, currentMime(), currentQuality());
        const shot = addShot(video.currentTime, blob, grabbed.width, grabbed.height);
        renderShots();
        toast(`已截取 ${formatClock(shot.time)}`, 'success', 2000);
        log(`截图 ${shot.name} (${grabbed.width}x${grabbed.height}, ${blob.size}B)`);
        return shot;
    } catch (err) {
        toast(String(err.message || err), 'error', 4500);
        return null;
    }
}

function addShot(time, blob, width, height) {
    state.shotSeq += 1;
    const mime = currentMime();
    const shot = {
        id: state.shotSeq,
        time,
        blob,
        width,
        height,
        url: URL.createObjectURL(blob),
        name: `${baseName(state.file && state.file.name)}_shot${String(state.shotSeq).padStart(3, '0')}_${stampForFile(time)}.${extOf(mime)}`,
    };
    state.shots.push(shot);
    return shot;
}

// ============================================
// 批量提取
// ============================================

/** 按当前设置算出要抓的时间点列表 */
function computeBatchTimes() {
    const duration = state.duration;
    if (!duration) return { times: [], reason: '还没有载入视频' };

    let start = Number($('range-start').value);
    if (!isFinite(start)) start = 0;
    let end = Number($('range-end').value);
    if (!isFinite(end) || end <= 0) end = duration;
    start = Math.max(0, Math.min(start, duration));
    end = Math.max(0, Math.min(end, duration));
    if (end <= start) return { times: [], reason: '结束时间要比开始时间晚' };

    const mode = $('batch-mode').value;
    const times = [];

    if (mode === 'interval') {
        let step = Number($('interval-input').value);
        if (!isFinite(step) || step < 0.04) step = 0.04;
        for (let t = start; t <= end + 1e-6 && times.length < MAX_SHOTS; t += step) {
            times.push(Math.min(t, end));
        }
    } else {
        let n = Math.round(Number($('count-input').value));
        if (!isFinite(n) || n < 1) n = 1;
        if (n > MAX_SHOTS) n = MAX_SHOTS;
        if (n === 1) {
            times.push(start);
        } else {
            const span = end - start;
            for (let i = 0; i < n; i++) times.push(start + (span * i) / (n - 1));
        }
    }

    // 时间点去重（浮点累加可能产生重复）
    const uniq = [];
    for (const t of times) {
        if (!uniq.length || Math.abs(uniq[uniq.length - 1] - t) > 1e-4) uniq.push(t);
    }

    return { times: uniq, reason: '' };
}

function updateBatchPreview() {
    const el = $('batch-preview');
    if (!el) return;
    if (!state.duration) { el.textContent = '—'; return; }

    const { times, reason } = computeBatchTimes();
    if (reason) {
        el.textContent = reason;
        el.classList.add('warn');
        return;
    }
    const span = times.length ? (times[times.length - 1] - times[0]) : 0;
    let text = `将提取 ${times.length} 张（覆盖 ${formatClock(span, false)} 的片段）`;
    if (times.length >= MAX_SHOTS) text += ' —— 已达单次上限，请调大间隔或减少张数';
    el.textContent = text;
    el.classList.toggle('warn', times.length >= MAX_SHOTS || times.length === 0);
}

async function runBatch() {
    if (state.batchRunning) return;
    const { times, reason } = computeBatchTimes();
    if (reason) { toast(reason, 'warning'); return; }
    if (!times.length) { toast('没有要提取的时间点，检查一下范围设置', 'warning'); return; }

    const video = $('video');
    video.pause();

    state.batchRunning = true;
    state.batchCancel = false;
    const btn = $('batch-btn');
    const cancelBtn = $('batch-cancel');
    const prog = $('batch-progress');
    btn.disabled = true;
    cancelBtn.hidden = false;
    prog.hidden = false;

    const t0 = performance.now();
    let ok = 0;
    try {
        for (let i = 0; i < times.length; i++) {
            if (state.batchCancel) break;
            prog.textContent = `正在提取 ${i + 1} / ${times.length} …`;
            await seekTo(times[i]);
            await syncTimeUI();
            const grabbed = grabFrame();
            if (!grabbed) continue;
            const blob = await canvasToBlob(grabbed.canvas, currentMime(), currentQuality());
            addShot(times[i], blob, grabbed.width, grabbed.height);
            ok++;
            // 每 5 张刷一次界面，避免频繁重绘
            if (i % 5 === 4 || i === times.length - 1) {
                renderShots();
                await new Promise((r) => setTimeout(r, 0));
            }
        }
        renderShots();
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        log(`批量提取完成: ${ok}/${times.length} 张，用时 ${secs}s`);
        toast(state.batchCancel ? `已停止，共提取 ${ok} 张` : `提取完成，共 ${ok} 张（用时 ${secs} 秒）`,
            state.batchCancel ? 'warning' : 'success', 3600);
    } catch (err) {
        toast('提取中断：' + String(err.message || err), 'error', 5000);
        log('批量提取失败: ' + err);
    } finally {
        state.batchRunning = false;
        btn.disabled = false;
        cancelBtn.hidden = true;
        prog.hidden = true;
    }
}

// ============================================
// 结果列表
// ============================================

function renderShots() {
    const grid = $('shots-grid');
    grid.innerHTML = '';

    state.shots.forEach((shot, i) => {
        const card = document.createElement('div');
        card.className = 'shot';
        card.dataset.id = String(shot.id);

        const thumb = document.createElement('div');
        thumb.className = 'shot-thumb';
        const img = document.createElement('img');
        img.src = shot.url;
        img.alt = '截图 ' + (i + 1);
        img.loading = 'lazy';
        thumb.appendChild(img);
        thumb.insertAdjacentHTML('beforeend', `<span class="shot-index">#${i + 1}</span>`);
        thumb.insertAdjacentHTML('beforeend', `<span class="shot-time">${formatClock(shot.time)}</span>`);
        thumb.addEventListener('click', () => openLightbox(shot));

        const actions = document.createElement('div');
        actions.className = 'shot-actions';
        actions.innerHTML =
            '<button type="button" data-act="download">下载</button>' +
            '<button type="button" data-act="copy">复制</button>' +
            '<button type="button" class="danger" data-act="delete">删除</button>';
        actions.addEventListener('click', (e) => {
            const act = e.target && e.target.dataset && e.target.dataset.act;
            if (act === 'download') downloadShot(shot);
            else if (act === 'copy') copyShot(shot);
            else if (act === 'delete') deleteShot(shot.id);
        });

        card.appendChild(thumb);
        card.appendChild(actions);
        grid.appendChild(card);
    });

    const total = state.shots.reduce((a, s) => a + s.blob.size, 0);
    $('result-stats').textContent = state.shots.length
        ? `已截取 ${state.shots.length} 张 · 合计 ${formatBytes(total)}`
        : '还没有截图';

    const has = state.shots.length > 0;
    $('download-all-btn').disabled = !has;
    $('clear-btn').disabled = !has;

    updateEmptyState();
}

function updateEmptyState() {
    $('empty-state').hidden = state.shots.length > 0;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadShot(shot) {
    downloadBlob(shot.blob, shot.name);
    toast('已下载 ' + shot.name, 'success', 2000);
}

async function copyShot(shot) {
    try {
        if (!navigator.clipboard || !window.ClipboardItem) {
            throw new Error('这个浏览器不支持复制图片，请用「下载」');
        }
        // 剪贴板只稳定支持 PNG，其它格式先转一版 PNG
        let blob = shot.blob;
        if (blob.type !== 'image/png') {
            const bmp = await createImageBitmap(blob);
            const c = document.createElement('canvas');
            c.width = bmp.width;
            c.height = bmp.height;
            c.getContext('2d').drawImage(bmp, 0, 0);
            blob = await new Promise((r) => c.toBlob(r, 'image/png'));
            bmp.close && bmp.close();
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('已复制到剪贴板，可以直接粘贴', 'success', 2200);
    } catch (err) {
        toast('复制失败：' + String(err.message || err), 'warning', 4000);
    }
}

function deleteShot(id) {
    const i = state.shots.findIndex((s) => s.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(state.shots[i].url);
    state.shots.splice(i, 1);
    renderShots();
}

function clearAllShots(silent) {
    state.shots.forEach((s) => URL.revokeObjectURL(s.url));
    state.shots = [];
    state.shotSeq = 0;
    if (!silent) {
        renderShots();
        toast('已清空全部截图', 'info', 2000);
    }
}

/** 打包下载：单张直接下；多张生成 ZIP */
async function downloadAll() {
    if (!state.shots.length) return;
    const btn = $('download-all-btn');

    if (state.shots.length === 1) { downloadShot(state.shots[0]); return; }

    try {
        btn.disabled = true;
        btn.textContent = '正在打包…';
        await new Promise((r) => setTimeout(r, 30));   // 让按钮先变字

        const files = [];
        for (const shot of state.shots) {
            files.push({ name: shot.name, data: new Uint8Array(await shot.blob.arrayBuffer()) });
        }
        const zip = buildZip(files);
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        downloadBlob(zip, `${baseName(state.file && state.file.name)}_截图_${state.shots.length}张_${stamp}.zip`);
        toast(`已打包 ${state.shots.length} 张，共 ${formatBytes(zip.size)}`, 'success', 3200);
        log(`ZIP 打包完成: ${state.shots.length} 个文件, ${zip.size} 字节`);
    } catch (err) {
        toast('打包失败：' + String(err.message || err), 'error', 4500);
    } finally {
        btn.disabled = state.shots.length === 0;
        btn.textContent = '打包下载 ZIP';
    }
}

// ============================================
// 大图预览
// ============================================

let lightboxShot = null;

function openLightbox(shot) {
    lightboxShot = shot;
    $('lightbox-img').src = shot.url;
    $('lightbox-time').textContent = `${formatClock(shot.time)} · ${shot.width}×${shot.height}`;
    $('lightbox').hidden = false;
}

function closeLightbox() {
    $('lightbox').hidden = true;
    lightboxShot = null;
}

// ============================================
// 初始化
// ============================================

function init() {
    const video = $('video');
    if (!video) { console.error('[VSG] 找不到 #video 元素'); return; }

    setupVideo(video);
    setupPlayback(video);

    // 设置项
    $('format-select').addEventListener('change', () => {
        const mime = currentMime();
        $('quality-group').hidden = mime === 'image/png';
        $('format-hint').textContent = mime === 'image/png'
            ? 'PNG 无损最清晰，适合后续再编辑；体积较大。'
            : mime === 'image/jpeg'
                ? 'JPEG 体积小、兼容性最好，适合发图；画质滑块调到 90% 以上肉眼几乎无差。'
                : 'WebP 同画质下体积最小；老软件可能不支持，自己保存留档推荐 PNG。';
    });
    $('quality-range').addEventListener('input', () => {
        $('quality-value').textContent = $('quality-range').value + '%';
    });

    // 批量设置联动
    $('batch-mode').addEventListener('change', () => {
        const isInterval = $('batch-mode').value === 'interval';
        $('interval-group').hidden = !isInterval;
        $('count-group').hidden = isInterval;
        updateBatchPreview();
    });
    ['interval-input', 'count-input', 'range-start', 'range-end'].forEach((id) => {
        $(id).addEventListener('input', updateBatchPreview);
        $(id).addEventListener('change', updateBatchPreview);
    });

    $('batch-btn').addEventListener('click', runBatch);
    $('batch-cancel').addEventListener('click', () => { state.batchCancel = true; });

    // 结果操作
    $('download-all-btn').addEventListener('click', downloadAll);
    $('clear-btn').addEventListener('click', () => {
        if (state.shots.length > 3 && !window.confirm(`确定清空 ${state.shots.length} 张截图吗？`)) return;
        clearAllShots();
    });

    // 换视频
    $('reset-btn').addEventListener('click', () => {
        const video = $('video');
        video.pause();
        if (state.videoUrl) { URL.revokeObjectURL(state.videoUrl); state.videoUrl = null; }
        video.removeAttribute('src');
        video.load();
        clearAllShots(true);
        state.file = null;
        state.duration = 0;
        $('file-input').value = '';
        $('upload-section').hidden = false;
        $('workspace').hidden = true;
    });

    // 大图预览
    $('lightbox-close').addEventListener('click', closeLightbox);
    $('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
    $('lightbox-download').addEventListener('click', () => {
        if (lightboxShot) downloadShot(lightboxShot);
    });

    renderShots();
    log('已就绪');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ============================================
// 极简 ZIP 打包器（仅 STORE，零依赖）
//   PNG / JPEG / WebP 本身已压缩，无需再 deflate，
//   所以只要拼好 local header + central directory + EOCD 就是一个合法 ZIP。
// ============================================

const _crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
    const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    return { time, date };
}

/**
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Blob} application/zip
 */
function buildZip(files) {
    const encoder = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const parts = [];      // 按顺序：所有 local header + 数据
    const central = [];    // 所有 central directory entry
    let offset = 0;

    for (const f of files) {
        const nameBytes = encoder.encode(f.name);
        const crc = crc32(f.data);
        const size = f.data.length;

        // --- Local file header (30 字节 + 文件名) ---
        const lh = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true);   // 签名
        lv.setUint16(4, 20, true);           // 解压所需版本
        lv.setUint16(6, 0x0800, true);       // 标志位：文件名为 UTF-8
        lv.setUint16(8, 0, true);            // 压缩方法 0 = 不压缩
        lv.setUint16(10, time, true);
        lv.setUint16(12, date, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, size, true);        // 压缩后大小
        lv.setUint32(22, size, true);        // 原始大小
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);           // 扩展字段长度
        lh.set(nameBytes, 30);

        parts.push(lh, f.data);

        // --- Central directory file header (46 字节 + 文件名) ---
        const ch = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);           // 创建版本
        cv.setUint16(6, 20, true);           // 解压所需版本
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, time, true);
        cv.setUint16(14, date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, size, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);           // 扩展字段
        cv.setUint16(32, 0, true);           // 注释
        cv.setUint16(34, 0, true);           // 起始磁盘号
        cv.setUint16(36, 0, true);           // 内部属性
        cv.setUint32(38, 0, true);           // 外部属性
        cv.setUint32(42, offset, true);      // local header 偏移
        ch.set(nameBytes, 46);
        central.push(ch);

        offset += lh.length + size;
    }

    const centralSize = central.reduce((a, b) => a + b.length, 0);

    // --- End of central directory (22 字节) ---
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);                 // 本磁盘号
    ev.setUint16(6, 0, true);                 // central 起始磁盘号
    ev.setUint16(8, files.length, true);      // 本磁盘 entry 数
    ev.setUint16(10, files.length, true);     // entry 总数
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);           // central 偏移
    ev.setUint16(20, 0, true);                // 注释长度

    return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}

// 暴露给测试脚本（浏览器里方便验证真实链路）
window.__vsg = {
    state,
    seekTo,
    captureCurrent,
    computeBatchTimes,
    buildZip,
    crc32,
    renderShots,
    grabFrame,
};
