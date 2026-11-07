/**
 * CarFox account settings — shared by buyer/account.html and dealer/account.html.
 *
 *   CarfoxAccountSettings.mount({
 *     listEl,          element that receives the settings list (Edit Profile · Notifications · Language)
 *     deleteEl,        element that receives the muted "Delete account" link (omit = no delete; buyers only)
 *     role,            'buyer' | 'dealer'
 *     user,            /api/auth/me user (full_name, email, phone)
 *     token,           bearer token
 *     language,        true to show the Language row (buyer)
 *     onProfileSaved,  function (user) after the name / phone save
 *     toast            function (kind 'ok'|'error', message)
 *   })
 *
 * Every row opens a sheet (bottom sheet on phones, centred dialog from sm). Opening the page with
 * #notifications or #profile in the URL opens that sheet (the email footers link to #notifications).
 *
 *   Edit Profile   full name (+ phone for buyers) via PATCH /api/me; email read-only; Change password block
 *                  (current + new + confirm, the signup strength rules) via POST /api/me/password
 *   Notifications  toggles saved instantly via PATCH /api/me/notifications
 *   Language       English / العربية in localStorage carfox_lang (the header AR toggle's key)
 *   Delete account confirmation modal (type DELETE) → DELETE /api/me, then sign out
 */
(function (global) {
  'use strict';

  var LANG_KEY = 'carfox_lang';
  var RULES = [
    { key: 'length', label: 'At least 8 characters', test: function (p) { return p.length >= 8; } },
    { key: 'number', label: 'At least one number (0-9)', test: function (p) { return /[0-9]/.test(p); } },
    { key: 'upper', label: 'At least one uppercase letter (A-Z)', test: function (p) { return /[A-Z]/.test(p); } },
    { key: 'lower', label: 'At least one lowercase letter (a-z)', test: function (p) { return /[a-z]/.test(p); } },
    { key: 'special', label: 'At least one special character (!@#$%^&*.)', test: function (p) { return /[^A-Za-z0-9]/.test(p); } }
  ];
  var NOTIFY_ROWS = {
    buyer: [
      { key: 'messages', label: 'Email me when a dealer replies to my message', hint: 'At most one email per conversation per hour.' },
      { key: 'saved_cars', label: 'Email me about my saved cars (price drops / sold)', hint: 'Your choice is saved; these emails start soon.', soon: true }
    ],
    dealer: [
      { key: 'messages', label: 'Email me when a buyer sends a message', hint: 'At most one email per conversation per hour.' },
      { key: 'inquiries', label: 'Email me about new inquiries', hint: 'At most one email per buyer per hour.' }
    ]
  };
  var CHEVRON = '<svg class="h-5 w-5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';
  var FIELD = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
  var LABEL = 'block text-sm font-medium text-gray-700';
  var BTN_PRIMARY = 'w-full rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function getLang() {
    try { return localStorage.getItem(LANG_KEY) === 'ar' ? 'ar' : 'en'; } catch (_) { return 'en'; }
  }

  // ---------------------------------------------------------------- sheet / dialog
  var styleDone = false;
  function injectStyle() {
    if (styleDone) return;
    styleDone = true;
    var s = document.createElement('style');
    s.textContent =
      '.cfas-switch{position:relative;display:inline-flex;flex-shrink:0;width:44px;height:26px;border-radius:999px;background:#d1d5db;transition:background .15s}' +
      '.cfas-switch::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}' +
      '.cfas-switch[aria-checked="true"]{background:#1d4ed8}' +
      '.cfas-switch[aria-checked="true"]::after{transform:translateX(18px)}' +
      '.cfas-switch:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}' +
      '.cfas-switch:disabled{opacity:.5}';
    document.head.appendChild(s);
  }

  var openSheetEl = null;
  function closeSheet() {
    if (!openSheetEl) return;
    openSheetEl.remove();
    openSheetEl = null;
    document.body.style.overflow = '';
    if (location.hash === '#notifications' || location.hash === '#profile') {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
  }
  function openSheet(title, bodyHtml, onReady) {
    closeSheet();
    var wrap = document.createElement('div');
    // Above Leaflet panes/controls (z 400–1000) on the dealer page map and the bottom nav.
    wrap.className = 'fixed inset-0 z-[1100] flex items-end sm:items-center justify-center';
    wrap.innerHTML =
      '<div class="cf-anim-backdrop absolute inset-0 bg-black/40" data-cfas-close></div>' +
      '<div role="dialog" aria-modal="true" aria-labelledby="cfasTitle" class="cf-anim-sheet relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col">' +
        '<div class="flex items-center justify-between gap-2 px-4 h-14 border-b border-gray-100 shrink-0">' +
          '<h2 id="cfasTitle" class="text-base font-bold text-gray-900">' + esc(title) + '</h2>' +
          '<button type="button" data-cfas-close class="p-2 -me-2 text-gray-500 hover:text-gray-900" aria-label="Close">' +
            '<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">' + bodyHtml + '</div>' +
      '</div>';
    wrap.addEventListener('click', function (e) { if (e.target.closest('[data-cfas-close]')) closeSheet(); });
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    openSheetEl = wrap;
    if (onReady) onReady(wrap);
    var first = wrap.querySelector('input:not([disabled]), button.cfas-switch, [data-cfas-first]');
    if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (_) {} }, 50);
    return wrap;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  // ---------------------------------------------------------------- mount
  function mount(opts) {
    injectStyle();
    var state = { user: opts.user || {}, prefs: null };
    var toast = opts.toast || function () {};
    function api(method, url, body) {
      return fetch(url, {
        method: method,
        headers: Object.assign({ Authorization: 'Bearer ' + opts.token }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
      });
    }

    // ---- settings list
    function profileSub() {
      var u = state.user;
      return [u.full_name || u.fullName, opts.role === 'buyer' ? u.phone : null].filter(Boolean).join(' · ') || 'Name, phone and password';
    }
    function notifySub() {
      if (!state.prefs) return 'Email alerts';
      var rows = NOTIFY_ROWS[opts.role] || [];
      var on = rows.filter(function (r) { return state.prefs[r.key]; }).length;
      return on === 0 ? 'All emails off' : on === rows.length ? 'All emails on' : on + ' of ' + rows.length + ' emails on';
    }
    function langSub() { return getLang() === 'ar' ? 'العربية' : 'English'; }
    function row(key, title, sub, last) {
      return '<button type="button" data-cfas-open="' + key + '" class="w-full flex items-center justify-between gap-3 px-4 py-3 text-start hover:bg-gray-50' + (last ? '' : ' border-b border-gray-100') + '">' +
        '<span class="min-w-0"><span class="block text-sm font-medium text-gray-900">' + esc(title) + '</span>' +
        '<span class="block text-xs text-gray-500 truncate" data-cfas-sub="' + key + '">' + esc(sub) + '</span></span>' +
        CHEVRON + '</button>';
    }
    function renderList() {
      opts.listEl.innerHTML =
        '<div class="bg-white border border-gray-200 rounded-lg overflow-hidden">' +
          row('profile', 'Edit Profile', profileSub(), false) +
          row('notifications', 'Notifications', notifySub(), !opts.language) +
          (opts.language ? row('language', 'Language', langSub(), true) : '') +
        '</div>';
    }
    function refreshSubs() {
      var map = { profile: profileSub(), notifications: notifySub(), language: langSub() };
      Object.keys(map).forEach(function (k) {
        var el = opts.listEl.querySelector('[data-cfas-sub="' + k + '"]');
        if (el) el.textContent = map[k];
      });
    }
    renderList();
    opts.listEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cfas-open]');
      if (!b) return;
      var k = b.getAttribute('data-cfas-open');
      if (k === 'profile') openProfile();
      else if (k === 'notifications') openNotifications();
      else if (k === 'language') openLanguage();
    });
    api('GET', '/api/me/notifications').then(function (r) { if (r.ok) { state.prefs = r.data.notifications; refreshSubs(); } });

    // ---- Edit Profile + Change password
    function openProfile() {
      var u = state.user;
      var isBuyer = opts.role === 'buyer';
      openSheet('Edit Profile',
        '<form data-cfas-profile class="space-y-4" novalidate>' +
          '<div><label class="' + LABEL + '" for="cfasName">Full name</label>' +
            '<input id="cfasName" type="text" autocomplete="name" maxlength="100" class="' + FIELD + '" value="' + esc(u.full_name || u.fullName || '') + '" /></div>' +
          (isBuyer
            ? '<div><label class="' + LABEL + '" for="cfasPhone">Phone <span class="text-gray-400 font-normal">(optional)</span></label>' +
              '<input id="cfasPhone" type="tel" inputmode="tel" autocomplete="tel" class="' + FIELD + '" placeholder="e.g. 01012345678" value="' + esc(u.phone || '') + '" /></div>'
            : '') +
          '<div><label class="' + LABEL + '" for="cfasEmail">Email</label>' +
            '<input id="cfasEmail" type="email" disabled class="' + FIELD + ' bg-gray-50 text-gray-500" value="' + esc(u.email || '') + '" />' +
            '<p class="mt-1 text-xs text-gray-500">Changing your email needs re-verification; that option is coming later.</p></div>' +
          '<p data-cfas-profile-err class="hidden text-sm text-red-700"></p>' +
          '<button type="submit" class="' + BTN_PRIMARY + '">Save changes</button>' +
        '</form>' +
        '<form data-cfas-password class="mt-6 pt-5 border-t border-gray-200 space-y-4" novalidate>' +
          '<h3 class="text-sm font-bold text-gray-900">Change password</h3>' +
          '<div><label class="' + LABEL + '" for="cfasCur">Current password</label>' +
            '<input id="cfasCur" type="password" autocomplete="current-password" class="' + FIELD + '" /></div>' +
          '<div><label class="' + LABEL + '" for="cfasNew">New password</label>' +
            '<input id="cfasNew" type="password" autocomplete="new-password" class="' + FIELD + '" />' +
            '<ul class="mt-2 space-y-1 p-3 bg-gray-50 rounded-lg border border-gray-200" aria-live="polite">' +
              RULES.map(function (r) {
                return '<li class="flex items-center gap-2 text-xs" data-cfas-rule="' + r.key + '"><span class="w-3 text-red-500" data-icon>✗</span><span class="text-red-500" data-text>' + esc(r.label) + '</span></li>';
              }).join('') +
            '</ul></div>' +
          '<div><label class="' + LABEL + '" for="cfasConfirm">Confirm new password</label>' +
            '<input id="cfasConfirm" type="password" autocomplete="new-password" class="' + FIELD + '" />' +
            '<p data-cfas-match class="hidden mt-1 text-xs text-red-600">Passwords do not match.</p></div>' +
          '<label class="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" data-cfas-show class="rounded border-gray-300" /> Show passwords</label>' +
          '<p data-cfas-pw-err class="hidden text-sm text-red-700"></p>' +
          '<button type="submit" data-cfas-pw-btn disabled class="' + BTN_PRIMARY + '">Update password</button>' +
          '<p class="text-xs text-gray-500">Forgot your current password? Sign out and use <a href="/' + (isBuyer ? 'buyer' : 'dealer') + '/login.html" class="text-blue-700 underline">Forgot password</a> on the login page.</p>' +
        '</form>',
        function (sheet) {
          var pf = sheet.querySelector('[data-cfas-profile]');
          var perr = sheet.querySelector('[data-cfas-profile-err]');
          pf.addEventListener('submit', function (e) {
            e.preventDefault();
            perr.classList.add('hidden');
            var name = sheet.querySelector('#cfasName').value.trim();
            if (!name) { perr.textContent = 'Name is required.'; perr.classList.remove('hidden'); return; }
            var payload = { fullName: name };
            if (isBuyer) payload.phone = sheet.querySelector('#cfasPhone').value.trim();
            var btn = pf.querySelector('button[type=submit]');
            btn.disabled = true; btn.textContent = 'Saving…';
            api('PATCH', '/api/me', payload).then(function (r) {
              btn.disabled = false; btn.textContent = 'Save changes';
              if (!r.ok) { perr.textContent = r.data.error || 'Could not save.'; perr.classList.remove('hidden'); return; }
              state.user = Object.assign({}, state.user, { full_name: r.data.user.full_name, fullName: r.data.user.full_name, phone: r.data.user.phone });
              refreshSubs();
              if (opts.onProfileSaved) opts.onProfileSaved(state.user);
              toast('ok', 'Profile saved.');
            }).catch(function () { btn.disabled = false; btn.textContent = 'Save changes'; perr.textContent = 'Network error. Please try again.'; perr.classList.remove('hidden'); });
          });

          var pw = sheet.querySelector('[data-cfas-password]');
          var cur = sheet.querySelector('#cfasCur');
          var nw = sheet.querySelector('#cfasNew');
          var cf = sheet.querySelector('#cfasConfirm');
          var pwBtn = sheet.querySelector('[data-cfas-pw-btn]');
          var pwErr = sheet.querySelector('[data-cfas-pw-err]');
          var matchEl = sheet.querySelector('[data-cfas-match]');
          function check() {
            var p = nw.value;
            var allOk = true;
            RULES.forEach(function (r) {
              var ok = r.test(p);
              if (!ok) allOk = false;
              var li = sheet.querySelector('[data-cfas-rule="' + r.key + '"]');
              li.querySelector('[data-icon]').textContent = ok ? '✓' : '✗';
              li.querySelector('[data-icon]').className = 'w-3 ' + (ok ? 'text-green-600' : 'text-red-500');
              li.querySelector('[data-text]').className = ok ? 'text-green-700' : 'text-red-500';
            });
            var mismatch = cf.value.length > 0 && cf.value !== p;
            matchEl.classList.toggle('hidden', !mismatch);
            pwBtn.disabled = !(allOk && cur.value.length > 0 && cf.value === p);
          }
          [cur, nw, cf].forEach(function (el) { el.addEventListener('input', function () { pwErr.classList.add('hidden'); check(); }); });
          sheet.querySelector('[data-cfas-show]').addEventListener('change', function (e) {
            [cur, nw, cf].forEach(function (el) { el.type = e.target.checked ? 'text' : 'password'; });
          });
          pw.addEventListener('submit', function (e) {
            e.preventDefault();
            check();
            if (pwBtn.disabled) return;
            pwBtn.disabled = true; pwBtn.textContent = 'Updating…';
            api('POST', '/api/me/password', { current_password: cur.value, new_password: nw.value }).then(function (r) {
              pwBtn.textContent = 'Update password';
              if (!r.ok) { pwErr.textContent = r.data.error || 'Could not update the password.'; pwErr.classList.remove('hidden'); check(); return; }
              cur.value = ''; nw.value = ''; cf.value = '';
              check();
              toast('ok', 'Password updated.');
            }).catch(function () { pwBtn.textContent = 'Update password'; pwErr.textContent = 'Network error. Please try again.'; pwErr.classList.remove('hidden'); check(); });
          });
        });
    }

    // ---- Notifications
    function openNotifications() {
      var rows = NOTIFY_ROWS[opts.role] || [];
      openSheet('Notifications',
        '<p class="text-sm text-gray-600 mb-3">Emails go to <strong>' + esc(state.user.email || 'your account email') + '</strong>.</p>' +
        '<div class="divide-y divide-gray-100 border border-gray-200 rounded-lg">' +
          rows.map(function (r) {
            return '<div class="flex items-start justify-between gap-3 px-4 py-3">' +
              '<div class="min-w-0"><p class="text-sm font-medium text-gray-900" id="cfasN_' + r.key + '">' + esc(r.label) +
                (r.soon ? ' <span class="ms-1 align-middle rounded-full bg-gray-100 text-gray-500 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5">soon</span>' : '') + '</p>' +
                '<p class="text-xs text-gray-500 mt-0.5">' + esc(r.hint) + '</p></div>' +
              '<button type="button" role="switch" aria-checked="false" aria-labelledby="cfasN_' + r.key + '" class="cfas-switch mt-0.5" data-cfas-pref="' + r.key + '" disabled></button>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<p data-cfas-pref-status class="mt-3 text-xs text-gray-500 min-h-[1rem]" aria-live="polite"></p>',
        function (sheet) {
          var status = sheet.querySelector('[data-cfas-pref-status]');
          function paint() {
            sheet.querySelectorAll('[data-cfas-pref]').forEach(function (b) {
              b.setAttribute('aria-checked', state.prefs && state.prefs[b.getAttribute('data-cfas-pref')] ? 'true' : 'false');
              b.disabled = !state.prefs;
            });
          }
          function load() {
            status.textContent = 'Loading…';
            api('GET', '/api/me/notifications').then(function (r) {
              if (!r.ok) { status.textContent = 'Could not load your settings.'; return; }
              state.prefs = r.data.notifications; status.textContent = ''; paint(); refreshSubs();
            }).catch(function () { status.textContent = 'Could not load your settings.'; });
          }
          paint();
          load();
          sheet.addEventListener('click', function (e) {
            var b = e.target.closest('[data-cfas-pref]');
            if (!b || b.disabled) return;
            var key = b.getAttribute('data-cfas-pref');
            var next = b.getAttribute('aria-checked') !== 'true';
            b.setAttribute('aria-checked', next ? 'true' : 'false');
            status.textContent = 'Saving…';
            var body = {}; body[key] = next;
            api('PATCH', '/api/me/notifications', body).then(function (r) {
              if (!r.ok) { b.setAttribute('aria-checked', next ? 'false' : 'true'); status.textContent = r.data.error || 'Could not save.'; return; }
              state.prefs = r.data.notifications; paint(); refreshSubs();
              status.textContent = 'Saved.';
            }).catch(function () { b.setAttribute('aria-checked', next ? 'false' : 'true'); status.textContent = 'Network error. Not saved.'; });
          });
        });
    }

    // ---- Language
    function openLanguage() {
      var cur = getLang();
      function opt(value, label, sub) {
        return '<button type="button" data-cfas-lang="' + value + '" role="radio" aria-checked="' + (cur === value) + '" class="w-full flex items-center justify-between gap-3 px-4 py-3 text-start hover:bg-gray-50 aria-checked:bg-blue-50">' +
          '<span><span class="block text-sm font-semibold text-gray-900"' + (value === 'ar' ? ' lang="ar" dir="rtl"' : '') + '>' + label + '</span><span class="block text-xs text-gray-500">' + sub + '</span></span>' +
          '<svg class="h-5 w-5 text-blue-700 ' + (cur === value ? '' : 'invisible') + '" data-check fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' +
        '</button>';
      }
      openSheet('Language',
        '<div role="radiogroup" aria-label="Language" class="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">' +
          opt('en', 'English', 'English') + opt('ar', 'العربية', 'Arabic') +
        '</div>' +
        '<p class="mt-3 text-xs text-gray-500">Arabic covers the home page today; the rest of CarFox is being translated and will follow this setting automatically.</p>',
        function (sheet) {
          sheet.addEventListener('click', function (e) {
            var b = e.target.closest('[data-cfas-lang]');
            if (!b) return;
            var v = b.getAttribute('data-cfas-lang');
            try { localStorage.setItem(LANG_KEY, v); } catch (_) {}
            if (global.CarfoxI18n && CarfoxI18n.setLang) CarfoxI18n.setLang(v);
            sheet.querySelectorAll('[data-cfas-lang]').forEach(function (x) {
              var on = x === b;
              x.setAttribute('aria-checked', on ? 'true' : 'false');
              x.querySelector('[data-check]').classList.toggle('invisible', !on);
            });
            refreshSubs();
            toast('ok', v === 'ar' ? 'Language set to العربية.' : 'Language set to English.');
          });
        });
    }

    // ---- Delete account (buyers)
    if (opts.deleteEl) {
      opts.deleteEl.innerHTML = '<button type="button" data-cfas-delete class="block mx-auto text-sm text-gray-400 underline underline-offset-2 hover:text-red-600">Delete account</button>';
      opts.deleteEl.querySelector('[data-cfas-delete]').addEventListener('click', function () {
        openSheet('Delete your account?',
          '<p class="text-sm text-gray-700">This permanently removes your CarFox account, your saved cars, and your conversations with dealers, including messages and attachments.</p>' +
          '<p class="mt-2 text-sm text-gray-700">Inquiries you sent stay with the dealer, without your name, email, phone or message. Anonymous listing statistics are not affected.</p>' +
          '<p class="mt-2 text-sm font-semibold text-red-700">This cannot be undone.</p>' +
          '<label class="mt-4 block text-xs font-semibold text-gray-600" for="cfasDel">Type <span class="font-mono text-red-700">DELETE</span> to confirm</label>' +
          '<input id="cfasDel" type="text" autocomplete="off" autocapitalize="characters" class="' + FIELD + ' focus:ring-red-500 focus:border-red-500" />' +
          '<p data-cfas-del-err class="hidden mt-2 text-sm text-red-700"></p>' +
          '<div class="mt-4 grid grid-cols-2 gap-2">' +
            '<button type="button" data-cfas-close class="rounded-lg border border-gray-300 text-gray-700 font-semibold py-3">Cancel</button>' +
            '<button type="button" data-cfas-del-go disabled class="rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed">Delete account</button>' +
          '</div>',
          function (sheet) {
            var input = sheet.querySelector('#cfasDel');
            var go = sheet.querySelector('[data-cfas-del-go]');
            var err = sheet.querySelector('[data-cfas-del-err]');
            input.addEventListener('input', function () { go.disabled = input.value.trim() !== 'DELETE'; });
            go.addEventListener('click', function () {
              if (input.value.trim() !== 'DELETE') return;
              go.disabled = true; go.textContent = 'Deleting…';
              api('DELETE', '/api/me', { confirm: 'DELETE' }).then(function (r) {
                if (!r.ok) { go.disabled = false; go.textContent = 'Delete account'; err.textContent = r.data.error || 'Could not delete the account.'; err.classList.remove('hidden'); return; }
                try { localStorage.removeItem('carfox_token'); localStorage.removeItem('carfox_user'); } catch (_) {}
                window.location.replace('/?account_deleted=1');
              }).catch(function () { go.disabled = false; go.textContent = 'Delete account'; err.textContent = 'Network error. Please try again.'; err.classList.remove('hidden'); });
            });
          });
      });
    }

    // Deep links from email footers / elsewhere.
    if (location.hash === '#notifications') openNotifications();
    else if (location.hash === '#profile') openProfile();

    return { openProfile: openProfile, openNotifications: openNotifications, openLanguage: openLanguage, close: closeSheet };
  }

  global.CarfoxAccountSettings = { mount: mount, passwordRules: RULES };
})(typeof window !== 'undefined' ? window : this);
