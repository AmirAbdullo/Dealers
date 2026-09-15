/**
 * CarFox Car Trust Score (0–100) client helpers.
 *
 * CarfoxTrust.tier(score)            -> { key, label, cls }
 * CarfoxTrust.badge(score, opts)     -> HTML string. opts.compact: icon + number only (listing cards);
 *                                      opts.vehicleId: renders a button that opens the breakdown.
 * CarfoxTrust.openBreakdown(id)      -> fetches /api/cars/:id/trust and shows the factor list.
 *
 * Tiers: 80+ green "Highly Verified", 60–79 blue "Verified", 40–59 amber "Partially Verified",
 * under 40 grey "Not yet verified". The score itself is always computed server-side.
 */
(function (global) {
  'use strict';

  var TIERS = [
    { min: 80, key: 'high', label: 'Highly Verified', cls: 'bg-green-50 text-green-800 border-green-200', bar: '#16a34a' },
    { min: 60, key: 'verified', label: 'Verified', cls: 'bg-blue-50 text-blue-800 border-blue-200', bar: '#2563eb' },
    { min: 40, key: 'partial', label: 'Partially Verified', cls: 'bg-amber-50 text-amber-800 border-amber-200', bar: '#d97706' },
    { min: 0, key: 'none', label: 'Not yet verified', cls: 'bg-gray-100 text-gray-600 border-gray-200', bar: '#9ca3af' }
  ];
  var styleInjected = false;
  var CSS =
    '.cf-trust-overlay{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.5);display:flex;align-items:flex-end;justify-content:center;padding:0}' +
    '.cf-trust-sheet{background:#fff;width:100%;max-width:520px;max-height:88vh;overflow:auto;border-radius:18px 18px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.2);font-family:inherit}' +
    '@media(min-width:640px){.cf-trust-overlay{align-items:center;padding:16px}.cf-trust-sheet{border-radius:18px}}' +
    '.cf-trust-row{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid #f1f5f9}' +
    '.cf-trust-ic{width:22px;height:22px;border-radius:999px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}' +
    '.cf-trust-ic.ok{background:#dcfce7;color:#15803d}.cf-trust-ic.no{background:#f1f5f9;color:#94a3b8}' +
    '.cf-trust-bar{height:8px;border-radius:999px;background:#e5e7eb;overflow:hidden}.cf-trust-bar>i{display:block;height:100%;border-radius:999px}';

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
  function clamp(score) {
    var n = Number(score);
    if (!isFinite(n)) n = 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  function tier(score) {
    var s = clamp(score);
    for (var i = 0; i < TIERS.length; i++) if (s >= TIERS[i].min) return TIERS[i];
    return TIERS[TIERS.length - 1];
  }
  function shield(cls) {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="' + cls + ' shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3 5 5.6v5.2c0 4.6 3 8.7 7 9.8 4-1.1 7-5.2 7-9.8V5.6L12 3z"/><path d="m9.2 12.2 2 2 3.8-4.2"/></svg>';
  }
  function fmtDate(t) {
    if (!t) return '';
    var s = String(t);
    if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
    if (!/[zZ]|[+-]\d\d:\d\d$/.test(s)) s += 'Z';
    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function badge(score, opts) {
    opts = opts || {};
    var s = clamp(score);
    var t = tier(s);
    var interactive = !!opts.vehicleId;
    var tag = interactive ? 'button' : 'span';
    var size = opts.compact ? ' text-[11px] px-1.5 py-0.5' : ' text-sm px-3 py-1';
    var attrs = interactive
      ? ' type="button" data-trust-open="' + esc(opts.vehicleId) + '" aria-label="Car Trust Score ' + s + ' out of 100, ' + t.label + '. Show breakdown"'
      : ' title="Car Trust Score ' + s + '/100 · ' + t.label + '"';
    return '<' + tag + attrs + ' class="inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap ' + t.cls + size + (interactive ? ' hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-300' : '') + '">' +
      shield(opts.compact ? 'h-3.5 w-3.5' : 'h-4 w-4') +
      '<span>' + s + '</span>' +
      (opts.compact ? '' : '<span class="font-medium">' + esc(t.label) + '</span>') +
      (interactive ? '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 11v5M12 8h.01"/></svg>' : '') +
      '</' + tag + '>';
  }

  var overlay = null;
  function close() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function renderSheet(data) {
    var t = tier(data.score);
    var rows = (data.factors || []).map(function (f) {
      var meta;
      if (f.verified) meta = 'Verified' + (f.verified_at ? ' ' + fmtDate(f.verified_at) : '');
      else if (f.cleared_at) meta = 'Verification removed — listing edited' + (f.cleared_at ? ' ' + fmtDate(f.cleared_at) : '');
      else meta = 'Not verified';
      return '<div class="cf-trust-row">' +
        '<span class="cf-trust-ic ' + (f.verified ? 'ok' : 'no') + '">' +
          (f.verified
            ? '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 12h12"/></svg>') +
        '</span>' +
        '<span class="min-w-0 flex-1"><span class="block text-sm font-semibold ' + (f.verified ? 'text-gray-900' : 'text-gray-500') + '">' + esc(f.label) + '</span>' +
        '<span class="block text-xs text-gray-500">' + esc(meta) + '</span></span>' +
        '<span class="text-sm font-bold ' + (f.verified ? 'text-green-700' : 'text-gray-400') + '">' + (f.verified ? '+' + f.points : '0/' + f.points) + '</span>' +
        '</div>';
    }).join('');
    var c = data.completeness || {};
    var cMeta = c.ok
      ? 'All key details filled and ' + (c.photo_count || 0) + ' photos'
      : (c.missing && c.missing.length ? 'Missing: ' + c.missing.join(', ').replace(/_/g, ' ') + (c.photo_count < c.photos_required ? '; ' : '') : '') +
        (c.photo_count < c.photos_required ? (c.photo_count || 0) + ' of ' + c.photos_required + ' photos' : '');
    rows += '<div class="cf-trust-row">' +
      '<span class="cf-trust-ic ' + (c.ok ? 'ok' : 'no') + '">' + (c.ok ? '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 12h12"/></svg>') + '</span>' +
      '<span class="min-w-0 flex-1"><span class="block text-sm font-semibold ' + (c.ok ? 'text-gray-900' : 'text-gray-500') + '">Listing completeness <span class="text-xs font-normal text-gray-400">(automatic)</span></span>' +
      '<span class="block text-xs text-gray-500">' + esc(cMeta || 'Checked automatically') + '</span></span>' +
      '<span class="text-sm font-bold ' + (c.ok ? 'text-green-700' : 'text-gray-400') + '">' + (c.ok ? '+' + c.points : '0/' + (c.max || 5)) + '</span>' +
      '</div>';

    return '<div class="p-5">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div><p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Car Trust Score</p>' +
        '<div class="mt-1 flex items-center gap-2"><span class="text-4xl font-extrabold text-gray-900">' + clamp(data.score) + '</span><span class="text-gray-400 text-lg">/ 100</span></div>' +
        '<div class="mt-1">' + badge(data.score) + '</div></div>' +
        '<button type="button" data-trust-close class="p-2 -mr-2 -mt-2 text-gray-500 hover:text-gray-900" aria-label="Close"><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      '</div>' +
      '<div class="cf-trust-bar mt-4"><i style="width:' + clamp(data.score) + '%;background:' + t.bar + '"></i></div>' +
      '<p class="mt-3 text-xs text-gray-500">Each factor is checked by the CarFox team, not the dealer. If the dealer edits a verified detail, that check is removed until it is verified again.</p>' +
      '<div class="mt-3">' + rows + '</div>' +
      '</div>';
  }

  function openBreakdown(vehicleId) {
    injectStyle();
    close();
    overlay = document.createElement('div');
    overlay.className = 'cf-trust-overlay';
    overlay.innerHTML = '<div class="cf-trust-sheet" role="dialog" aria-modal="true" aria-label="Car Trust Score breakdown"><div class="p-6 text-sm text-gray-500">Loading trust score…</div></div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('[data-trust-close]')) close();
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    var headers = {};
    try { var tok = localStorage.getItem('carfox_token'); if (tok) headers.Authorization = 'Bearer ' + tok; } catch (_) {}
    fetch('/api/cars/' + encodeURIComponent(vehicleId) + '/trust', { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!overlay) return;
        var sheet = overlay.querySelector('.cf-trust-sheet');
        sheet.innerHTML = data && data.trust ? renderSheet(data.trust) : '<div class="p-6 text-sm text-gray-600">Trust score is not available for this listing.</div>';
      })
      .catch(function () {
        if (!overlay) return;
        overlay.querySelector('.cf-trust-sheet').innerHTML = '<div class="p-6 text-sm text-gray-600">Could not load the trust score. Please try again.</div>';
      });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-trust-open]') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    openBreakdown(btn.getAttribute('data-trust-open'));
  });

  global.CarfoxTrust = { tier: tier, badge: badge, openBreakdown: openBreakdown, close: close, TIERS: TIERS };
})(typeof window !== 'undefined' ? window : this);
