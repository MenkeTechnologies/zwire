/* zwire HUD — Custom Commands. Full CRUD for user-defined ⌘K palette entries.
 * Stored in chrome.storage.local 'zb_custom_cmds' (array). The global palette
 * (zpalette.js, on every web page) and the internal-page palette (zg-boot.js)
 * both read this key and register each entry — static items plus, in the global
 * palette, a keyword provider (`kw arg` → {q} in the value = the typed arg).
 * Every control is a ZGui.* widget per the zgui-core-only rule. */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };
  var KEY = 'zb_custom_cmds';
  var cmds = [];
  var editingId = null;
  var filter = '', matchFn = function () { return true; };
  // stryke steps use the shared Monaco editor (window.HooksEditor) with stryke-LSP
  // completion — same facade pages/hooks.js mounts. Native-host bridge for the LSP.
  var HOST = (window.ZBHUD && window.ZBHUD.HOST) || 'com.zwire.hud';
  var MODE_KEY = 'zw.hooks.editorMode';
  var _lspStarted = false, _lspPort = null, _strykeSeq = 0;
  // Page-global LSP status ('off'|'connecting'|'ready'|'error') mirrored onto every
  // stryke step's status pill, and the set of live Monaco editors so a mode change
  // applies to all of them at once (the Hooks-tab editor toolbar, one LSP per page).
  var _lspState = 'off', _lspPills = [], _strykeEditors = [], _modeSels = [];

  // AppleScript is macOS-only, batch is Windows-only — offer the one this OS can run.
  var _plat = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
  var IS_MAC = /mac|darwin/.test(_plat), IS_WIN = /win/.test(_plat);
  var TYPES = [
    { value: 'url', label: 'Open URL' },
    { value: 'shell', label: 'Run shell command' },
    { value: 'stryke', label: 'Run stryke script' },
    { value: 'js', label: 'Run JavaScript' }
  ]
    .concat(IS_MAC ? [{ value: 'applescript', label: 'Run AppleScript (macOS)' }] : [])
    .concat(IS_WIN ? [{ value: 'batch', label: 'Run batch script (Windows)' }] : [])
    .concat([
      { value: 'action', label: 'Browser action' },
      { value: 'scheme', label: 'Set color scheme' },
      { value: 'host', label: 'zwire-host (JSON)' }
    ]);
  var TYPE_LABEL = { url: 'open url', shell: 'shell', stryke: 'stryke', js: 'javascript', applescript: 'applescript', batch: 'batch', action: 'action', scheme: 'scheme', host: 'host' };
  var ACTIONS = [
    ['newTab', 'New tab'], ['newWindow', 'New window'], ['duplicateTab', 'Duplicate tab'],
    ['reopenTab', 'Reopen closed tab'], ['closeTab', 'Close tab'], ['closeOthers', 'Close other tabs'],
    ['nextTab', 'Next tab'], ['prevTab', 'Previous tab'], ['pinTab', 'Pin / unpin tab'],
    ['muteTab', 'Mute / unmute tab'], ['reload', 'Reload page'], ['copyUrl', 'Copy URL'],
    ['cycleScheme', 'Cycle color scheme'], ['toggleTerminal', 'Toggle terminal'],
    ['toggleStatusbar', 'Toggle HUD statusbar']
  ];
  var SCHEMES = [['cyberpunk', 'Cyberpunk'], ['midnight', 'Midnight'], ['matrix', 'Matrix'],
    ['ember', 'Ember'], ['arctic', 'Arctic'], ['crimson', 'Crimson'], ['toxic', 'Toxic'], ['vapor', 'Vapor']];
  var HINTS = {
    url: 'A URL to open. Use {q} as a placeholder and give it a keyword to make it a search — e.g. keyword "jira", value https://jira/browse/{q}.',
    shell: 'Runs via zwire-host in the OS shell (cmd.exe on Windows, /bin/sh -c on macOS/Linux) and toasts the output — no terminal needed. {q} = the typed argument; otherwise the argument is appended.',
    stryke: 'Runs an inline stryke script via zwire-host (stryke -E) using the bundled stryke sidecar — no PATH needed — and toasts stdout. Print with `p`. {q} = the typed argument; otherwise it is appended.',
    js: 'JavaScript run in a sandboxed iframe (MV3 CSP forbids eval elsewhere) — has window/eval and can alert(), but no chrome.* and no host-page DOM. The variable `q` holds the typed argument.',
    applescript: 'Runs via zwire-host through osascript (macOS only) — each line becomes an -e arg, so multi-line scripts work with no temp file. {q} = the typed argument. E.g. tell application "Music" to playpause, or display notification "{q}".',
    batch: 'Runs via zwire-host through cmd.exe /c (Windows only) and toasts the output. {q} = the typed argument. E.g. echo hi {q} & start "" .',
    action: 'Trigger a built-in browser action under your own name.',
    scheme: 'Switch the whole browser color scheme.',
    host: 'Sends a JSON message to zwire-host and shows the reply. Use {q} for the typed argument — e.g. {"cmd":"notify","title":"{q}"} or {"cmd":"exec","argv":["say","{q}"]}. See the HOST tab to explore commands.'
  };

  // A command is a CHAIN of typed steps run top-to-bottom (like the app-shell
  // custom-command wizard). entrySteps() normalises either the new steps[] array
  // or a legacy single {type,value} (shipped defaults) into one step list.
  function entrySteps(e) {
    if (e && Array.isArray(e.steps)) return e.steps.map(function (s) { return { type: s.type, value: s.value }; });
    if (e && e.type) return [{ type: e.type, value: e.value }];
    return [];
  }
  function stepsSummary(e) {
    var st = entrySteps(e);
    if (!st.length) return 'empty';
    return st.map(function (s) { return TYPE_LABEL[s.type] || s.type; }).join(' → ');
  }

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function opt(pairs) { return pairs.map(function (p) { return { value: p[0], label: p[1] }; }); }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  // ZGui.toast is an object ({show,history,…}) — NOT callable. Route through
  // .show(msg, dur, type) so error/success toasts actually render (a bare
  // Z.toast(m) threw and got swallowed, so no toast ever appeared here).
  function toast(m, type) { try { if (Z.toast && Z.toast.show) Z.toast.show(m, 2600, type || ''); else if (window.showToast) window.showToast(m); } catch (e) {} }
  // Execute a browser.* action the host piggybacked on a stryke_run reply (shared impl in zg-boot).
  function runZbAction(a) { try { if (a && window.ZBHUD && window.ZBHUD.runZbAction) window.ZBHUD.runZbAction(a); } catch (e) {} }
  function persist(cb) {
    try { var o = {}; o[KEY] = cmds; chrome.storage.local.set(o, function () { void chrome.runtime.lastError; if (cb) cb(); }); }
    catch (e) { if (cb) cb(); }
  }

  injectCss();
  var shell = window.ZBHUD.mount({
    title: 'COMMANDS', current: 'commands.html', filterPlaceholder: '>_ filter commands…',
    onFilter: function (v, rx) { matchFn = window.ZBHUD.matcher(v, rx); drawTable(); }
  });
  var body = shell.body;

  /* ---- form ---- */
  var labelF = Z.textfield({ placeholder: 'Deploy prod' });
  var iconF = Z.textfield({ placeholder: '✦' });
  var detailF = Z.textfield({ placeholder: 'optional subtitle' });
  var keywordF = Z.textfield({ placeholder: 'deploy   (⌘K alias)' });
  var saveBtn = Z.button({ label: 'ADD COMMAND', variant: 'primary', onClick: submit });
  var cancelBtn = Z.button({ label: 'CANCEL', variant: 'mini', onClick: resetForm });
  cancelBtn.style.display = 'none';

  // ---- the step wizard: a command is a chain of typed steps run top-to-bottom.
  // `steps` is the live model; `stepCtls` holds each row's zgui controls so we can
  // read edits back (syncSteps) before any structural change redraws the list.
  var steps = [];
  var stepCtls = [];
  var stepsHost = el('div', 'zb-cmd-steps');

  // Editor keybinding mode (Default / Vim / Emacs), shared with the Hooks tab via
  // the same localStorage key so the choice is consistent across both editors.
  function getEditorMode() { try { return localStorage.getItem(MODE_KEY) || 'default'; } catch (e) { return 'default'; } }
  function storeEditorMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }
  function applyModeAll(m) {
    _strykeEditors.forEach(function (h) { if (h && h.setMode) { try { h.setMode(m); } catch (e) {} } });
    // Keep every stryke step's Mode select in sync (one page-wide keybinding choice).
    _modeSels.forEach(function (s) { if (s && s.get && s.get() !== m && s.set) { try { s.set(m); } catch (e) {} } });
  }
  // stryke-LSP status pill (○ connecting / ● ready / ○ unavailable). Same states +
  // text as pages/hooks.js. Stored globally and painted onto every live pill so a
  // pill created after the handshake still shows the current state.
  var LSP_TEXT = { off: '○ LSP off', connecting: '○ connecting…', ready: '● stryke LSP', error: '○ LSP unavailable' };
  function paintPill(pill, state) {
    if (!pill) return;
    pill.textContent = LSP_TEXT[state] || LSP_TEXT.off;
    pill.className = 'zb-lsp' + (state === 'ready' ? ' ok' : state === 'error' ? ' bad' : '');
  }
  function setLspStatus(state) {
    _lspState = state;
    _lspPills.forEach(function (p) { paintPill(p, state); });
  }
  // Start the stryke language server once and wire it to the shared Monaco
  // HooksEditor LSP client so the stryke step editors get completion/hover/
  // diagnostics. Mirrors pages/hooks.js: one connectNative owns one `stryke --lsp`;
  // framed replies arrive as {ev:'stryke-lsp-rx', message}; we send via stryke_lsp_send.
  function ensureLsp() {
    if (_lspStarted || !window.HooksEditor) return;
    setLspStatus('connecting');
    try {
      _lspPort = chrome.runtime.connectNative(HOST);
      _lspPort.onMessage.addListener(function (m) {
        if (!m) return;
        if (m.ev === 'stryke-lsp-rx' && typeof m.message === 'string') {
          try { window.HooksEditor.receive(m.message); } catch (e) {}
        } else if (m.ev === 'stryke-lsp-exit') {
          setLspStatus('error');
        }
      });
      _lspPort.onDisconnect.addListener(function () { _lspStarted = false; _lspPort = null; setLspStatus('error'); });
      _lspPort.postMessage({ id: 'lsp', cmd: 'stryke_lsp_start' });
      window.HooksEditor.initClient(function (message) {
        try { if (_lspPort) _lspPort.postMessage({ cmd: 'stryke_lsp_send', message: message }); } catch (e) {}
      });
      _lspStarted = true;
      // Green only once stryke answers `initialize` (not just on spawn).
      if (typeof window.HooksEditor.whenReady === 'function') {
        window.HooksEditor.whenReady().then(function (ok) { setLspStatus(ok ? 'ready' : 'error'); });
      } else {
        setLspStatus('ready');
      }
    } catch (e) { setLspStatus('error'); /* LSP is optional — the editor still works without it */ }
  }
  // A stryke/JS step's value control is the shared Monaco editor, not a plain
  // textarea. Both carry the Hooks-tab toolbar (Mode select + vim/emacs status);
  // stryke additionally shows the LSP status pill and gets completion from the
  // stryke LSP, while JS gets IntelliSense from Monaco's built-in TS language
  // service (HooksEditor.createPlain). Degrades to a textarea when the editor bundle
  // (or, for JS, createPlain) is absent — source-only checkout / stale bundle.
  // Returns a zgui-shaped control { el, get(), _dispose() }; _dispose tears down the
  // Monaco instance so a steps redraw doesn't leak editors or collide model URIs.
  function makeMonacoControl(kind, val) {
    var isStryke = kind === 'stryke';
    var isOsa = kind === 'applescript';
    var isBat = kind === 'batch';
    var isSh = kind === 'shell';
    var LANG = { js: 'javascript', applescript: 'plaintext', batch: 'bat', shell: 'shell' };  // Monaco has no AppleScript grammar; 'bat' for batch, 'shell' for sh
    var EXT = { js: '.js', applescript: '.applescript', batch: '.bat', shell: '.sh' };
    var placeholder = isStryke ? 'p "hello {q}"   # stryke — print with p, {q} = arg'
      : isOsa ? 'tell application "Music" to playpause   -- {q} = arg'
      : isBat ? 'echo hi {q} & start "" .   :: {q} = arg'
      : isSh ? 'git status   # {q} = arg (else appended); runs in the OS shell via zwire-host'
      : "alert('hi ' + q + '!')";
    var canEdit = window.HooksEditor && typeof window.HooksEditor.create === 'function' &&
      (isStryke || typeof window.HooksEditor.createPlain === 'function');
    if (!canEdit) return Z.textarea({ placeholder: placeholder, rows: 4, value: val || '' });
    if (isStryke) ensureLsp();
    var wrap = el('div', 'zb-chain-ed');
    // Toolbar: Mode select (+ LSP status pill for stryke), matching the Hooks tab.
    var bar = el('div', 'zb-chain-edbar');
    bar.appendChild(el('span', 'zb-chain-edlbl', 'Mode'));
    var modeSel = Z.select({
      options: [{ value: 'default', label: 'Default' }, { value: 'vim', label: 'Vim' }, { value: 'emacs', label: 'Emacs' }],
      value: getEditorMode(),
      onChange: function () { var m = modeSel.get(); storeEditorMode(m); applyModeAll(m); }
    });
    modeSel.el.title = 'Editor keybindings';
    _modeSels.push(modeSel);
    bar.appendChild(modeSel.el);
    var pill = null;
    if (isStryke) {
      pill = el('span', 'zb-lsp'); pill.title = 'stryke language server';
      paintPill(pill, _lspState); _lspPills.push(pill);
      bar.appendChild(pill);
      // ▶ Run — execute THIS editor's stryke buffer now via the host runner (bundled stryke + App),
      // toast stdout/stderr. Lets you test an App::open("zwire") script without saving it as a command.
      var runBtn = Z.button({ label: '▶ Run', variant: 'primary', onClick: function () {
        var code = handle.getValue() || '';
        if (!code.trim()) { toast('nothing to run', 'error'); return; }
        runBtn.disabled = true;
        chrome.runtime.sendNativeMessage(HOST, { cmd: 'stryke_run', code: code }, function (reply) {
          runBtn.disabled = false;
          // Fire the browser.* action the host piggybacked on the reply (reply.zbAction). Writing zb_cmd
          // wakes the background worker and its onChanged executor runs it — no separate kv round-trip.
          if (reply && reply.zbAction) runZbAction(reply.zbAction);
          if (chrome.runtime.lastError) { toast('run: ' + chrome.runtime.lastError.message, 'error'); return; }
          var r = reply || {};
          if (r.ok === false) { toast('stryke: ' + (r.err || 'failed'), 'error'); return; }
          var out = (r.stdout || '').trim(), er = (r.stderr || '').trim();
          var bad = (r.code != null && r.code !== 0) || r.timedOut;
          toast('▶ ' + (out || er || (bad ? 'exit ' + r.code : 'ok ✓')).slice(0, 220), bad ? 'error' : 'success');
        });
      }});
      runBtn.title = 'Run this stryke script now';
      bar.appendChild(runBtn);
      // ≡ Actions — the zwire automation surface (App::open("zwire")->verbs()), searchable,
      // click-to-insert `App::open("zwire")->call("verb", {})`. Fetched live through the host's
      // stryke runner (uses the bundled stryke + App package). Mirrors the Tauri GUI Scripts editor.
      var actBtn = Z.button({ label: '≡ Actions', variant: 'mini', onClick: function () {
        chrome.runtime.sendNativeMessage(HOST, { cmd: 'stryke_run',
          code: 'use App\nprint to_json(App::open("zwire")->verbs())' }, function (reply) {
          if (chrome.runtime.lastError) { toast('actions: ' + chrome.runtime.lastError.message, 'error'); return; }
          var verbs = [];
          try { verbs = (JSON.parse(((reply && reply.stdout) || '').trim()) || {}).verbs || []; } catch (e) {}
          if (!verbs.length) { toast('no actions — is zwire running (host reachable)?', 'error'); return; }
          showActions(verbs);
        });
      }});
      actBtn.title = 'Insert an App::open("zwire") call';
      bar.appendChild(actBtn);
    }
    // Self-contained searchable popup of the zwire bus verbs (inline styles — extension pages allow
    // them, unlike Tauri release CSP). Click a row to append the call to this editor.
    function showActions(verbs) {
      var old = wrap.querySelector('.zb-actpop'); if (old) old.remove();
      var pop = el('div', 'zb-actpop');
      pop.style.cssText = 'position:absolute;top:34px;right:6px;z-index:1000;background:#0a0e16;border:1px solid #22384d;border-radius:6px;padding:6px;max-height:300px;overflow:auto;width:340px;box-shadow:0 10px 30px rgba(0,0,0,.6);';
      var search = el('input');
      search.placeholder = 'Filter ' + verbs.length + ' actions…'; search.spellcheck = false;
      search.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:6px;background:#050810;border:1px solid #22384d;color:#9fe;padding:5px 8px;border-radius:4px;font:12px ui-monospace,monospace;';
      var list = el('div');
      function draw(q) {
        list.innerHTML = '';
        verbs.filter(function (v) { return !q || String(v.id).toLowerCase().indexOf(q) >= 0; }).slice(0, 300).forEach(function (v) {
          var row = el('div', null, v.id);
          row.style.cssText = 'padding:4px 8px;cursor:pointer;color:#7fe6c0;font:12px ui-monospace,monospace;border-radius:4px;';
          row.addEventListener('mouseenter', function () { row.style.background = '#12233a'; });
          row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });
          row.addEventListener('click', function () {
            var cur = handle.getValue() || '';
            var needsUse = !/^\s*use\s+App\b/m.test(cur);
            var snippet = (needsUse ? 'use App\n' : '') + 'App::open("zwire")->call("' + v.id + '", {})\n';
            if (typeof handle.setValue === 'function') {
              handle.setValue(cur + (cur && cur.charAt(cur.length - 1) !== '\n' ? '\n' : '') + snippet);
            }
            pop.remove();
          });
          list.appendChild(row);
        });
        if (!list.children.length) { var e2 = el('div', null, 'no match'); e2.style.cssText = 'padding:4px 8px;color:#567;font:12px monospace;'; list.appendChild(e2); }
      }
      search.addEventListener('input', function () { draw(search.value.toLowerCase()); });
      search.addEventListener('keydown', function (e) { if (e.key === 'Escape') pop.remove(); });
      pop.appendChild(search); pop.appendChild(list); draw('');
      wrap.style.position = 'relative';
      wrap.appendChild(pop);
      search.focus();
    }
    var mount = el('div', 'zb-chain-monaco');
    var vimStatus = el('div', 'zb-chain-vim');
    wrap.appendChild(bar); wrap.appendChild(mount); wrap.appendChild(vimStatus);
    // Unique in-memory doc URI per editor — Monaco models must not collide. For
    // stryke the LSP opens each as its own buffer; for JS the URI just names the
    // TS-service model. Not a real file.
    var uri = 'file:///zwire/commands/step-' + (++_strykeSeq) + (isStryke ? '.stryke' : (EXT[kind] || '.js'));
    var handle = isStryke
      ? window.HooksEditor.create(mount, { uri: uri, doc: val || '', mode: getEditorMode(), statusBar: vimStatus })
      : window.HooksEditor.createPlain(mount, { language: LANG[kind] || 'javascript', uri: uri, doc: val || '', mode: getEditorMode(), statusBar: vimStatus });
    _strykeEditors.push(handle);
    return {
      el: wrap,
      get: function () { return handle.getValue(); },
      _dispose: function () {
        var i = _strykeEditors.indexOf(handle); if (i >= 0) _strykeEditors.splice(i, 1);
        var j = pill ? _lspPills.indexOf(pill) : -1; if (j >= 0) _lspPills.splice(j, 1);
        var k = _modeSels.indexOf(modeSel); if (k >= 0) _modeSels.splice(k, 1);
        try { handle.destroy(); } catch (e) {}
      }
    };
  }

  // One value control for a step of a given type — a ZGui widget with .el + .get().
  function makeValueControl(type, val) {
    if (type === 'action') return Z.select({ options: opt(ACTIONS), value: val || 'newTab' });
    if (type === 'scheme') return Z.select({ options: opt(SCHEMES), value: val || 'cyberpunk' });
    if (type === 'js') return makeMonacoControl('js', val);
    if (type === 'stryke') return makeMonacoControl('stryke', val);
    if (type === 'applescript') return makeMonacoControl('applescript', val);
    if (type === 'batch') return makeMonacoControl('batch', val);
    if (type === 'shell') return makeMonacoControl('shell', val);
    if (type === 'host') return Z.textarea({ placeholder: '{"cmd":"notify","title":"hi {q}"}', rows: 3, value: val || '' });
    return Z.textfield({ placeholder: 'https://example.com   ({q} optional)', value: val || '' });
  }
  // Pull each row's current type + value back into the `steps` model. Must run
  // before any splice/reorder/type-change so a redraw doesn't lose typed text.
  function syncSteps() {
    stepCtls.forEach(function (c, i) {
      if (!c || !steps[i]) return;
      steps[i].type = c.tSel.get();
      steps[i].value = c.valCtl && c.valCtl.get ? String(c.valCtl.get()) : '';
    });
  }
  function stepRow(step, i) {
    var rEl = el('div', 'zb-chain-step');
    var head = el('div', 'zb-chain-head');
    var numEl = el('span', 'zb-chain-num', (i + 1) + '.');
    var valHost = el('div', 'zb-chain-valhost');
    var valCtl = makeValueControl(step.type || 'url', step.value || '');
    valHost.appendChild(valCtl.el);
    // Each STEP owns a type dropdown (this is the app-shell wizard). Changing the
    // type clears the value and re-renders the matching control + hint.
    var tSel = Z.select({ options: TYPES, value: step.type || 'url', onChange: function () {
      syncSteps(); step.type = tSel.get(); step.value = ''; drawSteps();
    } });
    var ctrls = el('div', 'zb-chain-ctrls');
    var up = Z.button({ label: '↑', variant: 'mini', onClick: function () { if (i > 0) { syncSteps(); var t = steps[i - 1]; steps[i - 1] = steps[i]; steps[i] = t; drawSteps(); } } });
    var down = Z.button({ label: '↓', variant: 'mini', onClick: function () { if (i < steps.length - 1) { syncSteps(); var t = steps[i + 1]; steps[i + 1] = steps[i]; steps[i] = t; drawSteps(); } } });
    var del = Z.button({ label: '✕', variant: 'danger', onClick: function () { syncSteps(); steps.splice(i, 1); drawSteps(); } });
    up.classList.add('zb-chain-mini'); down.classList.add('zb-chain-mini'); del.classList.add('zb-chain-mini');
    ctrls.appendChild(up); ctrls.appendChild(down); ctrls.appendChild(del);
    head.appendChild(numEl); head.appendChild(tSel.el); head.appendChild(valHost); head.appendChild(ctrls);
    rEl.appendChild(head);
    rEl.appendChild(el('div', 'zb-cmd-hint zb-chain-help', HINTS[step.type] || ''));
    stepCtls[i] = { tSel: tSel, valCtl: valCtl };
    return rEl;
  }
  // Tear down any Monaco (stryke) editors before a redraw so they don't leak or
  // collide model URIs. Callers already syncSteps() first, so values are captured.
  function disposeStepEditors() {
    stepCtls.forEach(function (c) {
      if (c && c.valCtl && typeof c.valCtl._dispose === 'function') { try { c.valCtl._dispose(); } catch (e) {} }
    });
  }
  function drawSteps() {
    disposeStepEditors();
    stepsHost.innerHTML = ''; stepCtls = [];
    if (!steps.length) { stepsHost.appendChild(el('div', 'zb-cmd-hint', 'No steps yet. Add one — steps run top to bottom.')); return; }
    steps.forEach(function (s, i) { stepsHost.appendChild(stepRow(s, i)); });
  }
  function addStep(step, silent) {
    syncSteps();
    steps.push(step || { type: 'url', value: '' });
    drawSteps();
    if (!silent) toast('Step added', 'success');
  }
  var addStepBtn = Z.button({ label: '＋ ADD STEP', variant: 'mini', onClick: function () { addStep(); } });
  addStepBtn.classList.add('zb-chain-add');

  function field(label, ctlEl, req) { return Z.field({ label: label, control: ctlEl, required: !!req }).el; }

  // Icon field = the text input plus a "pick" button that opens zgui-core's
  // emoji icon library (ZGui.iconPicker). Typing a glyph directly still works,
  // so it degrades gracefully if the picker script isn't present.
  function iconControl() {
    if (!(Z.iconPicker && typeof Z.iconPicker.open === 'function')) return iconF.el;
    var pick = el('button', 'zs-btn zb-cmd-iconpick', '▾'); pick.type = 'button'; pick.title = 'Choose icon';
    pick.addEventListener('click', function () {
      Z.iconPicker.open({ current: (iconF.get() || '').trim(), onPick: function (g) { iconF.set(g); } });
    });
    var wrap = el('div', 'zb-cmd-iconwrap'); wrap.appendChild(iconF.el); wrap.appendChild(pick);
    return wrap;
  }

  function row(cells) { var r = el('div', 'zb-cmd-row'); cells.forEach(function (c) { r.appendChild(c); }); return r; }

  function buildForm() {
    steps = [{ type: 'url', value: '' }]; drawSteps();
    var grid = el('div', 'zb-cmd-form');
    // Label grows, Icon is a narrow fixed field (it holds one glyph + picker).
    var labelWrap = field('Label', labelF.el, true); labelWrap.className += ' zb-cmd-grow';
    var iconWrap = field('Icon', iconControl()); iconWrap.className += ' zb-cmd-iconfield';
    grid.appendChild(row([labelWrap, iconWrap]));
    // Keyword + Detail: two equal halves.
    var kwWrap = field('Keyword', keywordF.el, true); kwWrap.className += ' zb-cmd-grow';
    var detWrap = field('Detail', detailF.el); detWrap.className += ' zb-cmd-grow';
    grid.appendChild(row([kwWrap, detWrap]));
    // Steps wizard: the command's chain of typed steps, each with its own type
    // dropdown + value control + reorder/remove, then a "＋ ADD STEP" button.
    var stepsWrap = el('div');
    stepsWrap.appendChild(Z.field({ label: 'Steps', control: stepsHost, required: true }).el);
    stepsWrap.appendChild(addStepBtn);
    grid.appendChild(stepsWrap);
    var bar = el('div', 'zb-cmd-actions');
    bar.appendChild(saveBtn); bar.appendChild(cancelBtn);
    var wrap = el('div');
    wrap.appendChild(el('div', 'set-h', '// NEW COMMAND'));
    wrap.appendChild(grid); wrap.appendChild(bar);
    return Z.card({ body: wrap }).el;
  }

  function submit() {
    var label = (labelF.get() || '').trim();
    if (!label) { toast('Label is required', 'error'); return; }
    var keyword = (keywordF.get() || '').trim().toLowerCase().split(/\s+/)[0] || '';
    if (!keyword) { toast('Keyword is required', 'error'); return; }
    syncSteps();
    // Drop empty rows; action/scheme steps carry a select value so they're always valid.
    var clean = steps.map(function (s) { return { type: s.type, value: String(s.value == null ? '' : s.value) }; })
      .filter(function (s) { return s.value.trim() !== '' || s.type === 'action' || s.type === 'scheme'; });
    if (!clean.length) { toast('Add at least one step', 'error'); return; }
    for (var h = 0; h < clean.length; h++) {
      if (clean[h].type === 'host') { try { JSON.parse(String(clean[h].value).replace(/\{q\}/g, '')); } catch (e) { toast('Step ' + (h + 1) + ': host value must be valid JSON', 'error'); return; } }
    }
    var wasEdit = !!editingId;
    var entry = {
      id: editingId || uid(),
      icon: (iconF.get() || '').trim().slice(0, 3),
      label: label,
      detail: (detailF.get() || '').trim(),
      keyword: keyword,
      steps: clean
    };
    // No two commands may share a keyword — a duplicate would make `kw` in ⌘K
    // ambiguous. Reject and point at the existing owner.
    if (entry.keyword) {
      var dup = null;
      for (var d = 0; d < cmds.length; d++) {
        if (cmds[d].id !== entry.id && (cmds[d].keyword || '').toLowerCase() === entry.keyword) { dup = cmds[d]; break; }
      }
      if (dup) { toast('Keyword "' + entry.keyword + '" is already used by "' + dup.label + '"', 'error'); return; }
    }
    // No two commands may share a label either — duplicates make the ⌘K list
    // ambiguous (two identical rows). Reject and point at the existing owner.
    var dupLabel = null;
    for (var L = 0; L < cmds.length; L++) {
      if (cmds[L].id !== entry.id && (cmds[L].label || '').trim().toLowerCase() === entry.label.toLowerCase()) { dupLabel = cmds[L]; break; }
    }
    if (dupLabel) { toast('A command labelled "' + entry.label + '" already exists', 'error'); return; }
    if (wasEdit) { for (var i = 0; i < cmds.length; i++) { if (cmds[i].id === editingId) { cmds[i] = entry; break; } } }
    else cmds.push(entry);
    persist(); resetForm(); drawTable(); toast(wasEdit ? 'Updated' : 'Added', 'success');
  }

  function startEdit(row) {
    editingId = row.id;
    labelF.set(row.label || ''); iconF.set(row.icon || ''); detailF.set(row.detail || '');
    keywordF.set(row.keyword || '');
    steps = entrySteps(row); if (!steps.length) steps = [{ type: 'url', value: '' }];
    drawSteps();
    saveBtn.textContent = 'UPDATE'; cancelBtn.style.display = '';
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function resetForm() {
    editingId = null;
    labelF.set(''); iconF.set(''); detailF.set(''); keywordF.set('');
    steps = [{ type: 'url', value: '' }]; drawSteps();
    saveBtn.textContent = 'ADD COMMAND'; cancelBtn.style.display = 'none';
  }
  function removeEntry(row) {
    cmds = cmds.filter(function (c) { return c.id !== row.id; });
    if (editingId === row.id) resetForm();
    // A deleted DEFAULT is remembered so the seeder won't re-add it next load.
    if (String(row.id).indexOf('def-') === 0) {
      try { chrome.storage.local.get('zb_cmds_removed', function (o) { void chrome.runtime.lastError; var r = (o && o.zb_cmds_removed) || []; if (r.indexOf(row.id) < 0) r.push(row.id); chrome.storage.local.set({ zb_cmds_removed: r }); }); } catch (e) {}
    }
    persist(); drawTable(); toast('Deleted', 'success');
  }

  /* ---- table ---- */
  var dt = null, tableHost = null, tableCard = null;
  function stepPreview(s) {
    if (s.type === 'action') { var a = ACTIONS.filter(function (x) { return x[0] === s.value; })[0]; return a ? a[1] : s.value; }
    if (s.type === 'scheme') { var sc = SCHEMES.filter(function (x) { return x[0] === s.value; })[0]; return sc ? sc[1] : s.value; }
    return s.value;
  }
  function valuePreview(row) {
    var st = entrySteps(row);
    if (st.length > 1) return st.length + ' steps: ' + st.map(stepPreview).join('  ▸  ');
    var s = st[0] || { type: 'url', value: '' };
    return stepPreview(s);
  }
  function columns() {
    return [
      { key: 'icon', label: '', width: '34px', render: function (r) { return esc(r.icon || '✦'); } },
      { key: 'label', label: 'Label', sortable: true, render: function (r) { return esc(r.label); } },
      { key: 'type', label: 'Type', sortable: true, render: function (r) { return esc(stepsSummary(r)); } },
      { key: 'keyword', label: 'Keyword', sortable: true, render: function (r) { return r.keyword ? '<code>' + esc(r.keyword) + '</code>' : '<span class="sub">—</span>'; } },
      { key: 'value', label: 'Value', render: function (r) { var v = String(valuePreview(r)); return '<span class="zb-cmd-val" title="' + esc(v) + '">' + esc(v.slice(0, 90)) + (v.length > 90 ? '…' : '') + '</span>'; } },
      { key: '_act', label: '', render: function (r) {
        var wrap = el('span', 'zb-cmd-rowact');
        wrap.appendChild(Z.button({ label: 'edit', variant: 'mini', onClick: function () { startEdit(r); } }));
        wrap.appendChild(Z.button({ label: 'delete', variant: 'danger', onClick: function () { removeEntry(r); } }));
        return wrap;
      } }
    ];
  }
  function rowsFiltered() {
    return cmds.filter(function (c) {
      var hay = c.label + ' ' + stepsSummary(c) + ' ' + entrySteps(c).map(function (s) { return s.value; }).join(' ') + ' ' + (c.keyword || '') + ' ' + (c.detail || '');
      return matchFn(hay);
    });
  }
  function drawTable() {
    var rows = rowsFiltered();
    if (!dt) {
      var inner = el('div');
      inner.appendChild(el('div', 'set-h', '// YOUR COMMANDS'));
      tableHost = el('div');
      inner.appendChild(tableHost);
      var empty = el('div', 'zb-cmd-empty ci-hint', 'No custom commands yet. Add one above — it shows up in ⌘K everywhere.');
      inner.appendChild(empty);
      tableCard = Z.card({ body: inner }).el;
      tableCard._empty = empty;
      body.appendChild(tableCard);
      dt = Z.dataTable(tableHost, { id: 'zb-cmds-table', columns: columns(), rows: rows, rowKey: function (r) { return r.id; }, sortScope: 'zb-cmds' });
    } else {
      dt.setRows(rows);
    }
    if (tableCard && tableCard._empty) tableCard._empty.style.display = rows.length ? 'none' : '';
    tableHost.style.display = rows.length ? '' : 'none';
  }

  function injectCss() {
    if (document.getElementById('zb-cmd-css')) return;
    var s = el('style'); s.id = 'zb-cmd-css';
    s.textContent = [
      '.zb-cmd-form{display:flex;flex-direction:column;gap:14px;margin:8px 0 14px;}',
      '.zb-cmd-row{display:flex;gap:18px;align-items:flex-start;}',
      '.zb-cmd-grow{flex:1 1 0;min-width:0;}',
      '.zb-cmd-iconfield{flex:0 0 150px;}',
      // zgui inputs default to the browser field width; make every control fill its field.
      '.zb-cmd-form input,.zb-cmd-form select,.zb-cmd-form textarea{width:100%;box-sizing:border-box;}',
      '.zb-cmd-hint{font-size:11px;color:var(--text-muted,var(--text-dim));margin-top:6px;line-height:1.5;}',
      '.zb-cmd-iconwrap{display:flex;gap:6px;align-items:stretch;}',
      '.zb-cmd-iconwrap>*:first-child{flex:1 1 auto;min-width:0;text-align:center;}',
      '.zb-cmd-iconpick{flex:0 0 36px;width:36px;padding:0;cursor:pointer;text-align:center;}',
      '.zb-cmd-actions{display:flex;gap:10px;}',
      '.zb-cmd-rowact{display:inline-flex;gap:6px;}',
      '.zb-cmd-val{font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;color:var(--text);}',
      '.zb-cmd-empty{padding:14px 4px;}',
      // step wizard: numbered rows of [type select | value | ↑ ↓ ✕], then ＋ ADD STEP.
      '.zb-cmd-steps{display:flex;flex-direction:column;gap:8px;}',
      '.zb-chain-step{padding:8px;border:1px solid var(--border,rgba(5,217,232,.25));border-radius:6px;background:rgba(5,217,232,.03);}',
      '.zb-chain-head{display:flex;gap:10px;align-items:flex-start;}',
      '.zb-chain-num{flex:0 0 20px;font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;color:var(--text-dim);padding-top:9px;}',
      '.zb-chain-head>select{flex:0 0 130px;}',
      '.zb-chain-valhost{flex:1 1 0;min-width:0;}',
      '.zb-chain-valhost input,.zb-chain-valhost select,.zb-chain-valhost textarea{width:100%;box-sizing:border-box;}',
      // stryke steps mount the Monaco editor with a toolbar (Mode select + LSP pill)
      // and a vim/emacs status line, matching the Hooks tab editor.
      '.zb-chain-ed{display:flex;flex-direction:column;gap:6px;}',
      '.zb-chain-edbar{display:flex;align-items:center;gap:8px;}',
      '.zb-chain-edlbl{font-size:11px;color:var(--text-dim);letter-spacing:.04em;}',
      '.zb-chain-edbar select{flex:0 0 auto;width:auto;min-width:96px;}',
      '.zb-lsp{margin-left:auto;font:10px/1 var(--mono,"Share Tech Mono",monospace);color:var(--text-muted,#3d4f6a);}',
      '.zb-lsp.ok{color:var(--green,#39ff14);}.zb-lsp.bad{color:var(--accent,#ff2a6d);}',
      // Monaco sizes to its container; automaticLayout handles width. overflow:hidden
      // so the editor chrome stays inside the rounded step card.
      '.zb-chain-monaco{height:200px;width:100%;box-sizing:border-box;border:1px solid var(--border,rgba(5,217,232,.25));border-radius:4px;overflow:hidden;}',
      '.zb-chain-vim{min-height:14px;font:10px/1.4 var(--mono,"Share Tech Mono",monospace);color:var(--text-dim,#8aa);}',
      '.zb-chain-ctrls{flex:0 0 auto;display:inline-flex;gap:4px;align-self:flex-start;}',
      '.zb-chain-mini{min-width:30px;padding-left:6px;padding-right:6px;}',
      '.zb-chain-help{margin-top:6px;}',
      '.zb-chain-add{align-self:flex-start;margin-top:2px;}',
      '@media(max-width:640px){.zb-cmd-row{flex-direction:column;}.zb-cmd-iconfield{flex-basis:auto;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- init ---- */
  body.appendChild(buildForm());
  // Seed the default registry once (page context — reliable storage write),
  // then draw. onDone gives the resulting list so we don't wait on a re-read.
  if (window.zwireSeedCmds) { window.zwireSeedCmds(function (list) { cmds = list || []; drawTable(); }); }
  else { try { chrome.storage.local.get(KEY, function (o) { void chrome.runtime.lastError; cmds = (o && o[KEY]) || []; drawTable(); }); } catch (e) { drawTable(); } }
  // live-refresh when the registry changes (e.g. the background seeds defaults
  // just after this page loaded, or an edit lands from another tab).
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch[KEY] && !editingId) { cmds = ch[KEY].newValue || []; drawTable(); } }); } catch (e) {}
})();
