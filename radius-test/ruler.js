(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScreenRuler = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.2.0';

  /* ---------------- 常量（单位：屏幕 CSS px） ---------------- */
  var CELL = 2;                 // 位置编码单元尺寸
  var STRIP = 12;               // 边缘标尺条厚度
  var MAX_ZONE = 260;           // 角区上限
  var TICK_SPACING = 10;        // 梳齿间距（恒定，解码端依赖此常量）
  var TICK_H = 2;               // 梳齿线粗细
  var TICK_SCOPE = 24;          // 梳齿外框留白（保证黑底衬白线）
  var COMB_SCOPE_H = TICK_H + TICK_SCOPE;
  var DECO_BG = [18, 22, 29];   // 装饰区底色
  var MAX_CODE = 4095;          // 12bit

  /* ---------------- 编码 ---------------- */
  function gray12(c) { c &= MAX_CODE; return (c ^ (c >> 1)) & MAX_CODE; }
  function ungray12(g) {
    g &= MAX_CODE;
    var c = 0, acc = 0, i;
    for (i = 11; i >= 0; i--) { acc ^= (g >> i) & 1; if (acc) c |= (1 << i); }
    return c & MAX_CODE;
  }
  /* 4bit/通道 → 颜色，但整体抬到 30..255（步进 15）。
     为什么不用满量程 0..255：系统 / 浏览器 UI 常常是纯黑（暗色模式、刘海区、
     工具条），若编码色里有接近纯黑的色块，黑色遮挡像素会被误判成「可见」。
     抬到 30 起步后，黑色像素与任何合法编码色的曼哈顿距离 ≥ 90 > 判定阈值 60。 */
  var CODE_BASE = 30, CODE_STEP = 15;
  function codeColor(v) {
    v &= MAX_CODE;
    return [
      CODE_BASE + CODE_STEP * ((v >> 8) & 15),
      CODE_BASE + CODE_STEP * ((v >> 4) & 15),
      CODE_BASE + CODE_STEP * (v & 15)
    ];
  }
  function unChannel(c) {
    var n = Math.round((c - CODE_BASE) / CODE_STEP);
    return n < 0 ? 0 : n > 15 ? 15 : n;
  }
  function HCode(x) { return codeColor(gray12(Math.floor(x / CELL))); }
  function VCode(y) { return codeColor(gray12(Math.floor(y / CELL))); }

  /**
   * 版式计算：所有尺寸都由屏幕尺寸推导，解码端用同一函数即可知道
   * 角区大小与梳齿间距（间距恒为 TICK_SPACING）。
   */
  function layout(W, H) {
    var z = Math.round(0.35 * Math.min(W, H));
    z = Math.max(60, Math.min(MAX_ZONE, z));
    z = Math.min(z, Math.floor(Math.min(W, H) / 2) - 20);
    var bandY0 = z, bandY1 = H - z, bandH = Math.max(0, bandY1 - bandY0);
    var combHY = Math.round(bandY0 + 4 + COMB_SCOPE_H / 2);          // 顶部梳齿（横带内）
    var vBottom = bandY1 - 4 - COMB_SCOPE_H / 2;                     // 垂直梳齿中心可到的下限
    var room = vBottom - (combHY + COMB_SCOPE_H / 2);                 // 两梳齿之间剩余空间
    var span = Math.min(100, room, W - 2 * z - TICK_SCOPE);
    var ticks = span >= 50 ? Math.floor(span / TICK_SPACING) + 1 : 0;
    if (ticks < 6) { span = 0; ticks = 0; }
    var combVY = Math.round(vBottom - (span / 2));
    return {
      z: z, strip: STRIP, bandY0: bandY0, bandY1: bandY1, bandH: bandH,
      combHY: combHY, combVX: Math.round(W / 2), combVY: combVY,
      combSpan: span, ticks: ticks, tickSpacing: TICK_SPACING,
      cardY: Math.round(bandY0 + bandH * 0.45)
    };
  }

  /** 区域判定：'lv' 左右竖条(编码y) | 'bh' 上下横条(编码x) | 'zone' 角区(编码x) | 'deco' */
  function regionOf(x, y, W, H) {
    var z = layout(W, H).z;
    if (x < STRIP || x >= W - STRIP) return 'lv';
    if (y < STRIP || y >= H - STRIP) return 'bh';
    if ((x < z || x >= W - z) && (y < z || y >= H - z)) return 'zone';
    return 'deco';
  }
  /** 该点的模型颜色；装饰区返回 null */
  function modelColorAt(x, y, W, H) {
    var r = regionOf(x, y, W, H);
    if (r === 'lv') return VCode(y);
    if (r === 'bh' || r === 'zone') return HCode(x);
    return null;
  }
  function codeAxisAt(x, y, W, H) {
    var r = regionOf(x, y, W, H);
    if (r === 'lv') return 'y';
    if (r === 'bh' || r === 'zone') return 'x';
    return null;
  }

  /* ================================================================
   *  绘制（浏览器）
   * ================================================================ */
  /**
   * @param ctx 2D 上下文（需已 setTransform(dpr,0,0,dpr,0,0)）
   * @param W,H 屏幕 CSS 尺寸
   * @param dpr 设备像素比
   * @param opt { labels:[{t,x,y,size}], info:{...}, legend:[数字] }
   */
  function paint(ctx, W, H, dpr, opt) {
    opt = opt || {};
    var L = layout(W, H);
    var Wp = Math.round(W * dpr), Hp = Math.round(H * dpr);

    /* --- 1) 位置编码层：整幅 ImageData 一次写入（不允许任何装饰覆盖） --- */
    var img = ctx.createImageData(Wp, Hp);
    var d = img.data;
    var nx = Math.ceil(W / CELL) + 3, ny = Math.ceil(H / CELL) + 3;
    var hTab = new Uint8Array(nx * 3), vTab = new Uint8Array(ny * 3), i, c;
    for (i = 0; i < nx; i++) { c = codeColor(gray12(i)); hTab[i * 3] = c[0]; hTab[i * 3 + 1] = c[1]; hTab[i * 3 + 2] = c[2]; }
    for (i = 0; i < ny; i++) { c = codeColor(gray12(i)); vTab[i * 3] = c[0]; vTab[i * 3 + 1] = c[1]; vTab[i * 3 + 2] = c[2]; }

    var yTop = STRIP, yBot = H - STRIP, xL = STRIP, xR = W - STRIP, z = L.z;
    for (var py = 0; py < Hp; py++) {
      var y = (py + 0.5) / dpr - 0.5;
      var yi = Math.floor(y / CELL); if (yi < 0) yi = 0; if (yi >= ny) yi = ny - 1;
      var vr = vTab[yi * 3], vg = vTab[yi * 3 + 1], vb = vTab[yi * 3 + 2];
      var rowH = (y < yTop || y >= yBot);
      var rowZone = (y < z || y >= H - z);
      var base = py * Wp * 4;
      for (var pxx = 0; pxx < Wp; pxx++) {
        var x = (pxx + 0.5) / dpr - 0.5;
        var o = base + pxx * 4, r, g, b;
        if (x < xL || x >= xR) { r = vr; g = vg; b = vb; }
        else if (rowH || (rowZone && (x < z || x >= W - z))) {
          var xi = Math.floor(x / CELL); if (xi < 0) xi = 0; if (xi >= nx) xi = nx - 1;
          r = hTab[xi * 3]; g = hTab[xi * 3 + 1]; b = hTab[xi * 3 + 2];
        } else { r = DECO_BG[0]; g = DECO_BG[1]; b = DECO_BG[2]; }
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
    ctx.restore();

    /* --- 2) 装饰层：严格裁剪到中央十字，绝不碰编码区 --- */
    ctx.save();
    ctx.beginPath();
    ctx.rect(z, STRIP, W - 2 * z, H - 2 * STRIP);              // 竖带
    ctx.rect(STRIP, z, W - 2 * STRIP, H - 2 * z);              // 横带
    ctx.clip();

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,160,220,0.18)';
    ctx.beginPath();
    for (i = 0; i <= W; i += 10) { var xx = Math.round(i) + 0.5; ctx.moveTo(xx, STRIP); ctx.lineTo(xx, H - STRIP); }
    for (i = 0; i <= H; i += 10) { var yy = Math.round(i) + 0.5; ctx.moveTo(STRIP, yy); ctx.lineTo(W - STRIP, yy); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,170,255,0.42)';
    ctx.beginPath();
    for (i = 0; i <= W; i += 50) { var x2 = Math.round(i) + 0.5; ctx.moveTo(x2, STRIP); ctx.lineTo(x2, H - STRIP); }
    for (i = 0; i <= H; i += 50) { var y2 = Math.round(i) + 0.5; ctx.moveTo(STRIP, y2); ctx.lineTo(W - STRIP, y2); }
    ctx.stroke();

    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(160,190,235,0.7)';
    ctx.textBaseline = 'top';
    for (i = 100; i < H; i += 100) ctx.fillText('y' + i, STRIP + 3, Math.round(i) + 2.5);
    ctx.textBaseline = 'bottom';
    for (i = 100; i < W; i += 100) ctx.fillText('x' + i, Math.round(i) + 2.5, H - STRIP - 2);

    /* 中部信息卡 */
    var info = opt.info || {};
    var lines = [
      { t: '主屏幕 canvas 探针', s: 15, c: '#ffffff' },
      { t: 'screen ' + fmt(W) + ' × ' + fmt(H) + ' css @ ' + dpr + 'x', s: 11, c: '#8fb4ff' },
      { t: 'device ' + fmt(info.deviceW) + ' × ' + fmt(info.deviceH) + ' px', s: 11, c: '#8fb4ff' },
      { t: 'viewport ' + fmt(info.innerW) + ' × ' + fmt(info.innerH) + ' css', s: 11, c: '#8fb4ff' }
    ];
    if (info.label) lines.push({ t: info.label, s: 11, c: '#c9d6e8' });
    if (opt.legend && opt.legend.length) lines.push({ t: '候选 R: ' + opt.legend.join(' / ') + ' dp', s: 10, c: '#8ab08a' });
    if (opt.labels) for (i = 0; i < opt.labels.length; i++) lines.push(opt.labels[i]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < lines.length; i++) {
      ctx.font = (lines[i].s >= 14 ? '600 ' : '') + lines[i].s +
        'px -apple-system, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = lines[i].c;
      ctx.fillText(lines[i].t, W / 2, L.cardY + (i - (lines.length - 1) / 2) * 17);
    }
    ctx.textAlign = 'left';
    if (opt.labels) for (i = 0; i < opt.labels.length; i++) { /* 已并入信息卡 */ }
    ctx.restore();

    /* --- 3) 梳齿标定尺（横带内，最后画，保证纯白线无遮挡） --- */
    paintCombs(ctx, W, H, L);
    return { Wp: Wp, Hp: Hp, layout: L };
  }

  function paintCombs(ctx, W, H, L) {
    if (!L.ticks) return;
    var span = (L.ticks - 1) * TICK_SPACING;
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.z, STRIP, W - 2 * L.z, H - 2 * STRIP);
    ctx.rect(STRIP, L.z, W - 2 * STRIP, H - 2 * L.z);
    ctx.clip();

    // 水平梳齿：白竖线沿 x 排布 → 标定 sx
    var x0 = Math.round(L.combVX - span / 2), y0 = L.combHY;
    scope(ctx, x0 - TICK_SCOPE / 2, y0 - COMB_SCOPE_H / 2, span + TICK_SCOPE, COMB_SCOPE_H);
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < L.ticks; i++) ctx.fillRect(x0 + i * TICK_SPACING, y0 - TICK_H / 2, TICK_H, TICK_H === 2 ? 8 : TICK_H);

    // 垂直梳齿：白横线沿 y 排布 → 标定 sy
    var y1 = Math.round(L.combVY - span / 2), xc = L.combVX;
    scope(ctx, xc - COMB_SCOPE_H / 2, y1 - TICK_SCOPE / 2, COMB_SCOPE_H, span + TICK_SCOPE);
    ctx.fillStyle = '#ffffff';
    for (i = 0; i < L.ticks; i++) ctx.fillRect(xc - 5, y1 + i * TICK_SPACING - 1, 10, 2);
    ctx.restore();
  }
  function scope(ctx, x, y, w, h) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function fmt(v) { return (v === undefined || v === null || isNaN(v)) ? '?' : String(Math.round(v * 100) / 100); }

  /* 水平梳齿：TICK_H 宽 × 8 高；垂直梳齿：10 宽 × 2 高 —— 两者都是「细线」，
     一个沿 x 分布、一个沿 y 分布，互不干扰。 */

  /* ================================================================
   *  截图解码
   * ================================================================ */
  function px(buf, x, y) {
    if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return null;
    var o = (y * buf.width + x) * 4, d = buf.data;
    return [d[o], d[o + 1], d[o + 2]];
  }
  function dist(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); }
  function lum(c) { return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000; }

  /* ---------------- 梳齿标定 ----------------
   * 梳齿 = 一串等距（TICK_SPACING）细白线，画在版式已知的位置上，
   * 所以解码端不必盲搜全图：按 layout(W,H) 预测梳齿所在的窗口再局部搜索，
   * 既快又能避开文字等内容造成的误判。
   * 判定：沿行/列数「白色游程」，游程数 6..40 且相邻中心间距一致 → 认定；
   * 间距 / TICK_SPACING = 截图缩放（对线宽、轻微丢线都鲁棒）。 */
  function findComb(buf, axis, W, H, s0x, s0y) {
    var L = layout(W, H);
    if (!L.ticks) return { ok: false, reason: '该屏幕尺寸下未绘制梳齿' };
    var rows, from, to, i, j;
    if (axis === 'h') {
      var cy = L.combHY * s0y, hh = Math.max(6, 7 * s0y);
      rows = [Math.round(cy - hh), Math.round(cy + hh)];
      from = Math.round((L.combVX - L.combSpan * 0.72) * s0x) - 12;
      to = Math.round((L.combVX + L.combSpan * 0.72) * s0x) + 12;
    } else {
      var cx = L.combVX * s0x, hw = Math.max(6, 9 * s0x);
      rows = [Math.round(cx - hw), Math.round(cx + hw)];
      from = Math.round((L.combVY - L.combSpan * 0.72) * s0y) - 12;
      to = Math.round((L.combVY + L.combSpan * 0.72) * s0y) + 12;
    }
    rows[0] = Math.max(0, rows[0]); rows[1] = Math.min((axis === 'h' ? buf.height : buf.width) - 1, rows[1]);
    from = Math.max(0, from); to = Math.min((axis === 'h' ? buf.width : buf.height) - 1, to);

    var TH = 105, bands = [];
    for (i = rows[0]; i <= rows[1]; i++) {
      var runs = [], inW = false, start = 0;
      for (j = from; j <= to; j++) {
        var col = (axis === 'h') ? px(buf, j, i) : px(buf, i, j);
        if (!col) break;
        var w = lum(col) > TH;
        if (w && !inW) { inW = true; start = j; }
        else if (!w && inW) { inW = false; runs.push((start + j - 1) / 2); }
      }
      if (inW) runs.push((start + to) / 2);
      if (runs.length < 6 || runs.length > 40) continue;
      var gaps = [];
      for (j = 1; j < runs.length; j++) gaps.push(runs[j] - runs[j - 1]);
      var sorted = gaps.slice().sort(function (a, b) { return a - b; });
      var med = sorted[Math.floor(sorted.length / 2)];
      if (!(med > 1)) continue;
      var bad = 0;
      for (j = 0; j < gaps.length; j++) {
        var k = gaps[j] / med;
        if (k < 0.6 || k > 1.7) bad++;
      }
      if (bad > Math.max(1, Math.floor(gaps.length * 0.15))) continue;
      bands.push({ at: i, count: runs.length, spacing: med });
    }
    if (!bands.length) return { ok: false, reason: '未找到梳齿标定尺' };

    // 取最长的一段连续行/列，再取其中位间距
    var best = null, run = null;
    for (i = 0; i < bands.length; i++) {
      if (run && bands[i].at === run[run.length - 1].at + 1) run.push(bands[i]);
      else run = [bands[i]];
      if (!best || run.length > best.length) best = run;
    }
    if (best.length < 3) return { ok: false, reason: '梳齿标定尺可见行数不足（' + best.length + '）' };
    var sps = best.map(function (b) { return b.spacing; }).sort(function (a, b) { return a - b; });
    var sp = sps[Math.floor(sps.length / 2)];
    var cnts = best.map(function (b) { return b.count; }).sort(function (a, b) { return a - b; });
    return {
      ok: sp > 1,
      spacing: sp,
      scale: sp / TICK_SPACING,
      count: cnts[Math.floor(cnts.length / 2)],
      rows: best.length,
      at: best[Math.floor(best.length / 2)].at
    };
  }

  /* ---------------- 采样 / 模型比对 ---------------- */
  function makeSampler(buf, W, H, sx, sy, ox, oy) {
    ox = ox || 0; oy = oy || 0;
    var cache = new Map();
    function toPx(x, y) { return [ox + (x + 0.5) * sx - 0.5, oy + (y + 0.5) * sy - 0.5]; }

    function probe(x, y) {
      x = Math.round(x); y = Math.round(y);
      var key = x * 20000 + y;
      var hit = cache.get(key); if (hit) return hit;
      var res;
      do {
        if (x < 0 || y < 0 || x >= W || y >= H) { res = { ok: false, reason: 'out' }; break; }
        var pred = modelColorAt(x, y, W, H);
        if (!pred) { res = { ok: false, reason: 'deco' }; break; }
        var axis = codeAxisAt(x, y, W, H);
        var p = toPx(x, y);
        /* 只取「精确对应」的那一个像素，不做邻近试探。
         * 原因：邻近像素可能跨越遮挡边界——圆角弧线在相切点附近相邻行割深可差
         * 近 10px，一试探就会把「这行是否可见」判成隔壁行的结论。
         * 亚像素/缩放误差交给两把梳齿 + 边缘条的一维标定去解决（精度 ~0.1%），
         * 解码时再靠「反解坐标 ≈ 采样坐标」的校验兜住 1px 级误差。 */
        var cands = [[0, 0]];
        var bestD = 1e9, bestCol = null, k;
        for (k = 0; k < cands.length; k++) {
          var c = px(buf, Math.round(p[0] + cands[k][0]), Math.round(p[1] + cands[k][1]));
          if (!c) continue;
          var dd = dist(c, pred);
          if (dd < bestD) { bestD = dd; bestCol = c; }
        }
        if (!bestCol) { res = { ok: false, reason: 'out' }; break; }
        var est = null;
        if (bestD <= 96) {
          var v = (unChannel(bestCol[0]) << 8) | (unChannel(bestCol[1]) << 4) | unChannel(bestCol[2]);
          est = ungray12(v) * CELL + CELL / 2;
        }
        var want = (axis === 'x') ? x : y;
        var nearOk = (est !== null) && Math.abs(est - want) <= CELL * 1.5;
        var colorOk = bestD <= 60;
        res = { ok: nearOk && colorOk, d: bestD, est: est, want: want, axis: axis, near: nearOk, colorOk: colorOk, color: bestCol, pred: pred };
      } while (false);
      cache.set(key, res);
      return res;
    }

    function scanFrom(x0, dir, limit, y, isRow) {
      var run = 0, start = null, x = x0;
      while (dir > 0 ? x < limit : x >= limit) {
        var r = isRow ? probe(x, y) : probe(y, x);
        if (r.ok) { if (run === 0) start = x; run++; if (run >= 3) return start; }
        else run = 0;
        x += dir;
      }
      return null;
    }
    function scanTo(x0, dir, limit, y, isRow) {
      var run = 0, end = null, x = x0;
      while (dir > 0 ? x < limit : x >= limit) {
        var r = isRow ? probe(x, y) : probe(y, x);
        if (r.ok) { if (run === 0) end = x; run++; if (run >= 3) return end; }
        else run = 0;
        x += dir;
      }
      return null;
    }

    var z = layout(W, H).z;
    function rowVisible(y) {
      if (probe(STRIP / 2, y).ok) return true;
      if (probe(W - STRIP / 2, y).ok) return true;
      if (y < STRIP || y >= H - STRIP) {
        for (var k = 1; k <= 6; k++) if (probe(W * k / 7, y).ok) return true;
        return false;
      }
      if (scanFrom(STRIP, 1, z, y, true) !== null) return true;
      if (scanFrom(W - STRIP - 1, -1, W - z, y, true) !== null) return true;
      return false;
    }
    /**
     * 从某一侧边缘往内扫，量出「可见游程」：
     *   a = 第一个可见位置相对边缘的偏移（>0：边缘附近被切/被遮，可见区从 a 开始）
     *   e = 若边缘本身可见，则从边缘起的连续可见游程在哪里结束（返回结束处相对偏移）
     * 用于区分两种完全不同的几何：
     *   · 屏幕物理圆角 → 可见区从 a>0 开始（缺口在外侧）
     *   · 遮挡物（工具条）自带圆角 → 边缘可见、可见区在 e 处被截断（缺口在内侧）
     */
    function leadingRun(y, side, isRow) {
      var W_, H_, start, end, dir;
      if (isRow === false) { W_ = H; H_ = W; start = (side === 'near') ? 0 : W_ - 1; end = (side === 'near') ? z : W_ - z; dir = (side === 'near') ? 1 : -1; }
      else { W_ = W; start = (side === 'near') ? 0 : W_ - 1; end = (side === 'near') ? z : W_ - z; dir = (side === 'near') ? 1 : -1; }
      var pos = start, first = -1, bad = 0, edge = null, i = 0;
      while (dir > 0 ? pos < end : pos >= end) {
        var r = (isRow === false) ? probe(y, pos) : probe(pos, y);
        if (r.ok) {
          if (first < 0) first = i;
          if (bad > 0 && bad < 3) edge = null;      // 抖动，撤销「游程结束」判定
          bad = 0;
        } else if (first >= 0) {
          if (bad === 0) edge = i;                  // 游程后的第一个坏点 = 遮挡边缘
          bad++;
          if (bad >= 3) break;
        }
        pos += dir; i++;
      }
      var a = (first === 0) ? 0 : (first > 0 ? first : -1);   // -1 = 完全不可见
      var e = (first === 0 && edge !== null && bad >= 3) ? edge : null;
      return { a: a, e: e };
    }

    /** 该行是否「整行可见」：两端边缘像素 + （角区行）角区编码区都必须可见 */
    function rowFull(y) {
      // 取最外侧像素（x=0 / x=W-1）：安全区的定义是「整行每个像素都是干净的
      // canvas」，在屏幕物理圆角的圆弧尚未结束时（哪怕只切掉 0.9px）就不算安全。
      if (!probe(0, y).ok || !probe(W - 1, y).ok) return false;
      if (y < z || y >= H - z) {
        if (!probe(z - 3, y).ok || !probe(W - z + 2, y).ok) return false;
      }
      return true;
    }

    return {
      probe: probe, z: z, leadingRun: leadingRun, rowFull: rowFull,
      /** 行 y 上，左侧第一个「确实可见」的 x —— 即该行左角被切掉的水平深度。
       *  必须从 x=0 起扫：x<12 属于左边缘条（编码 y），仍然可解码，
       *  否则小半径（浅切）会在 12px 阈值处被整体丢掉。 */
      leftBoundary: function (y) { return scanFrom(0, 1, z, y, true); },
      rightBoundary: function (y) { return scanFrom(W - 1, -1, W - z, y, true); },
      /** 列 x 上，上方第一个确实可见的 y */
      topBoundary: function (x) { return scanFrom(0, 1, z, x, false); },
      rowVisible: rowVisible
    };
  }

  /* ---------------- 圆角拟合 ----------------
   * 统一模型（四种角都变换到「左下」情形）：
   *   x(y) = R − √(R² − (y−yt)²)，y ∈ [yt, yt+R]；y < yt 时不切
   *   变量 x = 该行被切掉的水平深度（越大越靠内）
   *   · 屏幕物理圆角：yt = H − R（圆弧顶点在 y=H−R，屏幕底边处切得最深 = R）
   *   · 可见底边上的圆角（如浏览器工具条自身的圆角）：yt = yBot − R
   *   · free：R 与 yt 都自由 ← 用来发现「弧顶不在屏幕底边」的情况
   */
  function cutOf(R, yt, y) {
    var dy = y - yt;
    if (dy < 0) return 0;
    if (dy > R) return R;
    return R - Math.sqrt(Math.max(0, R * R - dy * dy));
  }
  /* 区间残差：边界点 x 是「第一个可见像素」，真实割深只落在 (x-1, x] 内。
     直接用 cut-x 会在整段弧上形成 +0.5px 的系统偏置，把半径整体抬高几像素
     （弧越短越明显）。这里对落在区间内的解给 0 残差，区间外按距离计，
     再叠加一个很小的「向区间中心收敛」项，避免最小值落进平台后无法定解。 */
  function rmsFor(pts, R, yt) {
    var s = 0, n = pts.length, i;
    for (i = 0; i < n; i++) {
      var x = pts[i][0], y = pts[i][1];
      /* 必须对「所有」点求残差：cutOf 在弧段之外会返回 0 / R（模型认为那里没被切 /
         已切满），这些预测同样要和观测比对。否则小半径 R 可以把范围外的点整段忽略，
         零残差地「解释」一条它根本盖不住的弧。 */
      var cut = cutOf(R, yt, y), center = x - 0.5, dc = Math.abs(cut - center);
      var e = Math.max(0, dc - 0.5) + 0.15 * dc;
      s += e * e;
    }
    return { err: n ? Math.sqrt(s / n) : Infinity, n: n };
  }
  function fitCorner(pts, H, yBot, prefer, yRange) {
    var out = { free: null, atScreenBottom: null, atVisibleBottom: null, points: pts.length };
    if (pts.length < 6) { out.insufficient = true; return out; }
    var R, yt, r, best = null;
    var yLo = yRange ? yRange[0] : Math.max(0, yBot - 260);
    var yHi = yRange ? yRange[1] : Math.min(H, yBot + 6);

    /* A) 自由拟合：先粗后细（粗步长 R=2 / yt=4，再在最优附近细化） */
    for (R = 4; R <= 220; R += 2) {
      for (yt = yLo; yt <= yHi; yt += 4) {
        r = rmsFor(pts, R, yt);
        if (!best || r.err < best.err) best = { R: R, yt: yt, err: r.err, n: r.n };
      }
    }
    if (best) {
      var R0 = best.R, y0 = best.yt;
      for (R = Math.max(4, R0 - 3); R <= R0 + 3; R += 0.25) {
        for (yt = Math.max(yLo, y0 - 8); yt <= Math.min(yHi, y0 + 8); yt += 1) {
          r = rmsFor(pts, R, yt);
          if (r.err < best.err) best = { R: R, yt: yt, err: r.err, n: r.n };
        }
      }
    }
    out.free = best;

    var b2 = null;
    for (R = 4; R <= 220; R += 0.25) {                      // B) 物理屏幕圆角
      r = rmsFor(pts, R, H - R);
      if (!b2 || r.err < b2.err) b2 = { R: R, yt: H - R, err: r.err, n: r.n };
    }
    out.atScreenBottom = b2;

    var b3 = null;
    if (yBot < H - 2) {                                     // C) 可见底边上的圆角
      for (R = 4; R <= 220; R += 0.25) {
        r = rmsFor(pts, R, yBot - R);
        if (!b3 || r.err < b3.err) b3 = { R: R, yt: yBot - R, err: r.err, n: r.n };
      }
    }
    out.atVisibleBottom = b3;

    var cands = [];
    if (best) cands.push({ key: 'free', fit: best });
    if (b2) cands.push({ key: 'atScreenBottom', fit: b2 });
    if (b3) cands.push({ key: 'atVisibleBottom', fit: b3 });
    cands.sort(function (a, b) { return a.fit.err - b.fit.err; });
    out.ranked = cands.map(function (c) {
      return { model: c.key, R: c.fit.R, yt: c.fit.yt, err: Math.round(c.fit.err * 100) / 100, n: c.fit.n };
    });

    /* 模型选择（奥卡姆剃刀）：一段几十像素、几个像素深的短弧，本身就存在
       「半径大一点 + 弧顶低一点」与「半径小一点 + 弧顶高一点」的等价解。
       残差接近时优先采用自由度更少、物理上更合理的模型：
       屏幕物理圆角 > 可见底边圆角 > 自由拟合。 */
    var order = { atScreenBottom: 0, atVisibleBottom: 1, free: 2 };
    if (prefer) { order = {}; prefer.forEach(function (k, i) { order[k] = i; }); }
    var bestErr = cands.length ? cands[0].fit.err : Infinity;
    var lim = Math.max(bestErr * 1.7, bestErr + 0.4);
    var pool = cands.filter(function (c) { return c.fit.err <= lim; });
    pool.sort(function (a, b) { return (order[a.key] - order[b.key]) || (a.fit.err - b.fit.err); });
    out.best = pool.length ? pool[0].key : null;
    out.pick = pool.length ? pool[0] : null;
    out.alternatives = out.ranked;
    return out;
  }

  /** 给拟合结果补上「采用的是哪个模型」以及并列解释，便于报告展示 */
  function withModel(fit, f) {
    if (!fit) return null;
    return {
      R: fit.R, yt: fit.yt, err: Math.round(fit.err * 100) / 100, n: fit.n,
      model: f.best, alternatives: f.alternatives || []
    };
  }

  /* ---------------- 主分析入口 ---------------- */
  function analyze(buf, W, H, opt) {
    opt = opt || {};
    var t0 = Date.now();
    var notes = [], warnings = [];
    var L = layout(W, H);

    /* 1) 标定：先按朴素比例预测梳齿窗口，再用梳齿实测缩放并交叉校验 */
    var s0x = buf.width / W, s0y = buf.height / H;
    var ch = findComb(buf, 'h', W, H, s0x, s0y);
    var cv = findComb(buf, 'v', W, H, s0x, s0y);
    var sx, sy, calib;
    var agree = function (a, b) { return Math.abs(a / b - 1) <= 0.04; };
    var near0 = function (a) { return Math.abs(a / s0x - 1) <= 0.25 || Math.abs(a / s0y - 1) <= 0.25; };

    if (ch.ok && cv.ok && agree(ch.scale, cv.scale)) {
      sx = ch.scale; sy = cv.scale; calib = 'comb';
      if (!near0(sx)) {
        calib = 'comb(dpr?)';
        warnings.push('screen ' + W + '×' + H + ' 与截图比例不符（实测缩放 ' + sx.toFixed(3) +
          '，按 screen 推算 ' + s0x.toFixed(3) + '）：已采用梳齿实测值，screen.* 可能不准');
      }
    } else if (ch.ok || cv.ok) {
      var s = ch.ok ? ch.scale : cv.scale;
      if (near0(s)) { sx = s; sy = s; calib = ch.ok ? 'comb-h' : 'comb-v'; }
      else {
        sx = s0x; sy = s0y; calib = 'guess';
        warnings.push('梳齿实测缩放 ' + s.toFixed(3) + ' 与截图/screen 比例 ' + s0x.toFixed(3) +
          ' 差异过大，判定为误判，改用按尺寸推算的缩放');
      }
    } else {
      sx = s0x; sy = s0y; calib = 'guess';
      warnings.push('梳齿标定失败（' + (ch.reason || cv.reason || '') + '）：截图可能是被裁剪过 / 缩放方式非等比 / 太模糊，' +
        '已按截图与 screen 的尺寸比例推算缩放，底部与圆角结果都不可信');
    }
    var rx = (buf.width / W) / sx, ry = (buf.height / H) / sy;
    if (Math.abs(rx - 1) > 0.02) warnings.push('截图宽度与屏幕宽度不成比例（x 偏差 ' + Math.round((rx - 1) * 100) + '%）：截图可能被裁剪或不是整屏截图');
    if (Math.abs(ry - 1) > 0.02) warnings.push('截图高度与屏幕高度不成比例（y 偏差 ' + Math.round((ry - 1) * 100) + '%）：截图上下被裁过，底/顶边界结果不可信');

    /* 2) 微调缩放 —— 必须分轴做一维搜索：
     *    左右边缘条编码的是 y → 只能用来校 sy；上下边缘条编码的是 x → 只能校 sx。
     *    （混在一起打分会让 sx 漂移几个千分点，而误差在大 x/y 处累积成好几个色块，
     *      足以把整条边缘误判成「不可见」。） */
    var scoreAxis = function (axis, sCand) {
      var smp = (axis === 'y') ? makeSampler(buf, W, H, sx, sCand) : makeSampler(buf, W, H, sCand, sy);
      var ok = 0, tot = 0, i;
      if (axis === 'y') {
        for (i = 20; i < H - 20; i += 7) {
          tot += 2;
          if (smp.probe(STRIP / 2, i).ok) ok++;
          if (smp.probe(W - STRIP / 2, i).ok) ok++;
        }
      } else {
        for (i = 20; i < W - 20; i += 7) {
          tot += 2;
          if (smp.probe(i, STRIP / 2).ok) ok++;
          if (smp.probe(i, H - STRIP / 2).ok) ok++;
        }
      }
      return tot ? ok / tot : 0;
    };
    var rf = { sx: sx, sy: sy, scoreX: 0, scoreY: 0 };
    if (calib !== 'guess') {
      var pass, k, step, lim, c, sc, bestS;
      for (pass = 0; pass < 2; pass++) {
        step = pass === 0 ? 0.004 : 0.001;          // 先粗后细
        lim = pass === 0 ? 20 : 4;
        bestS = sy; sc = scoreAxis('y', sy);
        for (k = -lim; k <= lim; k++) { c = sy * (1 + k * step); var s1 = scoreAxis('y', c); if (s1 > sc) { sc = s1; bestS = c; } }
        sy = bestS; rf.scoreY = sc;
        bestS = sx; sc = scoreAxis('x', sx);
        for (k = -lim; k <= lim; k++) { c = sx * (1 + k * step); var s2 = scoreAxis('x', c); if (s2 > sc) { sc = s2; bestS = c; } }
        sx = bestS; rf.scoreX = sc;
      }
      rf.sx = sx; rf.sy = sy;
    }
    notes.push('标定=' + calib + ' 缩放 sx=' + sx.toFixed(4) + ' sy=' + sy.toFixed(4) +
      '（边缘条自校验：x ' + Math.round(rf.scoreX * 100) + '% / y ' + Math.round(rf.scoreY * 100) + '%）');

    var S = makeSampler(buf, W, H, sx, sy);

    /* 3) 可见矩形 */
    var yTop = null, yBot = null, i;
    for (i = 0; i < H; i++) { if (S.rowVisible(i)) { yTop = i; break; } }
    for (i = H - 1; i >= 0; i--) { if (S.rowVisible(i)) { yBot = i; break; } }
    if (yTop === null) {
      return {
        ok: false, version: VERSION, layout: L,
        warnings: warnings.concat(['截图中完全找不到可解码的 canvas 内容：请确认截图包含整块 canvas（不要把页面上下裁掉），且未被压缩得太糊']),
        notes: notes, scale: { sx: sx, sy: sy }
      };
    }

    /* 4) 圆角边界采样
     *   · 只收「确实被切掉」的点：可见起点必须 > 0，否则那只是正常的未被遮挡边界，
     *     会污染圆弧拟合。
     *   · 扫描范围要覆盖 边缘外 z+40 行，而不是从 yBot 往上——遮挡物自身带圆角时，
     *     可用的像素恰恰位于 yBot 之下的凹口里（yBot 之上反而全被遮住）。 */
    var z = L.z, zz = z + 40;
    var blPts = [], brPts = [], tlPts = [], trPts = [], y, v, pr;
    var nbL = [], nbR = [], ntL = [], ntR = [];          // 遮挡物自带圆角的凹口点
    var yBotLo = Math.max(0, H - zz), yTopHi = Math.min(H - 1, zz);

    function sampleRow(yy, flip, ptsL, ptsR, notL, notR) {
      pr = S.leadingRun(yy, 'near');
      // Corner fitting uses the screen edge as y=H. Reflect top rows across that
      // edge (H-y), not across the last pixel index (H-1-y), or the anchored
      // screen-corner model is shifted by one pixel and can bias short arcs.
      var cornerY = flip ? H - yy : yy;
      var notchY = yy;
      // 只收「深度 > 编码条宽 + 2」的凹口：更浅的游程末端落在装饰区，无法判定，
      // 否则每一行都会在 x≈STRIP 处被装饰区截断，产生成片假凹口。
      if (pr.a > 0) ptsL.push([pr.a, cornerY]);
      else if (pr.e !== null && pr.e > STRIP + 2 && pr.e < z - 2) notL.push([pr.e, notchY]);
      pr = S.leadingRun(yy, 'far');
      if (pr.a > 0) ptsR.push([pr.a, cornerY]);
      else if (pr.e !== null && pr.e > STRIP + 2 && pr.e < z - 2) notR.push([pr.e, notchY]);
    }
    for (y = yBotLo; y < H; y++) sampleRow(y, false, blPts, brPts, nbL, nbR);
    for (y = 0; y <= yTopHi; y++) sampleRow(y, true, tlPts, trPts, ntL, ntR);

    notes.push('可见区 y=' + yTop + '…' + yBot + '，屏幕圆角边界点 左下/右下/左上/右上 = ' +
      blPts.length + '/' + brPts.length + '/' + tlPts.length + '/' + trPts.length +
      '；遮挡物凹口点 = ' + nbL.length + '/' + nbR.length + '/' + ntL.length + '/' + ntR.length);

    /* 安全区：从上下两端找第一条「整行可见」的行。这就是可以直接摆放 UI、
       不必担心被系统 / 浏览器 UI 或屏幕圆角切掉的范围。 */
    var safeTop = yTop, safeBottom = yBot, si;
    for (si = 0; si < H; si++) if (S.rowFull(si)) { safeTop = si; break; }
    for (si = H - 1; si >= 0; si--) if (S.rowFull(si)) { safeBottom = si; break; }

    notes.push('整行可见的安全区 y=' + safeTop + '…' + safeBottom +
      '（上方被切 ' + safeTop + 'px / 下方被切 ' + (H - 1 - safeBottom) + 'px）');

    var fitBL = fitCorner(blPts, H, yBot);
    var fitBR = fitCorner(brPts, H, yBot);
    // Top rows were reflected with H-y above, so the visible edge must use the
    // same coordinate convention (rather than the last pixel index H-1-y).
    var topVisibleBottom = H - yTop;
    var fitTL = fitCorner(tlPts, H, topVisibleBottom);
    var fitTR = fitCorner(trPts, H, topVisibleBottom);

    /* 遮挡物凹口：形状是圆角，但长在遮挡物（工具条 / 面板）上而不是屏幕边缘。
       底部遮挡物的凹口，割深随 y 减小而增大 → 翻转到 y'=H-1-y 后与屏幕圆角同一模型族；
       顶部遮挡物的凹口方向相反 → 直接用原坐标。弧顶位置必须自由 → 只允许 free 模型。 */
    function fitNotch(pts, flip) {
      var p = flip ? pts.map(function (q) { return [q[0], H - 1 - q[1]]; }) : pts;
      var f = fitCorner(p, H, H - 1, ['free'], [0, H]);
      if (!f || !f.free || f.free.n < 6 || f.free.err > 1.5) return null;
      return {
        R: f.free.R, err: Math.round(f.free.err * 100) / 100, n: f.free.n, flipped: flip,
        // 遮挡物朝向屏幕内部的直边位置
        edgeRow: Math.round(flip ? (H - 1 - f.free.yt - f.free.R) : (f.free.yt + f.free.R))
      };
    }
    var notchFits = {
      bottomLeft: fitNotch(nbL, true), bottomRight: fitNotch(nbR, true),
      topLeft: fitNotch(ntL, false), topRight: fitNotch(ntR, false)
    };

    var pickR = function (f) { return (f && f.pick) ? f.pick.fit : null; };
    var res = {
      ok: true, version: VERSION,
      screen: { W: W, H: H }, screenshot: { width: buf.width, height: buf.height },
      layout: L,
      scale: { sx: sx, sy: sy, mode: calib, score: rf.scoreY, scoreX: rf.scoreX, scoreY: rf.scoreY, combH: ch, combV: cv },
      visible: {
        top: yTop, bottom: yBot, bottomOccluded: H - 1 - yBot, heightCss: yBot - yTop + 1,
        safeTop: safeTop, safeBottom: safeBottom
      },
      boundary: { bottomLeft: blPts, bottomRight: brPts, topLeft: tlPts, topRight: trPts },
      corners: {
        bottomLeft: withModel(pickR(fitBL), fitBL), bottomRight: withModel(pickR(fitBR), fitBR),
        topLeft: withModel(pickR(fitTL), fitTL), topRight: withModel(pickR(fitTR), fitTR)
      },
      fits: { bottomLeft: fitBL, bottomRight: fitBR, topLeft: fitTL, topRight: fitTR },
      notchFits: notchFits,
      warnings: warnings, notes: notes, ms: Date.now() - t0
    };

    var bot = ['bottomLeft', 'bottomRight'].filter(function (k) { return res.corners[k]; })
      .map(function (k) { return { k: k, R: res.corners[k].R, model: res.corners[k].model, err: res.corners[k].err, n: res.corners[k].n }; });
    var top = ['topLeft', 'topRight'].filter(function (k) { return res.corners[k]; })
      .map(function (k) { return { k: k, R: res.corners[k].R, model: res.corners[k].model, err: res.corners[k].err, n: res.corners[k].n }; });
    var pick = function (arr) {
      var good = arr.filter(function (a) { return a.err <= 2.5 && a.n >= 8; });
      var use = good.length ? good : arr;
      if (!use.length) return null;
      var rs = use.map(function (a) { return a.R; }).sort(function (a, b) { return a - b; });
      var m = rs.length % 2 ? rs[(rs.length - 1) / 2] : (rs[rs.length / 2 - 1] + rs[rs.length / 2]) / 2;
      return Math.round(m * 2) / 2;
    };
    /* 遮挡物圆角（工具条/面板自带圆角）—— 单独汇报，绝不能当成屏幕半径 */
    var notch = [];
    Object.keys(notchFits).forEach(function (k) {
      var f = notchFits[k];
      if (!f) return;
      notch.push({ corner: k, R: f.R, err: f.err, n: f.n, edgeRow: f.edgeRow });
    });
    res.notch = notch;

    res.suggest = {
      displayRadius: pick(bot) || pick(top),
      bottomRadius: pick(bot),
      topRadius: pick(top),
      perCorner: bot.concat(top),
      bottomOccluded: res.visible.bottomOccluded,
      detail: 'R = ' + (pick(bot) || pick(top)) + 'dp；底部被遮 ' + res.visible.bottomOccluded + 'px'
    };
    return res;
  }

  return {
    VERSION: VERSION,
    CELL: CELL, STRIP: STRIP, MAX_ZONE: MAX_ZONE,
    TICK_SPACING: TICK_SPACING, TICK_H: TICK_H, TICK_SCOPE: TICK_SCOPE,
    gray12: gray12, ungray12: ungray12, codeColor: codeColor,
    HCode: HCode, VCode: VCode, layout: layout,
    regionOf: regionOf, modelColorAt: modelColorAt, codeAxisAt: codeAxisAt,
    paint: paint, findComb: findComb, makeSampler: makeSampler,
    cutOf: cutOf, fitCorner: fitCorner, analyze: analyze
  };
});