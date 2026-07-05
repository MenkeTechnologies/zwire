/* zwire HUD — global ⌘K command palette on EVERY page (like the Cmd+F bar).
 * Loads zgui-core's ZGui.palette as a content script; ⌘K opens it anywhere with
 * commands to jump to any internal/native page and switch color scheme. Themed
 * by the active scheme (chrome.storage 'zb_scheme'), same as zfind. */
(function () {
  'use strict';
  if (window.__zbPaletteLoaded) return;
  window.__zbPaletteLoaded = true;
  // wake the worker via the storage bus (reliable) so it fills zb_tabs.
  try { chrome.storage.local.set({ zb_cmd: { a: 'ping', n: 'load' + (window.__zbTick = (window.__zbTick || 0) + 1) } }); } catch (e) {}
  var HUD = window.ZWIRE_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var ORDER = HUD.ORDER || Object.keys(SCHEMES);
  var VAR_KEYS = HUD.VAR_KEYS || [];
  if (!window.ZGui || !ZGui.palette || !ZGui.fzf) return;   // needs command-palette.js + fzf.js
  var styleEl, registered = false;

  // The .palette-* CSS (from zgui.css), inlined so it works on arbitrary pages.
  var PALETTE_CSS = [
    '.palette-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.6);display:flex;',
    ' justify-content:center;padding-top:12vh;font-family:"Share Tech Mono",Monaco,monospace;}',
    '.palette-box{width:min(580px,92vw);max-height:60vh;background:var(--bg-primary);border:1px solid var(--cyan);',
    ' box-shadow:0 0 60px var(--cyan-glow),0 20px 60px rgba(0,0,0,.5);border-radius:4px;display:flex;flex-direction:column;overflow:hidden;}',
    '.palette-input{width:100%;padding:14px 18px;background:var(--bg-card);border:none;border-bottom:1px solid var(--border);',
    ' color:var(--text);font-size:15px;font-family:inherit;outline:none;}',
    '.palette-input::placeholder{color:var(--text-muted,var(--text-dim));}',
    '.palette-results{overflow-y:auto;max-height:calc(60vh - 50px);padding:4px 0;}',
    '.palette-row{display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;}',
    '.palette-row:hover,.palette-selected{background:var(--cyan-dim);}',
    '.palette-icon{font-size:16px;width:22px;text-align:center;flex-shrink:0;}',
    '.palette-name{flex:1;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.palette-detail{font-size:11px;color:var(--text-muted,var(--text-dim));max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}',
    '.palette-shortcut{flex-shrink:0;font-size:10px;color:var(--text-muted,var(--text-dim));}',
    'mark.fzf-hl{background:transparent;color:var(--cyan);font-weight:700;}'
  ].join('');

  function schemeVars(cb) {
    try { chrome.storage.local.get('zb_scheme', function (o) { var s = SCHEMES[(o && o.zb_scheme) || 'cyberpunk'] || SCHEMES.cyberpunk || { vars: {} }; cb(s.vars || {}); }); }
    catch (e) { cb((SCHEMES.cyberpunk || { vars: {} }).vars || {}); }
  }
  function injectStyle(v) {
    var vars = '';
    for (var i = 0; i < VAR_KEYS.length; i++) if (v[VAR_KEYS[i]]) vars += VAR_KEYS[i] + ':' + v[VAR_KEYS[i]] + ';';
    if (!styleEl) { styleEl = document.createElement('style'); (document.head || document.documentElement).appendChild(styleEl); }
    styleEl.textContent = '.palette-overlay{' + vars + '}' + PALETTE_CSS;
  }

  // content scripts can't use chrome.tabs. sendMessage to a sleeping MV3 worker
  // is unreliable, so drive navigation through the storage command bus
  // (storage.onChanged reliably wakes the worker). A ticking counter guarantees
  // the value changes so onChanged always fires.
  var cmdN = 0;
  function cmd(obj) { try { obj.n = ++cmdN + '.' + (window.__zbTick = (window.__zbTick || 0) + 1); chrome.storage.local.set({ zb_cmd: obj }); } catch (e) {} }
  function open(url) { cmd({ a: 'openTab', url: url }); }   // palette opens pages in a NEW tab
  function extUrl(p) { return chrome.runtime.getURL('pages/' + p); }
  function setScheme(name) {
    try { chrome.runtime.sendMessage({ type: 'zbhud-scheme', scheme: name }); } catch (e) {}
    try { chrome.storage.local.set({ zb_scheme: name }); } catch (e) {}
  }

  var PAGES = [['◈', 'Extensions', 'extensions.html'], ['⚙', 'Settings', 'settings.html'],
    ['◷', 'History', 'history.html'], ['★', 'Bookmarks', 'bookmarks.html'],
    ['⚡', 'CI runs', 'ci.html'], ['⚉', 'System info', 'version.html']];
  var CHROME = [['+', 'New tab', 'chrome://newtab'], ['▼', 'Downloads', 'chrome://downloads'],
    ['⚑', 'Flags', 'chrome://flags'], ['✧', 'Discards', 'chrome://discards'],
    ['⌗', 'DNS', 'chrome://net-internals/#dns'], ['▤', 'GPU', 'chrome://gpu'],
    ['⇅', 'Net internals', 'chrome://net-internals'], ['⚿', 'Passwords', 'chrome://password-manager'],
    ['⌨', 'Keyboard shortcuts', 'chrome://extensions/shortcuts'], ['◎', 'Inspect devices', 'chrome://inspect'],
    ['⇩', 'Net export', 'chrome://net-export'], ['§', 'Policy', 'chrome://policy'],
    ['⊛', 'Components', 'chrome://components'], ['≡', 'All chrome:// pages', 'chrome://about'],
    ['✎', 'Site settings', 'chrome://settings/content']];
  var WEB = [['◈', 'Chrome Web Store', 'https://chromewebstore.google.com/'],
    ['⌂', 'zwire app store', 'https://menketechnologies.github.io/app-store/']];

  function items() {
    var out = [];
    cmdItems().forEach(function (c) { out.push(c); });
    PAGES.forEach(function (p) { out.push({ icon: p[0], label: 'Go: ' + p[1], detail: p[2], run: function () { open(extUrl(p[2])); } }); });
    CHROME.forEach(function (p) { out.push({ icon: p[0], label: 'Open: ' + p[1], detail: p[2], run: function () { open(p[2]); } }); });
    WEB.forEach(function (p) { out.push({ icon: p[0], label: 'Open: ' + p[1], detail: p[2], run: function () { open(p[2]); } }); });
    ORDER.forEach(function (n) { var s = SCHEMES[n]; if (!s) return; out.push({ icon: '◐', label: 'Scheme: ' + (s.label || n), detail: 'theme the whole browser', run: function () { setScheme(n); } }); });
    return out;
  }
  function frecentItems(frec) {
    return (frec || []).map(function (f) { return { icon: '★', label: (f.title || f.url), detail: f.url, run: function () { open(f.url); } }; });
  }

  /* ---- command runner (pulled from zgo): browser verbs + web-search --------- */
  function clip(text) { try { navigator.clipboard.writeText(text); } catch (e) {} }
  function cycleScheme() {
    try { chrome.storage.local.get('zb_scheme', function (o) {
      var cur = (o && o.zb_scheme) || 'cyberpunk';
      var i = ORDER.indexOf(cur); var next = ORDER[(i + 1 + ORDER.length) % ORDER.length] || ORDER[0];
      setScheme(next);
    }); } catch (e) {}
  }
  function cmdItems() {
    return [
      { icon: '＋', label: 'New tab', run: function () { cmd({ a: 'newTab' }); } },
      { icon: '⊞', label: 'New window', run: function () { cmd({ a: 'newWindow' }); } },
      { icon: '⧉', label: 'Duplicate tab', run: function () { cmd({ a: 'duplicateTab' }); } },
      { icon: '↺', label: 'Reopen closed tab', run: function () { cmd({ a: 'reopenTab' }); } },
      { icon: '✕', label: 'Close tab', run: function () { cmd({ a: 'closeTab' }); } },
      { icon: '⊗', label: 'Close other tabs', run: function () { cmd({ a: 'closeOthers' }); } },
      { icon: '→', label: 'Next tab', run: function () { cmd({ a: 'nextTab' }); } },
      { icon: '←', label: 'Previous tab', run: function () { cmd({ a: 'prevTab' }); } },
      { icon: '📌', label: 'Pin / unpin tab', run: function () { cmd({ a: 'pinTab' }); } },
      { icon: '🔇', label: 'Mute / unmute tab', run: function () { cmd({ a: 'muteTab' }); } },
      { icon: '⟳', label: 'Reload page', run: function () { try { location.reload(); } catch (e) {} } },
      { icon: '⧉', label: 'Copy URL', detail: 'this page', run: function () { clip(location.href); } },
      { icon: '⤓', label: 'Copy as Markdown', detail: 'this page', run: function () { clip('[' + document.title + '](' + location.href + ')'); } },
      { icon: '◐', label: 'Cycle color scheme', run: cycleScheme },
      { icon: '▭', label: 'Toggle HUD statusbar', run: function () { try { chrome.storage.local.get('zb_status', function (o) { var on = !(o && o.zb_status === false); chrome.storage.local.set({ zb_status: !on }); }); } catch (e) {} } }
    ];
  }

  // Keyword search (from zgo BUILTINS) + package registries. Each entry is
  // [aliases, label, urlTemplate]. Typing a keyword (even alone) surfaces that
  // destination FIRST: `crate`->crates.io, `crate serde`->crates.io/serde.
  var SEARCH = [
    [['g', 'google'], 'Google', 'https://www.google.com/search?q={q}'],
    [['ddg'], 'DuckDuckGo', 'https://duckduckgo.com/?q={q}'],
    [['gh', 'github'], 'GitHub', 'https://github.com/search?q={q}'],
    [['yt', 'youtube'], 'YouTube', 'https://www.youtube.com/results?search_query={q}'],
    [['mdn'], 'MDN', 'https://developer.mozilla.org/en-US/search?q={q}'],
    [['so', 'stackoverflow'], 'Stack Overflow', 'https://stackoverflow.com/search?q={q}'],
    [['wiki'], 'Wikipedia', 'https://en.wikipedia.org/w/index.php?search={q}'],
    [['maps'], 'Google Maps', 'https://www.google.com/maps/search/{q}'],
    // package registries
    [['crate', 'crates', 'cargo', 'rust'], 'crates.io', 'https://crates.io/search?q={q}'],
    [['npm', 'node'], 'npm', 'https://www.npmjs.com/search?q={q}'],
    [['pip', 'pypi', 'python'], 'PyPI', 'https://pypi.org/search/?q={q}'],
    [['gem', 'gems', 'ruby'], 'RubyGems', 'https://rubygems.org/search?query={q}'],
    [['go', 'golang'], 'pkg.go.dev', 'https://pkg.go.dev/search?q={q}'],
    [['hex', 'elixir'], 'Hex.pm', 'https://hex.pm/packages?search={q}'],
    [['brew', 'formula'], 'Homebrew', 'https://formulae.brew.sh/formula/{q}'],
    [['docker', 'hub'], 'Docker Hub', 'https://hub.docker.com/search?q={q}']
  ];
  function searchProvider(q) {
    if (!q) return [];
    var out = [];
    var sp = q.indexOf(' ');
    var kw = (sp > 0 ? q.slice(0, sp) : q).toLowerCase();
    var rest = sp > 0 ? q.slice(sp + 1).trim() : '';
    var hit = SEARCH.filter(function (s) { return s[0].indexOf(kw) >= 0; })[0];
    if (hit) {
      var url;
      if (rest) url = hit[2].replace('{q}', encodeURIComponent(rest));
      else { try { url = new URL(hit[2]).origin + '/'; } catch (e) { url = hit[2].replace('{q}', ''); } }
      out.push({ icon: '⌕', label: hit[1] + (rest ? ': ' + rest : ''), detail: rest ? 'search' : 'open', run: function () { open(url); } });
      return out;   // keyword is a strong signal — show just that destination, first
    }
    // url / domain? offer to open it directly.
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) && q.indexOf(' ') < 0) {
      out.push({ icon: '↗', label: 'Open ' + q, detail: 'go to site', run: function () { open(/^https?:\/\//.test(q) ? q : 'https://' + q); } });
    }
    // generic web fallback (Alfred-style) — Google + DDG for the raw query.
    out.push({ icon: '⌕', label: 'Google: ' + q, detail: 'web search', run: function () { open('https://www.google.com/search?q=' + encodeURIComponent(q)); } });
    out.push({ icon: '⌕', label: 'DuckDuckGo: ' + q, detail: 'web search', run: function () { open('https://duckduckgo.com/?q=' + encodeURIComponent(q)); } });
    return out;
  }

  function tabItems(tabs) {
    return (tabs || []).map(function (t) {
      return { icon: '▣', label: 'Tab: ' + (t.title || t.url || '(tab)'), detail: t.url,
        run: function () { cmd({ a: 'activate', tabId: t.id }); } };
    });
  }
  function extItems(exts) {
    var out = [];
    (exts || []).forEach(function (e) {
      if (e.optionsUrl) out.push({ icon: '⚙', label: 'Tweak: ' + e.name, detail: 'options', run: function () { open(e.optionsUrl); } });
      out.push({ icon: '⬡', label: 'Manage: ' + e.name, detail: e.id, run: function () { open('chrome://extensions/?id=' + e.id); } });
    });
    return out;
  }
  function ensureStyle() {
    // sync-inject the overlay CSS (position:fixed) before the palette opens +
    // its input is focused, so focusing never scrolls the page.
    if (!styleEl) { styleEl = document.createElement('style'); (document.head || document.documentElement).appendChild(styleEl); styleEl.textContent = PALETTE_CSS; }
  }
  function openPalette() {
    ensureStyle();
    schemeVars(injectStyle);
    // Open SYNCHRONOUSLY with the static commands so it never depends on an
    // async read — nav always works. Tabs (storage bus) are appended after.
    try { ZGui.palette.clear(); ZGui.palette.register(items()); if (ZGui.palette.registerProvider) ZGui.palette.registerProvider(searchProvider); ZGui.palette.open(); } catch (ex) {}
    try {
      chrome.storage.local.get(['zb_tabs', 'zb_exts', 'zb_frecent'], function (o) {
        void chrome.runtime.lastError;
        try { ZGui.palette.register(frecentItems(o && o.zb_frecent)); } catch (e) {}
        try { ZGui.palette.register(extItems(o && o.zb_exts)); } catch (e) {}
        try { ZGui.palette.register(tabItems(o && o.zb_tabs)); } catch (e) {}
        try { var inp = document.querySelector('.palette-input'); if (inp) inp.dispatchEvent(new Event('input')); } catch (e) {}
      });
    } catch (e) {}
  }
  window.__zbPaletteOpen = openPalette;   // vim mode ('o'/':') calls this

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K') && !e.altKey && !e.shiftKey) {
      e.preventDefault(); e.stopImmediatePropagation();   // win over site ⌘K (github, etc.)
      openPalette();
    }
  }, true);
})();
