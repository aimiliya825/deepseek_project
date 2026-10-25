#!/usr/bin/env node
/* Static/in-process validation for src/model.js without a browser.
 * Runs the real procedural model in Node using a minimal 2D canvas stub.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function makeGradient() {
  return { addColorStop() {} };
}
function makeContext2D() {
  const ctx = {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'alphabetic', filter: 'none',
    shadowColor: '#000', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    lineCap: 'butt', lineJoin: 'miter', imageSmoothingEnabled: true,
    createLinearGradient() { return makeGradient(); },
    createRadialGradient() { return makeGradient(); },
    createConicGradient() { return makeGradient(); },
    createPattern() { return null; },
    measureText(t) { return { width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }; },
    putImageData() {}, drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {}, rect() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, roundRect() {}, fill() {}, stroke() {}, clip() {},
    fillRect() {}, strokeRect() {}, clearRect() {}, fillText() {}, strokeText() {}, setTransform() {},
    resetTransform() {}, transform() {}, createImageData(w, h) { return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }; }
  };
  return ctx;
}
function makeCanvas() {
  const canvas = {
    width: 1, height: 1,
    style: {},
    getContext(type) { const c = makeContext2D(); c.canvas = canvas; return c; },
    toDataURL() { return 'data:image/png;base64,'; },
    addEventListener() {}, removeEventListener() {}
  };
  return canvas;
}

global.window = global;
global.document = {
  createElement(tag) {
    if (String(tag).toLowerCase() === 'canvas') return makeCanvas();
    return { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} };
  },
  createElementNS() { return { style: {}, setAttribute() {}, appendChild() {} }; },
  getElementById() { return null; },
  addEventListener() {}
};
global.devicePixelRatio = 1;
global.innerWidth = 1440;
global.innerHeight = 900;

require(path.join(ROOT, 'vendor', 'three.bundle.js'));
const THREE = global.THREE;

const dataSrc = fs.readFileSync(path.join(ROOT, 'src', 'parts-data.js'), 'utf8');
vm.runInThisContext(dataSrc, { filename: 'parts-data.js' });
const modelSrc = fs.readFileSync(path.join(ROOT, 'src', 'model.js'), 'utf8');
vm.runInThisContext(modelSrc, { filename: 'model.js' });

if (!global.Action4Model || typeof global.Action4Model.create !== 'function') {
  throw new Error('window.Action4Model.create missing');
}
const t0 = Date.now();
const built = window.Action4Model.create(THREE);
const buildMs = Date.now() - t0;

let meshes = 0, triangles = 0, sprites = 0, lines = 0, points = 0, materials = 0, textureCount = 0;
const partStats = {};
const materialIds = new Set();
const errors = [];

built.root.traverse((o) => {
  if (o.isMesh) {
    meshes++;
    if (o.geometry) {
      const g = o.geometry;
      triangles += g.index ? g.index.count / 3 : (g.attributes && g.attributes.position ? g.attributes.position.count / 3 : 0);
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m) return;
      if (!materialIds.has(m.uuid)) { materialIds.add(m.uuid); materials++; }
      ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach((k) => {
        if (m[k]) textureCount++;
      });
      if (m.emissive && m.emissive.isColor) { /* checked below */ }
    });
    if (o.material && o.material.map) textureCount += 0;
  } else if (o.isSprite) sprites++;
  else if (o.isLine) lines++;
  else if (o.isPoints) points++;
});

for (const data of window.ACTION4_PARTS) {
  const p = built.parts[data.id];
  if (!p) { errors.push('missing part ' + data.id); continue; }
  const box = new THREE.Box3().setFromObject(p.group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const pos = p.group.position;
  if (Math.abs(pos.x) + Math.abs(pos.y) + Math.abs(pos.z) > 1e-9) errors.push('group not at origin: ' + data.id);
  if (!p.anchor || !p.anchor.isObject3D) errors.push('bad anchor: ' + data.id);
  if (!p.pickMeshes || !p.pickMeshes.length) errors.push('no pickMeshes: ' + data.id);
  (p.pickMeshes || []).forEach((m) => {
    if (m.userData.partId !== data.id) errors.push('pick mesh partId mismatch: ' + data.id);
  });
  const materialList = p.materials || [];
  materialList.forEach((m) => {
    if (!m || !m.isMaterial) errors.push('bad material in ' + data.id);
  });
  partStats[data.id] = {
    meshes: 0,
    materials: materialList.length,
    bboxSize: size.toArray().map((n) => +n.toFixed(2)),
    anchor: p.anchor.position.toArray(),
    hasFade: !!(p.fadeMaterials && p.fadeMaterials.length)
  };
  p.group.traverse((o) => { if (o.isMesh) partStats[data.id].meshes++; });
}

const body = built.parts.body;
if (!body || !body.fadeMaterials || !body.fadeMaterials.length) errors.push('body fadeMaterials missing');

let updateError = null;
try { built.update(0.016, 1.2, { exploded: true, explodedCount: 3, selectedId: 'lens' }); } catch (e) { updateError = e.message; }

const totalTime = Date.now() - t0;
const report = {
  buildMs,
  totalTime,
  parts: Object.keys(built.parts).length,
  meshes,
  triangles: Math.round(triangles),
  sprites,
  lines,
  points,
  uniqueMaterials: materials,
  textureRefs: textureCount,
  errors,
  updateError,
  partStats
};
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 2;
