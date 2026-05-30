/**
 * CarFox — Arabic / English UI strings (localStorage: carfox_lang).
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

  function apply() {
    var lang = getLang();
    var table = TRANSLATIONS[lang] || TRANSLATIONS.en;

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      var text = (table && table[key]) || (TRANSLATIONS.en && TRANSLATIONS.en[key]) || key;
      el.textContent = text;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      var text = (table && table[key]) || (TRANSLATIONS.en && TRANSLATIONS.en[key]) || '';
      el.setAttribute('placeholder', text);
    });

    document.querySelectorAll('[data-i18n-dir]').forEach(function (el) {
      el.style.textAlign = lang === 'ar' ? 'right' : 'left';
    });

    applyBodyFont(lang);
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
    t: t
  };
})(typeof window !== 'undefined' ? window : this);
