/**
 * CarFox listing card (vertical) — the one card design used by the home page rows, the detail page's
 * Similar Cars grid, saved cars, dealer profiles, and anywhere else a vertical listing card is needed.
 *
 *   CarfoxCard.render(car, opts) -> <article> element
 *     opts.variant       'grid' (default) | 'scroll' (fixed width inside a horizontal snap row)
 *     opts.actions       false to omit the WhatsApp / Message buttons (default true)
 *     opts.featureTrust  true to feature the Trust Score badge large (Top Trust Scores row)
 *     opts.sold          true for a sold listing (muted photo + price, "Sold" tag)
 *     opts.compact       home page card (every home row): fixed 280/300px, photo on top with badges + photo
 *                        count, then title + save heart, one muted spec line (km · fuel · gearbox · colour),
 *                        large price, pin + governorate, and light "Call Now" / "WhatsApp" lead buttons; a
 *                        stretched link opens the listing (heart + buttons stop propagation)
 *   Cars with condition 'new' get a small green "New" tag with the photo badges (used cars get none).
 *     opts.featured      promoted listing: amber "Featured" tag on the photo; clicks mark the car as reached
 *                        through a promotion (CarfoxTrack.markPromoted) for engagement attribution
 *     opts.className     extra classes for the article
 *   Interior helpers shared with the browse page's horizontal card:
 *     CarfoxCard.priceHtml(piasters, { className, muted })   navy price, small muted unit
 *     CarfoxCard.specGridHtml(car, { year, className })      2-column icon + text spec grid
 *     CarfoxCard.dealerRowHtml(car, { className, linkClass }) location · dealer logo + name
 *   CarfoxCard.setGovernorateNames({ Cairo: 'القاهرة', ... }) -> Arabic location labels
 *
 * Identity: badges sit on the photo (top start, Trust shield featured), price is navy in the display font
 * with a small muted unit, specs are a quiet 2x2 icon grid, the dealer row shows the dealer's logo.
 * The Trust badge shows from 40 points up (featured rows always); numbers stay Western digits and only
 * unit words translate when CarfoxI18n is on the page.
 */
(function (global) {
  'use strict';

  var GOV_NAMES = {};
  var NAVY = '#0f1f3d';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function i18n() { return global.CarfoxI18n || null; }
  function tx(key, fallback) {
    var i = i18n();
    return i && i.has && i.has(key) ? i.t(key) : fallback;
  }
  function trv(group, value) {
    var i = i18n();
    return i && i.tr ? i.tr(group, value) : value;
  }
  function isArabic() {
    var i = i18n();
    return !!(i && i.getLang && i.getLang() === 'ar');
  }

  function formatPrice(piasters) {
    if (!piasters || piasters <= 0) return tx('card.price_on_request', 'Price on request');
    return Math.round(Number(piasters) / 100).toLocaleString('en-EG') + ' ' + tx('card.egp', 'EGP');
  }
  function formatMileage(km) {
    if (km == null || km === '' || Number(km) <= 0) return '';
    return Number(km).toLocaleString('en-US') + ' ' + tx('card.km', 'km');
  }

  // Navy price with the currency small and muted (never the competitor-blue price).
  function priceHtml(piasters, opts) {
    opts = opts || {};
    var cls = 'font-display font-extrabold leading-tight ' + (opts.className || 'text-xl') + ' ' + (opts.muted ? 'text-slate-400' : 'text-[#0f1f3d]');
    if (!piasters || piasters <= 0) {
      return '<p class="' + cls + '">' + esc(tx('card.price_on_request', 'Price on request')) + '</p>';
    }
    return '<p class="' + cls + '">' + Math.round(Number(piasters) / 100).toLocaleString('en-EG') +
      '<span class="ms-1 text-xs font-semibold text-slate-400 align-baseline">' + esc(tx('card.egp', 'EGP')) + '</span></p>';
  }

  var ICONS = {
    year: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path stroke-linecap="round" d="M3 10h18M8 3v4M16 3v4"/></svg>',
    // Spec-line shapes match the detail page's Vehicle Highlights (Lucide gauge / fuel / droplet, Tabler gearbox),
    // kept monochrome here.
    mileage: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
    fuel: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5"/></svg>',
    transmission: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="12" cy="18" r="2"/><path d="M5 8v8M12 8v8M19 8v2a2 2 0 0 1-2 2H5"/></svg>',
    color: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>',
    pin: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21s-6-5.3-6-11a6 6 0 1 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    camera: '<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8a2 2 0 012-2h2l1.5-2h7L17 6h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/><circle cx="12" cy="12.5" r="3.5"/></svg>',
    whatsapp: '<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 1 1-4.2 15.3l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8zm-3.3 4.4c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.3s1 2.7 1.2 2.9c.1.2 2 3.2 5 4.4 2.5 1 3 .8 3.5.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-2-.9c-.3-.1-.5-.2-.7.1l-.9 1.1c-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.9-.8-1.5-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.6.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.5-.4-.5-.6-.5h-.6z"/></svg>',
    message: '<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12c0 4.4-4 8-9 8a9.9 9.9 0 0 1-4.3-.9L3 20l1.4-3.7C3.5 15 3 13.6 3 12c0-4.4 4-8 9-8s9 3.6 9 8z"/></svg>',
    car: '<svg class="w-14 h-14 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8 17h8M6 11h12l-1-4H7l-1 4zM5 11l1.5-6h11L19 11"/><circle cx="7.5" cy="17.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="16.5" cy="17.5" r="1.5" fill="currentColor" stroke="none"/></svg>'
  };

  // wa.me deep link with the car title prefilled. Egyptian local numbers (01x…) get the +20 prefix.
  function whatsappHref(car) {
    var raw = car && car.dealer && car.dealer.whatsapp ? String(car.dealer.whatsapp) : '';
    var digits = raw.replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.indexOf('00') === 0) digits = digits.slice(2);
    else if (digits.indexOf('0') === 0) digits = '20' + digits.slice(1);
    var title = [car.year, car.make, car.model].filter(Boolean).join(' ');
    var url = global.location.origin + '/cars/' + car.id;
    var i = i18n();
    var text = i && i.has && i.has('card.whatsapp_text')
      ? i.t('card.whatsapp_text', { title: title, url: url })
      : "Hi, I'm interested in your " + title + ' listed on CarFox: ' + url;
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text);
  }

  function track(type, carId) {
    if (global.CarfoxTrack) CarfoxTrack.engagement(type, { vehicleId: carId });
  }

  function specItem(icon, text) {
    return '<span class="inline-flex items-center gap-1.5 min-w-0"><span class="text-slate-400">' + ICONS[icon] + '</span><span class="truncate">' + esc(text) + '</span></span>';
  }

  // Quiet 2-column icon + text grid (year optional, mileage, fuel, transmission, colour).
  function specGridHtml(car, opts) {
    opts = opts || {};
    var items = [];
    if (opts.year && car.year) items.push(specItem('year', car.year));
    var mileage = formatMileage(car.mileage);
    if (mileage) items.push(specItem('mileage', mileage));
    if (car.fuel_type) items.push(specItem('fuel', trv('fuel', car.fuel_type)));
    if (car.transmission) items.push(specItem('transmission', trv('transmission', car.transmission)));
    if (!opts.year && car.exterior_color) items.push(specItem('color', trv('color', car.exterior_color)));
    if (!items.length) return '';
    return '<div class="' + (opts.className || 'mt-2') + ' grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">' + items.join('') + '</div>';
  }

  function location(car) {
    var loc = car.governorate || (car.dealer && (car.dealer.governorate || car.dealer.city)) || car.city || '';
    if (loc && isArabic() && GOV_NAMES[loc]) loc = GOV_NAMES[loc];
    return loc;
  }
  function dealerName(car) {
    return car.dealer_name || car.business_name || (car.dealer && car.dealer.business_name) || '';
  }
  function dealerLogoHtml(car, name) {
    var logo = car.dealer && car.dealer.logo_url;
    if (logo) {
      return '<img src="' + esc(logo) + '" alt="" loading="lazy" class="h-5 w-5 rounded-full object-cover bg-white ring-1 ring-slate-200 shrink-0" />';
    }
    var initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
    return '<span class="h-5 w-5 rounded-full bg-[#0f1f3d] text-white text-[10px] font-bold flex items-center justify-center shrink-0" aria-hidden="true">' + esc(initial) + '</span>';
  }

  // Location pin + dealer (logo thumbnail + name, linked to the dealer profile when we know the id).
  function dealerRowHtml(car, opts) {
    opts = opts || {};
    var loc = location(car);
    var name = dealerName(car);
    var dealerId = car.dealer && car.dealer.id;
    if (!loc && !name) return '';
    var parts = [];
    if (loc) parts.push('<span class="inline-flex items-center gap-1 min-w-0"><span class="text-slate-400">' + ICONS.pin + '</span><span class="truncate">' + esc(loc) + '</span></span>');
    if (name) {
      var inner = dealerLogoHtml(car, name) + '<span class="truncate">' + esc(name) + '</span>';
      parts.push(dealerId
        ? '<a href="/dealer-profile.html?id=' + encodeURIComponent(dealerId) + '" class="inline-flex items-center gap-1.5 min-w-0 hover:text-slate-900 ' + (opts.linkClass || '') + '" title="' + esc(name) + '">' + inner + '</a>'
        : '<span class="inline-flex items-center gap-1.5 min-w-0">' + inner + '</span>');
    }
    return '<div class="' + (opts.className || 'mt-2') + ' flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 min-w-0">' + parts.join('') + '</div>';
  }

  function render(car, opts) {
    opts = opts || {};
    var variant = opts.variant || 'grid';
    var showActions = opts.actions !== false;
    var featureTrust = !!opts.featureTrust;
    var sold = !!opts.sold || car.status === 'sold';

    if (opts.compact) return renderCompact(car, opts);
    var el = document.createElement('article');
    el.className =
      'cf-card flex flex-col ' +
      (variant === 'scroll' ? 'snap-start shrink-0 w-[280px] sm:w-[300px] ' : '') +
      (opts.className || '');
    el.setAttribute('data-car-id', String(car.id));

    var href = '/cars/' + encodeURIComponent(car.id);
    var title = [car.year, car.make, car.model].filter(Boolean).join(' ');
    var subtitle = [car.trim && String(car.trim).trim(), car.body_type].filter(Boolean).join(' · ');
    var trust = Number(car.trust_score) || 0;

    var badges = car.condition === 'new' ? newTagHtml('') : '';
    if (global.CarfoxValue && !sold) badges += CarfoxValue.badge(car, { size: 'md', className: 'shadow-md' });
    if (global.CarfoxTrust && (featureTrust || trust >= 40)) {
      badges += CarfoxTrust.badge(trust, { size: featureTrust ? 'lg' : 'md', className: 'shadow-md' });
    }
    var photoCount = Number(car.photo_count) || 0;

    var photo =
      '<a href="' + href + '" class="block relative aspect-[4/3] bg-slate-100 overflow-hidden" tabindex="-1" aria-hidden="true">' +
      (car.primary_photo_url
        ? '<img src="' + esc(car.primary_photo_url) + '" alt="" class="absolute inset-0 w-full h-full object-cover' + (sold ? ' opacity-60' : '') + '" loading="lazy" />'
        : '<div class="absolute inset-0 flex items-center justify-center">' + ICONS.car + '</div>') +
      (badges ? '<div class="absolute top-2.5 start-2.5 flex flex-wrap gap-1.5 max-w-[calc(100%-1.25rem)]">' + badges + '</div>' : '') +
      (sold ? '<span class="absolute bottom-2 start-2 rounded-md bg-slate-900/85 text-white text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5">Sold</span>' : '') +
      (photoCount > 1
        ? '<span class="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-md bg-black/55 text-white text-[11px] font-medium px-1.5 py-0.5">' + ICONS.camera + photoCount + '</span>'
        : '') +
      '</a>';

    var wa = showActions ? whatsappHref(car) : '';
    var actions = showActions
      ? '<div class="mt-3 flex gap-2">' +
        (wa
          ? '<a href="' + esc(wa) + '" target="_blank" rel="noopener" data-track="whatsapp" class="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2">' + ICONS.whatsapp + esc(tx('card.whatsapp', 'WhatsApp')) + '</a>'
          : '') +
        '<a href="' + href + '?openInquiry=1" data-track="message" class="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0f1f3d] hover:bg-[#162c57] text-white text-sm font-semibold py-2">' + ICONS.message + esc(tx('card.message', 'Message')) + '</a>' +
        '</div>'
      : '';

    el.innerHTML =
      photo +
      '<div class="p-3.5 flex flex-col flex-1">' +
      '<a href="' + href + '" class="block font-display font-bold text-[15px] md:text-base text-slate-900 leading-snug truncate hover:text-orange-600">' + esc(title) + '</a>' +
      (subtitle ? '<p class="text-xs text-slate-500 mt-0.5 truncate">' + esc(subtitle) + '</p>' : '') +
      priceHtml(car.price, { className: 'text-xl mt-2', muted: sold }) +
      specGridHtml(car, { className: 'mt-2.5' }) +
      dealerRowHtml(car, { className: 'mt-2.5' }) +
      actions +
      '</div>';

    el.querySelectorAll('[data-track]').forEach(function (btn) {
      btn.addEventListener('click', function () { track(btn.getAttribute('data-track'), car.id); });
    });
    return el;
  }

  // tel: link to the dealer's phone: +/00 numbers kept international, 0-prefixed Egyptian numbers get +20, a
  // 10-digit 1… number is an Egyptian mobile missing its 0, 11+ digits are international without the +.
  function telHref(car) {
    var raw = car && car.dealer && car.dealer.phone ? String(car.dealer.phone).trim() : '';
    var digits = raw.replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (raw.charAt(0) === '+') return 'tel:+' + digits;
    if (digits.indexOf('00') === 0) return 'tel:+' + digits.slice(2);
    if (digits.indexOf('0') === 0) return 'tel:+20' + digits.slice(1);
    if (digits.length === 10 && digits.charAt(0) === '1') return 'tel:+20' + digits;
    if (digits.length >= 11) return 'tel:+' + digits;
    return 'tel:' + digits; // short local number (e.g. landline without area code): dial as entered
  }

  // ---- Save hearts on home cards: one /api/saved-cars fetch per page for a signed-in buyer; everyone else is
  // sent to the buyer sign-in when they tap a heart.
  var saved = { ids: null, loading: null };
  function buyerToken() {
    try {
      var t = localStorage.getItem('carfox_token');
      var u = JSON.parse(localStorage.getItem('carfox_user') || 'null');
      return t && u && u.role === 'buyer' ? t : null;
    } catch (_) { return null; }
  }
  var HEART_ON = '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true"><path d="M12 21s-6.7-4.9-9.3-7.6C.7 11.4.5 8.5 2.2 6.8 3.3 5.7 4.8 5.3 6.2 5.6c.9.2 1.8.8 2.5 1.5.7-.7 1.6-1.3 2.5-1.5 1.4-.3 2.9.1 4 1.2 1.7 1.7 1.5 4.6-.5 6.6C18.7 16.1 12 21 12 21z"/></svg>';
  var HEART_OFF = '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>';
  function setHeart(btn, on) {
    btn.innerHTML = on ? HEART_ON : HEART_OFF;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? tx('card.unsave', 'Remove from saved') : tx('card.save', 'Save car'));
  }
  function syncHearts() {
    document.querySelectorAll('[data-cf-save]').forEach(function (b) {
      setHeart(b, !!(saved.ids && saved.ids.has(Number(b.getAttribute('data-cf-save')))));
    });
  }
  function loadSaved() {
    if (saved.loading) return saved.loading;
    var token = buyerToken();
    if (!token) { saved.ids = new Set(); saved.loading = Promise.resolve(saved.ids); return saved.loading; }
    saved.loading = fetch('/api/saved-cars', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { saved.ids = new Set(((d && d.saved) || []).map(Number)); syncHearts(); return saved.ids; })
      .catch(function () { saved.ids = new Set(); return saved.ids; });
    return saved.loading;
  }
  function toggleSaved(carId, btn) {
    var token = buyerToken();
    if (!token) {
      global.location.href = '/buyer/login.html?returnTo=' + encodeURIComponent(global.location.pathname + global.location.search);
      return;
    }
    if (!saved.ids) saved.ids = new Set();
    var was = saved.ids.has(carId);
    if (was) saved.ids.delete(carId); else saved.ids.add(carId);
    syncHearts();
    if (global.CarfoxUI) CarfoxUI.heartPop(btn, !was);
    fetch('/api/saved-cars/' + carId, { method: was ? 'DELETE' : 'POST', headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { if (!r.ok) throw new Error('save failed'); })
      .catch(function () {
        if (was) saved.ids.add(carId); else saved.ids.delete(carId);
        syncHearts();
        if (global.CarfoxUI) CarfoxUI.toast(tx('card.save_error', 'Could not update saved cars. Please try again.'), 'error');
      });
  }

  // Home page card (every home row): photo on top (Featured / New / value / trust badges + photo count); title
  // with the save heart; one muted "mileage · fuel · transmission · colour" line; large navy price; pin +
  // governorate; then light "Call Now" / "WhatsApp" lead buttons. A stretched link makes the whole card open the
  // listing; the heart and lead buttons sit above it and stop propagation.
  function renderCompact(car, opts) {
    var featured = !!opts.featured;
    var featureTrust = !!opts.featureTrust;
    var title = [car.year, car.make, car.model].filter(Boolean).join(' ');
    var trust = Number(car.trust_score) || 0;
    var photoCount = Number(car.photo_count) || 0;
    var href = '/cars/' + encodeURIComponent(car.id);

    var el = document.createElement('article');
    el.className = 'cf-card flex flex-col snap-start shrink-0 w-[280px] sm:w-[300px]' + (opts.className ? ' ' + opts.className : '');
    el.setAttribute('data-car-id', String(car.id));

    var badges = '';
    if (featured) badges += featuredTagHtml('');
    if (car.condition === 'new') badges += newTagHtml('');
    if (global.CarfoxValue) badges += CarfoxValue.badge(car, { size: 'md', className: 'shadow-md' });
    if (global.CarfoxTrust && (featureTrust || trust >= 40)) {
      badges += CarfoxTrust.badge(trust, { size: featureTrust ? 'lg' : 'md', className: 'shadow-md' });
    }

    var km = car.mileage != null && Number(car.mileage) > 0
      ? Number(car.mileage).toLocaleString('en-US') + ' ' + (isArabic() ? tx('card.km', 'km') : 'KM')
      : '';
    var specs = [km, car.fuel_type && trv('fuel', car.fuel_type), car.transmission && trv('transmission', car.transmission),
      car.exterior_color && trv('color', car.exterior_color)].filter(Boolean).join(' · ');
    var loc = location(car);

    var tel = telHref(car);
    var wa = whatsappHref(car);
    var leadBtn = 'relative z-[2] inline-flex items-center justify-center gap-1.5 h-11 min-w-0 rounded-xl border text-[13px] font-semibold transition-colors ';
    var leads = '';
    if (tel) {
      leads += '<a href="' + esc(tel) + '" data-lead="call" class="' + leadBtn + 'border-slate-200 bg-white text-[#0f1f3d] hover:bg-slate-50 active:bg-slate-100">' +
        '<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>' +
        '<span class="truncate">' + esc(tx('card.call', 'Call Now')) + '</span></a>';
    }
    if (wa) {
      leads += '<a href="' + esc(wa) + '" target="_blank" rel="noopener" data-lead="whatsapp" class="' + leadBtn + 'border-emerald-200 bg-emerald-50/60 text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100">' +
        '<span class="text-emerald-600">' + ICONS.whatsapp + '</span><span class="truncate">' + esc(tx('card.whatsapp', 'WhatsApp')) + '</span></a>';
    }

    el.innerHTML =
      '<a href="' + href + '" class="absolute inset-0 z-[1] rounded-3xl" aria-label="' + esc((featured ? tx('card.featured', 'Featured') + ': ' : '') + title) + '"></a>' +
      '<div class="relative aspect-[4/3] bg-slate-100 overflow-hidden">' +
        (car.primary_photo_url
          ? '<img src="' + esc(car.primary_photo_url) + '" alt="" class="absolute inset-0 w-full h-full object-cover" loading="lazy" />'
          : '<div class="absolute inset-0 flex items-center justify-center">' + ICONS.car + '</div>') +
        (badges ? '<div class="absolute top-2.5 start-2.5 flex flex-wrap items-start gap-1.5 max-w-[calc(100%-1.25rem)]">' + badges + '</div>' : '') +
        (photoCount > 1
          ? '<span class="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-md bg-black/55 text-white text-[11px] font-medium px-1.5 py-0.5">' + ICONS.camera + photoCount + '</span>'
          : '') +
      '</div>' +
      '<div class="flex flex-col flex-1 px-3.5 pt-3 pb-3.5">' +
        '<div class="flex items-start gap-2">' +
          '<p class="flex-1 min-w-0 font-display font-bold text-base text-slate-900 leading-snug truncate">' + esc(title) + '</p>' +
          '<button type="button" data-cf-save="' + esc(car.id) + '" class="relative z-[2] -mt-1.5 -me-1.5 shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50"></button>' +
        '</div>' +
        (specs ? '<p class="mt-0.5 text-xs text-slate-500 truncate">' + esc(specs) + '</p>' : '') +
        priceHtml(car.price, { className: 'text-[22px] mt-2' }) +
        (loc ? '<p class="mt-1.5 inline-flex items-center gap-1 text-xs text-slate-500 min-w-0"><span class="text-slate-400">' + ICONS.pin + '</span><span class="truncate">' + esc(loc) + '</span></p>' : '') +
        (leads ? '<div class="mt-auto pt-3 grid ' + (tel && wa ? 'grid-cols-2' : 'grid-cols-1') + ' gap-2">' + leads + '</div>' : '') +
      '</div>';

    var heart = el.querySelector('[data-cf-save]');
    setHeart(heart, !!(saved.ids && saved.ids.has(Number(car.id))));
    heart.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleSaved(Number(car.id), heart);
    });
    loadSaved();

    el.querySelectorAll('[data-lead]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.stopPropagation();
        if (featured && global.CarfoxTrack && CarfoxTrack.markPromoted) CarfoxTrack.markPromoted(car.id);
        track(a.getAttribute('data-lead'), car.id);
      });
    });

    // Promoted card: later engagements on this car (detail page) are attributed to the promotion.
    if (featured && global.CarfoxTrack && CarfoxTrack.markPromoted) {
      el.addEventListener('click', function () { CarfoxTrack.markPromoted(car.id); });
    }
    return el;
  }

  // Small green "New" tag for brand-new cars (used is the default expectation, so it gets no tag).
  function newTagHtml(className) {
    return '<span class="' + (className || '') + ' inline-flex items-center rounded-md bg-emerald-600 text-white text-[11px] font-bold px-1.5 py-0.5 shadow-sm">' +
      esc(tx('card.new', 'New')) + '</span>';
  }

  // Small amber "Featured" tag for promoted listings (always visible, never disguised as organic).
  function featuredTagHtml(className) {
    return '<span class="' + (className || '') + ' inline-flex items-center gap-1 rounded-md bg-amber-400 text-amber-950 text-[11px] font-bold px-1.5 py-0.5 shadow-sm" title="' +
      esc(tx('card.featured_title', 'Promoted listing')) + '">' +
      '<svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5L2.5 9.4l6.6-.8z"/></svg>' +
      esc(tx('card.featured', 'Featured')) + '</span>';
  }

  global.CarfoxCard = {
    render: render,
    priceHtml: priceHtml,
    specGridHtml: specGridHtml,
    dealerRowHtml: dealerRowHtml,
    setGovernorateNames: function (map) { GOV_NAMES = map || {}; },
    formatPrice: formatPrice,
    formatMileage: formatMileage,
    whatsappHref: whatsappHref,
    telHref: telHref,
    featuredTagHtml: featuredTagHtml,
    newTagHtml: newTagHtml,
    escape: esc
  };
})(typeof window !== 'undefined' ? window : this);
