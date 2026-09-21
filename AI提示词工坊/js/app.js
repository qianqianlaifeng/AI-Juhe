/* ============================================================
   AI 提示词工坊 · 实时社区图库
   数据源：哩布哩布 LiblibAI 公开接口（匿名，无需登录 / API Key）
   - 列表：POST https://api2.liblib.art/api/www/img/group/search  （服务端反射 Origin，跨域可用）
   - 详情：GET  https://www.liblib.art/imageinfo/<uuid>            （提示词在服务端渲染的 HTML 里，
           浏览器跨域读不到，走公开只读代理中转）
   全程只读，不采集任何用户数据。
   ============================================================ */
(function () {
  'use strict';

  var API = 'https://api2.liblib.art';
  var LIST_URL = API + '/api/www/img/group/search';
  var COND_URL = API + '/api/www/public/search-cond2?type=2';
  var PAGE_SIZE = 24;

  /* 详情中转通道。
     实测：哩布哩布的提示词只存在于服务端渲染的 HTML 里，浏览器跨域读不到，
     必须借公开只读中转。免费中转会限流，所以这里做「轮换 + 熔断 + 粘性优选」：
     某个通道失败后冷却 90 秒，优先复用上次成功的通道。 */
  var RELAYS = [];
  (function initRelays() {
    /* 用户自建中转（可选）：填了就用它打头阵，最稳 */
    var custom = '';
    try { custom = (localStorage.getItem('pworkshop.relay') || '').trim(); } catch (e) { }
    if (custom) {
      if (custom.indexOf('{url}') >= 0) {
        RELAYS.push({ id: 'custom', mk: function (u) { return custom.replace('{url}', encodeURIComponent(u)); }, dead: 0, lastOK: Date.now() });
      } else {
        RELAYS.push({ id: 'custom', mk: function (u) { return custom + u; }, dead: 0, lastOK: Date.now() });
      }
    }
    RELAYS.push(
      { id: 'corseu', mk: function (u) { return 'https://cors.eu.org/' + u; }, dead: 0, lastOK: 0 },
      { id: 'allorigins', mk: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); }, dead: 0, lastOK: 0 },
      { id: 'codetabs', mk: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); }, dead: 0, lastOK: 0 }
    );
  })();
  var COOLDOWN = 90000;

  function relayOrder() {
    var now = Date.now(), live = [], dead = [];
    for (var i = 0; i < RELAYS.length; i++) {
      (RELAYS[i].dead > now ? dead : live).push(RELAYS[i]);
    }
    live.sort(function (a, b) { return b.lastOK - a.lastOK; });
    return live.concat(dead);   /* 冷却中的排最后兜底 */
  }

  var LS_KEY = 'pworkshop.detail.v1';

  /* ---------- 状态 ---------- */
  var S = {
    mode: 'image',
    keyword: '',
    model: '',
    source: '',
    sort: '0',
    promptOnly: true,   /* 默认只看向上公开了生成参数的作品，首屏体验更实在 */
    page: 1,
    hasMore: false,
    loading: false,
    items: [],
    seq: 0,
    current: null
  };

  var $ = function (s) { return document.querySelector(s); };
  var el = {
    kw: $('#kw'), kwbtn: $('#kwbtn'), seg: $('#seg'),
    fModel: $('#f-model'), fSource: $('#f-source'), fSort: $('#f-sort'), fPrompt: $('#f-prompt'),
    count: $('#count'), grid: $('#grid'), state: $('#state'),
    more: $('#more'), morebtn: $('#morebtn'), refresh: $('#refresh'),
    modal: $('#modal'), stage: $('#mv-stage'), mvmeta: $('#mv-meta'),
    title: $('#mi-title'), sub: $('#mi-sub'), params: $('#mi-params'),
    prompt: $('#p-prompt'), neg: $('#p-neg'), negWrap: $('#neg-wrap'),
    copyAll: $('#copy-all'), openOrigin: $('#open-origin'),
    load: $('#mi-load'), err: $('#mi-err')
  };

  /* ============================================================
     工具函数
     ============================================================ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 缩略图：走图床自带的 OSS 处理，400px webp 约为原图 1% 体积 */
  function thumb(url, w) {
    if (!url) return '';
    if (url.indexOf('?') >= 0) return url;
    if (!/liblib\.cloud\//.test(url)) return url;
    return url + '?x-oss-process=image/resize,w_' + (w || 520) + '/format,webp/quality,q_82';
  }

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

  /* 带完整超时的请求：超时覆盖「取头 + 读完响应体」全过程，
     避免代理只回响应头然后卡住导致永久挂起 */
  function fetchText(url, ms, init) {
    return new Promise(function (resolve, reject) {
      var ctl = new AbortController();
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { ctl.abort(); } catch (e) {}
        reject(new Error('timeout'));
      }, ms);

      var o = init || {};
      o.signal = ctl.signal;
      fetch(url, o)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (txt) {
          if (settled) return;
          settled = true; clearTimeout(timer); resolve(txt);
        })
        .catch(function (e) {
          if (settled) return;
          settled = true; clearTimeout(timer);
          reject(e && e.name === 'AbortError' ? new Error('请求超时') : e);
        });
    });
  }

  function fetchJSON(url, ms, init) {
    return fetchText(url, ms, init).then(function (t) { return JSON.parse(t); });
  }

  function copyText(txt) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(txt);
    }
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); res(); } catch (e) { rej(e); }
      document.body.removeChild(ta);
    });
  }

  /* ============================================================
     1) 列表接口
     ============================================================ */
  function buildBody() {
    var src = [];
    if (S.promptOnly) src = [1, 3];                    // WebUI + ComfyUI：实测这类作品基本都公开参数
    else if (S.source !== '') src = [parseInt(S.source, 10)];

    var b = {
      cid: '', requestId: '',
      page: S.page, pageSize: PAGE_SIZE,
      sort: S.sort === 'hot' ? 0 : parseInt(S.sort, 10),
      followed: 0, resolution: 0,
      types: S.model === '' ? [] : [parseInt(S.model, 10)],
      imageFuncs: [], createTools: [],
      imageSources: src,
      clientType: 'pc',
      tagV2Ids: [], liked: 0, imageCapability: [],
      mediaType: S.mode === 'video' ? 2 : 1
    };
    if (S.keyword) b.keyword = S.keyword;
    return b;
  }

  function loadList(append) {
    if (S.loading) return;
    S.loading = true;
    S.seq++;
    var mySeq = S.seq;
    if (!append) { S.page = 1; S.items = []; }

    el.morebtn.disabled = true;
    if (!append) {
      el.grid.innerHTML = '';
      showState('loading');
      el.count.textContent = '正在从社区拉取…';
    }

    fetchJSON(LIST_URL, 15000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(buildBody())
    })
      .then(function (j) {
        if (mySeq !== S.seq) return;
        if (!j || j.code !== 0 || !j.data || !j.data.data) {
          throw new Error('接口返回异常 code=' + (j && j.code));
        }
        var arr = j.data.data;
        S.hasMore = !!j.data.hasMore && arr.length > 0;
        S.items = S.items.concat(arr);
        if (S.sort === 'hot') {
          S.items = S.items.slice().sort(function (a, b) { return (b.likeCount || 0) - (a.likeCount || 0); });
          render();
        } else {
          appendCards(arr);
        }
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
        if (!S.items.length) {
          showState('error', e && e.name === 'AbortError' ? '请求超时，请检查网络后重试。' : '拉取社区数据失败：' + (e && e.message || e));
        }
        el.count.textContent = '加载失败';
      })
      .then(function () { S.loading = false; });
  }

  /* ============================================================
     2) 卡片渲染
     ============================================================ */
  /* 砌体网格：按图片真实宽高比预留高度，再算出行跨度 */
var ROW_STEP = 18;   /* grid-auto-rows 2px + gap 16px */

function aspectOf(it) {
  var iw = it.width || 1, ih = it.height || 1;
  if (!(iw > 0) || !(ih > 0)) return '3/4';
  /* 极端长图裁一刀，避免单卡高得离谱 */
  if (ih / iw > 2) return '1/2';
  if (iw / ih > 2.4) return '2.4/1';
  return iw + '/' + ih;
}

function layoutCards(scope) {
  var cards = (scope || el.grid).querySelectorAll('.card');
  [].forEach.call(cards, function (c) {
    var box = c.querySelector('.card-img');
    var info = c.querySelector('.card-info');
    if (!box || !info) return;
    var h = box.getBoundingClientRect().height + info.offsetHeight;
    if (!(h > 0)) return;
    c.style.gridRowEnd = 'span ' + Math.max(1, Math.ceil((h + 16) / ROW_STEP));
  });
}

function cardHtml(it, idx) {
    var isV = S.mode === 'video' || it.mediaType === 2;
    var cover = it.imageUrl || it.webpUrl || '';
    var t = thumb(cover, 520);
    var title = (it.title || '').trim();
    if (!title) title = '未命名作品';
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
      if (c.__b) return;
      c.__b = 1;
      var img = c.querySelector('img');
      if (img) {
        var ph = c.querySelector('.ph');
        var done = function () { if (ph) ph.remove(); };
        if (img.complete && img.naturalWidth) done();
        img.addEventListener('load', done);
        img.addEventListener('error', function () {
          if (ph) ph.remove();
          img.style.display = 'none';
        });
      }
      c.addEventListener('click', function () {
        var it = S.items[parseInt(c.getAttribute('data-i'), 10)];
        if (it) openDetail(it);
      });
      /* 鼠标悬停就悄悄预取提示词：等你点开时通常已经好了 */
      c.addEventListener('mouseenter', function () {
        var it = S.items[parseInt(c.getAttribute('data-i'), 10)];
        if (it) prefetch(it.uuid);
      });
    });
  }

  function appendCards(arr) {
    var base = S.items.length - arr.length;
    var buf = '';
    for (var i = 0; i < arr.length; i++) buf += cardHtml(arr[i], base + i);
    var tmp = document.createElement('div');
    tmp.innerHTML = buf;
    var frag = document.createDocumentFragment();
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    el.grid.appendChild(frag);
    layoutCards(el.grid);
    bindCard(el.grid);
  }

  function render() {
    el.grid.innerHTML = '';
    var buf = '';
    for (var i = 0; i < S.items.length; i++) buf += cardHtml(S.items[i], i);
    el.grid.innerHTML = buf;
    layoutCards(el.grid);
    bindCard(el.grid);
  }

  /* 窗口尺寸变化：列宽变了，行跨度要重算 */
  var rzT = null;
  window.addEventListener('resize', function () {
    clearTimeout(rzT);
    rzT = setTimeout(function () { layoutCards(el.grid); }, 180);
  });

  function showState(kind, msg) {
    el.state.hidden = false;
    if (kind === 'loading') {
      el.state.innerHTML = '<div class="spin" style="width:26px;height:26px;border-width:3px;margin:4px auto 14px"></div>正在连接哩布哩布社区…';
    } else if (kind === 'error') {
      el.state.innerHTML = '<div class="big">📡</div><div>' + esc(msg) + '</div>' +
        '<button type="button" id="retry">重试</button>';
      var b = $('#retry');
      if (b) b.addEventListener('click', function () { loadList(false); });
    } else if (kind === 'empty') {
      el.state.innerHTML = '<div class="big">🔍</div><div>' + esc(msg || '没有找到匹配的作品，换个关键词试试～') + '</div>';
    }
  }
  function hideState() {
    if (!S.items.length) { showState('empty'); return; }
    el.state.hidden = true;
  }

  /* ============================================================
     3) 详情：抓取 + 提取提示词
     ============================================================ */

  /* 从详情页 HTML 里抠出提示词对象：
     定位 "prompt" → 向左找最近的 { → 花括号配平（跳过字符串）→ 切出完整 JSON */
  function extractFromHtml(html) {
    var a = html.indexOf('"prompt"');
    if (a < 0) return null;
    var s = -1, i;
    for (i = a; i >= 0; i--) { if (html.charAt(i) === '{') { s = i; break; } }
    if (s < 0) return null;

    var d = 0, inStr = false, escp = false, e = -1;
    for (i = s; i < html.length && i < s + 300000; i++) {
      var c = html.charAt(i);
      if (inStr) {
        if (escp) escp = false;
        else if (c === '\\') escp = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) { e = i + 1; break; } }
    }
    if (e < 0) return null;
    try { return JSON.parse(html.slice(s, e)); } catch (err) { return null; }
  }

  /* 详情页正文里兜底再抠一次（页面结构变化时用） */
  function extractByRegex(html) {
    function g(k) {
      var re = new RegExp('"' + k + '":"((?:[^"\\\\]|\\\\.)*)"');
      var m = html.match(re);
      if (!m) return null;
      try { return JSON.parse('"' + m[1] + '"'); } catch (e) { return m[1]; }
    }
    var o = { prompt: g('prompt'), negativePrompt: g('negativePrompt'), promptCn: g('promptCn') };
    return o.prompt ? o : null;
  }

  function detailUrl(uuid) { return 'https://www.liblib.art/imageinfo/' + uuid; }

  /* localStorage 里存一份提示词缓存；内存里再留一份，避免每张卡都去 JSON.parse */
  var CMAP = null;
  function loadCache() {
    if (CMAP) return CMAP;
    try { CMAP = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { CMAP = {}; }
    if (!CMAP || typeof CMAP !== 'object') CMAP = {};
    return CMAP;
  }
  function cacheGet(uuid) {
    var m = loadCache();
    return m[uuid] || null;
  }
  function cacheSet(uuid, data) {
    var m = loadCache();
    m[uuid] = data;
    try {
      var keys = Object.keys(m);
      if (keys.length > 400) { keys.slice(0, 120).forEach(function (k) { delete m[k]; }); }
      localStorage.setItem(LS_KEY, JSON.stringify(m));
    } catch (e) { /* 隐私模式 / 配额满：忽略，内存里仍有 */ }
  }

  /* 已经拿到提示词的卡片打标，方便用户挑「有料」的看 */
  function markReady(uuid) {
    var cards = el.grid.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var it = S.items[parseInt(cards[i].getAttribute('data-i'), 10)];
      if (it && it.uuid === uuid) cards[i].classList.add('has-p');
    }
  }

  /* 对冲式抓取：先起最快的通道，4 秒没结果就并行再起一个，
     谁先成功用谁 —— 免费通道单条不稳，这样整体成功率最高、等待最短。 */
  function fetchDetail(uuid) {
    var hit = cacheGet(uuid);
    if (hit) return Promise.resolve(hit);

    var order = relayOrder();
    var HEDGE = 4000, HARD = 26000;

    return new Promise(function (resolve, reject) {
      var settled = false;
      var launched = 0, failed = 0;
      var total = order.length;
      var hardT = setTimeout(function () {
        if (!settled) { settled = true; reject(new Error('请求超时，请重试')); }
      }, HARD);

      function done(o) {
        if (settled) return;
        settled = true; clearTimeout(hardT); resolve(o);
      }
      function failedOne(msg) {
        console.warn('[提示词] 通道失败:', msg);
        failed++;
        if (!settled && failed >= total) {
          settled = true; clearTimeout(hardT);
          reject(new Error('所有中转通道都不可用（免费通道可能被限流，稍后再试）'));
        }
      }
      function launchNext() {
        if (settled || launched >= total) return;
        var relay = order[launched++];
        fetchText(relay.mk(detailUrl(uuid)), 16000, { headers: { 'Accept': 'text/html,*/*' } })
          .then(function (html) {
            if (!html || html.length < 2000) throw new Error(relay.id + ': 返回内容过短');
            var o = extractFromHtml(html);
            if (!o || (!o.prompt && !o.promptCn)) o = extractByRegex(html) || o;
            if (!o) throw new Error(relay.id + ': 未找到生成信息');
            relay.lastOK = Date.now();
            done(o);
          })
          .catch(function (e) {
            relay.dead = Date.now() + COOLDOWN;
            failedOne(relay.id + ' -> ' + ((e && e.message) || e));
            launchNext();
          });
        setTimeout(function () { if (!settled) launchNext(); }, HEDGE);
      }
      launchNext();
    }).then(function (o) {
      var d = {
        prompt: o.prompt || o.promptCn || '',
        promptEn: o.prompt || '',
        promptCn: o.promptCn || '',
        negativePrompt: o.negativePrompt || o.negativePromptCn || '',
        metainformation: o.metainformation || '',
        samplingMethod: o.samplingMethod || '',
        samplingStep: o.samplingStep || '',
        cfgScale: o.cfgScale || '',
        seed: o.seed || '',
        modelName: o.modelName || ''
      };
      cacheSet(uuid, d);
      markReady(uuid);
      return d;
    });
  }

  /* 同一个作品的详情只请求一次（点击 / 悬停预取共用） */
  var inflight = {};
  function getDetail(uuid) {
    if (inflight[uuid]) return inflight[uuid];
    var p = fetchDetail(uuid);
    inflight[uuid] = p;
    p.catch(function () { }).then(function () { delete inflight[uuid]; });
    return p;
  }

  /* 悬停预取队列：一次只跑一个，间隔 400ms，避免把免费中转打限流 */
  var PQ = [], qBusy = false;
  function prefetch(uuid) {
    if (!uuid || cacheGet(uuid) || inflight[uuid]) return;
    if (PQ.indexOf(uuid) >= 0 || PQ.length > 5) return;
    PQ.push(uuid);
    runPQ();
  }
  function runPQ() {
    if (qBusy) return;
    var u = PQ.shift();
    if (!u) return;
    qBusy = true;
    getDetail(u).catch(function () { }).then(function () {
      setTimeout(function () { qBusy = false; runPQ(); }, 400);
    });
  }

  /* ============================================================
     4) 详情弹层
     ============================================================ */
  function openDetail(it) {
    S.current = it;
    S.curDetail = null;
    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    el.err.hidden = true;
    el.err.innerHTML = '';
    el.negWrap.hidden = false;

    var isV = it.mediaType === 2 || S.mode === 'video';

    /* 媒体区 */
    if (isV && it.videoUrl) {
      el.stage.innerHTML = '<video src="' + esc(it.videoUrl) + '" controls playsinline preload="metadata" ' +
        (it.imageUrl ? 'poster="' + esc(it.imageUrl) + '"' : '') + '></video>';
    } else {
      el.stage.innerHTML = '<img src="' + esc(it.imageUrl || it.videoUrl) + '" alt="' + esc(it.title || '') + '">';
    }
    var dim = (it.width && it.height) ? (it.width + ' × ' + it.height) : '';
    el.mvmeta.textContent = [dim, timeAgo(it.createTime)].filter(Boolean).join(' · ');

    /* 信息区 */
    el.title.textContent = (it.title || '').trim() || '未命名作品';
    el.sub.innerHTML =
      (it.avatar ? '<img src="' + esc(thumb(it.avatar, 64)) + '" alt="">' : '') +
      '<span>' + esc(it.nickname || '匿名') + '</span>' +
      '<span>❤ ' + (it.likeCount || 0) + '</span>' +
      (isV ? '<span>🎬 视频</span>' : '<span>🖼️ 图片</span>');

    el.params.innerHTML = '';
    el.prompt.textContent = '—';
    el.prompt.classList.add('empty');
    el.neg.textContent = '—';
    el.neg.classList.add('empty');
    el.load.hidden = false;

    /* 复制全部 / 原页 先挂好 */
    el.openOrigin.href = detailUrl(it.uuid);

    function paint(d) {
      el.load.hidden = true;
      var tags = [];
      if (d.modelName) tags.push(['模型', d.modelName]);
      if (d.samplingMethod) tags.push(['采样器', d.samplingMethod]);
      if (d.samplingStep) tags.push(['步数', d.samplingStep]);
      if (d.cfgScale) tags.push(['CFG', d.cfgScale]);
      if (d.seed) tags.push(['种子', d.seed]);
      el.params.innerHTML = tags.map(function (t, i) {
        return '<span class="ptag' + (i % 2 ? ' p' : '') + '">' + esc(t[0]) + ' · ' + esc(t[1]) + '</span>';
      }).join('');

      var p = d.promptEn || d.prompt || d.promptCn || '';
      var n = d.negativePrompt || '';
      if (p) { el.prompt.textContent = p; el.prompt.classList.remove('empty'); }
      else { el.prompt.textContent = '这位作者没有公开提示词（社区里作者可自行选择是否公开）。'; el.prompt.classList.add('empty'); }
      if (n) { el.neg.textContent = n; el.neg.classList.remove('empty'); el.negWrap.hidden = false; }
      else { el.negWrap.hidden = true; }

      /* 中文提示词单独展示 */
      if (d.promptCn && d.promptEn && d.promptCn !== d.promptEn) {
        var old = document.getElementById('cnbox');
        if (old) old.remove();
        var box = document.createElement('section');
        box.className = 'pbox';
        box.id = 'cnbox';
        box.innerHTML = '<div class="pbox-h"><span>中文提示词</span>' +
          '<button class="copy" data-copy="cn" type="button">复制</button></div>' +
          '<div class="pbox-b">' + esc(d.promptCn) + '</div>';
        el.negWrap.parentNode.insertBefore(box, el.negWrap);
      }
    }

    function fail(msg) {
      el.load.hidden = true;
      el.err.hidden = false;
      el.err.innerHTML = esc(msg) + '<br><button type="button" id="dretry">重新获取</button>';
      var b = document.getElementById('dretry');
      if (b) b.addEventListener('click', function () { start(); });
      /* 详情失败也给一个可用的提示词（不阻塞浏览） */
      el.prompt.textContent = '提示词获取失败，可直接点右下「打开原作品页」查看。';
      el.prompt.classList.add('empty');
    }

    function start() {
      el.err.hidden = true;
      el.load.hidden = false;
      getDetail(it.uuid).then(function (d) {
        if (S.current !== it) return;
        S.curDetail = d;
        paint(d);
      }).catch(function (e) {
        if (S.current !== it) return;
        fail('提示词没取到：' + ((e && e.message) || e) +
          '。可以点下面「重新获取」，或直接「打开原作品页」查看；想彻底稳定可在页面底部配置自建中转。');
      });
    }

    var cnOld = document.getElementById('cnbox');
    if (cnOld) cnOld.remove();
    start();
  }

  function closeDetail() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
    el.stage.innerHTML = '';
    S.current = null;
    S.curDetail = null;
  }

  /* 组装「复制全部」文本 */
  function buildAll() {
    var it = S.current, d = S.curDetail;
    if (!it) return '';
    var L = [];
    if (d) {
      if (d.promptEn) L.push(d.promptEn);
      else if (d.promptCn) L.push(d.promptCn);
      if (d.promptCn && d.promptEn && d.promptCn !== d.promptEn) {
        L.push('', '【中文提示词】' + d.promptCn);
      }
      if (d.negativePrompt) L.push('', 'Negative prompt: ' + d.negativePrompt);
      var meta = [];
      if (d.samplingStep) meta.push('Steps: ' + d.samplingStep);
      if (d.samplingMethod) meta.push('Sampler: ' + d.samplingMethod);
      if (d.cfgScale) meta.push('CFG scale: ' + d.cfgScale);
      if (d.seed) meta.push('Seed: ' + d.seed);
      if (it.width && it.height) meta.push('Size: ' + it.width + 'x' + it.height);
      if (d.modelName) meta.push('Model: ' + d.modelName);
      if (meta.length) L.push('', meta.join(', '));
    } else {
      L.push('[提示词未获取到] 作品标题：' + ((it.title || '').trim() || '未命名'));
    }
    L.push('', '—— 来源：哩布哩布 LiblibAI · ' + detailUrl(it.uuid));
    return L.join('\n');
  }

  /* ============================================================
     5) 事件绑定
     ============================================================ */
  function flash(btn) {
    var old = btn.textContent;
    btn.textContent = '已复制 ✓';
    btn.classList.add('ok');
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

  el.copyAll.addEventListener('click', function () {
    var txt = buildAll();
    if (!txt) return;
    copyText(txt).then(function () { flash(el.copyAll); }).catch(function () { flash(el.copyAll); });
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !el.modal.hidden) closeDetail(); });

  /* 类型切换 */
  el.seg.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]');
    if (!b) return;
    [].forEach.call(el.seg.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    S.mode = b.getAttribute('data-mode');
    el.params.innerHTML = '';
    if (S.mode === 'video') { el.fModel.value = ''; S.model = ''; }
    loadList(false);
  });

  /* 搜索 */
  function doSearch() {
    S.keyword = (el.kw.value || '').trim();
    loadList(false);
  }
  el.kwbtn.addEventListener('click', doSearch);
  el.kw.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });

  /* 筛选 */
  el.fModel.addEventListener('change', function () { S.model = this.value; loadList(false); });
  el.fSource.addEventListener('change', function () { S.source = this.value; loadList(false); });
  el.fSort.addEventListener('change', function () { S.sort = this.value; loadList(false); });
  el.fPrompt.addEventListener('change', function () { S.promptOnly = this.checked; loadList(false); });
  el.refresh.addEventListener('click', function () { loadList(false); });
  el.morebtn.addEventListener('click', function () { if (S.hasMore) { S.page++; loadList(true); } });

  /* 滚动自动加载 */
  var io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(function (ents) {
      if (ents[0].isIntersecting && S.hasMore && !S.loading) { S.page++; loadList(true); }
    }, { rootMargin: '500px' });
    io.observe(el.more);
  }

  /* ============================================================
     6) 模型下拉（实时从站点筛选配置取，失败用内置兜底）
     ============================================================ */
  var FALLBACK = {
    image: [['30', 'Seedream'], ['55', 'Seedream 4.5'], ['37', 'Qwen-Image'], ['40', '全能图片模型'], ['53', 'Z-Image'], ['11', 'Kolors']],
    video: [['32', '可灵'], ['33', 'Seedance'], ['38', '海螺'], ['34', 'Vidu'], ['56', '通义万相 2.6'], ['44', '通义万相 2.5'], ['24', '混元视频'], ['36', 'LTX-Video']]
  };

  function fillModels(list) {
    var arr = list && list.length ? list : FALLBACK[S.mode];
    var h = '<option value="">全部模型</option>';
    for (var i = 0; i < arr.length && i < 40; i++) {
      h += '<option value="' + esc(arr[i][0]) + '">' + esc(arr[i][1]) + '</option>';
    }
    el.fModel.innerHTML = h;
    el.fModel.value = S.model;
  }

  fetchJSON(COND_URL, 10000, { headers: { 'Accept': 'application/json' } })
    .then(function (j) {
      var d = (j && j.data) || {};
      window.__cond = d;
      var src = (S.mode === 'video' ? d.VIDEO_TYPE_LIST : d.TYPE_LIST) || [];
      fillModels(src.map(function (x) { return [String(x.id), x.name]; }));
    })
    .catch(function () { fillModels(null); });

  /* 启动 */
  loadList(false);

  /* ============================================================
     7) 进阶设置：自建中转
     ============================================================ */
  var WORKER_CODE = [
    'export default {',
    '  async fetch(request) {',
    '    const u = new URL(request.url).searchParams.get("u");',
    '    if (!u) return new Response("usage: ?u=<url>", { status: 400 });',
    '    const r = await fetch(u, {',
    '      headers: {',
    '        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",',
    '        "Referer": "https://www.liblib.art/"',
    '      }',
    '    });',
    '    const body = await r.text();',
    '    return new Response(body, {',
    '      headers: {',
    '        "content-type": r.headers.get("content-type") || "text/html; charset=utf-8",',
    '        "access-control-allow-origin": "*"',
    '      }',
    '    });',
    '  }',
    '};'
  ].join('\n');

  (function initRelayUI() {
    var code = document.getElementById('worker-code');
    var inp = document.getElementById('relay-in');
    var save = document.getElementById('relay-save');
    var clr = document.getElementById('relay-clear');
    var msg = document.getElementById('relay-msg');
    var cpw = document.getElementById('copy-worker');
    if (!code || !inp) return;

    code.textContent = WORKER_CODE;
    try { inp.value = localStorage.getItem('pworkshop.relay') || ''; } catch (e) { }

    cpw.addEventListener('click', function () { copyText(WORKER_CODE).then(function () { flash(cpw); }); });
    save.addEventListener('click', function () {
      var v = (inp.value || '').trim();
      try { v ? localStorage.setItem('pworkshop.relay', v) : localStorage.removeItem('pworkshop.relay'); } catch (e) { }
      msg.textContent = v ? '已保存，刷新页面后生效 ✓' : '已清空，将使用默认公开中转';
      setTimeout(function () { msg.textContent = ''; }, 5000);
    });
    clr.addEventListener('click', function () {
      inp.value = '';
      try { localStorage.removeItem('pworkshop.relay'); } catch (e) { }
      msg.textContent = '已清空，刷新页面后生效';
      setTimeout(function () { msg.textContent = ''; }, 5000);
    });
  })();
})();
