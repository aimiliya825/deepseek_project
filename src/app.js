/* ============================================================================
   DJI Osmo Action 4 — 3D teardown experience
   Scene, procedural environment, interaction, explosion choreography,
   projected component labels. Classic script; expects window.THREE.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.getElementById('app');
  var sceneHost = document.getElementById('scene');
  var labelLayer = document.getElementById('label-layer');
  var labelItems = document.getElementById('label-items');
  var leaderSvg = document.getElementById('leader-lines');
  var leaderDots = document.getElementById('leader-dots');
  var cursorTip = document.getElementById('cursor-tip');
  var bootScreen = document.getElementById('boot-screen');
  var bootBar = document.getElementById('boot-bar');
  var bootPercent = document.getElementById('boot-percent');
  var bootStatus = document.getElementById('boot-status');
  var webglError = document.getElementById('webgl-error');
  var toastStack = document.getElementById('toast-stack');

  var T = window.THREE;
  if (!T) {
    showFatal('Three.js 引擎未加载', 'vendor/three.bundle.js 缺失或加载失败。');
    return;
  }

  var PARTS = (window.ACTION4_PARTS || []).slice();
  var META = window.ACTION4_META || { headline: [], quickSpecs: [] };
  var PART_MAP = new Map();
  PARTS.forEach(function (p, i) { PART_MAP.set(p.id, p); p._index = i; });
  var DETACHABLE = PARTS.filter(function (p) { return !p.core; });

  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  var SMALL = window.innerWidth <= 900;
  var NS = 'http://www.w3.org/2000/svg';

  var state = {
    selectedId: null,
    hoveredId: null,
    autoRotate: !REDUCED,
    hasInteracted: false,
    busy: false,
    busyTimer: 0,
    allDetached: false,
    fatal: false,
    explodedCount: 0,
    booted: false,
    ready: false,
    guideOpen: true,
    camFlight: null,
    distTween: null,
    targetTween: null,
    labelMode: 'smart',
    pointerDown: null,
    pointer: { x: 0, y: 0, inside: false },
    hoverRayDirty: false,
    lastFrame: performance.now(),
    fps: 60,
    frameSamples: [],
    quality: 'high'
  };

  var renderer = null;
  var scene = null;
  var camera = null;
  var controls = null;
  var composer = null;
  var bloomPass = null;
  var model = null;
  var modelRoot = null;
  var stage = null;
  var reticle = null;
  var raycaster = null;
  var pickMeshes = [];
  var partRT = new Map();
  var labelRT = new Map();
  var homeView = null;
  var labelSafe = { left: 0, right: 0, measured: false };
  var viewFits = { homeDist: null, explodedDist: null, safeW: 0, safeH: 0 };
  var fitCornersAssembled = [];
  var fitCornersExploded = [];
  var ui = makeNoopUI();
  var dotTexture = null;
  var ringTexture = null;
  var envTexture = null;
  var clock = { elapsed: 0, last: 0 };
  var bootT0 = performance.now();
  var particleState = [];
  var stageObjects = {};
  var resizeTimer = 0;
  var guideTimer = 0;
  var autoRotateTimer = 0;
  var uiHoverLock = false;

  /* ------------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
  function damp(current, target, lambda, dt) { return lerp(current, target, 1 - Math.exp(-lambda * dt)); }
  function formatPct(p) { return String(Math.round(clamp(p, 0, 1) * 100)).padStart(2, '0') + ' %'; }
  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function nextFrame() { return new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); }); }
  function randRange(a, b) { return a + Math.random() * (b - a); }
  function nsEl(tag) { return document.createElementNS(NS, tag); }
  function isTypingTarget(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }
  function partData(id) { return PART_MAP.get(id) || null; }
  function accentFor(id) {
    var d = partData(id);
    return new T.Color(d ? d.accent : '#5fe8ff');
  }
  function noop() {}
  function makeNoopUI() {
    return {
      setSelected: noop, setHovered: noop, setPartDetached: noop, setAllDetached: noop,
      setAutoRotate: noop, setBusy: noop, setProgress: noop, setConnectionState: noop,
      toast: function (msg) { if (toastStack) { var n = document.createElement('div'); n.textContent = msg; toastStack.appendChild(n); setTimeout(function () { n.remove(); }, 2600); } },
      ready: noop, dismissGuide: noop
    };
  }

  function setBoot(progress, label) {
    if (bootBar) bootBar.style.width = Math.round(clamp(progress, 0, 100)) + '%';
    if (bootPercent) bootPercent.textContent = formatPct(progress / 100);
    if (bootStatus && label) bootStatus.textContent = label;
  }

  function hideBoot() {
    if (!bootScreen) return;
    bootScreen.classList.add('is-done');
    bootScreen.setAttribute('aria-hidden', 'true');
    state.booted = true;
    window.setTimeout(function () { if (bootScreen && bootScreen.parentNode) bootScreen.remove(); }, 1400);
  }

  function showFatal(title, message) {
    state.fatal = true;
    if (!webglError) return;
    webglError.hidden = false;
    if (bootScreen) bootScreen.classList.add('is-done');
    var h = webglError.querySelector('h2');
    var p = webglError.querySelector('p');
    if (h) h.textContent = title || '画面初始化失败';
    if (p) p.textContent = message || '请刷新页面重试。';
    console.error('[A4]', title, message);
  }

  function showToast(message, variant) {
    if (!message) return;
    if (ui && ui.__isAction4UI && typeof ui.toast === 'function') {
      var tones = { accent: 'cyan', success: 'cyan', muted: '', error: 'red' };
      ui.toast(message, tones[variant] || '');
      return;
    }
    if (!toastStack) return;
    var el = document.createElement('div');
    el.className = 'a4-float-toast' + (variant ? ' ' + variant : '');
    el.textContent = message;
    toastStack.appendChild(el);
    window.setTimeout(function () { el.classList.add('is-out'); }, 2200);
    window.setTimeout(function () { el.remove(); }, 2700);
    while (toastStack.children.length > 3) toastStack.removeChild(toastStack.firstChild);
  }

  /* ------------------------------------------------------------------------
     Renderer / scene / camera / composer
     --------------------------------------------------------------------- */
  function initRenderer() {
    var w = Math.max(1, window.innerWidth);
    var h = Math.max(1, window.innerHeight);
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.8);

    try {
      renderer = new T.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        preserveDrawingBuffer: false
      });
    } catch (err) {
      showFatal('WebGL 不可用', '无法创建 WebGL 上下文。请启用浏览器硬件加速后重试。');
      throw err;
    }

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h);
    renderer.setClearColor(0x03070d, 1);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    var canvas = renderer.domElement;
    canvas.setAttribute('aria-label', 'DJI Osmo Action 4 三维模型，拖拽旋转，滚轮缩放，点击部件查看拆解');
    canvas.tabIndex = 0;
    sceneHost.appendChild(canvas);

    scene = new T.Scene();
    scene.fog = new T.Fog(0x03070d, 22, 52);

    camera = new T.PerspectiveCamera(32, w / h, 0.1, 160);
    homeView = computeHomeView();
    camera.position.copy(homeView.pos);
    camera.lookAt(homeView.target);

    controls = new T.OrbitControls(camera, canvas);
    controls.target.copy(homeView.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.058;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.82;
    controls.panSpeed = 0.6;
    controls.minDistance = 7.5;
    controls.maxDistance = 34;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI * 0.9;
    controls.screenSpacePanning = true;
    controls.autoRotate = state.autoRotate;
    controls.autoRotateSpeed = 0.55;
    controls.enablePan = true;
    controls.zoomToCursor = true;
    if (T.MOUSE) {
      controls.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
    }
    if (T.TOUCH) {
      controls.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };
    }

    controls.addEventListener('start', onOrbitStart);
    controls.addEventListener('end', onOrbitEnd);

    raycaster = new T.Raycaster();

    var composerError = null;
    try {
      if (T.EffectComposer && T.RenderPass && T.UnrealBloomPass && T.OutputPass) {
        composer = new T.EffectComposer(renderer);
        composer.addPass(new T.RenderPass(scene, camera));
        bloomPass = new T.UnrealBloomPass(new T.Vector2(w, h), 0.52, 0.55, 0.72);
        composer.addPass(bloomPass);
        composer.addPass(new T.OutputPass());
        composer.setSize(w, h);
      }
    } catch (err) {
      composerError = err;
      composer = null;
      bloomPass = null;
      console.warn('[A4] Post FX unavailable, falling back to direct render.', err);
    }

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      showFatal('图形上下文已丢失', 'GPU 重置或驱动异常导致渲染中断，请重新载入页面。');
    }, false);

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });

    var dpr = renderer.getPixelRatio();
    state.quality = (dpr >= 1.5 || w * h > 2600000) ? 'ultra' : 'high';
    return composerError;
  }

  function computeHomeView() {
    var aspect = Math.max(0.3, window.innerWidth / Math.max(1, window.innerHeight));
    var fov = 32;
    var dist = 19.4;
    if (aspect < 0.82) { fov = 46; dist = 26.0; }
    else if (aspect < 1.12) { fov = 38; dist = 22.0; }
    else if (aspect < 1.42) { fov = 34; dist = 20.2; }
    else if (aspect > 2.15) { fov = 31; dist = 18.2; }
    if (viewFits.homeDist) dist = viewFits.homeDist;
    var target = new T.Vector3(0, 0.02, 0);
    var dir = new T.Vector3(0.62, 0.34, 0.95).normalize();
    return {
      fov: fov,
      target: target,
      pos: target.clone().addScaledVector(dir, dist),
      distance: dist
    };
  }

  function currentFitFov() {
    var aspect = Math.max(0.3, window.innerWidth / Math.max(1, window.innerHeight));
    if (aspect < 0.82) return 46;
    if (aspect < 1.12) return 38;
    if (aspect < 1.42) return 34;
    if (aspect > 2.15) return 31;
    return 32;
  }

  function buildFitCorners() {
    fitCornersAssembled = [];
    fitCornersExploded = [];
    partRT.forEach(function (rt) {
      if (!rt.bbox) return;
      for (var xi = 0; xi < 2; xi++) {
        for (var yi = 0; yi < 2; yi++) {
          for (var zi = 0; zi < 2; zi++) {
            var a = new T.Vector3(
              xi ? rt.bbox.max.x : rt.bbox.min.x,
              yi ? rt.bbox.max.y : rt.bbox.min.y,
              zi ? rt.bbox.max.z : rt.bbox.min.z
            );
            fitCornersAssembled.push(a.clone());
            fitCornersExploded.push(a.clone().add(rt.explode));
          }
        }
      }
    });
  }

  function fitCameraDistances() {
    if (!partRT.size) return;
    var w = Math.max(1, window.innerWidth);
    var h = Math.max(1, window.innerHeight);
    var fov = currentFitFov();
    var aspect = w / h;
    var target = new T.Vector3(0, 0.02, 0);
    var dir = new T.Vector3(0.62, 0.34, 0.95).normalize();
    var safeW = labelSafe.measured ? Math.max(300, labelSafe.right - labelSafe.left) : w * 0.52;
    var safeH = Math.max(260, h * 0.71);
    if (w <= 900) { safeW = w * 0.86; safeH = h * 0.53; }
    var cam = new T.PerspectiveCamera(fov, aspect, 0.1, 160);
    var p = new T.Vector3();

    function extents(points, distance) {
      cam.position.copy(target).addScaledVector(dir, distance);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (var i = 0; i < points.length; i++) {
        p.copy(points[i]).project(cam);
        var sx = (p.x * 0.5 + 0.5) * w;
        var sy = (-p.y * 0.5 + 0.5) * h;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
      return { w: maxX - minX, h: maxY - minY };
    }

    function findDistance(points, maxW, maxH) {
      var last = 30;
      for (var d = 11; d <= 38; d += 0.25) {
        var e = extents(points, d);
        last = d;
        if (e.w <= maxW && e.h <= maxH) return d;
      }
      return last;
    }

    if (!fitCornersAssembled.length) buildFitCorners();
    viewFits.safeW = safeW;
    viewFits.safeH = safeH;
    viewFits.homeDist = +findDistance(fitCornersAssembled, safeW * 0.94, safeH * 0.96).toFixed(2);
    viewFits.explodedDist = +findDistance(fitCornersExploded, safeW * 0.985, safeH * 1.02).toFixed(2);
    if (controls) {
      controls.maxDistance = Math.max(36, viewFits.explodedDist * 1.3, viewFits.homeDist * 1.9);
      controls.minDistance = Math.min(7.5, controls.maxDistance * 0.26);
    }
  }

  function applyHomeCamera(animate) {
    homeView = computeHomeView();
    if (!camera || !controls) return;
    if (animate) {
      flyCamera(homeView.pos, homeView.target, 1000);
      animateFov(homeView.fov, 800);
    } else {
      camera.fov = homeView.fov;
      camera.updateProjectionMatrix();
      camera.position.copy(homeView.pos);
      controls.target.copy(homeView.target);
      controls.update();
    }
  }

  function flyCamera(pos, target, duration) {
    if (!camera || !controls) return;
    state.camFlight = {
      start: performance.now(),
      duration: duration || 900,
      fromPos: camera.position.clone(),
      toPos: pos.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target.clone()
    };
    state.targetTween = null;
    state.distTween = null;
  }

  function animateFov(fov, duration) {
    if (!camera || Math.abs(camera.fov - fov) < 0.01) return;
    state.distTween = state.distTween || null;
    var startFov = camera.fov;
    var t0 = performance.now();
    var f = { startFov: startFov, toFov: fov, t0: t0, duration: duration || 700, fovOnly: true };
    state.fovTween = f;
  }

  function animateCameraDistance(factor, duration) {
    if (!camera || !controls) return;
    var target = controls.target.clone();
    var delta = camera.position.clone().sub(target);
    var fromDist = delta.length();
    var toDist = clamp(fromDist * factor, controls.minDistance, controls.maxDistance);
    var dir = delta.clone().normalize();
    flyCamera(target.clone().addScaledVector(dir, toDist), target, duration || 850);
  }

  function animateCameraDistanceTo(distance, duration) {
    if (!camera || !controls || !distance) return;
    var target = controls.target.clone();
    var delta = camera.position.clone().sub(target);
    var dir = delta.lengthSq() ? delta.clone().normalize() : new T.Vector3(0.62, 0.34, 0.95).normalize();
    var toDist = clamp(distance, controls.minDistance, Math.max(controls.maxDistance, distance + 1));
    flyCamera(target.clone().addScaledVector(dir, toDist), target, duration || 1000);
  }

  function frameWholeModel(distance, duration) {
    if (!camera || !controls || !distance) return;
    var target = new T.Vector3(0, 0.02, 0);
    var dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 0.0001) dir.set(0.62, 0.34, 0.95);
    dir.normalize();
    flyCamera(target.clone().addScaledVector(dir, clamp(distance, 8, 52)), target, duration || 1100);
  }

  /* ------------------------------------------------------------------------
     Procedural environment, lights, stage
     --------------------------------------------------------------------- */
  function initWorld() {
    scene.environment = makeEnvironmentTexture();
    if ('environmentIntensity' in scene) scene.environmentIntensity = 1.05;

    buildBackdrop();
    buildLights();
    buildStage();
    buildDust();

    dotTexture = makeRadialDotTexture(128, true);
    ringTexture = makeReticleTexture(256);

    controls.autoRotate = state.autoRotate;
  }

  function makeEnvironmentTexture() {
    var size = 256;
    var faces = [];
    var configs = [
      { bg0: '#081420', bg1: '#02060b', lights: [{ x: 0.72, y: 0.28, w: 0.12, h: 0.55, color: 'rgba(120,230,255,0.95)', blur: 48 }, { x: 0.18, y: 0.7, w: 0.28, h: 0.08, color: 'rgba(255,220,180,0.8)', blur: 30 }] },
      { bg0: '#06111a', bg1: '#01040a', lights: [{ x: 0.28, y: 0.2, w: 0.06, h: 0.5, color: 'rgba(255,170,80,0.8)', blur: 36 }, { x: 0.8, y: 0.76, w: 0.2, h: 0.06, color: 'rgba(150,240,255,0.8)', blur: 24 }] },
      { bg0: '#0a1a25', bg1: '#02060c', lights: [{ x: 0.5, y: 0.28, w: 0.7, h: 0.055, color: 'rgba(255,255,255,0.95)', blur: 26 }, { x: 0.15, y: 0.65, w: 0.08, h: 0.2, color: 'rgba(90,220,255,0.65)', blur: 40 }] },
      { bg0: '#02050a', bg1: '#010306', lights: [{ x: 0.45, y: 0.8, w: 0.35, h: 0.04, color: 'rgba(255,160,72,0.55)', blur: 20 }] },
      { bg0: '#091826', bg1: '#02050b', lights: [{ x: 0.5, y: 0.12, w: 0.85, h: 0.05, color: 'rgba(210,250,255,0.95)', blur: 28 }, { x: 0.78, y: 0.6, w: 0.1, h: 0.3, color: 'rgba(95,232,255,0.6)', blur: 50 }] },
      { bg0: '#04101a', bg1: '#010408', lights: [{ x: 0.25, y: 0.42, w: 0.05, h: 0.5, color: 'rgba(95,232,255,0.55)', blur: 44 }] }
    ];
    for (var i = 0; i < 6; i++) {
      var cfg = configs[i];
      var c = document.createElement('canvas');
      c.width = c.height = size;
      var ctx = c.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, size, size);
      g.addColorStop(0, cfg.bg0);
      g.addColorStop(0.55, cfg.bg1);
      g.addColorStop(1, '#010306');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      cfg.lights.forEach(function (l) {
        var x = l.x * size, y = l.y * size;
        var w = l.w * size, h = l.h * size;
        var lg = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
        lg.addColorStop(0, 'rgba(0,0,0,0)');
        lg.addColorStop(0.35, l.color);
        lg.addColorStop(0.65, l.color);
        lg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.filter = 'blur(' + (l.blur || 20) + 'px)';
        ctx.fillStyle = lg;
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
        ctx.restore();
      });
      var vign = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.75);
      vign.addColorStop(0, 'rgba(10,26,38,0.25)');
      vign.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = vign;
      ctx.fillRect(0, 0, size, size);
      faces.push(c);
    }
    var tex = new T.CubeTexture(faces);
    tex.colorSpace = T.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function buildBackdrop() {
    var geo = new T.SphereGeometry(65, 40, 24);
    var mat = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new T.Color(0x06131e) },
        uBottom: { value: new T.Color(0x010307) },
        uGlow: { value: new T.Color(0x1e7189) },
        uAmber: { value: new T.Color(0x5e3414) }
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main(){',
        '  vDir = normalize(position);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vDir;',
        'uniform vec3 uTop;',
        'uniform vec3 uBottom;',
        'uniform vec3 uGlow;',
        'uniform vec3 uAmber;',
        'void main(){',
        '  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);',
        '  vec3 col = mix(uBottom, uTop, pow(h, 1.2));',
        '  float horizon = pow(1.0 - abs(vDir.y), 7.0);',
        '  col += uGlow * horizon * 0.2;',
        '  float beam = pow(max(dot(vDir, normalize(vec3(-0.25, 0.18, 0.95))), 0.0), 14.0);',
        '  col += uGlow * beam * 0.25;',
        '  float warm = pow(max(dot(vDir, normalize(vec3(0.85, 0.15, 0.35))), 0.0), 22.0);',
        '  col += uAmber * warm * 0.35;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    var bg = new T.Mesh(geo, mat);
    bg.name = 'backdrop';
    bg.frustumCulled = false;
    scene.add(bg);

    // distant stars / micro particles
    var starCount = 420;
    var positions = new Float32Array(starCount * 3);
    var colors = new Float32Array(starCount * 3);
    var seed = mulberry32(1701);
    for (var i = 0; i < starCount; i++) {
      var r = 22 + seed() * 28;
      var theta = seed() * Math.PI * 2;
      var phi = Math.acos(2 * seed() - 1);
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r * 0.52 + 2.5;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r - 4;
      var warm = seed() > 0.86;
      colors[i * 3] = warm ? 0.9 : 0.35;
      colors[i * 3 + 1] = warm ? 0.65 : 0.72;
      colors[i * 3 + 2] = warm ? 0.32 : 0.9;
    }
    var sGeo = new T.BufferGeometry();
    sGeo.setAttribute('position', new T.BufferAttribute(positions, 3));
    sGeo.setAttribute('color', new T.BufferAttribute(colors, 3));
    var sMat = new T.PointsMaterial({
      size: 0.07,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      vertexColors: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      map: makeRadialDotTexture(64, true)
    });
    var stars = new T.Points(sGeo, sMat);
    stars.name = 'starfield';
    scene.add(stars);
    stageObjects.stars = stars;
  }

  function buildLights() {
    var hemi = new T.HemisphereLight(0x8ec9e2, 0x04070c, 1.15);
    hemi.name = 'hemi';
    scene.add(hemi);

    var key = new T.DirectionalLight(0xfff2df, 2.9);
    key.position.set(6.5, 9, 7.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -8;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.022;
    key.shadow.radius = 3;
    scene.add(key);
    scene.add(key.target);

    var fill = new T.DirectionalLight(0x68d7ff, 1.55);
    fill.position.set(-7.5, 2.4, 5.5);
    scene.add(fill);

    var rim = new T.DirectionalLight(0x7fbfff, 2.0);
    rim.position.set(-4.5, 4.5, -8.5);
    scene.add(rim);

    var warm = new T.PointLight(0xff9c44, 20, 18, 2);
    warm.position.set(-4.2, -1.8, 3.2);
    scene.add(warm);

    var cyan = new T.PointLight(0x31cfff, 14, 16, 2);
    cyan.position.set(5.8, 2.8, -2.8);
    scene.add(cyan);

    var under = new T.PointLight(0x2bb3d9, 12, 14, 2);
    under.position.set(0, -2.6, 2.2);
    scene.add(under);

    stageObjects.lights = { hemi: hemi, key: key, fill: fill, rim: rim, warm: warm, cyan: cyan, under: under };
  }

  function buildStage() {
    stage = new T.Group();
    stage.name = 'stage';
    scene.add(stage);
    stageObjects.rings = [];

    var floorMat = new T.MeshStandardMaterial({
      color: 0x03070c,
      metalness: 0.56,
      roughness: 0.52,
      envMapIntensity: 0.45
    });
    var floor = new T.Mesh(new T.PlaneGeometry(80, 80, 1, 1), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.34;
    floor.receiveShadow = true;
    floor.name = 'floor';
    stage.add(floor);
    stageObjects.floor = floor;
    stageObjects.floorMat = floorMat;

    var grid = new T.GridHelper(46, 46, 0x1b6072, 0x0a1e28);
    grid.position.y = -3.32;
    grid.material.transparent = true;
    grid.material.opacity = 0.34;
    grid.material.depthWrite = false;
    grid.material.fog = true;
    stage.add(grid);
    stageObjects.grid = grid;

    var glowTex = makeFloorGlowTexture(512);
    var glowMat = new T.MeshBasicMaterial({
      map: glowTex, transparent: true, opacity: 0.42, blending: T.AdditiveBlending,
      depthWrite: false, toneMapped: false, color: 0x2b8da6
    });
    var glow = new T.Mesh(new T.PlaneGeometry(21, 21), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -3.305;
    stage.add(glow);
    stageObjects.floorGlow = glow;

    function ring(inner, outer, opacity, color, y) {
      var m = new T.Mesh(
        new T.RingGeometry(inner, outer, 180),
        new T.MeshBasicMaterial({
          color: color, transparent: true, opacity: opacity, side: T.DoubleSide,
          blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = y || -3.3;
      stage.add(m);
      stageObjects.rings.push(m);
      return m;
    }
    ring(4.3, 4.328, 0.52, 0x59e6ff, -3.298);
    ring(5.25, 5.265, 0.2, 0x4ec9e6, -3.3);
    ring(7.4, 7.41, 0.1, 0x477d92, -3.3);

    // segmented calibration arcs on the floor
    var arcDefs = [
      { r: 6.1, start: 0.1, len: 0.58, color: 0x63ecff, opacity: 0.28, speed: 0.035 },
      { r: 6.1, start: 2.35, len: 0.22, color: 0xffb44a, opacity: 0.35, speed: 0.05 },
      { r: 3.65, start: 0.85, len: 0.2, color: 0x8be8ff, opacity: 0.22, speed: -0.04 },
      { r: 8.15, start: 3.5, len: 0.42, color: 0x5de8ff, opacity: 0.12, speed: 0.02 }
    ];
    stageObjects.arcs = [];
    arcDefs.forEach(function (a) {
      var m = new T.Mesh(
        new T.RingGeometry(a.r, a.r + 0.012, 160, 1, a.start, a.len),
        new T.MeshBasicMaterial({
          color: a.color, transparent: true, opacity: a.opacity, side: T.DoubleSide,
          blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = -3.296;
      stage.add(m);
      stageObjects.arcs.push({ mesh: m, speed: a.speed, base: a.start });
    });

    // overarching orbital rings give the scene a sci-fi lab feel
    var orbitGroup = new T.Group();
    orbitGroup.name = 'orbits';
    stage.add(orbitGroup);
    stageObjects.orbitGroup = orbitGroup;
    var torusMat = new T.MeshBasicMaterial({
      color: 0x53dff5, transparent: true, opacity: 0.09,
      blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    var torus = new T.Mesh(new T.TorusGeometry(6.9, 0.008, 6, 240), torusMat);
    torus.rotation.x = 1.06;
    torus.rotation.y = 0.18;
    orbitGroup.add(torus);
    var torus2 = new T.Mesh(new T.TorusGeometry(7.6, 0.006, 6, 240), new T.MeshBasicMaterial({
      color: 0xffb44a, transparent: true, opacity: 0.075,
      blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    torus2.rotation.x = 1.6;
    torus2.rotation.y = -0.28;
    orbitGroup.add(torus2);
    stageObjects.torus = torus;
    stageObjects.torus2 = torus2;

    // tiny traveling pulse on the inner floor ring
    var pulse = new T.Mesh(new T.SphereGeometry(0.035, 10, 10), new T.MeshBasicMaterial({ color: 0x9ef6ff, toneMapped: false }));
    pulse.position.set(4.31, -3.28, 0);
    stage.add(pulse);
    stageObjects.pulse = pulse;
  }

  function buildDust() {
    var count = SMALL ? 150 : 300;
    var positions = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var seed = mulberry32(90125);
    for (var i = 0; i < count; i++) {
      var radius = 2.4 + seed() * 9.5;
      var angle = seed() * Math.PI * 2;
      var y = -2.5 + seed() * 7.6;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      sizes[i] = 0.5 + seed();
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(positions, 3));
    var mat = new T.PointsMaterial({
      size: 0.045, sizeAttenuation: true, color: 0x73d5e9, transparent: true,
      opacity: 0.42, depthWrite: false, blending: T.AdditiveBlending,
      map: makeRadialDotTexture(64, true)
    });
    var dust = new T.Points(geo, mat);
    dust.name = 'dust';
    scene.add(dust);
    stageObjects.dust = dust;
    particleState = positions;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeRadialDotTexture(size, soft) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(soft ? 0.22 : 0.55, 'rgba(255,255,255,0.68)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    var tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  function makeFloorGlowTexture(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, size * 0.04, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.2, 'rgba(160,235,255,0.32)');
    g.addColorStop(0.55, 'rgba(40,130,160,0.09)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    var tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  function makeReticleTexture(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var cx = size / 2, cy = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.2;
    var segments = 4, gap = Math.PI * 2 / segments;
    for (var i = 0; i < segments; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.38, i * gap + 0.24, (i + 1) * gap - 0.24);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    for (var k = 0; k < 12; k++) {
      var a = k / 12 * Math.PI * 2;
      var r1 = size * 0.425, r2 = size * (k % 3 === 0 ? 0.462 : 0.445);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    var g = ctx.createRadialGradient(cx, cy, size * 0.15, cx, cy, size * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    var tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  /* ------------------------------------------------------------------------
     Model loading + fallback
     --------------------------------------------------------------------- */
  function initModel() {
    var built = null;
    try {
      if (window.Action4Model && typeof window.Action4Model.create === 'function') {
        built = window.Action4Model.create(T);
      }
    } catch (err) {
      console.error('[A4] Model build failed:', err);
    }
    if (!built || !built.root) {
      built = buildFallbackModel();
      console.warn('[A4] Using fallback model.');
    }
    model = built;
    modelRoot = built.root;
    modelRoot.name = 'action4';
    scene.add(modelRoot);

    var meshCount = 0;
    modelRoot.traverse(function (obj) {
      if (obj.isMesh) {
        meshCount++;
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(function (m) {
            if (m && (m.isMeshBasicMaterial || (m.transparent && m.opacity < 0.98))) obj.castShadow = false;
          });
        }
      }
    });

    buildRuntime();
    initReticle();
    window.__A4_DEBUG__ && (window.__A4_DEBUG__.model = built);
    console.info('[A4] model ready:', partsCount(), 'parts,', meshCount, 'meshes');
  }

  function partsCount() { return Object.keys((model && model.parts) || {}).length; }

  function buildRuntime() {
    pickMeshes = [];
    partRT.clear();
    var missing = [];
    PARTS.forEach(function (data) {
      var src = model && model.parts ? model.parts[data.id] : null;
      if (!src || !src.group) {
        missing.push(data.id);
        return;
      }
      var group = src.group;
      group.position.set(0, 0, 0);
      group.quaternion.identity();
      group.updateMatrixWorld(true);

      var box = new T.Box3().setFromObject(group);
      var center = box.isEmpty() ? new T.Vector3(0, 0, 0) : box.getCenter(new T.Vector3());
      var size = box.isEmpty() ? new T.Vector3(1, 1, 1) : box.getSize(new T.Vector3());
      var bbox = box.clone();
      var radius = Math.max(0.35, size.length() * 0.5);
      var anchor = src.anchor;
      if (!anchor || !anchor.isObject3D) {
        anchor = new T.Object3D();
        anchor.position.copy(center);
        group.add(anchor);
      }
      anchor.visible = false;

      var materials = (src.materials || []).filter(Boolean);
      if (!materials.length) {
        materials = [];
        group.traverse(function (o) {
          if (o.isMesh) {
            var list = Array.isArray(o.material) ? o.material : [o.material];
            list.forEach(function (m) { if (m && materials.indexOf(m) === -1) materials.push(m); });
          }
        });
      }
      materials.forEach(function (m) {
        if (m && m.emissive && m.emissive.isColor) {
          m.userData.__baseEmissive = m.emissiveIntensity || 0;
        }
      });
      var fadeMaterials = (src.fadeMaterials || []).filter(Boolean);
      fadeMaterials.forEach(function (m) {
        m.transparent = true;
        m.userData.__baseOpacity = m.opacity;
        m.userData.__baseDepthWrite = m.depthWrite;
      });

      var meshes = src.pickMeshes || [];
      if (!meshes.length) {
        group.traverse(function (o) { if (o.isMesh) meshes.push(o); });
      }
      meshes.forEach(function (obj) {
        obj.userData.partId = data.id;
        pickMeshes.push(obj);
      });

      var accent = accentFor(data.id);
      var halo = new T.Sprite(new T.SpriteMaterial({
        map: dotTexture || makeRadialDotTexture(128, true),
        color: accent.clone(),
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: T.AdditiveBlending,
        toneMapped: false
      }));
      halo.position.copy(center);
      halo.scale.set(Math.max(2, radius * 1.65), Math.max(2, radius * 1.65), 1);
      halo.raycast = function () {};
      halo.userData.__halo = true;
      group.add(halo);

      var rt = {
        id: data.id,
        data: data,
        src: src,
        group: group,
        anchor: anchor,
        center: center,
        bbox: bbox,
        radius: radius,
        materials: materials,
        fadeMaterials: fadeMaterials,
        meshes: meshes,
        accent: accent,
        explode: new T.Vector3(
          data.explode ? data.explode[0] : 0,
          data.explode ? data.explode[1] : 0,
          data.explode ? data.explode[2] : 0
        ),
        progress: 0,
        tween: null,
        glow: 0,
        detached: false,
        halo: halo,
        baseEmissive: materials.map(function (m) { return m.userData.__baseEmissive || 0; }),
        anchorWorld: new T.Vector3(),
        lastDetachedUI: false,
        lastVisibleUI: false
      };
      partRT.set(data.id, rt);
    });
    if (missing.length) console.warn('[A4] Model missing parts:', missing.join(', '));

    // fallback parts so the page never renders incomplete
    var allIds = new Set(Array.from(partRT.keys()));
    if (allIds.size < PARTS.length) {
      PARTS.forEach(function (data) {
        if (partRT.has(data.id)) return;
        var group = new T.Group();
        var mat = new T.MeshStandardMaterial({ color: 0x26313a, metalness: 0.4, roughness: 0.45, emissive: accentFor(data.id), emissiveIntensity: 0 });
        var mesh = new T.Mesh(new T.BoxGeometry(1.8, 1.2, 0.6), mat);
        group.add(mesh);
        var anchor = new T.Object3D();
        group.add(anchor);
        modelRoot.add(group);
        var box = new T.Box3().setFromObject(group);
        var center = box.getCenter(new T.Vector3());
        var size = box.getSize(new T.Vector3());
        var rt = {
          id: data.id, data: data, src: (model && model.parts && model.parts[data.id]) || null, group: group, anchor: anchor,
          center: center, bbox: box.clone(), radius: size.length() * 0.5 || 1.2, materials: [mat], fadeMaterials: [],
          meshes: [mesh], accent: accentFor(data.id),
          explode: new T.Vector3(data.explode[0], data.explode[1], data.explode[2]),
          progress: 0, tween: null, glow: 0, detached: false, halo: null,
          baseEmissive: [0], anchorWorld: new T.Vector3(), lastDetachedUI: false, lastVisibleUI: false
        };
        mesh.userData.partId = data.id;
        pickMeshes.push(mesh);
        partRT.set(data.id, rt);
      });
    }

    buildFitCorners();

    // selected-part reticle
    if (!reticle) {
      reticle = new T.Sprite(new T.SpriteMaterial({
        map: ringTexture,
        color: 0x9af2ff,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: T.AdditiveBlending,
        toneMapped: false
      }));
      reticle.name = 'selection-reticle';
      reticle.raycast = function () {};
      scene.add(reticle);
    }
  }

  function initReticle() {
    if (!reticle) return;
    reticle.visible = false;
  }

  function buildFallbackModel() {
    var groupRoot = new T.Group();
    var out = { root: groupRoot, parts: {}, update: function () {}, dispose: function () {} };
    var acc = function (id) { return accentFor(id); };
    var bodyMat = new T.MeshPhysicalMaterial({ color: 0x232a31, metalness: 0.55, roughness: 0.36, clearcoat: 0.25, clearcoatRoughness: 0.35 });
    var darkMat = new T.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0.35, roughness: 0.55 });
    var metalMat = new T.MeshStandardMaterial({ color: 0x737b84, metalness: 1, roughness: 0.25 });
    var screenMat = new T.MeshBasicMaterial({ color: 0x071a24, toneMapped: false });

    function part(id, build) {
      var g = new T.Group();
      var list = [];
      var mats = [];
      var anchorPos = PART_MAP.get(id) ? PART_MAP.get(id).anchor : [0, 0, 0];
      var anchor = new T.Object3D();
      anchor.position.fromArray(anchorPos);
      g.add(anchor);
      build(g, list, mats);
      list.forEach(function (m) { m.userData.partId = id; });
      groupRoot.add(g);
      out.parts[id] = { id: id, group: g, anchor: anchor, pickMeshes: list, materials: mats };
    }

    part('body', function (g, list, mats) {
      var shellShape = new T.Shape();
      var w = 3.7, h = 2.3, r = 0.38, x = -w, y = -h;
      shellShape.moveTo(x + r, y);
      shellShape.lineTo(x + w * 2 - r, y);
      shellShape.quadraticCurveTo(x + w * 2, y, x + w * 2, y + r);
      shellShape.lineTo(x + w * 2, y + h * 2 - r);
      shellShape.quadraticCurveTo(x + w * 2, y + h * 2, x + w * 2 - r, y + h * 2);
      shellShape.lineTo(x + r, y + h * 2);
      shellShape.quadraticCurveTo(x, y + h * 2, x, y + h * 2 - r);
      shellShape.lineTo(x, y + r);
      shellShape.quadraticCurveTo(x, y, x + r, y);
      var geo = new T.ExtrudeGeometry(shellShape, { depth: 3.0, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 3, curveSegments: 12 });
      geo.center();
      var sh = new T.Mesh(geo, bodyMat);
      g.add(sh); list.push(sh); mats.push(bodyMat);
    });
    part('lensCover', function (g, list, mats) {
      var m = new T.Mesh(new T.CylinderGeometry(1.3, 1.32, 0.3, 48), metalMat);
      m.rotation.x = Math.PI / 2; m.position.set(-1.7, 0.1, 1.7);
      g.add(m); list.push(m); mats.push(metalMat);
    });
    part('lens', function (g, list, mats) {
      var m = new T.Mesh(new T.CylinderGeometry(1.05, 1.12, 0.55, 48), darkMat);
      m.rotation.x = Math.PI / 2; m.position.set(-1.7, 0.1, 1.45);
      g.add(m); list.push(m); mats.push(darkMat);
    });
    part('sensor', function (g, list, mats) {
      var m = new T.Mesh(new T.BoxGeometry(1.5, 1.05, 0.1), new T.MeshStandardMaterial({ color: 0x123b2c, metalness: 0.5, roughness: 0.4, emissive: acc('sensor'), emissiveIntensity: 0 }));
      m.position.set(-0.2, 0.1, 1.0); g.add(m); list.push(m); mats.push(m.material);
    });
    part('frontScreen', function (g, list, mats) {
      var m = new T.Mesh(new T.PlaneGeometry(2.2, 1.3), screenMat);
      m.position.set(1.95, 0.15, 1.62); g.add(m); list.push(m); mats.push(screenMat);
    });
    part('rearScreen', function (g, list, mats) {
      var m = new T.Mesh(new T.PlaneGeometry(5.0, 2.8), screenMat);
      m.rotation.y = Math.PI; m.position.set(0, 0.1, -1.62); g.add(m); list.push(m); mats.push(screenMat);
    });
    part('mainboard', function (g, list, mats) {
      var m = new T.Mesh(new T.BoxGeometry(3.6, 2.35, 0.08), new T.MeshStandardMaterial({ color: 0x0e2417, metalness: 0.35, roughness: 0.62 }));
      m.position.set(0.2, 0.1, 0.3); g.add(m); list.push(m); mats.push(m.material);
    });
    part('battery', function (g, list, mats) {
      var m = new T.Mesh(new T.BoxGeometry(2.4, 3.4, 1.2), new T.MeshStandardMaterial({ color: 0x1c2025, metalness: 0.3, roughness: 0.62 }));
      m.position.set(1.1, -0.3, 0.15); g.add(m); list.push(m); mats.push(m.material);
    });
    part('thermal', function (g, list, mats) {
      var m = new T.Mesh(new T.BoxGeometry(2.5, 1.5, 0.35), new T.MeshStandardMaterial({ color: 0x8a4a2b, metalness: 0.8, roughness: 0.32 }));
      m.position.set(-1.4, 1.0, -0.6); g.add(m); list.push(m); mats.push(m.material);
    });
    part('topControls', function (g, list, mats) {
      var m = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, 0.22, 32), new T.MeshStandardMaterial({ color: 0x171a1e, metalness: 0.4, roughness: 0.4, emissive: 0x4d1616, emissiveIntensity: 0 }));
      m.position.set(-2.4, 2.42, 0.3); g.add(m); list.push(m); mats.push(m.material);
    });
    part('mount', function (g, list, mats) {
      var m = new T.Mesh(new T.BoxGeometry(3.4, 0.22, 2.2), new T.MeshStandardMaterial({ color: 0x1c232a, metalness: 0.6, roughness: 0.36 }));
      m.position.set(0, -2.42, 0.1); g.add(m); list.push(m); mats.push(m.material);
    });
    return out;
  }

  /* ------------------------------------------------------------------------
     Component labels
     --------------------------------------------------------------------- */
  function initLabels() {
    if (!labelItems || !leaderSvg) return;
    labelItems.innerHTML = '';
    leaderSvg.innerHTML = '';
    leaderDots.innerHTML = '';
    labelRT.clear();
    PARTS.forEach(function (data) {
      var rt = partRT.get(data.id);
      if (!rt) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'part-label';
      btn.style.setProperty('--label-accent', data.accent);
      btn.setAttribute('data-part', data.id);
      btn.setAttribute('aria-label', data.name + '，' + data.en + '，' + data.short);
      var inner = document.createElement('span');
      inner.className = 'l-inner';
      var idx = document.createElement('span');
      idx.className = 'l-index';
      idx.textContent = data.no;
      var copy = document.createElement('span');
      copy.className = 'l-copy';
      var name = document.createElement('span');
      name.className = 'l-name';
      name.textContent = data.name;
      var spec = document.createElement('span');
      spec.className = 'l-spec';
      spec.textContent = data.short || (data.specs[0] && data.specs[0].value) || '';
      copy.appendChild(name);
      copy.appendChild(spec);
      inner.appendChild(idx);
      inner.appendChild(copy);
      btn.appendChild(inner);
      btn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.hasInteracted = true;
        selectPart(data.id, { focus: false, reveal: true });
      });
      btn.addEventListener('mouseenter', function () { applyHover(data.id, true); });
      btn.addEventListener('mouseleave', function () { applyHover(null, true); });
      labelItems.appendChild(btn);

      var path = nsEl('path');
      path.setAttribute('stroke', data.accent);
      path.style.color = data.accent;
      leaderSvg.appendChild(path);

      var circle = nsEl('circle');
      circle.setAttribute('r', '2.2');
      circle.setAttribute('fill', data.accent);
      leaderSvg.appendChild(circle);

      var dot = document.createElement('div');
      dot.className = 'anchor-dot';
      dot.style.setProperty('--dot-accent', data.accent);
      leaderDots.appendChild(dot);

      labelRT.set(data.id, {
        btn: btn, path: path, circle: circle, dot: dot,
        width: 162, visible: false, side: 'right', x: 0, y: 0, anchorX: 0, anchorY: 0
      });
    });
    if (labelLayer) labelLayer.setAttribute('aria-hidden', 'false');
  }

  function getLabelVisibility(rt) {
    if (!rt) return false;
    if (!state.booted && !state.ready) return false;
    if (rt.id === state.selectedId) return true;
    if (rt.id === state.hoveredId && !COARSE) return true;
    if (rt.progress > 0.1) return true;
    if (rt.id === 'body' && state.explodedCount >= DETACHABLE.length) return true;
    return false;
  }

  function updateLabels(now) {
    if (!camera || !labelItems) return;
    var w = window.innerWidth;
    var h = window.innerHeight;
    var showMobileLimit = w <= 900;
    var visible = [];
    partRT.forEach(function (rt) {
      var label = labelRT.get(rt.id);
      if (!label) return;
      var show = getLabelVisibility(rt);
      if (!show) { setLabelVisible(rt, label, false); return; }
      rt.anchor.getWorldPosition(rt.anchorWorld);
      var camSpace = rt.anchorWorld.clone().applyMatrix4(camera.matrixWorldInverse);
      if (camSpace.z > -0.4) { setLabelVisible(rt, label, false); return; }
      var projected = rt.anchorWorld.clone().project(camera);
      var ax = (projected.x * 0.5 + 0.5) * w;
      var ay = (-projected.y * 0.5 + 0.5) * h;
      if (ax < -40 || ax > w + 40 || ay < -40 || ay > h + 40) { setLabelVisible(rt, label, false); return; }
      label.anchorX = ax; label.anchorY = ay;
      visible.push({ rt: rt, label: label, ax: ax, ay: ay });
    });

    if (showMobileLimit) {
      visible = visible.filter(function (v) { return v.rt.id === state.selectedId; });
    }

    var leftEdge = labelSafe.measured ? labelSafe.left : Math.max(24, w * 0.25);
    var rightEdge = labelSafe.measured ? labelSafe.right : w - Math.max(24, w * 0.25);
    leftEdge = clamp(leftEdge, 20, w * 0.42);
    rightEdge = clamp(rightEdge, w * 0.58, w - 20);
    if (rightEdge - leftEdge < 260) {
      leftEdge = Math.max(20, w * 0.22);
      rightEdge = w - Math.max(20, w * 0.22);
    }
    var labelWidth = Math.min(162, Math.max(116, w * 0.115));
    var topSafe = Math.max(112, h * 0.135);
    var bottomSafe = h - Math.max(116, h * 0.145);
    var gap = 45;

    var left = [], right = [];
    visible.forEach(function (v) {
      v.label.width = labelWidth;
      var side = v.ax < w * 0.5 ? 'left' : 'right';
      (side === 'left' ? left : right).push(v);
    });
    // balance crowded sides
    while (left.length - right.length > 1 && left.length > 2) {
      right.push(left.pop());
    }
    while (right.length - left.length > 1 && right.length > 2) {
      left.push(right.pop());
    }
    layoutColumn(left, leftEdge, leftEdge + labelWidth, topSafe, bottomSafe, gap, w);
    layoutColumn(right, rightEdge - labelWidth, rightEdge, topSafe, bottomSafe, gap, w);
    left.concat(right).forEach(function (v) {
      setLabelVisible(v.rt, v.label, true);
      var label = v.label;
      var tx = label.x;
      var ty = label.y;
      label.btn.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0)';
      label.btn.style.setProperty('--tx', tx.toFixed(1) + 'px');
      label.btn.style.setProperty('--ty', ty.toFixed(1) + 'px');
      label.btn.classList.toggle('is-active', v.rt.id === state.selectedId);
      label.btn.style.zIndex = v.rt.id === state.selectedId ? '3' : '1';

      var isLeft = label.side === 'left';
      var lx = isLeft ? tx + labelWidth : tx;
      var ly = ty + 20;
      var bendX = isLeft ? Math.min(v.ax - 22, lx + 18) : Math.max(v.ax + 22, lx - 18);
      var d = 'M ' + v.ax.toFixed(1) + ' ' + v.ay.toFixed(1) +
        ' L ' + bendX.toFixed(1) + ' ' + v.ay.toFixed(1) +
        ' L ' + bendX.toFixed(1) + ' ' + ly.toFixed(1) +
        ' L ' + lx.toFixed(1) + ' ' + ly.toFixed(1);
      label.path.setAttribute('d', d);
      label.path.classList.add('is-visible');
      label.path.classList.toggle('is-active', v.rt.id === state.selectedId);
      label.circle.setAttribute('cx', v.ax.toFixed(1));
      label.circle.setAttribute('cy', v.ay.toFixed(1));
      label.circle.classList.add('is-visible');
      label.dot.style.transform = 'translate3d(' + v.ax.toFixed(1) + 'px,' + v.ay.toFixed(1) + 'px,0)';
      label.dot.classList.add('is-visible');
      label.dot.classList.toggle('is-active', v.rt.id === state.selectedId);
    });
  }

  function layoutColumn(items, x, lineEnd, topSafe, bottomSafe, gap, width) {
    if (!items.length) return;
    items.forEach(function (v) { v.label.side = x < width * 0.5 ? 'left' : 'right'; });
    items.sort(function (a, b) { return a.ay - b.ay; });
    var desired = items.map(function (v) {
      return clamp(v.ay - 20, topSafe, bottomSafe - 40);
    });
    var heights = items.map(function (v) { return (v.rt.id === state.selectedId) ? 43 : 37; });
    var y = desired.slice();
    var cursor = topSafe;
    for (var i = 0; i < y.length; i++) {
      y[i] = Math.max(y[i], cursor);
      cursor = y[i] + Math.max(gap, heights[i] + 7);
    }
    var overflow = cursor - Math.max(gap, heights[heights.length - 1] + 7) - bottomSafe;
    if (overflow > 0) {
      for (var j = 0; j < y.length; j++) y[j] -= overflow;
      if (y[0] < topSafe) {
        var extra = topSafe - y[0];
        for (var k = 0; k < y.length; k++) y[k] += extra * ((k + 1) / y.length);
      }
    }
    items.forEach(function (v, i2) {
      v.label.x = x;
      v.label.y = y[i2];
    });
  }

  function setLabelVisible(rt, label, visible) {
    if (label.visible === visible) return;
    label.visible = visible;
    label.btn.classList.toggle('is-visible', visible);
    if (!visible) {
      label.path.classList.remove('is-visible', 'is-active');
      label.circle.classList.remove('is-visible');
      label.dot.classList.remove('is-visible', 'is-active');
    }
  }

  /* ------------------------------------------------------------------------
     Part state, animation & highlights
     --------------------------------------------------------------------- */
  function partProgress(id) { var rt = partRT.get(id); return rt ? rt.progress : 0; }
  function isDetached(id) { return partProgress(id) > 0.55; }
  function detachCount() {
    var n = 0;
    partRT.forEach(function (rt) { if (!rt.data.core && rt.progress > 0.55) n++; });
    return n;
  }

  function setPartTarget(id, target, opts) {
    var rt = partRT.get(id);
    if (!rt) return;
    opts = opts || {};
    var now = performance.now();
    var delayMs = opts.delay || 0;
    rt.tween = {
      start: now,
      delay: delayMs,
      duration: opts.duration || (target > rt.progress ? 620 : 480),
      from: rt.progress,
      to: target
    };
    rt.targetProgress = target;
    if (target > 0.02) stopAutoRotationOnce();
  }

  function explodeAll() {
    if (!model) return;
    state.hasInteracted = true;
    var order = ['rearScreen', 'frontScreen', 'topControls', 'mount', 'lensCover', 'lens', 'battery', 'thermal', 'sensor', 'mainboard'];
    var delay = 0;
    order.forEach(function (id) {
      var rt = partRT.get(id);
      if (!rt) return;
      if (rt.progress < 0.98) {
        setPartTarget(id, 1, { delay: delay, duration: 700 });
        delay += 52;
      }
    });
    // body is the datum, it stays put but becomes translucent
    state.pendingExplosion = true;
    ui.setBusy(true);
    showToast('开始拆解 · 核心组件逐层分离', 'accent');
    frameWholeModel(viewFits.explodedDist || 26, 1200);
  }

  function assembleAll() {
    if (!model) return;
    state.hasInteracted = true;
    var order = ['mainboard', 'sensor', 'thermal', 'battery', 'lens', 'lensCover', 'mount', 'topControls', 'frontScreen', 'rearScreen'];
    var delay = 0;
    order.forEach(function (id) {
      var rt = partRT.get(id);
      if (!rt) return;
      if (rt.progress > 0.02) {
        setPartTarget(id, 0, { delay: delay, duration: 520 });
        delay += 38;
      }
    });
    state.pendingExplosion = false;
    ui.setBusy(true);
    showToast('组件复位 · 结构锁定', 'accent');
    frameWholeModel(viewFits.homeDist || homeView.distance, 1000);
    if (state.selectedId) {
      var sel = partData(state.selectedId);
      if (sel && !sel.core) {
        // keep details open but reset the CTA state
      }
    }
  }

  function togglePart(id) {
    var rt = partRT.get(id);
    if (!rt) return;
    if (rt.data.core) {
      selectPart(id, { focus: false, reveal: true });
      if (state.allDetached) assembleAll();
      else explodeAll();
      return;
    }
    state.hasInteracted = true;
    selectPart(id, { focus: false, reveal: true });
    var opening = rt.progress <= 0.5;
    setPartTarget(id, opening ? 1 : 0, { duration: 620 });
    if (opening) focusCameraOnPart(id, 0.28);
    if (state.selectedId !== id) ui.setSelected(id, { detached: !opening });
  }

  function selectPart(id, opts) {
    opts = opts || {};
    if (!id || !partRT.has(id)) {
      clearSelection();
      return;
    }
    var changed = state.selectedId !== id;
    state.selectedId = id;
    if (changed) {
      state.hasInteracted = true;
      ui.setSelected(id, { detached: partProgress(id) > 0.5 });
      var data = partData(id);
      if (data) {
        if (opts.toast !== false && !opts.silent) showToast('已选中 · ' + data.no + '  ' + data.name, 'accent');
      }
    } else {
      ui.setSelected(id, { detached: partProgress(id) > 0.5 });
    }
    // selecting a hidden inner component should reveal it
    if (opts.reveal !== false) {
      var rt = partRT.get(id);
      if (rt && !rt.data.core && rt.progress < 0.08) {
        setPartTarget(id, 1, { duration: 600 });
        animateCameraDistance(1.035, 900);
      }
    }
    if (opts.focus) {
      focusCameraOnPart(id, 0.4);
    }
  }

  function clearSelection() {
    if (!state.selectedId) return;
    state.selectedId = null;
    ui.setSelected(null);
    if (state.hoveredId) applyHover(null, true);
    ui.setHovered(null);
  }

  function focusCameraOnPart(id, strength) {
    var rt = partRT.get(id);
    if (!rt || !controls) return;
    rt.anchor.getWorldPosition(rt.anchorWorld);
    var focusPoint = rt.anchorWorld.clone();
    if (rt.tween && rt.tween.to > rt.progress) {
      focusPoint.addScaledVector(rt.explode, rt.tween.to - rt.progress);
    }
    var amount = strength == null ? 0.35 : strength;
    var endTarget = new T.Vector3(0, 0.02, 0).lerp(focusPoint, amount);
    var fromTarget = controls.target.clone();
    var fromPos = camera.position.clone();
    var offset = fromPos.clone().sub(fromTarget);
    var toPos = endTarget.clone().add(offset);
    flyCamera(toPos, endTarget, 760);
  }

  function resetView() {
    state.camFlight = null;
    applyHomeCamera(true);
    if (state.selectedId) {
      // keep selection but reframe the whole assembly
    }
    showToast('视角已重置', 'muted');
  }

  function stopAutoRotationOnce() {
    if (state.autoRotate) {
      state.autoRotate = false;
      if (controls) controls.autoRotate = false;
      ui.setAutoRotate(false);
    }
  }

  function updatePartAnimation(now) {
    var anyBusy = false;
    var detached = 0;
    partRT.forEach(function (rt) {
      if (rt.tween) {
        var elapsed = now - rt.tween.start - rt.tween.delay;
        if (elapsed < 0) {
          anyBusy = true;
        } else {
          var t = clamp(elapsed / rt.tween.duration, 0, 1);
          rt.progress = lerp(rt.tween.from, rt.tween.to, easeInOutCubic(t));
          if (t >= 1) {
            rt.progress = rt.tween.to;
            rt.tween = null;
          } else {
            anyBusy = true;
          }
        }
      }
      // apply translation
      rt.group.position.copy(rt.explode).multiplyScalar(rt.progress);
      if (!rt.data.core) {
        if (rt.progress > 0.55) detached++;
      }
      var nowDetached = rt.progress > 0.5;
      if (nowDetached !== rt.detached) {
        rt.detached = nowDetached;
        ui.setPartDetached(rt.id, nowDetached);
        if (state.selectedId === rt.id) ui.setSelected(rt.id, { detached: nowDetached });
      }
    });

    if (detached !== state.explodedCount) {
      state.explodedCount = detached;
      ui.setProgress(detached, DETACHABLE.length);
      var all = detached >= DETACHABLE.length;
      state.allDetached = all;
    }
    var busyNow = anyBusy;
    if (busyNow !== state.busy) {
      state.busy = busyNow;
      ui.setBusy(busyNow);
    }
    if (!busyNow) {
      if (state.pendingExplosion && detached === DETACHABLE.length) {
        state.pendingExplosion = false;
        showToast('拆解完成 · 10 个核心模组', 'success');
      } else if (!state.pendingExplosion && detached === 0) {
        // assembled
      }
    }
    return anyBusy;
  }

  function updateHighlights(now, dt) {
    var time = now * 0.001;
    var selected = state.selectedId;
    var hovered = state.hoveredId;
    partRT.forEach(function (rt) {
      var isSel = rt.id === selected;
      var isHov = rt.id === hovered;
      var resting = rt.progress > 0.04 || isSel || isHov ? 0.18 : 0.025;
      var targetGlow = isSel ? 1.3 : isHov ? 0.72 : resting;
      rt.glow = damp(rt.glow, targetGlow, 9, dt);
      var pulse = isSel ? (0.85 + 0.15 * Math.sin(time * 3.2)) : 1;
      var base = 0;
      for (var i = 0; i < rt.materials.length; i++) {
        var mat = rt.materials[i];
        if (mat && mat.emissive && mat.emissive.isColor) {
          base = rt.baseEmissive[i] || 0;
          mat.emissiveIntensity = base + rt.glow * pulse * 1.1;
        }
      }
      if (rt.halo) {
        var targetHalo = isSel ? 0.36 : isHov ? 0.2 : (rt.progress > 0.05 ? 0.05 : 0);
        rt.halo.material.opacity = damp(rt.halo.material.opacity, targetHalo, 7, dt);
        var scalePulse = isSel ? 1 + Math.sin(time * 2.6) * 0.045 : 1;
        var baseScale = clamp(rt.radius * 1.45, 1.8, 4.8);
        rt.halo.scale.setScalar(baseScale * scalePulse);
        rt.halo.visible = rt.halo.material.opacity > 0.003;
      }
    });

    // selection reticle
    if (reticle) {
      if (selected && partRT.has(selected)) {
        var rt = partRT.get(selected);
        rt.anchor.getWorldPosition(rt.anchorWorld);
        reticle.position.copy(rt.anchorWorld);
        var s = clamp(rt.radius * 1.4 + 0.9, 1.7, 4.2);
        reticle.scale.setScalar(s * (1 + Math.sin(time * 1.7) * 0.015));
        reticle.material.color.copy(rt.accent);
        reticle.material.opacity = damp(reticle.material.opacity, 0.52, 7, dt);
        reticle.visible = true;
        reticle.material.rotation += dt * 0.08;
      } else {
        reticle.material.opacity = damp(reticle.material.opacity, 0, 9, dt);
        if (reticle.material.opacity < 0.01) reticle.visible = false;
      }
    }

    // body shell fades into a hologram while components are out
    var body = partRT.get('body');
    if (body && body.fadeMaterials.length) {
      var maxOut = 0;
      partRT.forEach(function (rt) {
        if (!rt.data.core) maxOut = Math.max(maxOut, rt.progress);
      });
      var targetOpacity = 1 - 0.78 * smoothstep(0.12, 0.9, maxOut);
      body.fadeMaterials.forEach(function (m) {
        var base = m.userData.__baseOpacity == null ? 1 : m.userData.__baseOpacity;
        var next = damp(m.opacity, base * targetOpacity, 4.5, dt);
        m.opacity = next;
        m.depthWrite = m.userData.__baseDepthWrite !== false && next > 0.72;
        m.transparent = true;
      });
    }
  }

  function updateCamera(now) {
    if (!camera || !controls) return;
    if (state.camFlight) {
      var f = state.camFlight;
      var t = clamp((now - f.start) / f.duration, 0, 1);
      var e = easeInOutCubic(t);
      camera.position.lerpVectors(f.fromPos, f.toPos, e);
      controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      if (t >= 1) {
        camera.position.copy(f.toPos);
        controls.target.copy(f.toTarget);
        state.camFlight = null;
        controls.update();
      }
    } else {
      controls.update();
    }
    if (state.fovTween) {
      var ft = state.fovTween;
      var tt = clamp((now - ft.t0) / ft.duration, 0, 1);
      camera.fov = lerp(ft.startFov, ft.toFov, easeInOutCubic(tt));
      camera.updateProjectionMatrix();
      if (tt >= 1) state.fovTween = null;
    }
  }

  function updateStage(now, dt) {
    var time = now * 0.001;
    var maxOut = 0;
    partRT.forEach(function (rt) {
      if (!rt.data.core) maxOut = Math.max(maxOut, rt.progress);
    });
    // only the two lower modules can travel under the stage plane
    var floorOut = 0;
    ['battery', 'mount'].forEach(function (id) {
      var rt = partRT.get(id);
      if (rt) floorOut = Math.max(floorOut, rt.progress);
    });
    if (controls) controls.autoRotate = state.autoRotate && !state.busy && !REDUCED;
    if (stageObjects.stars) stageObjects.stars.rotation.y = time * 0.0035;
    if (stageObjects.dust) {
      stageObjects.dust.rotation.y = time * 0.018;
      var pos = stageObjects.dust.geometry.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        var base = particleState[i * 3 + 1];
        pos.array[i * 3 + 1] = base + Math.sin(time * 0.35 + i * 1.7) * 0.16;
      }
      pos.needsUpdate = true;
    }
    if (stageObjects.torus) stageObjects.torus.rotation.z = time * 0.012;
    if (stageObjects.torus2) stageObjects.torus2.rotation.z = -time * 0.008;
    if (stageObjects.arcs) {
      stageObjects.arcs.forEach(function (a, i) {
        a.mesh.rotation.z = time * a.speed;
      });
    }
    if (stageObjects.pulse) {
      var ang = time * 0.28;
      stageObjects.pulse.position.set(Math.cos(ang) * 4.31, -3.28, Math.sin(ang) * 4.31);
      stageObjects.pulse.material.opacity = 0.55 + Math.sin(time * 2.4) * 0.2;
    }
    if (stageObjects.floorGlow) {
      stageObjects.floorGlow.material.opacity = (0.32 + Math.sin(time * 0.8) * 0.06) * (1 - 0.7 * smoothstep(0.15, 0.8, floorOut));
    }
    if (stageObjects.floorMat) {
      // dissolve the solid floor so the lower modules can travel below it
      var floorTarget = 1 - 0.97 * smoothstep(0.18, 0.78, floorOut);
      stageObjects.floorMat.transparent = true;
      stageObjects.floorMat.opacity = damp(stageObjects.floorMat.opacity, floorTarget, 4.5, dt);
      stageObjects.floorMat.depthWrite = stageObjects.floorMat.opacity > 0.75;
    }
    if (stageObjects.grid) {
      stageObjects.grid.material.opacity = 0.34 * (1 - 0.65 * smoothstep(0.15, 0.8, floorOut));
    }
    if (stageObjects.rings && stageObjects.rings[0]) {
      stageObjects.rings[0].material.opacity = 0.42 + Math.sin(time * 1.2) * 0.12;
    }
    if (model && typeof model.update === 'function') {
      try {
        model.update(dt, time, {
          exploded: state.explodedCount > 0,
          explodedCount: state.explodedCount,
          selectedId: state.selectedId,
          elapsed: time
        });
      } catch (e) { /* keep render loop alive */ }
    }
  }

  function updateHoverRayOnFrame() {
    if (!state.hoverRayDirty || !raycaster || !camera || !pickMeshes.length) return;
    state.hoverRayDirty = false;
    if (!state.pointer.inside || COARSE) return;
    var nx = (state.pointer.x / window.innerWidth) * 2 - 1;
    var ny = -(state.pointer.y / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(new T.Vector2(nx, ny), camera);
    var hits = raycaster.intersectObjects(pickMeshes, true);
    var hit = null;
    for (var i = 0; i < hits.length; i++) {
      var obj = hits[i].object;
      var pid = obj.userData.partId;
      if (!pid) {
        var p = obj.parent;
        while (p && !pid) { pid = p.userData && p.userData.partId; p = p.parent; }
      }
      if (pid) { hit = pid; break; }
    }
    if (hit !== state.hoveredId) applyHover(hit, false);
  }

  function applyHover(id, fromUI) {
    if (id && !partRT.has(id)) id = null;
    var prev = state.hoveredId;
    state.hoveredId = id;
    if (prev !== id) {
      // notify UI only when change came from the canvas, not from the UI itself
      if (!fromUI) ui.setHovered(id);
    }
    if (id) {
      var data = partData(id);
      if (cursorTip && !fromUI && !COARSE && state.pointer.inside) {
        cursorTip.innerHTML = '<span class="tip-dot"></span><span>' + escapeHtml(data ? data.name : '') + '</span><span class="tip-action">点击' +
          (isDetached(id) ? '复位' : '拆解') + '</span>';
        var x = state.pointer.x + 18;
        var y = state.pointer.y + 20;
        x = Math.min(x, window.innerWidth - cursorTip.offsetWidth - 12);
        y = Math.min(y, window.innerHeight - 44);
        cursorTip.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
        cursorTip.classList.add('is-visible');
        if (renderer) renderer.domElement.classList.add('is-hovering');
      }
    } else {
      if (cursorTip) cursorTip.classList.remove('is-visible');
      if (renderer) renderer.domElement.classList.remove('is-hovering');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------------------
     Pointer interaction
     --------------------------------------------------------------------- */
  function initInteractions() {
    var canvas = renderer.domElement;
    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
    canvas.addEventListener('pointerup', onPointerUp, { passive: true });
    canvas.addEventListener('pointercancel', onPointerCancel, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onFirstUserInteraction, { capture: true, passive: true });
    if (window.Action4UI && typeof window.Action4UI.create === 'function') {
      initUI();
    } else {
      console.warn('[A4] UI module missing.');
      initLabels();
    }
  }

  function onFirstUserInteraction(e) {
    if (state.hasInteracted) return;
    var t = e.target;
    if (t && t.closest && !t.closest('#scene, #ui-root, .part-label')) return;
    state.hasInteracted = true;
    if (state.autoRotate) {
      state.autoRotate = false;
      if (controls) controls.autoRotate = false;
      ui.setAutoRotate(false);
    }
    if (state.booted) ui.dismissGuide && ui.dismissGuide();
  }

  function onOrbitStart() {
    state.camFlight = null;
    state.hasInteracted = true;
    if (renderer) renderer.domElement.classList.add('is-grabbing');
    if (state.autoRotate) {
      state.autoRotate = false;
      controls.autoRotate = false;
      ui.setAutoRotate(false);
    }
    applyHover(null, false);
  }

  function onOrbitEnd() {
    if (renderer) renderer.domElement.classList.remove('is-grabbing');
  }

  function onPointerMove(e) {
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    state.pointer.inside = true;
    if (e.pointerType === 'touch') return;
    if (state.pointerDown && state.pointerDown.dragged) return;
    state.hoverRayDirty = true;
    if (state.hoveredId && cursorTip) {
      var x = Math.min(e.clientX + 18, window.innerWidth - cursorTip.offsetWidth - 12);
      var y = Math.min(e.clientY + 20, window.innerHeight - 44);
      cursorTip.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    }
  }

  function onPointerDown(e) {
    state.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now(), dragged: false, id: e.pointerId };
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    state.pointer.inside = true;
    if (state.camFlight) {
      state.camFlight = null;
    }
    applyHover(null, false);
    if (cursorTip) cursorTip.classList.remove('is-visible');
    if (renderer) renderer.domElement.classList.add('is-grabbing');
    state.hasInteracted = true;
    if (state.autoRotate) {
      state.autoRotate = false;
      if (controls) controls.autoRotate = false;
      ui.setAutoRotate(false);
    }
    if (guideTimer) { clearTimeout(guideTimer); guideTimer = 0; }
    if (ui.dismissGuide) ui.dismissGuide();
  }

  function onPointerUp(e) {
    if (renderer) renderer.domElement.classList.remove('is-grabbing');
    var down = state.pointerDown;
    state.pointerDown = null;
    if (!down) return;
    var dx = e.clientX - down.x;
    var dy = e.clientY - down.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var dt = performance.now() - down.t;
    if (dist < 7 && dt < 650) {
      handleCanvasClick(e.clientX, e.clientY);
    } else {
      state.hoverRayDirty = true;
    }
  }

  function onPointerCancel() {
    state.pointerDown = null;
    if (renderer) renderer.domElement.classList.remove('is-grabbing');
  }

  function onPointerLeave() {
    state.pointer.inside = false;
    state.pointerDown = null;
    applyHover(null, false);
    if (renderer) renderer.domElement.classList.remove('is-grabbing');
  }

  function handleCanvasClick(clientX, clientY) {
    if (!raycaster || !camera) return;
    var nx = (clientX / window.innerWidth) * 2 - 1;
    var ny = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(new T.Vector2(nx, ny), camera);
    var hits = raycaster.intersectObjects(pickMeshes, true);
    var id = null;
    for (var i = 0; i < hits.length; i++) {
      var obj = hits[i].object;
      var pid = obj.userData.partId;
      if (!pid) {
        var p = obj.parent;
        while (p && !pid) { pid = p.userData && p.userData.partId; p = p.parent; }
      }
      if (pid) { id = pid; break; }
    }
    if (!id) {
      clearSelection();
      return;
    }
    var rt = partRT.get(id);
    if (!rt) return;
    if (id === state.selectedId) {
      if (rt.data.core) {
        if (state.allDetached) assembleAll();
        else explodeAll();
        return;
      }
      setPartTarget(id, rt.progress > 0.5 ? 0 : 1, { duration: 600 });
      return;
    }
    selectPart(id, { reveal: true });
    if (!rt.data.core && rt.progress < 0.06) {
      setPartTarget(id, 1, { duration: 620 });
      focusCameraOnPart(id, 0.3);
    } else if (rt.data.core) {
      if (state.allDetached) assembleAll();
      else explodeAll();
    }
  }

  function onKeyDown(e) {
    if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      if (e.target && e.target.closest && e.target.closest('button, a, [role="button"]')) return;
      e.preventDefault();
      if (detachCount() > 0) assembleAll(); else explodeAll();
    } else if (e.key === 'Escape' || e.key === 'Esc') {
      clearSelection();
      applyHover(null, true);
      ui.setHovered(null);
    } else if (e.key === 'r' || e.key === 'R') {
      resetView();
    } else if (e.key === 'a' || e.key === 'A') {
      setAutoRotate(!state.autoRotate);
    }
  }

  function setAutoRotate(value) {
    state.autoRotate = !!value;
    if (controls) controls.autoRotate = state.autoRotate;
    ui.setAutoRotate(state.autoRotate);
    state.hasInteracted = true;
    if (autoRotateTimer) { clearTimeout(autoRotateTimer); autoRotateTimer = 0; }
  }

  function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        var p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        if (p && p.catch) p.catch(function () {});
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    } catch (err) { /* ignore */ }
  }

  function measureUISafeZone() {
    var w = window.innerWidth, h = window.innerHeight;
    var left = Math.max(24, w * 0.24);
    var right = w - Math.max(24, w * 0.24);
    var uiRoot = document.getElementById('ui-root');
    if (uiRoot && w > 900) {
      var nodes = uiRoot.querySelectorAll('*');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var r = el.getBoundingClientRect();
        if (r.width < 90 || r.height < 90) continue;
        if (r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) continue;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.05) continue;
        if (style.position !== 'fixed' && style.position !== 'absolute' && style.position !== 'sticky') continue;
        if (r.left + r.width / 2 < w * 0.5) {
          left = Math.max(left, r.right + 18);
        } else if (r.left > w * 0.5) {
          right = Math.min(right, r.left - 18);
        }
      }
    }
    labelSafe = {
      left: clamp(left, 20, w * 0.4),
      right: clamp(right, w * 0.6, w - 20),
      measured: true
    };
    if (partRT.size) {
      fitCameraDistances();
      if (!state.hasInteracted) {
        homeView = computeHomeView();
        if (camera && controls) {
          camera.position.copy(homeView.pos);
          camera.fov = homeView.fov;
          camera.updateProjectionMatrix();
          controls.target.copy(homeView.target);
        }
      }
    }
  }

  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      resizeTimer = 0;
      if (!renderer || !camera) return;
      var w = Math.max(1, window.innerWidth);
      var h = Math.max(1, window.innerHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
      if (bloomPass && bloomPass.setSize) bloomPass.setSize(w, h);
      if (leaderSvg) {
        leaderSvg.setAttribute('width', String(w));
        leaderSvg.setAttribute('height', String(h));
      }
      measureUISafeZone();
      // keep home view in sync if the user has not moved the camera
      if (!state.hasInteracted) applyHomeCamera(false);
      state.hoverRayDirty = true;
    }, 120);
  }

  /* ------------------------------------------------------------------------
     UI bridge
     --------------------------------------------------------------------- */
  function initUI() {
    try {
      ui = window.Action4UI.create({
        parts: PARTS,
        meta: META,
        callbacks: {
          onTogglePart: function (id) { togglePart(id); },
          onExplodeAll: function () { explodeAll(); },
          onAssembleAll: function () { assembleAll(); },
          onResetView: function () { resetView(); },
          onToggleAutoRotate: function (value) { setAutoRotate(value); },
          onFocusPart: function (id) { state.hasInteracted = true; selectPart(id, { focus: true, reveal: true }); },
          onHoverPart: function (id) {
            uiHoverLock = true;
            applyHover(id, true);
            uiHoverLock = false;
          },
          onFullscreen: toggleFullscreen
        }
      });
      ui.__isAction4UI = true;
    } catch (err) {
      console.error('[A4] UI init failed:', err);
      ui = makeNoopUI();
      showFatal('界面模块加载失败', String(err && err.message || err));
    }
    initLabels();
    window.setTimeout(measureUISafeZone, 60);
    window.setTimeout(measureUISafeZone, 900);
    ui.setAutoRotate(state.autoRotate);
    ui.setAllDetached(false);
    ui.setProgress(0, DETACHABLE.length);
    ui.setBusy(false);
    ui.setConnectionState && ui.setConnectionState('OPTICAL LINK · STABLE');
    if (leaderSvg) {
      leaderSvg.setAttribute('width', String(window.innerWidth));
      leaderSvg.setAttribute('height', String(window.innerHeight));
    }
    guideTimer = window.setTimeout(function () {
      if (ui.dismissGuide) ui.dismissGuide();
      state.guideOpen = false;
    }, 13000);
    autoRotateTimer = window.setTimeout(function () {
      if (!state.hasInteracted && state.autoRotate) {
        state.autoRotate = false;
        if (controls) controls.autoRotate = false;
        ui.setAutoRotate(false);
      }
    }, 16000);
  }

  /* ------------------------------------------------------------------------
     Main loop
     --------------------------------------------------------------------- */
  function startLoop() {
    state.lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    clock.elapsed += dt;
    if (document.hidden) return;

    updatePartAnimation(now);
    if (state.hoverRayDirty) updateHoverRayOnFrame();
    updateCamera(now);
    if (modelRoot) modelRoot.updateMatrixWorld(true);
    updateHighlights(now, dt);
    updateStage(now, dt);
    if (camera) camera.updateMatrixWorld();
    updateLabels(now);

    if (composer) {
      try {
        composer.render();
      } catch (err) {
        console.error('[A4] Composer render failed, falling back:', err);
        composer = null;
        renderer.render(scene, camera);
      }
    } else {
      renderer.render(scene, camera);
    }

    // rolling FPS for debug/verification
    state.frameSamples.push(dt);
    if (state.frameSamples.length > 30) state.frameSamples.shift();
    var sum = 0;
    for (var i = 0; i < state.frameSamples.length; i++) sum += state.frameSamples[i];
    state.fps = sum > 0 ? Math.round(state.frameSamples.length / sum) : 60;
  }

  /* ------------------------------------------------------------------------
     Boot sequence
     --------------------------------------------------------------------- */
  async function boot() {
    setBoot(4, 'INITIALIZING SPATIAL ENGINE');
    await delay(40);
    var composerError = null;
    try {
      setBoot(12, 'ALLOCATING RENDER CORE');
      initRenderer();
      await delay(100);
      setBoot(28, 'GENERATING OPTICAL ENVIRONMENT');
      initWorld();
      await delay(80);
      setBoot(46, 'ASSEMBLING ACTION 4 CHASSIS');
      await delay(30);
      initModel();
      await delay(80);
      setBoot(66, 'MAPPING COMPONENT TOPOLOGY');
      initInteractions();
      await delay(260);
      setBoot(82, 'CALIBRATING FIELD OF VIEW');
      measureUISafeZone();
      if (partRT.size) {
        fitCameraDistances();
        applyHomeCamera(false);
      }
      startLoop();
      await delay(140);
      setBoot(94, 'SYNCING HUD TELEMETRY');
      await delay(180);
      setBoot(100, 'SYSTEM READY');
      state.ready = true;
      window.__A4_READY__ = true;
      ui.ready();
      await delay(460);
      hideBoot();
      measureUISafeZone();
      if (composerError) console.warn(composerError);
    } catch (err) {
      console.error('[A4] Boot failed:', err);
      if (!state.fatal) showFatal('初始化失败', (err && err.message) ? err.message : '未知错误，请刷新页面重试。');
    }
  }

  /* ------------------------------------------------------------------------
     Debug bridge (used by verification tooling/screenshots)
     --------------------------------------------------------------------- */
  window.__A4_DEBUG__ = {
    version: '1.0',
    get state() {
      return {
        ready: state.ready,
        selectedId: state.selectedId,
        hoveredId: state.hoveredId,
        autoRotate: state.autoRotate,
        explodedCount: state.explodedCount,
        allDetached: state.allDetached,
        busy: state.busy,
        fps: state.fps,
        camera: camera ? camera.position.toArray().map(function (n) { return +n.toFixed(3); }) : null,
        target: controls ? controls.target.toArray().map(function (n) { return +n.toFixed(3); }) : null
      };
    },
    getStats: function () {
      var meshes = 0, triangles = 0;
      if (modelRoot) {
        modelRoot.traverse(function (o) {
          if (o.isMesh && o.geometry) {
            meshes++;
            var g = o.geometry;
            triangles += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
          }
        });
      }
      return {
        meshes: meshes,
        triangles: Math.round(triangles),
        parts: Array.from(partRT.keys()),
        labelsVisible: Array.from(labelRT.values()).filter(function (l) { return l.visible; }).length,
        renderer: renderer ? { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles } : null,
        composer: !!composer,
        fps: state.fps
      };
    },
    getProgress: function () {
      var out = {};
      partRT.forEach(function (rt) { out[rt.id] = +rt.progress.toFixed(3); });
      return out;
    },
    api: {
      selectPart: function (id) { selectPart(id, { reveal: true }); },
      clearSelection: clearSelection,
      togglePart: togglePart,
      explodeAll: explodeAll,
      assembleAll: assembleAll,
      resetView: resetView,
      setAutoRotate: setAutoRotate,
      focusPart: focusCameraOnPart,
      togglePartRaw: function (id, open) { setPartTarget(id, open ? 1 : 0, { duration: 500 }); },
      setCameraPreset: function (name) {
        if (!camera || !controls) return;
        var presets = {
          hero: [[10.2, 6.1, 13.5], [0, 0.02, 0]],
          front: [[0, 1.3, 16.5], [0, 0.1, 0]],
          top: [[4.5, 12.5, 8.5], [0, 0, 0]],
          low: [[8.8, -1.8, 13.2], [0, 0.2, 0]]
        };
        var p = presets[name];
        if (!p) return;
        flyCamera(new T.Vector3().fromArray(p[0]), new T.Vector3().fromArray(p[1]), 700);
      }
    },
    scene: function () { return { scene: scene, camera: camera, renderer: renderer, controls: controls, model: model }; }
  };

  window.addEventListener('unhandledrejection', function (e) {
    console.error('[A4] Unhandled rejection:', e.reason);
  });

  // safety net: a slow GPU must never trap the page behind the loader
  window.setTimeout(function () {
    if (!state.ready) {
      console.warn('[A4] Boot safety net triggered.');
      try {
        if (!renderer) initRenderer();
        if (scene && !scene.environment) initWorld();
        if (!model) initModel();
        if (!state.ready) { initInteractions(); startLoop(); }
        state.ready = true;
        window.__A4_READY__ = true;
        ui.ready();
        setBoot(100, 'SYSTEM READY');
        hideBoot();
      } catch (err) {
        console.error('[A4] Boot recovery failed:', err);
        if (!state.fatal) showFatal('初始化失败', String(err && err.message || err));
      }
    }
  }, 9000);

  // go
  boot();
})();
