/* zbrowser HUD — global ⌘K command palette on EVERY page (like the Cmd+F bar).
 * Loads zgui-core's ZGui.palette as a content script; ⌘K opens it anywhere with
 * commands to jump to any internal/native page and switch color scheme. Themed
 * by the active scheme (chrome.storage 'zb_scheme'), same as zfind. */
(function () {
  'use strict';
  if (window.__zbPaletteLoaded) return;
  window.__zbPaletteLoaded = true;
  // wake the worker via the storage bus (reliable) so it fills zb_tabs.
  try { chrome.storage.local.set({ zb_cmd: { a: 'ping', n: 'load' + (window.__zbTick = (window.__zbTick || 0) + 1) } }); } catch (e) {}
  var HUD = window.ZBROWSER_HUD || {};
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
  function open(url) { cmd({ a: 'open', url: url }); }
  function extUrl(p) { return chrome.runtime.getURL('pages/' + p); }
  function setScheme(name) {
    try { chrome.runtime.sendMessage({ type: 'zbhud-scheme', scheme: name }); } catch (e) {}
    try { chrome.storage.local.set({ zb_scheme: name }); } catch (e) {}
  }

  var PAGES = [['◈', 'Extensions', 'extensions.html'], ['⚙', 'Settings', 'settings.html'],
    ['◷', 'History', 'history.html'], ['▼', 'Downloads', 'downloads.html'],
    ['★', 'Bookmarks', 'bookmarks.html'], ['⚉', 'System info', 'version.html']];
  var CHROME = [['+', 'New tab', 'chrome://newtab'], ['⚑', 'Flags', 'chrome://flags'],
    ['✧', 'Discards', 'chrome://discards'], ['⌗', 'DNS', 'chrome://net-internals/#dns'],
    ['▤', 'GPU', 'chrome://gpu'], ['⇅', 'Net internals', 'chrome://net-internals'],
    ['⚿', 'Password manager', 'chrome://password-manager']];

  function items() {
    var out = [];
    PAGES.forEach(function (p) { out.push({ icon: p[0], label: 'Go: ' + p[1], detail: p[2], run: function () { open(extUrl(p[2])); } }); });
    CHROME.forEach(function (p) { out.push({ icon: p[0], label: 'Open: ' + p[1], detail: p[2], run: function () { open(p[2]); } }); });
    ORDER.forEach(function (n) { var s = SCHEMES[n]; if (!s) return; out.push({ icon: '◐', label: 'Scheme: ' + (s.label || n), detail: 'theme the whole browser', run: function () { setScheme(n); } }); });
    return out;
  }

  function tabItems(tabs) {
    return (tabs || []).map(function (t) {
      return { icon: '▣', label: 'Tab: ' + (t.title || t.url || '(tab)'), detail: t.url,
        run: function () { cmd({ a: 'activate', tabId: t.id }); } };
    });
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
    try { ZGui.palette.clear(); ZGui.palette.register(items()); ZGui.palette.open(); } catch (ex) {}
    try {
      chrome.storage.local.get('zb_tabs', function (o) {
        void chrome.runtime.lastError;
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
