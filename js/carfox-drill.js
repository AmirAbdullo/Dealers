/**
 * CarFox drill-down list pieces — shared by quick-search.html and the phone Filters sheet on cars.html.
 *
 *   CarfoxDrill.item(label, checked, opts) -> <button class="cf-drill-item">
 *     opts.logo     image URL shown before the label (falls back to an initial circle)
 *     opts.count    number shown at the end (muted)
 *     opts.bold     bold label (e.g. "All makes")
 *     opts.multi    checkbox look (multi-select); otherwise a trailing check mark when checked
 *     opts.chevron  trailing chevron (the row drills further, e.g. a make opens its models)
 *     opts.zero     greyed label (no listings match)
 *   CarfoxDrill.head(text)              -> group header row (e.g. a features category)
 *   CarfoxDrill.logoFor(name, makes)    -> logo URL: the admin catalogue logo, else a carlogos.org guess
 */
(function (global) {
  'use strict';

  var CHECK = '<svg class="cf-drill-check" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
  var BOX = '<span class="cf-drill-box" aria-hidden="true"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></span>';
  var CHEV = '<svg class="cf-drill-chev" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected || typeof document === 'undefined') return;
    styleInjected = true;
    var s = document.createElement('style');
    s.textContent =
      '.cf-drill-item{display:flex;align-items:center;gap:14px;width:100%;padding:14px 18px;background:#fff;text-align:start;border-top:1px solid #f1f5f9;font-size:15px;color:#111827}' +
      '.cf-drill-item:first-child{border-top:0}' +
      '.cf-drill-item:active{background:#f8fafc}' +
      '.cf-drill-item[aria-checked="true"]{background:#eff6ff}' +
      '.cf-drill-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.cf-drill-item.is-bold .cf-drill-label{font-weight:600}' +
      '.cf-drill-item.is-zero .cf-drill-label{color:#9ca3af}' +
      '.cf-drill-count{flex-shrink:0;font-size:12px;color:#94a3b8}' +
      '.cf-drill-check{flex-shrink:0;color:#1d4ed8;visibility:hidden}' +
      '.cf-drill-item[aria-checked="true"] .cf-drill-check{visibility:visible}' +
      '.cf-drill-chev{flex-shrink:0;color:#94a3b8}' +
      '[dir="rtl"] .cf-drill-chev{transform:rotate(180deg)}' +
      '.cf-drill-box{width:22px;height:22px;flex-shrink:0;border:1.5px solid #cbd5e1;border-radius:6px;display:flex;align-items:center;justify-content:center;color:transparent;background:#fff}' +
      '.cf-drill-item[aria-checked="true"] .cf-drill-box{background:#1d4ed8;border-color:#1d4ed8;color:#fff}' +
      '.cf-drill-logo{width:36px;height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center}' +
      '.cf-drill-logo img{width:36px;height:36px;object-fit:contain}' +
      '.cf-drill-initial{width:36px;height:36px;border-radius:9999px;background:#e5e7eb;color:#4b5563;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}' +
      '.cf-drill-head{padding:16px 18px 6px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#64748b;background:#f8fafc;border-top:1px solid #f1f5f9}';
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  // Broken logo -> initial circle (called from the img's onerror).
  function logoFallback(img) {
    var span = document.createElement('span');
    span.className = 'cf-drill-initial';
    span.textContent = img.getAttribute('data-initial') || '';
    img.replaceWith(span);
  }

  function item(label, checked, opts) {
    opts = opts || {};
    injectStyle();
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cf-drill-item' + (opts.bold ? ' is-bold' : '') + (opts.zero && !checked ? ' is-zero' : '');
    b.setAttribute('role', opts.multi ? 'checkbox' : 'option');
    b.setAttribute('aria-checked', checked ? 'true' : 'false');
    var html = opts.multi ? BOX : '';
    if (opts.logo) {
      html += '<span class="cf-drill-logo"><img src="' + esc(opts.logo) + '" alt="" width="36" height="36" loading="lazy" data-initial="' +
        esc(String(label).charAt(0)) + '" onerror="CarfoxDrill.logoFallback(this)" /></span>';
    }
    html += '<span class="cf-drill-label">' + esc(label) + '</span>';
    if (opts.count != null) html += '<span class="cf-drill-count">' + fmt(opts.count) + '</span>';
    if (opts.chevron) html += CHEV;
    else if (!opts.multi) html += CHECK;
    b.innerHTML = html;
    return b;
  }

  function head(text) {
    injectStyle();
    var d = document.createElement('div');
    d.className = 'cf-drill-head';
    d.textContent = text;
    return d;
  }

  function logoFor(name, makes) {
    var key = String(name || '').toLowerCase();
    var m = (makes || []).find(function (x) { return String(x.name).toLowerCase() === key; });
    if (m && m.logo_url) return m.logo_url;
    if (/^mercedes/i.test(name)) return 'https://www.carlogos.org/car-logos/mercedes-benz-logo.png';
    return 'https://www.carlogos.org/car-logos/' + key.replace(/\s+/g, '-') + '-logo.png';
  }

  global.CarfoxDrill = { item: item, head: head, logoFor: logoFor, logoFallback: logoFallback, injectStyle: injectStyle };
})(typeof window !== 'undefined' ? window : this);
