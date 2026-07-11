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
  try { if (window.zwireSeedCmds) window.zwireSeedCmds(); } catch (e) {}   // seed default ⌘K commands once (reliable page/content-script write)
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

  // Light-mode neutral overrides (from cyberpunk.css [data-theme=light]). The
  // palette scopes the scheme vars to .palette-overlay, so we must merge these in
  // HERE — otherwise the scoped dark neutrals beat theme.js's document-level light.
  var LIGHT_VARS = { '--bg-primary': '#f0f2f5', '--bg-secondary': '#e4e7ec', '--bg-card': '#ffffff', '--bg-hover': '#f7f8fa', '--text': '#1e293b', '--text-dim': '#475569', '--text-muted': '#94a3b8', '--border': '#cbd5e1', '--border-glow': '#a5b4c8' };
  function schemeVars(cb) {
    try {
      chrome.storage.local.get(['zb_scheme', 'zb_ui'], function (o) {
        var s = SCHEMES[(o && o.zb_scheme) || 'cyberpunk'] || SCHEMES.cyberpunk || { vars: {} };
        var vars = {}, sv = s.vars || {}, k;
        for (k in sv) vars[k] = sv[k];
        if (o && o.zb_ui && o.zb_ui.light) for (k in LIGHT_VARS) vars[k] = LIGHT_VARS[k];
        cb(vars);
      });
    } catch (e) { cb((SCHEMES.cyberpunk || { vars: {} }).vars || {}); }
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
    ['✦', 'Custom commands', 'commands.html'], ['▦', 'Sessions', 'sessions.html'],
    ['⊞', 'App Store', 'store.html'], ['⧉', 'Host (zwire-host)', 'host.html'], ['⚉', 'System info', 'version.html']];
  var CHROME = [['+', 'New tab', 'chrome://newtab'], ['▼', 'Downloads', 'chrome://downloads'],
    ['◷', 'History', 'chrome://history'], ['★', 'Bookmarks', 'chrome://bookmarks'],
    ['⬡', 'Extensions', 'chrome://extensions'], ['⚙', 'Settings', 'chrome://settings'],
    ['⚉', 'Version', 'chrome://version'], ['⚙', 'System', 'chrome://system'],
    ['⚑', 'Flags', 'chrome://flags'], ['✧', 'Discards', 'chrome://discards'],
    ['⌗', 'DNS', 'chrome://net-internals/#dns'], ['▤', 'GPU', 'chrome://gpu'],
    ['⇅', 'Net internals', 'chrome://net-internals'], ['⚿', 'Passwords', 'chrome://password-manager'],
    ['◎', 'Inspect devices', 'chrome://inspect'], ['⇩', 'Net export', 'chrome://net-export'],
    ['§', 'Policy', 'chrome://policy'], ['⊛', 'Components', 'chrome://components'],
    ['⬡', 'Management', 'chrome://management'], ['♿', 'Accessibility', 'chrome://accessibility'],
    ['⌕', 'Omnibox debug', 'chrome://omnibox'], ['◉', 'Media internals', 'chrome://media-internals'],
    ['◉', 'WebRTC internals', 'chrome://webrtc-internals'], ['⚙', 'Service workers', 'chrome://serviceworker-internals'],
    ['⚙', 'IndexedDB', 'chrome://indexeddb-internals'], ['⚙', 'Quota', 'chrome://quota-internals'],
    ['⚙', 'Blob', 'chrome://blob-internals'], ['📊', 'Histograms', 'chrome://histograms'],
    ['◈', 'Tracing', 'chrome://tracing'], ['⚠', 'Crashes', 'chrome://crashes'],
    ['⚙', 'Device log', 'chrome://device-log'], ['⚙', 'GCM internals', 'chrome://gcm-internals'],
    ['⚙', 'Sync internals', 'chrome://sync-internals'], ['⚙', 'Process internals', 'chrome://process-internals'],
    ['⚙', 'Autofill internals', 'chrome://autofill-internals'], ['⚙', 'Download internals', 'chrome://download-internals'],
    ['⚙', 'Signin internals', 'chrome://signin-internals'], ['⚙', 'Translate internals', 'chrome://translate-internals'],
    ['⚙', 'User actions', 'chrome://user-actions'], ['⚙', 'UKM', 'chrome://ukm'],
    ['⚙', 'Predictors', 'chrome://predictors'], ['⚙', 'Memory internals', 'chrome://memory-internals'],
    ['◈', 'WebUI gallery', 'chrome://webui-gallery'], ['≡', 'All chrome:// pages', 'chrome://about']];
  // chrome://settings sub-pages (the "tabs" inside Settings) — each opens direct.
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
  var WEB = [['◈', 'Chrome Web Store', 'https://chromewebstore.google.com/'],
    ['⌂', 'zwire app store', 'https://menketechnologies.github.io/app-store/']];

  function items() {
    var out = [];
    cmdItems().forEach(function (c) { out.push(c); });
    PAGES.forEach(function (p) { out.push({ icon: p[0], label: 'Go: ' + p[1], detail: p[2], run: function () { open(extUrl(p[2])); } }); });
    CHROME.forEach(function (p) { out.push({ icon: p[0], label: 'Open: ' + p[1], detail: p[2], run: function () { open(p[2]); } }); });
    SETTINGS.forEach(function (p) { out.push({ icon: '⚙', label: 'Settings: ' + p[0], detail: p[1], run: function () { open(p[1]); } }); });
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
      { icon: '◐', label: 'Toggle light mode', detail: 'setting', run: function () { toggleUi('light'); } },
      { icon: '⌂', label: 'Toggle CRT scanlines', detail: 'setting', run: function () { toggleUi('scanlines'); } },
      { icon: '▣', label: 'Toggle bezel vignette', detail: 'setting', run: function () { toggleUi('vignette'); } },
      { icon: '✦', label: 'Toggle neon glow', detail: 'setting', run: function () { toggleUi('glow'); } },
      { icon: '⚡', label: 'Toggle animations', detail: 'setting', run: function () { toggleUi('anim'); } },
      { icon: '▤', label: 'Toggle status bar (tmux/session powerline)', detail: 'setting', run: function () { try { chrome.storage.local.get('zb_status', function (o) { chrome.storage.local.set({ zb_status: (o && o.zb_status === false) }); }); } catch (e) {} } }
    ];
  }
  // Settings live in chrome.storage 'zb_ui' (mirrored from the HUD settings) so a
  // content-script palette can flip them; theme.js/newtab react via onChanged.
  function toggleUi(key) { try { chrome.storage.local.get('zb_ui', function (o) { void chrome.runtime.lastError; var ui = (o && o.zb_ui) || {}; ui[key] = (key === 'light') ? !ui.light : (ui[key] === false); chrome.storage.local.set({ zb_ui: ui }); }); } catch (e) {} }

  // Keyword web-search registry + provider now live in the SHARED palette-cmds.js
  // (ZWIRE_PALETTE_CMDS) so the HUD palette and the New Tab palette stay identical.
  // searchProvider is wired below (after runCustom), bound to this page's open().

  /* ---- user-defined custom commands (zb_custom_cmds, managed on commands.html) --
   * Each entry: { icon, label, detail, keyword, type, value }. type is one of
   * url | shell | js | action | scheme. A keyword makes it arg-taking in the
   * palette: typing `<keyword> <arg>` runs it with {q}=<arg>. */
  var customCache = [];
  function typeLabel(t) { return ({ url: 'open url', shell: 'shell', js: 'javascript', action: 'action', scheme: 'scheme' })[t] || 'custom'; }
  // Shipped defaults carry a 'def-…' id (cmd-defaults.js); a user's own additions
  // get a 'c…' id (commands.js). Only the latter are personal, so only they are
  // flagged user:true — zgui-core's palette ranks user:true items in a tier that
  // ALWAYS sits above the built-in ("stdlib") + shipped-default rows.
  function isDefaultCmd(e) { return String((e && e.id) || '').indexOf('def-') === 0; }
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
  // Small transient toast for host-command feedback (content script — may not
  // have ZGui.toast; fall back to a self-styled corner popup).
  function hostToast(text, bad) {
    try { if (window.ZGui && ZGui.toast) { ZGui.toast.show(text); return; } } catch (e) {}
    var d = document.createElement('div'); d.textContent = text;
    d.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0a0d16;color:' + (bad ? '#ff2a6d' : '#05d9e8') + ';border:1px solid currentColor;padding:8px 12px;font:12px "Share Tech Mono",monospace;border-radius:4px;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    (document.body || document.documentElement).appendChild(d); setTimeout(function () { try { d.remove(); } catch (e) {} }, 3200);
  }
  // Shell steps run through zwire-host `exec` — reliable everywhere, no popup
  // terminal required. The program + args are chosen per-OS (cmd.exe on Windows,
  // /bin/sh -c on macOS/Linux) and PATH widened so common tool dirs resolve. The
  // reply's base64 stdout/stderr is decoded and shown as a toast.
  function osKind() {
    var p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
    if (p.indexOf('win') >= 0) return 'win';
    if (p.indexOf('mac') >= 0 || p.indexOf('darwin') >= 0) return 'mac';
    return 'nix';
  }
  function shellReq(cmd) {
    var os = osKind();
    if (os === 'win') return { cmd: 'exec', program: 'cmd.exe', args: ['/d', '/s', '/c', cmd] };
    var path = (os === 'mac')
      ? '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
      : '/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin';
    return { cmd: 'exec', program: '/bin/sh', args: ['-c', cmd], env: { PATH: path } };
  }
  function b64dec(s) { try { return s ? decodeURIComponent(escape(atob(s))) : ''; } catch (e) { try { return s ? atob(s) : ''; } catch (x) { return ''; } } }
  function runShell(cmd) {
    var req = shellReq(cmd);
    try {
      chrome.runtime.sendMessage({ type: 'zb-host', req: req }, function (res) {
        void chrome.runtime.lastError;
        if (!res || !res.ok) { hostToast('shell: ' + ((res && res.err) || 'no response'), true); return; }
        var r = res.reply || {};
        var out = b64dec(r.stdout).trim(), er = b64dec(r.stderr).trim();
        var bad = r.code != null && r.code !== 0;
        var text = out || er;
        hostToast('$ ' + cmd + (text ? ' ◂ ' + text.slice(0, 160) : (bad ? ' (exit ' + r.code + ')' : ' ✓')), bad);
      });
    } catch (err) { hostToast('shell: ' + err, true); }
  }
  // AppleScript steps run through zwire-host via `osascript` (macOS only). Each
  // source line becomes an `-e` arg (osascript's own multi-line convention), so
  // multi-line scripts run without a temp file. stdout/stderr toast back.
  function runOsa(script) {
    if (osKind() !== 'mac') { hostToast('applescript: macOS only', true); return; }
    var args = [];
    String(script).split('\n').forEach(function (line) { args.push('-e'); args.push(line); });
    var req = { cmd: 'exec', program: 'osascript', args: args };
    try {
      chrome.runtime.sendMessage({ type: 'zb-host', req: req }, function (res) {
        void chrome.runtime.lastError;
        if (!res || !res.ok) { hostToast('applescript: ' + ((res && res.err) || 'no response'), true); return; }
        var r = res.reply || {};
        var out = b64dec(r.stdout).trim(), er = b64dec(r.stderr).trim();
        var bad = r.code != null && r.code !== 0;
        var text = out || er;
        hostToast('⟨osa⟩' + (text ? ' ◂ ' + text.slice(0, 160) : (bad ? ' (exit ' + r.code + ')' : ' ✓')), bad);
      });
    } catch (err) { hostToast('applescript: ' + err, true); }
  }
  // Batch steps run through zwire-host via `cmd.exe /d /s /c` (Windows only). Output
  // (base64) is decoded and toasted, like the shell step.
  function runBatch(cmd) {
    var req = { cmd: 'exec', program: 'cmd.exe', args: ['/d', '/s', '/c', cmd] };
    try {
      chrome.runtime.sendMessage({ type: 'zb-host', req: req }, function (res) {
        void chrome.runtime.lastError;
        if (!res || !res.ok) { hostToast('batch: ' + ((res && res.err) || 'no response'), true); return; }
        var r = res.reply || {};
        var out = b64dec(r.stdout).trim(), er = b64dec(r.stderr).trim();
        var bad = r.code != null && r.code !== 0;
        var text = out || er;
        hostToast('cmd> ' + cmd + (text ? ' ◂ ' + text.slice(0, 160) : (bad ? ' (exit ' + r.code + ')' : ' ✓')), bad);
      });
    } catch (err) { hostToast('batch: ' + err, true); }
  }
  // stryke steps run inline stryke code through zwire-host (`stryke -E`, using the
  // bundled sidecar — no PATH needed). stdout/stderr come back as plain strings.
  function runStryke(code) {
    try {
      chrome.runtime.sendMessage({ type: 'zb-host', req: { cmd: 'stryke_run', code: code } }, function (res) {
        void chrome.runtime.lastError;
        // The worker runs stryke and executes any browser.* action from the reply. We only toast.
        if (!res || !res.ok) { hostToast('stryke: ' + ((res && res.err) || 'no response'), true); return; }
        var r = res.reply || {};
        if (!r.ok) { hostToast('stryke: ' + (r.err || 'error'), true); return; }
        var out = (r.stdout || '').trim(), er = (r.stderr || '').trim();
        var bad = (r.code != null && r.code !== 0) || r.timedOut;
        var text = out || er;
        hostToast('⟨stryke⟩' + (text ? ' ◂ ' + text.slice(0, 160) : (bad ? ' (exit ' + r.code + ')' : ' ✓')), bad);
      });
    } catch (err) { hostToast('stryke: ' + err, true); }
  }
  function runStep(type, v, arg) {
    v = v || '';
    if (type === 'shell') {
      var c = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v);
      runShell(c);
      return;
    }
    if (type === 'stryke') {
      var sc = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v);
      runStryke(sc);
      return;
    }
    if (type === 'applescript') {
      var as = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : v;
      runOsa(as);
      return;
    }
    if (type === 'batch') {
      var bc = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v);
      runBatch(bc);
      return;
    }
    if (type === 'js') {
      try { (new Function('q', v))(arg || ''); } catch (err) { try { console.error('zwire custom js:', err); } catch (x) {} }
      return;
    }
    if (type === 'action') { runAction(v); return; }
    if (type === 'scheme') { setScheme(v); return; }
    if (type === 'host') {
      var raw = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : v;
      var obj; try { obj = JSON.parse(raw); } catch (err) { hostToast('host: invalid JSON', true); return; }
      try {
        chrome.runtime.sendMessage({ type: 'zb-host', req: obj }, function (res) {
          void chrome.runtime.lastError;
          if (!res || !res.ok) { hostToast('host: ' + ((res && res.err) || 'no response'), true); return; }
          var r = res.reply; hostToast('host ◂ ' + (r && typeof r === 'object' ? JSON.stringify(r).slice(0, 140) : String(r)));
        });
      } catch (err) { hostToast('host: ' + err, true); }
      return;
    }
    var url = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, encodeURIComponent(arg || '')) : v;   // url (default)
    if (url) open(url);
  }
  // A command is a CHAIN of typed steps run top-to-bottom (a small stagger keeps
  // tab-opens and scheme swaps from stomping each other; {q} reaches every step).
  // entrySteps() accepts the new steps[] array or a legacy single {type,value}.
  function entrySteps(e) {
    if (e && Array.isArray(e.steps)) return e.steps;
    if (e && e.type) return [{ type: e.type, value: e.value }];
    return [];
  }
  function runCustom(e, arg) {
    entrySteps(e).forEach(function (s, i) { setTimeout(function () { try { runStep(s.type, s.value, arg); } catch (x) {} }, i * 140); });
  }
  // Custom-command rows, the exact-keyword provider, and the web-search provider
  // all come from the SHARED palette-cmds.js (ZWIRE_PALETTE_CMDS), bound to this
  // page's backend: open() (worker openTab bus) + runCustom() (worker/native).
  var PC = window.ZWIRE_PALETTE_CMDS || {};
  var CMDCTX = { runCustom: runCustom, typeLabel: typeLabel, isDefaultCmd: isDefaultCmd };
  var searchProvider = PC.makeSearchProvider ? PC.makeSearchProvider(open) : function () { return []; };
  function customItems(list) { return PC.makeCustomItems ? PC.makeCustomItems(list, CMDCTX) : []; }
  var customProvider = PC.makeCustomProvider ? PC.makeCustomProvider(function () { return customCache; }, CMDCTX) : function () { return []; };

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
        try {
          customCache = (o && o.zb_custom_cmds) || [];
          // Personal commands go through setUserItems (their tier ranks above the
          // built-ins + shipped defaults, and it's idempotent across re-opens);
          // shipped defaults register as ordinary "stdlib" rows.
          var userCmds = [], defCmds = [];
          customCache.forEach(function (e) { (isDefaultCmd(e) ? defCmds : userCmds).push(e); });
          if (ZGui.palette.setUserItems) ZGui.palette.setUserItems(customItems(userCmds));
          else ZGui.palette.register(customItems(userCmds));   // older zgui-core: fall back to plain rows
          ZGui.palette.register(customItems(defCmds));
        } catch (e) {}
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
