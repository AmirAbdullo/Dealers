/**
 * Admin Trust Score modal, shared by /admin/listings.html and /admin/trust-scores.html.
 *
 * CarfoxAdminTrust.open(vehicleId, { onSaved(record), toast(kind, msg) })
 *
 * Loads GET /api/admin/listings/:id/trust, shows the 8 admin-checked factors (checkbox, points,
 * optional notes, who/when), the read-only auto-computed completeness row, a running total, and
 * saves with PUT /api/admin/listings/:id/trust. The server recomputes and stores the score.
 */
(function (global) {
  'use strict';

  var TOKEN_KEY = 'carfox_token';
  var host = null;
  var current = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function headers() {
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) };
  }
  function fmtWhen(t) {
    if (!t) return '';
    var s = String(t);
    if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
    if (!/[zZ]|[+-]\d\d:\d\d$/.test(s)) s += 'Z';
    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function badge(score) {
    return global.CarfoxTrust ? global.CarfoxTrust.badge(score) : '<span class="font-bold">' + score + '</span>';
  }

  function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    host.id = 'cfTrustAdminModal';
    host.className = 'hidden fixed inset-0 z-50 flex items-center justify-center';
    host.innerHTML =
      '<div class="absolute inset-0 bg-black/40" data-trust-cancel></div>' +
      '<div class="relative bg-white rounded-xl shadow-xl w-[94%] max-w-2xl max-h-[92vh] overflow-y-auto p-5" role="dialog" aria-modal="true" aria-labelledby="cfTrustTitle">' +
        '<div class="flex items-start justify-between gap-3">' +
          '<div><h3 id="cfTrustTitle" class="text-lg font-semibold text-gray-900">Trust score</h3><p id="cfTrustSub" class="mt-0.5 text-sm text-gray-600"></p></div>' +
          '<div id="cfTrustTotal" class="text-right shrink-0"></div>' +
        '</div>' +
        '<div id="cfTrustBody" class="mt-4 text-sm text-gray-500">Loading…</div>' +
        '<div class="mt-5 flex items-center justify-between gap-2">' +
          '<p class="text-xs text-gray-500">Score = checked factors + automatic completeness. Editing a verified field removes that check.</p>' +
          '<div class="flex gap-2 shrink-0"><button type="button" class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700" data-trust-cancel>Cancel</button>' +
          '<button type="button" id="cfTrustSave" class="px-4 py-2 rounded-lg bg-blue-700 text-white font-semibold hover:bg-blue-800 disabled:opacity-50">Save score</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(host);
    host.addEventListener('click', function (e) {
      if (e.target.closest('[data-trust-cancel]')) close();
    });
    host.addEventListener('change', function (e) {
      if (e.target.matches('input[data-factor]')) updateTotal();
    });
    host.querySelector('#cfTrustSave').addEventListener('click', save);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && host && !host.classList.contains('hidden')) close(); });
    return host;
  }

  function close() {
    if (host) host.classList.add('hidden');
    current = null;
  }

  function factorRow(f) {
    var meta = '';
    if (f.verified) meta = 'Verified by ' + esc(f.verified_by_name || 'admin') + (f.verified_at ? ' · ' + fmtWhen(f.verified_at) : '');
    else if (f.cleared_at) meta = '<span class="text-amber-700 font-semibold">Removed automatically</span> · ' + esc(f.cleared_reason || 'listing edited') + (f.cleared_at ? ' · ' + fmtWhen(f.cleared_at) : '');
    var auto = f.auto_clears_on && f.auto_clears_on.length ? 'Clears if ' + esc(f.auto_clears_on.join(', ')) + ' change' : 'Never clears automatically';
    return '<label class="flex items-start gap-3 py-3 border-t border-gray-100 cursor-pointer">' +
      '<input type="checkbox" data-factor="' + esc(f.key) + '" data-points="' + f.points + '"' + (f.verified ? ' checked' : '') + ' class="mt-1 h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-500" />' +
      '<span class="min-w-0 flex-1">' +
        '<span class="flex items-center justify-between gap-2"><span class="font-semibold text-gray-900">' + esc(f.label) + '</span><span class="text-sm font-bold text-gray-700 shrink-0">' + f.points + ' pts</span></span>' +
        (meta ? '<span class="block text-xs text-gray-500 mt-0.5">' + meta + '</span>' : '') +
        '<span class="block text-[11px] text-gray-400 mt-0.5">' + auto + '</span>' +
        '<input type="text" data-notes="' + esc(f.key) + '" value="' + esc(f.notes || '') + '" maxlength="500" placeholder="Notes (optional, admin only)" class="mt-1.5 w-full rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300" />' +
      '</span>' +
      '</label>';
  }

  function render(rec) {
    var c = rec.completeness || {};
    var cMeta = c.ok
      ? 'All key fields filled · ' + c.photo_count + ' photos'
      : [c.missing && c.missing.length ? 'Missing: ' + c.missing.join(', ').replace(/_/g, ' ') : '', c.photo_count < c.photos_required ? c.photo_count + ' of ' + c.photos_required + ' photos' : ''].filter(Boolean).join(' · ');
    host.querySelector('#cfTrustBody').innerHTML =
      '<div>' + rec.factors.map(factorRow).join('') + '</div>' +
      '<div class="flex items-start gap-3 py-3 border-t border-b border-gray-100 bg-gray-50 -mx-2 px-2 rounded-md">' +
        '<span class="mt-1 h-4 w-4 rounded border ' + (c.ok ? 'bg-green-500 border-green-500' : 'bg-gray-200 border-gray-300') + ' shrink-0"></span>' +
        '<span class="min-w-0 flex-1"><span class="flex items-center justify-between gap-2"><span class="font-semibold text-gray-900">Listing completeness <span class="text-xs font-normal text-gray-500">(automatic, read-only)</span></span><span class="text-sm font-bold text-gray-700 shrink-0" id="cfTrustCompletePts">' + (c.ok ? c.points : 0) + ' / ' + (c.max || 5) + ' pts</span></span>' +
        '<span class="block text-xs text-gray-500 mt-0.5">' + esc(cMeta) + '</span></span>' +
      '</div>';
    updateTotal();
  }

  function updateTotal() {
    if (!current) return;
    var total = 0;
    host.querySelectorAll('input[data-factor]').forEach(function (cb) { if (cb.checked) total += Number(cb.dataset.points) || 0; });
    total += current.completeness && current.completeness.ok ? current.completeness.points : 0;
    total = Math.min(100, total);
    host.querySelector('#cfTrustTotal').innerHTML = '<div class="text-3xl font-extrabold text-gray-900 leading-none">' + total + '<span class="text-base text-gray-400 font-semibold"> /100</span></div><div class="mt-1">' + badge(total) + '</div>';
  }

  async function save() {
    if (!current) return;
    var factors = {};
    host.querySelectorAll('input[data-factor]').forEach(function (cb) {
      var notesEl = host.querySelector('input[data-notes="' + cb.dataset.factor + '"]');
      factors[cb.dataset.factor] = { verified: cb.checked, notes: notesEl ? notesEl.value.trim() : '' };
    });
    var btn = host.querySelector('#cfTrustSave');
    btn.disabled = true;
    try {
      var res = await fetch('/api/admin/listings/' + current.vehicle_id + '/trust', { method: 'PUT', headers: headers(), body: JSON.stringify({ factors: factors }) });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok) { toast('error', data && data.error ? data.error : 'Could not save the trust score'); return; }
      toast('ok', 'Trust score saved: ' + data.trust.score + '/100');
      var cb = current.onSaved;
      close();
      if (cb) cb(data.trust);
    } catch (_) {
      toast('error', 'Network error');
    } finally { btn.disabled = false; }
  }

  function toast(kind, msg) {
    if (current && current.toast) current.toast(kind, msg);
    else if (global.setToast) global.setToast(kind, msg);
    else alert(msg);
  }

  async function open(vehicleId, opts) {
    opts = opts || {};
    ensureHost();
    current = { vehicle_id: vehicleId, onSaved: opts.onSaved, toast: opts.toast, completeness: null };
    host.querySelector('#cfTrustTitle').textContent = 'Trust score';
    host.querySelector('#cfTrustSub').textContent = '';
    host.querySelector('#cfTrustTotal').innerHTML = '';
    host.querySelector('#cfTrustBody').innerHTML = '<div class="text-sm text-gray-500">Loading…</div>';
    host.classList.remove('hidden');
    try {
      var res = await fetch('/api/admin/listings/' + vehicleId + '/trust', { headers: headers() });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data || !data.trust) { host.querySelector('#cfTrustBody').innerHTML = '<div class="text-sm text-red-700">' + esc(data && data.error ? data.error : 'Could not load this listing') + '</div>'; return; }
      if (!current || current.vehicle_id !== vehicleId) return;
      current.completeness = data.trust.completeness;
      host.querySelector('#cfTrustTitle').textContent = 'Trust score · ' + (data.listing && data.listing.title ? data.listing.title : '#' + vehicleId);
      host.querySelector('#cfTrustSub').textContent = (data.listing && data.listing.dealer_name ? data.listing.dealer_name + ' · ' : '') + (data.listing && data.listing.status ? data.listing.status : '') + ' · #' + vehicleId;
      render(data.trust);
    } catch (_) {
      host.querySelector('#cfTrustBody').innerHTML = '<div class="text-sm text-red-700">Network error</div>';
    }
  }

  global.CarfoxAdminTrust = { open: open, close: close };
})(typeof window !== 'undefined' ? window : this);
