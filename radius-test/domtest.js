'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var R = require('./ruler.js');

var src = fs.readFileSync(path.join(__dirname, 'selftest.js'), 'utf8');
var head = src.slice(0, src.indexOf('/* ================= 断言'));
var simMod = { exports: {} };
new Function('module', 'exports', 'require', head +
  '\nmodule.exports={makeCanvas:makeCanvas,blackOut:blackOut,blackOutCorners:blackOutCorners,blackOutSheet:blackOutSheet,resample:resample};'
)(simMod, simMod.exports, require);
var sim = simMod.exports;

var HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var APP = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
var idsIn = function (text) {
  var out = [], re = /id="([A-Za-z][\w-]*)"/g, m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
};
var STATIC_IDS = idsIn(HTML);
var DYN_IDS = idsIn(APP);                                  
var usedIds = (function () {
  var out = [], re = /\$\('([A-Za-z][\w-]*)'\)/g, m;
  while ((m = re.exec(APP))) out.push(m[1]);
  return out;
})();

var W = 393, H = 852, DPR = 3, BOTTOM_BAR = 60, RADIUS = 44;

var VV = { width: W, height: H - BOTTOM_BAR, offsetTop: 0, offsetLeft: 0, scale: 1,
  addEventListener: function () {}, removeEventListener: function () {} };

function El(id, tag) {
  return {
    id: id, tagName: (tag || 'DIV').toUpperCase(), style: {}, value: '', textContent: '',
    innerHTML: '', className: '', onclick: null, onchange: null, children: [], parentNode: null,
    appendChild: function (c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild: function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener: function () {}, removeEventListener: function () {},
    select: function () {}, focus: function () {}, blur: function () {}, scrollIntoView: function () {},
    click: function () { if (this.onclick) this.onclick(); },
    getContext: function () { return null; }
  };
}

function makeCtxFor(el) {
  var w = Math.max(1, Math.round(el.width || 300)), h = Math.max(1, Math.round(el.height || 150));
  var cv = sim.makeCanvas(w, h);
  var ctx = cv.ctx;
  ctx.canvas = cv.buf;
  ctx.drawImage = function (img, dx, dy, dw, dh) {
    var sw = img.width, sh = img.height, data = img._buf && img._buf.data;
    dw = dw || sw; dh = dh || sh;
    if (data) {
      for (var y = 0; y < dh; y++) for (var x = 0; x < dw; x++) {
        var sxx = Math.min(sw - 1, Math.round(x * sw / dw)), syy = Math.min(sh - 1, Math.round(y * sh / dh));
        var s = (syy * sw + sxx) * 4, d = ((y + (dy || 0)) * w + (x + (dx || 0))) * 4;
        if (d + 3 >= ctx.canvas.data.length) continue;
        ctx.canvas.data[d] = data[s]; ctx.canvas.data[d + 1] = data[s + 1];
        ctx.canvas.data[d + 2] = data[s + 2]; ctx.canvas.data[d + 3] = 255;
      }
    }
    return ctx;
  };
  ctx.getImageData = function (x, y, gw, gh) {
    var out = new Uint8ClampedArray(gw * gh * 4);
    for (var r = 0; r < gh; r++) for (var c = 0; c < gw; c++) {
      var s = ((y + r) * w + (x + c)) * 4, d = (r * gw + c) * 4;
      out[d] = ctx.canvas.data[s]; out[d + 1] = ctx.canvas.data[s + 1];
      out[d + 2] = ctx.canvas.data[s + 2]; out[d + 3] = 255;
    }
    return { data: out, width: gw, height: gh };
  };
  ctx.putImageData = function (img, dx, dy) {
    for (var r = 0; r < img.height; r++) for (var c = 0; c < img.width; c++) {
      var s = (r * img.width + c) * 4, d = ((r + (dy || 0)) * w + (c + (dx || 0))) * 4;
      if (d + 3 >= ctx.canvas.data.length) continue;
      ctx.canvas.data[d] = img.data[s]; ctx.canvas.data[d + 1] = img.data[s + 1];
      ctx.canvas.data[d + 2] = img.data[s + 2]; ctx.canvas.data[d + 3] = 255;
    }
  };
  ctx.__buf = cv.buf;
  return ctx;
}

var registry = {};
STATIC_IDS.forEach(function (id) {
  if (id === 'probe') {
    var p = El('probe', 'canvas');
    p.width = 0; p.height = 0;
    p.getContext = function () { if (!p._ctx) p._ctx = makeCtxFor(p); return p._ctx; };
    registry.probe = p;
  } else registry[id] = El(id);
});
/* app.js 用 innerHTML 生成的元素（渲染报告后才存在） */
DYN_IDS.forEach(function (id) {
  if (registry[id]) return;
  var e = El(id, id === 'overlay' ? 'canvas' : 'div');
  if (id === 'overlay') {
    e.width = 300; e.height = 150;
    e.getContext = function () { return e._c || (e._c = makeCtxFor(e)); };
  }
  registry[id] = e;
});

var listeners = {};
var document = {
  readyState: 'complete',
  body: El('body', 'body'),
  documentElement: { style: { setProperty: function () {} } },
  getElementById: function (id) { return registry[id] || null; },     // ← 未知 id = null
  querySelector: function () { return null; },
  createElement: function (tag) {
    var e = El('', tag);
    if (String(tag).toLowerCase() === 'canvas') {
      e.width = 300; e.height = 150;
      e.getContext = function () {
        if (!e._ctx || e._ctx.__w !== e.width || e._ctx.__h !== e.height) {
          e._ctx = makeCtxFor(e); e._ctx.__w = e.width; e._ctx.__h = e.height;
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
    return (y <= VV.height) ? registry.probe : null;
  },
  execCommand: function () { return true; }
};

var SHOT = null;
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
var clipboardImage = null;                                  

var sandbox = {
  console: console,
  document: document,
  navigator: {
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/126 Mobile Safari/537.36 QQBrowser/17.0',
    getBattery: null,
    clipboard: {
      read: function () {
        if (!clipboardImage) return Promise.reject(new Error('empty'));
        return Promise.resolve([{ types: ['image/png'], getType: function () { return Promise.resolve(clipboardImage); } }]);
      }
    }
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
  ScreenRuler: R,
  Promise: Promise
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;

var PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function txt() { return registry.status ? registry.status.textContent : ''; }
function rep() { return registry.result ? registry.result.innerHTML : ''; }
function reportRadius() {
  var m = rep().match(/<span class="vnum">([^<]*)<\/span>/);
  return m ? parseFloat(m[1]) : NaN;
}

function makeShot() {
  var probeBuf = registry.probe._ctx.__buf;                 // 3x 探针像素
  var css = sim.resample(probeBuf, 1 / DPR, 0);             // → 1x 用户所见
  sim.blackOutCorners(css, W, H, RADIUS, { bottom: true, top: true });
  sim.blackOut(css, 0, H - BOTTOM_BAR, W, BOTTOM_BAR);
  SHOT = { width: W * DPR, height: H * DPR, _buf: sim.resample(css, DPR, 0) };
}

var ctx = vm.createContext(sandbox);
try {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'ruler.js'), 'utf8'), ctx, { filename: 'ruler.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
  check('ruler.js + app.js 初始化无异常', true);
} catch (e) {
  check('ruler.js + app.js 初始化无异常', false, (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)));
  console.log('\n有失败项：' + PASS + ' passed, ' + (FAIL + 1) + ' failed');
  process.exit(1);
}

var missing = usedIds.filter(function (id) {
  return STATIC_IDS.indexOf(id) < 0 && DYN_IDS.indexOf(id) < 0;
});
check('app.js 引用的 id 都真实存在（' + usedIds.length + ' 个）', missing.length === 0,
  missing.length ? '缺失: ' + missing.join(', ') : '');

check('探针尺寸 = CSS × dpr', registry.probe.width === W * DPR && registry.probe.height === H * DPR,
  registry.probe.width + '×' + registry.probe.height);
var pbuf = registry.probe._ctx.__buf, bad = 0, sam = 0;
for (var yy = 30; yy < H - 30; yy += 47) {
  for (var xx = 2; xx < 11; xx += 4) {
    var di = [Math.round((xx + 0.5) * DPR - 0.5), Math.round((yy + 0.5) * DPR - 0.5)];
    var o = (di[1] * registry.probe.width + di[0]) * 4;
    var c = [pbuf.data[o], pbuf.data[o + 1], pbuf.data[o + 2]], want = R.modelColorAt(xx, yy, W, H);
    sam++;
    if (Math.abs(c[0] - want[0]) + Math.abs(c[1] - want[1]) + Math.abs(c[2] - want[2]) > 20) bad++;
  }
}
check('边缘条素 = 位置条码（' + sam + ' 点）', bad === 0, bad ? bad + ' 处不符' : '');
check('探测表已渲染', (registry.auto.innerHTML || '').indexOf('底部占用') >= 0);
check('未出现错误状态', txt().indexOf('错误') < 0, '状态: ' + txt());

var flows = [
  ['paste 事件', function () {
    var ev = { clipboardData: { files: [ { type: 'image/png' } ], items: [] }, preventDefault: function () {} };
    listeners.paste[0](ev);
  }],
  ['file 选择', function () { registry.file.onchange({ target: { files: [{ type: 'image/png' }] } }); }],
  ['剪贴板按钮', function () { clipboardImage = { type: 'image/png' }; registry.btnPaste.onclick(); }],
  ['拖放', function () {
    listeners.drop[0]({ preventDefault: function () {}, dataTransfer: { files: [{ type: 'image/png' }] } });
  }]
];

(async function runFlows() {
  for (var i = 0; i < flows.length; i++) {
    var name = flows[i][0];
    registry.result.innerHTML = '';
    registry.status.textContent = '';
    makeShot();
    flows[i][1]();
    await sleep(40);
    var r = reportRadius();
    check('通道「' + name + '」→ 报告半径 ≈ ' + RADIUS,
      Math.abs(r - RADIUS) <= 6, '报告值 ' + (isNaN(r) ? '（无报告）' : r) + ' · 状态 ' + txt());
    check('通道「' + name + '」→ 底部遮挡 ≈ ' + BOTTOM_BAR,
      rep().indexOf('<b>' + BOTTOM_BAR + '</b> px') >= 0 || /<b>6[01]<\/b> px/.test(rep()),
      (rep().match(/底部被遮<\/td><td><b>(\d+)<\/b>/) || [])[1] || '未找到');
  }

  registry.result.innerHTML = ''; registry.status.textContent = '';
  clipboardImage = null;
  registry.btnPaste.onclick();
  await sleep(40);
  check('剪贴板失败 → 显示粘贴框（有反馈）', registry.pastebox.className === 'on',
    'class="' + registry.pastebox.className + '" 状态: ' + txt());

  /* ⑤ JSON */
  makeShot();
  registry.result.innerHTML = '';
  registry.file.onchange({ target: { files: [{ type: 'image/png' }] } });
  await sleep(40);
  var okJson = false, j = null;
  try { j = JSON.parse(registry.jsonOut.value); okJson = true; } catch (e) {}
  check('JSON 可解析', okJson);
  check('JSON 含半径结论', j && j.radius && j.radius.suggestion > 0, j ? 'R=' + j.radius.suggestion : '');

  console.log('\n──────────────────────────────');
  console.log((FAIL === 0 ? 'ALL通过' : '有失败项') + '：' + PASS + ' passed, ' + FAIL + ' failed');
  process.exit(FAIL === 0 ? 0 : 1);
})();
