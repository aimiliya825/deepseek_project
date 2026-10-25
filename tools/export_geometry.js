#!/usr/bin/env node
/* Export projected triangle soup from the procedural model for offline QA.
 * Usage: node tools/export_geometry.js [outfile]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, process.argv[2] || '.tmp/model-projected.json');

function grad() { return { addColorStop() {} }; }
function makeContext() {
  return new Proxy({
    createLinearGradient: grad, createRadialGradient: grad, createConicGradient: grad,
    measureText: (t) => ({ width: String(t).length * 6 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
  }, {
    get(o, k) { return k in o ? o[k] : (typeof k === 'string' ? function () {} : undefined); },
    set(o, k, v) { o[k] = v; return true; }
  });
}
function makeCanvas() {
  return { width: 1, height: 1, style: {}, getContext() { return makeContext(); }, toDataURL() { return ''; }, addEventListener() {}, removeEventListener() {} };
}
global.window = global;
global.document = {
  createElement: () => makeCanvas(),
  createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  getElementById: () => null,
  addEventListener() {}
};
global.devicePixelRatio = 1;
global.innerWidth = 1440;
global.innerHeight = 900;

require(path.join(ROOT, 'vendor', 'three.bundle.js'));
const THREE = global.THREE;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src', 'parts-data.js'), 'utf8'), { filename: 'parts-data.js' });
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src', 'model.js'), 'utf8'), { filename: 'model.js' });
const partsData = window.ACTION4_PARTS;
const dataById = new Map(partsData.map((p) => [p.id, p]));
const built = window.Action4Model.create(THREE);

const W = 1440, H = 900;
const TARGET = new THREE.Vector3(0, 0.02, 0);
const DIR = new THREE.Vector3(0.62, 0.34, 0.95).normalize();
const LIGHT = new THREE.Vector3(6.5, 9, 7.5).normalize();

function setExploded(on) {
  for (const [id, part] of Object.entries(built.parts)) {
    const e = dataById.get(id).explode;
    part.group.position.set(on ? e[0] : 0, on ? e[1] : 0, on ? e[2] : 0);
  }
  built.root.updateMatrixWorld(true);
}

function view(name, distance, exploded) {
  setExploded(exploded);
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 200);
  camera.position.copy(TARGET).addScaledVector(DIR, distance);
  camera.lookAt(TARGET);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const body = built.parts.body;
  const fadeSet = new Set((body && body.fadeMaterials) || []);
  const triangles = [];
  const annotations = [];
  const deps = {};

  built.root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    const pos = geo.attributes && geo.attributes.position;
    if (!pos) return;
    let index = geo.index ? geo.index.array : null;
    if (!index) {
      index = new Array(pos.count);
      for (let i = 0; i < pos.count; i++) index[i] = i;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mat = mats[0];
    if (!mat) return;
    const partId = mesh.userData.partId || findPartId(mesh);
    const part = built.parts[partId];
    const isScreen = partId === 'frontScreen' || partId === 'rearScreen';
    const isDecal = !!(mat.transparent && mat.opacity < 0.75);
    const isGlass = !!(mat.transparent && mat.opacity < 0.55);
    if (isGlass) return;
    if (isDecal) return;

    let base = mat.color ? mat.color.clone() : new THREE.Color(0x888888);
    if (isScreen) base = new THREE.Color(0x2ec4e8);
    else if (mat.map && mat.isMeshBasicMaterial) return; // decal without transparency flag
    let alpha = 255;
    if (fadeSet.has(mat) && exploded) { alpha = 55; base.multiplyScalar(0.35); }

    // world normal for shading
    let mw = mesh.matrixWorld.clone();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mw);
    const n = new THREE.Vector3();
    const v = new THREE.Vector3();
    const light = LIGHT;
    const key = 0.48;
    let shade = 0.85;

    for (let i = 0; i < index.length; i += 3) {
      const ia = index[i], ib = index[i + 1], ic = index[i + 2];
      const a = new THREE.Vector3().fromBufferAttribute(pos, ia).applyMatrix4(mw);
      const b = new THREE.Vector3().fromBufferAttribute(pos, ib).applyMatrix4(mw);
      const c = new THREE.Vector3().fromBufferAttribute(pos, ic).applyMatrix4(mw);
      // screen-space culling via camera space normal? do cull on projected winding
      const pa = a.clone().project(camera), pb = b.clone().project(camera), pc = c.clone().project(camera);
      if (pa.z > 1 || pb.z > 1 || pc.z > 1) continue;
      if (pa.z < -1 || pb.z < -1 || pc.z < -1) continue;
      const ax = (pa.x * 0.5 + 0.5) * W, ay = (-pa.y * 0.5 + 0.5) * H;
      const bx = (pb.x * 0.5 + 0.5) * W, by = (-pb.y * 0.5 + 0.5) * H;
      const cx = (pc.x * 0.5 + 0.5) * W, cy = (-pc.y * 0.5 + 0.5) * H;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (area > -0.01) continue; // keep front faces only (winding dependent)
      const tri = new THREE.Triangle(a, b, c);
      tri.getNormal(n);
      n.applyMatrix3(normalMatrix).normalize();
      v.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const toCam = camera.position.clone().sub(v).normalize();
      const facing = Math.abs(n.dot(toCam));
      // orient normal toward camera for two-sided objects
      if (n.dot(toCam) < 0) n.multiplyScalar(-1);
      const nl = Math.max(0, n.dot(light));
      const spec = Math.pow(Math.max(0, n.clone().add(toCam).normalize().dot(light)), 18) * 0.35;
      const up = Math.max(0, n.y) * 0.12;
      shade = 0.34 + 0.66 * nl + up + spec + facing * 0.06;
      const rgb = base.clone().multiplyScalar(Math.min(1.6, shade));
      const z = (pa.z + pb.z + pc.z) / 3;
      triangles.push([
        +ax.toFixed(1), +ay.toFixed(1), +z.toFixed(4),
        +bx.toFixed(1), +by.toFixed(1),
        +cx.toFixed(1), +cy.toFixed(1),
        Math.round(Math.min(255, rgb.r * 255)), Math.round(Math.min(255, rgb.g * 255)), Math.round(Math.min(255, rgb.b * 255)),
        alpha, isScreen ? 1 : 0
      ]);
    }
  });

  for (const data of partsData) {
    const part = built.parts[data.id];
    if (!part) continue;
    const anchorWorld = new THREE.Vector3();
    part.anchor.getWorldPosition(anchorWorld);
    const p = anchorWorld.project(camera);
    annotations.push({
      id: data.id, no: data.no, en: data.en, accent: data.accent,
      x: +((p.x * 0.5 + 0.5) * W).toFixed(1), y: +((-p.y * 0.5 + 0.5) * H).toFixed(1)
    });
  }

  triangles.sort((p, q) => q[2] - p[2]);
  console.log(name, 'triangles', triangles.length);
  return { name, width: W, height: H, distance, triangles, annotations };
}

function findPartId(mesh) {
  let p = mesh;
  while (p) {
    if (p.userData && p.userData.partId) return p.userData.partId;
    p = p.parent;
  }
  return null;
}

const views = [
  view('assembled', 19.25, false),
  view('exploded', 30.25, true),
  view('front', 19.25, false)
];
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ product: 'DJI Osmo Action 4', views }));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
