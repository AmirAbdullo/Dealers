/**
 * Dealer auth, inquiries nav badge, and shared conversation UI helpers.
 */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'carfox_token';
  const USER_KEY = 'carfox_user';

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatPriceCents(cents) {
    if (!cents || cents <= 0) return 'Price on request';
    return Math.round(Number(cents) / 100).toLocaleString('en-EG') + ' EGP';
  }

  function formatRelativeTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatBubbleTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function vehicleTitle(vehicle) {
    if (!vehicle) return '';
    return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  }

  function initialsFromName(fullName) {
    const parts = String(fullName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function clearAuth() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) {}
  }

  function requireDealerPageAuth(returnTo) {
    const loginUrl =
      '/dealer/login.html?returnTo=' +
      encodeURIComponent(returnTo || '/dealer/inquiries.html');
    const token = (function () {
      try {
        return localStorage.getItem(TOKEN_KEY) || '';
      } catch (_) {
        return '';
      }
    })();

    if (!token) {
      window.location.replace(loginUrl);
      return Promise.resolve(null);
    }

    return fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) {
        if (res.status === 401 || !res.ok) {
          clearAuth();
          window.location.replace(loginUrl);
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.user || data.user.role !== 'dealer') {
          clearAuth();
          window.location.replace(loginUrl);
          return null;
        }
        if (!data.dealership || data.dealership.status !== 'approved') {
          clearAuth();
          window.location.replace(loginUrl);
          return null;
        }
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        } catch (_) {}
        return { user: data.user, dealership: data.dealership, token: token };
      })
      .catch(function () {
        clearAuth();
        window.location.replace(loginUrl);
        return null;
      });
  }

  function initInquiriesUnreadBadge() {
    const token = (function () {
      try {
        return localStorage.getItem(TOKEN_KEY) || '';
      } catch (_) {
        return '';
      }
    })();
    if (!token) return;

    fetch('/api/conversations/unread-count', {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !(data.total_unread > 0)) return;
        document.querySelectorAll('[data-inquiries-unread-dot]').forEach(function (el) {
          el.classList.remove('hidden');
        });
      })
      .catch(function () {});
  }

  function filterConversations(conversations, tab) {
    const list = conversations || [];
    if (tab === 'unread') {
      return list.filter(function (c) {
        return c.unread_count > 0;
      });
    }
    if (tab === 'active') {
      return list.filter(function (c) {
        return (
          c.vehicle_id != null &&
          c.vehicle &&
          c.vehicle.status === 'active'
        );
      });
    }
    if (tab === 'general') {
      return list.filter(function (c) {
        return c.vehicle_id == null;
      });
    }
    return list;
  }

  function vehicleLineHtml(conv) {
    const v = conv.vehicle;
    if (conv.vehicle_id && v) {
      let badges = '';
      if (v.status === 'sold') {
        badges +=
          ' <span class="inline-flex text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 ml-1 align-middle">Sold</span>';
      }
      if (v.status === 'archived') {
        badges +=
          ' <span class="inline-flex text-[10px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 ml-1 align-middle">Archived</span>';
      }
      return (
        '<p class="text-sm text-gray-600 truncate">About: ' +
        escapeHtml(vehicleTitle(v)) +
        badges +
        '</p>'
      );
    }
    return '<p class="text-sm text-gray-600 truncate italic">General inquiry</p>';
  }

  function thumbHtml(conv) {
    const buyer = conv.other_party || {};
    const v = conv.vehicle;
    if (v && v.primary_photo_url) {
      return (
        '<img src="' +
        escapeHtml(v.primary_photo_url) +
        '" alt="" class="w-14 h-14 rounded-lg object-cover bg-gray-100 shrink-0" />'
      );
    }
    if (conv.vehicle_id) {
      return (
        '<div class="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">' +
        '<svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 17h8M6 11h12l-1-4H7l-1 4z"/></svg>' +
        '</div>'
      );
    }
    return (
      '<div class="w-14 h-14 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">' +
      '<span class="text-blue-700 font-bold text-sm">' +
      escapeHtml(initialsFromName(buyer.name)) +
      '</span></div>'
    );
  }

  /** @param {object} conv @param {boolean} compact */
  function renderInquiryCardHtml(conv, compact) {
    const buyer = conv.other_party || {};
    const preview = conv.last_message_preview
      ? escapeHtml(conv.last_message_preview)
      : '<span class="italic">No messages yet</span>';
    const time = escapeHtml(formatRelativeTime(conv.last_message_at));
    const unread =
      conv.unread_count > 0
        ? '<span class="inline-flex bg-red-600 text-white text-xs px-2 py-0.5 rounded-full mt-2">' +
          escapeHtml(String(conv.unread_count)) +
          '</span>'
        : '';
    const py = compact ? 'py-3' : 'py-4';

    return (
      '<a href="/dealer/chat.html?conversation=' +
      encodeURIComponent(conv.id) +
      '" class="flex items-start gap-3 px-3 ' +
      py +
      ' rounded-lg hover:bg-gray-50 border-b border-gray-100 cursor-pointer">' +
      thumbHtml(conv) +
      '<div class="flex-1 min-w-0">' +
      '<p class="font-semibold text-gray-900 truncate">' +
      escapeHtml(buyer.name || 'Customer') +
      '</p>' +
      vehicleLineHtml(conv) +
      '<p class="text-sm text-gray-500 truncate mt-1">' +
      preview +
      '</p></div>' +
      '<div class="shrink-0 text-right">' +
      '<span class="text-xs text-gray-500">' +
      time +
      '</span>' +
      unread +
      '</div></a>'
    );
  }

  function dealerBottomNavHtml(activeTab) {
    function tabClass(id) {
      return id === activeTab
        ? 'flex flex-col items-center justify-center text-blue-700'
        : 'flex flex-col items-center justify-center text-gray-600 hover:text-gray-900';
    }

    return (
      '<nav class="fixed bottom-0 left-0 right-0 md:hidden border-t border-gray-200 bg-white h-16" style="padding-bottom: env(safe-area-inset-bottom);">' +
      '<div class="mx-auto max-w-7xl grid grid-cols-4 h-full">' +
      '<a href="/dealer/dashboard.html" class="' +
      tabClass('dashboard') +
      '">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.172 2.25 10.5V21h6.75v-6h6v6h6V10.5L12 3.172z"/></svg>' +
      '<span class="text-[11px] leading-tight mt-1">Dashboard</span></a>' +
      '<a href="/dealer/inventory.html" class="' +
      tabClass('inventory') +
      '">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M3 16v3h2v-2h14v2h2v-3l-2-5H5l-2 5zm3.5-6h11l-1.2-3H7.7L6.5 10z"/></svg>' +
      '<span class="text-[11px] leading-tight mt-1">Inventory</span></a>' +
      '<a href="/dealer/inquiries.html" class="relative ' +
      tabClass('inquiries') +
      '">' +
      '<span class="relative inline-flex">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v12H6l-2 2V4zm2 3v2h12V7H6zm0 4v2h8v-2H6z"/></svg>' +
      '<span data-inquiries-unread-dot class="hidden absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500" aria-hidden="true"></span>' +
      '</span><span class="text-[11px] leading-tight mt-1' +
      (activeTab === 'inquiries' ? ' font-medium' : '') +
      '">Inquiries</span></a>' +
      '<a href="/dealer/account.html" class="' +
      tabClass('account') +
      '">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5z"/></svg>' +
      '<span class="text-[11px] leading-tight mt-1">Account</span></a>' +
      '</div></nav>'
    );
  }

  function mountDealerBottomNav(container, activeTab) {
    if (!container) return;
    container.innerHTML = dealerBottomNavHtml(activeTab);
    initInquiriesUnreadBadge();
  }

  /**
   * Desktop-only dark header shared by all dealer pages.
   * Injected at the top of <body>; hidden on mobile (bottom nav is used there).
   */
  function dealerDesktopHeaderHtml(activeTab, user) {
    function linkClass(id) {
      return id === activeTab
        ? 'text-white font-semibold border-b-2 border-orange-500 pb-1'
        : 'text-gray-300 hover:text-white pb-1 border-b-2 border-transparent';
    }
    const name = (user && (user.full_name || user.fullName || user.email)) || 'Account';
    const firstName = String(name).split(' ')[0];
    const initials = initialsFromName(name);

    return (
      '<header id="dealerDesktopHeader" class="hidden md:block sticky top-0 z-40 bg-[#0f1f3d]">' +
      '<div class="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-6">' +
      '<div class="flex items-center gap-8">' +
      '<a href="/" class="text-xl font-extrabold tracking-tight">' +
      '<span class="text-white">Car</span><span class="text-orange-500">Fox</span>' +
      '</a>' +
      '<nav class="flex items-center gap-6 text-sm">' +
      '<a href="/dealer/dashboard.html" class="' + linkClass('dashboard') + '">Dashboard</a>' +
      '<a href="/dealer/inventory.html" class="' + linkClass('inventory') + '">Inventory</a>' +
      '<a href="/dealer/inquiries.html" class="relative ' + linkClass('inquiries') + '">Inquiries' +
      '<span data-inquiries-unread-dot class="hidden absolute -top-1 -right-2 h-2 w-2 rounded-full bg-red-500" aria-hidden="true"></span>' +
      '</a>' +
      '<a href="/dealer/add-vehicle.html" class="' + linkClass('add') + '">+ Add Vehicle</a>' +
      '</nav>' +
      '</div>' +
      '<div class="flex items-center gap-4">' +
      '<a href="/" class="text-gray-300 hover:text-white text-sm">View Site</a>' +
      '<div class="relative">' +
      '<button type="button" id="dealerHeaderProfileBtn" class="flex items-center gap-2 text-gray-300 hover:text-white text-sm font-semibold">' +
      '<span class="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold">' + escapeHtml(initials) + '</span>' +
      '<span>' + escapeHtml(firstName) + '</span>' +
      '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>' +
      '</button>' +
      '<div id="dealerHeaderProfileMenu" class="hidden absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg py-1 z-50">' +
      '<a href="/dealer/account.html" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">My Account</a>' +
      '<a href="/dealer/chat.html" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Messages</a>' +
      '<hr class="my-1"/>' +
      '<button type="button" id="dealerHeaderSignOut" class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50">Sign Out</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</header>'
    );
  }

  function mountDealerDesktopHeader(activeTab) {
    if (document.getElementById('dealerDesktopHeader')) return;
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch (_) {}

    document.body.insertAdjacentHTML('afterbegin', dealerDesktopHeaderHtml(activeTab, user));

    const btn = document.getElementById('dealerHeaderProfileBtn');
    const menu = document.getElementById('dealerHeaderProfileMenu');
    if (btn && menu) {
      btn.addEventListener('click', function () {
        menu.classList.toggle('hidden');
      });
      document.addEventListener('click', function (e) {
        if (btn.contains(e.target) || menu.contains(e.target)) return;
        menu.classList.add('hidden');
      });
    }
    const signOut = document.getElementById('dealerHeaderSignOut');
    if (signOut) {
      signOut.addEventListener('click', function () {
        clearAuth();
        window.location.href = '/';
      });
    }
    initInquiriesUnreadBadge();
  }

  global.CarfoxDealerNav = {
    escapeHtml: escapeHtml,
    formatPriceCents: formatPriceCents,
    formatRelativeTime: formatRelativeTime,
    formatBubbleTime: formatBubbleTime,
    vehicleTitle: vehicleTitle,
    initialsFromName: initialsFromName,
    requireDealerPageAuth: requireDealerPageAuth,
    initInquiriesUnreadBadge: initInquiriesUnreadBadge,
    filterConversations: filterConversations,
    renderInquiryCardHtml: renderInquiryCardHtml,
    dealerBottomNavHtml: dealerBottomNavHtml,
    mountDealerBottomNav: mountDealerBottomNav,
    dealerDesktopHeaderHtml: dealerDesktopHeaderHtml,
    mountDealerDesktopHeader: mountDealerDesktopHeader,
    clearAuth: clearAuth,
    TOKEN_KEY: TOKEN_KEY,
    USER_KEY: USER_KEY
  };
})(typeof window !== 'undefined' ? window : global);
