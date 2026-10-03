(function () {
  'use strict';

  var R = window.ScreenRuler;
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    W: 0, H: 0, dpr: 1,
    shot: null, res: null, info: null,
    hidden: false, forceSize: null
  };

  /* ================= 状态栏 ================= */
  function setStatus(msg, cls) {
    var el = $('status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = cls || '';
  }

  /* ================= 尺寸与探针画布 ================= */
  function screenSize() {
    var vv = window.visualViewport;
    var w = Math.max(window.innerWidth || 0,
      vv ? Math.round(vv.width * (vv.scale || 1)) : 0,
      (window.screen && screen.width) || 0);
    var h = Math.max(window.innerHeight || 0,
      vv ? Math.round(vv.height * (vv.scale || 1)) : 0,
      (window.screen && screen.height) || 0);
    if (window.screen && screen.width && window.innerWidth) {
      if (screen.width / window.innerWidth > 2.5) w = window.innerWidth;
      if (screen.height / window.innerHeight > 2.5) h = Math.max(window.innerHeight, h / (window.devicePixelRatio || 1));
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
      legend: null
    });
    syncOffset();
    setStatus(S.W + '×' + S.H + ' @' + S.dpr + 'x');
  }

  function syncOffset() {
    var vv = window.visualViewport, cv = $('probe');
    if (!vv || !cv) return;
    cv.style.transform = 'translate(' + (-vv.offsetLeft) + 'px,' + (-vv.offsetTop) + 'px)';
  }

  /* ================= 自动探测 ================= */
  function ssGet(prop) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;padding-top:env(' + prop + ')';
    document.body.appendChild(el);
    var v = parseFloat(getComputedStyle(el).paddingTop) || 0;
    el.parentNode.removeChild(el);
    return v;
  }

  function hitTest() {
    var xs = [1, Math.round(S.W / 2), S.W - 2];
    var firstHit = null, counts = { probe: 0, other: 0, none: 0 };
    for (var y = S.H - 1; y >= Math.max(0, S.H - 200); y -= 2) {
      var allProbe = true, anyOther = false;
      for (var i = 0; i < xs.length; i++) {
        var el = null;
        try { el = document.elementFromPoint(xs[i], y); } catch (e) { el = null; }
        if (!el) { counts.none++; anyOther = true; allProbe = false; continue; }
        if (el.id === 'probe') counts.probe++;
        else { counts.other++; anyOther = true; allProbe = false; }
      }
      if (firstHit === null && allProbe && !anyOther) firstHit = y;
    }
    return { firstHit: firstHit, counts: counts };
  }

  function collectInfo() {
    var vv = window.visualViewport;
    var vh = vv ? vv.height : window.innerHeight;
    var vTop = vv ? vv.offsetTop : 0;
    var hit = hitTest();
    return {
      W: S.W, H: S.H, dpr: S.dpr,
      innerW: window.innerWidth, innerH: window.innerHeight,
      screenW: window.screen ? screen.width : null,
      screenH: window.screen ? screen.height : null,
      vvW: vv ? Math.round(vv.width * 10) / 10 : null,
      vvH: vv ? Math.round(vv.height * 10) / 10 : null,
      vvTop: vv ? Math.round(vv.offsetTop * 10) / 10 : null,
      safeTop: ssGet('safe-area-inset-top'),
      safeBottom: ssGet('safe-area-inset-bottom'),
      safeLeft: ssGet('safe-area-inset-left'),
      safeRight: ssGet('safe-area-inset-right'),
      bottomChrome: Math.max(0, Math.round(S.H - vh - vTop)),
      hitFirstY: hit.firstHit,
      hitCounts: hit.counts,
      ua: navigator.userAgent
    };
  }

  function renderAuto() {
    var e = S.info || (S.info = collectInfo());
    var rows = [
      ['屏幕', e.W + ' × ' + e.H],
      ['dpr', String(e.dpr)],
      ['screen', (e.screenW || '?') + ' × ' + (e.screenH || '?')],
      ['innerWidth/Height', e.innerW + ' × ' + e.innerH],
      ['visualViewport', (e.vvW || '?') + ' × ' + (e.vvH || '?') + '  offsetTop ' + e.vvTop],
      ['safe-area', e.safeTop + ' / ' + e.safeRight + ' / ' + e.safeBottom + ' / ' + e.safeLeft],
      ['底部占用', e.bottomChrome + ' px'],
      ['命中测试', e.hitFirstY === null ? '—' : 'y = ' + e.hitFirstY],
      ['命中统计', 'canvas ' + e.hitCounts.probe + ' / 其他 ' + e.hitCounts.other + ' / 无 ' + e.hitCounts.none]
    ];
    $('auto').innerHTML = rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
    }).join('');
  }

  function hideHud(hide) {
    S.hidden = hide;
    $('hud').style.display = hide ? 'none' : '';
    $('hint').className = hide ? 'on' : '';
    if (hide) { try { window.scrollTo(0, 0); } catch (e) {} }
  }

  /* ================= 图片输入 ================= */
  function loadBlob(blob) {
    if (!blob) return;
    setStatus('读取中…');
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () { decodeImage(img); };
    img.onerror = function () { setStatus('图片解码失败', 'err'); };
    img.src = url;
  }

  function loadFile(f) { loadBlob(f); }

  function handleFiles(files) {
    if (!files || !files.length) { setStatus('未取到文件', 'err'); return; }
    for (var i = 0; i < files.length; i++) {
      var t = files[i].type || '';
      if (t.indexOf('image') === 0 || !t) { loadFile(files[i]); return; }
    }
    loadFile(files[0]);
  }

  function pasteFromClipboard() {
    var done = false;
    function fallback() { if (!done) { done = true; openPastebox(); } }
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) { fallback(); return; }
      setStatus('读取剪贴板…');
      navigator.clipboard.read().then(function (items) {
        var chain = Promise.resolve();
        var found = null;
        items.forEach(function (it) {
          (it.types || []).forEach(function (t) {
            if (!found && t.indexOf('image') === 0) {
              chain = chain.then(function () { return it.getType(t); }).then(function (b) { found = b; });
            }
          });
        });
        return chain.then(function () {
          if (found) { done = true; closePastebox(); loadBlob(found); }
          else fallback();
        });
      }).catch(function () { fallback(); });
    } catch (e) { fallback(); }
  }

  function openPastebox() {
    var box = $('pastebox');
    box.className = 'on';
    box.textContent = '';
    setStatus('长按输入框粘贴');
    try { box.focus(); } catch (e) {}
  }
  function closePastebox() { var b = $('pastebox'); if (b) { b.className = ''; b.textContent = ''; } }

  /* 截图 → 解码 */
  function decodeImage(img) {
    var iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    if (!iw || !ih) { setStatus('图片尺寸为 0', 'err'); return; }
    var maxDim = 2400, k = Math.min(1, maxDim / Math.max(iw, ih));
    var w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    S.shot = { buf: { data: data.data, width: w, height: h }, w: w, h: h, img: null };
    var t0 = performance.now ? performance.now() : Date.now();
    S.res = R.analyze(S.shot.buf, S.W, S.H);
    S.res.ms = Math.round((performance.now ? performance.now() : Date.now()) - t0);
    closePastebox();
    renderReport();
    setStatus('已解码 ' + w + '×' + h, S.res.ok ? 'ok' : 'err');
    try { $('result').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }

  /* ================= 报告 ================= */
  function n2(x) { return (x === null || x === undefined || isNaN(x)) ? '—' : (Math.round(x * 100) / 100); }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function rowTd(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }

  function renderReport() {
    var r = S.res, out = $('result');
    var html = '';

    if (!r.ok) {
      html += '<div class="alert"><b>解码失败</b><br>' + r.warnings.join('<br>') + '</div>';
      out.innerHTML = html;
      return;
    }

    var v = r.visible, sug = r.suggest;
    var cls = r.warnings.length ? 'bad' : (r.scale.scoreY < 0.8 || r.scale.scoreX < 0.8 ? 'mid' : 'ok');
    var conf = cls === 'ok' ? '高' : cls === 'mid' ? '中' : '低';

    html += '<div class="verdict ' + cls + '">' +
      '<div class="vrow"><span class="vnum">' + (sug.displayRadius === null ? '—' : sug.displayRadius) + '</span>' +
      '<span class="vunit">dp</span><span class="vlabel">屏幕圆角半径</span></div>' +
      '<div class="vmeta">可信度 ' + conf + ' · ' + r.ms + 'ms · 截图 ' + r.screenshot.width + '×' + r.screenshot.height +
      ' · ' + r.scale.mode + ' x' + pct(r.scale.scoreX) + ' y' + pct(r.scale.scoreY) + '</div></div>';

    html += '<h3>屏幕底部</h3><table class="kv">' +
      rowTd('可见区 y', v.top + ' … ' + v.bottom) +
      rowTd('底部被遮', '<b>' + v.bottomOccluded + '</b> px') +
      rowTd('安全区 y', '<b>' + v.safeTop + ' … ' + v.safeBottom + '</b>') +
      rowTd('上/下留白', v.safeTop + ' / ' + (S.H - 1 - v.safeBottom) + ' px') +
      rowTd('自动估算', (S.info ? S.info.bottomChrome : '—') + ' px' +
        (S.info && S.info.hitFirstY !== null ? ' · 命中 y=' + S.info.hitFirstY : '')) +
      '</table>';

    html += '<h3>四角</h3><table class="kv">';
    var names = { topLeft: '左上', topRight: '右上', bottomLeft: '左下', bottomRight: '右下' };
    ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].forEach(function (k) {
      var c = r.corners[k];
      if (!c) { html += rowTd(names[k], '—'); return; }
      var alt = (c.alternatives || []).map(function (a) {
        return a.model + ' R=' + n2(a.R) + ' e=' + n2(a.err);
      }).join(' · ');
      html += rowTd(names[k], 'R <b>' + n2(c.R) + '</b> · <code>' + c.model + '</code> · yt ' + n2(c.yt) +
        ' · 残差 ' + n2(c.err) + ' · 点 ' + c.n + '<br><span class="mut">' + alt + '</span>');
    });
    html += '</table>';

    if (r.notch && r.notch.length) {
      html += '<h3>遮挡物圆角</h3><table class="kv">';
      r.notch.forEach(function (n) {
        html += rowTd(names[n.corner] || n.corner, 'R ≈ ' + n2(n.R) + ' · 直边 y ≈ ' + n.edgeRow +
          ' · 点 ' + n.n + ' · 残差 ' + n2(n.err));
      });
      html += '</table>';
    }

    if (r.warnings.length) html += '<h3>警告</h3><div class="alert">' + r.warnings.join('<br>') + '</div>';

    html += '<h3>日志</h3><pre class="log">' + r.notes.join('\n') + '</pre>';
    html += '<h3>可见性重建</h3><canvas id="overlay" class="overlay"></canvas>';
    html += '<h3>JSON</h3><textarea class="json" id="jsonOut" readonly rows="8"></textarea>' +
      '<div class="row"><button class="btn ghost" id="copyJson">复制 JSON</button></div>';

    out.innerHTML = html;

    drawOverlay();
    $('jsonOut').value = JSON.stringify(exportJson(), null, 2);
    $('copyJson').onclick = function () {
      var t = $('jsonOut'), b = this;
      t.select();
      try { document.execCommand('copy'); b.textContent = '已复制'; } catch (err) { b.textContent = '复制失败'; }
      setTimeout(function () { b.textContent = '复制 JSON'; }, 1500);
    };
  }

  function exportJson() {
    var r = S.res, e = S.info || {};
    return {
      tool: 'bottom-radius-test', version: R.VERSION, at: new Date().toISOString(),
      ua: e.ua,
      screen: { W: S.W, H: S.H, dpr: S.dpr, screenW: e.screenW, screenH: e.screenH, innerH: e.innerH, vvH: e.vvH, vvTop: e.vvTop },
      safeAreaInset: { top: e.safeTop, bottom: e.safeBottom, left: e.safeLeft, right: e.safeRight },
      estimate: { bottomChrome: e.bottomChrome, hitFirstY: e.hitFirstY },
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
    var ctx2 = cv.getContext('2d');
    if (!ctx2) return;

    var boxW = Math.min(340, window.innerWidth - 40);
    var k = boxW / shot.w, boxH = Math.round(shot.h * k);
    cv.width = boxW; cv.height = boxH;
    ctx2.fillStyle = '#0b0d12';
    ctx2.fillRect(0, 0, boxW, boxH);
    ctx2.globalAlpha = 0.92;
    shot.img = shot.img || shotImg();
    if (shot.img) ctx2.drawImage(shot.img, 0, 0, boxW, boxH);
    ctx2.globalAlpha = 1;

    var sm = R.makeSampler(shot.buf, S.W, S.H, r.scale.sx, r.scale.sy);
    var step = 3;
    for (var y = 0; y < S.H; y += step) {
      for (var x = 0; x < S.W; x += step) {
        var pr = sm.probe(x, y);
        if (pr.reason === 'deco') continue;
        var px = Math.round((x + 0.5) * r.scale.sx * k), py = Math.round((y + 0.5) * r.scale.sy * k);
        ctx2.fillStyle = pr.ok ? 'rgba(60,220,130,0.55)' : 'rgba(255,70,90,0.5)';
        ctx2.fillRect(px, py, Math.max(1, Math.ceil(step * r.scale.sx * k)), Math.max(1, Math.ceil(step * r.scale.sy * k)));
      }
    }
    ctx2.lineWidth = 1.4;
    ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].forEach(function (name) {
      var c = r.corners[name];
      if (!c) return;
      ctx2.strokeStyle = 'rgba(255,205,60,0.95)';
      ctx2.beginPath();
      var n = 24;
      for (var i = 0; i <= n; i++) {
        var yy = c.yt + c.R * (i / n);
        var xx = R.cutOf(c.R, c.yt, yy);
        var sx = (name === 'topLeft' || name === 'bottomLeft') ? xx : S.W - xx;
        var sy = (name === 'bottomLeft' || name === 'bottomRight') ? yy : S.H - yy;
        var a = (sx + 0.5) * r.scale.sx * k, b = (sy + 0.5) * r.scale.sy * k;
        if (i === 0) ctx2.moveTo(a, b); else ctx2.lineTo(a, b);
      }
      ctx2.stroke();
    });
    if (ctx2.setLineDash) ctx2.setLineDash([4, 3]);
    ctx2.strokeStyle = 'rgba(90,200,255,0.9)';
    ctx2.strokeRect(0.5, (r.visible.safeTop + 0.5) * r.scale.sy * k, boxW - 1,
      (r.visible.safeBottom - r.visible.safeTop) * r.scale.sy * k);
    if (ctx2.setLineDash) ctx2.setLineDash([]);
  }

  function shotImg() {
    if (!S.shot) return null;
    var c = document.createElement('canvas');
    c.width = S.shot.w; c.height = S.shot.h;
    try {
      var d = new Uint8ClampedArray(S.shot.buf.data);
      c.getContext('2d').putImageData(new ImageData(d, S.shot.w, S.shot.h), 0, 0);
      return c;
    } catch (e) { return null; }
  }

  /* ================= 初始化 ================= */
  function init() {
    window.onerror = function (m) { setStatus('错误 ' + m, 'err'); };

    paintProbe();
    S.info = collectInfo();
    renderAuto();

    $('btnHide').onclick = function () { hideHud(true); };
    $('hint').onclick = function () { hideHud(false); S.info = collectInfo(); renderAuto(); };
    $('btnRedraw').onclick = function () { paintProbe(); S.info = collectInfo(); renderAuto(); };
    $('btnManual').onclick = function () {
      var w = parseInt($('manW').value, 10), h = parseInt($('manH').value, 10);
      if (!(w > 50 && h > 50)) { setStatus('尺寸无效', 'err'); return; }
      S.forceSize = { W: w, H: h };
      paintProbe(); S.info = collectInfo(); renderAuto();
    };
    $('btnPaste').onclick = pasteFromClipboard;
    $('file').onchange = function (ev) { handleFiles(ev.target.files); };

    document.addEventListener('paste', function (ev) {
      var dt = ev.clipboardData;
      if (!dt) return;
      var f = null;
      if (dt.files && dt.files.length) f = dt.files[0];
      if (!f && dt.items) {
        for (var i = 0; i < dt.items.length; i++) {
          if (dt.items[i].type && dt.items[i].type.indexOf('image') === 0) { f = dt.items[i].getAsFile(); break; }
        }
      }
      if (f) { ev.preventDefault(); closePastebox(); loadBlob(f); }
    });

    ['dragover', 'drop'].forEach(function (t) {
      document.addEventListener(t, function (ev) {
        ev.preventDefault();
        if (t === 'drop' && ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
          handleFiles(ev.dataTransfer.files);
        }
      });
    });

    var t = null;
    function onResize() {
      syncOffset();
      clearTimeout(t);
      t = setTimeout(function () { paintProbe(); S.info = collectInfo(); renderAuto(); }, 250);
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
