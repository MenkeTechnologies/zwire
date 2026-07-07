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

  // Light-mode neutral overrides — the palette scopes the scheme vars to
  // .palette-overlay, so merge these in when light mode is on (data-theme set by
  // scheme-sync.js from the native ui) or the scoped dark neutrals stay dark.
  var LIGHT_VARS = { '--bg-primary': '#f0f2f5', '--bg-secondary': '#e4e7ec', '--bg-card': '#ffffff', '--bg-hover': '#f7f8fa', '--text': '#1e293b', '--text-dim': '#475569', '--text-muted': '#94a3b8', '--border': '#cbd5e1', '--border-glow': '#a5b4c8' };
  function ensureStyle() {
    if (!styleEl) { styleEl = document.createElement('style'); document.head.appendChild(styleEl); }
    var s = SCHEMES[(document.documentElement.getAttribute('data-hud-scheme')) || 'cyberpunk'] || SCHEMES.cyberpunk || { vars: {} };
    var merged = {}, sv = s.vars || {}, k;
    for (k in sv) merged[k] = sv[k];
    if (document.documentElement.getAttribute('data-theme') === 'light') for (k in LIGHT_VARS) merged[k] = LIGHT_VARS[k];
    var vars = ''; VAR_KEYS.forEach(function (kk) { if (merged[kk]) vars += kk + ':' + merged[kk] + ';'; });
    styleEl.textContent = '.palette-overlay{' + vars + '}' + PALETTE_CSS;   // rebuilt each open → follows light toggles
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
    ['⊛', 'Components', 'chrome://components'], ['⚙', 'System', 'chrome://system'],
    ['⚉', 'Version', 'chrome://version'], ['⬡', 'Management', 'chrome://management'],
    ['♿', 'Accessibility', 'chrome://accessibility'], ['⌕', 'Omnibox debug', 'chrome://omnibox'],
    ['◉', 'Media internals', 'chrome://media-internals'], ['◉', 'WebRTC internals', 'chrome://webrtc-internals'],
    ['⚙', 'Service workers', 'chrome://serviceworker-internals'], ['⚙', 'IndexedDB', 'chrome://indexeddb-internals'],
    ['⚙', 'Quota', 'chrome://quota-internals'], ['⚙', 'Blob', 'chrome://blob-internals'],
    ['📊', 'Histograms', 'chrome://histograms'], ['◈', 'Tracing', 'chrome://tracing'],
    ['⚠', 'Crashes', 'chrome://crashes'], ['⚙', 'Device log', 'chrome://device-log'],
    ['⚙', 'GCM internals', 'chrome://gcm-internals'], ['⚙', 'Sync internals', 'chrome://sync-internals'],
    ['⚙', 'Process internals', 'chrome://process-internals'], ['⚙', 'Autofill internals', 'chrome://autofill-internals'],
    ['⚙', 'Download internals', 'chrome://download-internals'], ['⚙', 'Signin internals', 'chrome://signin-internals'],
    ['⚙', 'Translate internals', 'chrome://translate-internals'], ['⚙', 'User actions', 'chrome://user-actions'],
    ['⚙', 'UKM', 'chrome://ukm'], ['⚙', 'Predictors', 'chrome://predictors'],
    ['⚙', 'Memory internals', 'chrome://memory-internals'], ['◈', 'WebUI gallery', 'chrome://webui-gallery'],
    ['✧', 'Discards', 'chrome://discards'], ['⇅', 'Net internals', 'chrome://net-internals'],
    ['⇩', 'Net export', 'chrome://net-export'], ['≡', 'All chrome:// pages', 'chrome://about'],
    ['⚡', 'CI runs', 'chrome-extension://omcgnnjfmbmpdlofklbpddkhnfibfhgg/pages/ci.html'],
    ['◈', 'Chrome Web Store', 'https://chromewebstore.google.com/'],
    ['⌂', 'zwire app store', 'https://menketechnologies.github.io/app-store/']];
  // chrome://settings sub-pages (the "tabs" inside Settings).
  var SETTINGS = [['You & Google', 'chrome://settings/syncSetup'],
    ['Appearance', 'chrome://settings/appearance'],
    ['Autofill & passwords', 'chrome://settings/autofill'],
    ['Payment methods', 'chrome://settings/payments'],
    ['Addresses', 'chrome://settings/addresses'],
    ['Privacy & security', 'chrome://settings/privacy'],
    ['Security', 'chrome://settings/security'],
    ['Cookies & site data', 'chrome://settings/cookies'],
    ['Site settings', 'chrome://settings/content'],
    ['Clear browsing data', 'chrome://settings/clearBrowserData'],
    ['Performance', 'chrome://settings/performance'],
    ['Search engine', 'chrome://settings/search'],
    ['Default browser', 'chrome://settings/defaultBrowser'],
    ['On startup', 'chrome://settings/onStartup'],
    ['Languages', 'chrome://settings/languages'],
    ['Downloads', 'chrome://settings/downloads'],
    ['Accessibility', 'chrome://settings/accessibility'],
    ['System', 'chrome://settings/system'],
    ['Reset settings', 'chrome://settings/reset']];

  // newtab's storage is isolated from the HUD, so flipping zb_ui here would be a
  // no-op. Ask the HUD (the source of truth) to toggle it — it fans the change
  // out to every surface (native file → our scheme-sync, content scripts, zpwr).
  var HUD_ID_UI = 'omcgnnjfmbmpdlofklbpddkhnfibfhgg';
  function toggleUi(key) {
    // Light mode renders on newtab purely via [data-theme]; flip it OPTIMISTICALLY
    // for instant feedback, then tell the HUD the TARGET value (not a blind flip)
    // so every surface converges to the same state and the HUD echo confirms it.
    if (key === 'light') {
      var nw = document.documentElement.getAttribute('data-theme') !== 'light';
      document.documentElement.setAttribute('data-theme', nw ? 'light' : 'dark');
      try { chrome.runtime.sendMessage(HUD_ID_UI, { type: 'zb-ui-set-key', key: 'light', value: nw }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      return;
    }
    try { chrome.runtime.sendMessage(HUD_ID_UI, { type: 'zb-ui-toggle', key: key }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  }
  var UI_TOGGLES = [['◐', 'Toggle light mode', 'light'], ['⌂', 'Toggle CRT scanlines', 'scanlines'],
    ['▣', 'Toggle bezel vignette', 'vignette'], ['✦', 'Toggle neon glow', 'glow'], ['⚡', 'Toggle animations', 'anim']];

  function items() {
    var out = [];
    UI_TOGGLES.forEach(function (t) { out.push({ icon: t[0], label: t[1], detail: 'setting', run: function () { toggleUi(t[2]); } }); });
    PAGES.forEach(function (p) { out.push({ icon: p[0], label: 'Open: ' + p[1], detail: p[2], run: function () { goCurrent(p[2]); } }); });
    SETTINGS.forEach(function (p) { out.push({ icon: '⚙', label: 'Settings: ' + p[0], detail: p[1], run: function () { goCurrent(p[1]); } }); });
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

  /* ---- shared custom commands + keyword web-search (ZWIRE_PALETTE_CMDS) --------
   * SAME source of truth as the HUD palette (extensions/hud-internal), so the two
   * palettes list identical commands + rank them identically. newtab runs it with
   * a direct-chrome backend (no worker): open = new tab; runCustom handles the
   * page-doable command types (url/scheme/js + the local actions). Worker/native-
   * only types (shell, tab-verb actions) are inert here — HUD-only by nature. */
  var PC = window.ZWIRE_PALETTE_CMDS || {};
  var customCache = [];
  function typeLabel(t) { return PC.typeLabel ? PC.typeLabel(t) : 'custom'; }
  function isDefaultCmd(e) { return PC.isDefaultCmd ? PC.isDefaultCmd(e) : false; }
  function cycleScheme() {
    var cur = document.documentElement.getAttribute('data-hud-scheme') || 'cyberpunk';
    var i = ORDER.indexOf(cur); setScheme(ORDER[(i + 1 + ORDER.length) % ORDER.length] || ORDER[0]);
  }
  function runStep(type, v, arg) {
    v = v || '';
    if (type === 'scheme') { setScheme(v); return; }
    if (type === 'js') { try { (new Function('q', v))(arg || ''); } catch (err) { try { console.error('zwire custom js:', err); } catch (x) {} } return; }
    if (type === 'action') {
      if (v === 'reload') { try { location.reload(); } catch (x) {} }
      else if (v === 'copyUrl') { try { navigator.clipboard.writeText(location.href); } catch (x) {} }
      else if (v === 'cycleScheme') { cycleScheme(); }
      return;   // worker-backed tab verbs (newTab/closeTab/…) are HUD-only; inert here
    }
    if (type === 'shell' || type === 'host') return;   // no terminal / native host on the new tab page
    var url = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, encodeURIComponent(arg || '')) : v;   // url (default)
    if (url) goCurrent(url);
  }
  // A command is a CHAIN of typed steps (new steps[] array, or a legacy single
  // {type,value}). Run each with a small stagger; {q} reaches every step.
  function entrySteps(e) {
    if (e && Array.isArray(e.steps)) return e.steps;
    if (e && e.type) return [{ type: e.type, value: e.value }];
    return [];
  }
  function runCustom(e, arg) {
    entrySteps(e).forEach(function (s, i) { setTimeout(function () { try { runStep(s.type, s.value, arg); } catch (x) {} }, i * 140); });
  }
  var CMDCTX = { runCustom: runCustom, typeLabel: typeLabel, isDefaultCmd: isDefaultCmd };
  var searchProvider = PC.makeSearchProvider ? PC.makeSearchProvider(goCurrent) : function () { return []; };
  var customProvider = PC.makeCustomProvider ? PC.makeCustomProvider(function () { return customCache; }, CMDCTX) : function () { return []; };
  function customItems(list) { return PC.makeCustomItems ? PC.makeCustomItems(list, CMDCTX) : []; }
  // Custom commands live in hud-internal's storage (the Commands page writes
  // there) and storage is per-extension, so pull the AUTHORITATIVE list from hud
  // over cross-extension messaging — that includes user-added commands (e.g. a
  // freshly added "aa"), not just the shipped defaults. Fall back to seeding the
  // defaults into THIS extension's storage if hud's worker is unreachable (older
  // hud without the bridge, or a suspended MV3 worker that never answers).
  var HUD_ID = 'omcgnnjfmbmpdlofklbpddkhnfibfhgg';
  function seedCustom(cb) {
    var done = false;
    function local() {
      if (done) return; done = true;
      try { if (window.zwireSeedCmds) { window.zwireSeedCmds(function (list) { customCache = list || []; cb(); }); return; } } catch (e) {}
      customCache = []; cb();
    }
    try {
      chrome.runtime.sendMessage(HUD_ID, { type: 'zwireGetCmds' }, function (resp) {
        if (done) return;
        if (chrome.runtime.lastError || !resp || !Array.isArray(resp.cmds)) { local(); return; }
        done = true; customCache = resp.cmds; cb();
      });
      setTimeout(local, 500);   // no reply (not allowed / worker asleep) -> local defaults
    } catch (e) { local(); }
  }

  function openPalette() {
    ensureStyle();
    try {
      ZGui.palette.clear();
      ZGui.palette.register(items());
      if (ZGui.palette.registerProvider) { ZGui.palette.registerProvider(searchProvider); ZGui.palette.registerProvider(customProvider); }
      ZGui.palette.open();
    } catch (e) {}
    // custom commands (personal + shipped defaults), tiered like the HUD palette
    try {
      seedCustom(function () {
        try {
          var userCmds = [], defCmds = [];
          customCache.forEach(function (e) { (isDefaultCmd(e) ? defCmds : userCmds).push(e); });
          if (ZGui.palette.setUserItems) ZGui.palette.setUserItems(customItems(userCmds));
          else ZGui.palette.register(customItems(userCmds));
          ZGui.palette.register(customItems(defCmds));
          var inpc = document.querySelector('.palette-input'); if (inpc) inpc.dispatchEvent(new Event('input'));
        } catch (e) {}
      });
    } catch (e) {}
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
