/**
 * Buyer messaging nav badge + shared helpers for inbox/chat pages.
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

  function formatMessageTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  /** Short clock time for in-bubble display (e.g. 4:15 PM). */
  function formatBubbleTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function vehicleTitle(vehicle) {
    if (!vehicle) return '';
    return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  }

  function clearAuth() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) {}
  }

  function requireBuyerPageAuth(returnTo) {
    const token = (function () {
      try {
        return localStorage.getItem(TOKEN_KEY) || '';
      } catch (_) {
        return '';
      }
    })();

    if (!token) {
      window.location.replace(
        '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
      );
      return Promise.resolve(null);
    }

    return fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(function (res) {
        if (res.status === 401 || !res.ok) {
          clearAuth();
          window.location.replace(
            '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
          );
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.user) {
          clearAuth();
          window.location.replace(
            '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
          );
          return null;
        }
        if (data.user.role !== 'buyer') {
          clearAuth();
          window.location.replace(
            '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
          );
          return null;
        }
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        } catch (_) {}
        return { user: data.user, token: token };
      })
      .catch(function () {
        clearAuth();
        window.location.replace(
          '/buyer/login.html?returnTo=' + encodeURIComponent(returnTo || '/buyer/inbox.html')
        );
        return null;
      });
  }

  function initMessagesUnreadBadge() {
    const token = (function () {
      try {
        return localStorage.getItem(TOKEN_KEY) || '';
      } catch (_) {
        return '';
      }
    })();
    if (!token) return;

    let user = null;
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) user = JSON.parse(raw);
    } catch (_) {}
    if (user && user.role && user.role !== 'buyer') return;

    fetch('/api/conversations/unread-count', {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !(data.total_unread > 0)) return;
        document.querySelectorAll('[data-messages-unread-dot]').forEach(function (el) {
          el.classList.remove('hidden');
        });
      })
      .catch(function () {});
  }

  global.CarfoxBuyerNav = {
    escapeHtml: escapeHtml,
    formatPriceCents: formatPriceCents,
    formatRelativeTime: formatRelativeTime,
    formatMessageTime: formatMessageTime,
    formatBubbleTime: formatBubbleTime,
    vehicleTitle: vehicleTitle,
    requireBuyerPageAuth: requireBuyerPageAuth,
    initMessagesUnreadBadge: initMessagesUnreadBadge,
    clearAuth: clearAuth,
    TOKEN_KEY: TOKEN_KEY,
    USER_KEY: USER_KEY
  };
})(typeof window !== 'undefined' ? window : global);
