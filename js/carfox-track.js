/**
 * Engagement click tracking (separate from listing views).
 *
 *   CarfoxTrack.engagement('whatsapp' | 'call' | 'message' | 'share' | 'website', { vehicleId, dealershipId })
 *
 * Fire-and-forget: never blocks the click, never throws. The server resolves the dealership
 * from the vehicle when only vehicleId is given, and ignores more than 10 events per minute
 * from one IP.
 *
 *   CarfoxTrack.markPromoted(vehicleId)
 * Called when a buyer clicks a promoted (Featured) card. For the rest of the browser session every
 * engagement on that car is sent with promoted: true (the server keeps it only while the car really is
 * promoted), so dealers can later see the extra clicks their promotion brought.
 */
(function (global) {
  'use strict';

  var PROMO_KEY = 'cf_promo_ids';
  function promotedIds() {
    try { return JSON.parse(sessionStorage.getItem(PROMO_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function markPromoted(vehicleId) {
    var id = Number(vehicleId);
    if (!id) return;
    try {
      var ids = promotedIds();
      if (ids.indexOf(id) === -1) ids.push(id);
      sessionStorage.setItem(PROMO_KEY, JSON.stringify(ids.slice(-50)));
    } catch (_) {}
  }

  function engagement(type, opts) {
    opts = opts || {};
    try {
      var payload = { event_type: String(type || '') };
      if (opts.vehicleId != null) payload.vehicle_id = Number(opts.vehicleId);
      if (opts.promoted || (opts.vehicleId != null && promotedIds().indexOf(Number(opts.vehicleId)) !== -1)) payload.promoted = true;
      if (opts.dealershipId != null) payload.dealership_id = Number(opts.dealershipId);
      fetch('/api/engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (_) {}
  }

  global.CarfoxTrack = { engagement: engagement, markPromoted: markPromoted };
})(typeof window !== 'undefined' ? window : this);
