/**
 * Shared buyer auth helpers for public pages.
 * Buyer session: carfox_token + carfox_user. Dealer session (own keys, see carfox-dealer-nav.js):
 * carfox_dealer_token + carfox_dealer_user. Both can exist in one browser; signing out of one never
 * touches the other. Public pages that show "who is signed in" use getPublicSession(), which prefers the buyer.
 */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'carfox_token';
  const USER_KEY = 'carfox_user';
  const DEALER_TOKEN_KEY = 'carfox_dealer_token';
  const DEALER_USER_KEY = 'carfox_dealer_user';

  // Dealer sessions used to live under the buyer keys. Move one over once (same code in carfox-dealer-nav.js),
  // so dealers stay signed in and the buyer keys only ever hold a buyer session.
  (function moveLegacyDealerSession() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      let u = raw ? JSON.parse(raw) : null;
      if (typeof u === 'string') u = JSON.parse(u);
      if (!u || String(u.role || '').toLowerCase() !== 'dealer') return;
      const t = localStorage.getItem(TOKEN_KEY);
      if (t && !localStorage.getItem(DEALER_TOKEN_KEY)) {
        localStorage.setItem(DEALER_TOKEN_KEY, t);
        localStorage.setItem(DEALER_USER_KEY, JSON.stringify(u));
      }
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) {}
  })();

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

  // The site never issues admin sessions; a stored site session for an admin account (left over from before
  // admins got their own sign-in) is dropped on load.
  (function dropLegacyAdminSiteSession() {
    const u = getStoredUser();
    if (u && String(u.role || '').toLowerCase() === 'admin') clearAuth();
  })();

  function normalizeRole(user) {
    if (!user || user.role == null) return '';
    return String(user.role).trim().toLowerCase();
  }

  function isBuyerUser(user) {
    return normalizeRole(user) === 'buyer';
  }

  function isBuyerSession() {
    const token = getToken();
    const user = getStoredUser();
    if (!token || !user) return false;
    const role = normalizeRole(user);
    return role === 'buyer' || role === '';
  }

  // ---- Dealer session (read-only here; dealer pages manage it through carfox-dealer-nav.js) ----
  function getDealerToken() {
    try {
      return localStorage.getItem(DEALER_TOKEN_KEY) || '';
    } catch (_) {
      return '';
    }
  }
  function getDealerUser() {
    try {
      const u = JSON.parse(localStorage.getItem(DEALER_USER_KEY) || 'null');
      return u && typeof u === 'object' ? u : null;
    } catch (_) {
      return null;
    }
  }
  function clearDealerAuth() {
    try {
      localStorage.removeItem(DEALER_TOKEN_KEY);
      localStorage.removeItem(DEALER_USER_KEY);
    } catch (_) {}
  }

  // The session public headers / menus show: the buyer session when there is one, else the dealer session.
  // { kind: 'buyer' | 'dealer', token, user, clear() } or null.
  function getPublicSession() {
    const bt = getToken();
    if (bt) return { kind: 'buyer', token: bt, user: getStoredUser(), userKey: USER_KEY, clear: clearAuth };
    const dt = getDealerToken();
    if (dt) return { kind: 'dealer', token: dt, user: getDealerUser(), userKey: DEALER_USER_KEY, clear: clearDealerAuth };
    return null;
  }

  function getAccountNavHref() {
    if (isBuyerSession()) return '/buyer/account.html';
    if (getDealerToken()) return '/dealer/dashboard.html';
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
            mountSuspensionBanner(data.user);
            return true;
          }
          if (data && data.user) {
            const role = normalizeRole(data.user);
            if (role !== 'buyer' && role !== '') return false;
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
    DEALER_TOKEN_KEY: DEALER_TOKEN_KEY,
    DEALER_USER_KEY: DEALER_USER_KEY,
    getDealerToken: getDealerToken,
    getDealerUser: getDealerUser,
    clearDealerAuth: clearDealerAuth,
    getPublicSession: getPublicSession,
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
