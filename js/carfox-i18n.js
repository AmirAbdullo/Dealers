/**
 * CarFox — language switching with automatic translation (LibreTranslate).
 * Default 'en' (localStorage: carfox_lang). Switching to 'ar' auto-translates
 * the page via LibreTranslate, caching results in localStorage. A small manual
 * dictionary serves as instant/offline fallback and powers t() for JS strings.
 *
 * Rule: numbers / prices are never translated (see shouldTranslate).
 */
(function (global) {
  'use strict';

  var LANG_KEY = 'carfox_lang';

  var TRANSLATIONS = {
    en: {
      'nav.home': 'Home',
      'nav.browse': 'Browse',
      'nav.messages': 'Messages',
      'nav.account': 'Account',
      'nav.saved': 'Saved',
      'home.search_placeholder': 'Search make, model...',
      'home.browse_by_brand': 'Browse by Brand',
      'home.show_all_brands': 'Show all brands',
      'home.show_less': 'Show less',
      'home.all_brands': 'All Brands',
      'home.new_arrivals': 'New Arrivals',
      'home.latest_listings': 'Latest Listings',
      'home.see_all': 'See all →',
      'home.no_photo': 'No photo',
      'cars.title': 'Browse Cars',
      'cars.filter': 'Filter',
      'cars.sort': 'Sort',
      'cars.no_results': 'No cars found',
      'cars.loading': 'Loading...',
      'detail.contact_dealer': 'Contact Dealer',
      'detail.whatsapp': 'WhatsApp',
      'detail.save': 'Save',
      'detail.saved': 'Saved',
      'detail.mileage': 'Mileage',
      'detail.transmission': 'Transmission',
      'detail.fuel_type': 'Fuel Type',
      'detail.body_type': 'Body Type',
      'detail.color': 'Color',
      'detail.year': 'Year',
      'detail.description': 'Description',
      'detail.dealer_info': 'Dealer Info',
      'detail.listed': 'Listed',
      'detail.views': 'views',
      'auth.sign_in': 'Sign In',
      'auth.sign_up': 'Sign Up',
      'auth.email': 'Email',
      'auth.password': 'Password',
      'auth.full_name': 'Full Name',
      'auth.phone': 'Phone',
      'auth.governorate': 'Governorate',
      'auth.submit': 'Submit',
      'auth.become_dealer': 'Become a Dealer',
      'dealer.dashboard': 'Dashboard',
      'dealer.inventory': 'Inventory',
      'dealer.inquiries': 'Inquiries',
      'dealer.account': 'Account',
      'dealer.add_vehicle': '+ Add',
      'dealer.mark_sold': 'Mark Sold',
      'dealer.pause': 'Pause',
      'dealer.resume': 'Resume',
      'dealer.delete': 'Delete',
      'dealer.publish': 'Publish',
      'dealer.edit': 'Edit',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.loading': 'Loading...',
      'common.error': 'Something went wrong',
      'common.egp': 'EGP',
      'common.km': 'km'
    },
    ar: {
      'nav.home': 'الرئيسية',
      'nav.browse': 'تصفح',
      'nav.messages': 'الرسائل',
      'nav.account': 'حسابي',
      'nav.saved': 'المحفوظات',
      'home.search_placeholder': 'ابحث عن ماركة أو موديل...',
      'home.browse_by_brand': 'تصفح حسب الماركة',
      'home.show_all_brands': 'عرض كل الماركات',
      'home.show_less': 'عرض أقل',
      'home.all_brands': 'كل الماركات',
      'home.new_arrivals': 'أحدث السيارات',
      'home.latest_listings': 'آخر الإعلانات',
      'home.see_all': 'عرض الكل ←',
      'home.no_photo': 'لا توجد صورة',
      'cars.title': 'تصفح السيارات',
      'cars.filter': 'تصفية',
      'cars.sort': 'ترتيب',
      'cars.no_results': 'لا توجد سيارات',
      'cars.loading': 'جارٍ التحميل...',
      'detail.contact_dealer': 'تواصل مع التاجر',
      'detail.whatsapp': 'واتساب',
      'detail.save': 'حفظ',
      'detail.saved': 'محفوظ',
      'detail.mileage': 'المسافة المقطوعة',
      'detail.transmission': 'ناقل الحركة',
      'detail.fuel_type': 'نوع الوقود',
      'detail.body_type': 'نوع الهيكل',
      'detail.color': 'اللون',
      'detail.year': 'سنة الصنع',
      'detail.description': 'الوصف',
      'detail.dealer_info': 'معلومات التاجر',
      'detail.listed': 'تاريخ النشر',
      'detail.views': 'مشاهدة',
      'auth.sign_in': 'تسجيل الدخول',
      'auth.sign_up': 'إنشاء حساب',
      'auth.email': 'البريد الإلكتروني',
      'auth.password': 'كلمة المرور',
      'auth.full_name': 'الاسم الكامل',
      'auth.phone': 'رقم الهاتف',
      'auth.governorate': 'المحافظة',
      'auth.submit': 'إرسال',
      'auth.become_dealer': 'انضم كتاجر',
      'dealer.dashboard': 'لوحة التحكم',
      'dealer.inventory': 'المخزون',
      'dealer.inquiries': 'الاستفسارات',
      'dealer.account': 'حسابي',
      'dealer.add_vehicle': '+ إضافة',
      'dealer.mark_sold': 'تم البيع',
      'dealer.pause': 'إيقاف مؤقت',
      'dealer.resume': 'استئناف',
      'dealer.delete': 'حذف',
      'dealer.publish': 'نشر',
      'dealer.edit': 'تعديل',
      'common.save': 'حفظ',
      'common.cancel': 'إلغاء',
      'common.loading': 'جارٍ التحميل...',
      'common.error': 'حدث خطأ ما',
      'common.egp': 'ج.م',
      'common.km': 'كم'
    }
  };

  function normalizeLang(lang) {
    return lang === 'ar' ? 'ar' : 'en';
  }

  function getLang() {
    try {
      return normalizeLang(localStorage.getItem(LANG_KEY) || 'en');
    } catch (_) {
      return 'en';
    }
  }

  function t(key) {
    var lang = getLang();
    var table = TRANSLATIONS[lang] || TRANSLATIONS.en;
    if (table && table[key] != null) return table[key];
    return (TRANSLATIONS.en && TRANSLATIONS.en[key]) || key;
  }

  function applyBodyFont(lang) {
    if (!document.body) return;
    document.body.classList.toggle('font-cairo', lang === 'ar');
    document.documentElement.lang = lang;
  }

  function applyDir() {
    var lang = getLang();
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('nav.fixed').forEach(function (nav) {
      nav.setAttribute('dir', 'ltr');
    });
  }

  // ---- Translatability rule -------------------------------------------------
  // Never translate numbers, prices, mileage, or phone numbers.
  function shouldTranslate(text) {
    if (!text) return false;
    // Skip pure numbers, prices, phone numbers
    if (/^[\d,.\s]+$/.test(text.trim())) return false;
    if (/EGP|km|\+\d/.test(text)) return false;
    return true;
  }

  // ---- Automatic translation (LibreTranslate) -------------------------------
  // Endpoint and optional API key are overridable via globals so a self-hosted
  // instance / key can be used (the public host often requires api_key + CORS).
  var ENDPOINT = global.CARFOX_LT_ENDPOINT || 'https://libretranslate.com/translate';
  var API_KEY = global.CARFOX_LT_API_KEY || '';
  var CACHE_KEY = 'carfox_i18n_cache_v1';

  // Reverse map (English source text -> translation) built from the manual
  // strings. Used as an instant, offline fallback when the API is unavailable.
  var TEXT_FALLBACK = (function () {
    var out = {};
    Object.keys(TRANSLATIONS).forEach(function (lang) {
      if (lang === 'en') return;
      out[lang] = {};
      Object.keys(TRANSLATIONS[lang]).forEach(function (key) {
        var en = TRANSLATIONS.en[key];
        if (en != null) out[lang][en] = TRANSLATIONS[lang][key];
      });
    });
    return out;
  })();

  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch (_) {
      return {};
    }
  }

  function saveCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_) {}
  }

  function shouldSkip(parent) {
    if (!parent || parent.nodeType !== 1) return true;
    var tag = parent.nodeName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'CODE' || tag === 'PRE') {
      return true;
    }
    if (parent.closest && parent.closest('[translate="no"], .notranslate, [data-i18n-skip]')) {
      return true;
    }
    return false;
  }

  // Collect translatable text nodes; stores the original English on each node.
  function collectTextNodes() {
    var result = [];
    if (!document.body || typeof document.createTreeWalker !== 'function') return result;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var val = node.__cfOrig != null ? node.__cfOrig : node.nodeValue;
        if (!val || !val.trim()) return NodeFilter.FILTER_REJECT;
        if (!/[A-Za-z]/.test(val)) return NodeFilter.FILTER_REJECT; // skip pure numbers/symbols
        if (!shouldTranslate(val)) return NodeFilter.FILTER_REJECT; // skip numbers/prices
        if (shouldSkip(node.parentNode)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (n.__cfOrig == null) n.__cfOrig = n.nodeValue;
      result.push({ node: n, orig: n.__cfOrig, source: n.__cfOrig.trim() });
    }
    return result;
  }

  function collectPlaceholders() {
    var result = [];
    document.querySelectorAll('[placeholder]').forEach(function (el) {
      if (shouldSkip(el)) return;
      if (el.__cfPhOrig == null) el.__cfPhOrig = el.getAttribute('placeholder') || '';
      var orig = el.__cfPhOrig;
      if (orig && /[A-Za-z]/.test(orig) && shouldTranslate(orig)) {
        result.push({ el: el, orig: orig, source: orig.trim() });
      }
    });
    return result;
  }

  function setNodeText(entry, translated) {
    var lead = entry.orig.match(/^\s*/)[0];
    var trail = entry.orig.match(/\s*$/)[0];
    entry.node.nodeValue = lead + translated + trail;
  }

  function restoreEnglish(nodes, placeholders) {
    nodes.forEach(function (e) { e.node.nodeValue = e.orig; });
    placeholders.forEach(function (e) { e.el.setAttribute('placeholder', e.orig); });
  }

  function translatePage(lang) {
    var nodes = collectTextNodes();
    var placeholders = collectPlaceholders();

    if (lang === 'en') {
      restoreEnglish(nodes, placeholders);
      return;
    }

    var cache = loadCache();
    cache[lang] = cache[lang] || {};
    var fallback = TEXT_FALLBACK[lang] || {};

    function resolved(source) {
      return cache[lang][source] != null ? cache[lang][source] : fallback[source];
    }

    function applyAll() {
      nodes.forEach(function (e) {
        var tr = resolved(e.source);
        if (tr != null) setNodeText(e, tr);
      });
      placeholders.forEach(function (e) {
        var tr = resolved(e.source);
        if (tr != null) e.el.setAttribute('placeholder', tr);
      });
    }

    // Figure out which unique strings still need fetching.
    var seen = {};
    var need = [];
    function consider(source) {
      if (!source || seen[source]) return;
      seen[source] = true;
      if (!shouldTranslate(source)) return; // never send numbers/prices
      if (cache[lang][source] == null) need.push(source);
    }
    nodes.forEach(function (e) { consider(e.source); });
    placeholders.forEach(function (e) { consider(e.source); });

    applyAll(); // show whatever we already have (cache/fallback) immediately

    if (!need.length) return;

    var body = { q: need, source: 'en', target: lang, format: 'text' };
    if (API_KEY) body.api_key = API_KEY;

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('translate http ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var out = data && data.translatedText;
        if (Array.isArray(out)) {
          need.forEach(function (src, i) {
            if (out[i] != null) cache[lang][src] = out[i];
          });
        } else if (typeof out === 'string' && need.length === 1) {
          cache[lang][need[0]] = out;
        } else {
          return; // unexpected shape; keep fallback
        }
        saveCache(cache);
        if (getLang() === lang) applyAll();
      })
      .catch(function (err) {
        // API unavailable / CORS / rate limited: fallback strings already applied.
        console.warn('[CarfoxI18n] auto-translate unavailable, using fallback strings:', err.message);
      });
  }

  function apply() {
    var lang = getLang();

    document.querySelectorAll('[data-i18n-dir]').forEach(function (el) {
      el.style.textAlign = lang === 'ar' ? 'right' : 'left';
    });

    applyBodyFont(lang);
    translatePage(lang);
  }

  function setLang(lang) {
    var next = normalizeLang(lang);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch (_) {}
    applyDir();
    apply();
    global.dispatchEvent(new CustomEvent('carfox:langchange', { detail: { lang: next } }));
  }

  global.CarfoxI18n = {
    getLang: getLang,
    setLang: setLang,
    apply: apply,
    applyDir: applyDir,
    shouldTranslate: shouldTranslate,
    t: t
  };
})(typeof window !== 'undefined' ? window : this);
