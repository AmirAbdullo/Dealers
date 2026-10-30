/**
 * CarFox listing card (vertical) — the one card design used by the home page rows, the detail page's
 * Similar Cars grid, saved cars, dealer profiles, and anywhere else a vertical listing card is needed.
 *
 *   CarfoxCard.render(car, opts) -> <article> element
 *     opts.variant       'grid' (default) | 'scroll' (fixed width inside a horizontal snap row)
 *     opts.actions       false to omit the WhatsApp / Message buttons (default true)
 *     opts.featureTrust  true to feature the Trust Score badge large (Top Trust Scores row)
 *     opts.sold          true for a sold listing (muted photo + price, "Sold" tag)
 *     opts.layout        'horizontal' — home page card: photo start (~40%), title, price, 2x2 specs,
 *                        location, WhatsApp + Call Now; the whole card opens the listing
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
    phone: '<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/></svg>',
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

  // tel: link to the dealer's phone: +/00 numbers kept international, 0-prefixed Egyptian numbers get +20,
  // 20… / 11+ digit numbers get +, 10-digit 1… numbers are Egyptian mobiles missing the 0, shorter ones dial as entered.
  function telHref(car) {
    var raw = car && car.dealer && car.dealer.phone ? String(car.dealer.phone).trim() : '';
    var digits = raw.replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (raw.charAt(0) === '+') return 'tel:+' + digits;
    if (digits.indexOf('00') === 0) return 'tel:+' + digits.slice(2);
    if (digits.indexOf('0') === 0) return 'tel:+20' + digits.slice(1);
    if (digits.indexOf('20') === 0 && digits.length >= 11) return 'tel:+' + digits;
    if (digits.length === 10 && digits.charAt(0) === '1') return 'tel:+20' + digits; // Egyptian mobile missing its 0
    if (digits.length >= 11) return 'tel:+' + digits; // full international number without the +
    return 'tel:' + digits; // short local number (e.g. landline without area code): dial as entered
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

    if (opts.layout === 'horizontal') return renderHorizontal(car, opts);
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

  // Home page horizontal card. Photo on the start side (~40%), info on the end side, contact buttons at the
  // bottom of the info. A stretched link under the content opens the listing from anywhere on the card; the
  // info text lets clicks through to it (pointer-events-none) and the buttons sit above it.
  function renderHorizontal(car, opts) {
    var featureTrust = !!opts.featureTrust;
    var featured = !!opts.featured;
    var href = '/cars/' + encodeURIComponent(car.id);
    var title = [car.year, car.make, car.model].filter(Boolean).join(' ');
    var trust = Number(car.trust_score) || 0;
    var photoCount = Number(car.photo_count) || 0;

    var el = document.createElement('article');
    el.className = 'cf-hcard' + (opts.className ? ' ' + opts.className : '');
    el.setAttribute('data-car-id', String(car.id));

    var badges = '';
    // Featured (promoted) tag heads the badge column so it never collides with the photo counter.
    if (featured) badges += featuredTagHtml('');
    if (car.condition === 'new') badges += newTagHtml('');
    if (global.CarfoxValue) badges += CarfoxValue.badge(car, { compact: true, className: 'shadow-sm' });
    if (global.CarfoxTrust && (featureTrust || trust >= 40)) {
      // Phone photos are ~135px wide: a long tier label ("Highly Verified") shows from sm up, short ones always.
      var tierText = CarfoxTrust.label ? CarfoxTrust.label(trust) : '';
      badges += CarfoxTrust.badge(trust, { size: 'sm', labelClass: tierText.length > 10 ? 'hidden sm:inline' : '', className: 'shadow-sm' });
    }

    var photo =
      '<div class="relative w-[36%] sm:w-[40%] shrink-0 bg-slate-100">' +
      (car.primary_photo_url
        ? '<img src="' + esc(car.primary_photo_url) + '" alt="" class="absolute inset-0 w-full h-full object-cover" loading="lazy" />'
        : '<div class="absolute inset-0 flex items-center justify-center">' + ICONS.car + '</div>') +
      (badges ? '<div class="absolute top-2 start-2 flex flex-col items-start gap-1 max-w-[calc(100%-1rem)]">' + badges + '</div>' : '') +
      (photoCount > 1
        ? '<span class="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-md bg-black/55 text-white text-[11px] font-medium px-1.5 py-0.5">' + ICONS.camera + photoCount + '</span>'
        : '') +
      '</div>';

    var specs = [];
    var mileage = formatMileage(car.mileage);
    if (mileage) specs.push(specItem('mileage', mileage));
    if (car.fuel_type) specs.push(specItem('fuel', trv('fuel', car.fuel_type)));
    if (car.transmission) specs.push(specItem('transmission', trv('transmission', car.transmission)));
    if (car.exterior_color) specs.push(specItem('color', trv('color', car.exterior_color)));
    var loc = location(car);

    var wa = whatsappHref(car);
    var tel = telHref(car);
    // Phones: two buttons share ~95px each, so padding/gap/text tighten there and icons drop below 360px.
    var btn = 'pointer-events-auto relative z-[2] flex-1 min-w-0 h-10 inline-flex items-center justify-center gap-1 sm:gap-1.5 rounded-xl px-1 sm:px-2 text-[12.5px] sm:text-[13px] font-semibold transition-colors ';
    function ic(name) { return '<span class="hidden min-[360px]:inline-flex">' + ICONS[name] + '</span>'; }
    var buttons = '';
    if (wa) buttons += '<a href="' + esc(wa) + '" target="_blank" rel="noopener" data-track="whatsapp" class="' + btn + 'bg-green-600 hover:bg-green-700 active:bg-green-800 text-white">' + ic('whatsapp') + '<span class="truncate">' + esc(tx('card.whatsapp', 'WhatsApp')) + '</span></a>';
    if (tel) buttons += '<a href="' + esc(tel) + '" data-track="call" class="' + btn + 'border-[1.5px] border-[' + NAVY + '] bg-white text-[' + NAVY + '] hover:bg-slate-50 active:bg-slate-100">' + ic('phone') + '<span class="truncate">' + esc(tx('card.call', 'Call Now')) + '</span></a>';
    if (!buttons) buttons = '<a href="' + href + '?openInquiry=1" data-track="message" class="' + btn + 'bg-[' + NAVY + '] hover:bg-[#162c57] text-white">' + ic('message') + '<span class="truncate">' + esc(tx('card.message', 'Message')) + '</span></a>';

    el.innerHTML =
      '<a href="' + href + '" class="absolute inset-0 z-[1]" aria-label="' + esc((featured ? tx('card.featured', 'Featured') + ': ' : '') + title) + '"></a>' +
      photo +
      '<div class="pointer-events-none relative z-[2] min-w-0 flex-1 flex flex-col p-2.5 sm:p-3.5">' +
        '<h3 class="font-display font-bold text-[15px] sm:text-base leading-snug text-slate-900 truncate">' + esc(title) + '</h3>' +
        priceHtml(car.price, { className: 'text-lg sm:text-xl mt-0.5' }) +
        (specs.length ? '<div class="mt-2 grid grid-cols-1 min-[360px]:grid-cols-2 gap-x-2.5 gap-y-1.5 text-xs text-slate-600">' + specs.join('') + '</div>' : '') +
        (loc ? '<p class="mt-1.5 flex items-center gap-1.5 min-w-0 text-xs text-slate-500"><span class="text-slate-400">' + ICONS.pin + '</span><span class="truncate">' + esc(loc) + '</span></p>' : '') +
        '<div class="mt-auto pt-2.5 sm:pt-3 flex gap-1.5 sm:gap-2">' + buttons + '</div>' +
      '</div>';

    // Capture phase: runs before the buttons' own handlers (which stop propagation).
    if (featured && global.CarfoxTrack && CarfoxTrack.markPromoted) {
      el.addEventListener('click', function () { CarfoxTrack.markPromoted(car.id); }, true);
    }
    el.querySelectorAll('[data-track]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        track(b.getAttribute('data-track'), car.id);
      });
    });
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
