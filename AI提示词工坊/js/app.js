(function () {
  'use strict';

  /* ============================================================
     AI 提示词工坊 · 提示词随作品列表一并返回，打开即看，无需二次取词
     ============================================================ */
  var API = (location.search.indexOf('apitest') >= 0)
    ? 'http://127.0.0.1:8731/api/v1'
    : 'https://civitai.com/api/v1';
  var PAGE_SIZE = 24;
  var LS_KEY = 'pworkshop.detail.v2';

  function listUrl() {
    var q = [];
    q.push('limit=' + PAGE_SIZE);
    q.push('page=' + S.page);
    q.push('nsfw=false');
    var s = (S.sort === 'hot') ? 'Most Reactions' : (S.sort || 'Newest');
    q.push('sort=' + encodeURIComponent(s));
    if (S.mode === 'video') q.push('imageType=video');
    else q.push('imageType=image');
    if (S.keyword) q.push('query=' + encodeURIComponent(S.keyword));
    return API + '/images?' + q.join('&');
  }

  /* ---------- 工具函数 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function thumb(url) { return url || ''; }
  function rawUrl(url) { return url || ''; }
  function timeAgo(t) {
    if (!t) return '';
    var d = new Date(t).getTime();
    if (isNaN(d)) return '';
    var s = (Date.now() - d) / 1000;
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 2592000) return Math.floor(s / 86400) + ' 天前';
    var dt = new Date(d);
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
  }

  function fetchText(url, ms, init, onCtl) {
    return new Promise(function (resolve, reject) {
      var ctl = new AbortController();
      var settled = false;
      if (onCtl) { try { onCtl(ctl); } catch (e) { } }
      var timer = setTimeout(function () {
        if (settled) return; settled = true;
        try { ctl.abort(); } catch (e) { }
        reject(new Error('请求超时'));
      }, ms);
      var o = init || {}; o.signal = ctl.signal;
      fetch(url, o)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { if (settled) return; settled = true; clearTimeout(timer); resolve(j); })
        .catch(function (e) {
          if (settled) return; settled = true; clearTimeout(timer);
          reject(e && e.name === 'AbortError' ? new Error('请求超时') : e);
        });
    });
  }
  function fetchJSON(url, ms, init) { return fetchText(url, ms, init); }

  function copyText(txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); res(); } catch (e) { rej(e); }
      document.body.removeChild(ta);
    });
  }

  /* ---------- 状态 ---------- */
  var S = {
    mode: 'image', keyword: '', sort: 'Newest', promptOnly: true,
    page: 1, hasMore: false, loading: false, items: [], seq: 0, current: null
  };

  var $ = function (s) { return document.querySelector(s); };
  var el = {
    kw: $('#kw'), kwbtn: $('#kwbtn'), seg: $('#seg'),
    fSort: $('#f-sort'), fPrompt: $('#f-prompt'),
    count: $('#count'), grid: $('#grid'), state: $('#state'),
    more: $('#more'), morebtn: $('#morebtn'), refresh: $('#refresh'),
    modal: $('#modal'), stage: $('#mv-stage'), mvmeta: $('#mv-meta'),
    title: $('#mi-title'), sub: $('#mi-sub'), params: $('#mi-params'), src: $('#mi-src'),
    prompt: $('#p-prompt'), neg: $('#p-neg'), negWrap: $('#neg-wrap'),
    copyAll: $('#copy-all'), openRaw: $('#open-raw'),
    load: $('#mi-load'), err: $('#mi-err')
  };

  /* ---------- 缓存 ---------- */
  var CMAP = null;
  function loadCache() {
    if (CMAP) return CMAP;
    try { CMAP = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { CMAP = {}; }
    if (!CMAP || typeof CMAP !== 'object') CMAP = {};
    return CMAP;
  }
  function cacheGet(uuid) { var m = loadCache(); return m[uuid] || null; }
  function cacheSet(uuid, data) {
    var m = loadCache(); m[uuid] = data;
    try {
      var keys = Object.keys(m);
      if (keys.length > 400) keys.slice(0, 120).forEach(function (k) { delete m[k]; });
      localStorage.setItem(LS_KEY, JSON.stringify(m));
    } catch (e) { }
  }
  function markReady(uuid) {
    var cards = el.grid.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var it = S.items[parseInt(cards[i].getAttribute('data-i'), 10)];
      if (it && it.uuid === uuid) cards[i].classList.add('has-p');
    }
  }
  function keep(uuid, d) { cacheSet(uuid, d); markReady(uuid); return d; }

  var inflight = {};
  var MISS = {}, MISS_TTL = 10 * 60 * 1000;
  function markedMiss(uuid) { return !!(MISS[uuid] && (Date.now() - MISS[uuid]) < MISS_TTL); }

  /* ---------- 解析 Civitai 返回 ---------- */
  function metaParams(m) {
    var p = {};
    if (m.Model) p['Model'] = m.Model;
    if (m.Sampler) p['Sampler'] = m.Sampler;
    if (m.Scheduler) p['Scheduler'] = m.Scheduler;
    if (m.Steps) p['Steps'] = m.Steps;
    if (m['Cfg Scale']) p['CFG scale'] = m['Cfg Scale'];
    if (m.Seed) p['Seed'] = m.Seed;
    if (m.Size) p['Size'] = m.Size;
    if (m['Clip Skip']) p['Clip skip'] = m['Clip Skip'];
    if (m.Denoise) p['Denoise'] = m.Denoise;
    if (Array.isArray(m.resources)) {
      var lor = m.resources.filter(function (r) { return /lora/i.test(r.type || ''); })
        .map(function (r) { return r.model || r.name || ''; }).filter(Boolean).join(', ');
      if (lor) p['LoRA'] = lor;
    }
    return p;
  }
  function mapItem(it) {
    if (!it || !it.id) return null;
    var meta = it.meta || {};
    var isV = it.type === 'video';
    var p = (typeof meta.prompt === 'string') ? meta.prompt : '';
    var neg = (typeof meta.negativePrompt === 'string') ? meta.negativePrompt : '';
    var params = metaParams(meta);
    var user = it.user || {};
    var stats = it.stats || {};
    var url = it.url || (it.images && it.images[0] && it.images[0].url) || '';
    var w = it.width || (it.images && it.images[0] && it.images[0].width) || 0;
    var h = it.height || (it.images && it.images[0] && it.images[0].height) || 0;
    var item = {
      uuid: String(it.id),
      title: (it.name || '').trim() || ('作品 #' + it.id),
      imageUrl: isV ? '' : url,
      videoUrl: isV ? url : '',
      mediaType: isV ? 2 : 1,
      width: w, height: h,
      avatar: user.image || '',
      nickname: user.username || '匿名',
      likeCount: stats.heartCount || 0,
      createTime: it.createdAt || it.publishedAt || '',
      promptEn: p, promptCn: '', negativePrompt: neg,
      params: params, hasPrompt: !!(p || neg),
      _detail: { src: 'api', promptEn: p, promptCn: '', negativePrompt: neg, params: params }
    };
    if (item.hasPrompt) cacheSet(item.uuid, item._detail);
    return item;
  }

  /* ---------- 列表 ---------- */
  function loadList(append) {
    if (S.loading) return;
    S.loading = true; S.seq++;
    var mySeq = S.seq;
    if (!append) { S.page = 1; S.items = []; }
    el.morebtn.disabled = true;
    if (!append) { el.grid.innerHTML = ''; showState('loading'); el.count.textContent = '正在从社区拉取…'; }
    fetchJSON(listUrl(), 20000, { headers: { 'Accept': 'application/json' } })
      .then(function (j) {
        if (mySeq !== S.seq) return;
        if (!j || !Array.isArray(j.items)) throw new Error('返回内容异常');
        var arr = j.items.map(mapItem).filter(Boolean);
        if (S.promptOnly) arr = arr.filter(function (x) { return x.hasPrompt; });
        var md = j.metadata || {};
        var tp = Math.ceil((md.totalItems || 0) / PAGE_SIZE);
        S.hasMore = (md.currentPage || 1) < tp && arr.length > 0;
        S.items = S.items.concat(arr);
        if (S.sort === 'hot') {
          S.items = S.items.slice().sort(function (a, b) { return (b.likeCount || 0) - (a.likeCount || 0); });
          render();
        } else appendCards(arr);
        el.count.innerHTML = '已加载 <b>' + S.items.length + '</b> 个作品' +
          (S.keyword ? ' · 关键词「<b>' + esc(S.keyword) + '</b>」' : '') +
          (S.hasMore ? '' : ' · 没有更多了');
        hideState();
        el.more.hidden = !S.hasMore;
        el.morebtn.disabled = false;
      })
      .catch(function (e) {
        if (mySeq !== S.seq) return;
        console.warn(e);
        if (!S.items.length) showState('error', e && e.name === 'AbortError' ? '请求超时，请检查网络后重试。' : '拉取社区数据失败：' + ((e && e.message) || e));
        el.count.textContent = '加载失败';
      })
      .then(function () { S.loading = false; });
  }

  /* ---------- 卡片渲染 ---------- */
  var ROW_STEP = 18;
  function aspectOf(it) {
    var iw = it.width || 1, ih = it.height || 1;
    if (!(iw > 0) || !(ih > 0)) return '3/4';
    if (ih / iw > 2) return '1/2';
    if (iw / ih > 2.4) return '2.4/1';
    return iw + '/' + ih;
  }
  function layoutCards(scope) {
    var cards = (scope || el.grid).querySelectorAll('.card');
    [].forEach.call(cards, function (c) {
      var box = c.querySelector('.card-img'), info = c.querySelector('.card-info');
      if (!box || !info) return;
      var h = box.getBoundingClientRect().height + info.offsetHeight;
      if (!(h > 0)) return;
      c.style.gridRowEnd = 'span ' + Math.max(1, Math.ceil((h + 16) / ROW_STEP));
    });
  }
  function cardHtml(it, idx) {
    var isV = S.mode === 'video' || it.mediaType === 2;
    var cover = it.imageUrl || it.videoUrl || '';
    var t = thumb(cover, 520);
    var title = (it.title || '').trim() || '未命名作品';
    var dim = (it.width && it.height) ? (it.width + '×' + it.height) : '';
    var badge = isV ? '🎬 视频' : (dim || '🖼️ 图片');
    var ready = !!cacheGet(it.uuid);
    return '<article class="card' + (ready ? ' has-p' : '') + '" data-i="' + idx + '">' +
      '<div class="card-img" style="aspect-ratio:' + aspectOf(it) + '">' +
      '<div class="ph"></div>' +
      '<span class="card-badge">' + esc(badge) + '</span>' +
      (cover ? '<img loading="lazy" decoding="async" src="' + esc(t) + '" alt="' + esc(title) + '">' : '') +
      (isV ? '<span class="play"><i>▶</i></span>' : '') +
      '<span class="card-ready" title="提示词已缓存，点开即看">📝 提示词</span>' +
      '</div>' +
      '<div class="card-info">' +
      '<div class="card-title">' + esc(title) + '</div>' +
      '<div class="card-foot">' +
      '<span class="card-user">' +
      (it.avatar ? '<img loading="lazy" src="' + esc(thumb(it.avatar, 64)) + '" alt="">' : '') +
      '<span>' + esc(it.nickname || '匿名') + '</span>' +
      '</span>' +
      '<span class="card-like">❤ ' + (it.likeCount || 0) + '</span>' +
      '</div>' +
      '<div class="card-foot" style="margin-top:4px;font-size:11.5px">' +
      '<span>' + esc(timeAgo(it.createTime)) + '</span>' +
      '</div>' +
      '</div></article>';
  }
  function bindCard(host) {
    [].forEach.call(host.querySelectorAll('.card'), function (c) {
      if (c.__b) return; c.__b = 1;
      var img = c.querySelector('img');
      if (img) {
        var ph = c.querySelector('.ph');
        var done = function () { if (ph) ph.remove(); };
        if (img.complete && img.naturalWidth) done();
        img.addEventListener('load', done);
        img.addEventListener('error', function () { if (ph) ph.remove(); img.style.display = 'none'; });
      }
      c.addEventListener('click', function () {
        var it = S.items[parseInt(c.getAttribute('data-i'), 10)];
        if (it) openDetail(it);
      });
      c.addEventListener('mouseenter', function () {
        var it = S.items[parseInt(c.getAttribute('data-i'), 10)];
        if (it) prefetch(it);
      });
      if (window.IntersectionObserver) {
        if (!ioCard) {
          ioCard = new IntersectionObserver(function (ents) {
            ents.forEach(function (en) {
              if (!en.isIntersecting) return;
              var card = en.target; ioCard.unobserve(card);
              var it = S.items[parseInt(card.getAttribute('data-i'), 10)];
              if (it && it.mediaType !== 2) prefetch(it);
            });
          }, { rootMargin: '320px 0px' });
        }
        ioCard.observe(c);
      }
    });
  }
  var ioCard = null;
  function appendCards(arr) {
    var base = S.items.length - arr.length;
    var buf = '';
    for (var i = 0; i < arr.length; i++) buf += cardHtml(arr[i], base + i);
    var tmp = document.createElement('div'); tmp.innerHTML = buf;
    var frag = document.createDocumentFragment();
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    el.grid.appendChild(frag); layoutCards(el.grid); bindCard(el.grid);
  }
  function render() {
    el.grid.innerHTML = '';
    var buf = '';
    for (var i = 0; i < S.items.length; i++) buf += cardHtml(S.items[i], i);
    el.grid.innerHTML = buf; layoutCards(el.grid); bindCard(el.grid);
  }
  var rzT = null;
  window.addEventListener('resize', function () { clearTimeout(rzT); rzT = setTimeout(function () { layoutCards(el.grid); }, 180); });
  function showState(kind, msg) {
    el.state.hidden = false;
    if (kind === 'loading') {
      el.state.innerHTML = '<div class="spin" style="width:26px;height:26px;border-width:3px;margin:4px auto 14px"></div>正在从社区拉取…';
    } else if (kind === 'error') {
      el.state.innerHTML = '<div class="big">📡</div><div>' + esc(msg) + '</div><button type="button" id="retry">重试</button>';
      var b = $('#retry'); if (b) b.addEventListener('click', function () { loadList(false); });
    } else if (kind === 'empty') {
      el.state.innerHTML = '<div class="big">🔍</div><div>' + esc(msg || '没有找到匹配的作品，换个关键词试试～') + '</div>';
    }
  }
  function hideState() { if (!S.items.length) { showState('empty'); return; } el.state.hidden = true; }

  /* ---------- 详情：直接取列表里已带好的 meta，无需任何额外取词步骤 ---------- */
  function fetchDetail(item) {
    var it = item && typeof item === 'object' ? item : null;
    if (it && it._detail) return Promise.resolve(it._detail);
    return Promise.resolve({ src: 'api', promptEn: it ? it.promptEn : '', promptCn: '', negativePrompt: it ? it.negativePrompt : '', params: it ? it.params : {} });
  }
  function getDetail(item, isAuto) {
    var uuid = (item && typeof item === 'object') ? item.uuid : item;
    var hit = cacheGet(uuid);
    if (hit) return Promise.resolve(hit);
    if (isAuto && markedMiss(uuid)) return Promise.reject(new Error('刚刚没取到，跳过重复预取'));
    if (inflight[uuid]) return inflight[uuid];
    var p = fetchDetail(item).then(function (d) {
      if (!(d && (d.promptEn || d.negativePrompt))) throw new Error('作者没有公开提示词');
      return keep(uuid, d);
    });
    inflight[uuid] = p;
    p.then(function () { delete MISS[uuid]; }, function () { MISS[uuid] = Date.now(); }).then(function () { delete inflight[uuid]; });
    return p;
  }
  function prefetch(item) {
    var uuid = (item && typeof item === 'object') ? item.uuid : item;
    if (!uuid || cacheGet(uuid) || inflight[uuid]) return;
    for (var i = 0; i < PQ.length; i++) {
      var u = (PQ[i] && typeof PQ[i] === 'object') ? PQ[i].uuid : PQ[i];
      if (u === uuid) return;
    }
    if (PQ.length > 60) return;
    PQ.push((item && typeof item === 'object') ? item : { uuid: uuid });
    runPQ();
  }
  function isVideoItem(it) { return !!(it && (it.mediaType === 2 || /\.mp4(\?|$)/i.test(it.videoUrl || ''))); }
  var PQ = [], qImgBusy = 0, qVidBusy = false;
  var Q_IMG_MAX = 6, Q_GAP = 80, Q_VID_GAP = 300;
  function runPQ() {
    if (!PQ.length) return;
    var pick = -1;
    for (var i = 0; i < PQ.length; i++) {
      if (isVideoItem(PQ[i])) { if (!qVidBusy && qImgBusy === 0) { pick = i; break; } }
      else if (qImgBusy < Q_IMG_MAX) { pick = i; break; }
    }
    if (pick < 0) return;
    var it = PQ.splice(pick, 1)[0];
    var isV = isVideoItem(it);
    if (isV) qVidBusy = true; else qImgBusy++;
    var finish = function () { if (isV) qVidBusy = false; else qImgBusy--; setTimeout(runPQ, isV ? Q_VID_GAP : Q_GAP); };
    getDetail(it, true).catch(function () { }).then(finish, finish);
    if (PQ.length) setTimeout(runPQ, 0);
  }

  /* ---------- 详情弹层 ---------- */
  function openDetail(it) {
    S.current = it; S.curDetail = null;
    el.modal.hidden = false; document.body.style.overflow = 'hidden';
    el.err.hidden = true; el.err.innerHTML = ''; el.negWrap.hidden = false;
    var isV = it.mediaType === 2 || S.mode === 'video';
    if (isV && it.videoUrl) {
      el.stage.innerHTML = '<video src="' + esc(it.videoUrl) + '" controls playsinline preload="metadata" ' + (it.imageUrl ? 'poster="' + esc(it.imageUrl) + '"' : '') + '></video>';
    } else {
      el.stage.innerHTML = '<img src="' + esc(it.imageUrl || it.videoUrl) + '" alt="' + esc(it.title || '') + '">';
    }
    var dim = (it.width && it.height) ? (it.width + ' × ' + it.height) : '';
    el.mvmeta.textContent = [dim, timeAgo(it.createTime)].filter(Boolean).join(' · ');
    el.title.textContent = (it.title || '').trim() || '未命名作品';
    el.sub.innerHTML = (it.avatar ? '<img src="' + esc(thumb(it.avatar, 64)) + '" alt="">' : '') +
      '<span>' + esc(it.nickname || '匿名') + '</span><span>❤ ' + (it.likeCount || 0) + '</span>' +
      (isV ? '<span>🎬 视频</span>' : '<span>🖼️ 图片</span>');
    el.params.innerHTML = ''; if (el.src) el.src.innerHTML = '';
    el.prompt.textContent = '—'; el.prompt.classList.add('empty');
    el.neg.textContent = '—'; el.neg.classList.add('empty');
    el.load.hidden = false;
    if (el.openRaw) {
      var raw = it.mediaType === 2 ? (it.videoUrl || '') : (it.imageUrl || '');
      el.openRaw.href = raw || it.imageUrl || '#'; el.openRaw.hidden = !raw;
      el.openRaw.textContent = it.mediaType === 2 ? '⬇ 原视频' : '⬇ 原图';
    }
    function paint(d) {
      el.load.hidden = true;
      var P = d.params || {};
      var LBL = { 'Model': '模型', 'Sampler': '采样器', 'Scheduler': '调度器', 'Steps': '步数', 'CFG scale': 'CFG', 'Seed': '种子', 'Size': '尺寸', 'LoRA': 'LoRA', 'Denoise': '重绘幅度', 'Clip skip': 'Clip skip' };
      var tags = [], seen = {};
      ['Model', 'Sampler', 'Scheduler', 'Steps', 'CFG scale', 'Seed', 'Size', 'LoRA', 'Denoise', 'Clip skip'].forEach(function (k) {
        if (P[k] && !seen[k]) { seen[k] = 1; tags.push([LBL[k] || k, P[k]]); }
      });
      el.params.innerHTML = tags.map(function (t, i) { return '<span class="ptag' + (i % 2 ? ' p' : '') + '">' + esc(t[0]) + ' · ' + esc(t[1]) + '</span>'; }).join('');
      if (el.src) el.src.innerHTML = '✅ 提示词已成功获取';
      var p = d.promptEn || d.promptCn || '';
      var n = d.negativePrompt || '';
      if (p) { el.prompt.textContent = p; el.prompt.classList.remove('empty'); }
      else {
        var isVid = S.mode === 'video' || (S.current && S.current.mediaType === 2);
        el.prompt.textContent = isVid
          ? '这个视频的作者没有公开提示词（社区里视频作品普遍不公开生成信息）。想看提示词可以切到上方「🖼️ 图片」Tab。'
          : '这张图的作者没有公开提示词（社区里作者可以自己选择是否公开）。';
        el.prompt.classList.add('empty');
      }
      if (n) { el.neg.textContent = n; el.neg.classList.remove('empty'); el.negWrap.hidden = false; }
      else { el.negWrap.hidden = true; }
    }
    function fail(msg) {
      el.load.hidden = true; if (el.src) el.src.innerHTML = '';
      el.err.hidden = false; el.err.innerHTML = esc(msg) + '<br><button type="button" id="dretry">重新获取</button>';
      var b = document.getElementById('dretry');
      if (b) b.addEventListener('click', function () { start(); });
      el.prompt.textContent = '提示词获取失败，可稍后重试「重新获取」。'; el.prompt.classList.add('empty');
    }
    function start() {
      el.err.hidden = true; el.load.hidden = false;
      getDetail(it).then(function (d) {
        if (S.current !== it) return; S.curDetail = d; paint(d);
      }).catch(function (e) {
        if (S.current !== it) return;
        var msg = (e && e.message) || String(e);
        fail('提示词没取到：' + msg + '。可以点下面「重新获取」再试；若作者未公开提示词，则无法获取。');
      });
    }
    var cnOld = document.getElementById('cnbox');
    if (cnOld) cnOld.remove();
    start();
  }
  function closeDetail() {
    el.modal.hidden = true; document.body.style.overflow = '';
    el.stage.innerHTML = ''; S.current = null; S.curDetail = null;
  }

  /* ---------- 复制全部 ---------- */
  function buildAll() {
    var it = S.current; if (!it) return '';
    var d = S.curDetail;
    var L = [];
    if (d && (d.promptEn || d.promptCn)) {
      if (d.promptEn) L.push(d.promptEn);
      if (d.promptCn && d.promptCn !== d.promptEn) L.push('', '【中文提示词】' + d.promptCn);
      if (d.negativePrompt) L.push('', 'Negative prompt: ' + d.negativePrompt);
      var P = d.params || {}, ORDER = ['Steps', 'Sampler', 'Scheduler', 'CFG scale', 'Seed', 'Size', 'Model', 'LoRA', 'Denoise'];
      var meta = [];
      ORDER.forEach(function (k) { if (P[k]) meta.push(k + ': ' + P[k]); });
      if (!P['Size'] && it.width && it.height) meta.push('Size: ' + it.width + 'x' + it.height);
      if (meta.length) L.push('', meta.join(', '));
    } else {
      L.push('[提示词未获取到] 作品标题：' + ((it.title || '').trim() || '未命名'));
    }
    return L.join('\n');
  }
  function flash(btn) {
    var old = btn.textContent; btn.textContent = '已复制 ✓'; btn.classList.add('ok');
    setTimeout(function () { btn.textContent = old; btn.classList.remove('ok'); }, 1400);
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-copy]') : null;
    if (t) {
      var k = t.getAttribute('data-copy'), txt = '';
      if (k === 'prompt') txt = (el.prompt.classList.contains('empty') ? '' : el.prompt.textContent);
      else if (k === 'neg') txt = (el.neg.classList.contains('empty') ? '' : el.neg.textContent);
      else if (k === 'cn') { var cb = document.querySelector('#cnbox .pbox-b'); txt = cb ? cb.textContent : ''; }
      if (!txt || txt === '—') return;
      copyText(txt).then(function () { flash(t); }).catch(function () { flash(t); });
      return;
    }
    if (e.target.closest && e.target.closest('[data-close]')) closeDetail();
  });
  el.copyAll.addEventListener('click', function () { var txt = buildAll(); if (!txt) return; copyText(txt).then(function () { flash(el.copyAll); }).catch(function () { flash(el.copyAll); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !el.modal.hidden) closeDetail(); });
  el.seg.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]'); if (!b) return;
    [].forEach.call(el.seg.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
    b.classList.add('on'); S.mode = b.getAttribute('data-mode');
    el.params.innerHTML = ''; loadList(false);
  });
  function doSearch() { S.keyword = (el.kw.value || '').trim(); loadList(false); }
  el.kwbtn.addEventListener('click', doSearch);
  el.kw.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
  el.fSort.addEventListener('change', function () { S.sort = this.value; loadList(false); });
  el.fPrompt.addEventListener('change', function () { S.promptOnly = this.checked; loadList(false); });
  el.refresh.addEventListener('click', function () { loadList(false); });
  el.morebtn.addEventListener('click', function () { if (S.hasMore) { S.page++; loadList(true); } });
  var io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(function (ents) {
      if (ents[0].isIntersecting && S.hasMore && !S.loading) { S.page++; loadList(true); }
    }, { rootMargin: '500px' });
    io.observe(el.more);
  }
  loadList(false);
})();
