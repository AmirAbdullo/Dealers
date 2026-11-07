/**
 * CarFox floating pill bottom nav (phones, < md) — shared by the buyer nav (carfox-buyer-nav.js) and the
 * dealer nav (carfox-dealer-nav.js).
 *
 *   CarfoxPillNav.create(preset, activeKey) -> <nav id="cfBottomNav">   preset 'buyer' | 'dealer'
 *   CarfoxPillNav.mount(preset, activeKey, container?)                  appends to container or <body>
 *
 * Look: a rounded-full frosted pill (white/95 + backdrop blur, soft shadow) floating 12px above the bottom
 * edge plus the safe-area inset (iPhone home indicator in the installed PWA) and 12px from the sides; content
 * scrolls behind it. Each item = icon + small label; the active one gets the filled icon, the orange accent
 * and a soft capsule that eases in (also on tap, before navigating). Pressed items scale to 0.9 and spring back.
 *
 * Layout helpers (all < md, only while a pill is mounted — <html> gets .cf-has-pill-nav):
 *   --cf-nav-space        distance from the viewport bottom to just above the pill (84px + safe area)
 *   .cf-above-nav         fixed bars that must sit above the pill (bottom: var(--cf-nav-space))
 *   .cf-hides-nav         a visible element with this class (e.g. a form action bar) hides the pill
 *   .cf-pnav-spacer       appended to <body>: adds the safe area + 12px under the page's own bottom padding
 *   .cf-safe-bottom       bars glued to the bottom edge (sheet footers, form action bars): in the installed app
 *                         they get the home-indicator inset added to their bottom padding
 *
 * Installed PWA (display-mode: standalone / iOS navigator.standalone): <html> gets .cf-standalone and the
 * viewport gains viewport-fit=cover so env(safe-area-inset-bottom) is real; the pill then sits 22px above the
 * home-indicator area (Instagram-like) instead of 12px, and --cf-nav-space / the spacer grow to match.
 * Regular browser tabs keep the 12px + safe-area offset.
 * Unread dots keep their hooks: [data-messages-unread-dot] (buyer More), [data-inquiries-unread-dot] (dealer).
 */
(function (global) {
  'use strict';

  function svg(inner, opts) {
    opts = opts || {};
    return '<svg class="cf-pnav-svg" viewBox="0 0 24 24" aria-hidden="true" ' +
      (opts.fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="' + (opts.sw || 1.8) + '" stroke-linecap="round" stroke-linejoin="round"') +
      '>' + inner + '</svg>';
  }
  // Outline (idle) and filled / bold (active) variants.
  var ICONS = {
    home: {
      off: svg('<path d="M3.5 10.2 12 3.5l8.5 6.7V20a1 1 0 0 1-1 1H15v-6.2H9V21H4.5a1 1 0 0 1-1-1z"/>'),
      on: svg('<path d="M11.4 2.7a1 1 0 0 1 1.2 0l8.5 6.7c.24.19.4.48.4.79V20a2 2 0 0 1-2 2H15a1 1 0 0 1-1-1v-5.2h-4V21a1 1 0 0 1-1 1H4.5a2 2 0 0 1-2-2v-9.8c0-.31.16-.6.4-.79z"/>', { fill: true })
    },
    search: {
      off: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/>'),
      on: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/>', { sw: 2.8 })
    },
    heart: {
      off: svg('<path d="M12 20.5s-7.8-4.6-9.2-9.5C1.9 7.7 4 4.5 7.3 4.5c1.9 0 3.5 1 4.7 2.6 1.2-1.6 2.8-2.6 4.7-2.6 3.3 0 5.4 3.2 4.5 6.5-1.4 4.9-9.2 9.5-9.2 9.5z"/>'),
      on: svg('<path d="M12 21.3a1 1 0 0 1-.5-.14c-.34-.2-8.3-4.92-9.76-10.08C.7 7.3 3.25 3.5 7.3 3.5c1.83 0 3.47.8 4.7 2.18C13.23 4.3 14.87 3.5 16.7 3.5c4.05 0 6.6 3.8 5.56 7.58-1.46 5.16-9.42 9.88-9.76 10.08a1 1 0 0 1-.5.14z"/>', { fill: true })
    },
    more: {
      off: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
      on: svg('<path d="M4 7h16M4 12h16M4 17h16"/>', { sw: 2.8 })
    },
    car: {
      off: svg('<path d="M5 12.5 6.6 8a2 2 0 0 1 1.9-1.4h7a2 2 0 0 1 1.9 1.4l1.6 4.5M4 12.5h16v4.5a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1V16h-9v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M7.5 14.5h.01M16.5 14.5h.01" stroke-width="2.6"/>'),
      on: svg('<path d="M8.5 5.6h7a3 3 0 0 1 2.84 2.03l1.5 4.27A2 2 0 0 1 21 13.7V17a2 2 0 0 1-2 2h-1.5a2 2 0 0 1-2-2v-.1h-7V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.3a2 2 0 0 1 1.16-1.8l1.5-4.27A3 3 0 0 1 8.5 5.6zm0 2a1 1 0 0 0-.95.68L6.4 11.5h11.2l-1.15-3.22a1 1 0 0 0-.95-.68zM7.5 13.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm9 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/>', { fill: true })
    },
    chat: {
      off: svg('<path d="M20.5 11.5c0 4.1-3.8 7.5-8.5 7.5-1.2 0-2.3-.2-3.3-.6L4 19.5l1.2-3.6c-1.1-1.3-1.7-2.8-1.7-4.4C3.5 7.4 7.3 4 12 4s8.5 3.4 8.5 7.5z"/>'),
      on: svg('<path d="M12 3c5.2 0 9.5 3.8 9.5 8.5S17.2 20 12 20c-1.25 0-2.47-.21-3.6-.62l-4.12 1.1a1 1 0 0 1-1.21-1.28l1.04-3.13A7.9 7.9 0 0 1 2.5 11.5C2.5 6.8 6.8 3 12 3z"/>', { fill: true })
    },
    user: {
      off: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.6 3.9-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>'),
      on: svg('<path d="M12 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 11.5c4.12 0 7.78 2.2 8.48 6.28a1 1 0 0 1-.99 1.22H4.51a1 1 0 0 1-.99-1.22C4.22 16.7 7.88 14.5 12 14.5z"/>', { fill: true })
    }
  };

  var PRESETS = {
    buyer: [
      { key: 'home', href: '/', label: 'Home', i18n: 'bottomnav.home', icon: 'home' },
      { key: 'search', href: '/cars.html', label: 'Search', i18n: 'bottomnav.search', icon: 'search', attrs: ' data-quick-search' },
      { key: 'favorites', href: '/buyer/saved-cars.html', label: 'Favorites', i18n: 'bottomnav.favorites', icon: 'heart' },
      { key: 'more', href: '/more.html', label: 'More', i18n: 'bottomnav.more', icon: 'more', dot: 'data-messages-unread-dot' }
    ],
    dealer: [
      { key: 'dashboard', href: '/dealer/dashboard.html', label: 'Dashboard', icon: 'home' },
      { key: 'inventory', href: '/dealer/inventory.html', label: 'Inventory', icon: 'car' },
      { key: 'inquiries', href: '/dealer/inquiries.html', label: 'Inquiries', icon: 'chat', dot: 'data-inquiries-unread-dot' },
      { key: 'account', href: '/dealer/account.html', label: 'Account', icon: 'user' }
    ]
  };

  // Installed app (display-mode: standalone, or iOS navigator.standalone): mark <html> with .cf-standalone and
  // add viewport-fit=cover so iOS reports the real safe-area insets (without it env(safe-area-inset-bottom) is 0
  // and bottom bars sit on the home indicator). Regular browser tabs are left untouched.
  function applyStandaloneMode() {
    var root = document.documentElement;
    if (root.classList.contains('cf-standalone')) return true;
    var standalone = (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || global.navigator.standalone === true;
    if (!standalone) return false;
    root.classList.add('cf-standalone');
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && !/viewport-fit=cover/.test(vp.content)) vp.content = vp.content + ', viewport-fit=cover';
    return true;
  }

  // Standalone-only layout rules; emitted twice: under the display-mode media query (CSS-only) and under
  // html.cf-standalone (covers iOS versions that only expose navigator.standalone).
  function standaloneRules(prefix) {
    return prefix + '.cf-pnav-nav{bottom:calc(22px + env(safe-area-inset-bottom))}' +
      prefix + '.cf-pnav-spacer{height:calc(22px + env(safe-area-inset-bottom))}' +
      (prefix ? 'html.cf-standalone.cf-has-pill-nav' : 'html.cf-has-pill-nav') + '{--cf-nav-space:calc(94px + env(safe-area-inset-bottom))}' +
      prefix + '.cf-above-nav{padding-bottom:0 !important}';
  }

  var styleDone = false;
  function injectStyle() {
    if (styleDone) return;
    styleDone = true;
    var s = document.createElement('style');
    s.id = 'cfPillNavStyle';
    s.textContent =
      '.cf-pnav-nav{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:100;margin:0 auto;max-width:28rem;height:60px;' +
        'border-radius:9999px;background:rgba(255,255,255,.95);-webkit-backdrop-filter:saturate(1.6) blur(18px);backdrop-filter:saturate(1.6) blur(18px);' +
        'box-shadow:0 10px 30px -8px rgba(15,31,61,.28),0 2px 6px rgba(15,31,61,.08),0 0 0 1px rgba(15,23,42,.06);transition:transform .25s ease,opacity .25s ease}' +
      '@media (min-width:768px){.cf-pnav-nav{display:none}}' +
      '.cf-pnav-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));height:100%;padding:0 6px}' +
      '.cf-pnav-item{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#64748b;' +
        '-webkit-tap-highlight-color:transparent;text-decoration:none;transition:transform .32s cubic-bezier(.34,1.56,.64,1),color .2s ease;touch-action:manipulation}' +
      '.cf-pnav-item.is-pressed{transform:scale(.9);transition-duration:.09s}' +
      '.cf-pnav-item:focus-visible{outline:none}.cf-pnav-item:focus-visible .cf-pnav-ind{opacity:1;transform:scale(1);box-shadow:0 0 0 2px #fb923c}' +
      '.cf-pnav-ind{position:absolute;top:7px;left:50%;width:52px;height:30px;margin-left:-26px;border-radius:9999px;background:#fff1e6;' +
        'opacity:0;transform:scale(.55);transition:opacity .22s ease,transform .32s cubic-bezier(.34,1.56,.64,1)}' +
      '.cf-pnav-icon{position:relative;display:inline-flex;width:24px;height:24px;margin-top:1px}' +
      '.cf-pnav-svg{width:24px;height:24px}' +
      '.cf-pnav-icon .is-on{display:none}' +
      '.cf-pnav-label{position:relative;font-size:10.5px;line-height:1;font-weight:600;letter-spacing:.01em;white-space:nowrap}' +
      '.cf-pnav-item.is-active{color:#ea580c}' +
      '.cf-pnav-item.is-active .cf-pnav-ind{opacity:1;transform:scale(1)}' +
      '.cf-pnav-item.is-active .is-on{display:inline}.cf-pnav-item.is-active .is-off{display:none}' +
      '.cf-pnav-dot{position:absolute;top:-1px;right:-3px;width:9px;height:9px;border-radius:9999px;background:#ef4444;box-shadow:0 0 0 2px #fff}' +
      '.cf-pnav-spacer{display:none}' +
      '@media (max-width:767.98px){' +
        'html.cf-has-pill-nav{--cf-nav-space:calc(84px + env(safe-area-inset-bottom))}' +
        '.cf-pnav-spacer{display:block;height:calc(12px + env(safe-area-inset-bottom))}' +
        'html.cf-has-pill-nav .cf-above-nav{bottom:var(--cf-nav-space)}' +
        // A bar hidden by sliding down its own height (translate-y-full) would stay on screen around the pill.
        'html.cf-has-pill-nav .cf-above-nav.translate-y-full{transform:translateY(calc(100% + var(--cf-nav-space) + 24px))}' +
        'html.cf-has-pill-nav #cfInstallHint{bottom:calc(var(--cf-nav-space) + 4px)}' +
        'body:has(.cf-hides-nav:not(.hidden)) .cf-pnav-nav{opacity:0;transform:translateY(24px);pointer-events:none}' +
      '}' +
      '@media (display-mode:standalone) and (max-width:767.98px){' + standaloneRules('') + '}' +
      '@media (max-width:767.98px){' + standaloneRules('html.cf-standalone ') + '}' +
      '@media (display-mode:standalone){.cf-safe-bottom{padding-bottom:calc(1rem + env(safe-area-inset-bottom)) !important}}' +
      'html.cf-standalone .cf-safe-bottom{padding-bottom:calc(1rem + env(safe-area-inset-bottom)) !important}' +
      '@media (prefers-reduced-motion:reduce){.cf-pnav-item,.cf-pnav-ind,.cf-pnav-nav{transition:none}}';
    document.head.appendChild(s);
  }

  function setActive(nav, key) {
    nav.querySelectorAll('.cf-pnav-item').forEach(function (a) {
      var on = a.getAttribute('data-pill-key') === key;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function create(preset, activeKey) {
    injectStyle();
    var items = PRESETS[preset] || PRESETS.buyer;
    var nav = document.createElement('nav');
    nav.id = 'cfBottomNav';
    nav.className = 'cf-pnav-nav';
    nav.setAttribute('aria-label', 'Main');
    nav.innerHTML =
      '<div class="cf-pnav-row" dir="ltr">' +
      items.map(function (it) {
        var ic = ICONS[it.icon];
        return '<a href="' + it.href + '" class="cf-pnav-item" data-pill-key="' + it.key + '"' + (it.attrs || '') + '>' +
          '<span class="cf-pnav-ind" aria-hidden="true"></span>' +
          '<span class="cf-pnav-icon"><span class="is-off">' + ic.off + '</span><span class="is-on">' + ic.on + '</span>' +
          (it.dot ? '<span ' + it.dot + ' class="hidden cf-pnav-dot" aria-hidden="true"></span>' : '') + '</span>' +
          '<span class="cf-pnav-label"' + (it.i18n ? ' data-i18n="' + it.i18n + '"' : '') + '>' + it.label + '</span>' +
          '</a>';
      }).join('') +
      '</div>';

    // Press feedback that also works on iOS (where :active needs a touch listener).
    function release() { nav.querySelectorAll('.is-pressed').forEach(function (x) { x.classList.remove('is-pressed'); }); }
    nav.addEventListener('pointerdown', function (e) { var a = e.target.closest('.cf-pnav-item'); if (a) a.classList.add('is-pressed'); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { nav.addEventListener(t, release); });
    // Tapping another tab moves the active state right away (the capsule eases over) before the page changes.
    nav.addEventListener('click', function (e) {
      var a = e.target.closest('.cf-pnav-item');
      if (a && !e.defaultPrevented && !e.metaKey && !e.ctrlKey) setActive(nav, a.getAttribute('data-pill-key'));
    });

    // Ease the active capsule in after first paint so arriving on a page shows the change.
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !global.requestAnimationFrame) setActive(nav, activeKey);
    else requestAnimationFrame(function () { requestAnimationFrame(function () { setActive(nav, activeKey); }); });
    return nav;
  }

  applyStandaloneMode();

  function mount(preset, activeKey, container) {
    if (document.getElementById('cfBottomNav')) return document.getElementById('cfBottomNav');
    var nav = create(preset, activeKey);
    (container || document.body).appendChild(nav);
    document.documentElement.classList.add('cf-has-pill-nav');
    if (!document.querySelector('.cf-pnav-spacer')) {
      var sp = document.createElement('div');
      sp.className = 'cf-pnav-spacer';
      sp.setAttribute('aria-hidden', 'true');
      document.body.appendChild(sp);
    }
    return nav;
  }

  global.CarfoxPillNav = { create: create, mount: mount, setActive: setActive, PRESETS: PRESETS, applyStandaloneMode: applyStandaloneMode };
})(typeof window !== 'undefined' ? window : this);
