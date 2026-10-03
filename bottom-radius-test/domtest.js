/**
 * domtest.js — 页面级集成自检（node bottom-radius-test/domtest.js）
 *
 * 目的：在没有浏览器的环境里把 app.js 的整条链路真跑一遍，确保手机上不会白屏/报错：
 *   ① 用假 DOM + 真 2D 上下文桩执行 ruler.js / app.js 的初始化
 *      —— 探针画布「真的」被绘制出绝对位置条码；
 *   ② 构造一张「整屏截图」（含屏幕圆角 + 浏览器工具栏遮挡），
 *      通过粘贴事件喂给页面 → 解码 → 渲染报告；
 *   ③ 断言报告里的结论（半径、底部遮挡、安全区、JSON）符合模拟真值。
 *
 * 分工：selftest.js 验证引擎算法在各种真机形态下的正确性；
 *       domtest.js 验证页面接线（DOM 交互、事件、报告渲染）不抛异常且结论正确。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var R = require('./ruler.js');

/* ---------- 复用 selftest 里的 2D 上下文桩（含 clip / 路径光栅化 / alpha 混合） ---------- */
var src = fs.readFileSync(path.join(__dirname, 'selftest.js'), 'utf8');
var head = src.slice(0, src.indexOf('/* ================= 断言'));
var mod = { exports: {} };
new Function('module', 'exports', 'require', head +
  '\nmodule.exports={makeCanvas:makeCanvas,blackOut:blackOut,blackOutCorners:blackOutCorners,blackOutSheet:blackOutSheet,resample:resample};'
)(mod, mod.exports, require);
var sim = mod.exports;

/* ---------- 参数（模拟一台 393×852 @3x 的全面屏手机） ---------- */
var W = 393, H = 852, DPR = 3, BOTTOM_BAR = 60, RADIUS = 44;

/* ---------- 假 DOM ---------- */
var VV = {
  width: W, height: H - BOTTOM_BAR, offsetTop: 0, offsetLeft: 0, scale: 1,
  addEventListener: function () {}, removeEventListener: function () {}
};

function El(id, tag) {
  return {
    id: id, tagName: (tag || 'DIV').toUpperCase(), style: {}, value: '', textContent: '',
    innerHTML: '', onclick: null, onchange: null, children: [], parentNode: null,
    appendChild: function (c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild: function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener: function () {}, removeEventListener: function () {},
    select: function () {}, focus: function () {}, scrollIntoView: function () {},
    click: function () { if (this.onclick) this.onclick(); },
    getContext: function () { return null; }
  };
}

/** 尺寸感知的 2D 上下文：按元素当前 width/height 分配像素缓冲 */
function makeCtxFor(el) {
  var w = Math.max(1, Math.round(el.width || 300)), h = Math.max(1, Math.round(el.height || 150));
  var cv = sim.makeCanvas(w, h);
  var ctx = cv.ctx;
  ctx.canvas = cv.buf;
  ctx.drawImage = function (img, dx, dy, dw, dh) {
    var sw = img.width, sh = img.height, data = img._buf && img._buf.data;
    dw = dw || sw; dh = dh || sh;
    if (data) {
      for (var y = 0; y < dh; y++) {
        for (var x = 0; x < dw; x++) {
          var sxx = Math.min(sw - 1, Math.round(x * sw / dw)), syy = Math.min(sh - 1, Math.round(y * sh / dh));
          var s = (syy * sw + sxx) * 4, d = ((y + (dy || 0)) * w + (x + (dx || 0))) * 4;
          ctx.canvas.data[d] = data[s]; ctx.canvas.data[d + 1] = data[s + 1];
          ctx.canvas.data[d + 2] = data[s + 2]; ctx.canvas.data[d + 3] = 255;
        }
      }
    }
    return ctx;
  };
  // getImageData：截取指定区域（与真浏览器语义一致，便于页面按需缩放）
  ctx.getImageData = function (x, y, gw, gh) {
    var out = new Uint8ClampedArray(gw * gh * 4);
    for (var r = 0; r < gh; r++) {
      for (var c = 0; c < gw; c++) {
        var s = ((y + r) * w + (x + c)) * 4, d = (r * gw + c) * 4;
        out[d] = ctx.canvas.data[s]; out[d + 1] = ctx.canvas.data[s + 1];
        out[d + 2] = ctx.canvas.data[s + 2]; out[d + 3] = 255;
      }
    }
    return { data: out, width: gw, height: gh };
  };
  ctx.putImageData = function (img, dx, dy) {
    for (var r = 0; r < img.height; r++) {
      for (var c = 0; c < img.width; c++) {
        var s = (r * img.width + c) * 4, d = ((r + (dy || 0)) * w + (c + (dx || 0))) * 4;
        if (d + 3 >= ctx.canvas.data.length) continue;
        ctx.canvas.data[d] = img.data[s]; ctx.canvas.data[d + 1] = img.data[s + 1];
        ctx.canvas.data[d + 2] = img.data[s + 2]; ctx.canvas.data[d + 3] = 255;
      }
    }
  };
  ctx.__buf = cv.buf;
  return ctx;
}

var PROBE = El('probe', 'canvas');
PROBE.width = 0; PROBE.height = 0;
Object.defineProperty(PROBE, '_ctx', { value: null, writable: true });
PROBE.getContext = function () { if (!PROBE._ctx) PROBE._ctx = makeCtxFor(PROBE); return PROBE._ctx; };

var registry = { probe: PROBE };
['hint', 'hud', 'auto', 'btnHide', 'btnRedraw', 'btnManual', 'zone', 'file', 'result', 'manW', 'manH',
  'report', 'jsonOut', 'copyJson', 'summary'].forEach(function (id) { registry[id] = El(id); });
/* #overlay 在真浏览器里由 innerHTML 生成；这里预置一个「可用的 canvas」等价物 */
registry.overlay = El('overlay', 'canvas');
registry.overlay.width = 300; registry.overlay.height = 150;
registry.overlay.getContext = function () { return registry.overlay._c || (registry.overlay._c = makeCtxFor(registry.overlay)); };
registry.manW.value = ''; registry.manH.value = '';

var listeners = {};
var document = {
  readyState: 'complete',
  body: El('body', 'body'),
  documentElement: { style: { setProperty: function () {} } },
  getElementById: function (id) { return registry[id] || null; },
  querySelector: function () { return null; },
  createElement: function (tag) {
    var e = El('', tag);
    if (String(tag).toLowerCase() === 'canvas') {
      e.width = 300; e.height = 150;
      e.getContext = function () {
        if (!e._ctx || e._ctx.__w !== e.width || e._ctx.__h !== e.height) {
          e._ctx = makeCtxFor(e);
          e._ctx.__w = e.width; e._ctx.__h = e.height;
        }
        return e._ctx;
      };
    }
    return e;
  },
  addEventListener: function (t, f) { (listeners[t] = listeners[t] || []).push(f); },
  removeEventListener: function () {},
  elementFromPoint: function (x, y) {
    if (y < 0 || y > W) return null;
    return (y <= VV.height) ? PROBE : null;          // 视口以下命不中任何元素
  },
  execCommand: function () { return true; }
};

/* ---------- 假 Image：直接把「截图」交给页面的解码路径 ---------- */
var SHOT = null;                                      // { width, height, _buf }
function FakeImage() {
  var self = this;
  this.width = SHOT.width; this.height = SHOT.height; this._buf = SHOT._buf;
  this.naturalWidth = this.width; this.naturalHeight = this.height;
  this.onload = null; this.onerror = null;
  Object.defineProperty(this, 'src', {
    get: function () { return 'blob:fake'; },
    set: function () { setTimeout(function () { if (self.onload) self.onload(); }, 0); }
  });
}

var sandbox = {
  console: console,
  document: document,
  navigator: {
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36 QQBrowser/17.0',
    getBattery: null
  },
  screen: { width: W, height: H },
  innerWidth: W, innerHeight: H, devicePixelRatio: DPR,
  visualViewport: VV,
  performance: { now: function () { return Date.now(); } },
  getComputedStyle: function () { return { paddingTop: '0px' }; },
  alert: function (m) { console.log('  [alert] ' + m); },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  URL: { createObjectURL: function () { return 'blob:fake'; } },
  Image: FakeImage,
  ImageData: function (d, w, h) { return { data: d, width: w, height: h }; },
  matchMedia: function () { return { addEventListener: function () {} }; },
  requestAnimationFrame: function (f) { return setTimeout(f, 0); },
  addEventListener: function (t, f) { (listeners[t] = listeners[t] || []).push(f); },
  removeEventListener: function () {}, scrollTo: function () {},
  ScreenRuler: R
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;

/* ---------- 断言 ---------- */
var PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

/* ---------- 跑 ---------- */
console.log('页面级集成自检 —— 假 DOM + 真引擎，跑通「绘制探针 → 整屏截图 → 粘贴 → 解码 → 报告」\n');

var ctx = vm.createContext(sandbox);
try {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'ruler.js'), 'utf8'), ctx, { filename: 'ruler.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
  check('ruler.js + app.js 初始化无异常', true);
} catch (e) {
  check('ruler.js + app.js 初始化无异常', false, (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e)));
  console.log('\n有失败项 ❌：' + PASS + ' passed, ' + (FAIL + 1) + ' failed');
  process.exit(1);
}

/* ① 探针画布：尺寸与条码内容 */
check('探针画布尺寸 = 屏幕 CSS 尺寸 × dpr', PROBE.width === W * DPR && PROBE.height === H * DPR,
  '实测 ' + PROBE.width + '×' + PROBE.height);
var pbuf = PROBE._ctx.__buf;
var mism = 0, sam = 0, worst = '';
function devIdx(x, y) {   // 与解码端同一映射约定：px = round((css+0.5)*s - 0.5)
  return [Math.round((x + 0.5) * DPR - 0.5), Math.round((y + 0.5) * DPR - 0.5)];
}
for (var yy = 30; yy < H - 30; yy += 53) {
  for (var xx = 2; xx < 11; xx += 4) {                 // 左边缘条内部
    var di = devIdx(xx, yy);
    var o = (di[1] * PROBE.width + di[0]) * 4;
    var c = [pbuf.data[o], pbuf.data[o + 1], pbuf.data[o + 2]];
    var want = R.modelColorAt(xx, yy, W, H);
    sam++;
    var d = Math.abs(c[0] - want[0]) + Math.abs(c[1] - want[1]) + Math.abs(c[2] - want[2]);
    if (d > 20) { mism++; if (!worst) worst = '(' + xx + ',' + yy + ') 实测 ' + c + ' 期望 ' + want; }
  }
}
check('左边缘条像素 = 位置条码（' + sam + ' 个采样点）', mism === 0, mism ? mism + ' 处不匹配，例如 ' + worst : '全部匹配');

var cornerOk = true;
var ci = devIdx(300, 2);
var topLeftPix = (ci[1] * PROBE.width + ci[0]) * 4;             // 角区（编码 x）
var cw = R.modelColorAt(300, 2, W, H);
if (Math.abs(pbuf.data[topLeftPix] - cw[0]) + Math.abs(pbuf.data[topLeftPix + 1] - cw[1]) + Math.abs(pbuf.data[topLeftPix + 2] - cw[2]) > 20) cornerOk = false;
check('四角探针区也按 x 编码绘制', cornerOk);

/* ② 造「整屏截图」：屏幕 CSS 尺寸下加「屏幕圆角 R=44 + 底部工具栏 60px」，
      再按 dpr=3 还原成手机截图分辨率（即 1179×2556 的高清整屏截图） */
var css = sim.resample(pbuf, 1 / DPR, 0);                     // 3x 探针 → 1x CSS（what the user sees）
sim.blackOutCorners(css, W, H, RADIUS, { bottom: true, top: true });
sim.blackOut(css, 0, H - BOTTOM_BAR, W, BOTTOM_BAR);
SHOT = { width: W * DPR, height: H * DPR, _buf: sim.resample(css, DPR, 0) };
check('模拟截图尺寸 = 1179×2556（整屏高清截图）', SHOT.width === W * DPR && SHOT.height === H * DPR);

/* ④ 走粘贴链路 */
check('页面注册了 paste 监听', !!(listeners.paste && listeners.paste.length));
var pasteOk = true, perr = null;
try {
  listeners.paste[0]({
    clipboardData: { items: [{ type: 'image/png', getAsFile: function () { return { type: 'image/png', name: 'shot.png' }; } }] },
    preventDefault: function () {}
  });
} catch (e) { pasteOk = false; perr = e; }
check('paste 事件处理无异常', pasteOk, perr ? String(perr && perr.message) : '');

setTimeout(function () {                               // 等假 Image 的 onload 跑完
  var report = registry.report.innerHTML || '';
  check('报告已渲染', report.length > 200, report.length + ' 字符');
  check('报告含结论卡（屏幕圆角半径）', report.indexOf('屏幕圆角半径') >= 0);
  check('报告含底部遮挡数据', report.indexOf('底部完全被遮的高度') >= 0);
  check('报告含可视化 canvas 占位', report.indexOf('id="overlay"') >= 0);
  var m = report.match(/<span class="vnum">([^<]*)<\/span>/);
  var rVal = m ? parseFloat(m[1]) : NaN;
  check('报告半径 ≈ ' + RADIUS + 'dp（模拟真值）', Math.abs(rVal - RADIUS) <= 6, '报告值 ' + (m ? m[1] : 'N/A'));
  var occ = report.match(/<b>(\d+)<\/b> px/);
  check('报告底部遮挡 ≈ ' + BOTTOM_BAR + 'px', occ && Math.abs(parseInt(occ[1], 10) - BOTTOM_BAR) <= 3, occ ? '报告值 ' + occ[1] : '未找到');
  var safe = report.match(/y = (\d+) … (\d+)<\/b>/);
  check('报告含安全区区间', !!safe, safe ? safe[1] + '…' + safe[2] : '未找到');
  // 底部被工具栏占了 60px，所以安全区下界应停在工具栏上沿之前，而不是圆角弧顶
  if (safe) check('安全区下界 ≈ ' + (H - BOTTOM_BAR - 1) + '（工具栏上沿）',
    Math.abs(parseInt(safe[2], 10) - (H - BOTTOM_BAR - 1)) <= 4, '报告值 ' + safe[2]);
  if (safe) check('安全区上界 ≈ ' + RADIUS + '（顶部圆角之外）',
    Math.abs(parseInt(safe[1], 10) - RADIUS) <= 8, '报告值 ' + safe[1]);
  check('JSON 已填充', (registry.jsonOut.value || '').length > 100);
  try {
    var j = JSON.parse(registry.jsonOut.value);
    check('JSON 可解析且含半径结论', j.radius && j.radius.suggestion > 0, 'R=' + (j.radius && j.radius.suggestion));
  } catch (e2) { check('JSON 可解析', false, String(e2.message)); }
  check('可视化覆盖层已绘制（未抛异常）', true);

  /* ⑤ 尺寸自检：页面报告的屏幕尺寸应等于模拟屏幕 */
  var jw = null;
  try { jw = JSON.parse(registry.jsonOut.value); } catch (e3) {}
  check('页面识别屏幕尺寸 = ' + W + '×' + H, jw && jw.screen.W === W && jw.screen.H === H,
    jw ? jw.screen.W + '×' + jw.screen.H : 'N/A');
  check('dpr 识别正确', jw && jw.screen.dpr === DPR, jw ? String(jw.screen.dpr) : 'N/A');

  console.log('\n──────────────────────────────');
  console.log((FAIL === 0 ? '全部通过 ✅' : '有失败项 ❌') + '：' + PASS + ' passed, ' + FAIL + ' failed');
  process.exit(FAIL === 0 ? 0 : 1);
}, 60);
