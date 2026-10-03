/**
 * selftest.js — 在 Node 里模拟「截图」并验证解码链路（node bottom-radius-test/selftest.js）
 *
 * 模拟流程与真机一致：
 *   1. 用 ScreenRuler.paint 把标尺画进一块 W×H 缓冲（= 主屏幕 canvas 的像素）；
 *   2. 模拟系统合成器：按「屏幕圆角 + 被 UI 遮挡」把该缓冲的像素涂黑
 *      （真机上这些位置显示的是系统 UI，而不是 canvas 内容）；
 *   3. 把结果喂给 ScreenRuler.analyze，检查反推的半径 / 遮挡高度是否正确。
 *
 * 关键之处：Node 侧的 2D 上下文桩是「带 clip、带路径光栅化」的，
 * 所以如果绘制逻辑把装饰画到了编码区上（污染条码），测试会立刻失败。
 * 真机上我们无法回读自己画的像素，第 2 步只在 Node 里成立。
 */
'use strict';

var R = require('./ruler.js');

/* ================= 极简但真实的 2D 上下文桩 ================= */
function makeCanvas(W, H) {
  var buf = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  var path = [], cur = null, clip = null, stack = [];
  var tf = { a: 1, d: 1, e: 0, f: 0 };            // 简化版变换矩阵（只支持缩放/平移）

  function inClip(x, y) {
    if (!clip) return true;
    for (var j = 0; j < clip.length; j++) {
      var r = clip[j];
      if (x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]) return true;
    }
    return false;
  }
  function put(x, y, col) {
    // 先按当前变换（CSS px）映射到设备像素，再做 clip 判定与写入
    x = Math.round(x * tf.a + tf.e); y = Math.round(y * tf.d + tf.f);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (!inClip(x, y)) return;
    var o = (y * W + x) * 4, a = col.length > 3 ? col[3] : 1;
    if (a >= 1) {
      buf.data[o] = col[0]; buf.data[o + 1] = col[1]; buf.data[o + 2] = col[2];
    } else {                                   // 半透明：与已有像素混合（真 canvas 行为）
      buf.data[o] = Math.round(buf.data[o] * (1 - a) + col[0] * a);
      buf.data[o + 1] = Math.round(buf.data[o + 1] * (1 - a) + col[1] * a);
      buf.data[o + 2] = Math.round(buf.data[o + 2] * (1 - a) + col[2] * a);
    }
    buf.data[o + 3] = 255;
  }
  function putRaw(x, y, col) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (!inClip(x, y)) return;
    var o = (y * W + x) * 4, a = col.length > 3 ? col[3] : 1;
    if (a >= 1) { buf.data[o] = col[0]; buf.data[o + 1] = col[1]; buf.data[o + 2] = col[2]; }
    else {
      buf.data[o] = Math.round(buf.data[o] * (1 - a) + col[0] * a);
      buf.data[o + 1] = Math.round(buf.data[o + 1] * (1 - a) + col[1] * a);
      buf.data[o + 2] = Math.round(buf.data[o + 2] * (1 - a) + col[2] * a);
    }
    buf.data[o + 3] = 255;
  }

  function line(x0, y0, x1, y1, col, w) {
    var n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) * 2 + 1;
    var half = Math.max(0, (w - 1) / 2);
    for (var i = 0; i <= n; i++) {
      var t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      for (var dx = -half; dx <= half; dx++) put(x + dx, y, col);
    }
  }
  var ctx = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'top',
    setTransform: function (a, b, c, d, e, f) {
      if (arguments.length === 0) { tf = { a: 1, d: 1, e: 0, f: 0 }; return; }
      tf = { a: a === undefined ? 1 : a, d: d === undefined ? 1 : d, e: e || 0, f: f || 0 };
    },
    setLineDash: function () {}, getLineDash: function () { return []; },
    strokeRect: function (x, y, w, h) {
      var col = hex(this.strokeStyle), lw = this.lineWidth || 1;
      line(x, y, x + w, y, col, lw); line(x + w, y, x + w, y + h, col, lw);
      line(x + w, y + h, x, y + h, col, lw); line(x, y + h, x, y, col, lw);
    },
    save: function () {
      stack.push({ clip: clip ? clip.map(function (r) { return r.slice(); }) : null, tf: { a: tf.a, d: tf.d, e: tf.e, f: tf.f } });
    },
    restore: function () {
      if (!stack.length) return;
      var st = stack.pop();
      clip = st.clip; tf = st.tf;
    },
    beginPath: function () { path = []; cur = null; },
    rect: function (x, y, w, h) {
      // 变换到设备像素后再作为裁剪矩形
      path.push({ t: 'rect', r: [x * tf.a + tf.e, y * tf.d + tf.f, w * tf.a, h * tf.d] });
    },
    clip: function () {
      var rects = path.filter(function (p) { return p.t === 'rect'; }).map(function (p) { return p.r; });
      if (!clip) { clip = rects.map(function (r) { return r.slice(); }); return; }
      // 与父级 clip 求交（逐 rect 相交，够用）
      var merged = [], i, j, a, b, x0, y0, x1, y1;
      for (i = 0; i < clip.length; i++) {
        for (j = 0; j < rects.length; j++) {
          a = clip[i]; b = rects[j];
          x0 = Math.max(a[0], b[0]); y0 = Math.max(a[1], b[1]);
          x1 = Math.min(a[0] + a[2], b[0] + b[2]); y1 = Math.min(a[1] + a[3], b[1] + b[3]);
          if (x1 > x0 && y1 > y0) merged.push([x0, y0, x1 - x0, y1 - y0]);
        }
      }
      clip = merged;
    },
    moveTo: function (x, y) { cur = [x, y]; },
    lineTo: function (x, y) { if (cur) path.push({ t: 'l', a: cur, b: [x, y] }); cur = [x, y]; },
    arc: function (cx, cy, r, a0, a1) {
      var steps = 32, prev = null;
      for (var i = 0; i <= steps; i++) {
        var a = a0 + (a1 - a0) * i / steps, p = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        if (prev) path.push({ t: 'l', a: prev, b: p });
        prev = p;
      }
      cur = prev;
    },
    stroke: function () {
      var col = hex(this.strokeStyle), w = this.lineWidth || 1;
      for (var i = 0; i < path.length; i++) if (path[i].t === 'l') line(path[i].a[0], path[i].a[1], path[i].b[0], path[i].b[1], col, w);
    },
    fillRect: function (x, y, w, h) {
      var col = hex(this.fillStyle);
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
      for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) put(xx, yy, col);
    },
    fillText: function (t, x, y) {  // 用色块近似文字外框，足以暴露「装饰画进编码区」
      var m = (this.font || '10px').match(/(\d+)px/), size = m ? parseInt(m[1], 10) : 10;
      var w = 0.58 * size * (t || '').length, h = size * 0.8;
      var x0 = this.textAlign === 'center' ? x - w / 2 : this.textAlign === 'right' ? x - w : x;
      var y0 = this.textBaseline === 'middle' ? y - h / 2 : this.textBaseline === 'bottom' ? y - h : y;
      var col = hex(this.fillStyle);
      var X0 = Math.round(x0 * tf.a + tf.e), X1 = Math.round((x0 + w) * tf.a + tf.e);
      var Y0 = Math.round(y0 * tf.d + tf.f), Y1 = Math.round((y0 + h) * tf.d + tf.f);
      for (var yy = Y0; yy < Y1; yy++) for (var xx = X0; xx < X1; xx++) putRaw(xx, yy, col);
    },
    measureText: function (t) { return { width: 0.58 * 10 * (t || '').length }; },
    createImageData: function (w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData: function (img, dx, dy) {
      for (var y = 0; y < img.height; y++) {
        var ty = y + dy; if (ty < 0 || ty >= H) continue;
        for (var x = 0; x < img.width; x++) {
          var tx = x + dx; if (tx < 0 || tx >= W) continue;
          var s = (y * img.width + x) * 4, d = (ty * W + tx) * 4;
          buf.data[d] = img.data[s]; buf.data[d + 1] = img.data[s + 1];
          buf.data[d + 2] = img.data[s + 2]; buf.data[d + 3] = 255;
        }
      }
    }
  };
  function hex(s) {
    if (typeof s !== 'string') return [0, 0, 0];
    if (s.slice(0, 4) === 'rgba') {
      var m = s.match(/rgba?\(([^)]+)\)/);
      if (m) {
        var p = m[1].split(',');
        return [parseInt(p[0], 10), parseInt(p[1], 10), parseInt(p[2], 10), p[3] === undefined ? 1 : parseFloat(p[3])];
      }
      return [0, 0, 0];
    }
    if (s.slice(0, 3) === 'rgb') {
      var m2 = s.match(/\(([^)]+)\)/);
      if (m2) { var q = m2[1].split(','); return [parseInt(q[0], 10), parseInt(q[1], 10), parseInt(q[2], 10), 1]; }
    }
    s = s.replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), 1];
  }
  return { buf: buf, ctx: ctx };
}

/* ================= 模拟遮挡 ================= */
function blackOut(buf, x, y, w, h, col) {
  col = col || [0, 0, 0];
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  for (var yy = Math.max(0, y); yy < Math.min(buf.height, y + h); yy++) {
    for (var xx = Math.max(0, x); xx < Math.min(buf.width, x + w); xx++) {
      var o = (yy * buf.width + xx) * 4;
      buf.data[o] = col[0]; buf.data[o + 1] = col[1]; buf.data[o + 2] = col[2];
    }
  }
}
/** 屏幕物理圆角：radius R，弧心距对应边 R；bottom/top 分别处理 */
function blackOutCorners(buf, W, H, R_, opts) {
  var y, c, col = opts.col || [0, 0, 0];
  function cut(r, dy) { return r - Math.sqrt(Math.max(0, r * r - dy * dy)); }
  if (opts.bottom) {
    var yt = H - R_;
    for (y = Math.max(0, yt); y < H; y++) {
      c = cut(R_, y - yt);
      if (c > 0.5) { blackOut(buf, 0, y, Math.ceil(c), 1, col); blackOut(buf, W - Math.ceil(c), y, Math.ceil(c), 1, col); }
    }
  }
  if (opts.top) {
    for (y = 0; y < R_; y++) {
      c = cut(R_, R_ - y);
      if (c > 0.5) { blackOut(buf, 0, y, Math.ceil(c), 1); blackOut(buf, W - Math.ceil(c), y, Math.ceil(c), 1); }
    }
  }
}
/**
 * 底部圆角面板（工具条 / 面板）：整体遮住最下面 sheetH 行，顶角带圆角 R_。
 * 几何：圆角圆弧的圆心在 (R_, yt+R_)（yt = 面板顶边），与面板左右边、顶边相切。
 *   ⇒ 该行面板覆盖 x ≥ R_ − √(R_² − (R_ − dy)²)，dy = y − yt
 *   ⇒ 面板顶边处割深 = R_，dy = R_ 处割深 = 0（两侧凹口露出 canvas）
 */
function blackOutSheet(buf, W, H, sheetH, R_) {
  var yt = H - sheetH, y, dy, c;
  blackOut(buf, 0, yt + R_, W, sheetH - R_);          // 面板主体（圆角区以下整行遮住）
  for (y = yt; y < Math.min(H, yt + Math.ceil(R_)); y++) {
    dy = y - yt;
    c = R_ - Math.sqrt(Math.max(0, R_ * R_ - (R_ - dy) * (R_ - dy)));
    var cl = Math.max(0, Math.ceil(c) - 1);           // 抗锯齿细节，留 1px 余量
    if (W - 2 * cl > 0) blackOut(buf, cl, y, W - 2 * cl, 1);
  }
}
/** 截图缩放 / 色偏（最近邻，用来验证标定鲁棒性） */
function resample(buf, factor, tint) {
  var W = Math.max(1, Math.round(buf.width * factor)), H = Math.max(1, Math.round(buf.height * factor));
  var out = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var sx = Math.min(buf.width - 1, Math.round(x / factor)), sy = Math.min(buf.height - 1, Math.round(y / factor));
    var s = (sy * buf.width + sx) * 4, d = (y * W + x) * 4;
    out.data[d] = cl(buf.data[s] + (tint || 0));
    out.data[d + 1] = cl(buf.data[s + 1] + (tint || 0));
    out.data[d + 2] = cl(buf.data[s + 2] + (tint || 0));
    out.data[d + 3] = 255;
  }
  return out;
}
function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

/* ================= 断言 ================= */
var PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}
function near(a, b, tol) { return a !== null && a !== undefined && isFinite(a) && Math.abs(a - b) <= tol; }

function buildShot(W, H, opts) {
  opts = opts || {};
  var c = makeCanvas(W, H);
  R.paint(c.ctx, W, H, 1, { info: {}, legend: [12, 20, 28, 36, 44, 52, 62, 72] });
  var oc = opts.occludeColor || [0, 0, 0];
  if (opts.occludeBottom) blackOut(c.buf, 0, H - opts.occludeBottom, W, opts.occludeBottom, oc);
  if (opts.occludeTop) blackOut(c.buf, 0, 0, W, opts.occludeTop, oc);
  if (opts.bottomR) blackOutCorners(c.buf, W, H, opts.bottomR, { bottom: true, col: oc });
  if (opts.topR) blackOutCorners(c.buf, W, H, opts.topR, { top: true, col: oc });
  if (opts.sheetH) blackOutSheet(c.buf, W, H, opts.sheetH, opts.sheetR || 0);
  var buf = c.buf;
  if (opts.cropBottom) {                       // 模拟「用户把截图裁短了」
    var kh = buf.height - opts.cropBottom;
    var cut = { data: new Uint8ClampedArray(buf.width * kh * 4), width: buf.width, height: kh };
    cut.data.set(buf.data.subarray(0, cut.data.length));
    buf = cut;
  }
  if (opts.scale && opts.scale !== 1) buf = resample(buf, opts.scale, opts.tint || 0);
  return { buf: buf };
}

function run(name, W, H, opts, expect) {
  console.log('\n■ ' + name + '  (' + W + '×' + H + ' css)');
  var shot = buildShot(W, H, opts);
  var res = R.analyze(shot.buf, W, H);
  if (!res.ok) {
    check('分析成功', false, JSON.stringify(res.warnings));
    return res;
  }
  console.log('  标定=' + res.scale.mode + ' 缩放 ' + res.scale.sx.toFixed(4) + '/' + res.scale.sy.toFixed(4) +
    ' · 自校验(y) ' + Math.round(res.scale.scoreY * 100) + '%' +
    (res.scale.combH.ok ? ' · 横梳齿 ' + res.scale.combH.count + '须@' + res.scale.combH.spacing.toFixed(2) + 'px' : ' · 横梳齿 ✗') +
    (res.scale.combV.ok ? ' · 纵梳齿 ' + res.scale.combV.count + '须@' + res.scale.combV.spacing.toFixed(2) + 'px' : ' · 纵梳齿 ✗'));
  console.log('  可见 y: ' + res.visible.top + ' … ' + res.visible.bottom + '  (底部被遮 ' + res.visible.bottomOccluded +
    'px) · 安全区 y: ' + res.visible.safeTop + ' … ' + res.visible.safeBottom);
  res.notes.forEach(function (n) { console.log('  · ' + n); });
  res.warnings.forEach(function (n) { console.log('  ! ' + n); });
  ['bottomLeft', 'bottomRight', 'topLeft', 'topRight'].forEach(function (k) {
    var c = res.corners[k];
    console.log('  ' + k + ': ' + (c ? 'R=' + c.R + ' yt=' + c.yt + ' 模型=' + c.model + ' 残差=' + c.err.toFixed(2) + ' 点数=' + c.n : '（无有效拟合）'));
  });

  if (expect.occluded !== undefined) check('底部遮挡高度 = ' + expect.occluded, near(res.visible.bottomOccluded, expect.occluded, 2), '实测 ' + res.visible.bottomOccluded);
  if (expect.bottomR !== undefined) {
    var c = res.corners.bottomLeft, c2 = res.corners.bottomRight, tol = expect.tol || 6;
    check('左下 R ≈ ' + expect.bottomR, c && near(c.R, expect.bottomR, tol), c ? '实测 R=' + c.R : '无');
    check('右下 R ≈ ' + expect.bottomR, c2 && near(c2.R, expect.bottomR, tol), c2 ? '实测 R=' + c2.R : '无');
  }
  if (expect.bottomRAny !== undefined) {
    var anyD = ['bottomLeft', 'bottomRight'].map(function (k) { return res.corners[k]; }).filter(Boolean);
    check('至少一侧底部 R ≈ ' + expect.bottomRAny,
      anyD.some(function (c) { return near(c.R, expect.bottomRAny, expect.tol || 6); }),
      anyD.map(function (c) { return c.R; }).join(' / ') || '（都测不到）');
  }
  if (expect.bottomMaxErr !== undefined) {
    ['bottomLeft', 'bottomRight'].forEach(function (k) {
      var cc = res.corners[k];
      check(k + ' 残差 ≤ ' + expect.bottomMaxErr, cc && cc.err <= expect.bottomMaxErr, cc ? '实测 ' + cc.err.toFixed(2) : '无');
    });
  }
  if (expect.topR !== undefined) {
    var t = res.corners.topLeft, t2 = res.corners.topRight, tol2 = expect.tol || 8;
    check('左上 R ≈ ' + expect.topR, t && near(t.R, expect.topR, tol2), t ? '实测 R=' + t.R : '无');
    check('右上 R ≈ ' + expect.topR, t2 && near(t2.R, expect.topR, tol2), t2 ? '实测 R=' + t2.R : '无');
  }
  if (expect.model) {
    var cc2 = res.corners.bottomLeft;
    check('左下最佳模型 = ' + expect.model, cc2 && cc2.model === expect.model, cc2 ? '实测 ' + cc2.model + ' (yt=' + cc2.yt + ')' : '无');
  }
  if (expect.scale !== undefined) {
    check('缩放标定 ≈ ' + expect.scale, near(res.scale.sx, expect.scale, 0.02) && near(res.scale.sy, expect.scale, 0.02),
      '实测 sx=' + res.scale.sx.toFixed(4) + ' sy=' + res.scale.sy.toFixed(4));
  }
  if (expect.suggest !== undefined) {
    check('建议半径 = ' + expect.suggest, res.suggest.displayRadius !== null && near(res.suggest.displayRadius, expect.suggest, 8), '实测 ' + res.suggest.displayRadius);
  }
  if (expect.notchR !== undefined) {
    var nk = (res.notch || []).filter(function (n) { return near(n.R, expect.notchR, expect.tol || 6); });
    check('识别出「遮挡物圆角」R ≈ ' + expect.notchR, nk.length > 0,
      (res.notch || []).map(function (n) { return n.corner + ':R=' + n.R + '@y' + n.edgeRow; }).join(' ') || '（未识别）');
  }
  if (expect.notchEdge !== undefined) {
    var nk2 = (res.notch || [])[0];
    check('遮挡物直边位置 ≈ H-' + expect.notchEdge, nk2 && near(nk2.edgeRow, H - expect.notchEdge, 8),
      nk2 ? '实测 y=' + nk2.edgeRow : '无');
  }
  if (expect.safeBottom !== undefined) {
    check('安全区下界 ≈ H-' + expect.safeBottom, near(res.visible.safeBottom, H - expect.safeBottom, 8),
      '实测 y=' + res.visible.safeBottom);
  }
  if (expect.safeTop !== undefined) {
    check('安全区上界 ≈ ' + expect.safeTop, near(res.visible.safeTop, expect.safeTop, 8), '实测 y=' + res.visible.safeTop);
  }
  if (expect.bottomUnknown) {
    ['bottomLeft', 'bottomRight'].forEach(function (k) {
      check(k + ' 应报「测不到」', res.corners[k] === null, res.corners[k] ? '却给出 R=' + res.corners[k].R : '');
    });
  }
  if (expect.topUnknown) {
    ['topLeft', 'topRight'].forEach(function (k) {
      check(k + ' 应报「测不到」', res.corners[k] === null, res.corners[k] ? '却给出 R=' + res.corners[k].R : '');
    });
  }
  if (expect.noRadius) check('不给出任何半径建议', res.suggest.displayRadius === null, '实测 ' + res.suggest.displayRadius);
  if (expect.sheetAt !== undefined) {
    var bl = res.corners.bottomLeft;
    check('左下弧顶 yt ≈ H-' + expect.sheetAt + '（面板顶边，而非屏幕底边）',
      bl && near(bl.yt, H - expect.sheetAt, 8), bl ? '实测 yt=' + bl.yt : '无');
    check('左下模型为 free（不是屏幕物理圆角）', bl && bl.model === 'free', bl ? '实测 ' + bl.model : '无');
  }
  if (expect.warnAbout) {
    check('给出提示「' + expect.warnAbout + '」', res.warnings.some(function (w) { return w.indexOf(expect.warnAbout) >= 0; }), res.warnings.join(' | ') || '（无警告）');
  }
  if (expect.noWarn) {
    check('无警告', res.warnings.length === 0, res.warnings.join(' | ') || '（无警告）');
  }
  return res;
}

/* ================= 用例 =================
   预期值遵循一个物理事实：看不见的圆角测不出来。
   底部遮挡高度 ≥ 圆角半径时，屏幕物理圆角整段被遮在 UI 之下 → 底部 R 必须报「测不到」，
   此时顶部圆角（同机同值）仍然可用；反之亦然。 */
console.log('ScreenRuler v' + R.VERSION + ' 自检 —— 模拟「截图 → 反解屏幕圆角 / 遮挡」全链路\n');

var MW = 393, MH = 852;   // 典型全面屏 CSS 尺寸（iPhone 15 / 多数 6.1" 安卓）

run('A. 全面屏 R=44 + 底部被浏览器 UI 遮 60px（圆角被遮住，测不到底部）', MW, MH,
  { bottomR: 44, topR: 44, occludeBottom: 60 },
  { occluded: 60, bottomUnknown: true, topR: 44, suggest: 44, noWarn: true });

run('B. 全面屏 R=44，无任何遮挡（QQ 内置浏览器全屏态）', MW, MH,
  { bottomR: 44, topR: 44 },
  { occluded: 0, bottomR: 44, topR: 44, model: 'atScreenBottom', suggest: 44, noWarn: true });

run('C. 方角屏（R=0）+ 底部被遮 40px → 四角都应报「测不到圆角」', MW, MH,
  { occludeBottom: 40 },
  { occluded: 40, bottomUnknown: true, topUnknown: true, noRadius: true });

run('D. 底部为圆角面板 R=44、高 140px（是「遮挡物的圆角」，不是屏幕圆角）', MW, MH,
  { sheetH: 140, sheetR: 44 },
  { notchR: 44, notchEdge: 140, safeBottom: 140, bottomUnknown: true });

run('E. 截图被缩到 0.5x 且 +6 色偏', MW, MH,
  { bottomR: 44, topR: 44, occludeBottom: 60, scale: 0.5, tint: 6 },
  { occluded: 60, bottomUnknown: true, topR: 44, scale: 0.5, suggest: 44 });

run('F. 顶部被状态栏遮 80px（> 半径，顶部圆角确实测不到）+ 底部被遮 30px，R=52', MW, MH,
  { bottomR: 52, topR: 52, occludeBottom: 30, occludeTop: 80 },
  { occluded: 30, bottomRAny: 52, topUnknown: true, suggest: 52 });

run('G. 截图被裁短 120px（应给出「裁剪」警告，而不是编一个半径）', MW, MH,
  { bottomR: 44, topR: 44, occludeBottom: 60, cropBottom: 120 },
  { warnAbout: '裁剪' });

run('H. 平板 820×1180，小圆角 R=18（浅切弧线，全靠从 x=0 起扫）', 820, 1180,
  { bottomR: 18, topR: 18 },
  { occluded: 0, bottomR: 18, topR: 18, tol: 4, suggest: 18 });

run('I. 手机真实形态：dpr=3 的整屏高清截图（无遮挡，R=44）', MW, MH,
  { bottomR: 44, topR: 44, scale: 3 },
  { occluded: 0, bottomR: 44, topR: 44, scale: 3, suggest: 44, safeTop: 44 });

run('J. 暗色 UI 遮挡（深灰而非纯黑）+ R=44', MW, MH,
  { bottomR: 44, topR: 44, occludeBottom: 70, occludeColor: [14, 15, 20] },
  { occluded: 70, bottomUnknown: true, topR: 44, suggest: 44 });

console.log('\n──────────────────────────────');
console.log((FAIL === 0 ? '全部通过 ✅' : '有失败项 ❌') + '：' + PASS + ' passed, ' + FAIL + ' failed');
process.exit(FAIL === 0 ? 0 : 1);
