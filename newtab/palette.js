/* zwire new-tab command palette (⌘K / :). The new tab is a separate
 * extension's page, so hud-internal's global palette content script can't reach
 * it — this adds the same ZGui.palette here. Being an extension page (with the
 * tabs permission) it can use chrome.tabs directly, no worker round-trip. */
(function () {
  'use strict';
  var HUD = window.ZWIRE_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var ORDER = HUD.ORDER || Object.keys(SCHEMES);
  var VAR_KEYS = HUD.VAR_KEYS || [];
  var HOST = 'com.zwire.hud';
  if (!window.ZGui || !ZGui.palette || !ZGui.fzf) return;
  var styleEl;

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
    'mark.fzf-hl{background:transparent;color:var(--cyan);font-weight:700;}'
  ].join('');

  function ensureStyle() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    var s = SCHEMES[(document.documentElement.getAttribute('data-hud-scheme')) || 'cyberpunk'] || SCHEMES.cyberpunk || { vars: {} };
    var vars = ''; VAR_KEYS.forEach(function (k) { if (s.vars && s.vars[k]) vars += k + ':' + s.vars[k] + ';'; });
    styleEl.textContent = '.palette-overlay{' + vars + '}' + PALETTE_CSS;
    document.head.appendChild(styleEl);
  }

  function goCurrent(url) { chrome.tabs.create({ url: url }); }   // open in a NEW tab
  function setScheme(name) {
    try { chrome.runtime.sendNativeMessage(HOST, { scheme: name }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    if (window.__applyScheme) try { window.__applyScheme(name); } catch (e) {}
  }

  var PAGES = [['◈', 'Extensions', 'chrome://extensions'], ['⚙', 'Settings', 'chrome://settings'],
    ['◷', 'History', 'chrome://history'], ['▼', 'Downloads', 'chrome://downloads'],
    ['★', 'Bookmarks', 'chrome://bookmarks'], ['⚑', 'Flags', 'chrome://flags'],
    ['▤', 'GPU', 'chrome://gpu'], ['⌗', 'DNS', 'chrome://net-internals/#dns'],
    ['⚿', 'Passwords', 'chrome://password-manager'], ['⌨', 'Keyboard shortcuts', 'chrome://extensions/shortcuts'],
    ['◎', 'Inspect devices', 'chrome://inspect'], ['§', 'Policy', 'chrome://policy'],
    ['⊛', 'Components', 'chrome://components'], ['≡', 'All chrome:// pages', 'chrome://about'],
    ['⚡', 'CI runs', 'chrome-extension://omcgnnjfmbmpdlofklbpddkhnfibfhgg/pages/ci.html'],
    ['◈', 'Chrome Web Store', 'https://chromewebstore.google.com/'],
    ['⌂', 'zwire app store', 'https://menketechnologies.github.io/app-store/']];

  function items() {
    var out = [];
    PAGES.forEach(function (p) { out.push({ icon: p[0], label: 'Open: ' + p[1], detail: p[2], run: function () { goCurrent(p[2]); } }); });
    ORDER.forEach(function (n) { var s = SCHEMES[n]; if (!s) return; out.push({ icon: '◐', label: 'Scheme: ' + (s.label || n), detail: 'theme the browser', run: function () { setScheme(n); } }); });
    return out;
  }
  function frecentItems(cb) {
    if (!chrome.history) { cb([]); return; }
    try {
      var now = Date.now();
      chrome.history.search({ text: '', maxResults: 500, startTime: now - 1000 * 60 * 60 * 24 * 90 }, function (h) {
        void chrome.runtime.lastError;
        var scored = (h || []).map(function (x) {
          var ageDays = (now - (x.lastVisitTime || 0)) / (1000 * 60 * 60 * 24);
          return { title: x.title || x.url, url: x.url, score: ((x.visitCount || 1) + 2 * (x.typedCount || 0)) / (1 + ageDays * 0.3) };
        }).filter(function (x) { return x.url && x.url.indexOf('chrome') !== 0; });
        scored.sort(function (a, b) { return b.score - a.score; });
        cb(scored.slice(0, 30).map(function (x) {
          return { icon: '★', label: (x.title || x.url), detail: x.url, run: function () { goCurrent(x.url); } };
        }));
      });
    } catch (e) { cb([]); }
  }
  function tabItems(cb) {
    chrome.tabs.query({}, function (tabs) {
      cb((tabs || []).map(function (t) {
        return { icon: '▣', label: 'Tab: ' + (t.title || t.url || '(tab)'), detail: t.url,
          run: function () { chrome.tabs.update(t.id, { active: true }); if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true }); } };
      }));
    });
  }

  function openPalette() {
    ensureStyle();
    try { ZGui.palette.clear(); ZGui.palette.register(items()); ZGui.palette.open(); } catch (e) {}
    try { frecentItems(function (fi) { try { ZGui.palette.register(fi); var inpf = document.querySelector('.palette-input'); if (inpf) inpf.dispatchEvent(new Event('input')); } catch (e) {} }); } catch (e) {}
    try { tabItems(function (ti) { try { ZGui.palette.register(ti); var inp = document.querySelector('.palette-input'); if (inp) inp.dispatchEvent(new Event('input')); } catch (e) {} }); } catch (e) {}
  }
  window.__zbPaletteOpen = openPalette;

  // The new tab reserves ⌘K at the browser level, so no page keydown listener
  // can catch it here. The hud-internal background worker owns ⌘K as a
  // chrome.commands shortcut and, when this NTP is the active tab, sends us this
  // message (allowed via externally_connectable) to open the palette.
  try {
    chrome.runtime.onMessageExternal.addListener(function (msg) {
      if (msg && msg.type === 'zwireOpenPalette') { try { ZGui.palette.isOpen() ? ZGui.palette.close() : openPalette(); } catch (e) {} }
    });
  } catch (e) {}

  document.addEventListener('keydown', function (e) {
    var ae = document.activeElement || {};
    var inField = /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '') || ae.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.altKey && !e.shiftKey) {
      e.preventDefault(); ZGui.palette.isOpen() ? ZGui.palette.close() : openPalette();
    } else if (e.key === ':' && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); openPalette();
    }
  }, true);
})();
