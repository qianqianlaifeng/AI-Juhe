/* ============================================================
   AI 提示词工坊 · 实时社区图库
   数据源：公开社区接口（匿名，无需登录 / API Key）
   - 列表：POST https://api2.liblib.art/api/www/img/group/search
           （服务端反射任意 Origin，浏览器原生跨域可用，无需中转）
   - 提示词（主路径 · 免中转 · 零第三方）：
           AI 出图的 PNG 会把生成参数写进 tEXt/iTXt 块（key: parameters / prompt / workflow），
           图床 liblibai-online.liblib.cloud 带 Access-Control-Allow-Origin:*，
           所以浏览器可以直接取原图（只取前 192KB，参数块都在 IDAT 之前）+ 本地解析 → 拿到提示词。
           实测「只看带生成参数」的作品命中率约 88%，单张解析约 0.1~0.2 秒。
   - 提示词（兜底路径）：GET https://www.liblib.art/imageinfo/<uuid>
           视频作品封面被剥离了元数据，只能读服务端渲染的 HTML（无 CORS），
           走公开只读代理中转。中转会限流，故做「轮换 + 熔断 + 粘性优选 + 对冲并发」。
   全程只读，不采集任何用户数据。
   ============================================================ */
(function () {
  'use strict';

  var API = 'https://api2.liblib.art';
  var LIST_URL = API + '/api/www/img/group/search';
  var COND_URL = API + '/api/www/public/search-cond2?type=2';
  var PAGE_SIZE = 24;

  /* 详情中转通道。
     实测：社区提示词只存在于服务端渲染的 HTML 里，浏览器跨域读不到，
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
      { id: 'codetabs', mk: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); }, dead: 0, lastOK: 0 },
      { id: 'bridged', mk: function (u) { return 'https://cors.bridged.cc/' + u; }, dead: 0, lastOK: 0 }
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
    title: $('#mi-title'), sub: $('#mi-sub'), params: $('#mi-params'), src: $('#mi-src'),
    prompt: $('#p-prompt'), neg: $('#p-neg'), negWrap: $('#neg-wrap'),
    copyAll: $('#copy-all'), openRaw: $('#open-raw'),
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
  function fetchText(url, ms, init, onCtl) {
    return new Promise(function (resolve, reject) {
      var ctl = new AbortController();
      var settled = false;
      if (onCtl) { try { onCtl(ctl); } catch (e) { } }
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
      /* 鼠标悬停就悄悄预取提示词：等你点开时通常已经好了（图片走内嵌参数，很快） */
      c.addEventListener('mouseenter', function () {
        var it = S.items[parseInt(c.getAttribute('data-i'), 10)];
        if (it) prefetch(it);
      });
      /* 卡片快进入视口就预取：实测单张约 0.15 秒，滚到哪儿哪儿就是现成的 */
      if (window.IntersectionObserver) {
        if (!ioCard) {
          ioCard = new IntersectionObserver(function (ents) {
            ents.forEach(function (en) {
              if (!en.isIntersecting) return;
              var card = en.target;
              ioCard.unobserve(card);
              var it = S.items[parseInt(card.getAttribute('data-i'), 10)];
              /* 只对图片自动预取（读内嵌参数，又快又免中转）；
                 视频要过中转，留给悬停/点击 */
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
      el.state.innerHTML = '<div class="spin" style="width:26px;height:26px;border-width:3px;margin:4px auto 14px"></div>正在连接社区…';
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
     2.5) 主路径：直接读「原图内嵌生成参数」（免中转 · 零第三方依赖）
     ============================================================ */
  var META_MAX = 196608;   /* 先取前 192KB：参数块都排在 IDAT 之前，够用又省流量 */

  function binToStr(u8) {
    var s = '', CH = 8192;
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return s;
  }
  function utf8Decode(u8) {
    try { return new TextDecoder('utf-8').decode(u8); } catch (e) { return binToStr(u8); }
  }

  /* 遍历 PNG 块，把 tEXt / iTXt 里的 key→text 全取出来（遇到 IDAT 就停） */
  function pngText(buf) {
    var u8 = new Uint8Array(buf);
    var SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    if (u8.length < 16) return null;
    for (var i = 0; i < 8; i++) if (u8[i] !== SIG[i]) return null;
    var dv = new DataView(buf), out = {}, off = 8;
    while (off + 8 <= u8.length) {
      var len = dv.getUint32(off);
      if (len > 0x4000000) break;
      var type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
      var ds = off + 8;
      if (ds + len > u8.length) break;                  /* 分片被截断，参数块没读全 */
      var d = u8.subarray(ds, ds + len);
      if (type === 'tEXt') {
        var z = d.indexOf(0);
        if (z > 0) out[binToStr(d.subarray(0, z))] = binToStr(d.subarray(z + 1));
      } else if (type === 'iTXt') {
        var z1 = d.indexOf(0);
        if (z1 > 0) {
          var key = binToStr(d.subarray(0, z1));
          var compFlag = d[z1 + 1];
          var r1 = d.subarray(z1 + 3);
          var z2 = r1.indexOf(0);
          var r2 = r1.subarray(z2 + 1);
          var z3 = r2.indexOf(0);
          out[key] = compFlag === 0 ? utf8Decode(r2.subarray(z3 + 1)) : '';
        }
      } else if (type === 'zTXt') {
        var zk = d.indexOf(0);
        if (zk > 0) out[binToStr(d.subarray(0, zk))] = '';
      }
      if (type === 'IDAT' || type === 'IEND') break;
      off = ds + len + 4;
    }
    return out;
  }

  /* JPEG / WebP 兜底：直接在字节里找特征串（A1111 会写 EXIF UserComment） */
  function scanRaw(buf) {
    var u8 = new Uint8Array(buf), list = [];
    try { list.push(new TextDecoder('utf-8').decode(u8)); } catch (e) { }
    try { list.push(binToStr(u8)); } catch (e) { }
    try { list.push(new TextDecoder('utf-16le').decode(u8)); } catch (e) { }
    for (var v = 0; v < list.length; v++) {
      var t = list[v], i = t.indexOf('Negative prompt:');
      if (i < 0) i = t.indexOf('negative prompt:');
      if (i >= 0) return { text: t.slice(Math.max(0, i - 1800), i + 1200), offset: i };
    }
    return null;
  }

  function parseKV(tail) {
    var o = {};
    String(tail || '').split(',').forEach(function (kv) {
      var i = kv.indexOf(':');
      if (i <= 0) return;
      var k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (k && v && k.length < 32) o[k] = v.replace(/^["']|["']$/g, '');
    });
    return o;
  }

  /* Automatic1111 / Forge / SD.Next 的 parameters 串 */
  function parseA1111(str) {
    var pos = String(str), neg = '', tail = '';
    var m = pos.indexOf('Negative prompt:');
    if (m >= 0) {
      var rest = pos.slice(m + 16);
      pos = pos.slice(0, m);
      var nl = rest.indexOf('\n');
      if (nl >= 0) { neg = rest.slice(0, nl); tail = rest.slice(nl + 1); }
      else neg = rest;
    } else {
      var ls = String(str).split('\n'), pi = -1;
      for (var i = 1; i < ls.length; i++) {
        if (/^\s*(Steps|Sampler|CFG scale|Model)\s*:/i.test(ls[i])) { pi = i; break; }
      }
      if (pi > 0) { pos = ls.slice(0, pi).join('\n'); tail = ls.slice(pi).join('\n'); }
    }
    return { prompt: pos.trim(), negative: neg.trim(), params: parseKV(tail) };
  }

  /* ComfyUI 的 prompt 图（API 格式 JSON） */
  function parseComfy(jsonStr) {
    var g;
    try { g = JSON.parse(jsonStr); } catch (e) { return null; }
    if (!g || typeof g !== 'object' || Array.isArray(g)) return null;

    function textOf(id) {
      var n = g[id];
      if (!n) return '';
      var t = (n.inputs || {}).text;
      if (typeof t === 'string') return t;
      if (Object.prototype.toString.call(t) === '[object Array]' && t.length) return textOf(String(t[0]));
      return '';
    }
    var pos = '', neg = '', params = {};
    Object.keys(g).forEach(function (k) {
      var n = g[k] || {}, ct = n.class_type || '', inp = n.inputs || {};
      if (/KSampler|SamplerCustom/i.test(ct)) {
        if (!pos && inp.positive && inp.positive[0] != null) pos = textOf(String(inp.positive[0]));
        if (!neg && inp.negative && inp.negative[0] != null) neg = textOf(String(inp.negative[0]));
        if (inp.steps != null && !params['Steps']) params['Steps'] = String(inp.steps);
        if (inp.cfg != null && !params['CFG scale']) params['CFG scale'] = String(inp.cfg);
        if (inp.sampler_name && !params['Sampler']) params['Sampler'] = String(inp.sampler_name);
        if (inp.scheduler && !params['Scheduler']) params['Scheduler'] = String(inp.scheduler);
        if (inp.seed != null && !params['Seed']) params['Seed'] = String(inp.seed);
        if (inp.denoise != null && !params['Denoise']) params['Denoise'] = String(inp.denoise);
      }
      if (/CheckpointLoader/i.test(ct) && inp.ckpt_name && !params['Model']) params['Model'] = String(inp.ckpt_name);
      if (/UNETLoader/i.test(ct) && inp.unet_name && !params['Model']) params['Model'] = String(inp.unet_name);
      if (/LoraLoader/i.test(ct) && inp.lora_name) {
        params['LoRA'] = (params['LoRA'] ? params['LoRA'] + ', ' : '') + String(inp.lora_name);
      }
    });
    if (!pos) {
      var all = [];
      Object.keys(g).forEach(function (k) {
        var n = g[k] || {}, ct = n.class_type || '', t = (n.inputs || {}).text;
        if (typeof t === 'string' && t.trim() && /CLIPTextEncode|TextEncode|Prompt|CLIPLoader/i.test(ct)) all.push(t.trim());
      });
      all.sort(function (a, b) { return b.length - a.length; });
      if (all.length) pos = all[0];
      if (all.length > 1 && !neg) neg = all[all.length - 1];
    }
    if (!pos) return null;
    return { prompt: pos, negative: neg, params: params };
  }

  /* 把 PNG 元数据字典统一成 {prompt, negative, params} */
  function metaToDetail(meta) {
    if (!meta) return null;
    var raw = meta['parameters'] || meta['Parameters'] || meta['Comment'] || '';
    var pj = meta['prompt'] || meta['Prompt'] || '';
    var wf = meta['workflow'] || '';
    var r = null;
    if (raw && raw.trim().charAt(0) === '{') r = parseComfy(raw);
    if (!r && raw) r = parseA1111(raw);
    if ((!r || !r.prompt) && pj && pj.trim().charAt(0) === '{') r = parseComfy(pj) || r;
    if ((!r || !r.prompt) && wf && wf.trim().charAt(0) === '{') r = parseComfy(wf) || r;
    return (r && r.prompt) ? r : null;
  }

  /* 取原图 → 解析元数据。整条链（含读完响应体）都在超时保护内 */
  function readImageMeta(item) {
    var url = (item && (item.imageUrl || item.webpUrl)) || '';
    if (!url) return Promise.resolve(null);
    var orig = url.split('?')[0];
    var HARD = 9000;

    function pull(useRange, ms) {
      return new Promise(function (resolve, reject) {
        var ctl = new AbortController(), settled = false;
        var timer = setTimeout(function () {
          if (settled) return; settled = true;
          try { ctl.abort(); } catch (e) { }
          reject(new Error('timeout'));
        }, ms);
        var init = { signal: ctl.signal, cache: 'force-cache' };
        if (useRange) init.headers = { 'Range': 'bytes=0-' + (META_MAX - 1) };
        fetch(orig, init)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
          })
          .then(function (b) {
            if (settled) return; settled = true; clearTimeout(timer); resolve(b);
          })
          .catch(function (e) {
            if (settled) return; settled = true; clearTimeout(timer); reject(e);
          });
      });
    }

    function parse(buf) {
      if (!buf || buf.byteLength < 100) return null;
      var u8 = new Uint8Array(buf);
      var isPng = u8[0] === 0x89 && u8[1] === 0x50;
      var meta = isPng ? pngText(buf) : null;
      var r = metaToDetail(meta);
      if (r) return { r: r, via: 'png' };
      var s = scanRaw(buf);
      if (s) {
        var r2 = parseA1111(s.text);
        if (r2 && r2.prompt) return { r: r2, via: 'scan' };
      }
      var keys = meta ? Object.keys(meta) : [];
      return { r: null, via: isPng ? 'png' : 'scan', keys: keys, png: isPng, buf: buf.byteLength };
    }

    return pull(true, HARD).then(function (buf) {
      var o = parse(buf);
      if (o.r) { o.src = 'meta'; return o; }
      /* PNG 但被截断了（参数块没读全）→ 全量再拉一次 */
      if (o.png && metaMissing(o.keys)) {
        return pull(false, HARD).then(function (buf2) {
          var o2 = parse(buf2);
          if (o2.r) { o2.src = 'meta'; return o2; }
          return { r: null, src: 'meta', reason: 'no-params', keys: o2.keys };
        });
      }
      return { r: null, src: 'meta', reason: 'no-params', keys: o.keys };
    }).catch(function (e) {
      return { r: null, src: 'meta', reason: (e && e.message) || 'err' };
    });
  }
  function metaMissing(keys) {
    for (var i = 0; i < keys.length; i++) {
      if (/^(parameters|Parameters|prompt|Prompt|workflow|Comment)$/.test(keys[i])) return false;
    }
    return true;
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

  /* 兜底路径：所有中转通道「同时」并行发起，谁先成功用谁（竞速）。
     免费通道单条不稳、常被限流，并行竞速把整体成功率拉满、等待最短。 */
  function fetchDetailByRelay(uuid, budget) {
    var HARD = budget || 24000;
    var PER = HARD > 15000 ? 14000 : 13000;      /* 每个通道单独超时；并行竞速下给足余量 */
    var order = relayOrder();

    return new Promise(function (resolve, reject) {
      var settled = false;
      var launched = 0, failed = 0;
      var total = order.length;
      var ctls = [];
      function killRest() {
        /* 已拿到结果：把还在跑的落败通道掐掉，避免留下无意义的超时噪声 */
        ctls.forEach(function (c) { try { c.abort(); } catch (e) { } });
        ctls = [];
      }
      var hardT = setTimeout(function () {
        if (!settled) { settled = true; killRest(); reject(new Error('请求超时，请重试')); }
      }, HARD);

      function done(o) {
        if (settled) return;
        settled = true; clearTimeout(hardT); killRest(); resolve(o);
      }
      function failedOne(msg) {
        console.warn('[提示词] 通道失败:', msg);
        failed++;
        if (!settled && failed >= total) {
          settled = true; clearTimeout(hardT); killRest();
          reject(new Error('所有中转通道都不可用（免费通道可能被限流，稍后再试）'));
        }
      }
      order.forEach(function (relay) {
        fetchText(relay.mk(detailUrl(uuid)), PER, { headers: { 'Accept': 'text/html,*/*' } },
          function (c) { ctls.push(c); })
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
          });
      });
    }).then(function (o) {
      return {
        src: 'relay',
        promptEn: o.prompt || '',
        promptCn: o.promptCn || '',
        negativePrompt: o.negativePrompt || o.negativePromptCn || '',
        params: relayParams(o)
      };
    });
  }

  function relayParams(o) {
    var p = {};
    if (o.modelName) p['Model'] = o.modelName;
    if (o.samplingMethod) p['Sampler'] = o.samplingMethod;
    if (o.samplingStep) p['Steps'] = o.samplingStep;
    if (o.cfgScale) p['CFG scale'] = o.cfgScale;
    if (o.seed) p['Seed'] = o.seed;
    return p;
  }

  /* ------------------------------------------------------------
     统一入口：图片先读原图内嵌参数（免中转），拿不到再走中转；
     视频封面被剥离元数据，直接走中转。
     ------------------------------------------------------------ */
  function fetchDetail(item) {
    var isObj = item && typeof item === 'object';
    var uuid = isObj ? item.uuid : item;
    var hit = cacheGet(uuid);
    if (hit) return Promise.resolve(hit);

    var isVideo = isObj && (item.mediaType === 2 || (/\.mp4$/i.test(item.videoUrl || '')));
    var pre = Promise.resolve(null);

    if (isObj && !isVideo && item.imageUrl) {
      pre = readImageMeta(item).then(function (m) {
        if (m && m.r) {
          return { src: 'meta', via: m.via, promptEn: m.r.prompt, promptCn: '',
                   negativePrompt: m.r.negative || '', params: m.r.params || {} };
        }
        return null;
      }).catch(function () { return null; });
    }

    return pre.then(function (d) {
      if (d && (d.promptEn || d.negativePrompt)) return keep(uuid, d);
      return fetchDetailByRelay(uuid, isVideo ? 26000 : 18000).then(function (rd) {
        if (!rd.promptEn && !rd.promptCn) throw new Error('作者没有公开提示词');
        return keep(uuid, rd);
      });
    });
  }

  function keep(uuid, d) {
    cacheSet(uuid, d);
    markReady(uuid);
    return d;
  }

  /* 同一个作品的详情只请求一次（点击 / 悬停预取共用） */
  var inflight = {};
  /* 取不到的记录（会话内）：避免鼠标划过就反复起一轮请求（视频那轮最长 26s）。
     只拦住「自动预取」，用户手点仍然会重试。 */
  var MISS = {}, MISS_TTL = 10 * 60 * 1000;
  function markedMiss(uuid) {
    return !!(MISS[uuid] && (Date.now() - MISS[uuid]) < MISS_TTL);
  }

  function getDetail(item, isAuto) {
    var uuid = (item && typeof item === 'object') ? item.uuid : item;
    if (isAuto && markedMiss(uuid)) return Promise.reject(new Error('刚刚没取到，跳过重复预取'));
    if (inflight[uuid]) return inflight[uuid];
    var p = fetchDetail(item);
    inflight[uuid] = p;
    p.then(function () { delete MISS[uuid]; }, function () { MISS[uuid] = Date.now(); })
      .then(function () { delete inflight[uuid]; });
    return p;
  }

  /* 预取队列：图片走内嵌参数解析（很快，允许 3 个并发）；
     视频要过中转，单独串行、间隔放大避免打限流 */
  var PQ = [], qImgBusy = 0, qVidBusy = false;
  var Q_IMG_MAX = 3, Q_GAP = 110, Q_VID_GAP = 600;

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

  function isVideoItem(it) {
    return !!(it && (it.mediaType === 2 || /\.mp4(\?|$)/i.test(it.videoUrl || '')));
  }

  function runPQ() {
    if (!PQ.length) return;
    /* 挑一个能跑的：视频串行，图片最多 3 并发 */
    var pick = -1;
    for (var i = 0; i < PQ.length; i++) {
      if (isVideoItem(PQ[i])) { if (!qVidBusy && qImgBusy === 0) { pick = i; break; } }
      else if (qImgBusy < Q_IMG_MAX) { pick = i; break; }
    }
    if (pick < 0) return;
    var it = PQ.splice(pick, 1)[0];
    var isV = isVideoItem(it);
    if (isV) qVidBusy = true; else qImgBusy++;

    var finish = function () {
      if (isV) qVidBusy = false; else qImgBusy--;
      setTimeout(runPQ, isV ? Q_VID_GAP : Q_GAP);
    };
    getDetail(it, true).catch(function () { }).then(finish, finish);
    if (PQ.length) setTimeout(runPQ, 0);
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
    if (el.src) el.src.innerHTML = '';
    el.prompt.textContent = '—';
    el.prompt.classList.add('empty');
    el.neg.textContent = '—';
    el.neg.classList.add('empty');
    el.load.hidden = false;

    /* 复制全部 / 原图 先挂好 */
    if (el.openRaw) {
      var raw = it.mediaType === 2 ? (it.videoUrl || '') : (it.imageUrl || '');
      el.openRaw.href = raw || it.imageUrl || '#';
      el.openRaw.hidden = !raw;
      el.openRaw.textContent = it.mediaType === 2 ? '⬇ 原视频' : '⬇ 原图';
    }

    function paint(d) {
      el.load.hidden = true;
      var P = d.params || {};
      var LBL = { 'Model': '模型', 'Sampler': '采样器', 'Scheduler': '调度器', 'Steps': '步数',
                  'CFG scale': 'CFG', 'Seed': '种子', 'Size': '尺寸', 'LoRA': 'LoRA',
                  'Denoise': '重绘幅度', 'Clip skip': 'Clip skip' };
      var tags = [], seen = {};
      ['Model', 'Sampler', 'Scheduler', 'Steps', 'CFG scale', 'Seed', 'Size', 'LoRA', 'Denoise', 'Clip skip'].forEach(function (k) {
        if (P[k] && !seen[k]) { seen[k] = 1; tags.push([LBL[k] || k, P[k]]); }
      });
      el.params.innerHTML = tags.map(function (t, i) {
        return '<span class="ptag' + (i % 2 ? ' p' : '') + '">' + esc(t[0]) + ' · ' + esc(t[1]) + '</span>';
      }).join('');

      /* 提示词来源说明 */
      if (el.src) {
        if (d.src === 'meta') {
          el.src.innerHTML = '<b>✅ 提示词取自图片内嵌参数</b>（作者导出时写入，未经第三方服务器）';
        } else if (d.src === 'relay') {
          el.src.innerHTML = '🌐 提示词取自社区详情页（经公开只读中转，视频作品只能走这条路）';
        } else {
          el.src.innerHTML = '';
        }
      }

      var p = d.promptEn || d.promptCn || '';
      var n = d.negativePrompt || '';
      if (p) { el.prompt.textContent = p; el.prompt.classList.remove('empty'); }
      else {
        var isVid = S.mode === 'video' || (S.current && S.current.mediaType === 2);
        el.prompt.textContent = isVid
          ? '这个视频的作者没有公开提示词（社区里视频作品普遍不公开生成信息，封面也不带参数）。想看提示词可以切到上方「🖼️ 图片」Tab —— 那里勾着「只看带生成参数」，作品基本都公开了提示词。'
          : '这张图的作者没有公开提示词（社区里作者可以自己选择是否公开，也有的导出时没勾选写入参数）。勾选上方「只看带生成参数」后，这类作品的提示词几乎都会公开。';
        el.prompt.classList.add('empty');
      }
      if (n) { el.neg.textContent = n; el.neg.classList.remove('empty'); el.negWrap.hidden = false; }
      else { el.negWrap.hidden = true; }

      /* 中文提示词单独展示 */
      if (d.promptCn && d.promptCn !== p) {
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
      if (el.src) el.src.innerHTML = '';
      el.err.hidden = false;
      el.err.innerHTML = esc(msg) + '<br><button type="button" id="dretry">重新获取</button>';
      var b = document.getElementById('dretry');
      if (b) b.addEventListener('click', function () { start(); });
      /* 详情失败也给一个可用的提示词（不阻塞浏览） */
      el.prompt.textContent = '提示词获取失败，可稍后重试「重新获取」。';
      el.prompt.classList.add('empty');
    }

    function start() {
      el.err.hidden = true;
      el.load.hidden = false;
      getDetail(it).then(function (d) {
        if (S.current !== it) return;
        S.curDetail = d;
        paint(d);
      }).catch(function (e) {
        if (S.current !== it) return;
        var msg = (e && e.message) || String(e);
        fail('提示词没取到：' + msg +
          '。可以点下面「重新获取」再试。');
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
