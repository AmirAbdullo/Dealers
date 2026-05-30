/**
 * Shared buyer auth helpers for public pages.
 * Keys: carfox_token, carfox_user
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

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function getStoredUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      let parsed = JSON.parse(raw);
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function clearAuth() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) {}
  }

  function normalizeRole(user) {
    if (!user || user.role == null) return '';
    return String(user.role).trim().toLowerCase();
  }

  function isBuyerUser(user) {
    const role = normalizeRole(user);
    if (role === 'dealer' || role === 'admin') return false;
    return role === 'buyer';
  }

  function isBuyerSession() {
    const token = getToken();
    const user = getStoredUser();
    if (!token || !user) return false;
    const role = normalizeRole(user);
    if (role === 'dealer' || role === 'admin') return false;
    return role === 'buyer' || role === '';
  }

  function getAccountNavHref() {
    const token = getToken();
    const user = getStoredUser();
    if (!token || !user) return '/buyer/login.html';
    const role = normalizeRole(user);
    if (role === 'buyer') return '/buyer/account.html';
    if (role === 'dealer') return '/dealer/dashboard.html';
    if (role === 'admin') return '/admin/applications.html';
    return '/buyer/login.html';
  }

  function applyAccountNavRouting() {
    document.querySelectorAll('[data-nav="account"]').forEach(function (link) {
      link.href = getAccountNavHref();
    });
  }

  function buyerFirstName(user) {
    const name = user && (user.full_name || user.fullName)
      ? String(user.full_name || user.fullName).trim()
      : '';
    if (name) return name.split(/\s+/)[0];
    if (user && user.email) return String(user.email).split('@')[0];
    return 'Account';
  }

  function bindSignOut() {
    document.querySelectorAll('[data-carfox-sign-out]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        clearAuth();
        window.location.reload();
      });
    });
  }

  function renderSignedInNav(options) {
    options = options || {};
    const desktopId = options.desktopAuthId || 'desktopAuth';
    const mobileId = options.mobileAuthId || 'mobileAuth';

    if (!isBuyerSession()) return false;

    const user = getStoredUser();
    const first = buyerFirstName(user);
    const desktopAuth = document.getElementById(desktopId);
    const mobileAuth = document.getElementById(mobileId);

    const desktopHtml =
      '<a href="/buyer/account.html" class="text-sm font-semibold text-gray-900 hover:text-blue-700">' + escapeHtml(first) + '</a>' +
      '<button type="button" data-carfox-sign-out class="text-sm text-gray-500 hover:text-gray-900 underline">Sign Out</button>' +
      '<a href="/dealer/signup.html" class="inline-flex items-center rounded-lg bg-blue-700 px-4 py-2 text-white text-sm font-semibold hover:bg-blue-800">Become a Dealer</a>';

    const mobileHtml =
      '<a href="/buyer/account.html" class="font-semibold text-gray-900 hover:text-blue-700">' + escapeHtml(first) + '</a>' +
      '<button type="button" data-carfox-sign-out class="text-sm text-gray-500 hover:text-gray-900 underline">Sign Out</button>' +
      '<a href="/dealer/signup.html" class="inline-flex items-center rounded-lg bg-blue-700 px-4 py-2 text-white font-semibold hover:bg-blue-800">Become a Dealer</a>';

    if (desktopAuth) desktopAuth.innerHTML = desktopHtml;
    if (mobileAuth) mobileAuth.innerHTML = mobileHtml;
    bindSignOut();
    return true;
  }

  function validateBuyerSession(options) {
    options = options || {};
    const token = getToken();
    if (!token) return Promise.resolve(false);

    return fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(function (res) {
        if (res.status === 401) {
          clearAuth();
          return false;
        }
        if (!res.ok) return isBuyerSession();
        return res.json().then(function (data) {
          if (data && data.user && isBuyerUser(data.user)) {
            try {
              localStorage.setItem(USER_KEY, JSON.stringify(data.user));
            } catch (_) {}
            renderSignedInNav(options);
            return true;
          }
          if (data && data.user) {
            const role = normalizeRole(data.user);
            if (role === 'dealer' || role === 'admin') return false;
          }
          return isBuyerSession();
        });
      })
      .catch(function () {
        return isBuyerSession();
      });
  }

  function parseReturnToRedirect() {
    try {
      const params = new URLSearchParams(window.location.search);
      let returnTo = params.get('returnTo');
      const action = params.get('action');
      if (!returnTo || !returnTo.startsWith('/cars/')) return null;
      const parts = returnTo.split('/').filter(Boolean);
      if (parts.length !== 2 || parts[0] !== 'cars' || !/^\d+$/.test(parts[1])) return null;
      if (action === 'contact') {
        returnTo += (returnTo.indexOf('?') >= 0 ? '&' : '?') + 'openInquiry=1';
      }
      return returnTo;
    } catch (_) {
      return null;
    }
  }

  function initBuyerNav(options) {
    options = options || {};
    applyAccountNavRouting();
    renderSignedInNav(options);
    if (options.validate !== false) {
      validateBuyerSession(options).then(function () {
        applyAccountNavRouting();
      });
    }
  }

  global.CarfoxAuth = {
    TOKEN_KEY: TOKEN_KEY,
    USER_KEY: USER_KEY,
    getToken: getToken,
    getStoredUser: getStoredUser,
    clearAuth: clearAuth,
    isBuyerSession: isBuyerSession,
    isBuyerUser: isBuyerUser,
    buyerFirstName: buyerFirstName,
    renderSignedInNav: renderSignedInNav,
    validateBuyerSession: validateBuyerSession,
    initBuyerNav: initBuyerNav,
    getAccountNavHref: getAccountNavHref,
    applyAccountNavRouting: applyAccountNavRouting,
    parseReturnToRedirect: parseReturnToRedirect
  };
})(typeof window !== 'undefined' ? window : global);
