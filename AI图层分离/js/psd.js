/* ============================================================
 * 纯 JS 分层 PSD 写入器（Photoshop 规范，RLE 压缩，带透明通道）
 * 依赖：无
 * 用法：PSDWriter.buildPsdBlob(layers, W, H) -> Promise<Blob>
 *   layers: 自底向上的数组，每项
 *     { canvas: HTMLCanvasElement(该层矩形区), x, y, name, visible }
 * ============================================================ */
var PSDWriter = (function () {
  'use strict';

  /* ---------- 字节缓冲 ---------- */
  function ByteBuf() { this.chunks = []; this.len = 0; }
  ByteBuf.prototype.push = function (u8) { this.chunks.push(u8); this.len += u8.length; };
  ByteBuf.prototype.pushArr = function (arr) { this.chunks.push(new Uint8Array(arr)); this.len += arr.length; };
  ByteBuf.prototype.concat = function () {
    var out = new Uint8Array(this.len), off = 0;
    for (var i = 0; i < this.chunks.length; i++) { out.set(this.chunks[i], off); off += this.chunks[i].length; }
    return out;
  };

  function u16(v) { return [(v >>> 8) & 255, v & 255]; }
  function s16(v) { if (v < 0) v += 65536; return [(v >>> 8) & 255, v & 255]; }
  function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
  function s32(v) { if (v < 0) v += 4294967296; return u32(v); }
  function ascii(s) { var o = []; for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 255); return o; }

  /* ---------- PackBits（按行，PSD 标准 RLE） ---------- */
  function packRow(src, off, len) {
    var out = new Uint8Array(len + Math.ceil(len / 127) + 16);
    var ip = off, end = off + len, dp = 0;
    while (ip < end) {
      var run = 1;
      while (run < 128 && ip + run < end && src[ip + run] === src[ip]) run++;
      if (run >= 3) {
        out[dp++] = (257 - run) & 255;   /* -(run-1) */
        out[dp++] = src[ip];
        ip += run;
      } else {
        var start = ip, lit = 0;
        while (ip < end && lit < 128) {
          if (ip + 2 < end && src[ip] === src[ip + 1] && src[ip] === src[ip + 2]) break;
          ip++; lit++;
        }
        out[dp++] = lit - 1;
        for (var k = 0; k < lit; k++) out[dp++] = src[start + k];
      }
    }
    return out.subarray(0, dp);
  }

  /* 单通道平面 RLE：返回 {table:Uint8Array(2*h), body:Uint8Array, size} */
  function rlePlane(plane, w, h) {
    var table = new Uint8Array(h * 2), parts = [], total = 0;
    for (var y = 0; y < h; y++) {
      var r = packRow(plane, y * w, w);
      table[y * 2] = (r.length >>> 8) & 255;
      table[y * 2 + 1] = r.length & 255;
      parts.push(r);
      total += r.length;
    }
    var body = new Uint8Array(total), off = 0;
    for (var i = 0; i < parts.length; i++) { body.set(parts[i], off); off += parts[i].length; }
    return { table: table, body: body, size: 2 + table.length + body.length };
  }

  /* RGBA 交错 -> 4 个平面 */
  function splitChannels(rgba, px) {
    var R = new Uint8Array(px), G = new Uint8Array(px), B = new Uint8Array(px), A = new Uint8Array(px);
    for (var i = 0, p = 0; i < px; i++, p += 4) {
      R[i] = rgba[p]; G[i] = rgba[p + 1]; B[i] = rgba[p + 2]; A[i] = rgba[p + 3];
    }
    return [R, G, B, A];
  }

  /* 图层名 -> Pascal string（UTF-8 字节，整体 4 字节对齐） */
  function pascalName(name) {
    var bytes = utf8Bytes(name);
    if (bytes.length > 255) {
      /* 按字节截断且不切断多字节字符 */
      var cut = 255;
      while (cut > 0 && (bytes[cut] & 0xC0) === 0x80) cut--;
      bytes = bytes.slice(0, cut);
    }
    var arr = [bytes.length].concat(bytes);
    while (arr.length % 4 !== 0) arr.push(0);
    return arr;
  }

  /* luni：附加图层信息里的 Unicode 图层名（UTF-16BE），让 PS/Photopea 正确显示中文 */
  function luniBlock(name) {
    var chars = [];
    /* 'luni' + 长度(4) + 字符数(4) + UTF-16BE 数据 */
    for (var i = 0; i < name.length; i++) chars.push(name.charCodeAt(i) >>> 8, name.charCodeAt(i) & 255);
    if (chars.length % 4 !== 0) {          /* 名称整体 4 字节对齐 */
      var pad = 4 - (chars.length % 4);
      for (var p = 0; p < pad; p++) chars.push(0);
    }
    var dataLen = 4 + chars.length;
    return ascii('8BIM').concat(ascii('luni'), u32(dataLen), u32(name.length), chars);
  }

  /* 字符串 -> UTF-8 字节数组 */
  function utf8Bytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        /* 代理对 -> 4 字节 */
        var c2 = s.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  /* ---------- 主入口 ---------- */
  function buildPsdBlob(layers, W, H) {
    return new Promise(function (resolve, reject) {
      try {
        resolve(_build(layers, W, H));
      } catch (e) { reject(e); }
    });
  }

  function _build(layers, W, H) {
    var px = W * H;

    /* 1) 预压缩：每层 4 通道 */
    var prep = [];
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      var cx = document.createElement('canvas');
      cx.width = L.canvas.width; cx.height = L.canvas.height;
      cx.getContext('2d').drawImage(L.canvas, 0, 0);
      var rgba = cx.getContext('2d').getImageData(0, 0, cx.width, cx.height).data;
      var planes = splitChannels(rgba, cx.width * cx.height);
      var chans = [];
      for (var c = 0; c < 4; c++) chans.push(rlePlane(planes[c], cx.width, cx.height));
      prep.push({ L: L, chans: chans });
    }

    /* 2) 每层记录（channel 长度已知后才能算） */
    var ids = [0, 1, 2, -1];
    var recLens = [], recs = [];
    var chanTotal = 0;
    for (var k = 0; k < prep.length; k++) {
      var L2 = prep[k].L, chans2 = prep[k].chans;
      var rec = [];
      rec = rec.concat(s32(L2.y), s32(L2.x), s32(L2.y + L2.canvas.height), s32(L2.x + L2.canvas.width));
      rec = rec.concat(u16(4));
      for (var c2 = 0; c2 < 4; c2++) rec = rec.concat(s16(ids[c2]), u32(chans2[c2].size));
      rec = rec.concat(ascii('8BIM'), ascii('norm'), [255, 0, L2.visible === false ? 10 : 8, 0]);
      /* 附加信息：蒙版(0) + 混合范围(0) + 图层名(Pascal,UTF-8) + luni(UTF-16BE Unicode 名) */
      var lname = L2.name || ('图层 ' + (k + 1));
      var extra = [0, 0, 0, 0, 0, 0, 0, 0].concat(pascalName(lname));
      extra = extra.concat(luniBlock(lname));
      rec = rec.concat(u32(extra.length), extra);
      var u = new Uint8Array(rec);
      recs.push(u);
      recLens.push(u.length);
      var sz = 0;
      for (var c3 = 0; c3 < 4; c3++) sz += chans2[c3].size;
      chanTotal += sz;
    }
    var layerInfoLen = 2 + chanTotal;
    for (var r = 0; r < recLens.length; r++) layerInfoLen += recLens[r];
    /* 注意：这里不能再自增；奇数时在写入端补 1 个 0（PSD 规定声明长度不含该填充） */

    /* 3) 合成图（可见图层） */
    var compCv = document.createElement('canvas');
    compCv.width = W; compCv.height = H;
    var cc = compCv.getContext('2d');
    cc.clearRect(0, 0, W, H);
    for (var v = 0; v < layers.length; v++) {
      if (layers[v].visible === false) continue;
      cc.drawImage(layers[v].canvas, layers[v].x, layers[v].y);
    }
    var compData = cc.getImageData(0, 0, W, H).data;
    var compPlanes = splitChannels(compData, px);
    var compRle = [];
    for (var c4 = 0; c4 < 4; c4++) compRle.push(rlePlane(compPlanes[c4], W, H));
    var compTable = new Uint8Array(H * 4 * 2);
    var compBodyLen = 0;
    for (var c5 = 0; c5 < 4; c5++) {
      compTable.set(compRle[c5].table, c5 * H * 2);
      compBodyLen += compRle[c5].body.length;
    }

    /* 4) 写文件 */
    var buf = new ByteBuf();
    /* 文件头：签名/版本/保留/通道数/高/宽/位深/RGB */
    buf.pushArr([0x38, 0x42, 0x50, 0x53].concat(u16(1), [0, 0, 0, 0, 0, 0], u16(4), u32(H), u32(W), u16(8), u16(3)));
    buf.pushArr(u32(0));                       /* 颜色模式数据 */
    buf.pushArr(u32(0));                       /* 图像资源 */

    /* Layer & Mask 段 = LayerInfo 段 + 全局图层蒙版；合成图（ImageData）是独立的一段，不计入 */
    var lmLen = 4 + layerInfoLen + 4;
    var lmPad = (lmLen % 2 !== 0) ? 1 : 0;
    buf.pushArr(u32(lmLen + lmPad));

    buf.pushArr(u32(layerInfoLen));
    buf.pushArr(s16(-prep.length));            /* 负数：合成图带透明 */
    for (var q = 0; q < recs.length; q++) buf.push(recs[q]);
    for (var q2 = 0; q2 < prep.length; q2++) {
      var cs = prep[q2].chans;
      for (var c6 = 0; c6 < 4; c6++) {
        buf.pushArr(u16(1));
        buf.push(cs[c6].table);
        buf.push(cs[c6].body);
      }
    }
    if (layerInfoLen % 2 !== 0) buf.pushArr([0]);   /* LayerInfo 段补齐 */
    buf.pushArr(u32(0));                       /* 全局图层蒙版信息：长度 0 */
    for (var lp = 0; lp < lmPad; lp++) buf.pushArr([0]);   /* L&M 段补齐到偶数 */

    /* 合成图数据（ImageData 段，独立于 L&M） */
    buf.pushArr(u16(1));
    buf.push(compTable);
    for (var c7 = 0; c7 < 4; c7++) buf.push(compRle[c7].body);

    return new Blob([buf.concat()], { type: 'image/vnd.adobe.photoshop' });
  }

  return { buildPsdBlob: buildPsdBlob };
})();
