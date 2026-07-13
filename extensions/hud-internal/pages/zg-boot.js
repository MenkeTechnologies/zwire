/* zwire HUD — shared zgui-core boot for every internal page.
 * Mounts ZGui.appShell (brand · filter · ⌘K palette · settings w/ colorscheme +
 * CRT/neon · shortcuts), wires the cross-page nav into the shell, and bridges
 * the zgui colorscheme picker to the native host so a pick repaints the whole
 * browser (~/.zwire/hud-scheme) + mirrors to storage for the content-script
 * theme. All UI comes from ZGui.* per the zgui-core-only rule. */
(function () {
  'use strict';
  var HOST = 'com.zwire.hud';

  // Our own HUD pages (extension URLs) + the native chrome pages we can't rewrite.
  // DOWNLOADS points at the native page — zpwrchrome owns the download manager
  // (its takeover cancels + reissues Chrome downloads), so a HUD downloads page
  // built on chrome.downloads.search would only show the cancelled stubs.
  var PAGES = [['DASHBOARD', 'dashboard.html'],
    ['AUDIO', 'audio.html'], ['HOOKS', 'hooks.html'],
    ['EXTENSIONS', 'extensions.html'], ['SETTINGS', 'settings.html'],
    ['APP STORE', 'store.html'],
    ['HISTORY', 'history.html'], ['DOWNLOADS', 'chrome://downloads'], ['BOOKMARKS', 'bookmarks.html'],
    ['CI', 'ci.html'], ['SHORTCUTS', 'keys.html'], ['EXT KEYS', 'extshortcuts.html'],
    ['COMMANDS', 'commands.html'], ['TRIGGERS', 'triggers.html'], ['SESSIONS', 'sessions.html'], ['HOST', 'host.html'],
    ['SYSTEM', 'version.html'], ['NEW TAB', 'chrome://newtab']];
  var NATIVE_PAGES = [['FLAGS', 'chrome://flags']];
  // Extra palette-only destinations (not shown as nav buttons): more chrome://
  // internals + the web stores. External (http) targets open in a new tab.
  var MORE = [['Passwords', 'chrome://password-manager'],
    ['Inspect devices', 'chrome://inspect'], ['Net export', 'chrome://net-export'], ['Policy', 'chrome://policy'],
    ['Components', 'chrome://components'], ['All chrome:// pages', 'chrome://about'],
    ['Site settings', 'chrome://settings/content'], ['Chrome Web Store', 'https://chromewebstore.google.com/'],
    ['zwire app store', 'https://menketechnologies.github.io/app-store/']];

  // Custom ⌘K commands (zb_custom_cmds, managed on commands.html) also run from
  // the internal HUD pages. Internal pages have chrome.tabs directly; browser
  // actions route through the same zb_cmd storage bus the worker listens on.
  // Shell steps run via zwire-host `exec` — extension pages talk to the native
  // host directly. The program/args are chosen per-OS (cmd.exe on Windows, /bin/sh
  // -c on macOS/Linux) with a widened PATH; output decoded to a toast.
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
  function bootToast(m, type) { try { if (ZGui.toast && ZGui.toast.show) ZGui.toast.show(m, 3200, type || ''); } catch (x) {} }
  function runShellBoot(cmd) {
    var req = shellReq(cmd);
    try {
      chrome.runtime.sendNativeMessage(HOST, req, function (reply) {
        var err = chrome.runtime.lastError;
        if (err) { bootToast('shell: ' + err.message, 'error'); return; }
        var r = reply || {};
        if (r.ok === false) { bootToast('shell: ' + (r.err || 'failed'), 'error'); return; }
        var out = b64dec(r.stdout).trim(), er = b64dec(r.stderr).trim();
        var bad = r.code != null && r.code !== 0;
        var text = out || er;
        bootToast('$ ' + cmd + (text ? ' ◂ ' + text.slice(0, 160) : (bad ? ' (exit ' + r.code + ')' : ' ✓')), bad ? 'error' : 'success');
      });
    } catch (e) { bootToast('shell: ' + e, 'error'); }
  }
  // stryke steps run inline stryke code via zwire-host (`stryke -E`, bundled
  // sidecar). stdout/stderr are plain strings (no base64, unlike exec).
  function runStrykeBoot(code) {
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd: 'stryke_run', code: code }, function (reply) {
        var err = chrome.runtime.lastError;
        if (reply && reply.zbAction) runZbAction(reply.zbAction);   // fire the browser.* action the host attached
        if (err) { bootToast('stryke: ' + err.message, 'error'); return; }
        var r = reply || {};
        if (r.ok === false) { bootToast('stryke: ' + (r.err || 'failed'), 'error'); return; }
        var out = (r.stdout || '').trim(), er = (r.stderr || '').trim();
        var bad = (r.code != null && r.code !== 0) || r.timedOut;
        var text = out || er;
        bootToast('⟨stryke⟩' + (text ? ' ◂ ' + text.slice(0, 160) : (bad ? ' (exit ' + r.code + ')' : ' ✓')), bad ? 'error' : 'success');
      });
    } catch (e) { bootToast('stryke: ' + e, 'error'); }
  }
  // AppleScript steps run through zwire-host via `osascript` (macOS only). Each
  // source line becomes an `-e` arg (osascript's multi-line convention), so
  // multi-line scripts run with no temp file. Mirrors zpalette.js runOsa, but on
  // an internal HUD page we reach the host directly (sendNativeMessage).
  function runOsaBoot(script) {
    if (osKind() !== 'mac') { bootToast('applescript: macOS only', 'error'); return; }
    var args = [];
    String(script).split('\n').forEach(function (line) { args.push('-e'); args.push(line); });
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd: 'exec', program: 'osascript', args: args }, function (reply) {
        var err = chrome.runtime.lastError;
        if (err) { bootToast('applescript: ' + err.message, 'error'); return; }
        var r = reply || {};
        if (r.ok === false) { bootToast('applescript: ' + (r.err || 'failed'), 'error'); return; }
        var out = b64dec(r.stdout).trim(), er = b64dec(r.stderr).trim();
        var bad = r.code != null && r.code !== 0;
        var text = out || er;
        bootToast('⟨osa⟩' + (text ? ' ◂ ' + text.slice(0, 160) : (bad ? ' (exit ' + r.code + ')' : ' ✓')), bad ? 'error' : 'success');
      });
    } catch (e) { bootToast('applescript: ' + e, 'error'); }
  }
  // Batch steps run through zwire-host via `cmd.exe /d /s /c` (Windows only).
  function runBatchBoot(cmd) {
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd: 'exec', program: 'cmd.exe', args: ['/d', '/s', '/c', cmd] }, function (reply) {
        var err = chrome.runtime.lastError;
        if (err) { bootToast('batch: ' + err.message, 'error'); return; }
        var r = reply || {};
        if (r.ok === false) { bootToast('batch: ' + (r.err || 'failed'), 'error'); return; }
        var out = b64dec(r.stdout).trim(), er = b64dec(r.stderr).trim();
        var bad = r.code != null && r.code !== 0;
        var text = out || er;
        bootToast('cmd> ' + cmd + (text ? ' ◂ ' + text.slice(0, 160) : (bad ? ' (exit ' + r.code + ')' : ' ✓')), bad ? 'error' : 'success');
      });
    } catch (e) { bootToast('batch: ' + e, 'error'); }
  }
  // The 'js' step runs user JavaScript. MV3's default CSP forbids eval/new Function
  // in this realm, so relay the code to the manifest-declared sandbox page (its own
  // CSP allows unsafe-eval + modals) via a hidden, reused iframe and eval it there.
  var _zjsFrame = null, _zjsReady = false, _zjsN = 0, _zjsQ = [], _zjsBound = false;
  function zjsRun(code, arg) {
    if (!_zjsBound) {
      _zjsBound = true;
      window.addEventListener('message', function (e) {
        var d = e.data;
        if (d && d.zjs === 1 && d.ok === false) { try { console.error('zwire custom js:', d.err); } catch (x) {} }
      });
    }
    var msg = { zjs: 1, id: 'j' + (++_zjsN), code: String(code || ''), arg: arg || '' };
    if (_zjsReady && _zjsFrame && _zjsFrame.contentWindow) { _zjsFrame.contentWindow.postMessage(msg, '*'); return; }
    _zjsQ.push(msg);
    if (_zjsFrame) return;
    _zjsFrame = document.createElement('iframe');
    _zjsFrame.src = chrome.runtime.getURL('sandbox/js-run.html');
    _zjsFrame.setAttribute('aria-hidden', 'true');
    _zjsFrame.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;border:0;opacity:0;';
    _zjsFrame.addEventListener('load', function () {
      _zjsReady = true;
      var cw = _zjsFrame.contentWindow;
      _zjsQ.forEach(function (m) { try { cw.postMessage(m, '*'); } catch (x) {} });
      _zjsQ = [];
    });
    (document.body || document.documentElement).appendChild(_zjsFrame);
  }
  function runStepBoot(type, v, arg) {
    v = v || '';
    if (type === 'shell') {
      var c = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v);
      runShellBoot(c);
      return;
    }
    if (type === 'stryke') {
      var sc = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v);
      runStrykeBoot(sc);
      return;
    }
    if (type === 'applescript') {
      var as = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : v;
      runOsaBoot(as);
      return;
    }
    if (type === 'batch') {
      var bc = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v);
      runBatchBoot(bc);
      return;
    }
    if (type === 'js') { zjsRun(v, arg); return; }
    if (type === 'action') { try { chrome.storage.local.set({ zb_cmd: { a: v, n: 'boot' + Date.now() } }); } catch (x) {} return; }
    if (type === 'scheme') {
      try { chrome.runtime.sendNativeMessage(HOST, { scheme: v }, function () { void chrome.runtime.lastError; }); } catch (x) {}
      try { chrome.storage.local.set({ zb_scheme: v }); if (ZGui.colorscheme) ZGui.colorscheme.apply(v); } catch (x) {}
      return;
    }
    if (type === 'host') {   // extension page can talk to the native host directly
      var raw = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : v;
      var obj; try { obj = JSON.parse(raw); } catch (err) { if (ZGui.toast) ZGui.toast.show('host: invalid JSON'); return; }
      try {
        chrome.runtime.sendNativeMessage(HOST, obj, function (reply) {
          var err = chrome.runtime.lastError;
          if (ZGui.toast) ZGui.toast.show('host ◂ ' + (err ? err.message : (reply && typeof reply === 'object' ? JSON.stringify(reply).slice(0, 140) : String(reply))));
        });
      } catch (err) { if (ZGui.toast) ZGui.toast.show('host: ' + err); }
      return;
    }
    var url = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, encodeURIComponent(arg || '')) : v;
    if (url) { try { chrome.tabs.create({ url: url }); } catch (x) { try { location.href = url; } catch (y) {} } }
  }
  // A command is a CHAIN of typed steps (new steps[] array, or a legacy single
  // {type,value} for shipped defaults). Run them top-to-bottom with a small stagger.
  function bootSteps(e) {
    if (e && Array.isArray(e.steps)) return e.steps;
    if (e && e.type) return [{ type: e.type, value: e.value }];
    return [];
  }
  function runCustomBoot(e, arg) {
    bootSteps(e).forEach(function (s, i) { setTimeout(function () { try { runStepBoot(s.type, s.value, arg); } catch (x) {} }, i * 140); });
  }
  // A user's own commands ('c…' id) are flagged user:true so zgui-core's palette
  // ranks them in the tier above the built-in + shipped-default ('def-…') rows.
  function isDefaultCmd(e) { return String((e && e.id) || '').indexOf('def-') === 0; }
  function bootCustomItems(list) {
    return (list || []).map(function (e) {
      return { icon: e.icon || '✦', label: e.label, hint: e.keyword || e.type, keyword: e.keyword || '', user: !isDefaultCmd(e), run: function () { runCustomBoot(e, ''); } };
    });
  }

  function isChromeUrl(t) { return t.indexOf('chrome://') === 0; }
  function isWebUrl(t) { return /^https?:\/\//.test(t); }
  function go(target) {
    if (isChromeUrl(target) || isWebUrl(target)) { try { chrome.tabs.create({ url: target }); } catch (e) {} }
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
  function goNewTab(target) {
    var url = (isChromeUrl(target) || isWebUrl(target)) ? target : chrome.runtime.getURL('pages/' + target);
    try { chrome.tabs.create({ url: url }); } catch (e) { location.href = url; }
  }
  function paletteNav() {
    // palette opens the page in a NEW tab (the nav bar still navigates in place).
    return PAGES.concat(NATIVE_PAGES).concat(MORE).map(function (p) {
      return { label: 'Go: ' + p[0], hint: p[1], run: function () { goNewTab(p[1]); } };
    });
  }
  // Frecent (frequent + recent) sites from history — internal pages have the
  // history permission directly, so score here (same formula as background.js).
  function frecentItems(cb) {
    try {
      var now = Date.now();
      chrome.history.search({ text: '', maxResults: 500, startTime: now - 1000 * 60 * 60 * 24 * 90 }, function (items) {
        void chrome.runtime.lastError;
        var scored = (items || []).map(function (h) {
          var ageDays = (now - (h.lastVisitTime || 0)) / (1000 * 60 * 60 * 24);
          return { title: h.title || h.url, url: h.url, score: ((h.visitCount || 1) + 2 * (h.typedCount || 0)) / (1 + ageDays * 0.3) };
        }).filter(function (x) { return x.url && x.url.indexOf('chrome') !== 0; });
        scored.sort(function (a, b) { return b.score - a.score; });
        cb(scored.slice(0, 30).map(function (x) {
          return { icon: '★', label: (x.title || x.url), detail: x.url, run: function () { goNewTab(x.url); } };
        }));
      });
    } catch (e) { cb([]); }
  }

  /* ---- colorscheme <-> native host bridge -------------------------------- */
  var applyingExternal = false, currentScheme = null, lastPick = 0, lastPresetWrite = 0;
  function bridge() {
    if (!window.ZGui || !ZGui.colorscheme) return;
    // Mirror the saved-scheme LIBRARY (every custom scheme's name + colours) to the
    // host so ~/.zwire/global.toml stores them all and the whole fleet can read them.
    ZGui.colorscheme.onPresets(function (list) {
      if (applyingExternal || window.__zbApplyingExternal) return;
      lastPresetWrite = Date.now();
      try { chrome.runtime.sendNativeMessage(HOST, { schemes: list || [] }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    });
    // any pick in the shell settings (or a custom scheme) -> native + storage.
    ZGui.colorscheme.onApply(function (name) {
      currentScheme = name;
      // Suppress the re-publish when this apply is REACTING to an externally
      // received value (scheme pull, or a light/fx reconcile from zb_ui on this
      // OR another page — settings.js sets window.__zbApplyingExternal around its
      // setLight). Re-publishing a value we just received is what turned a
      // light/dark reconcile into an infinite flash loop between surfaces.
      if (applyingExternal || window.__zbApplyingExternal) return;
      // Local user pick: stamp it so the 1.5s pull() below won't clobber it with a
      // STALE host read (the {scheme} write is async and may not have landed yet —
      // rapid picks otherwise "snap back" to the previous value).
      lastPick = Date.now();
      try { chrome.runtime.sendNativeMessage(HOST, { scheme: name }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      try { chrome.storage.local.set({ zb_scheme: name }); } catch (e) {}
      // Mirror the RESOLVED palette (every scheme var read off :root as concrete
      // hex, incl. a custom/edited scheme) into zb_palette; the background bridge
      // forwards it to the host so ~/.zwire/global.toml carries the real colours.
      try {
        var pal = {}, keys = ZGui.colorscheme.keys || window.SCHEME_VAR_KEYS, cs = getComputedStyle(document.documentElement);
        if (keys) keys.forEach(function (k) { var val = cs.getPropertyValue(k); if (val && val.trim()) pal[k] = val.trim(); });
        if (Object.keys(pal).length) chrome.storage.local.set({ zb_palette: pal });
      } catch (e) {}
      // setLight() re-applies the scheme, so onApply ALSO fires on a light/dark
      // toggle from ANY surface — including the appShell settings modal + scheme
      // cards, which call setLight directly and never touched zb_ui. Mirror the
      // current light + fx into zb_ui here so the background bridge writes it to
      // the host (~/.zwire/global.toml). This is why light wasn't updating the
      // file while the scheme (which had this onApply hook) was.
      try {
        var ui = {};
        if (ZGui.colorscheme.isLight) ui.light = !!ZGui.colorscheme.isLight();
        if (ZGui.fx && ZGui.fx.all) { var a = ZGui.fx.all(); ui.scanlines = a.scanlines; ui.vignette = a.vignette; ui.glow = a.glow; ui.anim = a.anim; }
        // Write the host DIRECTLY (same as the scheme write above) — do NOT depend
        // on the background bridge to forward a zb_ui storage change. That is the
        // reason scheme updated the file but light didn't: scheme is a direct page
        // write, light was going through the bridge. Also mirror to zb_ui so
        // HUD content scripts on this origin follow.
        publishUi(ui);
        chrome.storage.local.set({ zb_ui: ui });
      } catch (e) {}
    });
    function pull() {
      try {
        chrome.runtime.sendNativeMessage(HOST, { cmd: 'get' }, function (r) {
          void chrome.runtime.lastError;
          // Only follow a REAL scheme value. A transient failed/empty `get` (host
          // respawn, mid-write) must NOT fall back to 'cyberpunk' — that fallback
          // is exactly what reset a freshly-picked scheme back to cyberpunk.
          var s = r && r.scheme;
          // Ignore a differing host scheme for a moment after a local pick — it's
          // almost certainly a stale read racing our own not-yet-flushed write.
          if (s && s !== currentScheme && Date.now() - lastPick > 2500) {
            applyingExternal = true;
            try {
              // A custom scheme ('custom' / 'custom-N') has no baked table — render it
              // from the host's resolved palette so another fleet app's custom scheme
              // converges here too. `apply(s)` would be a no-op and leave stale colours.
              if (/^custom(-\d+)?$/.test(s) && r.palette && Object.keys(r.palette).length) {
                ZGui.colorscheme.applyVars(r.palette);
                currentScheme = s;   // applyVars doesn't fire onApply, so track it here
              } else {
                ZGui.colorscheme.apply(s);
              }
            } finally { applyingExternal = false; }
            // keep any rendered scheme picker's highlight in sync with the
            // native (file) scheme, not just zgui's localStorage.
            document.querySelectorAll('.scheme-btn,.zs-scheme-btn').forEach(function (b) {
              if (b.dataset && b.dataset.scheme) b.classList.toggle('active', b.dataset.scheme === s);
            });
          }
          // Hydrate the saved-scheme LIBRARY from the shared store — another surface
          // (or another machine) may have added/renamed/removed one. Skip briefly after
          // a local library write so we don't clobber an edit that's still flushing.
          if (Array.isArray(r.schemes) && Date.now() - lastPresetWrite > 2500) {
            try {
              if (JSON.stringify(r.schemes) !== JSON.stringify(ZGui.colorscheme.presets())) {
                applyingExternal = true;
                try { ZGui.colorscheme.setPresets(r.schemes); } finally { applyingExternal = false; }
              }
            } catch (e) {}
          }
        });
      } catch (e) {}
    }
    // Apply a resolved palette pushed by the host (a custom/edited scheme from
    // this or another fleet app) straight onto :root. Change-driven, so a built-in
    // scheme — whose palette equals the baked vars — is a harmless no-op repaint.
    try {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area !== 'local' || !ch.zb_palette || !ch.zb_palette.newValue) return;
        if (Date.now() - lastPick < 2500) return;   // don't clobber a fresh local pick
        try {
          var pal = ch.zb_palette.newValue, root = document.documentElement.style;
          Object.keys(pal).forEach(function (k) { if (k.charAt(0) === '-' && typeof pal[k] === 'string' && pal[k]) root.setProperty(k, pal[k]); });
        } catch (e) {}
      });
    } catch (e) {}
    pull();
    setInterval(pull, 1500);
  }

  // Publish visual-effect + light-mode prefs to the native file so the OTHER
  // extensions (newtab) can follow them — same shared bus the scheme rides.
  // fx/light persist to per-origin localStorage, which newtab can't read.
  function publishUi(partial) {
    try { chrome.runtime.sendNativeMessage(HOST, { ui: partial }, function () { void chrome.runtime.lastError; }); } catch (e) {}
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
    var crtCtl = null;
    // Restore the persisted light/dark preference (themeLight) BEFORE the scheme
    // is applied — this custom mount (not ZGui.appShell) never called load(), so
    // light mode was set, saved, then dropped on every reload. load() sets
    // data-theme from themeLight; the native-scheme pull() below then re-applies
    // the scheme respecting it, so light survives refresh.
    try { if (window.ZGui && ZGui.colorscheme && ZGui.colorscheme.load) ZGui.colorscheme.load(); } catch (e) {}
    // Reconcile with the cross-surface truth (zb_ui): a palette on ANY surface
    // (web page, newtab) toggles zb_ui; honor it here so HUD pages follow, then
    // mirror the reconciled state back out. This makes light + fx consistent
    // everywhere regardless of where the toggle happened.
    try {
      chrome.storage.local.get('zb_ui', function (o) {
        void chrome.runtime.lastError; var ui = (o && o.zb_ui) || {}, cs = window.ZGui && ZGui.colorscheme, fx = window.ZGui && ZGui.fx;
        // Applying a RECEIVED value — guard so onApply doesn't republish it (loop).
        window.__zbApplyingExternal = true;
        try {
          try { if (cs && cs.setLight && typeof ui.light === 'boolean' && cs.isLight() !== ui.light) cs.setLight(ui.light); } catch (e) {}
          try { if (fx && fx.set) ['scanlines', 'vignette', 'glow', 'anim'].forEach(function (n) { if (typeof ui[n] === 'boolean' && fx.get(n) !== ui[n]) fx.set(n, ui[n]); }); } catch (e) {}
        } finally { window.__zbApplyingExternal = false; }
        var out = {};
        try { if (cs && cs.isLight) out.light = !!cs.isLight(); } catch (e) {}
        try { if (fx && fx.all) { var a = fx.all(); out.scanlines = a.scanlines; out.vignette = a.vignette; out.glow = a.glow; out.anim = a.anim; } } catch (e) {}
        try { chrome.storage.local.set({ zb_ui: out }); } catch (e) {}
      });
    } catch (e) {}
    injectCss();
    var root = document.getElementById('app') || document.body;
    var app = el('div', 'zb-app');
    // header: ZW // TITLE  +  ZGui.searchBox filter
    var header = el('header', 'zb-header');
    var inner = el('div', 'zb-header-inner');
    inner.appendChild(el('div', 'zb-logo', '<span class="zb">ZW</span> <span class="ti">// ' + (opts.title || 'ZWIRE') + '</span>'));
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
      var sb = ZGui.searchBox(filterHost, { placeholder: opts.filterPlaceholder || '>_ filter…',
        onInput: function (v, meta) { opts.onFilter(v, meta ? !!meta.regex : false); } });
      // Focus the filter on load so you can type immediately, like the native chrome:// pages. rAF so
      // it runs after layout + the rest of mount; fall back to the raw input if searchBox returns no API.
      requestAnimationFrame(function () {
        try {
          if (sb && typeof sb.focus === 'function') { sb.focus(); return; }
          var inp = filterHost.querySelector('input'); if (inp) inp.focus();
        } catch (e) {}
      });
    }
    // CRT scanlines via ZGui.crt — call with NO {on} so it RESPECTS the saved
    // pref (localStorage zguiCrt). Forcing {on:true} here re-enabled it on every
    // page load, so toggling it off never stuck. Toggle it from the ⌘K palette.
    try { if (ZGui.crt) crtCtl = ZGui.crt(); } catch (e) {}
    // Re-apply persisted cyberpunk FX prefs (CRT scanlines, bezel vignette, neon
    // glow, animations) so a toggle set on the Settings page sticks across pages.
    try { if (ZGui.fx) ZGui.fx.load(); } catch (e) {}
    // ⌘K / : command palette (ZGui.palette): cross-page nav + this page's
    // commands + every open tab (so it doubles as a tab switcher).
    if (ZGui.palette) {
      // Mirror light + fx state to chrome.storage (content-script surfaces read it)
      // and to the native file (newtab reads it), after any settings command.
      function mirrorUi() {
        try {
          var ui = {};
          if (ZGui.colorscheme && ZGui.colorscheme.isLight) ui.light = !!ZGui.colorscheme.isLight();
          if (ZGui.fx && ZGui.fx.all) { var a = ZGui.fx.all(); ui.scanlines = a.scanlines; ui.vignette = a.vignette; ui.glow = a.glow; ui.anim = a.anim; }
          chrome.storage.local.set({ zb_ui: ui });
          if (window.ZBHUD && ZBHUD.publishUi) ZBHUD.publishUi(ui);
        } catch (e) {}
      }
      function isLight() { try { return !!(ZGui.colorscheme && ZGui.colorscheme.isLight && ZGui.colorscheme.isLight()); } catch (e) { return false; } }
      function fxState(n) { try { return !!(ZGui.fx && ZGui.fx.get && ZGui.fx.get(n)); } catch (e) { return false; } }
      function fxCmd(name, label, icon) { return { icon: icon, label: label + '  (' + (fxState(name) ? 'on' : 'off') + ')', hint: 'setting', run: function () { try {
        if (ZGui.fx) ZGui.fx.toggle(name);
        var on = fxState(name);
        // Bridge the CSS-class fx to the actual overlay layers (same as the
        // Settings effects card): fx.toggle only flips a body class, but the CRT
        // beam (ZGui.crt) and neon glow (ZGui.neonGlow) are separate layers — so
        // without this, "scanlines"/"glow" never visibly turned off from ⌘K.
        if (name === 'scanlines' && crtCtl && crtCtl.set) crtCtl.set(on);
        if (name === 'glow' && ZGui.neonGlow && ZGui.neonGlow.set) ZGui.neonGlow.set(on);
        mirrorUi();
      } catch (e) {} } }; }
      var SCHEMES = [['cyberpunk', 'Cyberpunk'], ['midnight', 'Midnight'], ['matrix', 'Matrix'], ['ember', 'Ember'], ['arctic', 'Arctic'], ['crimson', 'Crimson'], ['toxic', 'Toxic'], ['vapor', 'Vapor']];
      var hudCmds = [
        { icon: '◐', label: 'Toggle light mode  (' + (isLight() ? 'on' : 'off') + ')', hint: 'setting', run: function () { try { if (ZGui.colorscheme && ZGui.colorscheme.setLight) { ZGui.colorscheme.setLight(!isLight()); mirrorUi(); } } catch (e) {} } },
        fxCmd('scanlines', 'Toggle CRT scanlines', '⌂'),
        fxCmd('vignette', 'Toggle bezel vignette', '▣'),
        fxCmd('glow', 'Toggle neon glow', '✦'),
        fxCmd('anim', 'Toggle animations', '⚡'),
        { icon: '▤', label: 'Toggle status bar (tmux/session powerline)', hint: 'setting', run: function () { try { chrome.storage.local.get('zb_status', function (o) { void chrome.runtime.lastError; chrome.storage.local.set({ zb_status: (o && o.zb_status === false) }); }); } catch (e) {} } },
        { icon: '⚙', label: 'Open Settings page', hint: 'setting', run: function () { go('settings.html'); } }
      ].concat(SCHEMES.map(function (s) {
        return { icon: '◈', label: 'Scheme: ' + s[1], hint: 'theme', run: function () { try { if (ZGui.colorscheme && ZGui.colorscheme.apply) ZGui.colorscheme.apply(s[0]); } catch (e) {} } };
      }));
      // zpwrchrome's tool pages — from the SHARED palette-cmds.js, so this HUD-page
      // palette lists the exact same zpwrchrome rows as the web-page (zpalette),
      // New Tab and zpwrchrome palettes. This is an extension page → open directly.
      var zpwrItems = (window.ZWIRE_PALETTE_CMDS && window.ZWIRE_PALETTE_CMDS.makeZpwrItems)
        ? window.ZWIRE_PALETTE_CMDS.makeZpwrItems(function (url) { try { chrome.tabs.create({ url: url }); } catch (e) {} })
        : [];
      var pageItems = hudCmds.concat(paletteNav()).concat(zpwrItems).concat(opts.palette || []);
      var openPal = function () {
        // open synchronously with nav commands (nav always works); append tabs after.
        try { ZGui.palette.clear(); ZGui.palette.register(pageItems); ZGui.palette.open(); } catch (e) {}
        try { chrome.storage.local.get('zb_custom_cmds', function (o) { void chrome.runtime.lastError; try {
          var all = (o && o.zb_custom_cmds) || [], userCmds = [], defCmds = [];
          all.forEach(function (e) { (isDefaultCmd(e) ? defCmds : userCmds).push(e); });
          if (ZGui.palette.setUserItems) ZGui.palette.setUserItems(bootCustomItems(userCmds));
          else ZGui.palette.register(bootCustomItems(userCmds));
          ZGui.palette.register(bootCustomItems(defCmds));
          var ipc = document.querySelector('.palette-input'); if (ipc) ipc.dispatchEvent(new Event('input')); } catch (e) {} }); } catch (e) {}
        try { frecentItems(function (fi) { try { ZGui.palette.register(fi); var inp2 = document.querySelector('.palette-input'); if (inp2) inp2.dispatchEvent(new Event('input')); } catch (e) {} }); } catch (e) {}
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
        // extension option pages (tweak zpwrchrome etc.) via chrome.management.
        try {
          if (chrome.management) chrome.management.getAll(function (exts) {
            void chrome.runtime.lastError;
            try {
              (exts || []).filter(function (e) { return e.type === 'extension' && e.enabled; }).forEach(function (e) {
                if (e.optionsUrl) ZGui.palette.register([{ icon: '⚙', label: 'Tweak: ' + e.name, detail: 'options', run: function () { chrome.tabs.create({ url: e.optionsUrl }); } }]);
                ZGui.palette.register([{ icon: '⬡', label: 'Manage: ' + e.name, detail: e.id, run: function () { chrome.tabs.create({ url: 'chrome://extensions/?id=' + e.id }); } }]);
              });
              var inp3 = document.querySelector('.palette-input'); if (inp3) inp3.dispatchEvent(new Event('input'));
            } catch (e) {}
          });
        } catch (e) {}
      };
      window.__zbPaletteOpen = openPal;
      // ⌘K arrives as a browser command routed by background.js (page keydown is
      // consumed once the command owns the key). Open on the visible HUD page.
      try {
        chrome.runtime.onMessage.addListener(function (msg) {
          if (msg && msg.type === 'zwireOpenPalette' && !document.hidden) {
            try { ZGui.palette.isOpen() ? ZGui.palette.close() : openPal(); } catch (e) {}
          }
        });
      } catch (e) {}
      document.addEventListener('keydown', function (e) {
        // ⌘/Ctrl-K toggles the palette. (The vim-style bare ':' palette shortcut was removed — it
        // stole the colon in the stryke code editor, where `::` / `1:10` / `key:` are everywhere.)
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.altKey && !e.shiftKey) {
          e.preventDefault(); ZGui.palette.isOpen() ? ZGui.palette.close() : openPal();
        }
      }, true);
    }
    bridge();
    return { body: main, el: app, filterHost: filterHost };
  }

  // Shared filter predicate for the HUD filter bar's regex toggle (ZGui.searchBox
  // emits {regex}). Substring (case-insensitive) when off; a case-insensitive
  // RegExp when on. Empty query matches all; an invalid regex matches nothing so
  // the bad pattern is visibly reflected. Consumers: matchFn = ZBHUD.matcher(q, rx).
  function matcher(query, regexOn) {
    query = (query == null ? '' : String(query)).trim();
    if (!query) return function () { return true; };
    if (regexOn) {
      var re = null; try { re = new RegExp(query, 'i'); } catch (e) { re = null; }
      if (!re) return function () { return false; };
      return function (t) { return re.test(t == null ? '' : String(t)); };
    }
    var lq = query.toLowerCase();
    return function (t) { return (t == null ? '' : String(t)).toLowerCase().indexOf(lq) >= 0; };
  }

  // Execute a browser.* action the host piggybacked on a stryke_run reply (reply.zbAction). We hand
  // it to the background worker through zb_cmd (the bus every build of the worker listens on) with a
  // unique _zbn per write so storage.onChanged fires every time. No kv round-trip — the action already
  // rode back with the run's reply, so delivery is as reliable as the run itself.
  // Shared by every HUD surface (palette in zg-boot, ▶ Run in commands) — one implementation.
  function runZbAction(a) {
    if (!a || !a.a) return;
    try {
      var q = {}; for (var k in a) { if (k !== '_n') q[k] = a[k]; }
      window.__zbSeq = (window.__zbSeq || 0) + 1;
      q._zbn = (a._n || 0) + ':' + window.__zbSeq;
      chrome.storage.local.set({ zb_cmd: q });
    } catch (e) {}
  }

  window.ZBHUD = { PAGES: PAGES, NATIVE_PAGES: NATIVE_PAGES, mount: mount, go: go,
    navButton: navButton, HOST: HOST, publishUi: publishUi, matcher: matcher, runZbAction: runZbAction };
})();
