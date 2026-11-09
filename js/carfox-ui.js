/*
 * CarfoxUI: shared micro-interactions. Loaded in <head> on every page (not deferred) so inline scripts can use it.
 *
 *   CarfoxUI.toast(msg, { kind: 'success'|'error'|'info', duration: 2500 })
 *       One pill at a time, bottom-centre: above the floating bottom nav / sticky contact bar on phones,
 *       24px from the bottom on desktop. Slides up, auto-dismisses. Replaces alert() everywhere.
 *   CarfoxUI.skeleton(kind, count)  -> HTML string of shimmer placeholders shaped like the real cards
 *       kinds: 'compact' (home snap rows), 'browse' (cars.html result cards), 'grid' (saved cars), 'detail'
 *       Static markup can also say <div data-cf-skeleton="grid:4"></div>; it is filled automatically.
 *   CarfoxUI.stagger(container)     Subtle rise-in of the container's children, once per container
 *   CarfoxUI.heartPop(btn, saved)   Bounce on save / shrink-back on unsave
 *
 * Automatic, no page code needed:
 *   - images fade in when they finish loading (the photo box's bg-slate-100 shows behind them); opt out with
 *     data-no-fade on the <img> or an ancestor
 *   - press feedback: buttons, cards, tiles and button-like links scale to .98 while pressed and spring back;
 *     opt out with data-no-press
 *   - entry animation for sheets / dialogs: .cf-anim-sheet (slide up on phones, fade-scale from 640px),
 *     .cf-anim-dialog (short rise + fade on phones, fade-scale from 640px), .cf-anim-backdrop (fade). The shared
 *     overlays (trust / value sheets, photo cropper, admin + dealer "...Modal" dialogs, chat lightbox) are
 *     matched by selector, so their markup does not need the classes.
 *
 * Everything is 150–250ms, animates only opacity / transform-family properties (compositor-friendly), and is
 * switched off under prefers-reduced-motion.
 */
(function (global) {
  'use strict';
  if (global.CarfoxUI) return;
  var doc = document;
  var reduceMq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(reduceMq && reduceMq.matches); }

  var SPRING = 'cubic-bezier(.34,1.56,.64,1)';
  var EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';

  // Modal / sheet selectors that animate without markup changes.
  var SHEETS = '.cf-anim-sheet,.cf-trust-sheet,.cf-value-sheet,#cfCropPanel';
  var DIALOGS = '.cf-anim-dialog,.fixed[id$="Modal"]>.relative';
  var BACKDROPS = '.cf-anim-backdrop,.cf-trust-overlay,.cf-value-overlay,#cfCropOverlay,.fixed[id$="Modal"]>.absolute.inset-0,#lightbox';

  var CSS =
    // ---- skeletons: a flat block with a composited light sweep (translateX only, no repaint per frame)
    // (radius under :where() so Tailwind rounded-* utilities on a bar always win)
    '.cf-skel{position:relative;overflow:hidden;background:#e9edf3}:where(.cf-skel){border-radius:8px}' +
    '.cf-skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);' +
      'background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0));' +
      'animation:cf-shimmer 1.2s ease-in-out infinite}' +
    '@keyframes cf-shimmer{to{transform:translateX(100%)}}' +
    '.cf-skel-card{background:#fff;border-radius:1.5rem;overflow:hidden;box-shadow:0 1px 2px rgba(15,31,61,.06),0 14px 34px -22px rgba(15,31,61,.4)}' +
    '.cf-skel-card .cf-skel-photo{border-radius:0}' +

    // ---- image fade-in (animation, so it never fights an element's own transition / opacity classes)
    'img.cf-img-wait{opacity:0}' +
    'img.cf-img-in{animation:cf-fade-in .2s ease-out}' +
    '@keyframes cf-fade-in{from{opacity:0}}' +

    // ---- press feedback (the individual `scale` property composes with Tailwind / hover transforms)
    '.cf-pressed{animation:cf-press-in .12s ease-out forwards}' +
    '.cf-release{animation:cf-press-out .24s ' + SPRING + '}' +
    '@keyframes cf-press-in{from{scale:1}to{scale:.98}}' +
    '@keyframes cf-press-out{from{scale:.98}to{scale:1}}' +

    // ---- save heart
    '.cf-heart-on{animation:cf-heart-on .25s ' + SPRING + '}' +
    '.cf-heart-off{animation:cf-heart-off .2s ease-out}' +
    '@keyframes cf-heart-on{0%{scale:.6}55%{scale:1.28}100%{scale:1}}' +
    '@keyframes cf-heart-off{0%{scale:1}45%{scale:.78}100%{scale:1}}' +
    '.cf-heart-on svg{animation:cf-fade-in .15s ease-out}' +

    // ---- staggered first-load rise (fill backwards: no lingering transform that would block hover lift)
    '.cf-rise{animation:cf-rise .22s ease-out backwards}' +
    '@keyframes cf-rise{from{opacity:0;translate:0 8px}}' +

    // ---- sheets / dialogs / backdrops: entry animations run whenever the element goes from hidden to shown
    BACKDROPS + '{animation:cf-fade-in .2s ease-out}' +
    SHEETS + '{animation:cf-sheet-up .25s ' + EASE_OUT + '}' +
    DIALOGS + '{animation:cf-dialog-up .22s ' + EASE_OUT + '}' +
    '@media (min-width:640px){' + SHEETS + ',' + DIALOGS + '{animation:cf-pop-in .2s ' + EASE_OUT + '}}' +
    '@keyframes cf-sheet-up{from{transform:translateY(100%)}}' +
    '@keyframes cf-dialog-up{from{opacity:0;transform:translateY(16px)}}' +
    '@keyframes cf-pop-in{from{opacity:0;transform:scale(.96)}}' +

    // ---- toast pill
    '.cf-toast{position:fixed;left:50%;z-index:1200;bottom:calc(var(--cf-nav-space,12px) + 12px);' +
      'display:flex;align-items:center;gap:8px;max-width:min(92vw,420px);width:max-content;' +
      'padding:10px 16px;border-radius:9999px;background:rgba(15,23,42,.94);color:#fff;' +
      'font-size:14px;font-weight:600;line-height:1.3;box-shadow:0 12px 30px -10px rgba(15,23,42,.45),0 2px 6px rgba(15,23,42,.18);' +
      'transform:translate(-50%,16px);opacity:0;pointer-events:none;' +
      'transition:transform .22s ' + EASE_OUT + ',opacity .18s ease-out}' +
    '.cf-toast.is-in{transform:translate(-50%,0);opacity:1;pointer-events:auto}' +
    '.cf-toast-ic{flex:none;width:18px;height:18px}' +
    '.cf-toast-msg{min-width:0}' +
    '@media (min-width:768px){.cf-toast{bottom:24px}}' +

    // ---- reduced motion: no movement, no shimmer, images just appear
    '@media (prefers-reduced-motion:reduce){' +
      '.cf-skel::after{animation:none;display:none}' +
      'img.cf-img-wait{opacity:1}' +
      '.cf-img-in,.cf-pressed,.cf-release,.cf-heart-on,.cf-heart-off,.cf-heart-on svg,.cf-rise,' +
        BACKDROPS + ',' + SHEETS + ',' + DIALOGS + '{animation:none !important}' +
      '.cf-toast{transition:opacity .15s linear;transform:translate(-50%,0)}' +
    '}';

  function injectStyle() {
    if (doc.getElementById('cfUiStyle')) return;
    var st = doc.createElement('style');
    st.id = 'cfUiStyle';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  injectStyle();

  // ------------------------------------------------------------------ skeleton markup
  function bar(cls) { return '<div class="cf-skel ' + cls + '"></div>'; }
  var SKELETONS = {
    // Home snap-row card (CarfoxCard compact): 4:3 photo, title + heart, spec line, price, location, lead buttons.
    compact: function () {
      return '<div class="cf-skel-card shrink-0 snap-start w-[280px] sm:w-[300px]" aria-hidden="true">' +
        '<div class="cf-skel cf-skel-photo aspect-[4/3]"></div>' +
        '<div class="px-3.5 pt-3 pb-3.5 space-y-2">' +
          '<div class="flex justify-between gap-3">' + bar('h-4 w-3/4') + bar('h-6 w-6 rounded-full') + '</div>' +
          bar('h-3 w-5/6') + bar('h-6 w-2/5') + bar('h-3 w-1/3') +
          '<div class="grid grid-cols-2 gap-2 pt-1">' + bar('h-11 rounded-xl') + bar('h-11 rounded-xl') + '</div>' +
        '</div></div>';
    },
    // Browse result (cars.html): photo on top on phones, 40% photo column from md.
    browse: function () {
      return '<div class="cf-skel-card flex flex-col md:flex-row" aria-hidden="true">' +
        '<div class="cf-skel cf-skel-photo aspect-[4/3] md:aspect-auto md:w-[40%] md:shrink-0 md:min-h-[210px]"></div>' +
        '<div class="flex-1 p-3 md:p-4 space-y-2.5">' +
          '<div class="flex justify-between gap-3">' + bar('h-5 w-2/3') + bar('h-6 w-20') + '</div>' +
          bar('h-3 w-1/3') +
          '<div class="flex gap-2 pt-1">' + bar('h-6 w-20 rounded-full') + bar('h-6 w-16 rounded-full') + bar('h-6 w-24 rounded-full') + '</div>' +
          bar('h-3 w-1/2') +
          '<div class="flex gap-2 pt-2">' + bar('h-9 flex-1 rounded-xl') + bar('h-9 flex-1 rounded-xl') + '</div>' +
        '</div></div>';
    },
    // Saved cars grid card (CarfoxCard grid variant without actions).
    grid: function () {
      return '<div class="cf-skel-card" aria-hidden="true">' +
        '<div class="cf-skel cf-skel-photo aspect-[4/3]"></div>' +
        '<div class="p-3.5 space-y-2">' + bar('h-4 w-3/4') + bar('h-3 w-1/2') + bar('h-6 w-1/3 mt-1') +
          '<div class="grid grid-cols-2 gap-2 pt-1">' + bar('h-3') + bar('h-3') + bar('h-3') + bar('h-3') + '</div>' +
        '</div></div>';
    },
    // Listing detail: gallery + title / price / specs, two columns from md.
    detail: function () {
      var specs = '';
      for (var i = 0; i < 6; i++) specs += '<div class="space-y-1.5">' + bar('h-3 w-1/2') + bar('h-4 w-3/4') + '</div>';
      return '<div class="md:max-w-6xl md:mx-auto md:px-6 md:pt-6 md:grid md:grid-cols-[minmax(0,1fr)_380px] md:gap-6" aria-hidden="true">' +
        '<div>' +
          '<div class="cf-skel aspect-[4/3] md:aspect-[16/10] rounded-none md:rounded-2xl"></div>' +
          '<div class="hidden md:flex gap-2 mt-3">' + bar('h-16 w-24 rounded-lg') + bar('h-16 w-24 rounded-lg') + bar('h-16 w-24 rounded-lg') + bar('h-16 w-24 rounded-lg') + '</div>' +
        '</div>' +
        '<div class="px-4 pt-4 md:px-0 md:pt-0 space-y-3">' +
          bar('h-6 w-3/4') + bar('h-4 w-1/2') + bar('h-8 w-2/5') +
          '<div class="flex gap-2">' + bar('h-7 w-24 rounded-full') + bar('h-7 w-20 rounded-full') + '</div>' +
          '<div class="grid grid-cols-2 gap-4 pt-2">' + specs + '</div>' +
          '<div class="hidden md:block space-y-2 pt-2">' + bar('h-11 rounded-xl') + bar('h-11 rounded-xl') + '</div>' +
        '</div></div>';
    }
  };
  function skeleton(kind, count) {
    var fn = SKELETONS[kind] || SKELETONS.grid;
    var n = Math.max(1, count || 1);
    var out = '';
    for (var i = 0; i < n; i++) out += fn();
    return out;
  }
  function fillSkeleton(el) {
    if (!el || el.getAttribute('data-cf-skel-done') === '1') return;
    var spec = String(el.getAttribute('data-cf-skeleton') || '').split(':');
    el.setAttribute('data-cf-skel-done', '1');
    el.setAttribute('aria-busy', 'true');
    el.innerHTML = skeleton(spec[0], parseInt(spec[1], 10) || 1);
  }

  // ------------------------------------------------------------------ toast
  var ICONS = {
    success: '<svg class="cf-toast-ic" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    error: '<svg class="cf-toast-ic" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
    info: '<svg class="cf-toast-ic" viewBox="0 0 24 24" fill="none" stroke="#fdba74" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/></svg>'
  };
  var toastEl = null, toastMsg = null, toastIc = null, hideTimer = 0;
  function ensureToast() {
    if (toastEl && toastEl.isConnected) return toastEl;
    toastEl = doc.createElement('div');
    toastEl.className = 'cf-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    toastEl.innerHTML = '<span class="cf-toast-icwrap"></span><span class="cf-toast-msg"></span>';
    toastIc = toastEl.firstChild;
    toastMsg = toastEl.lastChild;
    toastEl.addEventListener('click', hideToast);
    doc.body.appendChild(toastEl);
    return toastEl;
  }
  // Sit above a visible sticky bottom bar (the detail page contact bar etc.) on phones.
  function toastBottom() {
    if (global.innerWidth >= 768) return '';
    var top = Infinity;
    doc.querySelectorAll('.cf-above-nav,.cf-toast-anchor').forEach(function (el) {
      if (el.classList.contains('hidden') || el.classList.contains('translate-y-full')) return;
      var r = el.getBoundingClientRect();
      if (r.height && r.bottom > global.innerHeight - 4 - 200 && r.top < global.innerHeight) top = Math.min(top, r.top);
    });
    return top === Infinity ? '' : Math.round(global.innerHeight - top + 10) + 'px';
  }
  function hideToast() {
    clearTimeout(hideTimer);
    if (toastEl) toastEl.classList.remove('is-in');
  }
  function toast(message, opts) {
    if (typeof opts === 'string') opts = { kind: opts };
    opts = opts || {};
    if (message == null || message === '') return;
    if (!doc.body) { doc.addEventListener('DOMContentLoaded', function () { toast(message, opts); }); return; }
    var kind = ICONS[opts.kind] ? opts.kind : 'success';
    var el = ensureToast();
    clearTimeout(hideTimer);
    var wasIn = el.classList.contains('is-in');
    toastIc.innerHTML = ICONS[kind];
    toastMsg.textContent = String(message);
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.style.bottom = toastBottom();
    if (!wasIn) {
      void el.offsetWidth; // start from the off-screen state so the slide-up runs
      el.classList.add('is-in');
    }
    hideTimer = setTimeout(hideToast, opts.duration || 2500);
  }

  // ------------------------------------------------------------------ stagger + heart
  function stagger(container, opts) {
    if (!container || reduced()) return;
    opts = opts || {};
    if (!opts.force) {
      if (container.getAttribute('data-cf-staggered') === '1') return;
      container.setAttribute('data-cf-staggered', '1');
    }
    var step = opts.step || 40, max = opts.max || 8, i = 0;
    Array.prototype.forEach.call(container.children, function (child) {
      if (child.nodeType !== 1 || child.offsetParent === null) return;
      child.style.animationDelay = Math.min(i, max) * step + 'ms';
      child.classList.add('cf-rise');
      i++;
    });
  }

  function heartPop(btn, saved) {
    if (!btn || reduced()) return;
    btn.classList.remove('cf-heart-on', 'cf-heart-off', 'cf-pressed', 'cf-release');
    void btn.offsetWidth;
    btn.classList.add(saved ? 'cf-heart-on' : 'cf-heart-off');
  }

  // ------------------------------------------------------------------ image fade-in
  function prepImg(img) {
    if (img.complete || img.hasAttribute('data-no-fade') || img.classList.contains('cf-img-wait')) return;
    if (img.closest('[data-no-fade],#cfCropOverlay,.cropper-container,.pswp')) return;
    img.classList.add('cf-img-wait');
  }
  function onImgDone(e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('cf-img-wait')) return;
    img.classList.remove('cf-img-wait');
    if (e.type === 'load' && !reduced()) img.classList.add('cf-img-in');
  }
  doc.addEventListener('load', onImgDone, true);
  doc.addEventListener('error', onImgDone, true);

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') { prepImg(node); return; }
    if (node.hasAttribute('data-cf-skeleton')) fillSkeleton(node);
    if (!node.firstElementChild) return;
    var imgs = node.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) prepImg(imgs[i]);
    var sk = node.querySelectorAll('[data-cf-skeleton]');
    for (var j = 0; j < sk.length; j++) fillSkeleton(sk[j]);
  }
  if (global.MutationObserver) {
    new MutationObserver(function (records) {
      for (var r = 0; r < records.length; r++) {
        var added = records[r].addedNodes;
        for (var k = 0; k < added.length; k++) scan(added[k]);
      }
    }).observe(doc.documentElement, { childList: true, subtree: true });
  }
  doc.addEventListener('DOMContentLoaded', function () { if (doc.body) scan(doc.body); });

  // ------------------------------------------------------------------ press feedback
  var PRESSABLE = 'button,[role="button"],.cf-card,.cf-press,.cf-cat-tile,.cf-brand-tile,' +
    'a[class*="rounded"][class*="px-"],a[class*="rounded"][class*="py-"],label[class*="rounded"][class*="px-"]';
  var pressedEl = null;
  function release() {
    if (!pressedEl) return;
    var el = pressedEl;
    pressedEl = null;
    el.classList.remove('cf-pressed');
    if (reduced()) return;
    void el.offsetWidth;
    el.classList.add('cf-release');
  }
  doc.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || reduced()) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var el = t.closest(PRESSABLE);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[data-no-press]')) return;
    // Wide rows (full-width accordions, list rows) would visibly jump; keep the effect on cards / buttons.
    if (el.offsetWidth > 720) return;
    release();
    el.classList.remove('cf-release', 'cf-heart-on', 'cf-heart-off');
    el.classList.add('cf-pressed');
    pressedEl = el;
  }, { passive: true });
  ['pointerup', 'pointercancel', 'dragstart'].forEach(function (type) { doc.addEventListener(type, release, { passive: true }); });
  global.addEventListener('blur', release);
  doc.addEventListener('animationend', function (e) {
    var n = e.animationName, el = e.target;
    if (n === 'cf-press-out') el.classList.remove('cf-release');
    else if (n === 'cf-heart-on' || n === 'cf-heart-off') el.classList.remove('cf-heart-on', 'cf-heart-off');
    else if (n === 'cf-rise') { el.classList.remove('cf-rise'); el.style.animationDelay = ''; }
    else if (n === 'cf-fade-in' && el.tagName === 'IMG') el.classList.remove('cf-img-in');
  }, true);
  // iOS Safari only honours :active styles / quick pointer events with a touch listener present.
  doc.addEventListener('touchstart', function () {}, { passive: true });

  global.CarfoxUI = {
    toast: toast,
    hideToast: hideToast,
    skeleton: skeleton,
    fillSkeleton: fillSkeleton,
    stagger: stagger,
    heartPop: heartPop,
    reducedMotion: reduced
  };
})(window);
