/**
 * CarFox PWA: registers the service worker and shows a small, dismissible "Install the app" hint.
 *
 *   - Android / Chrome: waits for the browser's beforeinstallprompt, then shows our own banner with an
 *     Install button that triggers the native prompt.
 *   - iPhone / iPad Safari: shows a one-time tip ("Share → Add to Home Screen"), since Safari has no
 *     install prompt.
 *   - Never shown inside the installed app, after an install, on the chat page, or within 30 days of
 *     being dismissed. Nothing here blocks normal browsing.
 *
 *   CarfoxPWA.showInstallHint() / CarfoxPWA.showIOSTip() exist for manual testing.
 *
 * Updates: the worker is re-checked whenever the page/app returns to the foreground (and hourly); when a new
 * deploy's worker takes over an open page, a "New version available · Refresh" pill appears (never an
 * automatic reload). CarfoxPWAUpdate.showUpdateBar() shows it for testing.
 */
(function (global) {
  'use strict';

  var DISMISS_KEY = 'carfox_pwa_dismissed_at';
  var INSTALLED_KEY = 'carfox_pwa_installed';
  var IOS_TIP_KEY = 'carfox_pwa_ios_tip_shown';
  var DISMISS_DAYS = 30;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  // ---- service worker ----
  // Pages are always fetched from the network (sw.js), but an open tab — or the installed app, which iOS/Android
  // resume instead of reloading — keeps running the HTML it loaded. So: look for a new deploy whenever the app
  // comes back to the foreground (plus hourly), and once a new worker has taken over, offer a one-tap refresh.
  // Never auto-reload: that could throw away a half-filled form.
  function showUpdateBar() {
    if (!document.body || document.getElementById('cfUpdateBar')) return;
    var bar = document.createElement('div');
    bar.id = 'cfUpdateBar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:0;right:0;margin:0 auto;width:max-content;max-width:min(calc(100vw - 24px),440px);' +
      'bottom:calc(var(--cf-nav-space,12px) + 12px);z-index:1190;white-space:nowrap;' +
      'display:flex;align-items:center;gap:10px;padding:8px 8px 8px 16px;border-radius:9999px;' +
      'background:rgba(15,23,42,.94);color:#fff;font:600 14px/1.3 Inter,ui-sans-serif,system-ui,sans-serif;' +
      'box-shadow:0 12px 30px -10px rgba(15,23,42,.45),0 2px 6px rgba(15,23,42,.18)';
    bar.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis">New version available</span>' +
      '<button type="button" data-cf-update style="flex:none;border:0;border-radius:9999px;background:#f97316;color:#fff;font:inherit;padding:6px 14px;cursor:pointer">Refresh</button>' +
      '<button type="button" data-cf-update-close aria-label="Dismiss" style="flex:none;border:0;background:none;color:rgba(255,255,255,.7);font:inherit;font-size:18px;line-height:1;padding:4px 6px;cursor:pointer">&times;</button>';
    bar.addEventListener('click', function (e) {
      if (e.target.closest('[data-cf-update]')) global.location.reload();
      else if (e.target.closest('[data-cf-update-close]')) bar.remove();
    });
    document.body.appendChild(bar);
  }

  if ('serviceWorker' in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // First install (page had no worker yet) is not an update; a later takeover means a new deploy is live.
      if (!hadController) { hadController = true; return; }
      showUpdateBar();
    });
    global.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        function check() { reg.update().catch(function () {}); }
        setInterval(check, 60 * 60 * 1000);
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') check();
        });
        global.addEventListener('pageshow', function (e) { if (e.persisted) check(); });
      }).catch(function () {});
    });
  }
  global.CarfoxPWAUpdate = { showUpdateBar: showUpdateBar };

  // ---- install hint ----
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
  var isStandalone = applyStandaloneMode();
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isIOSSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  var onChatPage = /\/(buyer|dealer)\/chat\.html$/.test(location.pathname);
  var dismissedAt = Number(lsGet(DISMISS_KEY)) || 0;
  var recentlyDismissed = Date.now() - dismissedAt < DISMISS_DAYS * 86400000;
  var deferredPrompt = null;
  var banner = null;

  function hide() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }
  function dismiss() {
    lsSet(DISMISS_KEY, String(Date.now()));
    hide();
  }

  function showBanner(opts) {
    if (banner || !document.body) return;
    banner = document.createElement('div');
    banner.id = 'cfInstallHint';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install the CarFox app');
    banner.className = 'fixed z-[90] inset-x-3 bottom-20 md:inset-x-auto md:end-4 md:bottom-4 md:w-[22rem] rounded-2xl bg-white border border-gray-200 shadow-[0_18px_40px_-20px_rgba(15,31,61,.5)] p-3 flex items-start gap-3';
    banner.innerHTML =
      '<img src="/icons/icon-192.png" alt="" width="44" height="44" class="h-11 w-11 rounded-xl shrink-0" />' +
      '<div class="min-w-0 flex-1">' +
      '<p class="text-sm font-bold text-slate-900 leading-tight">' + opts.title + '</p>' +
      '<p class="text-xs text-slate-600 mt-0.5 leading-snug">' + opts.body + '</p>' +
      (opts.action ? '<button type="button" data-install class="mt-2 inline-flex items-center rounded-lg bg-[#0f1f3d] hover:bg-[#162c57] text-white text-xs font-semibold px-3 py-1.5">' + opts.action + '</button>' : '') +
      '</div>' +
      '<button type="button" data-dismiss class="shrink-0 -m-1 p-1 text-slate-400 hover:text-slate-700" aria-label="Dismiss">' +
      '<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>';
    document.body.appendChild(banner);
    banner.querySelector('[data-dismiss]').addEventListener('click', function () { dismiss(); if (opts.onDismiss) opts.onDismiss(); });
    var act = banner.querySelector('[data-install]');
    if (act) act.addEventListener('click', function () { if (opts.onAction) opts.onAction(); });
  }

  function showInstallHint() {
    showBanner({
      title: 'Install the CarFox app',
      body: 'Faster access from your home screen, full screen, no browser bar.',
      action: 'Install',
      onAction: function () {
        if (!deferredPrompt || typeof deferredPrompt.prompt !== 'function') { hide(); return; }
        var p = deferredPrompt;
        deferredPrompt = null;
        p.prompt();
        Promise.resolve(p.userChoice).then(function (choice) {
          if (choice && choice.outcome === 'accepted') lsSet(INSTALLED_KEY, '1');
          else lsSet(DISMISS_KEY, String(Date.now()));
          hide();
        }).catch(hide);
      }
    });
  }

  function showIOSTip() {
    lsSet(IOS_TIP_KEY, '1');
    showBanner({
      title: 'Add CarFox to your Home Screen',
      body: 'Tap the Share button <svg class="inline h-4 w-4 align-text-bottom text-[#0f1f3d]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4"/></svg> in Safari, then choose <b>Add to Home Screen</b>.',
      action: null
    });
  }

  var eligible = !isStandalone && !onChatPage && !lsGet(INSTALLED_KEY) && !recentlyDismissed;

  global.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (eligible) setTimeout(showInstallHint, 3000);
  });
  global.addEventListener('appinstalled', function () {
    lsSet(INSTALLED_KEY, '1');
    hide();
  });
  if (eligible && isIOSSafari && !lsGet(IOS_TIP_KEY)) {
    global.addEventListener('load', function () { setTimeout(showIOSTip, 4000); });
  }

  global.CarfoxPWA = { showInstallHint: showInstallHint, showIOSTip: showIOSTip, hide: hide };
})(typeof window !== 'undefined' ? window : this);
