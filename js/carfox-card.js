/**
 * CarFox listing card (vertical) — the one card design used by the home page rows, the detail page's
 * Similar Cars grid, saved cars, dealer profiles, and anywhere else a vertical listing card is needed.
 *
 *   CarfoxCard.render(car, opts) -> <article> element
 *     opts.variant       'grid' (default) | 'scroll' (fixed width inside a horizontal snap row)
 *     opts.actions       false to omit the WhatsApp / Message buttons (default true)
 *     opts.featureTrust  true to feature the Trust Score badge large (Top Trust Scores row)
 *     opts.sold          true for a sold listing (muted photo + price, "Sold" tag)
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
    var cls = 'font-display font-extrabold leading-tight ' + (opts.className || 'text-xl') + ' ' + (opts.muted ? 'text-slate-400' : 'text-[' + NAVY + ']');
    if (!piasters || piasters <= 0) {
      return '<p class="' + cls + '">' + esc(tx('card.price_on_request', 'Price on request')) + '</p>';
    }
    return '<p class="' + cls + '">' + Math.round(Number(piasters) / 100).toLocaleString('en-EG') +
      '<span class="ms-1 text-xs font-semibold text-slate-400 align-baseline">' + esc(tx('card.egp', 'EGP')) + '</span></p>';
  }

  var ICONS = {
    year: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path stroke-linecap="round" d="M3 10h18M8 3v4M16 3v4"/></svg>',
    mileage: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3a9 9 0 0 0-9 9c0 2.5 1 4.7 2.6 6.3M12 3a9 9 0 0 1 9 9c0 2.5-1 4.7-2.6 6.3M12 12l4-3"/><circle cx="12" cy="12" r="1.5"/></svg>',
    fuel: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M5 21h10M8 8h4M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/></svg>',
    transmission: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/><path stroke-linecap="round" d="M6 8v8M12 8v8M18 8v4H6"/></svg>',
    color: '<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
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
      : "Hi, I'm interested in the " + title + ' listed on CarFox: ' + url;
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
    return '<span class="h-5 w-5 rounded-full bg-[' + NAVY + '] text-white text-[10px] font-bold flex items-center justify-center shrink-0" aria-hidden="true">' + esc(initial) + '</span>';
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

    var el = document.createElement('article');
    el.className =
      'cf-card flex flex-col ' +
      (variant === 'scroll' ? 'snap-start shrink-0 w-[280px] sm:w-[300px] md:w-[calc((100%-1.5rem)/3)] lg:w-[calc((100%-2.25rem)/4)] ' : '') +
      (opts.className || '');
    el.setAttribute('data-car-id', String(car.id));

    var href = '/cars/' + encodeURIComponent(car.id);
    var title = [car.year, car.make, car.model].filter(Boolean).join(' ');
    var subtitle = [car.trim && String(car.trim).trim(), car.body_type].filter(Boolean).join(' · ');
    var trust = Number(car.trust_score) || 0;

    var badges = '';
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
        '<a href="' + href + '?openInquiry=1" data-track="message" class="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[' + NAVY + '] hover:bg-[#162c57] text-white text-sm font-semibold py-2">' + ICONS.message + esc(tx('card.message', 'Message')) + '</a>' +
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

  global.CarfoxCard = {
    render: render,
    priceHtml: priceHtml,
    specGridHtml: specGridHtml,
    dealerRowHtml: dealerRowHtml,
    setGovernorateNames: function (map) { GOV_NAMES = map || {}; },
    formatPrice: formatPrice,
    formatMileage: formatMileage,
    whatsappHref: whatsappHref,
    escape: esc
  };
})(typeof window !== 'undefined' ? window : this);
