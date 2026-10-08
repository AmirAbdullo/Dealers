/**
 * Buyer messaging nav badge + shared helpers for inbox/chat pages.
 */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'carfox_token';
  const USER_KEY = 'carfox_user';

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatPriceCents(cents) {
    if (!cents || cents <= 0) return 'Price on request';
    return Math.round(Number(cents) / 100).toLocaleString('en-EG') + ' EGP';
  }

  function formatRelativeTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatMessageTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  /** Short clock time for in-bubble display (e.g. 4:15 PM). */
  function formatBubbleTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function vehicleTitle(vehicle) {
    if (!vehicle) return '';
    return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  }

  function clearAuth() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) {}
  }


  // Red banner shown to a suspended account (dealer or buyer). Reads suspended/suspension_reason.
  function mountSuspensionBanner(subject) {
    if (!subject || !subject.suspended || document.getElementById('suspensionBanner')) return;
    var reason = subject.suspension_reason ? String(subject.suspension_reason).trim() : '';
    var el = document.createElement('div');
    el.id = 'suspensionBanner';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'background:#fef2f2;border-bottom:1px solid #fecaca;color:#991b1b;padding:10px 16px;font-size:14px;font-weight:600;text-align:center;';
    el.textContent = 'Your account has been suspended' + (reason ? ': ' + reason : '') + '. Contact support.';
    document.body.insertBefore(el, document.body.firstChild);
  }

  function requireBuyerPageAuth(returnTo) {
    const token = (function () {
      try {
        return localStorage.getItem(TOKEN_KEY) || '';
      } catch (_) {
        return '';
      }
    })();

    if (!token) {
      window.location.replace(
        '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
      );
      return Promise.resolve(null);
    }

    return fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(function (res) {
        if (res.status === 401 || !res.ok) {
          clearAuth();
          window.location.replace(
            '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
          );
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.user) {
          clearAuth();
          window.location.replace(
            '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
          );
          return null;
        }
        if (data.user.role !== 'buyer') {
          clearAuth();
          window.location.replace(
            '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
          );
          return null;
        }
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        } catch (_) {}
        mountSuspensionBanner(data.user);
        return { user: data.user, token: token };
      })
      .catch(function () {
        clearAuth();
        window.location.replace(
          '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
        );
        return null;
      });
  }

  function initMessagesUnreadBadge() {
    const token = (function () {
      try {
        return localStorage.getItem(TOKEN_KEY) || '';
      } catch (_) {
        return '';
      }
    })();
    if (!token) return;

    let user = null;
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) user = JSON.parse(raw);
    } catch (_) {}
    if (user && user.role && user.role !== 'buyer') return;

    fetch('/api/conversations/unread-count', {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !(data.total_unread > 0)) return;
        document.querySelectorAll('[data-messages-unread-dot]').forEach(function (el) {
          el.classList.remove('hidden');
        });
      })
      .catch(function () {});
  }

  // ---- Shared mobile bottom nav: Home · Search · Favorites · More ----
  var NAV_ICONS = {
    home: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.172 2.25 10.5V21h6.75v-6h6v6h6V10.5L12 3.172z"/></svg>',
    search: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.3 12.8l4.2 4.2-1.4 1.4-4.2-4.2A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>',
    heart: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>',
    more: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>'
  };

  function mountBuyerBottomNav() {
    if (!document.body || document.getElementById('cfBottomNav')) return;
    if (/\/buyer\/chat\.html$/.test(location.pathname)) return; // chat has its own composer bar
    var path = location.pathname.replace(/\/index\.html$/, '/');
    var isHome = path === '/';
    var isSearch = /\/(cars|search|quick-search)\.html$/.test(path) || /^\/cars\//.test(path);
    var isFav = /\/buyer\/saved-cars\.html$/.test(path);
    var isMore = !isHome && !isSearch && !isFav;
    function cls(active) {
      return 'flex flex-col items-center justify-center ' + (active ? 'text-blue-700' : 'text-gray-600 hover:text-gray-900');
    }
    // Labels carry data-i18n keys: pages that load /js/i18n/i18n.js translate them, others stay English.
    var label = function (t, key) { return '<span class="text-[11px] leading-tight mt-1" data-i18n="' + key + '">' + t + '</span>'; };
    var nav = document.createElement('nav');
    nav.id = 'cfBottomNav';
    nav.className = 'fixed bottom-0 left-0 right-0 z-[100] md:hidden border-t border-gray-200 bg-white h-16';
    nav.style.paddingBottom = 'env(safe-area-inset-bottom)';
    nav.setAttribute('aria-label', 'Main');
    nav.innerHTML =
      '<div class="mx-auto max-w-7xl grid grid-cols-4 h-full" dir="ltr">' +
      '<a href="/" class="' + cls(isHome) + '">' + NAV_ICONS.home + label('Home', 'bottomnav.home') + '</a>' +
      '<a href="/quick-search.html" data-quick-search class="' + cls(isSearch) + '">' + NAV_ICONS.search + label('Search', 'bottomnav.search') + '</a>' +
      '<a href="/buyer/saved-cars.html" class="' + cls(isFav) + '">' + NAV_ICONS.heart + label('Favorites', 'bottomnav.favorites') + '</a>' +
      '<a href="/more.html" class="' + cls(isMore) + '"><span class="relative inline-flex">' + NAV_ICONS.more +
      '<span data-messages-unread-dot class="hidden absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500" aria-hidden="true"></span></span>' + label('More', 'bottomnav.more') + '</a>' +
      '</div>';
    document.body.appendChild(nav);
    if (global.CarfoxI18n && CarfoxI18n.isReady && CarfoxI18n.isReady()) CarfoxI18n.apply(nav);
    // The Search tab opens the quick-search page; the helper script carries current filters over.
    if (!global.CarfoxQuickSearch && !document.querySelector('script[src="/js/carfox-quick-search.js"]')) {
      var s = document.createElement('script');
      s.src = '/js/carfox-quick-search.js';
      document.body.appendChild(s);
    }
  }
  if (document.body) mountBuyerBottomNav();
  else document.addEventListener('DOMContentLoaded', mountBuyerBottomNav);

  global.CarfoxBuyerNav = {
    mountBuyerBottomNav: mountBuyerBottomNav,
    escapeHtml: escapeHtml,
    formatPriceCents: formatPriceCents,
    formatRelativeTime: formatRelativeTime,
    formatMessageTime: formatMessageTime,
    formatBubbleTime: formatBubbleTime,
    vehicleTitle: vehicleTitle,
    requireBuyerPageAuth: requireBuyerPageAuth,
    initMessagesUnreadBadge: initMessagesUnreadBadge,
    clearAuth: clearAuth,
    TOKEN_KEY: TOKEN_KEY,
    USER_KEY: USER_KEY
  };
})(typeof window !== 'undefined' ? window : global);
