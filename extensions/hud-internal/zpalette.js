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
  // When the tmux overlay is open, navigate the ACTIVE PANE (ztmux shares this
  // top-frame world) instead of breaking out into a new browser tab.
  function open(url) {
    try { if (window.__zbTmuxIsOpen && window.__zbTmuxIsOpen() && window.__zbTmuxGo && window.__zbTmuxGo(url)) return; } catch (e) {}
    cmd({ a: 'openTab', url: url });
  }
  function extUrl(p) { return chrome.runtime.getURL('pages/' + p); }
  function setScheme(name) {
    try { chrome.runtime.sendMessage({ type: 'zbhud-scheme', scheme: name }); } catch (e) {}
    try { chrome.storage.local.set({ zb_scheme: name }); } catch (e) {}
  }

  var PAGES = [['◈', 'Extensions', 'extensions.html'], ['⚙', 'Settings', 'settings.html'],
    ['◷', 'History', 'history.html'], ['★', 'Bookmarks', 'bookmarks.html'],
    ['⚡', 'CI runs', 'ci.html'], ['⌨', 'Shortcuts', 'keys.html'], ['⌨', 'Extension shortcuts', 'extshortcuts.html'],
    ['✦', 'Custom commands', 'commands.html'], ['⚉', 'System info', 'version.html']];
  var CHROME = [['+', 'New tab', 'chrome://newtab'], ['▼', 'Downloads', 'chrome://downloads'],
    ['⚑', 'Flags', 'chrome://flags'], ['✧', 'Discards', 'chrome://discards'],
    ['⌗', 'DNS', 'chrome://net-internals/#dns'], ['▤', 'GPU', 'chrome://gpu'],
    ['⇅', 'Net internals', 'chrome://net-internals'], ['⚿', 'Passwords', 'chrome://password-manager'],
    ['◎', 'Inspect devices', 'chrome://inspect'],
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
      { icon: '⌥', label: 'Toggle terminal', detail: 'Ctrl+`', run: function () { try { if (window.toggleTerminalPopup) window.toggleTerminalPopup(); } catch (e) {} } },
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
    [['docker', 'hub'], 'Docker Hub', 'https://hub.docker.com/search?q={q}'],
    [['amazon', 'amzn', 'ama'], 'Amazon', 'https://www.amazon.com/s?k={q}'],
    [['reddit'], 'Reddit', 'https://www.reddit.com/search/?q={q}'],
    [['twitter', 'x'], 'X / Twitter', 'https://twitter.com/search?q={q}'],
    [['imdb'], 'IMDb', 'https://www.imdb.com/find/?q={q}'],
    [['maps'], 'Google Maps', 'https://www.google.com/maps/search/{q}']
  ];
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function searchProvider(q) {
    if (!q) return [];
    var out = [];
    var sp = q.indexOf(' ');
    var kw = (sp > 0 ? q.slice(0, sp) : q).toLowerCase();
    var rest = sp > 0 ? q.slice(sp + 1).trim() : '';
    // exact alias first; else prefix-match an alias or the destination name, so
    // `git`->GitHub, `ama`->Amazon, `you`->YouTube, `cra`->crates.io — a known
    // destination beats a raw web search.
    var hit = SEARCH.filter(function (s) { return s[0].indexOf(kw) >= 0; })[0];
    if (!hit && kw.length >= 2) {
      hit = SEARCH.filter(function (s) {
        return s[0].some(function (a) { return a.indexOf(kw) === 0; }) || slug(s[1]).indexOf(kw) === 0;
      })[0];
    }
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
    // fallback:true sinks these below any real command/tab/shortcut match.
    out.push({ icon: '⌕', label: 'Google: ' + q, detail: 'web search', fallback: true, run: function () { open('https://www.google.com/search?q=' + encodeURIComponent(q)); } });
    out.push({ icon: '⌕', label: 'DuckDuckGo: ' + q, detail: 'web search', fallback: true, run: function () { open('https://duckduckgo.com/?q=' + encodeURIComponent(q)); } });
    return out;
  }

  /* ---- user-defined custom commands (zb_custom_cmds, managed on commands.html) --
   * Each entry: { icon, label, detail, keyword, type, value }. type is one of
   * url | shell | js | action | scheme. A keyword makes it arg-taking in the
   * palette: typing `<keyword> <arg>` runs it with {q}=<arg>. */
  var customCache = [];
  function typeLabel(t) { return ({ url: 'open url', shell: 'shell', js: 'javascript', action: 'action', scheme: 'scheme' })[t] || 'custom'; }
  function runAction(id) {
    switch (id) {
      case 'reload': try { location.reload(); } catch (e) {} break;
      case 'copyUrl': clip(location.href); break;
      case 'cycleScheme': cycleScheme(); break;
      case 'toggleTerminal': try { if (window.toggleTerminalPopup) window.toggleTerminalPopup(); } catch (e) {} break;
      case 'toggleStatusbar': try { chrome.storage.local.get('zb_status', function (o) { var on = !(o && o.zb_status === false); chrome.storage.local.set({ zb_status: !on }); }); } catch (e) {} break;
      default: cmd({ a: id });   // newTab/newWindow/duplicateTab/reopenTab/closeTab/closeOthers/nextTab/prevTab/pinTab/muteTab
    }
  }
  function runCustom(e, arg) {
    var v = e.value || '';
    if (e.type === 'shell') {
      var c = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v);
      try { if (window.zwireTermRun) window.zwireTermRun(c); } catch (x) {}
      return;
    }
    if (e.type === 'js') {
      try { (new Function('q', v))(arg || ''); } catch (err) { try { console.error('zwire custom js:', err); } catch (x) {} }
      return;
    }
    if (e.type === 'action') { runAction(v); return; }
    if (e.type === 'scheme') { setScheme(v); return; }
    var url = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, encodeURIComponent(arg || '')) : v;   // url (default)
    if (url) open(url);
  }
  function customItems(list) {
    return (list || []).map(function (e) {
      return { icon: e.icon || '✦', label: e.label, detail: e.detail || (e.keyword ? e.keyword + ' …' : typeLabel(e.type)),
        run: function () { runCustom(e, ''); } };
    });
  }
  function customProvider(q) {
    if (!q) return [];
    var sp = q.indexOf(' ');
    var kw = (sp > 0 ? q.slice(0, sp) : q).toLowerCase();
    var rest = sp > 0 ? q.slice(sp + 1).trim() : '';
    var out = [];
    customCache.forEach(function (e) {
      if (e.keyword && e.keyword.toLowerCase() === kw) {
        out.push({ icon: e.icon || '✦', label: e.label + (rest ? ': ' + rest : ''), detail: e.detail || typeLabel(e.type),
          run: function () { runCustom(e, rest); } });
      }
    });
    return out;
  }

  function tabItems(tabs) {
    return (tabs || []).map(function (t) {
      return { icon: '▣', label: 'Tab: ' + (t.title || t.url || '(tab)'), detail: t.url,
        run: function () { cmd({ a: 'activate', tabId: t.id }); } };
    });
  }
  function shortcutItems(list) {
    return (list || []).map(function (s) {
      return { icon: '⌨', label: 'Shortcut: ' + s.ext + ' — ' + s.desc, detail: s.keybinding || 'unset · click to set', secondary: true, run: function () { open(extUrl('extensions.html') + '#shortcuts'); } };
    });
  }
  // Extension shortcuts are search-only (there are dozens) — a provider so they
  // surface when you type but don't flood the empty palette.
  var shortcutsCache = [];
  function shortcutProvider(q) {
    if (!q) return [];
    var ql = q.toLowerCase();
    return shortcutItems(shortcutsCache.filter(function (s) { return (s.ext + ' ' + s.desc + ' ' + (s.keybinding || '') + ' keyboard shortcuts').toLowerCase().indexOf(ql) >= 0; })).slice(0, 12);
  }

  // Chrome's OWN built-in shortcuts are not enumerable by any extension API
  // (developerPrivate only exposes *extension* commands), so they'd otherwise be
  // missing from the palette entirely. Curated, platform-aware reference list so
  // "chrome shortcuts" rank alongside the extension ones. [desc, mac, win/linux].
  var IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '');
  var CHROME_KEYS = [
    ['New tab', '⌘T', 'Ctrl+T'], ['New window', '⌘N', 'Ctrl+N'],
    ['New incognito window', '⌘⇧N', 'Ctrl+Shift+N'], ['Close tab', '⌘W', 'Ctrl+W'],
    ['Reopen last closed tab', '⌘⇧T', 'Ctrl+Shift+T'], ['Next tab', '⌃Tab', 'Ctrl+Tab'],
    ['Previous tab', '⌃⇧Tab', 'Ctrl+Shift+Tab'], ['Jump to tab 1–8', '⌘1…8', 'Ctrl+1…8'],
    ['Jump to last tab', '⌘9', 'Ctrl+9'], ['Focus address bar', '⌘L', 'Ctrl+L'],
    ['Find in page', '⌘F', 'Ctrl+F'], ['Reload', '⌘R', 'Ctrl+R'],
    ['Hard reload', '⌘⇧R', 'Ctrl+Shift+R'], ['History', '⌘Y', 'Ctrl+H'],
    ['Downloads', '⌘⇧J', 'Ctrl+J'], ['Bookmark this tab', '⌘D', 'Ctrl+D'],
    ['Bookmark all tabs', '⌘⇧D', 'Ctrl+Shift+D'], ['Toggle bookmark bar', '⌘⇧B', 'Ctrl+Shift+B'],
    ['DevTools', '⌘⌥I', 'Ctrl+Shift+I'], ['View source', '⌘⌥U', 'Ctrl+U'],
    ['Zoom in', '⌘+', 'Ctrl++'], ['Zoom out', '⌘-', 'Ctrl+-'], ['Reset zoom', '⌘0', 'Ctrl+0'],
    ['Print', '⌘P', 'Ctrl+P'], ['Save page', '⌘S', 'Ctrl+S'],
    ['Open file', '⌘O', 'Ctrl+O'], ['Back', '⌘[', 'Alt+Left'], ['Forward', '⌘]', 'Alt+Right'],
    ['Full screen', '⌃⌘F', 'F11'], ['Task manager', '', 'Shift+Esc'],
    ['Clear browsing data', '⌘⇧⌫', 'Ctrl+Shift+Del']
  ];
  function chromeKeyProvider(q) {
    if (!q) return [];
    var ql = q.toLowerCase();
    var out = [];
    CHROME_KEYS.forEach(function (k) {
      var key = (IS_MAC ? k[1] : k[2]) || k[2];
      if (('chrome keyboard shortcuts ' + k[0] + ' ' + key).toLowerCase().indexOf(ql) < 0) return;
      out.push({ icon: '⌨', label: 'Shortcut: Chrome — ' + k[0], detail: key || '—', secondary: true, run: function () { open(extUrl('keys.html')); } });
    });
    return out.slice(0, 12);
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
    try { ZGui.palette.clear(); ZGui.palette.register(items()); if (ZGui.palette.registerProvider) { ZGui.palette.registerProvider(searchProvider); ZGui.palette.registerProvider(customProvider); } ZGui.palette.open(); } catch (ex) {}
    try {
      chrome.storage.local.get(['zb_tabs', 'zb_exts', 'zb_frecent', 'zb_shortcuts', 'zb_custom_cmds'], function (o) {
        void chrome.runtime.lastError;
        try { customCache = (o && o.zb_custom_cmds) || []; ZGui.palette.register(customItems(customCache)); } catch (e) {}
        try { ZGui.palette.register(frecentItems(o && o.zb_frecent)); } catch (e) {}
        try { shortcutsCache = (o && o.zb_shortcuts) || []; } catch (e) {}
        try { ZGui.palette.register(extItems(o && o.zb_exts)); } catch (e) {}
        try { ZGui.palette.register(tabItems(o && o.zb_tabs)); } catch (e) {}
        try { var inp = document.querySelector('.palette-input'); if (inp) inp.dispatchEvent(new Event('input')); } catch (e) {}
      });
    } catch (e) {}
  }
  window.__zbPaletteOpen = openPalette;   // vim mode ('o'/':') calls this

  // ⌘K is a browser-level command (background.js) because pages like the new
  // tab reserve it before page JS. The background worker routes it here for
  // normal web pages via a message, since the page keydown may be consumed.
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'zwireOpenPalette') { try { ZGui.palette.isOpen() ? ZGui.palette.close() : openPalette(); } catch (e) {} }
    });
  } catch (e) {}

  var paletteKey = 'k';   // ⌘/Ctrl + <key>, remappable via the Keyboard page (zb_keys.openPalette)
  try { chrome.storage.local.get('zb_keys', function (o) { void chrome.runtime.lastError; if (o && o.zb_keys && o.zb_keys.openPalette) paletteKey = o.zb_keys.openPalette; }); } catch (e) {}
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.zb_keys) paletteKey = (ch.zb_keys.newValue && ch.zb_keys.newValue.openPalette) || 'k'; }); } catch (e) {}
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === paletteKey.toLowerCase() && !e.altKey && !e.shiftKey) {
      e.preventDefault(); e.stopImmediatePropagation();   // win over site ⌘K (github, etc.)
      openPalette();
    } else if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault(); e.stopImmediatePropagation();    // Ctrl+` → toggle the terminal overlay
      try { if (window.toggleTerminalPopup) window.toggleTerminalPopup(); } catch (ex) {}
    }
  }, true);
})();
