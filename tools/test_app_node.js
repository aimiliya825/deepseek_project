#!/usr/bin/env node
/* Integration smoke test for app.js + parts-data.js + model.js without WebGL.
 * Mocks the DOM and renderer, exercises boot, selection, explode/assemble.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

/* ---------- canvas / 2d stub ---------- */
function gradient() { return { addColorStop() {} }; }
function ctx2d() {
  return new Proxy({
    createLinearGradient: gradient, createRadialGradient: gradient, createConicGradient: gradient,
    measureText: (t) => ({ width: String(t).length * 6 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
  }, {
    get(o, k) { return k in o ? o[k] : (typeof k === 'string' ? function () {} : undefined); },
    set(o, k, v) { o[k] = v; return true; }
  });
}
function canvasEl() {
  const el = new El('canvas');
  el.getContext = () => ctx2d();
  el.toDataURL = () => 'data:image/png;base64,';
  return el;
}

/* ---------- DOM stub ---------- */
const allElements = [];
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = '';
    this.className = '';
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.style = new Proxy({ setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } }, {
      get(o, k) { return k in o ? o[k] : ''; }, set(o, k, v) { o[k] = v; return true; }
    });
    this.classList = {
      _set: new Set(),
      add: (...c) => c.forEach((x) => this.classList._set.add(x)),
      remove: (...c) => c.forEach((x) => this.classList._set.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !this.classList._set.has(c) : !!force;
        if (on) this.classList._set.add(c); else this.classList._set.delete(c);
        return on;
      },
      contains: (c) => this.classList._set.has(c)
    };
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.tabIndex = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.textContent = '';
    this._innerHTML = '';
    allElements.push(this);
  }
  set innerHTML(v) { this._innerHTML = String(v); this.children.length = 0; }
  get innerHTML() { return this._innerHTML; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return this.attributes[k] == null ? null : this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  focus() {}
  blur() {}
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  contains() { return false; }
  getContext() { return ctx2d(); }
  get rootNode() { return document; }
}

const bootScreen = new El('div');
bootScreen.id = 'boot-screen';
const bootBar = new El('span'); bootBar.id = 'boot-bar';
const bootPercent = new El('span'); bootPercent.id = 'boot-percent';
const bootStatus = new El('span'); bootStatus.id = 'boot-status';
const byId = new Map();
const ids = ['app', 'scene', 'label-layer', 'label-items', 'leader-lines', 'leader-dots', 'cursor-tip', 'boot-screen',
  'boot-bar', 'boot-percent', 'boot-status', 'webgl-error', 'toast-stack', 'ui-root'];
for (const id of ids) {
  const el = id === 'boot-screen' ? bootScreen : id === 'boot-bar' ? bootBar : id === 'boot-percent' ? bootPercent : id === 'boot-status' ? bootStatus : new El('div');
  el.id = id;
  byId.set(id, el);
}
byId.get('webgl-error').hidden = true;

function el(tag) { return tag === 'canvas' ? canvasEl() : new El(tag); }
global.document = {
  readyState: 'complete',
  hidden: false,
  fullscreenElement: null,
  createElement: (tag) => el(tag),
  createElementNS: (ns, tag) => new El(tag),
  getElementById: (id) => byId.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  documentElement: new El('html'),
  body: new El('body')
};
global.window = global;
global.innerWidth = parseInt(process.env.A4_W || '1440', 10);
global.innerHeight = parseInt(process.env.A4_H || '900', 10);
global.devicePixelRatio = 1;
global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
global.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', position: 'fixed' });
global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.self = global;
global.addEventListener = function () {};
global.removeEventListener = function () {};
global.dispatchEvent = function () { return true; };
if (!global.ResizeObserver) global.ResizeObserver = class { observe() {} disconnect() {} };

/* error capture */
const errors = [];
process.on('uncaughtException', (err) => { errors.push('uncaught: ' + (err && err.stack || err)); });
process.on('unhandledRejection', (err) => { errors.push('unhandledRejection: ' + (err && err.stack || err)); });
const origError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); origError(...args); };

/* ---------- three + fake renderer/controls ---------- */
require(path.join(ROOT, 'vendor', 'three.bundle.js'));
const THREE = global.THREE;
class FakeRenderer {
  constructor() {
    this.domElement = canvasEl();
    this.domElement.addEventListener = () => {};
    this.shadowMap = { enabled: false, type: 0 };
    this.info = { render: { calls: 0, triangles: 0 } };
    this._pr = 1;
  }
  setPixelRatio(v) { this._pr = v; }
  getPixelRatio() { return this._pr; }
  setSize() {}
  getSize() { return { x: global.innerWidth, y: global.innerHeight, width: global.innerWidth, height: global.innerHeight }; }
  setClearColor() {}
  render() { this.info.render.calls++; }
  dispose() {}
}
class FakeOrbitControls {
  constructor(camera, dom) {
    this.object = camera;
    this.domElement = dom;
    this.target = new THREE.Vector3();
    this.enabled = true;
    this.autoRotate = false;
    this.minDistance = 1;
    this.maxDistance = 100;
  }
  addEventListener() {}
  removeEventListener() {}
  update() { this.object.lookAt(this.target); this.object.updateMatrixWorld(true); }
  dispose() {}
}
THREE.WebGLRenderer = FakeRenderer;
THREE.OrbitControls = FakeOrbitControls;
THREE.EffectComposer = null;
THREE.RenderPass = null;
THREE.UnrealBloomPass = null;
THREE.OutputPass = null;

/* ---------- run scripts ---------- */
function run(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
}
run('src/parts-data.js');
run('src/model.js');
run('src/app.js');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const started = Date.now();
  while (!global.__A4_READY__ && Date.now() - started < 9000) await wait(100);
  const stateBefore = global.__A4_DEBUG__ ? JSON.parse(JSON.stringify(global.__A4_DEBUG__.state)) : null;
  const stats = global.__A4_DEBUG__ ? global.__A4_DEBUG__.getStats() : null;
  if (!global.__A4_READY__) {
    console.log(JSON.stringify({ ok: false, reason: 'boot did not complete', errors, stateBefore }, null, 2));
    process.exit(2);
  }
  await wait(300);
  if (global.__A4_DEBUG__) {
    global.__A4_DEBUG__.api.selectPart('lens');
    await wait(300);
    global.__A4_DEBUG__.api.explodeAll();
    await wait(2600);
  }
  const progress = global.__A4_DEBUG__ ? global.__A4_DEBUG__.getProgress() : null;
  const stateExploded = global.__A4_DEBUG__ ? JSON.parse(JSON.stringify(global.__A4_DEBUG__.state)) : null;
  const statsExploded = global.__A4_DEBUG__ ? global.__A4_DEBUG__.getStats() : null;
  for (const id of ['lensCover', 'mainboard', 'battery', 'topControls', 'mount']) {
    if (!progress || (progress[id] || 0) < 0.98) errors.push('part did not explode: ' + id + ' progress=' + (progress && progress[id]));
  }
  const minLabels = global.innerWidth <= 900 ? 1 : 9;
  if (statsExploded && statsExploded.labelsVisible < minLabels) errors.push('too few exploded labels visible: ' + statsExploded.labelsVisible);
  if (global.__A4_DEBUG__) {
    global.__A4_DEBUG__.api.assembleAll();
    await wait(2600);
  }
  const progress2 = global.__A4_DEBUG__ ? global.__A4_DEBUG__.getProgress() : null;
  for (const id of Object.keys(progress2 || {})) {
    if (progress2[id] > 0.02) errors.push('part did not assemble: ' + id + ' progress=' + progress2[id]);
  }
  const stats2 = global.__A4_DEBUG__ ? global.__A4_DEBUG__.getStats() : null;
  const stateAssembled = global.__A4_DEBUG__ ? JSON.parse(JSON.stringify(global.__A4_DEBUG__.state)) : null;
  const report = {
    ok: errors.length === 0,
    bootMs: Date.now() - started,
    stateBefore,
    stats,
    progress,
    stateExploded,
    statsExploded,
    progress2,
    stateAssembled,
    stats2,
    errors
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(errors.length ? 1 : 0);
})();
