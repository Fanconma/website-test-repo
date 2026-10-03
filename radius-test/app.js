(function () {
  'use strict';

  var R = window.ScreenRuler;
  var $ = function (id) { return document.getElementById(id); };
  var MAX_IMAGES = 8;

  var S = {
    W: 0, H: 0, dpr: 1,
    shot: null, res: null, lastSample: null, info: null,
    hidden: false, forceSize: null,
    queue: [], samples: [], currentItem: null, processing: false
  };

  function setStatus(msg, cls) {
    var el = $('status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = cls || '';
  }

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
    while (S.W * S.H * S.dpr * S.dpr > 7e6 && S.dpr > 1) {
      S.dpr = Math.round((S.dpr - 0.25) * 100) / 100;
    }

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
    setStatus(S.W + ' × ' + S.H);
  }

  function syncOffset() {
    var vv = window.visualViewport, cv = $('probe');
    if (!vv || !cv) return;
    cv.style.transform = 'translate(' + (-vv.offsetLeft) + 'px,' + (-vv.offsetTop) + 'px)';
  }

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
      ['当前尺寸', e.W + ' × ' + e.H],
      ['DPR', String(e.dpr)],
      ['screen', (e.screenW || '?') + ' × ' + (e.screenH || '?')],
      ['innerWidth/Height', e.innerW + ' × ' + e.innerH],
      ['visualViewport', (e.vvW || '?') + ' × ' + (e.vvH || '?') + ' · top ' + e.vvTop],
      ['safe-area 上/右/下/左', e.safeTop + ' / ' + e.safeRight + ' / ' + e.safeBottom + ' / ' + e.safeLeft],
      ['底部占用', e.bottomChrome + ' px'],
      ['canvas 命中 y', e.hitFirstY === null ? '—' : e.hitFirstY],
      ['命中统计', 'canvas ' + e.hitCounts.probe + ' / 其他 ' + e.hitCounts.other + ' / 无 ' + e.hitCounts.none]
    ];
    $('auto').innerHTML = rows.map(function (row) {
      return '<tr><td>' + escapeHtml(row[0]) + '</td><td>' + escapeHtml(row[1]) + '</td></tr>';
    }).join('');
  }

  function hideHud(hide) {
    S.hidden = hide;
    $('hud').style.display = hide ? 'none' : '';
    $('hint').className = hide ? 'on' : '';
    if (hide) {
      try { window.scrollTo(0, 0); } catch (e) {}
    } else {
      try { S.info = collectInfo(); renderAuto(); } catch (e) {}
    }
  }

  /* ================= 截图导入 / 队列 ================= */
  function handleFiles(files) {
    if (!files || !files.length) return;
    var valid = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i], type = file.type || '';
      if (type.indexOf('image/') === 0 || !type) valid.push(file);
    }
    if (!valid.length) { setStatus('请选择图片', 'err'); return; }
    enqueue(valid);
  }

  function enqueue(files) {
    var total = S.samples.length + S.queue.length + (S.currentItem ? 1 : 0);
    var added = 0;
    for (var i = 0; i < files.length; i++) {
      if (total >= MAX_IMAGES) break;
      var index = total + 1;
      var entry = files[i];
      S.queue.push({ blob: entry && entry.blob ? entry.blob : entry, name: entry && entry.name ? entry.name : ('截图 ' + index) });
      total++;
      added++;
    }
    if (!added) {
      setStatus('已达 8 张', 'err');
      return;
    }
    closePastebox();
    if (added < files.length) setStatus('已达 8 张', 'err');
    else setStatus('已加入 ' + added + ' 张');
    renderQueue();
    processQueue();
  }

  function processQueue() {
    if (S.processing || !S.queue.length) return;
    S.currentItem = S.queue.shift();
    S.processing = true;
    renderQueue();
    setStatus('正在分析：' + S.currentItem.name);
    loadBlob(S.currentItem.blob, S.currentItem);
  }

  function loadBlob(blob, item) {
    if (!blob) { finishCurrent(null, '没有读取到图片'); return; }
    var url = null;
    var img = new Image();
    function releaseUrl() {
      if (url && URL && typeof URL.revokeObjectURL === 'function') {
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
      url = null;
    }
    img.onload = function () {
      try { decodeImage(img, item); }
      catch (err) {
        var message = err && err.message ? err.message : String(err || '未知错误');
        if (window.console && console.error) console.error('image analysis failed', err);
        finishCurrent(null, '分析失败：' + message.slice(0, 70));
      }
      releaseUrl();
    };
    img.onerror = function () {
      releaseUrl();
      finishCurrent(null, '图片读取失败');
    };
    try {
      url = URL.createObjectURL(blob);
      img.src = url;
    } catch (e) {
      releaseUrl();
      finishCurrent(null, '图片读取失败');
    }
  }

  function decodeImage(img, item) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) { finishCurrent(null, '图片尺寸无效'); return; }

    // 保留常见截图的原始像素；只在超大图片时缩小，避免移动设备内存不足。
    var maxPixels = 12000000, maxDim = 6000;
    var k = Math.min(1, maxDim / Math.max(iw, ih), Math.sqrt(maxPixels / (iw * ih)));
    var w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { finishCurrent(null, '浏览器无法读取图片'); return; }
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    var shot = { buf: { data: data.data, width: w, height: h }, w: w, h: h, sourceW: iw, sourceH: ih, factor: k, img: img };
    var start = window.performance && performance.now ? performance.now() : Date.now();
    var result = R.analyze(shot.buf, S.W, S.H);
    result.ms = Math.round((window.performance && performance.now ? performance.now() : Date.now()) - start);

    shot.name = item.name;
    S.shot = shot;
    S.res = result;
    var sample = makeSample(result, item.name, iw, ih, k);
    sample.result = result;
    S.samples.push(sample);
    S.lastSample = sample;
    finishCurrent(sample, null);
  }

  function finishCurrent(sample, error) {
    var item = S.currentItem;
    if (!sample && item) {
      var failed = {
        name: item.name,
        radius: null,
        reliable: false,
        state: 'failed',
        message: error || '图片分析失败'
      };
      S.samples.push(failed);
      S.lastSample = failed;
      S.res = null;
      S.shot = null;
    }
    S.processing = false;
    S.currentItem = null;
    try { renderQueue(); }
    catch (queueError) {
      if (window.console && console.error) console.error('queue render failed', queueError);
      setStatus('队列显示失败', 'err');
    }
    if (S.queue.length) {
      processQueue();
      return;
    }

    try { renderReport(); }
    catch (reportError) {
      var message = reportError && reportError.message ? reportError.message : String(reportError || '未知错误');
      if (window.console && console.error) console.error('report render failed', reportError);
      setStatus('结果显示失败：' + message.slice(0, 70), 'err');
      return;
    }
    var measured = S.samples.filter(function (s) { return typeof s.radius === 'number' && isFinite(s.radius); });
    var failures = S.samples.filter(function (s) { return s.state === 'failed'; }).length;
    if (measured.length) {
      setStatus('完成 ' + S.samples.length + ' 张' + (failures ? ' · ' + failures + ' 张未读' : ''), failures ? 'err' : 'ok');
    } else if (failures) {
      setStatus(S.lastSample && S.lastSample.message ? S.lastSample.message : '图片未能分析', 'err');
    }
  }

  function makeSample(result, name, sourceW, sourceH, factor) {
    var keys = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
    var fits = [], allValues = [];
    keys.forEach(function (key) {
      var corner = result.corners && result.corners[key];
      if (!corner || !isFinite(corner.R)) return;
      allValues.push(corner.R);
      if (corner.n >= 6 && corner.err <= 4 && corner.model !== 'atVisibleBottom') {
        fits.push(corner);
      }
    });
    var precise = fits.filter(function (corner) { return corner.err <= 2.5; });
    var values = (precise.length ? precise : fits).map(function (corner) { return corner.R; });
    var radius = values.length ? median(values) : null;
    if (radius === null && result.suggest && isFinite(result.suggest.displayRadius)) radius = result.suggest.displayRadius;
    if (radius === null && allValues.length) radius = median(allValues);

    var scale = result.scale || {};
    var calibrated = result.ok && scale.mode !== 'guess' && scale.mode !== 'comb(dpr?)' &&
      (scale.scoreX >= 0.75 || scale.scoreY >= 0.75);
    var fitSpread = fits.length > 1 ? Math.max.apply(Math, fits.map(function (corner) { return corner.R; })) -
      Math.min.apply(Math, fits.map(function (corner) { return corner.R; })) : Infinity;
    var cleanFit = precise.length > 0 || (fits.length >= 2 && fitSpread <= 2);
    var reliable = !!(radius !== null && calibrated && cleanFit && !(result.warnings || []).length);
    var state = radius === null ? 'no-result' : (reliable ? 'ready' : 'review');
    var message = radius === null ? '未测出' : (reliable ? '可用' : '需复核');
    if (factor < 0.999 && radius !== null) {
      reliable = false;
      state = 'review';
      message = '图片过大，已缩小';
    }
    return {
      name: name,
      radius: radius,
      reliable: reliable,
      state: state,
      message: message,
      sourceW: sourceW, sourceH: sourceH,
      imageW: result.screenshot ? result.screenshot.width : null,
      imageH: result.screenshot ? result.screenshot.height : null,
      factor: factor,
      warningCount: (result.warnings || []).length,
      scaleScore: Math.min(scale.scoreX || 0, scale.scoreY || 0),
      cornerCount: fits.length
    };
  }

  function pasteFromClipboard() {
    var done = false;
    function fallback() {
      if (!done) { done = true; openPastebox(); }
    }
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) { fallback(); return; }
      setStatus('读取剪贴板…');
      navigator.clipboard.read().then(function (items) {
        var chain = Promise.resolve();
        var found = null;
        items.forEach(function (entry) {
          (entry.types || []).forEach(function (type) {
            if (!found && type.indexOf('image/') === 0) {
              chain = chain.then(function () { return entry.getType(type); }).then(function (blob) { found = blob; });
            }
          });
        });
        return chain.then(function () {
          if (found) {
            done = true;
            enqueue([{ name: '剪贴板截图', blob: found }]);
          } else fallback();
        });
      }).catch(function () { fallback(); });
    } catch (e) { fallback(); }
  }

  function openPastebox() {
    var box = $('pastebox');
    box.className = 'on';
    box.textContent = '';
    setStatus('');
    try { box.focus(); } catch (e) {}
  }

  function closePastebox() {
    var box = $('pastebox');
    if (box) { box.className = ''; box.textContent = ''; }
  }

  function clearQueue() {
    if (S.processing) { setStatus('分析结束后再清空'); return; }
    S.queue = [];
    S.samples = [];
    S.res = null;
    S.shot = null;
    S.lastSample = null;
    $('result').innerHTML = '';
    renderQueue();
    setStatus('记录已清空');
  }

  function renderQueue() {
    var out = $('queue');
    var total = S.samples.length + S.queue.length + (S.currentItem ? 1 : 0);
    if (!total) { out.innerHTML = ''; return; }
    var html = '<div class="queue-box"><div class="queue-head"><b>截图记录（' + S.samples.length + '/' + total + '）</b>' +
      '<button class="btn ghost small" id="clearQueue" type="button">清空记录</button></div><ul class="queue-list">';
    S.samples.forEach(function (sample) {
      var label, cls = '';
      if (typeof sample.radius === 'number' && isFinite(sample.radius)) {
        label = radiusText(sample.radius) + ' dp · ' + sample.message;
        cls = sample.reliable ? 'good' : 'warn';
      } else {
        label = sample.message || '未测出';
        cls = 'bad';
      }
      html += '<li><span class="queue-name">' + escapeHtml(sample.name) + '</span><span class="queue-value ' + cls + '">' + escapeHtml(label) + '</span></li>';
    });
    if (S.currentItem) {
      html += '<li><span class="queue-name">' + escapeHtml(S.currentItem.name) + '</span><span class="queue-value">分析中…</span></li>';
    }
    S.queue.forEach(function (item) {
      html += '<li><span class="queue-name">' + escapeHtml(item.name) + '</span><span class="queue-value">等待中</span></li>';
    });
    html += '</ul></div>';
    out.innerHTML = html;
    var clear = $('clearQueue');
    if (clear) clear.onclick = clearQueue;
  }

  /* ================= 结果 ================= */
  function median(values) {
    if (!values || !values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function aggregateSamples() {
    var measured = S.samples.filter(function (sample) {
      return typeof sample.radius === 'number' && isFinite(sample.radius);
    });
    var reliable = measured.filter(function (sample) { return sample.reliable; });
    var used = reliable.length ? reliable : measured;
    var values = used.map(function (sample) { return sample.radius; });
    var min = values.length ? Math.min.apply(Math, values) : null;
    var max = values.length ? Math.max.apply(Math, values) : null;
    return {
      radius: median(values),
      min: min,
      max: max,
      spread: values.length ? max - min : null,
      measuredCount: measured.length,
      reliableCount: reliable.length,
      usedCount: used.length,
      totalCount: S.samples.length
    };
  }

  function radiusText(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    var rounded = Math.round(value * 2) / 2;
    return String(Math.round(rounded) === rounded ? Math.round(rounded) : rounded);
  }

  function n2(value) {
    return value === null || value === undefined || isNaN(value) ? '—' : (Math.round(value * 100) / 100);
  }

  function pct(value) { return Math.round(value * 100) + '%'; }
  function rowTd(key, value) { return '<tr><td>' + key + '</td><td>' + value + '</td></tr>'; }

  function renderReport() {
    var out = $('result');
    var summary = aggregateSamples();
    var html = '';
    if (summary.radius === null) {
      html += '<div class="verdict bad"><div class="vrow"><span class="vnum">—</span><span class="vtitle">未测出</span></div></div>';
    } else {
      var cls = 'mid';
      if (summary.reliableCount >= 2 && summary.spread <= 2) cls = 'good';
      else if (summary.reliableCount === 0 || summary.spread > 4) cls = 'bad';
      var caption = summary.usedCount > 1 ? '多张中位数' : '估算值';
      var meta = summary.reliableCount
        ? '有效截图 ' + summary.reliableCount + ' 张 / 共 ' + summary.totalCount + ' 张'
        : '共 ' + summary.totalCount + ' 张 · 结果需复核';
      if (summary.usedCount > 1) meta += ' · 范围 ' + radiusText(summary.min) + '–' + radiusText(summary.max) + ' dp';
      html += '<div class="verdict ' + cls + '"><div class="vrow"><span class="vnum">' + radiusText(summary.radius) + '</span>' +
        '<span class="vunit">dp</span><span class="vtitle">屏幕圆角</span></div><div class="vmeta">' + caption + ' · ' + meta + '</div></div>';

    }

    if (S.res) {
      html += '<details id="resultDetails"><summary>检测细节</summary>' + renderDetail(S.res) + '</details>';
    } else if (S.lastSample && S.lastSample.state === 'failed') {
      html += '<div class="alert">' + escapeHtml(S.lastSample.message) + '</div>';
    }
    out.innerHTML = html;
    if (S.res && S.res.ok) {
      var details = $('resultDetails');
      if (details) details.addEventListener('toggle', function () {
        if (details.open) {
          try { drawOverlay(); }
          catch (err) { if (window.console && console.error) console.error('overlay draw failed', err); }
        }
      });
      var json = $('jsonOut');
      if (json) json.value = JSON.stringify(exportJson(), null, 2);
      var copy = $('copyJson');
      if (copy) copy.onclick = function () {
        var text = $('jsonOut'), button = this;
        text.select();
        try { document.execCommand('copy'); button.textContent = '已复制'; }
        catch (err) { button.textContent = '复制失败'; }
        setTimeout(function () { button.textContent = '复制数据'; }, 1500);
      };
    }
  }

  function renderDetail(result) {
    var r = result, html = '';
    if (!r.ok) {
      return '<div class="alert"><b>无法解码</b><br>' + escapeHtml((r.warnings || []).join('\n')) + '</div>';
    }
    var v = r.visible;
    var sampleName = S.lastSample ? S.lastSample.name : '';
    html += '<p class="subnote">当前图片：' + escapeHtml(sampleName) + '</p>';
    html += '<h3>屏幕底部</h3><table class="kv">' +
      rowTd('可见 y', v.top + ' … ' + v.bottom) +
      rowTd('底部遮挡', '<b>' + v.bottomOccluded + '</b> px') +
      rowTd('安全区', '<b>' + v.safeTop + ' … ' + v.safeBottom + '</b>') +
      rowTd('浏览器底部占用', (S.info ? S.info.bottomChrome : '—') + ' px') +
      '</table>';

    html += '<h3>四角拟合</h3><table class="kv">';
    var names = { topLeft: '左上', topRight: '右上', bottomLeft: '左下', bottomRight: '右下' };
    ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].forEach(function (key) {
      var corner = r.corners[key];
      if (!corner) { html += rowTd(names[key], '—'); return; }
      var alt = (corner.alternatives || []).map(function (fit) {
        return escapeHtml(fit.model) + ' R=' + n2(fit.R) + ' e=' + n2(fit.err);
      }).join(' · ');
      html += rowTd(names[key], 'R <b>' + n2(corner.R) + '</b> · <code>' + escapeHtml(corner.model) + '</code> · 残差 ' +
        n2(corner.err) + ' · 点 ' + corner.n + (alt ? '<br><span class="mut">' + alt + '</span>' : ''));
    });
    html += '</table>';

    if (r.notch && r.notch.length) {
      html += '<h3>遮挡边缘</h3><table class="kv">';
      r.notch.forEach(function (notch) {
        html += rowTd(names[notch.corner] || escapeHtml(notch.corner), 'R ≈ ' + n2(notch.R) + ' · y ≈ ' + notch.edgeRow);
      });
      html += '</table>';
    }
    if (r.warnings && r.warnings.length) {
      html += '<h3>提示</h3><div class="alert">' + escapeHtml(r.warnings.join('\n')).replace(/\n/g, '<br>') + '</div>';
    }
    html += '<h3>分析记录</h3><pre class="log">' + escapeHtml((r.notes || []).join('\n')) + '</pre>';
    html += '<h3>截图校验</h3><canvas id="overlay" class="overlay"></canvas>';
    html += '<h3>数据</h3><textarea class="json" id="jsonOut" readonly rows="8"></textarea>' +
      '<div class="row"><button class="btn ghost small" id="copyJson" type="button">复制数据</button></div>';
    return html;
  }

  function exportJson() {
    var r = S.res || {}, e = S.info || {}, summary = aggregateSamples();
    return {
      tool: 'screen-radius-test', version: R.VERSION, at: new Date().toISOString(),
      ua: e.ua,
      screen: { W: S.W, H: S.H, dpr: S.dpr, screenW: e.screenW, screenH: e.screenH, innerH: e.innerH, vvH: e.vvH, vvTop: e.vvTop },
      safeAreaInset: { top: e.safeTop, bottom: e.safeBottom, left: e.safeLeft, right: e.safeRight },
      estimate: { bottomChrome: e.bottomChrome, hitFirstY: e.hitFirstY },
      combined: { radius: summary.radius, min: summary.min, max: summary.max, count: summary.usedCount, reliableCount: summary.reliableCount },
      captures: S.samples.map(function (sample) {
        return {
          name: sample.name, radius: sample.radius, reliable: sample.reliable,
          status: sample.message, sourceWidth: sample.sourceW, sourceHeight: sample.sourceH,
          analyzedWidth: sample.imageW, analyzedHeight: sample.imageH
        };
      }),
      scale: r.ok ? { sx: r.scale.sx, sy: r.scale.sy, mode: r.scale.mode, scoreX: r.scale.scoreX, scoreY: r.scale.scoreY } : null,
      visible: r.ok ? r.visible : null,
      radius: r.ok ? {
        suggestion: r.suggest.displayRadius, bottom: r.suggest.bottomRadius, top: r.suggest.topRadius,
        corners: { bottomLeft: r.corners.bottomLeft, bottomRight: r.corners.bottomRight, topLeft: r.corners.topLeft, topRight: r.corners.topRight }
      } : null,
      notch: r.ok ? r.notch : null,
      warnings: r.warnings || [], ms: r.ms || null
    };
  }

  /* ================= 可视化 ================= */
  function drawOverlay() {
    var r = S.res, shot = S.shot;
    var cv = $('overlay');
    if (!cv || !shot || !r || !r.ok || typeof cv.getContext !== 'function') return;
    var ctx2 = cv.getContext('2d');
    if (!ctx2) return;

    var boxW = Math.min(340, Math.max(180, window.innerWidth - 40));
    var k = boxW / shot.w, boxH = Math.round(shot.h * k);
    cv.width = boxW; cv.height = boxH;
    ctx2.fillStyle = '#0b0d12';
    ctx2.fillRect(0, 0, boxW, boxH);
    ctx2.globalAlpha = 0.92;
    shot.img = shot.img || shotImg();
    if (shot.img) ctx2.drawImage(shot.img, 0, 0, boxW, boxH);
    ctx2.globalAlpha = 1;

    var sampler = R.makeSampler(shot.buf, S.W, S.H, r.scale.sx, r.scale.sy);
    var step = 3;
    for (var y = 0; y < S.H; y += step) {
      for (var x = 0; x < S.W; x += step) {
        var probe = sampler.probe(x, y);
        if (probe.reason === 'deco') continue;
        var px = Math.round((x + 0.5) * r.scale.sx * k), py = Math.round((y + 0.5) * r.scale.sy * k);
        ctx2.fillStyle = probe.ok ? 'rgba(60,220,130,0.55)' : 'rgba(255,70,90,0.5)';
        ctx2.fillRect(px, py, Math.max(1, Math.ceil(step * r.scale.sx * k)), Math.max(1, Math.ceil(step * r.scale.sy * k)));
      }
    }
    ctx2.lineWidth = 1.4;
    ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].forEach(function (name) {
      var corner = r.corners[name];
      if (!corner) return;
      ctx2.strokeStyle = 'rgba(255,205,60,0.95)';
      ctx2.beginPath();
      var n = 24;
      for (var i = 0; i <= n; i++) {
        var yy = corner.yt + corner.R * (i / n);
        var xx = R.cutOf(corner.R, corner.yt, yy);
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
    var canvas = document.createElement('canvas');
    canvas.width = S.shot.w; canvas.height = S.shot.h;
    try {
      var data = new Uint8ClampedArray(S.shot.buf.data);
      canvas.getContext('2d').putImageData(new ImageData(data, S.shot.w, S.shot.h), 0, 0);
      return canvas;
    } catch (e) { return null; }
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ================= 初始化 ================= */
  function init() {
    window.onerror = function (message, source, line, column, error) {
      var detail = error && error.message ? error.message : String(message || '未知错误');
      if (window.console && console.error) console.error('ScreenRuler error', error || message, source, line, column);
      setStatus('错误：' + detail.slice(0, 90), 'err');
      return false;
    };
    window.addEventListener('unhandledrejection', function (event) {
      var reason = event && event.reason;
      var detail = reason && reason.message ? reason.message : String(reason || '未知错误');
      if (window.console && console.error) console.error('ScreenRuler promise error', reason);
      setStatus('错误：' + detail.slice(0, 90), 'err');
    });
    paintProbe();
    S.info = collectInfo();
    renderAuto();

    $('btnHide').onclick = function () { hideHud(true); };
    $('hint').onclick = function () { hideHud(false); };
    document.addEventListener('keydown', function (event) {
      if (S.hidden && event.key === 'Escape') hideHud(false);
    });
    $('btnRedraw').onclick = function () { paintProbe(); S.info = collectInfo(); renderAuto(); };
    $('btnManual').onclick = function () {
      var w = parseInt($('manW').value, 10), h = parseInt($('manH').value, 10);
      if (!(w > 50 && h > 50)) { setStatus('尺寸无效', 'err'); return; }
      S.forceSize = { W: w, H: h };
      paintProbe(); S.info = collectInfo(); renderAuto();
    };
    $('btnPaste').onclick = pasteFromClipboard;
    $('file').onchange = function (event) {
      handleFiles(event.target.files);
      event.target.value = '';
    };

    $('clearQueue') && ($('clearQueue').onclick = clearQueue);
    document.addEventListener('paste', function (event) {
      var data = event.clipboardData;
      if (!data) return;
      var file = null;
      if (data.files && data.files.length) file = data.files[0];
      if (!file && data.items) {
        for (var i = 0; i < data.items.length; i++) {
          if (data.items[i].type && data.items[i].type.indexOf('image/') === 0) {
            file = data.items[i].getAsFile();
            break;
          }
        }
      }
      if (file) { event.preventDefault(); enqueue([file]); }
    });

    ['dragover', 'drop'].forEach(function (type) {
      document.addEventListener(type, function (event) {
        event.preventDefault();
        if (type === 'drop' && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
          handleFiles(event.dataTransfer.files);
        }
      });
    });

    var resizeTimer = null;
    function onResize() {
      syncOffset();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { paintProbe(); S.info = collectInfo(); renderAuto(); }, 250);
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
