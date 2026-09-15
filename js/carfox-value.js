/**
 * CarFox Car Value badge (deal rating) client helpers.
 *
 * CarfoxValue.badge(car, opts)   -> HTML string, '' when the car has no rating (car.car_value null).
 *                                   opts.compact for listing cards; opts.vehicleId makes it a button
 *                                   that opens the explanation sheet.
 * CarfoxValue.openExplanation(id) -> fetches /api/cars/:id/value and shows how the rating was made.
 *
 * Ratings come from the server only: great (green) · good (teal) · fair (grey-blue) · above (amber).
 */
(function (global) {
  'use strict';

  var STYLES = {
    great: { label: 'Great Deal', cls: 'bg-green-50 text-green-800 border-green-200', bar: '#16a34a' },
    good: { label: 'Good Deal', cls: 'bg-teal-50 text-teal-800 border-teal-200', bar: '#0d9488' },
    fair: { label: 'Fair Price', cls: 'bg-slate-100 text-slate-700 border-slate-200', bar: '#64748b' },
    above: { label: 'Above Market', cls: 'bg-amber-50 text-amber-800 border-amber-200', bar: '#d97706' }
  };
  var styleInjected = false;
  var CSS =
    '.cf-value-overlay{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.5);display:flex;align-items:flex-end;justify-content:center}' +
    '.cf-value-sheet{background:#fff;width:100%;max-width:520px;max-height:88vh;overflow:auto;border-radius:18px 18px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.2);font-family:inherit}' +
    '@media(min-width:640px){.cf-value-overlay{align-items:center;padding:16px}.cf-value-sheet{border-radius:18px}}' +
    '.cf-value-scale{position:relative;height:10px;border-radius:999px;background:linear-gradient(90deg,#16a34a 0%,#16a34a 30%,#0d9488 30%,#0d9488 45%,#94a3b8 45%,#94a3b8 58%,#d97706 58%,#d97706 100%)}' +
    '.cf-value-pin{position:absolute;top:-6px;width:22px;height:22px;margin-left:-11px;border-radius:999px;background:#fff;border:3px solid #111827;box-shadow:0 1px 4px rgba(0,0,0,.3)}';

  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function tag(cls) {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="' + cls + ' shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20 12.5 12.5 20a1.5 1.5 0 0 1-2.1 0L4 13.6V4h9.6l6.4 6.4a1.5 1.5 0 0 1 0 2.1z"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/></svg>';
  }
  function fmtEgp(piasters) {
    if (!(piasters > 0)) return '—';
    return Math.round(Number(piasters) / 100).toLocaleString('en-EG') + ' EGP';
  }

  function badge(car, opts) {
    opts = opts || {};
    var cv = car && car.car_value;
    if (!cv || !cv.rating || !STYLES[cv.rating]) return '';
    var st = STYLES[cv.rating];
    var interactive = !!opts.vehicleId;
    var t = interactive ? 'button' : 'span';
    var size = opts.compact ? ' text-[11px] px-1.5 py-0.5' : ' text-sm px-3 py-1';
    var pctText = cv.pct != null ? (Math.abs(cv.pct) < 0.5 ? 'at the market median' : Math.abs(Math.round(cv.pct)) + '% ' + (cv.pct < 0 ? 'below' : 'above') + ' the median') : '';
    var attrs = interactive
      ? ' type="button" data-value-open="' + esc(opts.vehicleId) + '" aria-label="' + esc(st.label) + (pctText ? ', priced ' + pctText : '') + '. How is this rated?"'
      : ' title="' + esc(st.label) + (pctText ? ' · ' + pctText + ' of ' + cv.comparables + ' similar cars' : '') + '"';
    return '<' + t + attrs + ' class="inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap ' + st.cls + size + (interactive ? ' hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-300' : '') + '">' +
      tag(opts.compact ? 'h-3.5 w-3.5' : 'h-4 w-4') + '<span>' + esc(st.label) + '</span>' +
      (interactive ? '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 11v5M12 8h.01"/></svg>' : '') +
      '</' + t + '>';
  }

  var overlay = null;
  function close() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function renderSheet(data) {
    var v = data.value;
    var m = data.method || {};
    var head;
    if (v) {
      var st = STYLES[v.rating] || STYLES.fair;
      // pin position: map pct to the 0-100 scale, clamped to [-20%, +20%]
      var p = Math.max(-20, Math.min(20, Number(v.pct) || 0));
      var left = ((p + 20) / 40) * 100;
      head =
        '<div class="mt-1">' + badge({ car_value: v }) + '</div>' +
        '<p class="mt-3 text-lg font-semibold text-gray-900">' + esc(data.explanation) + '</p>' +
        '<div class="mt-4 grid grid-cols-2 gap-3 text-sm">' +
          '<div class="rounded-lg bg-gray-50 p-3"><div class="text-xs text-gray-500">This car</div><div class="font-bold text-gray-900">' + fmtEgp(data.price) + '</div></div>' +
          '<div class="rounded-lg bg-gray-50 p-3"><div class="text-xs text-gray-500">Median of similar cars</div><div class="font-bold text-gray-900">' + fmtEgp(v.median) + '</div></div>' +
        '</div>' +
        '<div class="mt-5 px-1"><div class="cf-value-scale"><span class="cf-value-pin" style="left:' + left + '%"></span></div>' +
        '<div class="mt-2 flex justify-between text-[11px] text-gray-500"><span>−20%</span><span>median</span><span>+20%</span></div></div>' +
        '<div class="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">' +
          '<span><span class="inline-block w-2.5 h-2.5 rounded-full bg-green-600 mr-1"></span>Great Deal: ' + esc(m.great_below_pct) + '%+ below</span>' +
          '<span><span class="inline-block w-2.5 h-2.5 rounded-full bg-teal-600 mr-1"></span>Good Deal: ' + esc(m.good_below_pct) + '–' + esc(m.great_below_pct) + '% below</span>' +
          '<span><span class="inline-block w-2.5 h-2.5 rounded-full bg-slate-400 mr-1"></span>Fair Price: within ±' + esc(m.fair_band_pct) + '%</span>' +
          '<span><span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 mr-1"></span>Above Market: more than ' + esc(m.fair_band_pct) + '% above</span>' +
        '</div>';
    } else {
      head = '<p class="mt-3 text-base font-semibold text-gray-900">No deal rating yet</p><p class="mt-1 text-sm text-gray-600">' + esc(data.explanation) + '</p>';
    }
    return '<div class="p-5">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Car Value</p>' +
        '<button type="button" data-value-close class="p-2 -mr-2 -mt-2 text-gray-500 hover:text-gray-900" aria-label="Close"><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      '</div>' +
      head +
      '<p class="mt-4 text-xs text-gray-500">Similar cars = same make and model, year within ±' + esc(m.year_range) + ', mileage within ±' + esc(m.mileage_pct) + '%, listed now on CarFox or sold here in the last ' + esc(m.sold_months) + ' months. At least ' + esc(m.min_comparables) + ' are needed before a rating is shown. This is a price comparison, not a valuation or inspection.</p>' +
      '</div>';
  }

  function openExplanation(vehicleId) {
    injectStyle();
    close();
    overlay = document.createElement('div');
    overlay.className = 'cf-value-overlay';
    overlay.innerHTML = '<div class="cf-value-sheet" role="dialog" aria-modal="true" aria-label="Car Value explanation"><div class="p-6 text-sm text-gray-500">Loading…</div></div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('[data-value-close]')) close();
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    var headers = {};
    try { var tok = localStorage.getItem('carfox_token'); if (tok) headers.Authorization = 'Bearer ' + tok; } catch (_) {}
    fetch('/api/cars/' + encodeURIComponent(vehicleId) + '/value', { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!overlay) return;
        overlay.querySelector('.cf-value-sheet').innerHTML = data ? renderSheet(data) : '<div class="p-6 text-sm text-gray-600">Deal rating is not available for this listing.</div>';
      })
      .catch(function () {
        if (!overlay) return;
        overlay.querySelector('.cf-value-sheet').innerHTML = '<div class="p-6 text-sm text-gray-600">Could not load the rating. Please try again.</div>';
      });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-value-open]') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    openExplanation(btn.getAttribute('data-value-open'));
  });

  global.CarfoxValue = { badge: badge, openExplanation: openExplanation, close: close, STYLES: STYLES };
})(typeof window !== 'undefined' ? window : this);
