/* zbrowser HUD — shared zgui-core boot for every internal page.
 * Mounts ZGui.appShell (brand · filter · ⌘K palette · settings w/ colorscheme +
 * CRT/neon · shortcuts), wires the cross-page nav into the shell, and bridges
 * the zgui colorscheme picker to the native host so a pick repaints the whole
 * browser (~/.zbrowser/hud-scheme) + mirrors to storage for the content-script
 * theme. All UI comes from ZGui.* per the zgui-core-only rule. */
(function () {
  'use strict';
  var HOST = 'com.zbrowser.hud';

  // Our own HUD pages (extension URLs) + the native chrome pages we can't rewrite.
  // DOWNLOADS points at the native page — zpwrchrome owns the download manager
  // (its takeover cancels + reissues Chrome downloads), so a HUD downloads page
  // built on chrome.downloads.search would only show the cancelled stubs.
  var PAGES = [['EXTENSIONS', 'extensions.html'], ['SETTINGS', 'settings.html'],
    ['HISTORY', 'history.html'], ['DOWNLOADS', 'chrome://downloads'], ['BOOKMARKS', 'bookmarks.html'],
    ['SYSTEM', 'version.html'], ['NEW TAB', 'chrome://newtab']];
  var NATIVE_PAGES = [['FLAGS', 'chrome://flags'], ['DISCARDS', 'chrome://discards'],
    ['DNS', 'chrome://net-internals/#dns'], ['GPU', 'chrome://gpu'], ['NET', 'chrome://net-internals']];

  function go(target) {
    if (target.indexOf('chrome://') === 0) { try { chrome.tabs.create({ url: target }); } catch (e) {} }
    else location.href = chrome.runtime.getURL('pages/' + target);
  }
  function navButton(label, target, current) {
    var own = target.indexOf('chrome://') !== 0;
    var b = ZGui.button({ label: label, variant: (own && target === current) ? 'primary' : 'mini',
      onClick: function () { go(target); } });
    if (!own) b.classList.add('zg-nav-native');
    return b;
  }
  function navActions(current) {
    return PAGES.map(function (p) { return navButton(p[0], p[1], current); });
  }
  function paletteNav() {
    return PAGES.concat(NATIVE_PAGES).map(function (p) {
      return { label: 'Go: ' + p[0], hint: p[1], run: function () { go(p[1]); } };
    });
  }

  /* ---- colorscheme <-> native host bridge -------------------------------- */
  var applyingExternal = false, currentScheme = null;
  function bridge() {
    if (!window.ZGui || !ZGui.colorscheme) return;
    // any pick in the shell settings (or a custom scheme) -> native + storage.
    ZGui.colorscheme.onApply(function (name) {
      currentScheme = name;
      if (applyingExternal) return;                 // echo from load/poll, don't re-write
      try { chrome.runtime.sendNativeMessage(HOST, { scheme: name }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      try { chrome.storage.local.set({ zb_scheme: name }); } catch (e) {}
    });
    function pull() {
      try {
        chrome.runtime.sendNativeMessage(HOST, { cmd: 'get' }, function (r) {
          void chrome.runtime.lastError;
          var s = (r && r.scheme) || 'cyberpunk';
          if (s !== currentScheme) {
            applyingExternal = true;
            try { ZGui.colorscheme.apply(s); } finally { applyingExternal = false; }
            // keep any rendered scheme picker's highlight in sync with the
            // native (file) scheme, not just zgui's localStorage.
            document.querySelectorAll('.scheme-btn,.zs-scheme-btn').forEach(function (b) {
              if (b.dataset && b.dataset.scheme) b.classList.toggle('active', b.dataset.scheme === s);
            });
          }
        });
      } catch (e) {}
    }
    pull();
    setInterval(pull, 1500);
  }

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }

  function injectCss() {
    if (document.getElementById('zb-shell-css')) return;
    var s = document.createElement('style'); s.id = 'zb-shell-css';
    s.textContent = [
      // natural page scroll (override any appShell/all.css overflow lock)
      'html,body{height:auto!important;overflow-y:auto!important;margin:0;background:var(--bg-primary);color:var(--text);}',
      '.zb-app{min-height:100vh;position:relative;}',
      // sticky old-HUD header
      '.zb-header{position:sticky;top:0;z-index:20;background:var(--bg-primary);border-bottom:1px solid var(--border);',
      ' padding:14px 22px 0;box-shadow:0 6px 18px rgba(0,0,0,.35);}',
      '.zb-header-inner{display:flex;align-items:center;gap:18px;flex-wrap:wrap;}',
      '.zb-logo{display:flex;align-items:center;gap:12px;}',
      '.zb-logo .zb{background:var(--cyan);color:var(--bg-primary);font-weight:bold;padding:3px 7px;border-radius:2px;letter-spacing:1px;}',
      '.zb-logo .ti{color:var(--accent);letter-spacing:3px;font-size:18px;text-shadow:0 0 10px var(--accent-glow);}',
      '.zb-filter{margin-left:auto;min-width:min(320px,45vw);}',
      '.zb-filter .zg-searchbox{width:100%;}',
      '.zb-navrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:12px 0 10px;}',
      '.zb-navrow .zs-btn-mini.zg-nav-native{opacity:.6;}',
      '.zb-navrow .zs-btn-mini.zg-nav-native:hover{opacity:1;}',
      '.zb-navsep{width:1px;height:18px;background:var(--border);margin:0 4px;}',
      '.zb-main{padding:16px 22px 48px;}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ---- shell mount: the old strykelang HUD page (no appShell top bar) ----- */
  function mount(opts) {
    opts = opts || {};
    injectCss();
    var root = document.getElementById('app') || document.body;
    var app = el('div', 'zb-app');
    // header: ZB // TITLE  +  ZGui.searchBox filter
    var header = el('header', 'zb-header');
    var inner = el('div', 'zb-header-inner');
    inner.appendChild(el('div', 'zb-logo', '<span class="zb">ZB</span> <span class="ti">// ' + (opts.title || 'ZBROWSER') + '</span>'));
    var filterHost = el('div', 'zb-filter'); inner.appendChild(filterHost);
    header.appendChild(inner);
    // cross-page nav row
    var navrow = el('nav', 'zb-navrow');
    navActions(opts.current).forEach(function (b) { navrow.appendChild(b); });
    navrow.appendChild(el('span', 'zb-navsep'));
    NATIVE_PAGES.forEach(function (p) { navrow.appendChild(navButton(p[0], p[1], opts.current)); });
    header.appendChild(navrow);
    app.appendChild(header);
    // scrollable main content the page owns
    var main = el('div', 'zb-main'); app.appendChild(main);
    root.appendChild(app);
    // ZGui.searchBox filter (real zgui widget)
    if (opts.onFilter && ZGui.searchBox) {
      ZGui.searchBox(filterHost, { placeholder: opts.filterPlaceholder || '>_ filter…', regex: false,
        onInput: function (v) { opts.onFilter(v); } });
    }
    // CRT scanlines via ZGui.crt (Audio-Haxor overlay)
    try { if (ZGui.crt) ZGui.crt({ on: true }); } catch (e) {}
    // ⌘K / : command palette (ZGui.palette): cross-page nav + this page's
    // commands + every open tab (so it doubles as a tab switcher).
    if (ZGui.palette) {
      var pageItems = paletteNav().concat(opts.palette || []);
      var openPal = function () {
        // open synchronously with nav commands (nav always works); append tabs after.
        try { ZGui.palette.clear(); ZGui.palette.register(pageItems); ZGui.palette.open(); } catch (e) {}
        try {
          chrome.tabs.query({}, function (tabs) {
            void chrome.runtime.lastError;
            try {
              ZGui.palette.register((tabs || []).map(function (t) {
                return { icon: '▣', label: 'Tab: ' + (t.title || t.url || '(tab)'), detail: t.url,
                  run: function () { chrome.tabs.update(t.id, { active: true }); if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true }); } };
              }));
            } catch (e) {}
            try { var inp = document.querySelector('.palette-input'); if (inp) inp.dispatchEvent(new Event('input')); } catch (e) {}
          });
        } catch (e) {}
      };
      window.__zbPaletteOpen = openPal;
      document.addEventListener('keydown', function (e) {
        var ae = document.activeElement || {};
        var inField = /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '') || ae.isContentEditable;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.altKey && !e.shiftKey) {
          e.preventDefault(); ZGui.palette.isOpen() ? ZGui.palette.close() : openPal();
        } else if (e.key === ':' && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault(); openPal();
        }
      }, true);
    }
    bridge();
    return { body: main, el: app, filterHost: filterHost };
  }

  window.ZBHUD = { PAGES: PAGES, NATIVE_PAGES: NATIVE_PAGES, mount: mount, go: go,
    navButton: navButton, HOST: HOST };
})();
