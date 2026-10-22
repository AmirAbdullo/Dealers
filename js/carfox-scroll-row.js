/**
 * CarFox horizontal scroll rows: desktop arrow buttons + edge fades for rows that overflow sideways
 * (city chips, thumbnail strips…). Phones keep plain touch scrolling: the arrows and fades are md+ only.
 *
 *   CarfoxScrollRow.attach(rowEl, { size: 'sm'|'md', fade: '#ffffff', step: 260 })
 *
 * The row's parent becomes the positioning context (relative) and receives two arrow buttons styled
 * like the home page row arrows, plus start/end fades in the given background colour. Arrows hide at
 * either end and whenever the row does not overflow; a MutationObserver keeps that in step when the row
 * re-renders. RTL-aware (scrollLeft runs negative there).
 */
(function (global) {
  'use strict';

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var s = document.createElement('style');
    s.textContent =
      '.cf-row-fade{position:absolute;top:0;bottom:0;width:3rem;pointer-events:none;z-index:5;transition:opacity .15s ease}' +
      '.cf-row-fade-start{inset-inline-start:0;background:linear-gradient(to right,var(--cf-fade,#fff),transparent)}' +
      '.cf-row-fade-end{inset-inline-end:0;background:linear-gradient(to left,var(--cf-fade,#fff),transparent)}' +
      '[dir="rtl"] .cf-row-fade-start{background:linear-gradient(to left,var(--cf-fade,#fff),transparent)}' +
      '[dir="rtl"] .cf-row-fade-end{background:linear-gradient(to right,var(--cf-fade,#fff),transparent)}' +
      '@media (max-width:767.98px){.cf-row-fade,.cf-row-arrow{display:none !important}}';
    document.head.appendChild(s);
  }

  function attach(row, opts) {
    opts = opts || {};
    if (!row || row.__cfScrollRow) return row && row.__cfScrollRow;
    var wrap = row.parentElement;
    if (!wrap) return null;
    injectStyle();
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

    var small = opts.size === 'sm';
    var btnCls =
      'cf-row-arrow absolute top-1/2 -translate-y-1/2 z-10 flex items-center justify-center rounded-full bg-white shadow-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-0 disabled:pointer-events-none transition-opacity ' +
      (small ? 'h-8 w-8' : 'h-10 w-10');

    function makeArrow(dir) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = btnCls + ' ' + (dir === 'prev' ? (small ? 'start-0' : '-start-3') : (small ? 'end-0' : '-end-3'));
      b.setAttribute('aria-label', dir === 'prev' ? 'Scroll back' : 'Scroll forward');
      b.innerHTML =
        '<svg class="' + (small ? 'h-4 w-4' : 'h-5 w-5') + ' rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="' + (dir === 'prev' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7') + '"/></svg>';
      return b;
    }
    function makeFade(side) {
      var f = document.createElement('div');
      f.className = 'cf-row-fade cf-row-fade-' + side;
      f.style.setProperty('--cf-fade', opts.fade || '#ffffff');
      f.setAttribute('aria-hidden', 'true');
      return f;
    }

    var prev = makeArrow('prev');
    var next = makeArrow('next');
    var fadeStart = makeFade('start');
    var fadeEnd = makeFade('end');
    wrap.appendChild(fadeStart);
    wrap.appendChild(fadeEnd);
    wrap.appendChild(prev);
    wrap.appendChild(next);

    function rtl() { return getComputedStyle(row).direction === 'rtl'; }
    function step() { return opts.step || Math.min(row.clientWidth * 0.6, 360); }
    function update() {
      var max = row.scrollWidth - row.clientWidth;
      var pos = Math.abs(row.scrollLeft);
      var scrollable = max > 2;
      prev.disabled = !scrollable || pos <= 2;
      next.disabled = !scrollable || pos >= max - 2;
      fadeStart.style.opacity = prev.disabled ? '0' : '1';
      fadeEnd.style.opacity = next.disabled ? '0' : '1';
    }

    prev.addEventListener('click', function () { row.scrollBy({ left: (rtl() ? 1 : -1) * step(), behavior: 'smooth' }); });
    next.addEventListener('click', function () { row.scrollBy({ left: (rtl() ? -1 : 1) * step(), behavior: 'smooth' }); });
    row.addEventListener('scroll', update, { passive: true });
    global.addEventListener('resize', update);
    if (global.MutationObserver) {
      new MutationObserver(function () { global.requestAnimationFrame(update); }).observe(row, { childList: true, subtree: true });
    }
    if (global.ResizeObserver) new ResizeObserver(update).observe(row);
    update();

    row.__cfScrollRow = { update: update, prev: prev, next: next };
    return row.__cfScrollRow;
  }

  global.CarfoxScrollRow = { attach: attach };
})(typeof window !== 'undefined' ? window : this);
