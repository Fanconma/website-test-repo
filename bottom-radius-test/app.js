/*!
 * app.js — 屏幕底部遮挡 & 圆角半径实测工具（页面逻辑）
 * 依赖：ruler.js（位置条码编码 / 绘制 / 截图反解）
 *
 * 思路
 * ─────────────────────────────────────────────────────────────
 * ① 主屏幕 canvas：整屏绘制「绝对位置条码」（每 2 CSS px 一个色块，颜色 =
 *    屏幕绝对坐标的格雷编码）。四边 12px 条 + 四角探针方块是纯条码区；
 *    中央十字是装饰区。
 * ② 页面里能直接"量"到的（不需要截图）：
 *      · visualViewport / innerHeight 与 screen 的差值 → 上下被浏览器 UI 占掉多少
 *      · elementFromPoint 命中测试 → 哪些位置能命中 canvas
 *      · env(safe-area-inset-*)
 * ③ 页面里量不到的（关键）：屏幕物理圆角切掉的部分 —— 因为 JS 读不到系统合成器
 *    的输出（getImageData 读到的永远是自己画进去的缓存）。所以用截图回读：
 *    把截图贴进来，解码每个像素的绝对坐标 —— 能解码 = 真的显示出来了；
 *    解不了 = 被 UI 盖住，或在圆角之外。由此逐像素得到可见区边界，再拟合半径。
 */
(function () {
  'use strict';

  var R = window.ScreenRuler;
  var $ = function (id) { return document.getElementById(id); };
  var S = {
    W: 0, H: 0, dpr: 1,
    shot: null,        // { buf, w, h, url }
    res: null,
    hidden: false
  };

  /* ================= 尺寸与探针画布 ================= */
  function screenSize() {
    var vv = window.visualViewport;
    var w = Math.max(
      window.innerWidth || 0,
      vv ? Math.round(vv.width * (vv.scale || 1)) : 0,
      (window.screen && screen.width) || 0
    );
    var h = Math.max(
      window.innerHeight || 0,
      vv ? Math.round(vv.height * (vv.scale || 1)) : 0,
      (window.screen && screen.height) || 0
    );
    // 某些浏览器的 screen.* 是设备像素，用 innerWidth/dpr 交叉检查
    if (window.screen && screen.width && window.innerWidth) {
      var r = screen.width / window.innerWidth;
      if (r > 2.5) w = window.innerWidth;      // screen 给的是设备像素 → 以视口为准
      var r2 = screen.height / window.innerHeight;
      if (r2 > 2.5) h = Math.max(window.innerHeight, h / (window.devicePixelRatio || 1));
    }
    return { W: Math.round(w), H: Math.round(h) };
  }

  function paintProbe() {
    var sz = S.forceSize || screenSize();
    S.W = sz.W; S.H = sz.H;
    S.dpr = Math.min(window.devicePixelRatio || 1, 3);
    while (S.W * S.H * S.dpr * S.dpr > 7e6 && S.dpr > 1) S.dpr = Math.round((S.dpr - 0.25) * 100) / 100;
    var cv = $('probe');
    cv.style.width = S.W + 'px';
    cv.style.height = S.H + 'px';
    cv.width = Math.round(S.W * S.dpr);
    cv.height = Math.round(S.H * S.dpr);
    var ctx = cv.getContext('2d', { alpha: false });
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    var vv = window.visualViewport;
    R.paint(ctx, S.W, S.H, S.dpr, {
      info: {
        deviceW: window.screen ? screen.width : null,
        deviceH: window.screen ? screen.height : null,
        innerW: window.innerWidth, innerH: window.innerHeight,
        label: 'visualViewport ' + (vv ? Math.round(vv.width) + '×' + Math.round(vv.height) + ' @' + vv.offsetTop : 'n/a')
      },
      legend: [12, 20, 28, 36, 44, 52, 62, 72]
    });
    syncOffset();
  }

  function syncOffset() {
    var vv = window.visualViewport, cv = $('probe');
    if (!vv) return;
    cv.style.transform = 'translate(' + (-vv.offsetLeft) + 'px,' + (-vv.offsetTop) + 'px)';
  }

  /* ================= 免截图的自动探测 ================= */
  function ssGet(prop) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;padding-top:env(' + prop + ')';
    document.body.appendChild(el);
    var v = parseFloat(getComputedStyle(el).paddingTop) || 0;
    el.parentNode.removeChild(el);
    return v;
  }

  function hitTest() {
    var rows = [];
    var xs = [1, Math.round(S.W / 2), S.W - 2];
    var ys = [];
    for (var y = S.H - 1; y >= Math.max(0, S.H - 200); y -= 2) ys.push(y);
    var firstHit = null, counts = { probe: 0, other: 0, none: 0 };
    ys.forEach(function (yy) {
      var r = { y: yy, probe: false, other: false };
      xs.forEach(function (xx) {
        var el = null;
        try { el = document.elementFromPoint(xx, yy); } catch (e) { el = null; }
        if (!el) { counts.none++; r.other = true; return; }
        if (el.id === 'probe' || (el.tagName === 'CANVAS' && el.id === 'probe')) { counts.probe++; r.probe = true; }
        else { counts.other++; r.other = true; }
      });
      if (firstHit === null && r.probe && !r.other) firstHit = yy;
      rows.push(r);
    });
    return { firstHit: firstHit, counts: counts };
  }

  function collectInfo() {
    var vv = window.visualViewport;
    var vh = vv ? vv.height : window.innerHeight;
    var vTop = vv ? vv.offsetTop : 0;
    var hit = hitTest();
    var est = {
      W: S.W, H: S.H, dpr: S.dpr,
      innerW: window.innerWidth, innerH: window.innerHeight,
      screenW: window.screen ? screen.width : null,
      screenH: window.screen ? screen.height : null,
      vvW: vv ? Math.round(vv.width * 10) / 10 : null,
      vvH: vv ? Math.round(vv.height * 10) / 10 : null,
      vvTop: vv ? Math.round(vv.offsetTop * 10) / 10 : null,
      vvScale: vv ? vv.scale : null,
      safeTop: ssGet('safe-area-inset-top'),
      safeBottom: ssGet('safe-area-inset-bottom'),
      safeLeft: ssGet('safe-area-inset-left'),
      safeRight: ssGet('safe-area-inset-right'),
      bottomChrome: Math.max(0, Math.round(S.H - vh - vTop)),   // 估算：底部被 UI 占掉的高度
      hitFirstY: hit.firstHit,
      hitCounts: hit.counts,
      ua: navigator.userAgent
    };
    est.hitBottomGap = est.hitFirstY === null ? null : S.H - est.hitFirstY;
    return est;
  }

  /* ================= HUD ================= */
  function renderHud() {
    var e = S.info || (S.info = collectInfo());
    var rows = [
      ['屏幕（CSS px）', e.W + ' × ' + e.H],
      ['devicePixelRatio', e.dpr + '（条码按此分辨率绘制）'],
      ['screen.*', (e.screenW || '?') + ' × ' + (e.screenH || '?')],
      ['innerWidth/Height', e.innerW + ' × ' + e.innerH],
      ['visualViewport', (e.vvW || '?') + ' × ' + (e.vvH || '?') + ' · offsetTop ' + e.vvTop + ' · scale ' + e.vvScale],
      ['safe-area 上/右/下/左', e.safeTop + ' / ' + e.safeRight + ' / ' + e.safeBottom + ' / ' + e.safeLeft + ' px'],
      ['底部被浏览器 UI 占用（估算）', e.bottomChrome + ' px'],
      ['命中测试：最靠下的 canvas 位置', e.hitFirstY === null ? '无法命中（UI 覆盖或超出视口）' : 'y = ' + e.hitFirstY + '（离屏幕底 ' + e.hitBottomGap + 'px）'],
      ['命中统计', 'canvas ' + e.hitCounts.probe + ' / 其他元素 ' + e.hitCounts.other + ' / 无 ' + e.hitCounts.none]
    ];
    $('auto').innerHTML = rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
    }).join('');
  }

  function hideHud(hide) {
    S.hidden = hide;
    $('hud').style.display = hide ? 'none' : '';
    $('hint').style.display = hide ? 'block' : 'none';
    if (hide) try { window.scrollTo(0, 0); } catch (e) {}
  }

  /* ================= 截图解码 ================= */
  function decodeImage(img) {
    var maxDim = 2400;
    var iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    var k = Math.min(1, maxDim / Math.max(iw, ih));
    var w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    S.shot = { buf: { data: data.data, width: w, height: h }, w: w, h: h };
    var t0 = performance.now();
    S.res = R.analyze(S.shot.buf, S.W, S.H);
    S.res.ms = Math.round(performance.now() - t0);
    renderReport();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pct(x) { return Math.round(x * 100) + '%'; }
  function n2(x) { return x === null || x === undefined ? '—' : (Math.round(x * 100) / 100); }

  function renderReport() {
    var r = S.res, e = S.info || collectInfo();
    var html = '';
    var conf = '高', cls = 'ok';
    if (r.warnings && r.warnings.length) { conf = '低'; cls = 'bad'; }
    else if (r.scale.scoreY < 0.8 || r.scale.scoreX < 0.8) { conf = '中'; cls = 'mid'; }

    if (!r.ok) {
      html += '<div class="alert bad"><b>解码失败</b><br>' + r.warnings.join('<br>') + '</div>';
      html += '<p class="mut">当前可用信息（来自免截图探测）：底部被占 <b>' + e.bottomChrome + 'px</b>，' +
        '命中测试的最靠下位置 y = <b>' + (e.hitFirstY === null ? '无' : e.hitFirstY) + '</b>。</p>';
      $('report').innerHTML = html;
      return;
    }

    var v = r.visible, sug = r.suggest;
    var dispR = sug.displayRadius;

    /* 结论 */
    html += '<div class="verdict ' + cls + '">';
    html += '<div class="vrow"><span class="vnum">' + (dispR === null ? '—' : dispR) + '</span><span class="vunit">dp</span>' +
      '<span class="vlabel">屏幕圆角半径<br><span class="mut">（由可见区边界圆弧拟合，1 CSS px = 1 dp/pt）</span></span></div>';
    html += '<div class="vmeta">可信度：<b>' + conf + '</b> · 解码耗时 ' + r.ms + 'ms · 截图 ' + r.screenshot.width + '×' + r.screenshot.height +
      ' · 标定 ' + r.scale.mode + '（x ' + pct(r.scale.scoreX) + ' / y ' + pct(r.scale.scoreY) + '）</div>';
    html += '</div>';

    /* 空格 / 遮挡 */
    html += '<h3>屏幕底部与可见区</h3><table class="kv">';
    html += rowTd('可见区（有 canvas 像素）', 'y = ' + v.top + ' … ' + v.bottom);
    html += rowTd('底部完全被遮的高度', '<b>' + v.bottomOccluded + '</b> px　' + (v.bottomOccluded === 0 ? '（到底完全可见：QQ 内置浏览器全屏态）' : '（在此高度内没有任何 canvas 像素：浏览器工具栏 / 系统手势条）'));
    html += rowTd('整行可见的安全区', '<b>y = ' + v.safeTop + ' … ' + v.safeBottom + '</b>');
    html += rowTd('上方 / 下方建议留白', v.safeTop + ' px / ' + (S.H - 1 - v.safeBottom) + ' px');
    html += rowTd('免截图估算对照', '底部被占 ' + e.bottomChrome + 'px · 命中测试最下位置 y=' + (e.hitFirstY === null ? '无' : e.hitFirstY));
    html += '</table>';

    /* 圆角 */
    html += '<h3>四角半径拟合</h3><table class="kv">';
    ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].forEach(function (k) {
      var c = r.corners[k], name = { topLeft: '左上', topRight: '右上', bottomLeft: '左下', bottomRight: '右下' }[k];
      if (!c) { html += rowTd(name, '<span class="mut">测不到（被 UI 完全遮挡 / 该角未切 / 边界点不足）</span>'); return; }
      var alt = (c.alternatives || []).map(function (a) {
        return a.model + '(R=' + n2(a.R) + ',残差' + n2(a.err) + ')';
      }).join(' · ');
      html += rowTd(name, 'R = <b>' + n2(c.R) + '</b> px · 模型 <code>' + c.model + '</code> · 弧顶 y=' + n2(c.yt) +
        ' · 残差 ' + n2(c.err) + 'px · 边界点 ' + c.n + ' 个<br><span class="mut">并列解：' + alt + '</span>');
    });
    html += '</table>';
    html += '<p class="mut">模型含义：<code>atScreenBottom</code> = 弧顶在屏幕底边的物理圆角（最可信）；' +
      '<code>atVisibleBottom</code> = 圆弧顶在「可见底边」上（浏览器工具条自身的圆角）；' +
      '<code>free</code> = 弧顶自由，说明这段弧长在某个遮挡物上，未必是屏幕圆角。</p>';

    /* 遮挡物凹口 */
    if (r.notch && r.notch.length) {
      html += '<h3>检测到的「遮挡物圆角」（不是屏幕半径）</h3><table class="kv">';
      r.notch.forEach(function (n) {
        html += rowTd(n.corner, 'R ≈ ' + n2(n.R) + ' px · 遮挡物朝向屏幕内的直边在 y ≈ ' + n.edgeRow +
          ' · 凹口边界点 ' + n.n + ' 个 · 残差 ' + n2(n.err));
      });
      html += '</table>';
    }

    /* 警告 */
    if (r.warnings.length) {
      html += '<h3>警告（影响可信度）</h3><div class="alert bad">' + r.warnings.join('<br>') + '</div>';
    }
    html += '<h3>诊断日志</h3><pre class="log">' + r.notes.join('\n') + '</pre>';

    /* 可视化 */
    html += '<h3>可见性重建（截图 → 逐点解码）</h3>' +
      '<canvas id="overlay" class="overlay"></canvas>' +
      '<p class="mut">绿 = 该点确定可见（条码解码成功）；红 = 不可见（被遮挡或落在圆角外）；' +
      '灰 = 装饰区（不参与编码）。黄线 = 拟合出的圆角圆弧。<b>注意灰底区域只能靠四边条码与四角探针推断，不是逐像素结论。</b></p>';

    html += '<h3>结果 JSON</h3><textarea class="json" id="jsonOut" readonly rows="10"></textarea>' +
      '<p><button class="btn" id="copyJson">复制 JSON</button></p>';
    $('report').innerHTML = html;

    drawOverlay();
    $('jsonOut').value = JSON.stringify(exportJson(), null, 2);
    $('copyJson').onclick = function () {
      var t = $('jsonOut');
      t.select();
      try { document.execCommand('copy'); this.textContent = '已复制 ✓'; } catch (err) { this.textContent = '请手动复制'; }
      var b = this; setTimeout(function () { b.textContent = '复制 JSON'; }, 1500);
    };
  }

  function rowTd(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }

  function exportJson() {
    var r = S.res, e = S.info || {};
    return {
      tool: 'bottom-radius-test', version: R.VERSION, at: new Date().toISOString(),
      ua: e.ua,
      screen: { W: S.W, H: S.H, dpr: S.dpr, screenW: e.screenW, screenH: e.screenH, innerH: e.innerH, vvH: e.vvH, vvTop: e.vvTop },
      safeAreaInset: { top: e.safeTop, bottom: e.safeBottom, left: e.safeLeft, right: e.safeRight },
      estimate: { bottomChrome: e.bottomChrome, hitFirstY: e.hitFirstY, hitBottomGap: e.hitBottomGap },
      scale: r.ok ? { sx: r.scale.sx, sy: r.scale.sy, mode: r.scale.mode, scoreX: r.scale.scoreX, scoreY: r.scale.scoreY } : null,
      visible: r.ok ? r.visible : null,
      radius: r.ok ? {
        suggestion: r.suggest.displayRadius, bottom: r.suggest.bottomRadius, top: r.suggest.topRadius,
        corners: { bottomLeft: r.corners.bottomLeft, bottomRight: r.corners.bottomRight, topLeft: r.corners.topLeft, topRight: r.corners.topRight }
      } : null,
      notch: r.ok ? r.notch : null,
      warnings: r.warnings, ms: r.ms
    };
  }

  /* ================= 可视化 ================= */
  function drawOverlay() {
    var r = S.res, shot = S.shot;
    var cv = $('overlay');
    if (!cv || !shot || !r.ok || typeof cv.getContext !== 'function') return;
    if (!cv.getContext('2d')) return;
    var boxW = Math.min(340, window.innerWidth - 40);
    var k = boxW / shot.w;
    var boxH = Math.round(shot.h * k);
    cv.width = boxW; cv.height = boxH;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, boxW, boxH);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.92;
    shot.img = shot.img || shotImg();
    ctx.drawImage(shot.img, 0, 0, boxW, boxH);
    ctx.globalAlpha = 1;

    var sm = R.makeSampler(shot.buf, S.W, S.H, r.scale.sx, r.scale.sy);
    var step = 3;
    for (var y = 0; y < S.H; y += step) {
      for (var x = 0; x < S.W; x += step) {
        var pr = sm.probe(x, y);
        if (pr.reason === 'deco') continue;
        var px = Math.round((x + 0.5) * r.scale.sx * k), py = Math.round((y + 0.5) * r.scale.sy * k);
        ctx.fillStyle = pr.ok ? 'rgba(60,220,130,0.55)' : 'rgba(255,70,90,0.5)';
        ctx.fillRect(px, py, Math.max(1, Math.ceil(step * r.scale.sx * k)), Math.max(1, Math.ceil(step * r.scale.sy * k)));
      }
    }
    // 拟合圆弧
    ctx.lineWidth = 1.4;
    ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].forEach(function (name) {
      var c = r.corners[name];
      if (!c) return;
      ctx.strokeStyle = 'rgba(255,205,60,0.95)';
      ctx.beginPath();
      var n = 24;
      for (var i = 0; i <= n; i++) {
        var yy = c.yt + c.R * (i / n);
        var xx = R.cutOf(c.R, c.yt, yy);
        var sx = (name === 'topLeft' || name === 'bottomLeft') ? xx : S.W - xx;
        var sy = name === 'bottomLeft' || name === 'bottomRight' ? yy : S.H - yy;
        var a = (sx + 0.5) * r.scale.sx * k, b = (sy + 0.5) * r.scale.sy * k;
        if (i === 0) ctx.moveTo(a, b); else ctx.lineTo(a, b);
      }
      ctx.stroke();
    });
    // 安全区
    ctx.strokeStyle = 'rgba(90,200,255,0.9)';
    if (ctx.setLineDash) ctx.setLineDash([4, 3]);
    ctx.strokeRect(0.5, (r.visible.safeTop + 0.5) * r.scale.sy * k, boxW - 1,
      (r.visible.safeBottom - r.visible.safeTop) * r.scale.sy * k);
    if (ctx.setLineDash) ctx.setLineDash([]);
  }
  function shotImg() {
    var c = document.createElement('canvas');
    c.width = S.shot.w; c.height = S.shot.h;
    var d = new Uint8ClampedArray(S.shot.buf.data);
    c.getContext('2d').putImageData(new ImageData(d, S.shot.w, S.shot.h), 0, 0);
    return c;
  }

  /* ================= 粘贴 / 选图 ================= */
  function handleFiles(files) {
    for (var i = 0; i < files.length; i++) {
      if (files[i].type && files[i].type.indexOf('image') === 0) { loadFile(files[i]); return; }
    }
    if (files.length) loadFile(files[0]);
  }
  function loadFile(f) {
    var url = URL.createObjectURL(f);
    var img = new Image();
    img.onload = function () { decodeImage(img); };
    img.onerror = function () { alert('图片读取失败，请换一张截图'); };
    img.src = url;
  }

  document.addEventListener('paste', function (ev) {
    var items = (ev.clipboardData && ev.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') === 0) {
        var f = items[i].getAsFile();
        if (f) { loadFile(f); ev.preventDefault(); return; }
      }
    }
  });

  /* ================= 初始化 ================= */
  function init() {
    paintProbe();
    S.info = collectInfo();
    renderHud();

    $('btnHide').onclick = function () { hideHud(true); };
    $('hint').onclick = function () { hideHud(false); S.info = collectInfo(); renderHud(); };
    $('file').onchange = function (ev) { if (ev.target.files) handleFiles(ev.target.files); };
    $('btnRedraw').onclick = function () { paintProbe(); S.info = collectInfo(); renderHud(); };
    $('btnManual').onclick = function () {
      var w = parseInt($('manW').value, 10), h = parseInt($('manH').value, 10);
      if (!(w > 50 && h > 50)) { alert('请填入合理的 CSS 像素尺寸，例如 393 × 852'); return; }
      S.forceSize = { W: w, H: h };
      paintProbe(); S.info = collectInfo(); renderHud();
      alert('已按 ' + w + '×' + h + ' 重绘探针。请重新截图并粘贴。');
    };
    $('zone').onclick = function () { $('file').click(); };

    var t = null;
    function onResize() {
      syncOffset();
      clearTimeout(t);
      t = setTimeout(function () { paintProbe(); S.info = collectInfo(); renderHud(); }, 250);
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
      window.visualViewport.addEventListener('scroll', syncOffset);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
