/**
 * Live search suggestions for CarFox search bars.
 *
 * Attaches to every <input data-suggest> (or call CarfoxSuggest.attach(input)). As the user
 * types (debounced, 2+ characters) a dropdown under the input shows matches from
 * GET /api/search-suggest?q= grouped as Brands / Models / Cars, with the matched text
 * highlighted. Arrow keys move, Enter selects (or submits the form normally when nothing is
 * selected), Esc / outside click closes. Brands and models go to cars.html filtered; cars go
 * straight to the listing.
 */
(function (global) {
  'use strict';

  var DEBOUNCE_MS = 250;
  var MIN_CHARS = 2;
  var styleInjected = false;

  var CSS =
    '.cf-suggest{position:absolute;z-index:220;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 32px rgba(15,23,42,.14);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;text-align:left;}' +
    '.cf-suggest[hidden]{display:none;}' +
    '.cf-suggest .cf-sg-h{padding:8px 14px 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#94a3b8;}' +
    '.cf-suggest .cf-sg-i{display:flex;align-items:center;gap:12px;width:100%;padding:9px 14px;text-align:left;background:#fff;color:#111827;font-size:14px;cursor:pointer;border:0;}' +
    '.cf-suggest .cf-sg-i[aria-selected="true"],.cf-suggest .cf-sg-i:hover{background:#eff6ff;}' +
    '.cf-suggest .cf-sg-i img{width:32px;height:32px;object-fit:contain;flex-shrink:0;border-radius:6px;background:#f8fafc;}' +
    '.cf-suggest .cf-sg-i .cf-sg-thumb{width:48px;height:36px;object-fit:cover;border-radius:6px;background:#f1f5f9;}' +
    '.cf-suggest .cf-sg-i .cf-sg-fb{width:32px;height:32px;border-radius:999px;background:#e5e7eb;color:#4b5563;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;}' +
    '.cf-suggest .cf-sg-i .cf-sg-t{min-width:0;flex:1;display:flex;flex-direction:column;}' +
    '.cf-suggest .cf-sg-i .cf-sg-t > span:first-child{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.25;}' +
    '.cf-suggest .cf-sg-i .cf-sg-s{font-size:12px;color:#6b7280;}' +
    '.cf-suggest .cf-sg-i .cf-sg-c{font-size:12px;color:#9ca3af;flex-shrink:0;}' +
    '.cf-suggest .cf-sg-i .cf-sg-p{font-size:13px;font-weight:700;color:#1d4ed8;flex-shrink:0;}' +
    '.cf-suggest mark{background:transparent;color:#1d4ed8;font-weight:700;}' +
    '.cf-suggest .cf-sg-e{padding:12px 14px;font-size:13px;color:#6b7280;}';

  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function highlight(text, q) {
    var t = String(text == null ? '' : text);
    var idx = t.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1 || !q) return esc(t);
    return esc(t.slice(0, idx)) + '<mark>' + esc(t.slice(idx, idx + q.length)) + '</mark>' + esc(t.slice(idx + q.length));
  }
  function brandLogoUrl(brand) {
    if (/^mercedes/i.test(brand)) return 'https://www.carlogos.org/car-logos/mercedes-benz-logo.png';
    return 'https://www.carlogos.org/car-logos/' + String(brand).toLowerCase().replace(/\s+/g, '-') + '-logo.png';
  }
  function fmtPrice(cents) {
    if (!cents || cents <= 0) return '';
    return Math.round(Number(cents) / 100).toLocaleString('en-EG') + ' EGP';
  }

  function attach(input, options) {
    if (!input || input.__cfSuggest) return;
    options = options || {};
    injectStyle();
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-autocomplete', 'list');

    var box = document.createElement('div');
    box.className = 'cf-suggest';
    box.setAttribute('role', 'listbox');
    box.hidden = true;
    document.body.appendChild(box);

    var items = [];
    var active = -1;
    var timer = null;
    var controller = null;
    var lastQuery = '';

    function position() {
      // Anchor to the whole search bar (form) so the dropdown lines up with its rounded edge,
      // not with the inner input that sits after the magnifier icon.
      var anchor = input.closest('form') || input.parentElement || input;
      var r = anchor.getBoundingClientRect();
      var vv = global.visualViewport;
      var viewportBottom = vv ? vv.offsetTop + vv.height : global.innerHeight;
      var available = Math.max(140, viewportBottom - r.bottom - 12);
      box.style.left = Math.round(r.left + global.scrollX) + 'px';
      box.style.top = Math.round(r.bottom + global.scrollY + 6) + 'px';
      box.style.width = Math.round(Math.max(r.width, 260)) + 'px';
      box.style.maxHeight = Math.round(Math.min(available, 420)) + 'px';
    }

    function close() {
      box.hidden = true;
      active = -1;
      items = [];
      input.removeAttribute('aria-activedescendant');
    }

    function select(item) {
      close();
      if (item.href) global.location.href = item.href;
    }

    function setActive(i) {
      var nodes = box.querySelectorAll('.cf-sg-i');
      if (!nodes.length) return;
      if (i < 0) i = nodes.length - 1;
      if (i >= nodes.length) i = 0;
      active = i;
      nodes.forEach(function (n, k) {
        n.setAttribute('aria-selected', k === i ? 'true' : 'false');
        n.id = k === i ? 'cfsg-active' : '';
      });
      input.setAttribute('aria-activedescendant', 'cfsg-active');
      var n = nodes[i];
      if (n.offsetTop < box.scrollTop) box.scrollTop = n.offsetTop;
      else if (n.offsetTop + n.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = n.offsetTop + n.offsetHeight - box.clientHeight;
    }

    function render(data, q) {
      items = [];
      var html = '';
      function group(title, list, mapper) {
        if (!list || !list.length) return;
        html += '<div class="cf-sg-h">' + title + '</div>';
        list.forEach(function (it) {
          var m = mapper(it);
          items.push(m);
          html += '<button type="button" class="cf-sg-i" role="option" aria-selected="false" data-i="' + (items.length - 1) + '">' + m.html + '</button>';
        });
      }
      group('Brands', data.makes, function (m) {
        return {
          href: '/cars.html?make=' + encodeURIComponent(m.name),
          html: '<img src="' + esc(m.logo_url || brandLogoUrl(m.name)) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<span class=&quot;cf-sg-fb&quot;>' + esc(m.name.charAt(0)) + '</span>\'" />' +
            '<span class="cf-sg-t"><span>' + highlight(m.name, q) + '</span></span>' +
            '<span class="cf-sg-c">' + m.count + ' ' + (m.count === 1 ? 'car' : 'cars') + '</span>'
        };
      });
      group('Models', data.models, function (m) {
        return {
          href: '/cars.html?make=' + encodeURIComponent(m.make) + '&model=' + encodeURIComponent(m.model),
          html: '<span class="cf-sg-fb">' + esc(m.make.charAt(0)) + '</span>' +
            '<span class="cf-sg-t"><span>' + highlight(m.make + ' ' + m.model, q) + '</span></span>' +
            '<span class="cf-sg-c">' + m.count + ' ' + (m.count === 1 ? 'car' : 'cars') + '</span>'
        };
      });
      group('Cars', data.cars, function (c) {
        var title = [c.year, c.make, c.model].filter(Boolean).join(' ') + (c.trim ? ' ' + c.trim : '');
        return {
          href: '/cars/' + c.id,
          html: (c.primary_photo_url ? '<img class="cf-sg-thumb" src="' + esc(c.primary_photo_url) + '" alt="" loading="lazy" />' : '<span class="cf-sg-thumb"></span>') +
            '<span class="cf-sg-t"><span>' + highlight(title, q) + '</span>' + (c.governorate ? '<span class="cf-sg-s">' + esc(c.governorate) + '</span>' : '') + '</span>' +
            '<span class="cf-sg-p">' + esc(fmtPrice(c.price)) + '</span>'
        };
      });
      if (!items.length) html = '<div class="cf-sg-e">No matches for “' + esc(q) + '”. Press Enter to search everything.</div>';
      box.innerHTML = html;
      active = -1;
      position();
      box.hidden = false;
    }

    function fetchSuggestions(q) {
      if (controller) controller.abort();
      controller = new AbortController();
      fetch('/api/search-suggest?q=' + encodeURIComponent(q), { signal: controller.signal })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || q !== lastQuery) return;
          render(data, q);
        })
        .catch(function () {});
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      lastQuery = q;
      clearTimeout(timer);
      if (q.length < MIN_CHARS) { close(); return; }
      timer = setTimeout(function () { fetchSuggestions(q); }, DEBOUNCE_MS);
    });
    input.addEventListener('focus', function () {
      if (input.value.trim().length >= MIN_CHARS && items.length) { position(); box.hidden = false; }
    });
    input.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') {
        if (active >= 0 && items[active]) { e.preventDefault(); select(items[active]); }
        else close(); // nothing highlighted: let the form submit as before
      }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    box.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep input focus on click
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('.cf-sg-i');
      if (!btn) return;
      var it = items[Number(btn.getAttribute('data-i'))];
      if (it) select(it);
    });
    document.addEventListener('click', function (e) {
      if (box.hidden) return;
      if (e.target === input || box.contains(e.target)) return;
      close();
    });
    global.addEventListener('resize', function () { if (!box.hidden) position(); });
    global.addEventListener('scroll', function () { if (!box.hidden) position(); }, { passive: true });
    if (global.visualViewport) global.visualViewport.addEventListener('resize', function () { if (!box.hidden) position(); });

    input.__cfSuggest = { close: close, box: box };
    return input.__cfSuggest;
  }

  function init() {
    document.querySelectorAll('input[data-suggest]').forEach(function (el) { attach(el); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.CarfoxSuggest = { attach: attach };
})(typeof window !== 'undefined' ? window : this);
