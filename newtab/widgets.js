"use strict";

/* zwire new tab — the widget bodies. One renderer per widget type in the
 * zntp-core catalog; newtab.js owns the grid and hands each one its box.
 *
 * Three data classes, deliberately kept apart:
 *   LOCAL   — clock, search, speed dial, webpage: no API, no async.
 *   OWN API — top sites, bookmarks, history: this extension's own permissions.
 *   HUD     — feeds, notes, reading list, sessions: data the HUD extension owns.
 *             An extension cannot read a sibling's storage or its readingList, so
 *             those go over the existing external-message bridge (the same channel
 *             palette.js already uses) and the HUD answers with plain rows. When the
 *             HUD is unloaded the widget says so instead of rendering an empty list.
 *
 * Every renderer is synchronous about its chrome (header + shell) and asynchronous
 * only about its rows, so a slow source can never delay first paint. */

var ZBWidgets = (function () {
  var N = window.ZWIRE_NTP;
  var HUD_ID = 'omcgnnjfmbmpdlofklbpddkhnfibfhgg';            // zwire HUD Internal
  var timers = [];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function every(ms, fn) { fn(); timers.push(setInterval(fn, ms)); }
  /* A re-render replaces the whole grid, so any interval a previous paint started
   * would tick against detached nodes forever. newtab.js calls this first. */
  function reset() {
    timers.forEach(clearInterval);
    timers = [];
  }

  /* ------------------------------------------------------------- shared bits */
  function header(host, spec, sub) {
    var h = el('div', 'ntp-w-head');
    h.appendChild(el('span', 'ntp-w-glyph', spec.glyph));
    h.appendChild(el('span', 'ntp-w-title', spec.label));
    if (sub) h.appendChild(el('span', 'ntp-w-sub', sub));
    host.appendChild(h);
    return h;
  }
  function listHost(host) {
    var l = el('div', 'ntp-list');
    host.appendChild(l);
    return l;
  }
  function status(listEl, text) {
    listEl.textContent = '';
    listEl.appendChild(el('div', 'ntp-list-empty', text));
  }
  /* rows: [{ title, url, sub }] — one shape for every list widget so the row
   * chrome, favicon, click target and truncation can't drift between them. */
  function fillRows(listEl, rows, ctx, empty) {
    listEl.textContent = '';
    if (!rows || !rows.length) { status(listEl, empty || 'Nothing here yet.'); return; }
    rows.forEach(function (r) {
      var url = N.safeUrl(r.url);
      var row = el(url ? 'a' : 'div', 'ntp-row');
      if (url) { row.href = url; row.title = url; }
      var ic = el('span', 'ntp-row-ic');
      if (url) {
        var img = el('img', 'ntp-fav');
        img.src = ctx.favicon(url, 16);                        // .ntp-fav paints 16 CSS px
        img.alt = '';
        img.addEventListener('error', function () { img.remove(); ic.textContent = '▸'; });
        ic.appendChild(img);
      } else { ic.textContent = '▸'; }
      row.appendChild(ic);
      row.appendChild(el('span', 'ntp-row-t', r.title || url || ''));
      if (r.sub) row.appendChild(el('span', 'ntp-row-s', r.sub));
      listEl.appendChild(row);
    });
  }
  function limitOf(w) { return (w.cfg && w.cfg.count) || 8; }

  /* Ask the HUD extension for data it owns. One verb, one shape back. */
  function hudData(kind, limit, opts, cb) {
    var payload = { type: 'zbNtpData', kind: kind, limit: limit };
    if (opts) payload.opts = opts;
    try {
      chrome.runtime.sendMessage(HUD_ID, payload, function (res) {
        if (chrome.runtime.lastError || !res || !res.ok) { cb(null, (res && res.err) || 'HUD unavailable'); return; }
        cb(res.rows || [], null);
      });
    } catch (e) {
      cb(null, 'HUD unavailable');
    }
  }
  function hudList(listEl, kind, w, ctx, empty) {
    status(listEl, 'loading…');
    hudData(kind, limitOf(w), w.cfg, function (rows, err) {
      if (err) { status(listEl, err); return; }
      fillRows(listEl, rows, ctx, empty);
    });
  }

  /* ------------------------------------------------------------------ clock */
  function renderClock(w, host, ctx) {
    var time = el('div', 'ntp-time', '--:--:--');
    var date = el('div', 'ntp-date', '----');
    host.appendChild(time);
    host.appendChild(date);
    every(1000, function () {
      var now = new Date();
      time.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      date.textContent = now
        .toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })
        .toUpperCase();
    });
  }

  /* ----------------------------------------------------------------- search */
  /* Keeps the #search / #q ids: palette.js binds ⌘K on the input in the capture
   * phase and newtab.js reclaims focus by id. */
  function renderSearch(w, host, ctx) {
    var form = el('form', 'omni');
    form.id = 'search';
    form.autocomplete = 'off';
    var input = el('input', 'omni-input');
    input.id = 'q';
    input.type = 'text';
    input.placeholder = 'search or enter url';
    var go = el('button', 'omni-go', 'GO');
    go.type = 'submit';
    form.appendChild(el('span', 'omni-prompt', '>_'));
    form.appendChild(input);
    form.appendChild(go);
    form.addEventListener('submit', function (e) { e.preventDefault(); ctx.navigate(input.value); });
    // ⌘K / Ctrl+K while the search bar is focused must open the command palette,
    // not beep. The document-level palette handler doesn't win when the input has
    // focus, so bind directly on the input in the CAPTURE phase and consume the key
    // (preventDefault kills the macOS unhandled-key beep; stopImmediatePropagation
    // stops the field seeing it).
    input.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key || '').toLowerCase() === 'k') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typeof window.__zbPaletteOpen === 'function') window.__zbPaletteOpen();
      }
    }, true);
    host.appendChild(form);
  }

  /* -------------------------------------------------------------- speeddial */
  /* Ports Vivaldi's Speed Dial: the group's dials laid out under the layout's
   * appearance settings — Maximum Columns, one of 5 thumbnail sizes, titles
   * always/when-needed/never, and the add button.
   *
   * WRAPPING FLEX, NOT A GRID. A grid's last row is left-aligned against its
   * tracks, so six dials plus the add button left a lone "+" hanging under the
   * first tile while the row above was centred — the layout read as broken. A
   * centred wrapping flex row centres EVERY row including a partial one, which is
   * also how Vivaldi's dials behave. "Maximum columns" stays a maximum: the row is
   * capped at N tiles, and zntp-core balances the rows against both that cap and the
   * width actually on screen so neither can strand a tile. */
  var DIAL_GAP = 14;
  /* Balance the row against BOTH the cap and the space actually on screen (a wide
   * cap in a narrow window wraps just as badly as a tight cap). The measurement is
   * this file's job; the arithmetic is zntp-core's. Re-run on resize via refit(). */
  function fitDials(grid, host, layout, tiles) {
    var size = N.dialSizePx(layout);
    var room = host.clientWidth || (grid.parentNode && grid.parentNode.clientWidth) || 0;
    var perRow = N.dialFit(room, size, DIAL_GAP, tiles, layout.dial.columns);
    grid.style.maxWidth = (perRow * (size + DIAL_GAP)) + 'px';
  }
  function renderSpeedDial(w, host, ctx) {
    var layout = ctx.layout, page = ctx.page;
    var dials = page.dials || [];
    var grid = el('div', 'ntp-dials');
    var size = N.dialSizePx(layout);
    grid.dataset.pageId = page.id;
    grid.dataset.tiles = String(dials.length + (layout.dial.showAdd ? 1 : 0));
    grid.dataset.size = String(size);
    grid.dataset.cap = String(layout.dial.columns);

    dials.forEach(function (d, i) {
      var a = el('a', 'ntp-dial');
      a.href = d.url;
      a.title = d.url;
      a.dataset.dialId = d.id;
      a.dataset.index = String(i);
      a.style.width = size + 'px';
      var thumb = el('span', 'ntp-dial-thumb');
      thumb.style.height = Math.round(size * 0.62) + 'px';
      if (d.thumb) {
        thumb.classList.add('has-img');
        var img = el('img', 'ntp-dial-img');
        img.src = d.thumb;
        img.alt = '';
        thumb.appendChild(img);
      } else {
        var fav = el('img', 'ntp-dial-fav');
        var favPx = N.dialFavPx(size);
        fav.style.width = favPx + 'px';
        fav.src = ctx.favicon(d.url, favPx);
        fav.alt = '';
        fav.addEventListener('error', function () {
          fav.remove();
          thumb.appendChild(el('span', 'ntp-dial-glyph', (d.label || '?').slice(0, 2).toUpperCase()));
        });
        thumb.appendChild(fav);
      }
      a.appendChild(thumb);
      if (N.showTitle(layout, d)) a.appendChild(el('span', 'ntp-dial-label', d.label));
      grid.appendChild(a);
    });

    if (layout.dial.showAdd) {
      var add = el('button', 'ntp-dial ntp-dial-add', '');
      add.type = 'button';
      add.title = 'Add a Speed Dial';
      add.style.width = size + 'px';
      var plus = el('span', 'ntp-dial-thumb');
      plus.style.height = Math.round(size * 0.62) + 'px';
      plus.appendChild(el('span', 'ntp-dial-glyph', '+'));
      add.appendChild(plus);
      // Reserve the title line the dials have. Flex equalises heights within a row,
      // but when the add button wraps onto a row of its own it has nothing to match
      // and would sit a title-height shorter than every tile above it.
      if (N.showTitle(layout, { thumb: '' })) add.appendChild(el('span', 'ntp-dial-label', ' '));
      add.addEventListener('click', function () {
        if (window.ZBEdit) window.ZBEdit.addDial(page.id);
      });
      grid.appendChild(add);
    }
    host.appendChild(grid);
    fitDials(grid, host, layout, parseInt(grid.dataset.tiles, 10));
  }

  /* Re-balance the dial rows after a window resize, without re-rendering the grid
   * (a full repaint would re-query top sites / history and flicker on every drag of
   * the window edge). Reads the numbers the render stamped on the container. */
  function refit() {
    var grid = document.querySelector('.ntp-dials');
    if (!grid) return;
    var size = parseInt(grid.dataset.size, 10) || 160;
    var cap = parseInt(grid.dataset.cap, 10) || 0;
    var tiles = parseInt(grid.dataset.tiles, 10) || 1;
    var host = grid.parentNode;
    var perRow = N.dialFit(host ? host.clientWidth : 0, size, DIAL_GAP, tiles, cap);
    grid.style.maxWidth = (perRow * (size + DIAL_GAP)) + 'px';
  }

  /* ------------------------------------------------------- own-permission API */
  function renderTopSites(w, host, ctx) {
    header(host, N.WIDGET_BY_TYPE.topsites);
    var list = listHost(host);
    status(list, 'loading…');
    try {
      chrome.topSites.get(function (sites) {
        void chrome.runtime.lastError;
        fillRows(list, (sites || []).slice(0, limitOf(w)).map(function (s) {
          return { title: s.title || s.url, url: s.url };
        }), ctx, 'No top sites yet.');
      });
    } catch (e) { status(list, 'top sites unavailable'); }
  }

  function renderBookmarks(w, host, ctx) {
    var folder = (w.cfg && w.cfg.folderName) || 'Bookmarks bar';
    header(host, N.WIDGET_BY_TYPE.bookmarks, folder);
    var list = listHost(host);
    status(list, 'loading…');
    var id = (w.cfg && w.cfg.folderId) || '1';                 // '1' is Chrome's bookmarks bar
    try {
      chrome.bookmarks.getChildren(id, function (kids) {
        if (chrome.runtime.lastError) { status(list, 'folder not found'); return; }
        fillRows(list, (kids || []).filter(function (k) { return !!k.url; }).slice(0, limitOf(w)).map(function (k) {
          return { title: k.title || k.url, url: k.url };
        }), ctx, 'This folder is empty.');
      });
    } catch (e) { status(list, 'bookmarks unavailable'); }
  }

  function renderHistory(w, host, ctx) {
    header(host, N.WIDGET_BY_TYPE.history);
    var list = listHost(host);
    status(list, 'loading…');
    try {
      chrome.history.search({ text: '', maxResults: limitOf(w) * 3, startTime: Date.now() - 1000 * 60 * 60 * 24 * 14 }, function (items) {
        void chrome.runtime.lastError;
        var rows = (items || [])
          .filter(function (h) { return h.url && h.url.indexOf('chrome') !== 0; })
          .slice(0, limitOf(w))
          .map(function (h) { return { title: h.title || h.url, url: h.url }; });
        fillRows(list, rows, ctx, 'No recent history.');
      });
    } catch (e) { status(list, 'history unavailable'); }
  }

  /* ------------------------------------------------------------- HUD-backed */
  function renderFeeds(w, host, ctx) {
    header(host, N.WIDGET_BY_TYPE.feeds, (w.cfg && w.cfg.feedUrl) ? hostOf(w.cfg.feedUrl) : 'all feeds');
    hudList(listHost(host), 'feeds', w, ctx, 'No feed items.');
  }
  function renderNotes(w, host, ctx) {
    header(host, N.WIDGET_BY_TYPE.notes);
    hudList(listHost(host), 'notes', w, ctx, 'No notes yet.');
  }
  function renderReadingList(w, host, ctx) {
    header(host, N.WIDGET_BY_TYPE.readinglist);
    hudList(listHost(host), 'readinglist', w, ctx, 'Reading list is empty.');
  }
  function renderSessions(w, host, ctx) {
    header(host, N.WIDGET_BY_TYPE.sessions);
    hudList(listHost(host), 'sessions', w, ctx, 'No saved sessions.');
  }
  function hostOf(u) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(u || ''));
    return m ? m[1].replace(/^www\./, '') : String(u || '');
  }

  /* ---------------------------------------------------------------- webpage */
  /* Vivaldi's Webpage Widget. The frame is sandboxed: a page dropped on the new
   * tab must not be able to reach this extension's origin, script it, or navigate
   * the top frame out from under it. Sites that refuse framing still load here —
   * the HUD extension's frame_bust DNR rule strips x-frame-options and CSP from
   * every sub_frame response browser-wide (rules/frame_bust.json). */
  function renderWebpage(w, host, ctx) {
    var url = (w.cfg && w.cfg.url) || '';
    var head = header(host, N.WIDGET_BY_TYPE.webpage, hostOf(url));
    if (!url) {
      host.appendChild(el('div', 'ntp-list-empty', 'Set a URL in the widget menu.'));
      return;
    }
    var openBtn = el('a', 'ntp-w-open', '↗');
    openBtn.href = url;
    openBtn.title = 'Open ' + url;
    head.appendChild(openBtn);
    var frame = document.createElement('iframe');
    frame.className = 'ntp-frame';
    frame.src = url;
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer';
    frame.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups';
    host.appendChild(frame);
  }

  var RENDER = {
    clock: renderClock,
    search: renderSearch,
    speeddial: renderSpeedDial,
    topsites: renderTopSites,
    bookmarks: renderBookmarks,
    history: renderHistory,
    feeds: renderFeeds,
    notes: renderNotes,
    readinglist: renderReadingList,
    sessions: renderSessions,
    webpage: renderWebpage
  };

  function render(w, host, ctx) {
    var fn = RENDER[w.type];
    if (fn) fn(w, host, ctx);
  }

  return { render: render, reset: reset, refit: refit, hudData: hudData, RENDER: RENDER };
})();

window.ZBWidgets = ZBWidgets;
