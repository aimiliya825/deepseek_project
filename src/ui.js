/* ============================================================
   DJI Osmo Action 4 — TEARDOWN LAB / 01
   src/ui.js — window.Action4UI HUD overlay controller

   Classic script. No modules, no external assets, no Three.js.
   Renders all overlay DOM inside the Lead-provided <div id="ui-root">.
   The 3D canvas stays clickable: #ui-root / .a4-ui are pointer-events:none,
   only real panels / buttons opt back in to pointer-events:auto.
   ============================================================ */
(function (window, document) {
  'use strict';

  var VERSION = '1.0.0';
  var HINT_DELAY = 750;          // first-run hint appears after this
  var HINT_LIFETIME = 10000;     // ... or auto-dismisses after ~10s
  var TOAST_LIFETIME = 2600;
  var MAX_TOASTS = 3;
  var MOBILE_QUERY = '(max-width: 900px)';
  var FALLBACK_ACCENT = '#5fe8ff';

  /* ---------------------------------------------------------- */
  /* small helpers                                              */
  /* ---------------------------------------------------------- */

  function pad2(n) {
    n = Number(n) || 0;
    return n < 10 ? '0' + n : String(n);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return '&#39;';
    });
  }

  function isFn(v) { return typeof v === 'function'; }

  function safeCall(fn, a, b) {
    if (!isFn(fn)) return undefined;
    try {
      return fn(a, b);
    } catch (err) {
      if (window.console && window.console.warn) {
        window.console.warn('[Action4UI] callback threw:', err);
      }
      return undefined;
    }
  }

  function clamp(v, min, max) {
    v = Number(v);
    if (!isFinite(v)) v = min;
    return v < min ? min : (v > max ? max : v);
  }

  function safeColor(c) {
    return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim())) ? c.trim() : FALLBACK_ACCENT;
  }

  function splitHero(value) {
    var s = String(value == null ? '' : value).trim();
    var m = s.match(/^([0-9][0-9.,/]*)([^\d.,/].*)$/);
    if (m && m[1] && m[2]) return { num: m[1], unit: m[2].trim() };
    return { num: s, unit: '' };
  }

  function splitCategory(cat) {
    var s = String(cat == null ? '' : cat).trim();
    if (!s) return { cn: '', en: '' };
    var i = s.indexOf('/');
    if (i === -1) return { cn: s, en: '' };
    return { cn: s.slice(0, i).trim(), en: s.slice(i + 1).trim() };
  }

  function closestAttr(node, attr) {
    while (node && node !== document) {
      if (node.getAttribute && node.hasAttribute && node.hasAttribute(attr)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (err) {
      return false;
    }
  }

  /* ---------------------------------------------------------- */
  /* inline SVG icons (no external assets)                      */
  /* ---------------------------------------------------------- */

  var ICONS = {
    autorotate: '<path d="M16 8.4A6.1 6.1 0 1 1 15.1 5"/><path d="M16.1 2.9v4.3h-4.3"/>',
    reset: '<circle cx="10" cy="10" r="5.3"/><path d="M10 2.2v3M10 14.8v3M2.2 10h3M14.8 10h3"/><circle cx="10" cy="10" r="1.15" fill="currentColor" stroke="none"/>',
    fullscreen: '<path d="M3.2 7.2V3.2h4M16.8 7.2V3.2h-4M3.2 12.8v4h4M16.8 12.8v4h-4"/>',
    explode: '<rect x="7" y="7" width="6" height="6" rx=".4"/><path d="M8.4 8.4 3.6 3.6M11.6 8.4l4.8-4.8M8.4 11.6l-4.8 4.8M11.6 11.6l4.8 4.8"/><path d="M3.6 6.8V3.6h3.2M16.4 6.8V3.6h-3.2M3.6 13.2v3.2h3.2M16.4 13.2v3.2h-3.2"/>',
    assemble: '<rect x="7" y="7" width="6" height="6" rx=".4"/><path d="M3.6 3.6 8.4 8.4M16.4 3.6 11.6 8.4M3.6 16.4 8.4 11.6M16.4 16.4 11.6 11.6"/><path d="M6 8.4h2.4V6M14 8.4h-2.4V6M6 11.6h2.4v2.4M14 11.6h-2.4v2.4"/>',
    focus: '<path d="M3.2 7V3.2H7M13 3.2h3.8V7M16.8 13v3.8H13M7 16.8H3.2V13"/><circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none"/>',
    close: '<path d="M5.2 5.2l9.6 9.6M14.8 5.2l-9.6 9.6"/>',
    chevron: '<path d="M5.2 7.8 10 12.6l4.8-4.8"/>'
  };

  function svgIcon(name) {
    var body = ICONS[name] || ICONS.focus;
    return '<svg class="a4-ico" viewBox="0 0 20 20" width="16" height="16" fill="none" ' +
      'stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  function setIcon(el, name) {
    if (el) el.innerHTML = svgIcon(name);
  }

  /* ---------------------------------------------------------- */
  /* factory                                                    */
  /* ---------------------------------------------------------- */

  function create(options) {
    options = options || {};

    /* ---- data (defensive: fall back to globals / defaults) ---- */
    var parts = Array.isArray(options.parts) ? options.parts.slice() : [];
    if (!parts.length && Array.isArray(window.ACTION4_PARTS)) parts = window.ACTION4_PARTS.slice();
    var meta = options.meta;
    if (!meta || typeof meta !== 'object' || !meta.product) {
      meta = (window.ACTION4_META && typeof window.ACTION4_META === 'object') ? window.ACTION4_META : (meta || {});
    }
    var cb = options.callbacks || {};

    var partMap = {};
    for (var pi = 0; pi < parts.length; pi++) {
      var pp = parts[pi];
      if (pp && typeof pp.id === 'string' && !partMap[pp.id]) partMap[pp.id] = pp;
    }

    /* core parts (the chassis datum) never detach — app.js counts progress over
       the remaining parts, so the HUD meter uses the same denominator. */
    var detachableIds = [];
    for (var cj = 0; cj < parts.length; cj++) {
      if (parts[cj] && !parts[cj].core) detachableIds.push(parts[cj].id);
    }
    if (!detachableIds.length) {
      for (var ck = 0; ck < parts.length; ck++) if (parts[ck]) detachableIds.push(parts[ck].id);
    }
    function detachableTotal() { return detachableIds.length || 1; }

    /* ---- state ---- */
    var state = {
      mounted: false,
      host: null,
      ui: null,
      selectedId: null,
      detached: {},
      allDetached: false,
      autoRotate: false,
      busy: false,
      ready: false,
      progress: { done: 0, total: detachableTotal(), managed: false },
      conn: '',
      connSet: false,
      hintVisible: false,
      hintDismissed: false,
      mobileSheet: null,
      isMobile: false,
      pointerHoverId: null,
      focusedId: null,
      appHoverId: null,
      hoverSent: null,
      reduced: prefersReducedMotion(),
      toastQueue: []
    };
    for (var di = 0; di < parts.length; di++) state.detached[parts[di].id] = false;

    /* refs are pre-initialised so every API method is safe to call before mount */
    var refs = { rows: [], rowById: {}, segs: [], sheetGrips: [] };
    var bound = [];
    var timers = { hintShow: null, hintAuto: null };

    /* ---- tiny DOM helpers ---- */
    function q(sel) { return state.ui ? state.ui.querySelector(sel) : null; }
    function qa(sel) { return state.ui ? Array.prototype.slice.call(state.ui.querySelectorAll(sel)) : []; }
    function bind(el, type, fn, opts) {
      if (!el || !el.addEventListener) return;
      el.addEventListener(type, fn, opts);
      bound.push({ el: el, type: type, fn: fn, opts: opts });
    }
    function unbindAll() {
      for (var i = 0; i < bound.length; i++) {
        try { bound[i].el.removeEventListener(bound[i].type, bound[i].fn, bound[i].opts); } catch (err) { /* noop */ }
      }
      bound.length = 0;
    }
    function focusEl(el) {
      if (!el || !el.focus) return;
      try { el.focus({ preventScroll: true }); } catch (err) {
        try { el.focus(); } catch (err2) { /* noop */ }
      }
    }

    function detachedCount() {
      var n = 0;
      for (var i = 0; i < detachableIds.length; i++) if (state.detached[detachableIds[i]]) n++;
      return n;
    }

    function currentPart() {
      return state.selectedId ? (partMap[state.selectedId] || null) : null;
    }

    function isPartDetached(id) { return !!(id && state.detached[id]); }

    /* ---------------------------------------------------------- */
    /* markup                                                     */
    /* ---------------------------------------------------------- */

    function buildPartRows() {
      var out = '';
      if (!parts.length) {
        return '<li class="a4-empty-row" role="presentation">STRUCTURE DATA PENDING</li>';
      }
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        var accent = safeColor(p.accent);
        out += '<li class="a4-part-item" role="presentation">' +
          '<button type="button" class="a4-part-row" role="option" aria-selected="false" tabindex="-1" ' +
          'data-part-id="' + esc(p.id) + '" style="--part:' + esc(accent) + '" ' +
          'title="' + esc((p.name || p.id) + ' · ' + (p.en || '')) + '">' +
          '<span class="a4-row-idx" aria-hidden="true">' + esc(p.no || pad2(i + 1)) + '</span>' +
          '<span class="a4-row-main">' +
          '<span class="a4-row-name">' + esc(p.name || p.id) + '</span>' +
          '<span class="a4-row-en">' + esc(String(p.en || '').toUpperCase()) + '</span>' +
          '</span>' +
          '<span class="a4-row-meta"><span class="a4-row-led" aria-hidden="true"></span></span>' +
          '</button></li>';
      }
      return out;
    }

    function buildHeadlineCells() {
      var list = Array.isArray(meta.headline) ? meta.headline : [];
      var out = '';
      for (var i = 1; i < list.length && i < 4; i++) {
        var it = list[i] || {};
        out += '<div class="a4-headline-cell"><b>' + esc(it.value) + '</b><span>' + esc(it.label) + '</span></div>';
      }
      return out;
    }

    function buildQuickSpecs() {
      var list = Array.isArray(meta.quickSpecs) ? meta.quickSpecs : [];
      var out = '';
      for (var i = 0; i < list.length; i++) {
        var s = list[i] || {};
        out += '<div class="a4-spec-row"><dt>' + esc(s.label) + '</dt><dd>' + esc(s.value) + '</dd></div>';
      }
      return out;
    }

    function buildMarkup() {
      var headline = (Array.isArray(meta.headline) && meta.headline.length) ? meta.headline : [];
      var hero = headline[0] || { label: '影像传感器', value: '1/1.3″', note: 'CMOS' };
      var heroParts = splitHero(hero.value);
      var segs = '';
      for (var si = 0; si < detachableIds.length; si++) segs += '<i class="a4-seg"></i>';
      var totalAll = parts.length || 11;
      var totalDetach = detachableTotal();
      var productCN = meta.productCN || '大疆 Osmo Action 4';
      var tagline = meta.tagline || '运动相机 · 结构拆解实验室';

      var overviewFoot = '';
      if (meta.dimensions || meta.weight) {
        overviewFoot = '<div class="a4-overview-foot">' +
          '<span>' + esc(meta.dimensions || '') + '</span>' +
          '<span>' + esc(meta.weight || '') + '</span>' +
          '</div>';
      }

      return '' +
        /* ---------------- top bar ---------------- */
        '<header class="a4-topbar">' +
          '<div class="a4-brand">' +
            '<div class="a4-brand-mark" aria-hidden="true"></div>' +
            '<div class="a4-brand-copy">' +
              '<div class="a4-brand-kicker">' +
                '<span class="a4-brand-dji">DJI</span>' +
                '<span class="a4-brand-divider" aria-hidden="true"></span>' +
                '<span class="a4-brand-tag">TEARDOWN</span>' +
              '</div>' +
              '<h1 class="a4-brand-name">' +
                '<span class="a4-brand-name-full">OSMO ACTION 4</span>' +
                '<span class="a4-brand-name-short" aria-hidden="true">OSMO A4</span>' +
              '</h1>' +
              '<div class="a4-brand-sub">' +
                '<span class="a4-live-dot" aria-hidden="true"></span>' +
                '<span class="a4-edition">TEARDOWN LAB / 01</span>' +
                '<span class="a4-conn" data-conn>STANDBY</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="a4-actions" role="group" aria-label="视图与拆解控制">' +
            '<button type="button" class="a4-tbtn" data-action="autorotate" aria-pressed="false" title="自动旋转" aria-label="自动旋转">' +
              svgIcon('autorotate') + '<span class="a4-tbtn-label">自动旋转</span>' +
            '</button>' +
            '<button type="button" class="a4-tbtn" data-action="reset" title="重置视角 (R)" aria-label="重置视角">' +
              svgIcon('reset') + '<span class="a4-tbtn-label">重置视角</span>' +
            '</button>' +
            '<button type="button" class="a4-tbtn" data-action="fullscreen" aria-pressed="false" title="全屏" aria-label="全屏">' +
              svgIcon('fullscreen') + '<span class="a4-tbtn-label">全屏</span>' +
            '</button>' +
            '<button type="button" class="a4-cta" data-action="toggle-all" data-assemble="false" aria-label="全部拆解">' +
              '<span class="a4-cta-ico" data-cta-icon>' + svgIcon('explode') + '</span>' +
              '<span class="a4-cta-label" data-cta-label>全部拆解</span>' +
              '<span class="a4-cta-short" data-cta-short>全拆</span>' +
            '</button>' +
          '</div>' +
        '</header>' +

        /* ---------------- left components panel ---------------- */
        '<aside class="a4-left" aria-label="部件清单">' +
          '<section class="a4-panel a4-panel--left" id="a4-panel-left">' +
            '<button type="button" class="a4-sheet-grip" data-action="close-sheet" aria-label="收起部件清单"></button>' +
            '<div class="a4-panel-head">' +
              '<div class="a4-panel-title">' +
                '<span class="a4-panel-cn">部件清单</span>' +
                '<span class="a4-panel-en">COMPONENTS</span>' +
              '</div>' +
              '<div class="a4-panel-count"><b>' + esc(String(totalAll)) + '</b><span>PARTS</span></div>' +
            '</div>' +
            '<ul class="a4-part-list" role="listbox" aria-label="选择部件">' + buildPartRows() + '</ul>' +
            '<div class="a4-panel-foot">' +
              '<span class="a4-foot-hint">CLICK / ↑↓ 选择</span>' +
              '<span class="a4-foot-meter">' +
                '<span class="a4-segs" aria-hidden="true">' + segs + '</span>' +
                '<span class="a4-foot-count"><b data-detached-count>00</b><i>/</i><span data-detached-total>' + esc(String(totalDetach)) + '</span></span>' +
              '</span>' +
            '</div>' +
          '</section>' +
        '</aside>' +

        /* ---------------- right overview / detail ---------------- */
        '<aside class="a4-right" aria-label="整机概览与部件详情">' +
          '<section class="a4-panel a4-panel--right" id="a4-panel-right">' +
            '<button type="button" class="a4-sheet-grip" data-action="close-sheet" aria-label="收起详情面板"></button>' +

            '<section class="a4-view a4-overview" data-view="overview" aria-labelledby="a4-overview-title">' +
              '<div class="a4-panel-head">' +
                '<div class="a4-panel-title">' +
                  '<span class="a4-panel-cn" id="a4-overview-title">整机概览</span>' +
                  '<span class="a4-panel-en">SYSTEM OVERVIEW</span>' +
                '</div>' +
                '<div class="a4-panel-count a4-panel-count--mono">A4 / 01</div>' +
              '</div>' +
              '<div class="a4-view-body">' +
                '<div class="a4-product-line">' +
                  '<span class="a4-product-cn">' + esc(productCN) + '</span>' +
                  '<span class="a4-product-tag">' + esc(tagline) + '</span>' +
                '</div>' +
                '<div class="a4-hero">' +
                  '<div class="a4-hero-caption">影像核心 / IMAGING CORE</div>' +
                  '<div class="a4-hero-value">' +
                    '<span class="a4-hero-num">' + esc(heroParts.num) + '</span>' +
                    '<span class="a4-hero-unit">' + esc(heroParts.unit) + '</span>' +
                    '<span class="a4-hero-tag">' + esc(hero.note || '') + '</span>' +
                  '</div>' +
                  '<div class="a4-hero-sub">' + esc(hero.label || '影像传感器') + ' · 大底传感器</div>' +
                  '<div class="a4-headline-grid">' + buildHeadlineCells() + '</div>' +
                '</div>' +
                '<div class="a4-section-head"><span>QUICK SPECS</span><em>核心参数</em></div>' +
                '<dl class="a4-spec-list">' + buildQuickSpecs() + '</dl>' +
                '<div class="a4-overview-note"><b>可交互</b><span>全部 ' + esc(String(totalAll)) + ' 个部件均可点击拆解。拖拽旋转视角，滚轮缩放。</span></div>' +
                overviewFoot +
              '</div>' +
            '</section>' +

            '<section class="a4-view a4-detail" data-view="detail" hidden aria-labelledby="a4-detail-name">' +
              '<div class="a4-panel-head a4-detail-head">' +
                '<div class="a4-detail-meta">' +
                  '<span class="a4-detail-no" data-detail-no>00</span>' +
                  '<span class="a4-detail-cat" data-detail-cat>—</span>' +
                '</div>' +
                '<button type="button" class="a4-iconbtn a4-detail-close" data-action="clear-selection" aria-label="返回整机概览" title="返回整机概览">' +
                  svgIcon('close') +
                '</button>' +
              '</div>' +
              '<div class="a4-view-body a4-detail-body">' +
                '<h2 class="a4-detail-name" id="a4-detail-name" data-detail-name>—</h2>' +
                '<p class="a4-detail-en" data-detail-en></p>' +
                '<p class="a4-detail-desc" data-detail-desc></p>' +
                '<div class="a4-section-head"><span>PARAMETERS</span><em>部件参数</em></div>' +
                '<dl class="a4-spec-list a4-spec-list--detail" data-detail-specs></dl>' +
                '<div class="a4-detail-status" data-detail-status>' +
                  '<span class="a4-status-led" aria-hidden="true"></span>' +
                  '<span class="a4-status-text" data-detail-state>已装配</span>' +
                  '<span class="a4-status-sub" data-detail-state-en>ASSEMBLED</span>' +
                '</div>' +
                '<div class="a4-detail-actions">' +
                  '<button type="button" class="a4-btn-primary" data-action="toggle-part" data-detached="false">' +
                    '<span class="a4-btn-ico" data-detail-action-icon>' + svgIcon('explode') + '</span>' +
                    '<span data-detail-action-label>拆解此部件</span>' +
                  '</button>' +
                  '<button type="button" class="a4-btn-ghost" data-action="focus-part" title="定位到该部件的相机视角" aria-label="定位视角">' +
                    svgIcon('focus') + '<span>定位视角</span>' +
                  '</button>' +
                '</div>' +
              '</div>' +
            '</section>' +
          '</section>' +
        '</aside>' +

        /* ---------------- operation guide ---------------- */
        '<div class="a4-guide" role="note" aria-label="操作方式">' +
          '<span class="a4-guide-note">全部部件可点击</span>' +
          '<span class="a4-guide-item">拖拽旋转</span>' +
          '<i class="a4-guide-dot" aria-hidden="true"></i>' +
          '<span class="a4-guide-item">滚轮缩放</span>' +
          '<i class="a4-guide-dot" aria-hidden="true"></i>' +
          '<span class="a4-guide-item">点击部件拆解</span>' +
          '<i class="a4-guide-dot" aria-hidden="true"></i>' +
          '<span class="a4-guide-item"><kbd>SPACE</kbd>全部拆解</span>' +
          '<i class="a4-guide-dot" aria-hidden="true"></i>' +
          '<span class="a4-guide-item"><kbd>R</kbd>重置</span>' +
        '</div>' +

        /* ---------------- telemetry / progress ---------------- */
        '<div class="a4-telemetry" aria-label="渲染信息与拆解进度">' +
          '<div class="a4-tel-head"><span class="a4-tel-title">TELEMETRY</span><span class="a4-tel-ver">LAB / 01</span></div>' +
          '<div class="a4-tel-tags">' +
            '<span class="a4-tel-tag">PBR</span>' +
            '<span class="a4-tel-tag">PROCEDURAL</span>' +
            '<span class="a4-tel-tag a4-tel-tag--hot">THREE.JS</span>' +
          '</div>' +
          '<div class="a4-progress">' +
            '<div class="a4-progress-top">' +
              '<span class="a4-progress-label">拆解进度</span>' +
              '<span class="a4-progress-val"><b data-progress-done>00</b><i>/</i><span data-progress-total>' + esc(String(totalDetach)) + '</span></span>' +
            '</div>' +
            '<div class="a4-progress-track" role="progressbar" aria-label="拆解进度" aria-valuemin="0" aria-valuemax="' + esc(String(totalDetach)) + '" aria-valuenow="0" data-progress-track>' +
              '<span class="a4-progress-fill" data-progress-fill></span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* ---------------- bottom right stamp ---------------- */
        '<div class="a4-stamp" aria-hidden="true">' +
          '<b>DJI OSMO ACTION 4</b>' +
          '<span>1/1.3″ CMOS · 4K/120 · 18M</span>' +
          '<span>70.5 × 44.2 × 32.8 MM / 145 G</span>' +
        '</div>' +

        /* ---------------- first-run hint ---------------- */
        '<div class="a4-hint" role="note" aria-label="首次操作提示" aria-hidden="true">' +
          '<div class="a4-mouse" aria-hidden="true">' +
            '<span class="a4-mouse-btn"></span>' +
            '<span class="a4-mouse-wheel"></span>' +
          '</div>' +
          '<div class="a4-hint-copy">' +
            '<div class="a4-hint-kicker">QUICK START / 01</div>' +
            '<div class="a4-hint-title">开始探索整机结构</div>' +
            '<p class="a4-hint-text">拖拽旋转 · 滚轮缩放 · <b>点击任一部件</b>即可拆解。按 <kbd>空格</kbd> 全部拆解，<kbd>R</kbd> 复位视角。</p>' +
          '</div>' +
          '<button type="button" class="a4-hint-close" data-action="dismiss-hint" aria-label="关闭操作提示">' + svgIcon('close') + '</button>' +
        '</div>' +

        /* ---------------- toasts / busy / mobile tabs ---------------- */
        '<div class="a4-toasts" aria-live="polite" aria-atomic="false" data-toasts></div>' +

        '<div class="a4-busy" data-busy hidden aria-hidden="true">' +
          '<span class="a4-busy-line"></span>' +
          '<div class="a4-busy-chip"><span class="a4-spinner"></span><span>结构联动中 / SYNCING ASSEMBLY</span></div>' +
        '</div>' +

        '<nav class="a4-tabs" aria-label="移动端面板切换">' +
          '<div class="a4-tabs-progress" aria-hidden="true"><i data-progress-mobile></i></div>' +
          '<div class="a4-tabs-bar">' +
            '<button type="button" class="a4-tab" data-sheet="parts" aria-expanded="false" aria-controls="a4-panel-left">' +
              '<span class="a4-tab-label">部件清单</span>' +
              '<span class="a4-tab-badge" data-tab-count>' + esc(String(totalAll)) + '</span>' +
            '</button>' +
            '<button type="button" class="a4-tab" data-sheet="detail" aria-expanded="false" aria-controls="a4-panel-right">' +
              '<span class="a4-tab-label" data-tab-detail>整机概览</span>' +
            '</button>' +
          '</div>' +
        '</nav>' +

        '<div class="a4-sr" role="status" aria-live="polite" aria-atomic="true" data-a4-live></div>';
    }

    /* ---------------------------------------------------------- */
    /* mount / cache refs / bind                                  */
    /* ---------------------------------------------------------- */

    function cacheRefs() {
      refs.conn = q('[data-conn]');
      refs.live = q('[data-a4-live]');
      refs.cta = q('[data-action="toggle-all"]');
      refs.ctaIcon = q('[data-cta-icon]');
      refs.ctaLabel = q('[data-cta-label]');
      refs.ctaShort = q('[data-cta-short]');
      refs.autoBtn = q('[data-action="autorotate"]');
      refs.fullBtn = q('[data-action="fullscreen"]');
      refs.list = q('.a4-part-list');
      refs.rows = qa('.a4-part-row');
      refs.rowById = {};
      for (var ri = 0; ri < refs.rows.length; ri++) {
        refs.rowById[refs.rows[ri].getAttribute('data-part-id')] = refs.rows[ri];
      }
      refs.segs = qa('.a4-seg');
      refs.detachedCount = q('[data-detached-count]');
      refs.detachedTotal = q('[data-detached-total]');
      refs.progressDone = q('[data-progress-done]');
      refs.progressTotal = q('[data-progress-total]');
      refs.progressFill = q('[data-progress-fill]');
      refs.progressMobile = q('[data-progress-mobile]');
      refs.progressTrack = q('[data-progress-track]');
      refs.overview = q('[data-view="overview"]');
      refs.detail = q('[data-view="detail"]');
      refs.detailNo = q('[data-detail-no]');
      refs.detailCat = q('[data-detail-cat]');
      refs.detailName = q('[data-detail-name]');
      refs.detailEn = q('[data-detail-en]');
      refs.detailDesc = q('[data-detail-desc]');
      refs.detailSpecs = q('[data-detail-specs]');
      refs.detailState = q('[data-detail-state]');
      refs.detailStateEn = q('[data-detail-state-en]');
      refs.detailAction = q('[data-action="toggle-part"]');
      refs.detailActionIcon = q('[data-detail-action-icon]');
      refs.detailActionLabel = q('[data-detail-action-label]');
      refs.hint = q('.a4-hint');
      refs.toasts = q('[data-toasts]');
      refs.busy = q('[data-busy]');
      refs.tabParts = q('[data-sheet="parts"]');
      refs.tabDetail = q('[data-sheet="detail"]');
      refs.tabDetailLabel = q('[data-tab-detail]');
      refs.sheetGrips = qa('.a4-sheet-grip');
    }

    function bindEvents() {
      var ui = state.ui;

      /* delegated action clicks (panels, top bar, hint, sheets) */
      bind(ui, 'click', function (ev) {
        var sheetBtn = closestAttr(ev.target, 'data-sheet');
        if (sheetBtn) {
          ev.preventDefault();
          onSheetToggle(sheetBtn.getAttribute('data-sheet'));
          return;
        }
        var actionEl = closestAttr(ev.target, 'data-action');
        if (!actionEl) return;
        ev.preventDefault();
        onAction(actionEl.getAttribute('data-action'));
      });

      /* component rows */
      for (var i = 0; i < refs.rows.length; i++) bindRow(refs.rows[i]);

      /* keyboard navigation inside the component listbox */
      bind(refs.list, 'keydown', function (ev) {
        var rows = refs.rows;
        if (!rows.length) return;
        var active = document.activeElement;
        var idx = -1;
        for (var k = 0; k < rows.length; k++) if (rows[k] === active) { idx = k; break; }
        var next = idx;
        if (ev.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1);
        else if (ev.key === 'ArrowUp') next = idx < 0 ? 0 : Math.max(0, idx - 1);
        else if (ev.key === 'Home') next = 0;
        else if (ev.key === 'End') next = rows.length - 1;
        else return;
        ev.preventDefault();
        if (next >= 0 && next < rows.length) {
          focusRow(next);
          dismissHint();
        }
      });

      /* fullscreen state sync */
      bind(document, 'fullscreenchange', syncFullscreen);
      bind(document, 'webkitfullscreenchange', syncFullscreen);

      /* responsive mode */
      var mq = null;
      try { mq = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null; } catch (err) { mq = null; }
      state.isMobile = mq ? mq.matches : (window.innerWidth <= 900);
      if (mq) {
        var onChange = function () {
          state.isMobile = !!mq.matches;
          if (!state.isMobile) state.mobileSheet = null;
          if (state.ui) state.ui.classList.toggle('is-mobile', state.isMobile);
          renderSheets();
        };
        if (mq.addEventListener) bind(mq, 'change', onChange);
        else if (mq.addListener) bind(mq, 'change', function () { onChange(); });
      }

      /* first pointerdown anywhere dismisses the hint */
      bind(window, 'pointerdown', function () {
        if (!state.hintDismissed) dismissHint();
      }, true);

      /* Escape closes mobile sheets / hint only (global shortcuts belong to app.js) */
      bind(window, 'keydown', function (ev) {
        if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
        if (state.mobileSheet) {
          closeSheet(true);
        } else if (!state.hintDismissed) {
          dismissHint();
        }
      });
    }

    function bindRow(row) {
      var id = row.getAttribute('data-part-id');
      if (!id || !partMap[id]) return;

      bind(row, 'pointerenter', function (ev) {
        if (ev && ev.pointerType === 'touch') return; /* no sticky hover on touch */
        state.pointerHoverId = id;
        updateHover();
      });
      bind(row, 'pointerleave', function (ev) {
        if (ev && ev.pointerType === 'touch') return;
        if (state.pointerHoverId === id) state.pointerHoverId = null;
        updateHover();
      });
      bind(row, 'focus', function () {
        /* mouse/touch clicks also focus the button; only keyboard focus
           should drive the shared 3D hover state. */
        if (!isKeyboardFocus(row)) return;
        state.focusedId = id;
        updateHover();
      });
      bind(row, 'blur', function () {
        if (state.focusedId === id) state.focusedId = null;
        updateHover();
      });
      bind(row, 'click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        onRowActivate(id);
      });
    }

    function isKeyboardFocus(el) {
      try {
        return !el.matches || el.matches(':focus-visible');
      } catch (err) {
        return true;
      }
    }

    /* ---------------------------------------------------------- */
    /* event behaviours                                           */
    /* ---------------------------------------------------------- */

    function onAction(action) {
      if (action === 'dismiss-hint') { dismissHint(); return; }
      if (action === 'close-sheet') { closeSheet(true); return; }
      if (action === 'clear-selection') { clearSelection(); return; }
      if (action === 'toggle-part') { toggleSelectedPart(); return; }
      if (action === 'focus-part') {
        if (state.selectedId) safeCall(cb.onFocusPart, state.selectedId);
        return;
      }
      if (action === 'reset') {
        dismissHint();
        safeCall(cb.onResetView);
        return;
      }
      if (action === 'fullscreen') {
        dismissHint();
        safeCall(cb.onFullscreen);
        return;
      }
      if (action === 'autorotate') {
        dismissHint();
        toggleAutoRotate();
        return;
      }
      if (action === 'toggle-all') {
        dismissHint();
        toggleAll();
      }
    }

    function toggleAutoRotate() {
      state.autoRotate = !state.autoRotate;
      renderAutoRotate();
      safeCall(cb.onToggleAutoRotate, state.autoRotate);
    }

    function toggleAll() {
      if (state.busy || !parts.length) return;
      if (state.allDetached) safeCall(cb.onAssembleAll);
      else safeCall(cb.onExplodeAll);
    }

    function toggleSelectedPart() {
      var id = state.selectedId;
      if (!id || state.busy) return;
      /* app drives the detach animation and confirms through setPartDetached();
         no optimistic flag here so the HUD cannot disagree with the 3D tween. */
      safeCall(cb.onTogglePart, id);
    }

    function onRowActivate(id) {
      if (!partMap[id]) return;
      dismissHint();
      state.selectedId = id;
      state.appHoverId = null;
      renderSelection();
      if (state.isMobile) {
        state.mobileSheet = 'detail';
        renderSheets();
        focusEl(refs.tabDetail);
      }
      safeCall(cb.onFocusPart, id);
    }

    function clearSelection() {
      if (!state.selectedId) return;
      state.selectedId = null;
      renderSelection();
      announce('已返回整机概览');
      if (isFn(cb.onClearSelection)) {
        safeCall(cb.onClearSelection);
      } else {
        /* documented fallback: let app clear its 3D highlight; ignored if app ignores null */
        safeCall(cb.onFocusPart, null);
      }
    }

    function onSheetToggle(name) {
      if (!state.isMobile) return;
      dismissHint();
      setSheet(state.mobileSheet === name ? null : name);
    }

    function setSheet(name) {
      if (!state.isMobile) return;
      state.mobileSheet = name || null;
      renderSheets();
      if (name === 'parts') focusEl(refs.tabParts);
      else if (name === 'detail') focusEl(refs.tabDetail);
    }

    function closeSheet(moveFocus) {
      if (!state.mobileSheet) return;
      var was = state.mobileSheet;
      state.mobileSheet = null;
      renderSheets();
      if (moveFocus) focusEl(was === 'parts' ? refs.tabParts : refs.tabDetail);
    }

    function focusRow(index) {
      var row = refs.rows[index];
      if (!row) return;
      updateRowTabIndex(row);
      focusEl(row);
      scrollRowIntoView(row);
    }

    function scrollRowIntoView(row) {
      var list = refs.list;
      if (!row || !list || !list.getBoundingClientRect) return;
      var lr = list.getBoundingClientRect();
      var rr = row.getBoundingClientRect();
      if (!lr.height) return;
      if (rr.top < lr.top + 2) list.scrollTop -= (lr.top + 2 - rr.top);
      else if (rr.bottom > lr.bottom - 2) list.scrollTop += (rr.bottom - lr.bottom + 2);
    }

    function updateRowTabIndex(activeRow) {
      for (var i = 0; i < refs.rows.length; i++) {
        refs.rows[i].setAttribute('tabindex', refs.rows[i] === activeRow ? '0' : '-1');
      }
    }

    /* ---------------------------------------------------------- */
    /* hover sync                                                 */
    /* ---------------------------------------------------------- */

    function updateHover() {
      var visual = state.focusedId || state.pointerHoverId || state.appHoverId || null;
      for (var i = 0; i < refs.rows.length; i++) {
        var row = refs.rows[i];
        row.classList.toggle('is-hover', row.getAttribute('data-part-id') === visual && row.getAttribute('data-part-id') !== state.selectedId);
      }
      var outgoing = state.focusedId || state.pointerHoverId || null;
      if (outgoing !== state.hoverSent) {
        state.hoverSent = outgoing;
        safeCall(cb.onHoverPart, outgoing);
      }
    }

    /* ---------------------------------------------------------- */
    /* renderers                                                  */
    /* ---------------------------------------------------------- */

    function renderAll() {
      renderConnection();
      renderAutoRotate();
      renderBusy();
      renderDetached();
      renderSelection();
      renderSheets();
      renderProgress();
      if (state.ready && state.ui) state.ui.classList.add('is-ready');
      if (state.isMobile && state.ui) state.ui.classList.add('is-mobile');
    }

    function renderSelection() {
      var id = state.selectedId;
      var part = id ? partMap[id] : null;

      for (var i = 0; i < refs.rows.length; i++) {
        var row = refs.rows[i];
        var isSel = !!part && row.getAttribute('data-part-id') === id;
        row.classList.toggle('is-selected', isSel);
        row.setAttribute('aria-selected', isSel ? 'true' : 'false');
      }
      updateRowTabIndex(part ? (refs.rowById[id] || refs.rows[0]) : refs.rows[0]);

      if (part) fillDetail(part);
      if (refs.overview) refs.overview.hidden = !!part;
      if (refs.detail) refs.detail.hidden = !part;
      if (refs.tabDetailLabel) refs.tabDetailLabel.textContent = part ? '部件详情' : '整机概览';
      if (state.ui) state.ui.setAttribute('data-selected', part ? id : '');

      if (part && refs.rowById[id]) scrollRowIntoView(refs.rowById[id]);
      renderDetailState();
    }

    function fillDetail(part) {
      var accent = safeColor(part.accent);
      var cat = splitCategory(part.category);
      if (refs.detail) refs.detail.style.setProperty('--part', accent);
      if (refs.detailNo) refs.detailNo.textContent = part.no || '—';
      if (refs.detailCat) {
        refs.detailCat.innerHTML = esc(cat.cn) + (cat.en ? '<b> / ' + esc(cat.en) + '</b>' : '');
      }
      if (refs.detailName) refs.detailName.textContent = part.name || part.id;
      if (refs.detailEn) refs.detailEn.textContent = String(part.en || '').toUpperCase();
      if (refs.detailDesc) refs.detailDesc.textContent = part.desc || part.short || '';
      if (refs.detailSpecs) {
        var specs = Array.isArray(part.specs) ? part.specs : [];
        var html = '';
        for (var i = 0; i < specs.length; i++) {
          var s = specs[i] || {};
          html += '<div class="a4-spec-row"><dt>' + esc(s.label) + '</dt><dd>' + esc(s.value) + '</dd></div>';
        }
        refs.detailSpecs.innerHTML = html || '<div class="a4-spec-row"><dt>结构</dt><dd>' + esc(part.short || '—') + '</dd></div>';
      }
    }

    function renderDetailState() {
      var id = state.selectedId;
      var part = id ? partMap[id] : null;
      if (!part) return;
      var detached = !!state.detached[id];
      if (refs.detail) refs.detail.setAttribute('data-detached', detached ? 'true' : 'false');
      if (refs.detailState) refs.detailState.textContent = detached ? '已拆解' : '已装配';
      if (refs.detailStateEn) refs.detailStateEn.textContent = detached ? 'DETACHED' : 'ASSEMBLED';
      if (refs.detailAction) {
        refs.detailAction.setAttribute('data-detached', detached ? 'true' : 'false');
        refs.detailAction.setAttribute('aria-label', detached ? '组装此部件' : '拆解此部件');
        refs.detailAction.disabled = state.busy;
      }
      if (refs.detailActionLabel) refs.detailActionLabel.textContent = detached ? '组装此部件' : '拆解此部件';
      setIcon(refs.detailActionIcon, detached ? 'assemble' : 'explode');
    }

    function renderDetached() {
      var count = detachedCount();
      var total = detachableTotal();
      state.allDetached = total > 0 && count === total;

      for (var i = 0; i < parts.length; i++) {
        var id = parts[i].id;
        var row = refs.rowById[id];
        if (row) row.setAttribute('data-detached', state.detached[id] ? 'true' : 'false');
      }
      for (var s = 0; s < detachableIds.length; s++) {
        if (refs.segs[s]) refs.segs[s].classList.toggle('is-on', !!state.detached[detachableIds[s]]);
      }
      if (refs.detachedCount) refs.detachedCount.textContent = pad2(count);
      if (refs.detachedTotal) refs.detachedTotal.textContent = String(total);

      if (refs.cta) {
        refs.cta.setAttribute('data-assemble', state.allDetached ? 'true' : 'false');
        refs.cta.setAttribute('aria-label', state.allDetached ? '全部组装' : '全部拆解');
        refs.cta.title = state.allDetached ? '全部组装' : '全部拆解（空格）';
        refs.cta.disabled = state.busy || !parts.length;
      }
      if (refs.ctaLabel) refs.ctaLabel.textContent = state.allDetached ? '全部组装' : '全部拆解';
      if (refs.ctaShort) refs.ctaShort.textContent = state.allDetached ? '全装' : '全拆';
      setIcon(refs.ctaIcon, state.allDetached ? 'assemble' : 'explode');

      renderDetailState();

      if (!state.progress.managed) {
        state.progress.done = count;
        state.progress.total = total;
        renderProgress();
      }
    }

    function renderProgress() {
      var total = state.progress.total || detachableTotal();
      var done = clamp(state.progress.done, 0, total);
      var pct = total > 0 ? (done / total) * 100 : 0;
      var pctText = pct.toFixed(2) + '%';
      if (refs.progressFill) refs.progressFill.style.width = pctText;
      if (refs.progressMobile) refs.progressMobile.style.width = pctText;
      if (refs.progressDone) refs.progressDone.textContent = pad2(done);
      if (refs.progressTotal) refs.progressTotal.textContent = String(total);
      if (refs.progressTrack) {
        refs.progressTrack.setAttribute('aria-valuemax', String(total));
        refs.progressTrack.setAttribute('aria-valuenow', String(done));
      }
    }

    function renderAutoRotate() {
      if (refs.autoBtn) {
        refs.autoBtn.setAttribute('aria-pressed', state.autoRotate ? 'true' : 'false');
        refs.autoBtn.title = state.autoRotate ? '关闭自动旋转' : '开启自动旋转';
      }
    }

    function renderBusy() {
      if (refs.busy) refs.busy.hidden = !state.busy;
      if (state.ui) state.ui.classList.toggle('is-busy', state.busy);
      if (refs.cta) refs.cta.disabled = state.busy || !parts.length;
      if (refs.detailAction) refs.detailAction.disabled = state.busy;
    }

    function renderConnection() {
      if (!refs.conn) return;
      refs.conn.textContent = state.connSet ? (state.conn || 'OFFLINE') : 'STANDBY';
      refs.conn.classList.toggle('is-offline', state.connSet && !state.conn);
    }

    function renderSheets() {
      if (!state.ui) return;
      var partsOpen = state.isMobile && state.mobileSheet === 'parts';
      var detailOpen = state.isMobile && state.mobileSheet === 'detail';
      state.ui.classList.toggle('is-sheet-parts', partsOpen);
      state.ui.classList.toggle('is-sheet-detail', detailOpen);
      if (refs.tabParts) refs.tabParts.setAttribute('aria-expanded', partsOpen ? 'true' : 'false');
      if (refs.tabDetail) refs.tabDetail.setAttribute('aria-expanded', detailOpen ? 'true' : 'false');
    }

    function syncFullscreen() {
      if (!refs.fullBtn) return;
      var el = document.fullscreenElement || document.webkitFullscreenElement || null;
      var on = !!el;
      refs.fullBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      refs.fullBtn.title = on ? '退出全屏' : '全屏';
      refs.fullBtn.setAttribute('aria-label', on ? '退出全屏' : '全屏');
    }

    /* ---------------------------------------------------------- */
    /* hint                                                       */
    /* ---------------------------------------------------------- */

    function dismissHint() {
      if (state.hintDismissed) return;
      state.hintDismissed = true;
      state.hintVisible = false;
      if (timers.hintShow) { window.clearTimeout(timers.hintShow); timers.hintShow = null; }
      if (timers.hintAuto) { window.clearTimeout(timers.hintAuto); timers.hintAuto = null; }
      if (refs.hint) {
        refs.hint.classList.remove('is-visible');
        refs.hint.setAttribute('aria-hidden', 'true');
      }
    }

    function showHint() {
      if (state.hintDismissed || state.hintVisible || !refs.hint) return;
      state.hintVisible = true;
      refs.hint.classList.add('is-visible');
      refs.hint.setAttribute('aria-hidden', 'false');
      timers.hintAuto = window.setTimeout(function () { dismissHint(); }, HINT_LIFETIME);
    }

    function startHint() {
      if (state.hintDismissed) return;
      timers.hintShow = window.setTimeout(showHint, state.reduced ? 1400 : HINT_DELAY);
    }

    /* ---------------------------------------------------------- */
    /* toasts / announce                                          */
    /* ---------------------------------------------------------- */

    function announce(message) {
      if (!refs.live) return;
      refs.live.textContent = String(message == null ? '' : message);
    }

    function makeToast(message, tone) {
      var text = String(message == null ? '' : message).trim();
      if (!text) return;
      if (!state.mounted || !refs.toasts) {
        state.toastQueue.push({ text: text, tone: tone });
        if (state.toastQueue.length > MAX_TOASTS) state.toastQueue.shift();
        return;
      }
      var el = document.createElement('div');
      el.className = 'a4-toast' + (tone ? ' a4-toast--' + tone : '');
      el.setAttribute('role', 'status');
      el.textContent = text;
      refs.toasts.appendChild(el);
      while (refs.toasts.children.length > MAX_TOASTS) {
        refs.toasts.removeChild(refs.toasts.firstChild);
      }
      window.setTimeout(function () {
        el.classList.add('is-out');
        window.setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 280);
      }, TOAST_LIFETIME);
    }

    function flushToastQueue() {
      if (!state.toastQueue.length) return;
      var queue = state.toastQueue.slice();
      state.toastQueue.length = 0;
      for (var i = 0; i < queue.length; i++) makeToast(queue[i].text, queue[i].tone);
    }

    /* ---------------------------------------------------------- */
    /* public API implementations                                 */
    /* ---------------------------------------------------------- */

    function setSelected(id, opts) {
      opts = opts || {};
      var next = (id && partMap[id]) ? id : null;
      var prev = state.selectedId;
      if (next && typeof opts.detached === 'boolean') {
        state.detached[next] = !!opts.detached;
        state.allDetached = detachedCount() === detachableTotal();
        if (!state.progress.managed) {
          state.progress.done = detachedCount();
          state.progress.total = detachableTotal();
        }
      }
      state.selectedId = next;
      if (next && typeof opts.detached === 'boolean') renderDetached();
      renderSelection();
      renderProgress();
      if (next && next !== prev) {
        var p = partMap[next];
        announce('已选择 ' + (p ? p.name : next));
      }
    }

    function setHovered(id) {
      state.appHoverId = (id && partMap[id]) ? id : null;
      updateHover();
    }

    function setPartDetached(id, detached) {
      if (!partMap[id]) return;
      state.detached[id] = !!detached;
      renderDetached();
    }

    function setAllDetached(detached) {
      var value = !!detached;
      for (var i = 0; i < parts.length; i++) state.detached[parts[i].id] = value;
      renderDetached();
    }

    function setAutoRotate(on) {
      state.autoRotate = !!on;
      renderAutoRotate();
    }

    function setBusy(busy) {
      state.busy = !!busy;
      renderBusy();
    }

    function setProgress(done, total) {
      var t = Number(total);
      if (!isFinite(t) || t <= 0) t = detachableTotal();
      t = Math.round(t);
      var d = Number(done);
      if (!isFinite(d)) d = 0;
      state.progress.managed = true;
      state.progress.total = t;
      state.progress.done = clamp(Math.round(d), 0, t);
      renderProgress();
    }

    function setConnectionState(label) {
      state.connSet = true;
      state.conn = label == null ? '' : String(label);
      renderConnection();
    }

    function toast(message, tone) {
      var safeTone = (tone === 'amber' || tone === 'red' || tone === 'cyan') ? tone : '';
      makeToast(message, safeTone);
    }

    function ready() {
      state.ready = true;
      if (state.ui) {
        state.ui.classList.add('is-ready');
        state.ui.classList.remove('is-booting');
      }
      if (!state.connSet) {
        state.connSet = true;
        state.conn = 'SCENE ONLINE';
        renderConnection();
      }
    }

    function destroy() {
      dismissHint();
      if (timers.hintShow) window.clearTimeout(timers.hintShow);
      if (timers.hintAuto) window.clearTimeout(timers.hintAuto);
      unbindAll();
      if (state.ui && state.ui.parentNode) state.ui.parentNode.removeChild(state.ui);
      state.mounted = false;
      state.ui = null;
    }

    /* ---------------------------------------------------------- */
    /* mount                                                      */
    /* ---------------------------------------------------------- */

    function mount() {
      if (state.mounted) return true;
      var host = document.getElementById('ui-root');
      if (!host) return false;
      state.host = host;
      var ui = document.createElement('div');
      ui.className = 'a4-ui';
      ui.setAttribute('data-a4-ui', VERSION);
      ui.innerHTML = buildMarkup();
      host.appendChild(ui);
      state.ui = ui;
      state.mounted = true;
      cacheRefs();
      bindEvents();
      if (state.isMobile) ui.classList.add('is-mobile');
      renderAll();
      startHint();
      flushToastQueue();
      return true;
    }

    function ensureMount() {
      if (state.mounted) return;
      if (!mount()) {
        var attempts = 0;
        var retry = function () {
          if (state.mounted) return;
          attempts++;
          if (mount()) return;
          if (attempts > 24) return;
          window.setTimeout(retry, attempts < 8 ? 60 : 200);
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () { retry(); }, { once: true });
        } else {
          window.setTimeout(retry, 40);
        }
      }
    }

    ensureMount();

    /* ---------------------------------------------------------- */
    /* public controller                                          */
    /* ---------------------------------------------------------- */

    return {
      version: VERSION,
      setSelected: setSelected,
      setHovered: setHovered,
      setPartDetached: setPartDetached,
      setAllDetached: setAllDetached,
      setAutoRotate: setAutoRotate,
      setBusy: setBusy,
      setProgress: setProgress,
      setConnectionState: setConnectionState,
      toast: toast,
      ready: ready,
      /* extras (optional for Lead): */
      dismissGuide: dismissHint,
      destroy: destroy
    };
  }

  window.Action4UI = {
    version: VERSION,
    create: create
  };
})(window, document);
