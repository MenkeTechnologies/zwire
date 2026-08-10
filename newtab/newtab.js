"use strict";

/* zwire new tab — the layout renderer.
 *
 * The page is no longer a fixed clock + tile strip: it renders whatever the ACTIVE
 * layout says (zntp-core.js owns the model, this file owns the DOM, widgets.js owns
 * each widget's body, layout-edit.js owns the inline editor). A layout is a nav rail
 * of Speed Dial groups, a background, dial appearance, and a widget grid per group.
 *
 * Storage: chrome.storage.local 'zb_ntp' is the truth — it lives in the profile, so
 * every new tab and the HUD layout manager see the same config and a change repaints
 * open tabs through storage.onChanged. localStorage mirrors it purely as a FIRST-PAINT
 * cache: chrome.storage is async and a new tab that waits for it flashes an empty
 * page, so we paint the mirror synchronously and re-render when the real read lands.
 *
 * Pre-layout installs kept tiles in localStorage 'zb.tiles'; those are migrated once,
 * by copy — the legacy key is never written or cleared, so a rollback is lossless. */

var ZBNTP = (function () {
  var N = window.ZWIRE_NTP;
  var KEY = 'zb_ntp';
  var CACHE = 'zb.ntp.cache';
  var DEFAULT_ENGINE = "https://duckduckgo.com/?q=%s";     // override via localStorage "zb.engine"

  var cfg = null;
  var painted = false;
  var listeners = [];

  /* ------------------------------------------------------------ persistence */
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function cacheWrite(c) {
    try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch (e) { /* quota — the real store still has it */ }
  }

  function load(cb) {
    var cached = readJSON(CACHE, null);
    if (cached) { cfg = N.normalize(cached); cb(cfg, true); }
    try {
      chrome.storage.local.get(KEY, function (o) {
        void chrome.runtime.lastError;
        var stored = o && o[KEY];
        if (stored) { cfg = N.normalize(stored); cacheWrite(cfg); cb(cfg, false); return; }
        // First run on this profile: adopt the legacy tiles, then persist so every
        // later tab (and the HUD manager) reads the same starting layout.
        cfg = N.migrate(readJSON('zb.tiles', null));
        persist(cfg);
        cb(cfg, false);
      });
    } catch (e) {
      if (!cfg) { cfg = N.defaultConfig(); cb(cfg, false); }
    }
  }

  function persist(next) {
    cacheWrite(next);
    try { chrome.storage.local.set(makeSet(next)); } catch (e) { /* no-op */ }
  }
  function makeSet(next) { var o = {}; o[KEY] = next; return o; }

  /* Apply an edit: every zntp-core op returns a NEW config, so commit is one call. */
  function commit(next) {
    if (!next) return cfg;
    cfg = next;
    persist(cfg);
    render();
    return cfg;
  }
  function config() { return cfg; }
  function onRender(fn) { if (typeof fn === 'function') listeners.push(fn); }

  /* ------------------------------------------------------------- navigation */
  // Heuristic: does the input look like a URL rather than a search query?
  function looksLikeUrl(s) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;       // has a scheme
    if (/\s/.test(s)) return false;                             // has whitespace -> search
    return /^[^\s.]+\.[^\s.]{2,}(\/.*)?$/.test(s) || s === "localhost";
  }
  function navigate(input) {
    var s = String(input == null ? '' : input).trim();
    if (!s) return;
    var dest;
    if (looksLikeUrl(s)) {
      dest = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s;
    } else {
      var engine = readJSON("zb.engine", DEFAULT_ENGINE);
      dest = String(engine).replace("%s", encodeURIComponent(s));
    }
    open(dest);
  }
  function open(url) {
    var safe = N.safeUrl(url);
    if (safe) window.location.href = safe;
  }
  /* Chrome's own favicon store, via the `favicon` permission — no network fetch, so
   * dials paint offline and a dial URL never phones home to render its own icon. */
  function faviconUrl(url, size) {
    try {
      return chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=' + (size || 32));
    } catch (e) {
      return '';
    }
  }

  /* ------------------------------------------------------------------- DOM */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function applyBackground(layout) {
    var app = document.getElementById('app');
    if (!app) return;
    var bg = layout.bg || {};
    app.classList.toggle('ntp-has-bg', bg.kind !== 'none' && !!bg.value);
    if (bg.kind === 'image' && bg.value) {
      app.style.backgroundImage = 'url("' + bg.value + '")';
      app.style.backgroundColor = '';
    } else if (bg.kind === 'gradient' && bg.value) {
      app.style.backgroundImage = bg.value;
      app.style.backgroundColor = '';
    } else if (bg.kind === 'color' && bg.value) {
      app.style.backgroundImage = '';
      app.style.backgroundColor = bg.value;
    } else {
      app.style.backgroundImage = '';
      app.style.backgroundColor = '';
    }
  }

  /* The nav rail = Vivaldi's Start Page navigation: one button per Speed Dial group,
   * placed on any edge, and hideable. `show:'start'` vs `'always'` is Vivaldi's
   * "Show on Start Pages" vs "Show on Internal Pages too" — this page IS a start
   * page, so both show here and only 'hidden' removes it. */
  function renderNav(layout) {
    var host = document.getElementById('ntp-nav');
    if (!host) return;
    host.textContent = '';
    var app = document.getElementById('app');
    N.NAV_POS.forEach(function (p) { app.classList.toggle('nav-' + p, layout.nav.pos === p); });
    app.classList.toggle('nav-hidden', layout.nav.show === 'hidden');
    if (layout.nav.show === 'hidden') return;

    layout.pages.forEach(function (p, i) {
      var b = el('button', 'ntp-navbtn' + (p.id === layout.activePageId ? ' is-active' : ''), p.name);
      b.type = 'button';
      b.title = p.name + '  (' + (i + 1) + ')';
      b.dataset.pageId = p.id;
      b.addEventListener('click', function () { commit(N.setActivePage(cfg, layout.id, p.id)); });
      host.appendChild(b);
    });
  }

  function renderGrid(layout, page) {
    var host = document.getElementById('ntp-grid');
    if (!host) return;
    window.ZBWidgets.reset();                                  // drop the previous paint's timers
    host.textContent = '';
    if (!page.widgets.length) {
      host.appendChild(el('div', 'ntp-empty', 'This group is empty — open the editor to add widgets.'));
      return;
    }
    page.widgets.forEach(function (w) {
      var spec = N.WIDGET_BY_TYPE[w.type];
      var box = el('section', 'ntp-w ntp-w-' + w.type + ' span-' + w.span + (w.size === 'tall' ? ' is-tall' : ''));
      box.dataset.widgetId = w.id;
      if (spec && spec.label) box.setAttribute('aria-label', spec.label);
      var body = el('div', 'ntp-w-body');
      box.appendChild(body);
      host.appendChild(box);
      try {
        window.ZBWidgets.render(w, body, ctx(layout, page, box));
      } catch (e) {
        body.appendChild(el('div', 'ntp-w-err', (spec ? spec.label : w.type) + ' failed to render'));
      }
    });
  }

  function ctx(layout, page, box) {
    return {
      layout: layout, page: page, box: box,
      el: el, navigate: navigate, open: open, favicon: faviconUrl,
      config: config, commit: commit
    };
  }

  function render() {
    if (!cfg) return;
    var layout = N.activeLayout(cfg);
    var page = N.activePage(layout);
    if (!layout || !page) return;
    applyBackground(layout);
    renderNav(layout);
    renderGrid(layout, page);
    painted = true;
    listeners.forEach(function (fn) { try { fn(layout, page); } catch (e) { /* a listener must not break paint */ } });
  }

  /* -------------------------------------------------------------- keyboard */
  /* 1..9 jump to a Speed Dial group, like Vivaldi's start-page navigation. Ignored
   * while typing so a digit in the omnibox stays a digit. */
  function typing(t) {
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    var n = parseInt(e.key, 10);
    if (!(n >= 1 && n <= 9) || !cfg) return;
    var layout = N.activeLayout(cfg);
    var page = layout.pages[n - 1];
    if (!page) return;
    e.preventDefault();
    commit(N.setActivePage(cfg, layout.id, page.id));
  }

  /* Chrome parks the cursor in the omnibox on the new tab and defeats the
   * <input autofocus>, so the page never receives keystrokes — the ⌘K palette
   * and typing both die until you click in. A JS .focus() reclaims focus where
   * the attribute can't (verified: it moves activeElement to #q), which routes
   * keys to the page again. Retried across the first frames + when the tab is
   * re-shown, with preventScroll so it never jumps the layout. */
  function reclaimFocus() {
    var q = document.getElementById("q");
    if (!q) return;                                            // layout has no search widget
    try { q.focus({ preventScroll: true }); } catch (e) { try { q.focus(); } catch (e2) {} }
  }

  /* ------------------------------------------------------------------ boot */
  function start() {
    load(function () { render(); reclaimFocus(); });
    // Another tab (or the HUD layout manager) edited the config — repaint in place.
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[KEY]) return;
        var next = changes[KEY].newValue;
        if (!next || JSON.stringify(next) === JSON.stringify(cfg)) return;
        cfg = N.normalize(next);
        cacheWrite(cfg);
        render();
      });
    } catch (e) { /* no-op */ }
    document.addEventListener('keydown', onKey);
    // How many dials fit per row depends on the window, so a resize re-balances them.
    // Only the dial rows are recomputed — a full re-render would re-query top sites
    // and history on every pixel of a window drag.
    var refitTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(refitTimer);
      refitTimer = setTimeout(function () { window.ZBWidgets.refit(); }, 120);
    });
    requestAnimationFrame(reclaimFocus);
    setTimeout(reclaimFocus, 60);
    setTimeout(reclaimFocus, 200);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) reclaimFocus(); });
  }

  document.addEventListener("DOMContentLoaded", start);

  return {
    config: config, commit: commit, render: render, onRender: onRender,
    navigate: navigate, open: open, favicon: faviconUrl, el: el,
    looksLikeUrl: looksLikeUrl, reclaimFocus: reclaimFocus,
    painted: function () { return painted; }
  };
})();

window.ZBNTP = ZBNTP;
