/**
 * CarFox admin session — completely separate from the site's buyer/dealer session.
 *
 *   localStorage 'carfox_admin_token' / 'carfox_admin_user'   (the site uses 'carfox_token' / 'carfox_user')
 *
 * Tokens come only from POST /api/admin/login (admin accounts only, 12h expiry) and are the only thing the
 * /api/admin/* routes accept; site tokens are rejected there and admin tokens are rejected on site routes.
 * Signing in or out here never touches a dealer/buyer session in the same browser, and vice versa.
 *
 *   CarfoxAdminAuth.token()          current admin token, or null (an expired token is cleared on read)
 *   CarfoxAdminAuth.save(t, user)    store a fresh session (login page)
 *   CarfoxAdminAuth.clear()          drop the admin session only
 *   CarfoxAdminAuth.signOut()        clear + go to the admin login
 *   CarfoxAdminAuth.loginUrl([path]) /admin/login.html?returnTo=<current admin page>
 *
 * Loaded in <head> of every admin page: an expired token is cleared before the page's own checks run, and
 * signing out in another tab sends this tab to the login page too.
 */
(function (global) {
  'use strict';
  var TOKEN_KEY = 'carfox_admin_token';
  var USER_KEY = 'carfox_admin_user';

  function lsGet(k) { try { return global.localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { global.localStorage.removeItem(k); } catch (_) {} }

  // Expiry from the JWT payload (the server still verifies the signature on every call).
  function expiresAt(token) {
    try {
      var part = String(token).split('.')[1];
      var json = global.atob(part.replace(/-/g, '+').replace(/_/g, '/'));
      var exp = JSON.parse(json).exp;
      return exp ? exp * 1000 : 0;
    } catch (_) { return 0; }
  }
  function clear() { lsDel(TOKEN_KEY); lsDel(USER_KEY); }
  function token() {
    var t = lsGet(TOKEN_KEY);
    if (!t) return null;
    var exp = expiresAt(t);
    if (!exp || exp <= Date.now()) { clear(); return null; }
    return t;
  }
  function user() {
    if (!token()) return null;
    try { return JSON.parse(lsGet(USER_KEY) || 'null'); } catch (_) { return null; }
  }
  function save(t, u) {
    lsSet(TOKEN_KEY, t);
    lsSet(USER_KEY, JSON.stringify(u || {}));
  }
  function loginUrl(path) {
    var here = path || (global.location.pathname + global.location.search);
    var ok = /^\/admin\//.test(here) && !/^\/admin\/login\.html/.test(here);
    return '/admin/login.html' + (ok ? '?returnTo=' + encodeURIComponent(here) : '');
  }
  function signOut() {
    clear();
    global.location.replace('/admin/login.html');
  }

  var onLoginPage = /^\/admin\/login\.html$/.test(global.location.pathname);
  if (!onLoginPage) {
    token(); // clears an expired session up front so the page's "no token" path redirects to the login
    global.addEventListener('storage', function (e) {
      if (e.key === TOKEN_KEY && !e.newValue) global.location.replace(loginUrl());
      if (e.key === null) global.location.replace(loginUrl()); // localStorage.clear() elsewhere
    });
  }

  global.CarfoxAdminAuth = {
    TOKEN_KEY: TOKEN_KEY,
    USER_KEY: USER_KEY,
    token: token,
    user: user,
    save: save,
    clear: clear,
    signOut: signOut,
    loginUrl: loginUrl,
    expiresAt: expiresAt
  };
})(window);
