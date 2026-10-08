/**
 * CarFox i18n loader.
 *
 * Dictionaries live in /js/i18n/<lang>.json (flat "key": "text"). The saved language is read from
 * localStorage (carfox_lang, default "en"). Only pages that include this script are translated, so
 * untranslated pages keep working in English even when Arabic is selected.
 *
 *   CarfoxI18n.getLang()            -> 'en' | 'ar'
 *   CarfoxI18n.setLang('ar')        -> saves, loads the dictionary, flips dir/lang, re-applies, fires
 *                                      'carfox:langchange' (no reload)
 *   CarfoxI18n.t(key, vars)         -> translated string ({name} placeholders), English fallback, else key
 *   CarfoxI18n.has(key)             -> whether a translation (or English fallback) exists
 *   CarfoxI18n.tr(group, value)     -> translates a data value such as a fuel type: tr('fuel', 'Petrol')
 *   CarfoxI18n.apply(root)          -> fills [data-i18n], [data-i18n-placeholder|aria-label|title|value]
 *   CarfoxI18n.ready(fn)            -> runs fn once the dictionaries are loaded (fires 'carfox:i18nready')
 *   CarfoxI18n.isRtl()
 *
 * Rules: numbers, prices and phone numbers are never translated (they stay Western digits, LTR).
 * Arabic switches <html> to dir="rtl" lang="ar" and the Cairo font; the mobile bottom nav keeps its
 * item order in both languages (it sets dir="ltr" on its own grid).
 */
(function (global) {
  'use strict';

  var LANG_KEY = 'carfox_lang';
  var SUPPORTED = { en: true, ar: true };
  var BASE = '/js/i18n/';
  var FONT_HREF = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap';

  var dicts = {};
  var pending = {};
  var lang = readLang();
  var readyResolve;
  var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });
  var isReady = false;

  function normalize(l) {
    return SUPPORTED[l] ? l : 'en';
  }

  function readLang() {
    try {
      return normalize(localStorage.getItem(LANG_KEY) || 'en');
    } catch (_) {
      return 'en';
    }
  }

  function getLang() {
    return lang;
  }

  function isRtl() {
    return lang === 'ar';
  }

  function ensureStyle() {
    if (document.getElementById('cfI18nStyle')) return;
    var s = document.createElement('style');
    s.id = 'cfI18nStyle';
    s.textContent =
      'html[lang="ar"] body{font-family:"Cairo",ui-sans-serif,system-ui,sans-serif}' +
      'html.cf-i18n-loading[lang="ar"] body{visibility:hidden}';
    document.head.appendChild(s);
  }

  function ensureFont() {
    if (lang !== 'ar') return;
    if (document.querySelector('link[href*="family=Cairo"]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = FONT_HREF;
    document.head.appendChild(l);
  }

  function applyDocumentAttrs() {
    var html = document.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';
    ensureStyle();
    ensureFont();
  }

  function fetchDict(l) {
    if (dicts[l]) return Promise.resolve(dicts[l]);
    if (pending[l]) return pending[l];
    pending[l] = fetch(BASE + l + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (d) {
        dicts[l] = d && typeof d === 'object' ? d : {};
        delete pending[l];
        return dicts[l];
      });
    return pending[l];
  }

  function load() {
    var jobs = [fetchDict('en')];
    if (lang !== 'en') jobs.push(fetchDict(lang));
    return Promise.all(jobs);
  }

  function lookup(key) {
    var d = dicts[lang];
    if (d && d[key] != null) return d[key];
    var en = dicts.en;
    if (en && en[key] != null) return en[key];
    return null;
  }

  function has(key) {
    return lookup(key) != null;
  }

  function interpolate(s, vars) {
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] != null ? vars[k] : m;
    });
  }

  function t(key, vars) {
    var s = lookup(key);
    return s == null ? key : interpolate(s, vars);
  }

  function valueKey(group, value) {
    return group + '.' + String(value).trim().toLowerCase().replace(/\s+/g, '_');
  }

  // Translates a data value (fuel type, transmission, colour, brand…) when the dictionary knows it.
  function tr(group, value) {
    if (value == null || value === '') return value;
    var k = valueKey(group, value);
    var s = lookup(k);
    return s == null ? value : s;
  }

  var ATTRS = ['placeholder', 'aria-label', 'title', 'value', 'alt'];

  function apply(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      if (has(k)) nodes[i].textContent = t(k);
    }
    ATTRS.forEach(function (attr) {
      var els = root.querySelectorAll('[data-i18n-' + attr + ']');
      for (var j = 0; j < els.length; j++) {
        var key = els[j].getAttribute('data-i18n-' + attr);
        if (has(key)) els[j].setAttribute(attr, t(key));
      }
    });
    if (has('meta.title') && root === document) document.title = t('meta.title');
  }

  function dispatch(name) {
    try {
      global.dispatchEvent(new CustomEvent(name, { detail: { lang: lang, dir: lang === 'ar' ? 'rtl' : 'ltr' } }));
    } catch (_) {}
  }

  function setLang(next) {
    next = normalize(next);
    try { localStorage.setItem(LANG_KEY, next); } catch (_) {}
    lang = next;
    applyDocumentAttrs();
    return load().then(function () {
      apply();
      dispatch('carfox:langchange');
      return lang;
    });
  }

  function ready(fn) {
    return fn ? readyPromise.then(fn) : readyPromise;
  }

  // ---- boot ----
  document.documentElement.classList.add('cf-i18n-loading');
  applyDocumentAttrs();
  load().then(function () {
    isReady = true;
    document.documentElement.classList.remove('cf-i18n-loading');
    function finish() {
      apply();
      readyResolve(lang);
      dispatch('carfox:i18nready');
    }
    if (document.body) finish();
    else document.addEventListener('DOMContentLoaded', finish);
  });

  global.CarfoxI18n = {
    getLang: getLang,
    setLang: setLang,
    t: t,
    has: has,
    tr: tr,
    apply: apply,
    ready: ready,
    isRtl: isRtl,
    isReady: function () { return isReady; }
  };
})(typeof window !== 'undefined' ? window : this);
