/**
 * CarFox filter pills + quick picks — one component for the browse page and the home hero.
 *
 *   CarfoxFilterPills.mount(container, { onPill, onQuick })
 *     Renders the category pills (Price · Make/Model · Body Type · Year, each with a chevron) and the
 *     quick-pick chips (Under 500k EGP · Under 100,000 km · 2020 or newer · Automatic).
 *     - onPill(sectionKey)       called when a pill is tapped (omit to wire clicks yourself)
 *     - onQuick(filterKey, value) called when a quick pick is tapped
 *     Returns { update(isActive) } where isActive(kind, key, value) -> bool toggles .is-active.
 *
 * Markup contract (used by cars.html's own state code): pills are [data-open-section=key], quick
 * picks are [data-quick=key][data-value=v]; elements tied to an admin-toggleable filter section carry
 * data-filter-section so the existing catalog toggle code hides them. Labels translate through
 * CarfoxI18n when it is on the page (keys filters.pill_* / filters.quick_*) and re-render on
 * carfox:langchange.
 */
(function (global) {
  'use strict';

  var PILLS = [
    { key: 'price', label: 'Price', i18n: 'filters.pill_price' },
    { key: 'make', label: 'Make/Model', i18n: 'filters.pill_make' },
    { key: 'body_type', label: 'Body Type', i18n: 'filters.pill_body', section: 'body_type' },
    { key: 'year', label: 'Year', i18n: 'filters.pill_year' }
  ];
  var QUICK = [
    { key: 'max_price', value: '500000', label: 'Under 500k EGP', i18n: 'filters.quick_price' },
    { key: 'max_mileage', value: '100000', label: 'Under 100,000 km', i18n: 'filters.quick_mileage', section: 'mileage' },
    { key: 'min_year', value: '2020', label: '2020 or newer', i18n: 'filters.quick_year' },
    { key: 'transmission', value: 'Automatic', label: 'Automatic', i18n: 'filters.quick_transmission', section: 'transmission' }
  ];
  var PILL_CLS = 'cat-pill shrink-0 inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white ps-3.5 pe-2.5 py-2 text-sm font-semibold text-gray-800';
  var QUICK_CLS = 'quick-chip shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700';
  var CHEVRON = '<svg class="cat-pill-chevron h-4 w-4 text-gray-400 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var s = document.createElement('style');
    s.textContent =
      '.cat-pill.is-active{background:#0f1f3d;border-color:#0f1f3d;color:#fff}' +
      '.cat-pill.is-active .cat-pill-chevron{color:rgba(255,255,255,.7)}' +
      '.quick-chip.is-active{background:#e8edf7;border-color:#0f1f3d;color:#0f1f3d;font-weight:600}' +
      '.cf-pill-row{scrollbar-width:none}.cf-pill-row::-webkit-scrollbar{display:none}';
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function tx(key, fallback) {
    var i = global.CarfoxI18n;
    return i && i.has && i.has(key) ? i.t(key) : fallback;
  }

  function render(container, opts) {
    container.innerHTML =
      '<div class="cf-pill-row mt-3 -mx-4 px-4 flex gap-2 overflow-x-auto" data-cf-pills>' +
      PILLS.map(function (p) {
        return '<button type="button" data-open-section="' + p.key + '"' + (p.section ? ' data-filter-section="' + p.section + '"' : '') +
          ' class="' + PILL_CLS + '">' + esc(tx(p.i18n, p.label)) + ' ' + CHEVRON + '</button>';
      }).join('') +
      '</div>' +
      '<div class="cf-pill-row mt-2 -mx-4 px-4 flex gap-2 overflow-x-auto" data-cf-quick>' +
      QUICK.map(function (q) {
        return '<button type="button" data-quick="' + q.key + '" data-value="' + esc(q.value) + '"' + (q.section ? ' data-filter-section="' + q.section + '"' : '') +
          ' aria-pressed="false" class="' + QUICK_CLS + '">' + esc(tx(q.i18n, q.label)) + '</button>';
      }).join('') +
      '</div>';
    if (opts.onPill) {
      container.querySelectorAll('[data-open-section]').forEach(function (b) {
        b.addEventListener('click', function () { opts.onPill(b.getAttribute('data-open-section')); });
      });
    }
    if (opts.onQuick) {
      container.querySelectorAll('[data-quick]').forEach(function (b) {
        b.addEventListener('click', function () { opts.onQuick(b.getAttribute('data-quick'), b.getAttribute('data-value')); });
      });
    }
  }

  function mount(container, opts) {
    if (!container) return null;
    opts = opts || {};
    injectStyle();
    render(container, opts);
    if (global.CarfoxI18n) {
      // Re-render once the dictionaries arrive and on every live language switch.
      global.addEventListener('carfox:i18nready', function () { render(container, opts); });
      global.addEventListener('carfox:langchange', function () { render(container, opts); });
      if (global.CarfoxI18n.isReady && global.CarfoxI18n.isReady()) render(container, opts);
    }
    return {
      update: function (isActive) {
        container.querySelectorAll('[data-open-section]').forEach(function (b) {
          b.classList.toggle('is-active', !!isActive('pill', b.getAttribute('data-open-section')));
        });
        container.querySelectorAll('[data-quick]').forEach(function (b) {
          var on = !!isActive('quick', b.getAttribute('data-quick'), b.getAttribute('data-value'));
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
    };
  }

  global.CarfoxFilterPills = { mount: mount, PILLS: PILLS, QUICK: QUICK };
})(typeof window !== 'undefined' ? window : this);
