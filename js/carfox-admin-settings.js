/**
 * CarFox admin account settings — shared by every admin page (not the login page).
 *
 * Adds an "Account" button next to the header's #signOutBtn and a "Change password" dialog that calls
 * PATCH /api/admin/password with the admin session (js/carfox-admin-auth.js). On success the server revokes
 * every other admin session for this account and returns a fresh token, which is saved so this tab stays in.
 *
 * Load after carfox-admin-auth.js:  <script src="/js/carfox-admin-settings.js" defer></script>
 */
(function () {
  'use strict';
  if (/^\/admin\/login\.html$/.test(location.pathname)) return;

  var RULES = [
    { re: /.{8,}/, label: '8+ characters' },
    { re: /[0-9]/, label: 'A number' },
    { re: /[A-Z]/, label: 'An uppercase letter' },
    { re: /[a-z]/, label: 'A lowercase letter' },
    { re: /[^A-Za-z0-9]/, label: 'A symbol' }
  ];


  // Show/hide eye toggle — same icons and behaviour as the site's login pages (login.html .password-toggle).
  var EYE = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
  var EYE_OFF = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21"/></svg>';
  function pwField(id, autocomplete) {
    return '<div class="relative mt-1">' +
      '<input id="' + id + '" type="password" autocomplete="' + autocomplete + '" required class="w-full rounded-lg border border-gray-300 py-2 pl-3 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" />' +
      '<button type="button" class="password-toggle absolute right-3 top-1/2 -translate-y-1/2 flex items-center text-gray-400 hover:text-gray-600" aria-label="Show password">' +
        '<span class="password-toggle-eye" aria-hidden="true">' + EYE + '</span>' +
        '<span class="password-toggle-eye-off hidden" aria-hidden="true">' + EYE_OFF + '</span>' +
      '</button>' +
    '</div>';
  }
  function setPasswordVisible(btn, show) {
    var input = btn.parentElement.querySelector('input');
    input.type = show ? 'text' : 'password';
    btn.querySelector('.password-toggle-eye').classList.toggle('hidden', show);
    btn.querySelector('.password-toggle-eye-off').classList.toggle('hidden', !show);
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function toast(msg, kind) {
    if (window.CarfoxUI && CarfoxUI.toast) CarfoxUI.toast(msg, kind || 'success');
  }

  function mount() {
    var signOut = document.getElementById('signOutBtn');
    if (!signOut || document.getElementById('adminAccountBtn')) return;

    var btn = el(
      '<button id="adminAccountBtn" type="button" class="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 font-semibold" aria-haspopup="dialog" title="Account settings">' +
        '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
        '<span class="hidden sm:inline">Password</span>' +
      '</button>'
    );
    signOut.parentNode.insertBefore(btn, signOut);

    var modal = el(
      '<div id="adminPasswordModal" class="fixed inset-0 z-50 hidden" role="dialog" aria-modal="true" aria-labelledby="adminPwTitle">' +
        '<div class="absolute inset-0 bg-black/40" data-close></div>' +
        '<div class="relative mx-auto mt-20 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 shadow-xl">' +
          '<h2 id="adminPwTitle" class="text-lg font-bold text-gray-900">Change admin password</h2>' +
          '<p id="adminPwEmail" class="mt-1 text-sm text-gray-500"></p>' +
          '<form id="adminPwForm" class="mt-4 space-y-3" novalidate>' +
            '<label class="block text-sm font-semibold text-gray-700">Current password' +
              pwField('adminPwCurrent', 'current-password') +
            '</label>' +
            '<label class="block text-sm font-semibold text-gray-700">New password' +
              pwField('adminPwNew', 'new-password') +
            '</label>' +
            '<ul id="adminPwRules" class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-500"></ul>' +
            '<label class="block text-sm font-semibold text-gray-700">Confirm new password' +
              pwField('adminPwConfirm', 'new-password') +
            '</label>' +
            '<p id="adminPwError" class="hidden rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800" role="alert"></p>' +
            '<p class="text-xs text-gray-500">Other admin sessions for this account will be signed out.</p>' +
            '<div class="flex justify-end gap-2 pt-1">' +
              '<button type="button" data-close class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>' +
              '<button id="adminPwSubmit" type="submit" class="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">Update password</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(modal);

    var $ = function (id) { return document.getElementById(id); };
    var form = $('adminPwForm');
    var errBox = $('adminPwError');
    var rulesList = $('adminPwRules');
    RULES.forEach(function (r, i) {
      rulesList.appendChild(el('<li data-rule="' + i + '">○ ' + r.label + '</li>'));
    });

    function renderRules() {
      var v = $('adminPwNew').value;
      RULES.forEach(function (r, i) {
        var li = rulesList.querySelector('[data-rule="' + i + '"]');
        var ok = r.re.test(v);
        li.textContent = (ok ? '✓ ' : '○ ') + r.label;
        li.className = ok ? 'text-green-700' : 'text-gray-500';
      });
    }
    function showError(msg) {
      errBox.textContent = msg;
      errBox.classList.toggle('hidden', !msg);
    }
    function hideAllPasswords() {
      modal.querySelectorAll('.password-toggle').forEach(function (t) { setPasswordVisible(t, false); });
    }
    function open() {
      form.reset();
      hideAllPasswords();
      showError('');
      renderRules();
      var u = window.CarfoxAdminAuth && CarfoxAdminAuth.user();
      $('adminPwEmail').textContent = u && u.email ? u.email : '';
      modal.classList.remove('hidden');
      setTimeout(function () { $('adminPwCurrent').focus(); }, 30);
    }
    function close() {
      modal.classList.add('hidden');
      form.reset();
      hideAllPasswords();
      btn.focus();
    }

    btn.addEventListener('click', open);
    modal.querySelectorAll('.password-toggle').forEach(function (t) {
      t.addEventListener('click', function () { setPasswordVisible(t, t.parentElement.querySelector('input').type === 'password'); });
    });
    modal.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
    $('adminPwNew').addEventListener('input', renderRules);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var current = $('adminPwCurrent').value;
      var next = $('adminPwNew').value;
      if (!current) return showError('Enter your current password.');
      var failed = RULES.filter(function (r) { return !r.re.test(next); });
      if (failed.length) return showError('New password needs: ' + failed.map(function (r) { return r.label.toLowerCase(); }).join(', ') + '.');
      if (next !== $('adminPwConfirm').value) return showError('The new passwords do not match.');
      var token = window.CarfoxAdminAuth && CarfoxAdminAuth.token();
      if (!token) { location.replace(CarfoxAdminAuth.loginUrl()); return; }

      var submit = $('adminPwSubmit');
      submit.disabled = true;
      showError('');
      fetch('/api/admin/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ current_password: current, new_password: next })
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
        })
        .then(function (r) {
          if (r.res.status === 401) { CarfoxAdminAuth.clear(); location.replace(CarfoxAdminAuth.loginUrl()); return; }
          if (!r.res.ok) { showError(r.data.error || 'Could not change the password.'); return; }
          if (r.data.token) CarfoxAdminAuth.save(r.data.token, r.data.user);
          close();
          toast('Password updated. Other admin sessions were signed out.', 'success');
        })
        .catch(function () { showError('Network error. Please try again.'); })
        .then(function () { submit.disabled = false; });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
