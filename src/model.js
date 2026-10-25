/*!
 * DJI Osmo Action 4 鈥?procedural teardown model
 * ============================================================
 * Classic script (no modules / no network / no external assets).
 * Exposes ONLY:  window.Action4Model = { create(THREE) }
 *
 * create(THREE) -> {
 *   root, parts, update(dt, elapsed, state), dispose()
 * }
 *
 * Coordinate system: X = width, Y = height, Z = depth, lens faces +Z.
 * Chassis: 7.4 x 4.6 x 3.2 units, centered on the world origin.
 * Every part group is authored in its assembled place; the app adds the
 * explode translation from src/parts-data.js. All textures are procedural
 * CanvasTextures. Poly budget kept well under 300k triangles.
 */
(function () {
  'use strict';

  /* Fallback metadata (used only if parts-data.js failed to load).
     Mirrors window.ACTION4_PARTS: id / accent / anchor. */
  var FALLBACK_PARTS = [
    { id: 'body', accent: '#f6a63c', anchor: [1.2, -1.75, 0.9] },
    { id: 'lensCover', accent: '#63e6ff', anchor: [-1.75, 0.2, 2.32] },
    { id: 'lens', accent: '#4fdcff', anchor: [-1.75, 0.2, 1.95] },
    { id: 'sensor', accent: '#48ffc5', anchor: [-0.35, 0.15, 1.3] },
    { id: 'frontScreen', accent: '#ffb84d', anchor: [1.95, 0.2, 1.8] },
    { id: 'rearScreen', accent: '#ff9f43', anchor: [0, 0.15, -1.75] },
    { id: 'mainboard', accent: '#78ff9c', anchor: [0.4, -0.35, 0.0] },
    { id: 'battery', accent: '#ffbe2e', anchor: [2.7, -0.8, 0.2] },
    { id: 'thermal', accent: '#ff6b4a', anchor: [-2.0, 1.2, -0.4] },
    { id: 'topControls', accent: '#ff5c5c', anchor: [-2.2, 2.45, 0.25] },
    { id: 'mount', accent: '#7fe7ff', anchor: [0, -2.55, 0.1] }
  ];

  /* Refined anchors: nudged onto / just outside the real part surfaces.
     Keys are part ids; anything not listed keeps its parts-data anchor. */
  var ANCHOR_OVERRIDES = {
    body: [1.2, -1.75, 1.62],
    lensCover: [-1.8, 0.2, 2.03],
    lens: [-1.8, 0.2, 1.95],
    sensor: [-0.38, 0.72, 0.6],
    frontScreen: [1.93, 0.2, 1.79],
    rearScreen: [0, 0.15, -1.79],
    mainboard: [0.4, -0.35, -0.5],
    battery: [2.7, -0.8, 1.28]
  };

  function clampValue(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  /* Deterministic pseudo random (ES5 LCG, no Math.imul dependency). */
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  window.Action4Model = {
    create: function (THREE) {
      if (!THREE) {
        throw new Error('Action4Model.create(THREE) requires the THREE namespace.');
      }

      var PI = Math.PI;
      var geoms = [];       // all geometries for dispose()
      var textures = [];    // all canvas textures for dispose()
      var ledList = [];     // { mat, base, low, high, speed, phase }
      var screenList = [];  // { mat, phase }
      var overlayList = []; // { mat, base, phase }
      var disposed = false;

      /* ============================================================
         0. shared helpers
         ============================================================ */

      function trackGeo(g) {
        geoms.push(g);
        return g;
      }

      function makeCanvas(w, h) {
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      }

      function ctx2d(canvas) {
        return canvas.getContext('2d');
      }

      function canvasTexture(canvas, opts) {
        var o = opts || {};
        var t = new THREE.CanvasTexture(canvas);
        t.colorSpace = (o.srgb === false) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.anisotropy = 4;
        if (o.wrap) {
          t.wrapS = THREE.RepeatWrapping;
          t.wrapT = THREE.RepeatWrapping;
          if (o.repeat) {
            t.repeat.set(o.repeat[0], o.repeat[1]);
          }
        }
        t.needsUpdate = true;
        textures.push(t);
        return t;
      }

      function pathRoundRect(ctx, x, y, w, h, r) {
        var rr = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.arcTo(x + w, y, x + w, y + rr, rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        ctx.lineTo(x + rr, y + h);
        ctx.arcTo(x, y + h, x, y + h - rr, rr);
        ctx.lineTo(x, y + rr);
        ctx.arcTo(x, y, x + rr, y, rr);
        ctx.closePath();
      }

      function fillRoundRect(ctx, x, y, w, h, r, style) {
        pathRoundRect(ctx, x, y, w, h, r);
        ctx.fillStyle = style;
        ctx.fill();
      }

      function strokeRoundRect(ctx, x, y, w, h, r, style, lw) {
        pathRoundRect(ctx, x, y, w, h, r);
        ctx.strokeStyle = style;
        ctx.lineWidth = lw || 1;
        ctx.stroke();
      }

      /* Manually letter-spaced centred text (works without ctx.letterSpacing). */
      function drawSpacedText(ctx, text, cx, y, spacing) {
        var widths = [];
        var total = 0;
        var i;
        for (i = 0; i < text.length; i++) {
          var cw = ctx.measureText(text.charAt(i)).width;
          widths.push(cw);
          total += cw;
        }
        total += spacing * (text.length - 1);
        var x = cx - total * 0.5;
        var prevAlign = ctx.textAlign;
        ctx.textAlign = 'left';
        for (i = 0; i < text.length; i++) {
          ctx.fillText(text.charAt(i), x, y);
          x += widths[i] + spacing;
        }
        ctx.textAlign = prevAlign;
      }

      function drawBatteryIcon(ctx, x, y, w, h, level, color) {
        var lw = Math.max(1.5, h * 0.09);
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        pathRoundRect(ctx, x, y, w - h * 0.18, h, h * 0.22);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillRect(x + w - h * 0.14, y + h * 0.3, h * 0.14, h * 0.4);
        var innerX = x + lw * 2.1;
        var innerW = (w - h * 0.2) - lw * 4.2;
        var fillW = innerW * clampValue(level, 0, 1);
        if (fillW > 1) {
          ctx.fillRect(innerX, y + lw * 2, fillW, h - lw * 4);
        }
      }

      function drawSignalIcon(ctx, x, y, h, color) {
        ctx.fillStyle = color;
        var i;
        for (i = 0; i < 4; i++) {
          var bh = h * (0.3 + i * 0.22);
          ctx.fillRect(x + i * h * 0.26, y + h - bh, h * 0.16, bh);
        }
      }

      /* ============================================================
         1. geometry factories (auto-tracked for dispose)
         ============================================================ */

      function roundedRectShape(w, h, r) {
        var shape = new THREE.Shape();
        var x = -w * 0.5;
        var y = -h * 0.5;
        var rr = Math.max(0.0005, Math.min(r, Math.min(w, h) * 0.5 - 0.0005));
        shape.moveTo(x + rr, y);
        shape.lineTo(x + w - rr, y);
        shape.quadraticCurveTo(x + w, y, x + w, y + rr);
        shape.lineTo(x + w, y + h - rr);
        shape.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        shape.lineTo(x + rr, y + h);
        shape.quadraticCurveTo(x, y + h, x, y + h - rr);
        shape.lineTo(x, y + rr);
        shape.quadraticCurveTo(x, y, x + rr, y);
        return shape;
      }

      function roundedRectHolePath(w, h, r) {
        var path = new THREE.Path();
        var x = -w * 0.5;
        var y = -h * 0.5;
        var rr = Math.max(0.0005, Math.min(r, Math.min(w, h) * 0.5 - 0.0005));
        path.moveTo(x + rr, y);
        path.lineTo(x + w - rr, y);
        path.quadraticCurveTo(x + w, y, x + w, y + rr);
        path.lineTo(x + w, y + h - rr);
        path.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        path.lineTo(x + rr, y + h);
        path.quadraticCurveTo(x, y + h, x, y + h - rr);
        path.lineTo(x, y + rr);
        path.quadraticCurveTo(x, y, x + rr, y);
        path.closePath();
        return path;
      }

      /* Rounded box, exact outer dimensions (w,h,d), centred at origin.
         ExtrudeGeometry inflates the shape by bevelSize and depth by
         bevelThickness, so compensate here. */
      function rbox(w, h, d, r, bev, bevelSegs, curveSegs) {
        if (bev === undefined || bev === null) {
          bev = Math.min(0.06, d * 0.3, w * 0.02, h * 0.02);
        }
        bev = clampValue(bev, 0.0015, Math.min(d * 0.45, w * 0.3, h * 0.3));
        var bs = bev;
        var bt = bev;
        var depth = Math.max(0.002, d - 2 * bt);
        var radius = Math.max(0.0008, Math.min(r, Math.min(w, h) * 0.5 - 0.002) - bs);
        var shape = roundedRectShape(Math.max(0.004, w - 2 * bs), Math.max(0.004, h - 2 * bs), radius);
        var geo = new THREE.ExtrudeGeometry(shape, {
          depth: depth,
          bevelEnabled: true,
          bevelThickness: bt,
          bevelSize: bs,
          bevelSegments: bevelSegs || 3,
          curveSegments: curveSegs || 8,
          steps: 1
        });
        geo.translate(0, 0, -(d * 0.5 - bt));
        return trackGeo(geo);
      }

      /* Rectangular ring (bezel windows). Outer size (w,h), depth d. */
      function frame(w, h, d, thickness, r, bev) {
        bev = bev || 0.02;
        bev = clampValue(bev, 0.0015, Math.min(d * 0.45, thickness * 0.45));
        var bs = bev;
        var bt = bev;
        var outer = roundedRectShape(
          Math.max(0.01, w - 2 * bs),
          Math.max(0.01, h - 2 * bs),
          Math.max(0.001, r - bs)
        );
        var hole = roundedRectHolePath(
          Math.max(0.006, w - 2 * thickness - 2 * bs),
          Math.max(0.006, h - 2 * thickness - 2 * bs),
          Math.max(0.001, r - thickness - bs)
        );
        outer.holes.push(hole);
        var geo = new THREE.ExtrudeGeometry(outer, {
          depth: Math.max(0.002, d - 2 * bt),
          bevelEnabled: true,
          bevelThickness: bt,
          bevelSize: bs,
          bevelSegments: 2,
          curveSegments: 10,
          steps: 1
        });
        geo.translate(0, 0, -(d * 0.5 - bt));
        return trackGeo(geo);
      }

      function boxGeo(w, h, d) {
        return trackGeo(new THREE.BoxGeometry(w, h, d));
      }

      function planeGeo(w, h) {
        return trackGeo(new THREE.PlaneGeometry(w, h));
      }

      /* Cylinder whose axis is +Z. */
      function cylZ(rTop, rBot, h, seg, openEnded) {
        var g = new THREE.CylinderGeometry(rTop, rBot, h, seg || 48, 1, !!openEnded);
        g.rotateX(PI * 0.5);
        return trackGeo(g);
      }

      function ringGeo(inner, outer, seg) {
        return trackGeo(new THREE.RingGeometry(inner, outer, seg || 64, 1));
      }

      /* Cylinder whose axis is +Y. */
      function cylY(rTop, rBot, h, seg, openEnded) {
        return trackGeo(new THREE.CylinderGeometry(rTop, rBot, h, seg || 48, 1, !!openEnded));
      }

      /* Torus in the XY plane (axis +Z). */
      function torusZ(radius, tube, radSeg, tubSeg) {
        return trackGeo(new THREE.TorusGeometry(radius, tube, radSeg || 8, tubSeg || 64));
      }

      /* Torus lying flat (axis +Y). */
      function torusY(radius, tube, radSeg, tubSeg) {
        var g = new THREE.TorusGeometry(radius, tube, radSeg || 8, tubSeg || 48);
        g.rotateX(PI * 0.5);
        return trackGeo(g);
      }

      /* Spherical cap opening towards +Z (for lens elements). */
      function capZ(radius, thetaLength, widthSeg, heightSeg) {
        var g = new THREE.SphereGeometry(radius, widthSeg || 24, heightSeg || 8, 0, PI * 2, 0, thetaLength || PI * 0.4);
        g.rotateX(PI * 0.5);
        return trackGeo(g);
      }

      function sphereGeo(radius, wSeg, hSeg) {
        return trackGeo(new THREE.SphereGeometry(radius, wSeg || 12, hSeg || 8));
      }

      /* Lathe around +Z. points: [[radius, z], ...] from centre/edge. */
      function latheZ(points, segments) {
        var pts = [];
        var i;
        for (i = 0; i < points.length; i++) {
          pts.push(new THREE.Vector2(Math.max(0.0001, points[i][0]), points[i][1]));
        }
        var g = new THREE.LatheGeometry(pts, segments || 64);
        g.rotateX(PI * 0.5);
        return trackGeo(g);
      }

      function tubeGeo(points, radius, tubularSeg, radialSeg) {
        var pts = [];
        var i;
        for (i = 0; i < points.length; i++) {
          pts.push(new THREE.Vector3(points[i][0], points[i][1], points[i][2]));
        }
        var curve = new THREE.CatmullRomCurve3(pts);
        return trackGeo(new THREE.TubeGeometry(curve, tubularSeg || 24, radius, radialSeg || 8, false));
      }

      /* ============================================================
         2. procedural textures
         ============================================================ */

      function drawDjiWordmark() {
        var W = 512;
        var H = 160;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = 'rgba(238,244,250,0.96)';
        x.font = '700 132px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
        x.fillText('DJI', W * 0.5, H * 0.54);
        return canvasTexture(c);
      }

      function drawAction4() {
        var W = 512;
        var H = 128;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = 'rgba(226,235,242,0.92)';
        x.font = '600 58px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
        drawSpacedText(x, 'ACTION 4', W * 0.5, H * 0.55, 14);
        return canvasTexture(c);
      }

      function textTexture(text, capHeight, color, weight) {
        var fs = Math.round(capHeight * 1.45);
        var W = Math.max(128, Math.round(text.length * fs * 0.62 + fs * 0.8));
        var H = Math.round(fs * 1.7);
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = color || 'rgba(236,244,250,0.92)';
        x.font = (weight || '600') + ' ' + Math.round(fs) + 'px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
        x.fillText(text, W * 0.5, H * 0.54);
        return canvasTexture(c);
      }

      function drawFrontScreenUI() {
        var W = 640;
        var H = 360;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        var i;
        var g = x.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#051319');
        g.addColorStop(0.5, '#0a2530');
        g.addColorStop(1, '#031014');
        x.fillStyle = g;
        x.fillRect(0, 0, W, H);

        var rg = x.createRadialGradient(W * 0.52, H * 0.46, 10, W * 0.52, H * 0.46, 360);
        rg.addColorStop(0, 'rgba(95,232,255,0.22)');
        rg.addColorStop(0.5, 'rgba(30,110,140,0.08)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = rg;
        x.fillRect(0, 0, W, H);

        /* thirds grid */
        x.strokeStyle = 'rgba(140,235,255,0.16)';
        x.lineWidth = 1;
        x.beginPath();
        x.moveTo(W / 3, 52); x.lineTo(W / 3, H - 58);
        x.moveTo(2 * W / 3, 52); x.lineTo(2 * W / 3, H - 58);
        x.moveTo(18, H / 3); x.lineTo(W - 18, H / 3);
        x.moveTo(18, 2 * H / 3); x.lineTo(W - 18, 2 * H / 3);
        x.stroke();

        /* centre framing corners */
        x.strokeStyle = 'rgba(175,245,255,0.62)';
        x.lineWidth = 2.4;
        var cw = 42;
        var mx = W * 0.5;
        var my = H * 0.46;
        x.beginPath();
        x.moveTo(mx - cw, my - 24); x.lineTo(mx - cw, my - cw); x.lineTo(mx - 24, my - cw);
        x.moveTo(mx + 24, my - cw); x.lineTo(mx + cw, my - cw); x.lineTo(mx + cw, my - 24);
        x.moveTo(mx - cw, my + 24); x.lineTo(mx - cw, my + cw); x.lineTo(mx - 24, my + cw);
        x.moveTo(mx + 24, my + cw); x.lineTo(mx + cw, my + cw); x.lineTo(mx + cw, my + 24);
        x.stroke();

        /* large mode readout */
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = 'rgba(235,252,255,0.97)';
        x.font = '700 68px "Segoe UI", Arial, sans-serif';
        drawSpacedText(x, '4K', mx, my + 4, 8);
        x.fillStyle = '#5fe8ff';
        x.font = '700 24px "Segoe UI", Arial, sans-serif';
        drawSpacedText(x, '120 FPS', mx, my + 56, 4);

        /* top status bar */
        x.fillStyle = 'rgba(2,9,13,0.74)';
        x.fillRect(0, 0, W, 50);
        x.fillStyle = '#ff5b52';
        x.beginPath();
        x.arc(28, 25, 8, 0, PI * 2);
        x.fill();
        x.fillStyle = '#eaf8fc';
        x.font = '600 22px "Segoe UI", Arial, sans-serif';
        x.textAlign = 'left';
        x.fillText('REC', 46, 26);
        x.fillStyle = '#9fd8e8';
        x.font = '500 19px Consolas, "Courier New", monospace';
        x.fillText('00:12:04', 102, 26);
        drawBatteryIcon(x, W - 106, 12, 72, 25, 0.78, '#5fe8ff');
        x.fillStyle = '#dff8ff';
        x.font = '600 18px "Segoe UI", Arial, sans-serif';
        x.textAlign = 'right';
        x.fillText('78%', W - 114, 26);

        /* bottom info bar */
        x.fillStyle = 'rgba(2,9,13,0.74)';
        x.fillRect(0, H - 54, W, 54);
        x.fillStyle = '#c4ecf6';
        x.font = '500 19px Consolas, "Courier New", monospace';
        x.textAlign = 'center';
        x.fillText('F2.8   1/240   ISO 100   AUTO', W * 0.5, H - 27);

        /* side tags */
        x.textAlign = 'left';
        x.fillStyle = '#5fe8ff';
        x.font = '600 15px "Segoe UI", Arial, sans-serif';
        x.fillText('D-LOG M', 18, 70);
        x.textAlign = 'right';
        x.fillText('155\u00b0', W - 18, 70);
        x.fillStyle = 'rgba(170,225,240,0.55)';
        x.font = '600 13px "Segoe UI", Arial, sans-serif';
        x.textAlign = 'left';
        x.fillText('DJI OSMO ACTION 4', 18, H - 70);

        /* faint scan lines */
        for (i = 54; i < H - 56; i += 4) {
          x.fillStyle = 'rgba(255,255,255,0.012)';
          x.fillRect(0, i, W, 1);
        }
        return canvasTexture(c);
      }

      function drawRearScreenUI() {
        var W = 1024;
        var H = 620;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        var i;

        /* ---- preview: sunset seascape drawn with gradients ---- */
        var sky = x.createLinearGradient(0, 0, 0, H * 0.7);
        sky.addColorStop(0, '#081a2a');
        sky.addColorStop(0.32, '#1d3f55');
        sky.addColorStop(0.6, '#7a5f68');
        sky.addColorStop(0.8, '#e08a4f');
        sky.addColorStop(1, '#f7c07c');
        x.fillStyle = sky;
        x.fillRect(0, 0, W, H * 0.7);

        var sunX = W * 0.66;
        var sunY = H * 0.47;
        var sunGlow = x.createRadialGradient(sunX, sunY, 6, sunX, sunY, 190);
        sunGlow.addColorStop(0, 'rgba(255,250,230,1)');
        sunGlow.addColorStop(0.1, 'rgba(255,232,180,0.95)');
        sunGlow.addColorStop(0.45, 'rgba(255,175,95,0.35)');
        sunGlow.addColorStop(1, 'rgba(255,150,70,0)');
        x.fillStyle = sunGlow;
        x.beginPath();
        x.arc(sunX, sunY, 190, 0, PI * 2);
        x.fill();
        x.fillStyle = '#fff6df';
        x.beginPath();
        x.arc(sunX, sunY, 34, 0, PI * 2);
        x.fill();

        /* far ridge */
        x.fillStyle = '#1a3541';
        x.beginPath();
        x.moveTo(0, H * 0.7);
        x.lineTo(0, H * 0.56);
        x.lineTo(120, H * 0.45);
        x.lineTo(250, H * 0.53);
        x.lineTo(400, H * 0.4);
        x.lineTo(540, H * 0.5);
        x.lineTo(700, H * 0.44);
        x.lineTo(860, H * 0.52);
        x.lineTo(W, H * 0.47);
        x.lineTo(W, H * 0.7);
        x.closePath();
        x.fill();

        /* near ridge */
        x.fillStyle = '#0c212a';
        x.beginPath();
        x.moveTo(0, H * 0.7);
        x.lineTo(0, H * 0.62);
        x.lineTo(160, H * 0.56);
        x.lineTo(300, H * 0.62);
        x.lineTo(470, H * 0.55);
        x.lineTo(640, H * 0.63);
        x.lineTo(820, H * 0.57);
        x.lineTo(W, H * 0.62);
        x.lineTo(W, H * 0.7);
        x.closePath();
        x.fill();

        /* water */
        var water = x.createLinearGradient(0, H * 0.7, 0, H);
        water.addColorStop(0, '#2a525f');
        water.addColorStop(0.45, '#123240');
        water.addColorStop(1, '#071a22');
        x.fillStyle = water;
        x.fillRect(0, H * 0.7, W, H * 0.3);
        for (i = 0; i < 26; i++) {
          var wy = H * 0.715 + i * (H * 0.011);
          x.fillStyle = 'rgba(255,196,130,' + (0.34 * (1 - i / 26)).toFixed(3) + ')';
          var rngW = makeRng(3000 + i * 37);
          var segs = 3 + Math.floor(rngW() * 3);
          var j;
          for (j = 0; j < segs; j++) {
            var sx = sunX - 120 + rngW() * 240;
            x.fillRect(sx, wy, 12 + rngW() * 40, 2);
          }
        }

        /* rule of thirds grid */
        x.strokeStyle = 'rgba(255,255,255,0.14)';
        x.lineWidth = 1.4;
        x.beginPath();
        x.moveTo(W / 3, 70); x.lineTo(W / 3, H - 112);
        x.moveTo(2 * W / 3, 70); x.lineTo(2 * W / 3, H - 112);
        x.moveTo(26, H / 3); x.lineTo(W - 26, H / 3);
        x.moveTo(26, 2 * H / 3); x.lineTo(W - 26, 2 * H / 3);
        x.stroke();

        /* viewfinder brackets */
        x.strokeStyle = 'rgba(240,250,255,0.8)';
        x.lineWidth = 3;
        var b = 46;
        var m = 32;
        x.beginPath();
        x.moveTo(m, m + b); x.lineTo(m, m); x.lineTo(m + b, m);
        x.moveTo(W - m - b, m); x.lineTo(W - m, m); x.lineTo(W - m, m + b);
        x.moveTo(m, H - 110 - b); x.lineTo(m, H - 110); x.lineTo(m + b, H - 110);
        x.moveTo(W - m - b, H - 110); x.lineTo(W - m, H - 110); x.lineTo(W - m, H - 110 - b);
        x.stroke();

        /* top status bar */
        x.fillStyle = 'rgba(2,10,15,0.68)';
        x.fillRect(0, 0, W, 66);
        x.fillStyle = '#ff5b52';
        x.beginPath();
        x.arc(34, 33, 9, 0, PI * 2);
        x.fill();
        x.textAlign = 'left';
        x.textBaseline = 'middle';
        x.fillStyle = '#eefaff';
        x.font = '600 26px "Segoe UI", Arial, sans-serif';
        x.fillText('REC', 56, 34);
        x.fillStyle = '#a9dcea';
        x.font = '500 24px Consolas, "Courier New", monospace';
        x.fillText('00:42:17', 124, 34);
        x.fillStyle = 'rgba(150,225,245,0.5)';
        x.fillRect(300, 18, 2, 30);
        x.fillStyle = '#dff6ff';
        x.font = '600 23px "Segoe UI", Arial, sans-serif';
        x.fillText('4K / 120', 322, 34);
        x.fillStyle = '#5fe8ff';
        x.font = '600 19px "Segoe UI", Arial, sans-serif';
        x.fillText('10-BIT D-LOG M', 470, 34);
        drawBatteryIcon(x, W - 150, 21, 74, 26, 0.86, '#7df3c8');
        x.fillStyle = '#dff6ff';
        x.font = '600 21px "Segoe UI", Arial, sans-serif';
        x.textAlign = 'right';
        x.fillText('86%', W - 162, 34);
        drawSignalIcon(x, W - 246, 22, 22, 'rgba(223,246,255,0.85)');

        /* bottom bar */
        x.fillStyle = 'rgba(2,10,15,0.74)';
        x.fillRect(0, H - 104, W, 104);
        x.fillStyle = 'rgba(255,255,255,0.12)';
        x.fillRect(0, H - 104, W, 1);

        /* histogram */
        var histRng = makeRng(4242);
        var hx = 40;
        var hy = H - 86;
        var hw = 150;
        var hh = 54;
        for (i = 0; i < 30; i++) {
          var bh = 4 + histRng() * hh;
          x.fillStyle = 'rgba(140,235,255,' + (0.35 + histRng() * 0.4).toFixed(2) + ')';
          x.fillRect(hx + i * (hw / 30), hy + hh - bh, (hw / 30) - 1.4, bh);
        }
        x.strokeStyle = 'rgba(160,225,240,0.3)';
        x.lineWidth = 1;
        x.strokeRect(hx, hy, hw, hh);

        /* parameter chips */
        var chips = ['AUTO', 'F2.8', '1/240', 'ISO 100', 'WB 5600K'];
        var cx0 = 240;
        for (i = 0; i < chips.length; i++) {
          var cw2 = chips[i].length * 13 + 26;
          fillRoundRect(x, cx0, H - 84, cw2, 34, 9, 'rgba(255,255,255,0.08)');
          x.strokeStyle = 'rgba(160,230,250,0.28)';
          x.lineWidth = 1;
          strokeRoundRect(x, cx0, H - 84, cw2, 34, 9, 'rgba(160,230,250,0.28)', 1);
          x.fillStyle = i === 0 ? '#5fe8ff' : '#d7ecf4';
          x.font = '600 17px Consolas, "Courier New", monospace';
          x.textAlign = 'center';
          x.fillText(chips[i], cx0 + cw2 * 0.5, H - 66);
          cx0 += cw2 + 12;
        }

        /* shutter ring */
        var shX = W * 0.5;
        var shY = H - 52;
        x.strokeStyle = 'rgba(255,255,255,0.9)';
        x.lineWidth = 4;
        x.beginPath();
        x.arc(shX, shY, 25, 0, PI * 2);
        x.stroke();
        x.fillStyle = 'rgba(255,255,255,0.85)';
        x.beginPath();
        x.arc(shX, shY, 16, 0, PI * 2);
        x.fill();

        /* exposure meter right */
        x.fillStyle = 'rgba(220,240,248,0.72)';
        x.font = '500 17px Consolas, "Courier New", monospace';
        x.textAlign = 'right';
        x.fillText('EV 0.0', W - 40, H - 62);
        x.fillStyle = '#ffb44a';
        x.font = '600 17px "Segoe UI", Arial, sans-serif';
        x.fillText('155\u00b0  ULTRA-WIDE', W - 40, H - 36);

        /* small corner DJI tag */
        x.textAlign = 'left';
        x.fillStyle = 'rgba(235,245,250,0.5)';
        x.font = '700 15px "Segoe UI", Arial, sans-serif';
        x.fillText('DJI', 40, H - 28);
        return canvasTexture(c);
      }

      function drawMainboardPCB(W, H, seed, isMain) {
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        var rng = makeRng(seed);
        var i;
        var j;
        var g = x.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, isMain ? '#0e2418' : '#10261a');
        g.addColorStop(0.45, isMain ? '#123322' : '#13291c');
        g.addColorStop(0.75, isMain ? '#0d2719' : '#0e2116');
        g.addColorStop(1, isMain ? '#091c11' : '#0a1a12');
        x.fillStyle = g;
        x.fillRect(0, 0, W, H);

        /* copper pours / ground zones */
        x.globalAlpha = 0.35;
        for (i = 0; i < 6; i++) {
          x.fillStyle = 'rgba(48,104,66,0.5)';
          x.fillRect(20 + rng() * (W - 160), 20 + rng() * (H - 120), 90 + rng() * 220, 60 + rng() * 140);
        }
        x.globalAlpha = 1;

        /* traces */
        x.lineCap = 'round';
        x.lineJoin = 'round';
        var traceCount = isMain ? 190 : 90;
        for (i = 0; i < traceCount; i++) {
          var sx = 18 + rng() * (W - 36);
          var sy = 18 + rng() * (H - 36);
          var horizontal = rng() > 0.42;
          var len1 = rng() * (isMain ? 150 : 80);
          var len2 = rng() * (isMain ? 150 : 80);
          if (rng() > 0.76) {
            x.strokeStyle = 'rgba(168,126,70,0.55)';
          } else if (rng() > 0.5) {
            x.strokeStyle = 'rgba(58,140,90,0.6)';
          } else {
            x.strokeStyle = 'rgba(44,112,72,0.46)';
          }
          x.lineWidth = rng() > 0.88 ? 2.4 : (rng() > 0.5 ? 1.4 : 0.9);
          x.beginPath();
          x.moveTo(sx, sy);
          if (horizontal) {
            x.lineTo(sx + len1, sy);
            x.lineTo(sx + len1, sy + (rng() - 0.5) * 40);
            x.lineTo(sx + len1 + len2, sy + (rng() - 0.5) * 40);
          } else {
            x.lineTo(sx, sy + len1);
            x.lineTo(sx + (rng() - 0.5) * 40, sy + len1);
            x.lineTo(sx + (rng() - 0.5) * 40, sy + len1 + len2);
          }
          x.stroke();
        }

        /* vias */
        var viaCount = isMain ? 120 : 46;
        for (i = 0; i < viaCount; i++) {
          var vx = 20 + rng() * (W - 40);
          var vy = 20 + rng() * (H - 40);
          var vr = 2 + rng() * 2.4;
          x.fillStyle = '#b98a4b';
          x.beginPath();
          x.arc(vx, vy, vr, 0, PI * 2);
          x.fill();
          x.fillStyle = '#03100a';
          x.beginPath();
          x.arc(vx, vy, vr * 0.45, 0, PI * 2);
          x.fill();
        }

        /* mounting holes */
        var holes = [[24, 24], [W - 24, 24], [24, H - 24], [W - 24, H - 24]];
        for (i = 0; i < holes.length; i++) {
          x.fillStyle = '#c9a25a';
          x.beginPath();
          x.arc(holes[i][0], holes[i][1], 11, 0, PI * 2);
          x.fill();
          x.fillStyle = '#03110b';
          x.beginPath();
          x.arc(holes[i][0], holes[i][1], 6, 0, PI * 2);
          x.fill();
        }

        /* component outlines + silkscreen */
        function footprint(px, py, pw, ph, label, sub) {
          x.strokeStyle = 'rgba(216,236,226,0.5)';
          x.lineWidth = 1.4;
          x.strokeRect(px, py, pw, ph);
          x.fillStyle = 'rgba(226,242,232,0.82)';
          x.font = '600 13px Consolas, "Courier New", monospace';
          x.textAlign = 'left';
          x.fillText(label, px + 4, py - 6);
          if (sub) {
            x.fillStyle = 'rgba(170,200,185,0.6)';
            x.font = '500 10px Consolas, "Courier New", monospace';
            x.fillText(sub, px + 4, py + ph * 0.55);
          }
        }

        if (isMain) {
          footprint(W * 0.25, H * 0.24, W * 0.16, H * 0.22, 'U1', 'A4 SoC');
          footprint(W * 0.47, H * 0.2, W * 0.1, H * 0.15, 'U4', 'PMIC');
          footprint(W * 0.62, H * 0.22, W * 0.12, H * 0.14, 'U7', 'WiFi 6');
          footprint(W * 0.28, H * 0.56, W * 0.1, H * 0.1, 'U2', 'LPDDR');
          footprint(W * 0.72, H * 0.55, W * 0.13, H * 0.1, 'J3', 'microSD');
          footprint(W * 0.1, H * 0.7, W * 0.11, H * 0.12, 'J1', 'USB-C');
          footprint(W * 0.46, H * 0.66, W * 0.08, H * 0.08, 'U9', 'IMU');
          /* gold pad rows */
          for (i = 0; i < 12; i++) {
            x.fillStyle = 'rgba(206,164,84,0.9)';
            x.fillRect(W * 0.44 + i * 11, H * 0.88, 7, 22);
            x.fillRect(W * 0.44 + i * 11, H * 0.09, 7, 16);
          }
          /* connector footprints */
          x.strokeStyle = 'rgba(216,236,226,0.35)';
          x.lineWidth = 1;
          x.strokeRect(W * 0.14, H * 0.38, W * 0.1, H * 0.08);
          x.strokeRect(W * 0.78, H * 0.36, W * 0.09, H * 0.06);
          /* silkscreen */
          x.fillStyle = 'rgba(232,246,238,0.85)';
          x.font = '700 26px "Segoe UI", Arial, sans-serif';
          x.textAlign = 'left';
          x.fillText('DJI  ACTION 4  MAIN BOARD', 36, 48);
          x.fillStyle = 'rgba(190,220,205,0.6)';
          x.font = '500 15px Consolas, "Courier New", monospace';
          x.fillText('A4-MB-REV.C   2023.06   MADE IN CHINA', 36, 74);
          x.fillText('CAUTION: ESD SENSITIVE DEVICE', 36, H - 18);
          x.fillStyle = 'rgba(255,190,90,0.65)';
          x.font = '600 14px Consolas, "Courier New", monospace';
          x.fillText('A4 / 1.3 CMOS', W - 210, 48);
        } else {
          footprint(W * 0.18, H * 0.16, W * 0.24, H * 0.24, 'U1', 'CMOS');
          footprint(W * 0.55, H * 0.2, W * 0.16, H * 0.12, 'U3', 'AF DRV');
          x.fillStyle = 'rgba(232,246,238,0.8)';
          x.font = '700 20px "Segoe UI", Arial, sans-serif';
          x.textAlign = 'left';
          x.fillText('DJI  1/1.3" CMOS SENSOR', 24, 40);
          x.fillStyle = 'rgba(190,220,205,0.6)';
          x.font = '500 13px Consolas, "Courier New", monospace';
          x.fillText('A4-SEN-02   REV B', 24, 62);
          /* gold contact pads around sensor footprint */
          for (i = 0; i < 10; i++) {
            x.fillStyle = 'rgba(214,172,90,0.92)';
            x.fillRect(W * 0.2 + i * 18, H * 0.5, 12, 14);
            x.fillRect(W * 0.2 + i * 18, H * 0.64, 12, 14);
          }
          x.fillStyle = 'rgba(255,190,90,0.7)';
          x.font = '600 12px Consolas, "Courier New", monospace';
          x.fillText('PROPERTY OF DJI  \u00b7  DO NOT TOUCH', 24, H - 20);
        }

        x.strokeStyle = 'rgba(216,236,226,0.4)';
        x.lineWidth = 2;
        x.strokeRect(10, 10, W - 20, H - 20);

        return canvasTexture(c);
      }

      function drawBatteryLabel() {
        var W = 320;
        var H = 1000;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        var i;
        x.clearRect(0, 0, W, H);

        fillRoundRect(x, 5, 5, W - 10, H - 10, 26, '#101317');
        strokeRoundRect(x, 12, 12, W - 24, H - 24, 20, 'rgba(255,190,46,0.32)', 2);

        /* carbon weave hint */
        x.globalAlpha = 0.5;
        for (i = -H; i < H; i += 14) {
          x.strokeStyle = 'rgba(255,255,255,0.028)';
          x.lineWidth = 1;
          x.beginPath();
          x.moveTo(0, i);
          x.lineTo(W, i + W);
          x.stroke();
        }
        x.globalAlpha = 1;

        /* DJI mark */
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = '#f4f8fb';
        x.font = '700 62px "Segoe UI", Arial, sans-serif';
        x.fillText('DJI', W * 0.5, 86);
        x.fillStyle = '#ffbe2e';
        x.fillRect(68, 124, W - 136, 3);

        x.fillStyle = '#ffbe2e';
        x.font = '700 40px "Segoe UI", Arial, sans-serif';
        drawSpacedText(x, 'EXTREME', W * 0.5, 172, 3);
        x.fillStyle = '#93a0ad';
        x.font = '600 16px "Segoe UI", Arial, sans-serif';
        drawSpacedText(x, 'BATTERY', W * 0.5, 208, 6);

        x.fillStyle = '#f4f8fb';
        x.font = '700 58px "Segoe UI", Arial, sans-serif';
        x.fillText('1770mAh', W * 0.5, 300);
        x.fillStyle = '#8e9aa6';
        x.font = '500 16px Consolas, "Courier New", monospace';
        x.fillText('3.85V  \u00b7  6.82Wh  \u00b7  Li-ion', W * 0.5, 340);

        /* amber sweep band */
        x.save();
        x.translate(W * 0.5, 430);
        x.rotate(-0.22);
        x.fillStyle = 'rgba(255,190,46,0.16)';
        x.fillRect(-W, -50, W * 2.6, 100);
        x.restore();

        /* energy icon */
        x.strokeStyle = '#ffbe2e';
        x.lineWidth = 3;
        pathRoundRect(x, 92, 470, 118, 58, 12);
        x.stroke();
        x.fillStyle = '#ffbe2e';
        x.fillRect(210, 486, 8, 26);
        x.fillRect(104, 482, 26, 34);
        x.fillRect(136, 482, 26, 34);
        x.fillRect(168, 482, 22, 34);
        x.fillStyle = 'rgba(255,255,255,0.12)';
        x.fillRect(200, 482, 6, 34);

        x.fillStyle = '#c9d3da';
        x.font = '600 18px "Microsoft YaHei", "PingFang SC", sans-serif';
        x.fillText('\u8010\u4f4e\u6e29\u7535\u6c60  \u00b7  -20\u00b0C \u53ef\u7528', W * 0.5, 585);

        x.fillStyle = 'rgba(160,178,190,0.8)';
        x.font = '600 14px Consolas, "Courier New", monospace';
        x.fillText('DESIGNED FOR DJI OSMO ACTION 4', W * 0.5, 645);
        x.fillStyle = 'rgba(140,158,170,0.6)';
        x.font = '500 12px Consolas, "Courier New", monospace';
        x.fillText('MODEL: AC4-EXT-BAT', W * 0.5, 668);

        /* warning block */
        x.textAlign = 'left';
        x.fillStyle = 'rgba(140,155,166,0.72)';
        x.font = '500 11px Consolas, "Courier New", monospace';
        x.fillText('CAUTION', 30, 840);
        x.fillText('DO NOT DISASSEMBLE, CRUSH OR HEAT.', 30, 862);
        x.fillText('DO NOT EXPOSE TO FIRE OR WATER.', 30, 882);
        x.fillText('CHARGE WITH DJI CHARGER ONLY.', 30, 902);
        x.fillStyle = 'rgba(110,126,138,0.6)';
        x.fillText('MADE IN CHINA  \u00b7  DJI TECHNOLOGY', 30, 944);

        /* contact strip illustration */
        x.fillStyle = 'rgba(206,164,84,0.9)';
        x.fillRect(30, 700, 34, 16);
        x.fillRect(74, 700, 34, 16);
        x.fillRect(118, 700, 34, 16);
        return canvasTexture(c);
      }

      function drawBatteryDoorDecal() {
        var W = 512;
        var H = 256;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = 'rgba(240,246,251,0.94)';
        x.font = '700 66px "Segoe UI", Arial, sans-serif';
        x.fillText('DJI', W * 0.5, 58);
        x.fillStyle = '#ffbe2e';
        x.fillRect(150, 96, W - 300, 2);
        x.font = '600 19px "Segoe UI", Arial, sans-serif';
        drawSpacedText(x, 'EXTREME BATTERY', W * 0.5, 125, 5);
        x.fillStyle = 'rgba(190,204,214,0.8)';
        x.font = '500 17px Consolas, "Courier New", monospace';
        x.fillText('1770mAh   \u00b7   3.85V', W * 0.5, 164);
        x.fillStyle = 'rgba(255,190,46,0.85)';
        x.font = '600 15px "Segoe UI", Arial, sans-serif';
        x.fillText('ACTION 4', W * 0.5, 200);
        return canvasTexture(c);
      }

      function drawMountDecal() {
        var W = 512;
        var H = 160;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        x.textBaseline = 'middle';
        x.textAlign = 'left';
        x.fillStyle = 'rgba(238,245,250,0.9)';
        x.font = '700 54px "Segoe UI", Arial, sans-serif';
        x.fillText('DJI', 24, H * 0.5);
        x.fillStyle = 'rgba(196,208,218,0.8)';
        x.font = '600 24px "Segoe UI", Arial, sans-serif';
        x.fillText('MAGNETIC QUICK-RELEASE', 128, H * 0.42);
        x.fillStyle = 'rgba(140,158,172,0.7)';
        x.font = '500 18px Consolas, "Courier New", monospace';
        x.fillText('1/4\u2033 THREAD ADAPTER   \u00b7   ACTION 4', 128, H * 0.68);
        return canvasTexture(c);
      }

      function drawLensBand() {
        var W = 1024;
        var H = 64;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        x.fillStyle = '#14171b';
        x.fillRect(0, 0, W, H);
        x.fillStyle = 'rgba(255,180,74,0.75)';
        x.fillRect(0, 4, W, 2);
        x.fillRect(0, H - 6, W, 2);
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = 'rgba(214,224,232,0.82)';
        x.font = '600 21px "Segoe UI", Arial, sans-serif';
        drawSpacedText(x, '155\u00b0 ULTRA-WIDE  \u00b7  F/2.8  \u00b7  ASPHERICAL LENS', W * 0.25, H * 0.54, 2);
        drawSpacedText(x, '155\u00b0 ULTRA-WIDE  \u00b7  F/2.8  \u00b7  ASPHERICAL LENS', W * 0.75, H * 0.54, 2);
        return canvasTexture(c);
      }

      function drawMicPlate(isColor) {
        var W = 256;
        var H = 128;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        if (isColor) {
          var g = x.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, '#5d646d');
          g.addColorStop(0.5, '#3d434b');
          g.addColorStop(1, '#262b31');
          x.fillStyle = g;
        } else {
          x.fillStyle = '#e4e4e4';
        }
        x.fillRect(0, 0, W, H);
        var col;
        for (col = 0; col < 10; col++) {
          var row;
          for (row = 0; row < 4; row++) {
            var px = 20 + col * 22.5;
            var py = 18 + row * 25 + (col % 2) * 8;
            x.fillStyle = isColor ? '#0a0c0f' : '#1c1c1c';
            x.beginPath();
            x.arc(px, py, 5.4, 0, PI * 2);
            x.fill();
            if (isColor) {
              x.strokeStyle = 'rgba(255,255,255,0.16)';
              x.lineWidth = 1.2;
              x.beginPath();
              x.arc(px, py + 1.4, 5.1, 0.15, PI - 0.15);
              x.stroke();
            }
          }
        }
        x.strokeStyle = isColor ? 'rgba(150,160,170,0.5)' : 'rgba(120,120,120,0.6)';
        x.lineWidth = 4;
        x.strokeRect(4, 4, W - 8, H - 8);
        return canvasTexture(c, isColor ? {} : { srgb: false });
      }

      function drawKnurl(isColor) {
        var W = 256;
        var H = 64;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        var i;
        if (isColor) {
          x.fillStyle = '#2b3037';
          x.fillRect(0, 0, W, H);
          for (i = 0; i < 64; i++) {
            x.fillStyle = (i % 2 === 0) ? '#3b424b' : '#191d22';
            x.fillRect(i * 4, 0, 2, H);
            x.fillStyle = 'rgba(255,255,255,0.05)';
            x.fillRect(i * 4, 0, 1, H);
          }
          x.fillStyle = 'rgba(0,0,0,0.35)';
          x.fillRect(0, 0, W, 4);
          x.fillRect(0, H - 4, W, 4);
        } else {
          x.fillStyle = '#7a7a7a';
          x.fillRect(0, 0, W, H);
          for (i = 0; i < 64; i++) {
            x.fillStyle = (i % 2 === 0) ? '#f2f2f2' : '#2a2a2a';
            x.fillRect(i * 4, 0, 2, H);
          }
        }
        return canvasTexture(c, isColor ? {} : { srgb: false });
      }

      function drawRibBump() {
        var W = 128;
        var H = 128;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        var i;
        x.fillStyle = '#b4b4b4';
        x.fillRect(0, 0, W, H);
        for (i = 0; i < 16; i++) {
          x.fillStyle = '#3a3a3a';
          x.fillRect(0, i * 8, W, 3);
          x.fillStyle = '#e6e6e6';
          x.fillRect(0, i * 8 + 3, W, 1.5);
        }
        return canvasTexture(c, { srgb: false, wrap: true, repeat: [2, 2] });
      }

      function drawMicroNoise() {
        var W = 256;
        var H = 256;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        var rng = makeRng(91731);
        var i;
        x.fillStyle = '#cacaca';
        x.fillRect(0, 0, W, H);
        for (i = 0; i < 4200; i++) {
          var v = 150 + Math.floor(rng() * 105);
          x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
          x.fillRect(rng() * W, rng() * H, 1 + rng() * 2.4, 1 + rng() * 2.4);
        }
        return canvasTexture(c, { srgb: false, wrap: true, repeat: [3, 2] });
      }

      function drawStreak() {
        var W = 512;
        var H = 512;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        var i;
        x.save();
        x.translate(W * 0.5, H * 0.5);
        x.rotate(-0.55);
        for (i = 0; i < 3; i++) {
          var wdt = 520 - i * 130;
          var alpha = 0.5 - i * 0.13;
          var g = x.createLinearGradient(-wdt * 0.5, 0, wdt * 0.5, 0);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(0.42, 'rgba(255,255,255,' + alpha.toFixed(2) + ')');
          g.addColorStop(0.55, 'rgba(210,245,255,' + (alpha * 0.5).toFixed(2) + ')');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g;
          x.fillRect(-wdt * 0.5, -80 + i * 55, wdt, 26 - i * 5);
        }
        x.restore();
        /* soft corner sheen */
        var rg = x.createRadialGradient(W * 0.18, H * 0.14, 6, W * 0.18, H * 0.14, 260);
        rg.addColorStop(0, 'rgba(255,255,255,0.30)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = rg;
        x.fillRect(0, 0, W, H);
        return canvasTexture(c);
      }

      function drawLensGlow() {
        var W = 256;
        var H = 256;
        var c = makeCanvas(W, H);
        var x = ctx2d(c);
        var g = x.createRadialGradient(W * 0.34, H * 0.3, 2, W * 0.34, H * 0.3, 120);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.18, 'rgba(210,244,255,0.55)');
        g.addColorStop(0.5, 'rgba(120,190,255,0.12)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, W, H);
        var rg = x.createRadialGradient(W * 0.72, H * 0.68, 10, W * 0.72, H * 0.68, 90);
        rg.addColorStop(0, 'rgba(120,220,255,0.20)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = rg;
        x.fillRect(0, 0, W, H);
        return canvasTexture(c);
      }

      var TEX = {
        frontScreen: drawFrontScreenUI(),
        rearScreen: drawRearScreenUI(),
        mainPCB: drawMainboardPCB(1024, 640, 20240604, true),
        sensorPCB: drawMainboardPCB(512, 512, 77031, false),
        batteryLabel: drawBatteryLabel(),
        batteryDoor: drawBatteryDoorDecal(),
        djiLogo: drawDjiWordmark(),
        action4: drawAction4(),
        mountDecal: drawMountDecal(),
        lensBand: drawLensBand(),
        micMap: drawMicPlate(true),
        micBump: drawMicPlate(false),
        knurlColor: drawKnurl(true),
        knurlBump: drawKnurl(false),
        ribBump: drawRibBump(),
        micro: drawMicroNoise(),
        streak: drawStreak(),
        lensGlow: drawLensGlow(),
        label14: textTexture('1.4\u2033', 24, 'rgba(226,238,245,0.85)'),
        sensorLabel: textTexture('1/1.3\u2033  CMOS  \u00b7  2.4\u03bcm', 18, 'rgba(120,255,200,0.9)'),
        mainLabel: textTexture('A4-MAIN  \u00b7  REV C', 18, 'rgba(150,255,190,0.85)'),
        usbLabel: textTexture('USB-C', 18, 'rgba(226,238,245,0.8)'),
        sdLabel: textTexture('microSD', 18, 'rgba(226,238,245,0.8)'),
        qsLabel: textTexture('QS', 20, 'rgba(226,238,245,0.75)')
      };

      /* ============================================================
         3. part kit (unique materials per part + pick mesh registry)
         ============================================================ */

      function makeKit(partData) {
        var id = partData.id;
        var accentHex = partData.accent || '#ffffff';
        var group = new THREE.Group();
        group.name = 'A4-' + id;
        group.userData.partId = id;

        var kit = {
          id: id,
          group: group,
          accentHex: accentHex,
          accent: new THREE.Color(accentHex),
          materials: [],
          pickMeshes: [],
          fadeMaterials: null
        };

        function withAccent(opts) {
          var o = {};
          var k;
          for (k in opts) {
            if (Object.prototype.hasOwnProperty.call(opts, k)) {
              o[k] = opts[k];
            }
          }
          o.emissive = new THREE.Color(accentHex);
          o.emissiveIntensity = 0;
          return o;
        }

        kit.mat = function (opts) {
          var m = new THREE.MeshStandardMaterial(withAccent(opts));
          kit.materials.push(m);
          return m;
        };

        kit.phys = function (opts) {
          var m = new THREE.MeshPhysicalMaterial(withAccent(opts));
          kit.materials.push(m);
          return m;
        };

        kit.basic = function (opts) {
          var m = new THREE.MeshBasicMaterial(opts);
          /* Do NOT add fake emissive fields here: WebGLRenderer treats
             material.emissive as a shader uniform, but MeshBasicMaterial's
             shader has no such uniform, which makes every render throw. */
          kit.materials.push(m);
          return m;
        };

        kit.add = function (obj) {
          group.add(obj);
          if (obj.isMesh) {
            obj.userData.partId = id;
            kit.pickMeshes.push(obj);
          }
          return obj;
        };

        kit.mesh = function (geo, material, x, y, z) {
          var m = new THREE.Mesh(geo, material);
          m.position.set(x || 0, y || 0, z || 0);
          return kit.add(m);
        };

        return kit;
      }

      /* Decal plane helper: text/label canvas maps, unlit so they stay crisp. */
      function decal(kit, texture, worldH, x, y, z, rotX, rotY, opacity) {
        var aspect = texture.image.width / texture.image.height;
        var mat = kit.basic({
          map: texture,
          transparent: true,
          opacity: (opacity === undefined ? 1 : opacity),
          depthWrite: false,
          toneMapped: false,
          side: THREE.FrontSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        });
        var mesh = kit.mesh(planeGeo(worldH * aspect, worldH), mat, x, y, z);
        if (rotX) { mesh.rotation.x = rotX; }
        if (rotY) { mesh.rotation.y = rotY; }
        return mesh;
      }

      function addScreenPlane(kit, texture, w, h, x, y, z, rotY) {
        var mat = kit.basic({ map: texture, toneMapped: false });
        var mesh = kit.mesh(planeGeo(w, h), mat, x, y, z);
        if (rotY) { mesh.rotation.y = rotY; }
        screenList.push({ mat: mat, phase: (x + y) * 0.35 });
        return mesh;
      }

      function addGlassOverlay(kit, texture, w, h, x, y, z, rotY, opacity) {
        var base = (opacity === undefined ? 0.16 : opacity);
        var mat = kit.basic({
          map: texture,
          transparent: true,
          opacity: base,
          depthWrite: false,
          toneMapped: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3
        });
        var mesh = kit.mesh(planeGeo(w, h), mat, x, y, z);
        if (rotY) { mesh.rotation.y = rotY; }
        overlayList.push({ mat: mat, base: base, phase: (x + y) * 0.7 });
        return mesh;
      }

      function makeLedMat(kit, hex, low, high, speed, phase) {
        var mat = kit.basic({ color: new THREE.Color(hex), toneMapped: false });
        ledList.push({
          mat: mat,
          base: new THREE.Color(hex),
          low: low === undefined ? 0.35 : low,
          high: high === undefined ? 1 : high,
          speed: speed || 2.1,
          phase: phase || 0
        });
        return mat;
      }

      /* ============================================================
         4. part builders
         ============================================================ */

      function buildBody(kit) {
        /* main shell */
        var shellMat = kit.phys({
          color: 0x2b2f35,
          metalness: 0.46,
          roughness: 0.5,
          clearcoat: 0.3,
          clearcoatRoughness: 0.5,
          bumpMap: TEX.micro,
          bumpScale: 0.014,
          roughnessMap: TEX.micro,
          envMapIntensity: 1.15
        });
        kit.mesh(rbox(7.4, 4.6, 3.2, 0.62, 0.22, 4, 12), shellMat, 0, 0, 0);

        var bezelMat = kit.phys({
          color: 0x15171b,
          metalness: 0.55,
          roughness: 0.42,
          clearcoat: 0.45,
          clearcoatRoughness: 0.35,
          envMapIntensity: 1.2
        });
        var gripMat = kit.phys({
          color: 0x0d0f12,
          metalness: 0.08,
          roughness: 0.92,
          bumpMap: TEX.ribBump,
          bumpScale: 0.05
        });
        var seamMat = kit.mat({
          color: 0x060708,
          metalness: 0.25,
          roughness: 0.78
        });
        var accentMat = kit.phys({
          color: 0xffb44a,
          metalness: 0.35,
          roughness: 0.3,
          clearcoat: 0.6
        });
        var frameMetalMat = kit.mat({
          color: 0x2c3138,
          metalness: 0.9,
          roughness: 0.34
        });
        var cavityMat = kit.mat({
          color: 0x050608,
          metalness: 0.4,
          roughness: 0.6
        });
        var screwMat = kit.mat({
          color: 0x8b939d,
          metalness: 0.95,
          roughness: 0.3
        });

        /* raised front bezel lip — kept thin so the enlarged lens (≈3.2 dia)
           and the 1.4" front screen (≈3.16 × 2.0 bezel) both clear it */
        kit.mesh(frame(7.34, 4.54, 0.075, 0.12, 0.64, 0.016), bezelMat, 0, 0, 1.632);

        /* front screen recess panel + lens collar */
        kit.mesh(rbox(3.2, 2.06, 0.04, 0.3, 0.008), bezelMat, 1.93, 0.2, 1.607);
        kit.mesh(cylZ(1.68, 1.68, 0.11, 72, false), bezelMat, -1.8, 0.18, 1.645);
        kit.mesh(torusZ(1.638, 0.018, 8, 80), accentMat, -1.8, 0.18, 1.702);
        kit.mesh(torusZ(1.664, 0.012, 6, 80), frameMetalMat, -1.8, 0.18, 1.702);

        /* front branding */
        decal(kit, TEX.djiLogo, 0.42, -1.8, -1.78, 1.6115, 0, 0, 1);
        decal(kit, TEX.action4, 0.3, 1.93, -1.25, 1.6115, 0, 0, 1);

        /* rear bezel recess + screen seams */
        kit.mesh(rbox(5.62, 3.42, 0.04, 0.26, 0.008), bezelMat, 0, 0.15, -1.605);
        kit.mesh(boxGeo(5.65, 0.024, 0.018), seamMat, 0, 1.82, -1.606);
        kit.mesh(boxGeo(5.65, 0.024, 0.018), seamMat, 0, -1.52, -1.606);
        kit.mesh(boxGeo(0.024, 3.37, 0.018), seamMat, -2.78, 0.15, -1.606);
        kit.mesh(boxGeo(0.024, 3.37, 0.018), seamMat, 2.78, 0.15, -1.606);

        /* -X port cover + USB-C recess */
        var portGeo = rbox(1.78, 1.06, 0.07, 0.16, 0.02);
        portGeo.rotateY(PI * 0.5);
        kit.mesh(portGeo, bezelMat, -3.685, -0.62, 0.06);
        var slotGeo = rbox(0.66, 0.2, 0.04, 0.07, 0.01);
        slotGeo.rotateY(PI * 0.5);
        kit.mesh(slotGeo, cavityMat, -3.726, -0.62, 0.06);
        var slotInnerGeo = rbox(0.5, 0.12, 0.03, 0.05, 0.008);
        slotInnerGeo.rotateY(PI * 0.5);
        kit.mesh(slotInnerGeo, frameMetalMat, -3.73, -0.62, 0.06);

        /* +X battery door seams + slider latch */
        kit.mesh(boxGeo(0.016, 3.94, 0.03), seamMat, 3.702, 0.02, 1.27);
        kit.mesh(boxGeo(0.016, 3.94, 0.03), seamMat, 3.702, 0.02, -1.27);
        kit.mesh(boxGeo(0.016, 0.03, 2.57), seamMat, 3.702, 1.99, 0);
        kit.mesh(boxGeo(0.016, 0.03, 2.57), seamMat, 3.702, -1.95, 0);
        kit.mesh(rbox(0.05, 0.36, 0.36, 0.06, 0.012), frameMetalMat, 3.708, 0.5, -1.14);
        kit.mesh(boxGeo(0.02, 0.05, 0.26), screwMat, 3.72, 0.58, -1.14);
        kit.mesh(boxGeo(0.02, 0.05, 0.26), screwMat, 3.72, 0.5, -1.14);
        kit.mesh(boxGeo(0.02, 0.05, 0.26), screwMat, 3.72, 0.42, -1.14);

        /* rubberised side grips with ribs */
        var gripGeo = rbox(0.62, 2.92, 0.05, 0.12, 0.012);
        gripGeo.rotateY(PI * 0.5);
        kit.mesh(gripGeo, gripMat, -3.7, 0.02, 1.18);
        kit.mesh(gripGeo, gripMat, -3.7, 0.02, -1.18);

        /* internal chassis skeleton (kept opaque while shell fades) */
        kit.mesh(boxGeo(0.16, 3.3, 0.46), frameMetalMat, -3.34, 0.0, -0.78);
        kit.mesh(boxGeo(0.16, 3.3, 0.46), frameMetalMat, 3.34, 0.0, -0.78);
        kit.mesh(boxGeo(6.3, 0.16, 0.46), frameMetalMat, 0, 2.06, -0.78);
        kit.mesh(boxGeo(6.3, 0.16, 0.46), frameMetalMat, 0, -2.06, -0.78);
        kit.mesh(boxGeo(0.12, 3.4, 2.2), frameMetalMat, 2.32, 0.0, 0.05);

        /* bottom shell screws */
        kit.mesh(cylY(0.085, 0.085, 0.03, 16, false), screwMat, -3.05, -2.302, 1.16);
        kit.mesh(cylY(0.085, 0.085, 0.03, 16, false), screwMat, 3.05, -2.302, 1.16);

        /* hidden details for the transformed / exploded shell */
        kit.fadeMaterials = [shellMat, bezelMat, gripMat, seamMat, cavityMat];
        /* decals are basic materials; fade them too so the hologram stays clean */
        var i;
        for (i = 0; i < kit.materials.length; i++) {
          if (kit.materials[i].isMeshBasicMaterial) {
            kit.fadeMaterials.push(kit.materials[i]);
          }
        }
      }

      function buildLensCover(kit) {
        var ringMetal = kit.mat({
          color: 0x363c45,
          metalness: 0.92,
          roughness: 0.3,
          map: TEX.knurlColor,
          bumpMap: TEX.knurlBump,
          bumpScale: 0.035
        });
        var darkMetal = kit.mat({
          color: 0x121418,
          metalness: 0.9,
          roughness: 0.28
        });
        var amber = kit.phys({
          color: 0xffb44a,
          metalness: 0.4,
          roughness: 0.26,
          clearcoat: 0.8
        });
        var glass = kit.phys({
          color: 0x0a1018,
          metalness: 0.72,
          roughness: 0.045,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          side: THREE.DoubleSide,
          envMapIntensity: 2.4
        });
        var glassInner = kit.phys({
          color: 0x101a26,
          metalness: 0.5,
          roughness: 0.08,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          side: THREE.DoubleSide,
          envMapIntensity: 1.8
        });

        kit.mesh(cylZ(1.62, 1.62, 0.06, 80, false), ringMetal, -1.8, 0.18, 1.7);
        kit.mesh(cylZ(1.55, 1.55, 0.28, 96, true), ringMetal, -1.8, 0.18, 1.86);
        kit.mesh(ringGeo(1.34, 1.55, 80), darkMetal, -1.8, 0.18, 1.948);
        kit.mesh(torusZ(1.522, 0.05, 10, 88), darkMetal, -1.8, 0.18, 1.995);
        kit.mesh(torusZ(1.388, 0.02, 8, 88), amber, -1.8, 0.18, 2.004);
        kit.mesh(torusZ(1.43, 0.014, 6, 88), darkMetal, -1.8, 0.18, 2.006);

        var profile = [
          [0.03, 0.032],
          [0.28, 0.029],
          [0.55, 0.021],
          [0.8, 0.008],
          [0.98, -0.004],
          [1.12, -0.018]
        ];
        kit.mesh(latheZ(profile, 72), glass, -1.8, 0.18, 1.98);

        var innerProfile = [
          [0.03, 0.028],
          [0.3, 0.026],
          [0.6, 0.016],
          [0.84, 0.0],
          [0.95, -0.014]
        ];
        kit.mesh(latheZ(innerProfile, 72), glassInner, -1.8, 0.18, 1.95);

        /* reflection sheen on the front glass */
        addGlassOverlay(kit, TEX.lensGlow, 2.2, 2.2, -1.8, 0.2, 2.028, 0, 0.4);
      }

      function buildLens(kit) {
        var barrelMat = kit.mat({
          color: 0x101216,
          metalness: 0.86,
          roughness: 0.36,
          bumpMap: TEX.knurlBump,
          bumpScale: 0.012
        });
        var darkMetal = kit.mat({
          color: 0x0b0d10,
          metalness: 0.85,
          roughness: 0.3
        });
        var chrome = kit.mat({
          color: 0x9aa3ad,
          metalness: 1,
          roughness: 0.18
        });
        var glassBlue = kit.phys({
          color: 0x0e1c36,
          metalness: 0.72,
          roughness: 0.07,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          side: THREE.DoubleSide,
          envMapIntensity: 2.1
        });
        var glassViolet = kit.phys({
          color: 0x221a44,
          metalness: 0.6,
          roughness: 0.11,
          clearcoat: 1,
          envMapIntensity: 1.8
        });
        var cyan = kit.mat({
          color: 0x4fdcff,
          metalness: 0.35,
          roughness: 0.28
        });
        var flexMat = kit.mat({
          color: 0xc47a26,
          metalness: 0.25,
          roughness: 0.42
        });
        var bandMat = kit.mat({
          color: 0xffffff,
          map: TEX.lensBand,
          metalness: 0.55,
          roughness: 0.4
        });

        /* open-ended barrel so the recessed optics are visible through the
           transparent protective cover */
        kit.mesh(cylZ(1.04, 1.1, 0.92, 80, true), barrelMat, -1.8, 0.18, 1.42);
        kit.mesh(cylZ(1.05, 1.05, 0.06, 56, false), darkMetal, -1.8, 0.18, 0.985);
        kit.mesh(ringGeo(0.82, 1.06, 72), darkMetal, -1.8, 0.18, 1.9);
        kit.mesh(torusZ(0.86, 0.04, 8, 56), darkMetal, -1.8, 0.18, 1.885);

        /* layered multi-element front glass */
        var outerElement = [
          [0.4, 1.828],
          [0.48, 1.836],
          [0.6, 1.833],
          [0.7, 1.824],
          [0.78, 1.812],
          [0.84, 1.798]
        ];
        kit.mesh(latheZ(outerElement, 72), glassBlue, -1.8, 0.18, 0);
        kit.mesh(capZ(0.46, PI * 0.35, 28, 8), glassViolet, -1.8, 0.18, 1.36);
        kit.mesh(torusZ(0.42, 0.022, 10, 56), darkMetal, -1.8, 0.18, 1.826);
        kit.mesh(torusZ(0.61, 0.014, 6, 56), cyan, -1.8, 0.18, 1.838);
        kit.mesh(torusZ(0.68, 0.016, 6, 56), cyan, -1.8, 0.18, 1.831);

        var bandGeo = cylZ(1.095, 1.11, 0.15, 72, true);
        kit.mesh(bandGeo, bandMat, -1.8, 0.18, 1.3);

        kit.mesh(boxGeo(0.3, 0.02, 0.42), flexMat, -1.68, 0.04, 0.86);
        kit.mesh(boxGeo(0.22, 0.02, 0.14), flexMat, -1.6, 0.0, 0.62);
        kit.mesh(torusZ(1.1, 0.014, 6, 72), chrome, -1.8, 0.18, 1.907);
      }

      function buildSensor(kit) {
        var pcbMat = kit.mat({
          color: 0xffffff,
          map: TEX.sensorPCB,
          metalness: 0.2,
          roughness: 0.58
        });
        var padMat = kit.mat({
          color: 0x262b31,
          metalness: 0.15,
          roughness: 0.75
        });
        var ceramic = kit.mat({
          color: 0x171a1f,
          metalness: 0.35,
          roughness: 0.5
        });
        var gold = kit.mat({
          color: 0xd6a244,
          metalness: 1,
          roughness: 0.26,
          envMapIntensity: 1.5
        });
        var die = kit.phys({
          color: 0x0e1426,
          metalness: 0.62,
          roughness: 0.16,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          iridescence: 0.65,
          iridescenceIOR: 1.7,
          envMapIntensity: 1.9
        });
        var copper = kit.mat({
          color: 0xb06a3b,
          metalness: 1,
          roughness: 0.3,
          envMapIntensity: 1.4
        });
        var flexMat = kit.mat({
          color: 0xc47a26,
          metalness: 0.25,
          roughness: 0.42
        });
        var filterGlass = kit.phys({
          color: 0x2a3f66,
          metalness: 0.35,
          roughness: 0.05,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
          clearcoat: 1,
          side: THREE.DoubleSide,
          envMapIntensity: 1.6
        });
        var edgeMat = kit.mat({
          color: 0x101418,
          metalness: 0.6,
          roughness: 0.45
        });

        kit.mesh(boxGeo(1.8, 1.8, 0.07), pcbMat, -1.75, 0.18, 0.58);
        kit.mesh(boxGeo(1.3, 1.3, 0.04), padMat, -1.75, 0.18, 0.525);
        kit.mesh(rbox(1.5, 1.5, 0.1, 0.05, 0.015), copper, -1.75, 0.18, 0.46);
        kit.mesh(rbox(1.06, 1.06, 0.22, 0.05, 0.02), ceramic, -1.75, 0.18, 0.72);
        kit.mesh(boxGeo(1.0, 0.055, 0.035), gold, -1.75, 0.685, 0.822);
        kit.mesh(boxGeo(1.0, 0.055, 0.035), gold, -1.75, -0.325, 0.822);
        kit.mesh(boxGeo(0.055, 0.88, 0.035), gold, -2.25, 0.18, 0.822);
        kit.mesh(boxGeo(0.055, 0.88, 0.035), gold, -1.25, 0.18, 0.822);
        kit.mesh(boxGeo(0.58, 0.46, 0.03), die, -1.75, 0.18, 0.838);
        kit.mesh(cylZ(0.42, 0.42, 0.03, 48, false), filterGlass, -1.75, 0.18, 0.872);
        kit.mesh(boxGeo(0.9, 0.32, 0.02), flexMat, -0.42, 0.62, 0.585);
        kit.mesh(rbox(0.28, 0.34, 0.08, 0.03, 0.01), edgeMat, 0.04, 0.82, 0.55);
        kit.mesh(boxGeo(0.18, 0.035, 0.02), gold, -2.18, -0.71, 0.622);
        kit.mesh(boxGeo(0.18, 0.035, 0.02), gold, -1.95, -0.71, 0.622);
        kit.mesh(boxGeo(0.7, 0.02, 0.02), flexMat, -0.6, 0.73, 0.585);
        decal(kit, TEX.sensorLabel, 0.16, -1.75, -0.52, 0.6215, 0, 0, 1);
      }

      function buildFrontScreen(kit) {
        var bezelMat = kit.phys({
          color: 0x111317,
          metalness: 0.6,
          roughness: 0.35,
          clearcoat: 0.6,
          clearcoatRoughness: 0.25,
          envMapIntensity: 1.3
        });
        var glassRim = kit.phys({
          color: 0x0b1016,
          metalness: 0.6,
          roughness: 0.06,
          clearcoat: 1,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          envMapIntensity: 2
        });
        var amber = kit.phys({
          color: 0xffb84d,
          metalness: 0.4,
          roughness: 0.28,
          clearcoat: 0.7
        });
        var flexMat = kit.mat({
          color: 0xc47a26,
          metalness: 0.25,
          roughness: 0.42
        });
        var dark = kit.mat({
          color: 0x0a0c0f,
          metalness: 0.4,
          roughness: 0.5
        });
        var chipMetal = kit.mat({
          color: 0x9aa3ad,
          metalness: 1,
          roughness: 0.32
        });

        kit.mesh(rbox(3.16, 2.0, 0.14, 0.28, 0.03), bezelMat, 1.93, 0.2, 1.665);
        kit.mesh(frame(3.02, 1.84, 0.03, 0.04, 0.24, 0.006), glassRim, 1.93, 0.2, 1.742);
        addScreenPlane(kit, TEX.frontScreen, 2.84, 1.6, 1.93, 0.2, 1.7425, 0);
        addGlassOverlay(kit, TEX.streak, 2.84, 1.6, 1.93, 0.2, 1.749, 0, 0.15);
        kit.mesh(boxGeo(2.7, 0.022, 0.032), amber, 1.93, -0.71, 1.743);
        kit.mesh(cylZ(0.05, 0.05, 0.02, 16, false), makeLedMat(kit, 0xff5b52, 0.25, 1.0, 2.4, 0.4), 0.44, -0.71, 1.745);
        decal(kit, TEX.label14, 0.115, 3.34, -0.71, 1.7435, 0, 0, 1);
        kit.mesh(boxGeo(0.7, 0.32, 0.02), flexMat, 1.6, -0.3, 1.56);
        kit.mesh(rbox(0.4, 0.34, 0.1, 0.04, 0.015), dark, 1.45, -0.4, 1.49);

        /* display module back side (visible once exploded) */
        kit.mesh(rbox(2.9, 1.74, 0.05, 0.18, 0.01), dark, 1.93, 0.2, 1.592);
        kit.mesh(rbox(0.95, 0.6, 0.06, 0.04, 0.012), chipMetal, 1.35, 0.38, 1.56);
        kit.mesh(boxGeo(0.6, 0.13, 0.07), chipMetal, 2.7, 0.4, 1.565);
      }

      function buildRearScreen(kit) {
        var bezelMat = kit.phys({
          color: 0x101216,
          metalness: 0.58,
          roughness: 0.36,
          clearcoat: 0.55,
          clearcoatRoughness: 0.3,
          envMapIntensity: 1.25
        });
        var glassRim = kit.phys({
          color: 0x0a0f15,
          metalness: 0.6,
          roughness: 0.06,
          clearcoat: 1,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          envMapIntensity: 1.9
        });
        var amber = kit.phys({
          color: 0xff9f43,
          metalness: 0.4,
          roughness: 0.3,
          clearcoat: 0.7
        });
        var flexMat = kit.mat({
          color: 0xc47a26,
          metalness: 0.25,
          roughness: 0.42
        });
        var dark = kit.mat({
          color: 0x0a0c0f,
          metalness: 0.4,
          roughness: 0.5
        });
        var chipMetal = kit.mat({
          color: 0x9aa3ad,
          metalness: 1,
          roughness: 0.32
        });

        kit.mesh(rbox(5.5, 3.3, 0.15, 0.34, 0.035), bezelMat, 0, 0.15, -1.665);
        var rimGeo = frame(5.34, 3.14, 0.03, 0.045, 0.3, 0.006);
        var rimMesh = kit.mesh(rimGeo, glassRim, 0, 0.15, -1.744);
        rimMesh.rotation.y = PI;
        addScreenPlane(kit, TEX.rearScreen, 5.2, 3.0, 0, 0.15, -1.7525, PI);
        addGlassOverlay(kit, TEX.streak, 5.2, 3.0, 0, 0.15, -1.759, PI, 0.13);
        kit.mesh(boxGeo(4.8, 0.026, 0.03), amber, 0, -1.43, -1.75);
        kit.mesh(cylZ(0.05, 0.05, 0.02, 16, false), makeLedMat(kit, 0xff5b52, 0.2, 0.9, 2.0, 1.7), -2.45, -1.42, -1.752);
        kit.mesh(boxGeo(0.5, 0.28, 0.02), flexMat, 1.5, 1.35, -1.56);
        kit.mesh(rbox(0.36, 0.28, 0.1, 0.04, 0.015), dark, 1.4, 1.2, -1.49);

        /* display module back side (visible once exploded away from the body) */
        kit.mesh(rbox(5.24, 3.06, 0.05, 0.24, 0.012), dark, 0, 0.15, -1.588);
        kit.mesh(rbox(1.7, 1.15, 0.09, 0.05, 0.015), chipMetal, -1.4, 0.4, -1.548);
        kit.mesh(boxGeo(0.9, 0.14, 0.08), chipMetal, 1.2, 0.95, -1.552);
        kit.mesh(rbox(0.4, 0.4, 0.05, 0.03, 0.01), dark, 1.75, -0.9, -1.56);
      }

      function buildMainboard(kit) {
        var pcbFace = kit.mat({
          color: 0xffffff,
          map: TEX.mainPCB,
          metalness: 0.22,
          roughness: 0.55
        });
        var pcbBack = kit.mat({
          color: 0xffffff,
          map: TEX.mainPCB,
          metalness: 0.22,
          roughness: 0.58
        });
        var pcbEdge = kit.mat({
          color: 0x0a2015,
          metalness: 0.2,
          roughness: 0.7
        });
        var chipDark = kit.phys({
          color: 0x14171b,
          metalness: 0.3,
          roughness: 0.45,
          clearcoat: 0.5
        });
        var shieldMetal = kit.mat({
          color: 0xaab3bd,
          metalness: 1,
          roughness: 0.28,
          envMapIntensity: 1.5
        });
        var connectorDark = kit.mat({
          color: 0x101216,
          metalness: 0.3,
          roughness: 0.55
        });
        var gold = kit.mat({
          color: 0xd6a244,
          metalness: 1,
          roughness: 0.25,
          envMapIntensity: 1.5
        });
        var cavity = kit.mat({
          color: 0x040507,
          metalness: 0.4,
          roughness: 0.65
        });
        var cardMat = kit.mat({
          color: 0x1b2430,
          metalness: 0.35,
          roughness: 0.4
        });

        /* board substrate + printed trace layers (no multi-material meshes so
           generic highlight/dispose code can touch every mesh material) */
        kit.mesh(boxGeo(4.5, 2.5, 0.09), pcbEdge, -0.75, -0.35, -0.55);
        kit.mesh(planeGeo(4.5, 2.5), pcbFace, -0.75, -0.35, -0.5045);
        var pcbBackMesh = kit.mesh(planeGeo(4.5, 2.5), pcbBack, -0.75, -0.35, -0.5955);
        pcbBackMesh.rotation.y = PI;

        /* front side (towards lens) */
        kit.mesh(rbox(0.62, 0.62, 0.14, 0.04, 0.012), chipDark, -1.05, 0.05, -0.44);
        kit.mesh(rbox(0.78, 0.52, 0.12, 0.04, 0.012), shieldMetal, -2.25, 0.28, -0.45);
        kit.mesh(rbox(0.52, 0.38, 0.1, 0.03, 0.01), shieldMetal, -0.2, 0.32, -0.455);
        kit.mesh(rbox(0.42, 0.3, 0.07, 0.02, 0.008), chipDark, -1.35, -0.85, -0.465);
        kit.mesh(boxGeo(0.09, 0.12, 0.06), chipDark, -2.55, -0.05, -0.46);
        kit.mesh(boxGeo(0.09, 0.12, 0.06), chipDark, -2.4, -0.3, -0.46);
        kit.mesh(boxGeo(0.09, 0.12, 0.06), chipDark, -0.4, -1.2, -0.46);
        kit.mesh(boxGeo(0.09, 0.12, 0.06), chipDark, 0.3, -1.2, -0.46);

        /* rear side (towards display) */
        kit.mesh(rbox(1.05, 0.62, 0.12, 0.04, 0.012), shieldMetal, -1.9, -0.85, -0.655);
        kit.mesh(rbox(0.44, 0.44, 0.08, 0.02, 0.008), chipDark, -0.2, -1.05, -0.635);
        kit.mesh(boxGeo(0.6, 0.18, 0.12), connectorDark, 0.35, 0.6, -0.64);
        kit.mesh(rbox(0.62, 0.2, 0.14, 0.03, 0.01), shieldMetal, -2.45, -0.25, -0.65);
        kit.mesh(boxGeo(0.24, 0.16, 0.02), cardMat, -2.4, -0.25, -0.726);

        /* USB-C connector on the -X board edge */
        kit.mesh(rbox(0.34, 0.15, 0.36, 0.04, 0.012), shieldMetal, -3.12, -1.1, -0.55);
        kit.mesh(boxGeo(0.12, 0.075, 0.26), cavity, -3.26, -1.1, -0.55);
        kit.mesh(boxGeo(0.02, 0.028, 0.18), gold, -3.315, -1.1, -0.55);

        /* mounting screws */
        kit.mesh(cylZ(0.07, 0.07, 0.05, 12, false), gold, -2.85, 0.75, -0.49);
        kit.mesh(cylZ(0.07, 0.07, 0.05, 12, false), gold, 1.3, 0.75, -0.49);
        kit.mesh(cylZ(0.07, 0.07, 0.05, 12, false), gold, -2.85, -1.45, -0.49);

        /* labels */
        decal(kit, TEX.mainLabel, 0.24, 0.62, -1.45, -0.4995, 0, 0, 0.95);
        decal(kit, TEX.usbLabel, 0.15, -2.85, -1.42, -0.5995, 0, PI, 0.9);
        decal(kit, TEX.sdLabel, 0.15, -2.72, 0.02, -0.5995, 0, PI, 0.9);
      }

      function buildBattery(kit) {
        var shellMat = kit.phys({
          color: 0x171a1e,
          metalness: 0.35,
          roughness: 0.5,
          clearcoat: 0.25,
          clearcoatRoughness: 0.5
        });
        var labelMat = kit.mat({
          color: 0xffffff,
          map: TEX.batteryLabel,
          metalness: 0.12,
          roughness: 0.52,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        });
        var gold = kit.mat({
          color: 0xd6a244,
          metalness: 1,
          roughness: 0.28
        });
        var doorMetal = kit.phys({
          color: 0x1d2126,
          metalness: 0.6,
          roughness: 0.4,
          clearcoat: 0.4,
          clearcoatRoughness: 0.4,
          envMapIntensity: 1.2
        });
        var latchMetal = kit.mat({
          color: 0x3a4048,
          metalness: 0.92,
          roughness: 0.32
        });
        var amberMat = kit.phys({
          color: 0xffbe2e,
          metalness: 0.35,
          roughness: 0.3,
          clearcoat: 0.7
        });
        var latchRidgeMat = darkMetalLite(kit);

        var slabGeo = rbox(2.36, 3.7, 1.14, 0.2, 0.05);
        slabGeo.rotateY(PI * 0.5);
        kit.mesh(slabGeo, shellMat, 2.99, 0.02, 0.08);

        /* PBR printed label on the front face (320x1000 canvas => aspect 0.32) */
        kit.mesh(planeGeo(3.3 * 0.32, 3.3), labelMat, 2.99, -0.02, 1.267);
        kit.mesh(boxGeo(1.0, 0.035, 0.024), amberMat, 2.99, -1.735, 1.266);
        kit.mesh(boxGeo(1.0, 0.028, 0.024), amberMat, 2.99, 1.7, 1.266);

        kit.mesh(boxGeo(0.22, 0.04, 0.16), gold, 2.7, -1.845, 0.2);
        kit.mesh(boxGeo(0.22, 0.04, 0.16), gold, 2.99, -1.845, 0.2);
        kit.mesh(boxGeo(0.22, 0.04, 0.16), gold, 3.28, -1.845, 0.2);

        /* battery door presentation on +X, travels with the battery */
        var doorGeo = rbox(2.5, 3.95, 0.055, 0.18, 0.015);
        doorGeo.rotateY(PI * 0.5);
        kit.mesh(doorGeo, doorMetal, 3.62, 0, 0.06);
        decal(kit, TEX.batteryDoor, 0.78, 3.651, 0.25, 0.06, 0, PI * 0.5, 1);
        kit.mesh(boxGeo(0.05, 0.05, 2.3), latchMetal, 3.655, 1.985, 0.06);
        kit.mesh(rbox(0.07, 0.34, 0.42, 0.08, 0.012), latchMetal, 3.657, -1.45, 0.06);
        kit.mesh(boxGeo(0.02, 0.04, 0.34), latchRidgeMat, 3.67, -1.5, 0.06);
        kit.mesh(boxGeo(0.02, 0.04, 0.34), latchRidgeMat, 3.67, -1.4, 0.06);
      }

      /* tiny helper used by battery latch ridges (unique material per part) */
      function darkMetalLite(kit) {
        return kit.mat({ color: 0x0b0d10, metalness: 0.8, roughness: 0.4 });
      }

      function buildThermal(kit) {
        var copper = kit.mat({
          color: 0xb56a3c,
          metalness: 1,
          roughness: 0.3,
          envMapIntensity: 1.5
        });
        var pipeCopper = kit.mat({
          color: 0x9a5730,
          metalness: 1,
          roughness: 0.36,
          envMapIntensity: 1.4
        });
        var aluminium = kit.mat({
          color: 0xb9c1c9,
          metalness: 0.95,
          roughness: 0.32,
          envMapIntensity: 1.4
        });
        var graphite = kit.mat({
          color: 0x0f1114,
          metalness: 0.25,
          roughness: 0.86
        });
        var accentMat = kit.mat({
          color: 0xff6b4a,
          metalness: 0.4,
          roughness: 0.3
        });
        var bracket = kit.mat({
          color: 0x2a2f36,
          metalness: 0.85,
          roughness: 0.4
        });

        kit.mesh(rbox(2.0, 1.55, 0.07, 0.06, 0.02), copper, -1.65, 0.25, -0.03);
        kit.mesh(boxGeo(1.8, 0.03, 0.012), accentMat, -1.65, 0.95, 0.012);
        kit.mesh(boxGeo(2.6, 1.9, 0.02), graphite, -1.45, 0.15, -0.14);
        kit.mesh(tubeGeo([
          [-1.9, 0.75, -0.05],
          [-2.15, 1.0, -0.12],
          [-2.3, 1.1, -0.28],
          [-2.16, 1.15, -0.45]
        ], 0.088, 22, 10), pipeCopper, 0, 0, 0);
        kit.mesh(boxGeo(1.15, 0.22, 1.0), copper, -2.63, 0.92, -0.35);

        var finGeo = boxGeo(0.035, 1.15, 0.95);
        var i;
        for (i = 0; i < 12; i++) {
          kit.mesh(finGeo, aluminium, -3.16 + i * 0.096, 1.55, -0.35);
        }
        kit.mesh(boxGeo(0.1, 0.24, 0.4), bracket, -1.25, 0.2, -0.03);
        kit.mesh(boxGeo(0.1, 0.24, 0.4), bracket, -2.2, -0.4, -0.03);
      }

      function buildTopControls(kit) {
        var metal = kit.mat({
          color: 0x2b3037,
          metalness: 0.9,
          roughness: 0.34
        });
        var redRing = kit.phys({
          color: 0xd8342f,
          metalness: 0.35,
          roughness: 0.28,
          clearcoat: 1,
          clearcoatRoughness: 0.18,
          envMapIntensity: 1.4
        });
        var rubber = kit.mat({
          color: 0x111317,
          metalness: 0.06,
          roughness: 0.86
        });
        var greyMetal = kit.mat({
          color: 0x24282e,
          metalness: 0.85,
          roughness: 0.46
        });
        var micMat = kit.mat({
          color: 0x555b63,
          map: TEX.micMap,
          bumpMap: TEX.micBump,
          bumpScale: 0.03,
          metalness: 0.7,
          roughness: 0.5
        });

        /* shutter button with red safety ring */
        kit.mesh(cylY(0.56, 0.62, 0.07, 40, false), metal, -2.15, 2.335, 0.12);
        kit.mesh(torusY(0.48, 0.045, 10, 56), redRing, -2.15, 2.368, 0.12);
        kit.mesh(cylY(0.38, 0.42, 0.16, 36, false), rubber, -2.15, 2.44, 0.12);
        kit.mesh(torusY(0.34, 0.02, 8, 36), metal, -2.15, 2.522, 0.12);

        /* QS button */
        kit.mesh(cylY(0.35, 0.39, 0.06, 32, false), metal, -1.0, 2.332, 0.16);
        kit.mesh(cylY(0.27, 0.3, 0.12, 28, false), rubber, -1.0, 2.4, 0.16);
        decal(kit, TEX.qsLabel, 0.08, -1.0, 2.463, 0.16, -PI * 0.5, 0, 0.85);

        /* microphone / speaker grille plate */
        kit.mesh(rbox(1.95, 0.06, 0.66, 0.08, 0.012), greyMetal, 0.85, 2.33, 0.4);
        var micMesh = kit.mesh(planeGeo(1.84, 0.55), micMat, 0.85, 2.363, 0.4);
        micMesh.rotation.x = -PI * 0.5;
        kit.mesh(rbox(0.4, 0.06, 0.28, 0.06, 0.01), greyMetal, 2.35, 2.33, 0.4);

        /* status LED */
        kit.mesh(cylY(0.09, 0.09, 0.035, 16, false), metal, 2.35, 2.33, -0.35);
        kit.mesh(cylY(0.065, 0.065, 0.03, 16, false), makeLedMat(kit, 0xff5b52, 0.18, 0.95, 1.7, 2.4), 2.35, 2.35, -0.35);
      }

      function buildMount(kit) {
        var graphiteMat = kit.phys({
          color: 0x24282e,
          metalness: 0.6,
          roughness: 0.42,
          clearcoat: 0.3,
          clearcoatRoughness: 0.45,
          envMapIntensity: 1.2
        });
        var darkMetal = kit.mat({
          color: 0x14171b,
          metalness: 0.85,
          roughness: 0.38
        });
        var magnetMat = kit.mat({
          color: 0x2b3038,
          metalness: 0.95,
          roughness: 0.5
        });
        var silver = kit.mat({
          color: 0xaab3bd,
          metalness: 1,
          roughness: 0.26
        });
        var cyan = kit.mat({
          color: 0x7fe7ff,
          metalness: 0.35,
          roughness: 0.3
        });
        var cavity = kit.mat({
          color: 0x040507,
          metalness: 0.3,
          roughness: 0.7
        });

        kit.mesh(rbox(3.95, 0.26, 2.5, 0.28, 0.045), graphiteMat, 0, -2.42, 0);
        kit.mesh(rbox(2.95, 0.12, 1.95, 0.22, 0.03), darkMetal, 0, -2.61, 0);
        kit.mesh(boxGeo(3.4, 0.025, 0.03), cyan, 0, -2.56, 1.22);
        kit.mesh(cylY(0.32, 0.32, 0.07, 32, false), magnetMat, -0.8, -2.675, 0);
        kit.mesh(cylY(0.32, 0.32, 0.07, 32, false), magnetMat, 0.8, -2.675, 0);
        kit.mesh(torusY(0.33, 0.022, 8, 32), silver, -0.8, -2.71, 0);
        kit.mesh(torusY(0.33, 0.022, 8, 32), silver, 0.8, -2.71, 0);
        kit.mesh(cylY(0.3, 0.3, 0.1, 32, false), silver, 0, -2.7, 0);
        kit.mesh(cylY(0.14, 0.14, 0.008, 24, false), cavity, 0, -2.752, 0);
        kit.mesh(rbox(0.62, 0.24, 0.52, 0.08, 0.02), darkMetal, 1.25, -2.47, -0.78);
        kit.mesh(boxGeo(0.5, 0.03, 0.4), silver, 1.25, -2.34, -0.78);
        kit.mesh(boxGeo(0.34, 0.03, 0.28), silver, 1.25, -2.36, -0.78);
        decal(kit, TEX.mountDecal, 0.5, 0, -2.6715, 0.55, PI * 0.5, 0, 0.85);
      }

      /* ============================================================
         5. assemble
         ============================================================ */

      var partsData = (window && window.ACTION4_PARTS && window.ACTION4_PARTS.length)
        ? window.ACTION4_PARTS
        : FALLBACK_PARTS;

      var DATA = [];
      var di;
      for (di = 0; di < partsData.length; di++) {
        DATA.push({
          id: partsData[di].id,
          accent: partsData[di].accent || '#ffffff',
          anchor: partsData[di].anchor ? partsData[di].anchor.slice() : [0, 0, 0]
        });
      }

      var builders = {
        body: buildBody,
        lensCover: buildLensCover,
        lens: buildLens,
        sensor: buildSensor,
        frontScreen: buildFrontScreen,
        rearScreen: buildRearScreen,
        mainboard: buildMainboard,
        battery: buildBattery,
        thermal: buildThermal,
        topControls: buildTopControls,
        mount: buildMount
      };

      var root = new THREE.Group();
      root.name = 'DJI_Osmo_Action4';
      root.userData.product = 'DJI Osmo Action 4';
      root.userData.units = 'assembled';

      var parts = {};
      var allMaterials = [];
      var pi;
      for (pi = 0; pi < DATA.length; pi++) {
        var pd = DATA[pi];
        var kit = makeKit(pd);
        var builder = builders[pd.id];
        if (builder) {
          builder(kit);
        }

        var anchor = new THREE.Object3D();
        anchor.name = 'anchor-' + pd.id;
        var anchorPos = ANCHOR_OVERRIDES[pd.id] || pd.anchor;
        anchor.position.set(anchorPos[0], anchorPos[1], anchorPos[2]);
        anchor.visible = false;
        anchor.userData.partId = pd.id;
        kit.group.add(anchor);

        root.add(kit.group);

        var mi;
        for (mi = 0; mi < kit.materials.length; mi++) {
          allMaterials.push(kit.materials[mi]);
        }

        parts[pd.id] = {
          id: pd.id,
          group: kit.group,
          anchor: anchor,
          pickMeshes: kit.pickMeshes,
          materials: kit.materials
        };
        if (pd.id === 'body' && kit.fadeMaterials) {
          parts[pd.id].fadeMaterials = kit.fadeMaterials;
        }
      }

      /* ============================================================
         6. update / dispose
         ============================================================ */

      function update(dt, elapsed, state) {
        if (disposed) { return; }
        var t = (typeof elapsed === 'number' && isFinite(elapsed)) ? elapsed : 0;
        var i;
        var e;
        var k;
        for (i = 0; i < ledList.length; i++) {
          e = ledList[i];
          k = e.low + (e.high - e.low) * (0.5 + 0.5 * Math.sin(t * e.speed + e.phase));
          e.mat.color.copy(e.base).multiplyScalar(k);
        }
        for (i = 0; i < screenList.length; i++) {
          e = screenList[i];
          k = 0.975 + 0.025 * Math.sin(t * 1.35 + e.phase);
          e.mat.color.setScalar(k);
        }
        for (i = 0; i < overlayList.length; i++) {
          e = overlayList[i];
          e.mat.opacity = e.base * (0.8 + 0.2 * Math.sin(t * 0.85 + e.phase));
        }
      }

      function dispose() {
        if (disposed) { return; }
        disposed = true;
        var i;
        for (i = 0; i < textures.length; i++) {
          try { textures[i].dispose(); } catch (errA) { /* noop */ }
        }
        for (i = 0; i < geoms.length; i++) {
          try { geoms[i].dispose(); } catch (errB) { /* noop */ }
        }
        for (i = 0; i < allMaterials.length; i++) {
          try { allMaterials[i].dispose(); } catch (errC) { /* noop */ }
        }
        textures.length = 0;
        geoms.length = 0;
        allMaterials.length = 0;
        ledList.length = 0;
        screenList.length = 0;
        overlayList.length = 0;
        while (root.children.length > 0) {
          root.remove(root.children[0]);
        }
      }

      return {
        root: root,
        parts: parts,
        update: update,
        dispose: dispose
      };
    }
  };
})();
