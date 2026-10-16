/**
 * CarFox listing card (vertical) — the one card design used by the home page rows, the detail page's
 * Similar Cars grid, and anywhere else a vertical listing card is needed.
 *
 *   CarfoxCard.render(car, opts) -> <article> element
 *     opts.variant       'grid' (default) | 'scroll' (fixed width inside a horizontal snap row)
 *     opts.actions       false to omit the WhatsApp / Message buttons (default true)
 *     opts.featureTrust  true to feature the Trust Score badge large (Top Trust Scores row)
 *     opts.className     extra classes for the article
 *   CarfoxCard.setGovernorateNames({ Cairo: 'القاهرة', ... }) -> Arabic location labels
 *
 * Identity: badges sit on the photo (top start), price is orange in the display font, big radius and a
 * soft shadow (css/carfox-brand.css). The Trust badge shows from 40 points up (featured rows always);
 * numbers stay Western digits and only unit words translate when CarfoxI18n is on the page.
 */
(function (global) {
  'use strict';

  var GOV_NAMES = {};

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

  var ICONS = {
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

  function spec(icon, text) {
    return '<span class="inline-flex items-center gap-1 min-w-0"><span class="text-slate-400">' + ICONS[icon] + '</span><span class="truncate">' + esc(text) + '</span></span>';
  }

  function location(car) {
    var loc = car.governorate || (car.dealer && (car.dealer.governorate || car.dealer.city)) || car.city || '';
    if (loc && isArabic() && GOV_NAMES[loc]) loc = GOV_NAMES[loc];
    return loc;
  }
  function dealerName(car) {
    return car.dealer_name || car.business_name || (car.dealer && car.dealer.business_name) || '';
  }

  function render(car, opts) {
    opts = opts || {};
    var variant = opts.variant || 'grid';
    var showActions = opts.actions !== false;
    var featureTrust = !!opts.featureTrust;

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
    if (global.CarfoxValue) badges += CarfoxValue.badge(car, { size: 'md', className: 'shadow-md' });
    if (global.CarfoxTrust && (featureTrust || trust >= 40)) {
      badges += CarfoxTrust.badge(trust, { size: featureTrust ? 'lg' : 'md', className: 'shadow-md' });
    }
    var photoCount = Number(car.photo_count) || 0;

    var photo =
      '<a href="' + href + '" class="block relative aspect-[4/3] bg-slate-100 overflow-hidden" tabindex="-1" aria-hidden="true">' +
      (car.primary_photo_url
        ? '<img src="' + esc(car.primary_photo_url) + '" alt="" class="absolute inset-0 w-full h-full object-cover" loading="lazy" />'
        : '<div class="absolute inset-0 flex items-center justify-center">' + ICONS.car + '</div>') +
      (badges ? '<div class="absolute top-2.5 start-2.5 flex flex-wrap gap-1.5 max-w-[calc(100%-1.25rem)]">' + badges + '</div>' : '') +
      (photoCount > 1
        ? '<span class="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-md bg-black/55 text-white text-[11px] font-medium px-1.5 py-0.5">' + ICONS.camera + photoCount + '</span>'
        : '') +
      '</a>';

    var specs = [];
    var mileage = formatMileage(car.mileage);
    if (mileage) specs.push(spec('mileage', mileage));
    if (car.fuel_type) specs.push(spec('fuel', trv('fuel', car.fuel_type)));
    if (car.transmission) specs.push(spec('transmission', trv('transmission', car.transmission)));
    if (car.exterior_color) specs.push(spec('color', trv('color', car.exterior_color)));

    var loc = location(car);
    var dealer = dealerName(car);
    var meta = [];
    if (loc) meta.push('<span class="inline-flex items-center gap-1 min-w-0"><span class="text-slate-400">' + ICONS.pin + '</span><span class="truncate">' + esc(loc) + '</span></span>');
    if (dealer) meta.push('<span class="truncate">' + esc(dealer) + '</span>');

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
      (specs.length ? '<div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">' + specs.join('') + '</div>' : '') +
      '<p class="mt-2.5 font-display font-extrabold text-xl text-orange-600 leading-none">' + esc(formatPrice(car.price)) + '</p>' +
      (meta.length ? '<div class="mt-2 flex items-center gap-2 text-xs text-slate-500 min-w-0">' + meta.join('<span class="text-slate-300">·</span>') + '</div>' : '') +
      actions +
      '</div>';

    el.querySelectorAll('[data-track]').forEach(function (btn) {
      btn.addEventListener('click', function () { track(btn.getAttribute('data-track'), car.id); });
    });
    return el;
  }

  global.CarfoxCard = {
    render: render,
    setGovernorateNames: function (map) { GOV_NAMES = map || {}; },
    formatPrice: formatPrice,
    formatMileage: formatMileage,
    whatsappHref: whatsappHref
  };
})(typeof window !== 'undefined' ? window : this);
