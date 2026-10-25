/* ============================================================
   DJI Osmo Action 4 — camera hand-gesture controller
   ------------------------------------------------------------
   Loads MediaPipe Tasks Vision + HandLandmarker locally,
   tracks one hand from the webcam, and drives the 3D teardown:
     · move palm          -> hand cursor / hover a component
     · pinch              -> grab component (or whole chassis)
     · drag while pinching-> pull component apart / push it back
   The camera feed never leaves the browser.
   ============================================================ */
(function () {
  'use strict';

  var APP = function () { return window.Action4Control; };
  var MP = {
    version: '0.10.14',
    bundle: 'vendor/mediapipe/vision_bundle.js',
    wasm: 'vendor/mediapipe/wasm/',
    model: 'vendor/mediapipe/hand_landmarker.task'
  };
  var HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17]
  ];
  var TIPS = [[8, 6], [12, 10], [16, 14], [20, 18]];

  var state = {
    active: false,
    busy: false,
    error: null,
    landmarker: null,
    vision: null,
    stream: null,
    raf: 0,
    lastDetect: 0,
    lastVideoTime: -1,
    detectFailing: false,
    smooth: null,
    missing: 0,
    hoverId: null,
    nextHoverAt: 0,
    pinching: false,
    pinchFrames: 0,
    releaseFrames: 0,
    grab: null,
    globalPinch: false,
    cooldownUntil: 0,
    cursorVisible: false,
    lastStatus: '',
    lastBadge: '',
    ready: false,
    button: null,
    token: 0
  };

  var dom = {};

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function safeUrl(rel) {
    try { return new URL(rel, document.baseURI).href; }
    catch (e) { return rel; }
  }

  /* ------------------------------------------------------------
     DOM
     ------------------------------------------------------------ */
  function buildDom() {
    var app = document.getElementById('app');
    if (!app || document.getElementById('gesture-dock')) return;
    var dock = document.createElement('section');
    dock.id = 'gesture-dock';
    dock.className = 'gesture-dock';
    dock.setAttribute('aria-label', '摄像头手势控制面板');
    dock.setAttribute('aria-hidden', 'true');
    dock.innerHTML = [
      '<div class="gesture-dock__head">',
      '  <div class="gesture-live"><i class="gesture-live__dot"></i><span>GESTURE / CAMERA</span></div>',
      '  <button type="button" class="gesture-iconbtn" id="gesture-close" aria-label="退出手势模式">',
      '    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 5l10 10M15 5L5 15"/></svg>',
      '  </button>',
      '</div>',
      '<div class="gesture-view">',
      '  <video id="gesture-video" playsinline muted autoplay></video>',
      '  <canvas id="gesture-overlay"></canvas>',
      '  <div class="gesture-view__empty" id="gesture-empty"><span class="gesture-view__ring"></span><span>等待摄像头画面</span></div>',
      '  <div class="gesture-badge" id="gesture-badge">STANDBY</div>',
      '  <div class="gesture-view__scan" aria-hidden="true"></div>',
      '</div>',
      '<div class="gesture-dock__body">',
      '  <div class="gesture-status" id="gesture-status">点击顶部「手势控制」启动相机</div>',
      '  <div class="gesture-guide">',
      '    <div class="gesture-guide__item"><b>移动手掌</b><span>移动手势光标</span></div>',
      '    <div class="gesture-guide__item"><b>捏合</b><span>抓住部件</span></div>',
      '    <div class="gesture-guide__item"><b>上下拉动</b><span>拆出 / 推回</span></div>',
      '    <div class="gesture-guide__item"><b>捏合中框</b><span>全部拆解 / 组装</span></div>',
      '  </div>',
      '  <div class="gesture-actions">',
      '    <button type="button" class="gesture-btn gesture-btn--ghost" id="gesture-retry" hidden>重试</button>',
      '    <button type="button" class="gesture-btn" id="gesture-exit">退出手势模式</button>',
      '  </div>',
      '  <p class="gesture-privacy">画面仅在本地识别，不会上传。</p>',
      '</div>'
    ].join('');
    app.appendChild(dock);

    var cursor = document.createElement('div');
    cursor.id = 'gesture-cursor';
    cursor.className = 'gesture-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = '<span class="gesture-cursor__ring"></span><span class="gesture-cursor__dot"></span><span class="gesture-cursor__label"></span>';
    app.appendChild(cursor);

    dom.dock = dock;
    // Query within the freshly created subtrees: this avoids any page-level
    // ID clobbering and works even if another script is mid-mount.
    dom.video = dock.querySelector('video');
    dom.overlay = dock.querySelector('canvas');
    dom.empty = dock.querySelector('#gesture-empty');
    dom.badge = dock.querySelector('#gesture-badge');
    dom.status = dock.querySelector('#gesture-status');
    dom.retry = dock.querySelector('#gesture-retry');
    dom.exit = dock.querySelector('#gesture-exit');
    dom.close = dock.querySelector('#gesture-close');
    dom.cursor = cursor;
    dom.cursorLabel = cursor.querySelector('.gesture-cursor__label');
    if (!dom.video || !dom.overlay || !dom.status || !dom.exit) {
      throw new Error('手势面板 DOM 初始化不完整');
    }
    dom.ctx = dom.overlay.getContext('2d');

    dom.close.addEventListener('click', disable);
    dom.exit.addEventListener('click', disable);
    dom.retry.addEventListener('click', function () { enable(); });

    var video = dom.video;
    video.addEventListener('loadedmetadata', function () {
      dom.overlay.width = video.videoWidth || 640;
      dom.overlay.height = video.videoHeight || 480;
    });
    video.addEventListener('playing', function () { hideEmpty(); });
  }

  function installTopButton() {
    var actions = document.querySelector('#ui-root .a4-actions');
    if (!actions || document.getElementById('a4-gesture-btn')) return !!document.getElementById('a4-gesture-btn');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'a4-gesture-btn';
    btn.className = 'a4-tbtn';
    btn.setAttribute('aria-pressed', 'false');
    btn.title = '手势控制 · 摄像头识别 (G)';
    btn.setAttribute('aria-label', '启用手势控制');
    btn.innerHTML = [
      '<svg class="a4-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
      '  <path d="M6.2 9.2V5.1a1.05 1.05 0 012.1 0v3.6"/>',
      '  <path d="M8.3 8.7V4.2a1.05 1.05 0 012.1 0v4.5"/>',
      '  <path d="M10.4 8.7V4.8a1.05 1.05 0 012.1 0v4.7"/>',
      '  <path d="M12.5 9.3V6.6a1.05 1.05 0 012.1 0v5.2c0 2.8-1.9 4.8-4.7 4.8h-1.1c-1.9 0-3.1-.9-4.1-2.5L3.5 11.2a1.1 1.1 0 011.8-1.2l1.1 1.6"/>',
      '</svg>',
      '<span class="a4-tbtn-label">手势控制</span>'
    ].join('');
    btn.addEventListener('click', function () {
      if (state.busy) return;
      if (state.active) disable();
      else enable();
    });
    actions.insertBefore(btn, actions.firstChild);
    state.button = btn;
    return true;
  }

  function waitForUI() {
    if (installTopButton()) return;
    var tries = 0;
    var timer = window.setInterval(function () {
      tries++;
      if (installTopButton() || tries > 80) window.clearInterval(timer);
    }, 250);
  }

  /* ------------------------------------------------------------
     UI state helpers
     ------------------------------------------------------------ */
  function openDock() {
    if (!dom.dock) return;
    dom.dock.classList.add('is-open');
    dom.dock.setAttribute('aria-hidden', 'false');
  }
  function closeDock() {
    if (!dom.dock) return;
    dom.dock.classList.remove('is-open');
    dom.dock.setAttribute('aria-hidden', 'true');
  }
  function setStatus(text, tone) {
    if (!dom.status) return;
    if (text === state.lastStatus) return;
    state.lastStatus = text;
    dom.status.textContent = text;
    dom.status.setAttribute('data-tone', tone || '');
  }
  function setBadge(text, tone) {
    if (!dom.badge) return;
    if (text === state.lastBadge) return;
    state.lastBadge = text;
    dom.badge.textContent = text;
    dom.badge.setAttribute('data-tone', tone || '');
  }
  function setButton(active) {
    if (state.button) {
      state.button.setAttribute('aria-pressed', active ? 'true' : 'false');
      state.button.setAttribute('aria-label', active ? '关闭手势控制' : '启用手势控制');
    }
    document.body.classList.toggle('gesture-active', !!active);
  }
  function showEmpty(message) {
    if (!dom.empty) return;
    dom.empty.classList.remove('is-hidden');
    var span = dom.empty.querySelector('span:last-child');
    if (span) span.textContent = message || '等待摄像头画面';
  }
  function hideEmpty() {
    if (dom.empty) dom.empty.classList.add('is-hidden');
  }
  function showCursor(x, y) {
    if (!dom.cursor) return;
    dom.cursor.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
    if (!state.cursorVisible) {
      state.cursorVisible = true;
      dom.cursor.classList.add('is-visible');
    }
  }
  function hideCursor() {
    if (!dom.cursor) return;
    state.cursorVisible = false;
    dom.cursor.classList.remove('is-visible', 'is-over', 'is-pinching', 'is-grabbing');
  }
  function cursorLabel(text) {
    if (dom.cursorLabel) dom.cursorLabel.textContent = text || '';
  }
  function markCursor(cls, on) {
    if (dom.cursor) dom.cursor.classList.toggle(cls, !!on);
  }
  function setError(err) {
    state.error = err ? String(err.message || err) : null;
    setStatus(state.error ? ('无法启动手势 · ' + state.error) : '', state.error ? 'error' : '');
    if (dom.retry) dom.retry.hidden = !state.error;
    setBadge('ERROR', 'error');
    if (dom.empty) showEmpty(state.error || '摄像头未就绪');
  }

  /* ------------------------------------------------------------
     MediaPipe / camera
     ------------------------------------------------------------ */
  async function ensureLandmarker() {
    if (state.landmarker) return state.landmarker;
    if (location.protocol === 'file:') {
      throw new Error('手势识别需要通过 HTTPS 打开（请使用在线演示或本地 HTTP 服务）');
    }
    if (!window.isSecureContext) {
      throw new Error('当前页面不是安全上下文，请使用 HTTPS');
    }
    setStatus('正在加载手势识别模型…', 'busy');
    if (!state.vision) {
      state.vision = await import(safeUrl(MP.bundle));
    }
    var fileset = await state.vision.FilesetResolver.forVisionTasks(safeUrl(MP.wasm));
    var options = {
      baseOptions: {
        modelAssetPath: safeUrl(MP.model),
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55
    };
    try {
      state.landmarker = await state.vision.HandLandmarker.createFromOptions(fileset, options);
    } catch (gpuErr) {
      options.baseOptions.delegate = 'CPU';
      state.landmarker = await state.vision.HandLandmarker.createFromOptions(fileset, options);
    }
    state.ready = true;
    return state.landmarker;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头');
    }
    setStatus('请求摄像头权限…', 'busy');
    var stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
    state.stream = stream;
    dom.video.srcObject = stream;
    await dom.video.play();
    return stream;
  }

  async function enable() {
    if (state.busy) return;
    if (state.active) return;
    if (!APP()) {
      setStatus('3D 场景尚未就绪，请稍后再试', 'error');
      return;
    }
    state.busy = true;
    state.error = null;
    state.detectFailing = false;
    var token = ++state.token;
    openDock();
    showEmpty('正在等待摄像头授权');
    setBadge('STARTING', 'busy');
    setStatus('正在启动摄像头与手势模型…', 'busy');
    if (dom.retry) dom.retry.hidden = true;
    try {
      if (location.protocol === 'file:') {
        throw new Error('手势识别需要通过 HTTPS 打开（请使用在线演示或本地 HTTP 服务）');
      }
      await startCamera();
      if (token !== state.token) { stopStream(); return; }
      await ensureLandmarker();
      if (token !== state.token) { stopStream(); return; }
      state.active = true;
      state.busy = false;
      APP().setGestureActive(true);
      setButton(true);
      hideEmpty();
      setBadge('NO HAND', 'idle');
      setStatus('举起手掌，移动光标对准部件', 'ready');
      startLoop();
      if (state.button) state.button.focus({ preventScroll: true });
    } catch (err) {
      console.error('[gesture]', err);
      state.busy = false;
      state.active = false;
      setButton(false);
      APP().setGestureActive(false);
      setError(err && err.message ? err.message : err);
      stopStream();
    }
  }

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      state.stream = null;
    }
    if (dom.video) {
      try { dom.video.pause(); } catch (e) {}
      dom.video.srcObject = null;
    }
  }

  function disable() {
    state.token++;
    state.active = false;
    state.busy = false;
    state.error = null;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    stopStream();
    if (state.grab) {
      try { APP().endGrab(state.grab.id, state.grab.progress || 0); } catch (e) {}
      state.grab = null;
    }
    state.pinching = false;
    state.globalPinch = false;
    state.smooth = null;
    hideCursor();
    if (APP()) {
      APP().clearHover();
      APP().setGestureActive(false);
    }
    setButton(false);
    closeDock();
    setBadge('STANDBY', 'idle');
    setStatus('点击顶部「手势控制」启动相机');
    clearOverlay();
    if (state.button) state.button.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------
     Detection loop
     ------------------------------------------------------------ */
  function startLoop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.lastVideoTime = -1;
    state.lastDetect = 0;
    state.missing = 0;
    state.raf = requestAnimationFrame(loop);
  }

  async function loop(now) {
    if (!state.active) return;
    state.raf = requestAnimationFrame(loop);
    var video = dom.video;
    if (!video || video.readyState < 2 || !state.landmarker) return;
    if (video.currentTime === state.lastVideoTime) return;
    if (now - state.lastDetect < 33) return;
    state.lastVideoTime = video.currentTime;
    state.lastDetect = now;
    try {
      var result = state.landmarker.detectForVideo(video, now);
      if (result && typeof result.then === 'function') result = await result;
      if (!state.active) return;
      handleResult(result, now);
    } catch (err) {
      if (!state.detectFailing) {
        state.detectFailing = true;
        console.error('[gesture] detection failed:', err);
        setStatus('手部识别暂时中断，请调整光线或重新举起手', 'error');
      }
    }
  }

  function clearOverlay() {
    if (!dom.ctx || !dom.overlay) return;
    dom.ctx.clearRect(0, 0, dom.overlay.width, dom.overlay.height);
  }

  function drawHand(hand, pinching) {
    if (!dom.ctx || !dom.overlay) return;
    var w = dom.overlay.width, h = dom.overlay.height;
    dom.ctx.clearRect(0, 0, w, h);
    if (!hand) return;
    function pt(i) {
      var p = hand[i];
      return { x: (1 - p.x) * w, y: p.y * h };
    }
    var i, a, b;
    dom.ctx.lineCap = 'round';
    dom.ctx.lineJoin = 'round';
    dom.ctx.strokeStyle = 'rgba(95,232,255,0.75)';
    dom.ctx.lineWidth = Math.max(1.5, w / 220);
    for (i = 0; i < HAND_CONNECTIONS.length; i++) {
      a = pt(HAND_CONNECTIONS[i][0]);
      b = pt(HAND_CONNECTIONS[i][1]);
      dom.ctx.beginPath();
      dom.ctx.moveTo(a.x, a.y);
      dom.ctx.lineTo(b.x, b.y);
      dom.ctx.stroke();
    }
    for (i = 0; i < hand.length; i++) {
      var q = pt(i);
      dom.ctx.beginPath();
      dom.ctx.arc(q.x, q.y, Math.max(1.6, w / 210), 0, Math.PI * 2);
      dom.ctx.fillStyle = i === 4 || i === 8 ? (pinching ? '#ffb44a' : '#ffffff') : 'rgba(140,246,255,0.9)';
      dom.ctx.fill();
    }
    if (pinching) {
      var p4 = pt(4), p8 = pt(8);
      dom.ctx.strokeStyle = '#ffb44a';
      dom.ctx.lineWidth = Math.max(2, w / 160);
      dom.ctx.beginPath();
      dom.ctx.moveTo(p4.x, p4.y);
      dom.ctx.lineTo(p8.x, p8.y);
      dom.ctx.stroke();
    }
  }

  function handleResult(result, now) {
    var hand = result && result.landmarks && result.landmarks[0];
    if (!hand || hand.length < 21) {
      state.missing++;
      clearOverlay();
      if (state.missing === 2) {
        setBadge('NO HAND', 'idle');
        setStatus('举起手掌，移动光标对准部件', 'ready');
      }
      if (state.grab && state.missing > 18) releaseGrab(true);
      if (state.missing > 8) {
        state.smooth = null;
        hideCursor();
        if (APP()) APP().clearHover();
        if (state.button) state.button.classList.remove('is-hand');
      }
      return;
    }
    state.missing = 0;
    setBadge(state.pinching ? 'PINCH' : 'HAND', state.pinching ? 'accent' : 'ready');
    drawHand(hand, state.pinching);

    var palm = palmCenter(hand);
    var raw = { x: 1 - palm.x, y: palm.y };
    if (!state.smooth) state.smooth = { x: raw.x, y: raw.y };
    var smoothAmount = state.grab ? 0.28 : 0.38;
    state.smooth.x += (raw.x - state.smooth.x) * smoothAmount;
    state.smooth.y += (raw.y - state.smooth.y) * smoothAmount;

    var vp = APP().getSafeViewport();
    var cursorX = vp.left + clamp((state.smooth.x - 0.16) / 0.68, 0, 1) * (vp.right - vp.left);
    var cursorY = vp.top + clamp((state.smooth.y - 0.10) / 0.80, 0, 1) * (vp.bottom - vp.top);
    showCursor(cursorX, cursorY);

    var handScale = dist(hand[0], hand[9]) || 0.12;
    var pinchRatio = dist(hand[4], hand[8]) / handScale;
    state.pinchRatio = pinchRatio;
    if (!state.pinching && pinchRatio < 0.34) {
      state.pinchFrames++;
      if (state.pinchFrames >= 2) beginPinch(cursorX, cursorY, now);
    } else {
      state.pinchFrames = 0;
    }
    if (state.pinching) {
      if (pinchRatio > 0.46) {
        state.releaseFrames++;
        if (state.releaseFrames >= 2) endPinch();
      } else {
        state.releaseFrames = 0;
      }
    }

    if (!state.pinching) {
      if (!state.grab && now >= state.cooldownUntil && now >= state.nextHoverAt) {
        state.nextHoverAt = now + 85;
        var hit = APP().pickAt(cursorX, cursorY);
        state.hoverId = hit ? hit.id : null;
        markCursor('is-over', !!hit);
        if (hit) {
          cursorLabel(hit.no + ' · ' + hit.name + '  /  捏合' + (hit.detached ? '复位' : '拆解'));
          setStatus('已锁定 ' + hit.no + ' ' + hit.name + ' · 捏合抓取', 'ready');
        } else {
          cursorLabel('移动手掌 · 对准部件');
          setStatus('移动手掌 · 对准部件后捏合', 'ready');
        }
      }
    } else if (state.grab) {
      var vertical = (state.grab.startY - cursorY) / ((vp.bottom - vp.top) * 0.38);
      var p = clamp(state.grab.startProgress + vertical, 0, 1);
      state.grab.progress = p;
      APP().setGrabProgress(state.grab.id, p);
      markCursor('is-grabbing', true);
      markCursor('is-pinching', true);
      cursorLabel(state.grab.name + '  ' + Math.round(p * 100) + '%  · 上下拉动');
      setStatus('正在' + (p > state.grab.startProgress ? '拆出' : '推回') + ' ' + state.grab.name + ' · ' + Math.round(p * 100) + '%', 'accent');
    } else if (state.globalPinch) {
      markCursor('is-pinching', true);
      cursorLabel('整机 · 全部拆解 / 组装');
    } else {
      markCursor('is-pinching', true);
      cursorLabel('捏合对准部件');
    }

    if (state.button) state.button.classList.toggle('is-hand', true);
  }

  function palmCenter(hand) {
    var ids = [0, 5, 9, 13, 17];
    var x = 0, y = 0;
    for (var i = 0; i < ids.length; i++) {
      x += hand[ids[i]].x;
      y += hand[ids[i]].y;
    }
    return { x: x / ids.length, y: y / ids.length };
  }

  function beginPinch(cursorX, cursorY, now) {
    state.pinching = true;
    state.releaseFrames = 0;
    markCursor('is-pinching', true);
    if (now < state.cooldownUntil) return;
    var hit = APP().pickAt(cursorX, cursorY);
    if (!hit) {
      state.grab = null;
      state.globalPinch = false;
      setStatus('先移动手掌对准一个部件，再捏合', 'ready');
      cursorLabel('请对准部件');
      return;
    }
    if (hit.core) {
      state.globalPinch = true;
      state.grab = null;
      APP().toggleAll();
      state.cooldownUntil = now + 1000;
      setStatus('机身中框 · 全部拆解 / 组装切换', 'accent');
      cursorLabel('机身中框 · 全部切换');
      return;
    }
    var info = APP().beginGrab(hit.id);
    if (!info || info.global) {
      state.globalPinch = true;
      state.grab = null;
      state.cooldownUntil = now + 1000;
      return;
    }
    state.globalPinch = false;
    state.grab = {
      id: info.id,
      name: info.name,
      startY: cursorY,
      startProgress: info.progress,
      progress: info.progress
    };
    setStatus('已抓住 ' + info.name + ' · 上下拉动手掌', 'accent');
    cursorLabel(info.name + ' · 抓住');
    markCursor('is-grabbing', true);
  }

  function endPinch() {
    state.pinching = false;
    state.pinchFrames = 0;
    state.releaseFrames = 0;
    markCursor('is-pinching', false);
    markCursor('is-grabbing', false);
    if (state.grab) releaseGrab(false);
    state.globalPinch = false;
  }

  function releaseGrab(silent) {
    if (!state.grab) return;
    var g = state.grab;
    state.grab = null;
    markCursor('is-grabbing', false);
    if (APP()) {
      var target = APP().endGrab(g.id, g.progress || 0);
      if (!silent) {
        setStatus(target ? ('已拆解 ' + g.name) : ('已复位 ' + g.name), 'ready');
      }
    }
    state.cooldownUntil = performance.now() + 400;
  }

  /* ------------------------------------------------------------
     Keyboard / lifecycle
     ------------------------------------------------------------ */
  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'g' || e.key === 'G') {
      if (state.busy) return;
      e.preventDefault();
      if (state.active) disable(); else enable();
    }
  }

  function init() {
    buildDom();
    waitForUI();
    document.addEventListener('a4:ui-ready', installTopButton);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('pagehide', function () {
      if (state.stream) state.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    });
    window.Action4Gesture = {
      version: '1.0',
      enable: enable,
      disable: disable,
      isActive: function () { return state.active; },
      getState: function () {
        return {
          active: state.active,
          busy: state.busy,
          ready: state.ready,
          error: state.error,
          pinching: state.pinching,
          grabbing: state.grab ? state.grab.id : null,
          hoverId: state.hoverId,
          pinchRatio: state.pinchRatio == null ? null : +state.pinchRatio.toFixed(3),
          handVisible: state.missing === 0 && !!state.smooth,
          cursorVisible: state.cursorVisible
        };
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
