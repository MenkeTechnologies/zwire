/* zwire HUD — shared step wizard. A "command" and a "trigger" are both a CHAIN of
 * typed steps (url / shell / stryke / js / applescript / batch / action / scheme /
 * host) run top-to-bottom. The editor for that chain — the numbered rows with a
 * type dropdown + value control (Monaco for stryke/js/shell/applescript/batch, with
 * the shared stryke-LSP), reorder/remove, and the ＋ ADD STEP button — lives here so
 * pages/commands.js and pages/triggers.js render the identical wizard rather than two
 * snowflake copies. The runtime side is shared too: zpalette.js exports the same
 * step executor (window.ZWIRE_CMD_EXEC) that runs these chains on a live page.
 *
 * Exposes window.ZwireStepWizard:
 *   .create(hostEl) -> instance { addBtn, set(steps), reset(), collect(), destroy() }
 *   .entrySteps(e), .stepsSummary(e), .stepPreview(s)  — for list/table rendering
 *   .TYPE_LABEL, .ACTIONS, .SCHEMES                     — shared label tables
 * Every control is a ZGui.* widget per the zgui-core-only rule. */
(function () {
  'use strict';
  var Z = window.ZGui || {};
  var HOST = (window.ZBHUD && window.ZBHUD.HOST) || 'com.zwire.hud';
  // Editor keybinding mode (Default / Vim / Emacs) is one page-wide choice, shared
  // with the Hooks tab via the same localStorage key so it stays consistent.
  var MODE_KEY = 'zw.hooks.editorMode';

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
      { value: 'suite', label: 'Call another app (bus)' },
      { value: 'assert', label: 'Assert the rendered page' },
      { value: 'witness', label: 'Witness a page premise' },
      { value: 'scheme', label: 'Set color scheme' },
      { value: 'host', label: 'zwire-host (JSON)' }
    ]);
  var TYPE_LABEL = { url: 'open url', shell: 'shell', stryke: 'stryke', js: 'javascript', applescript: 'applescript', batch: 'batch', action: 'action', suite: 'app', assert: 'assert', witness: 'premise', scheme: 'scheme', host: 'host' };
  // The postcondition step's vocabulary, mirrored from the host so the editor can offer it. The
  // host is authoritative — `page_states` returns both lists — and a value it does not know is
  // refused there, before the page is read.
  var ASSERT_OPS = ['contains', 'not_contains', 'equals', 'empty', 'nonempty', 'count_at_least', 'count_at_most'];
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
    url: 'A URL to open. Use {q} as a placeholder — for a command keyword, or a trigger, {q} is the matched text.',
    shell: 'Runs via zwire-host in the OS shell (cmd.exe on Windows, /bin/sh -c on macOS/Linux) and toasts the output — no terminal needed. {q} = the argument (typed keyword arg, or the trigger match).',
    stryke: 'Runs an inline stryke script via zwire-host (stryke -E) using the bundled stryke sidecar — no PATH needed — and toasts stdout. Print with `p`. {q} = the argument.',
    js: 'JavaScript run in a sandboxed iframe (MV3 CSP forbids eval elsewhere) — has window/eval and can alert(), but no chrome.* and no host-page DOM. The variable `q` holds the argument.',
    applescript: 'Runs via zwire-host through osascript (macOS only) — each line becomes an -e arg, so multi-line scripts work with no temp file. {q} = the argument. E.g. tell application "Music" to playpause, or display notification "{q}".',
    batch: 'Runs via zwire-host through cmd.exe /c (Windows only) and toasts the output. {q} = the argument. E.g. echo hi {q} & start "" .',
    action: 'Trigger a built-in browser action.',
    suite: 'Calls a typed verb on ANOTHER running MenkeTechnologies app over its bus socket (via zwire-host) and toasts the reply — e.g. {"app":"zcite","verb":"item.add","args":{"doi":"{q}"}}. {q} is spliced in JSON-escaped, so a quote or newline in the argument stays valid. The app must already be running; nothing is launched. Not revertible: the write happens in another process, so a self-reverting chain refuses it.',
    scheme: 'Switch the whole browser color scheme.',
    host: 'Sends a JSON message to zwire-host and shows the reply. Use {q} for the argument — e.g. {"cmd":"notify","title":"{q}"} or {"cmd":"exec","argv":["say","{q}"]}. See the HOST tab to explore commands.'
  };

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function opt(pairs) { return pairs.map(function (p) { return { value: p[0], label: p[1] }; }); }
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // Wizard styles (the numbered step rows + Monaco toolbar + LSP pill). Injected once
  // and shared by every page that hosts the wizard (Commands, Triggers).
  function injectCss() {
    if (document.getElementById('zb-stepwiz-css')) return;
    var s = el('style'); s.id = 'zb-stepwiz-css';
    s.textContent = [
      '.zb-cmd-hint{font-size:11px;color:var(--text-muted,var(--text-dim));margin-top:6px;line-height:1.5;}',
      '.zb-cmd-steps{display:flex;flex-direction:column;gap:8px;}',
      '.zb-chain-step{padding:8px;border:1px solid var(--border,rgba(5,217,232,.25));border-radius:6px;background:rgba(5,217,232,.03);}',
      '.zb-chain-head{display:flex;gap:10px;align-items:flex-start;}',
      '.zb-chain-num{flex:0 0 20px;font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;color:var(--text-dim);padding-top:9px;}',
      '.zb-chain-head>select{flex:0 0 130px;}',
      '.zb-chain-valhost{flex:1 1 0;min-width:0;}',
      '.zb-chain-valhost input,.zb-chain-valhost select,.zb-chain-valhost textarea{width:100%;box-sizing:border-box;}',
      '.zb-chain-ed{display:flex;flex-direction:column;gap:6px;}',
      '.zb-chain-edbar{display:flex;align-items:center;gap:8px;}',
      '.zb-chain-edlbl{font-size:11px;color:var(--text-dim);letter-spacing:.04em;}',
      '.zb-chain-edbar select{flex:0 0 auto;width:auto;min-width:96px;}',
      '.zb-lsp{margin-left:auto;font:10px/1 var(--mono,"Share Tech Mono",monospace);color:var(--text-muted,#3d4f6a);}',
      '.zb-lsp.ok{color:var(--green,#39ff14);}.zb-lsp.bad{color:var(--accent,#ff2a6d);}',
      '.zb-chain-monaco{height:200px;width:100%;box-sizing:border-box;border:1px solid var(--border,rgba(5,217,232,.25));border-radius:4px;overflow:hidden;}',
      '.zb-chain-vim{min-height:14px;font:10px/1.4 var(--mono,"Share Tech Mono",monospace);color:var(--text-dim,#8aa);}',
      '.zb-chain-ctrls{flex:0 0 auto;display:inline-flex;gap:4px;align-self:flex-start;}',
      '.zb-chain-mini{min-width:30px;padding-left:6px;padding-right:6px;}',
      '.zb-chain-help{margin-top:6px;}',
      '.zb-chain-add{align-self:flex-start;margin-top:2px;}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }
  function toast(m, type) { try { if (Z.toast && Z.toast.show) Z.toast.show(m, 2600, type || ''); } catch (e) {} }
  function runZbAction(a) { try { if (a && window.ZBHUD && window.ZBHUD.runZbAction) window.ZBHUD.runZbAction(a); } catch (e) {} }

  // A chain is either the new steps[] array or a legacy single {type,value} (shipped
  // defaults) — normalise to one step list.
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
  function stepPreview(s) {
    if (s.type === 'action') { var a = ACTIONS.filter(function (x) { return x[0] === s.value; })[0]; return a ? a[1] : s.value; }
    if (s.type === 'scheme') { var sc = SCHEMES.filter(function (x) { return x[0] === s.value; })[0]; return sc ? sc[1] : s.value; }
    if (s.type === 'assert') {
      // `page.text contains "Order confirmed"` reads as the condition it is; the JSON body does not.
      var ao; try { ao = JSON.parse(String(s.value || '').replace(/\{q\}/g, '')); } catch (e) { return s.value; }
      if (!ao || !ao.op) return s.value;
      return (ao.state || 'page.text') + ' ' + ao.op + (ao.value == null || ao.value === '' ? '' : ' "' + ao.value + '"');
    }
    if (s.type === 'witness') {
      // A premise with no op is the CONTENT form — "this projection must not change" — so the row
      // has to say `unchanged` rather than fall back to the raw JSON and look like a broken step.
      var wo; try { wo = JSON.parse(String(s.value || '').replace(/\{q\}/g, '')); } catch (e) { return s.value; }
      if (!wo) return s.value;
      var wstate = wo.state || 'page.text';
      if (!wo.op) return wstate + ' unchanged';
      return wstate + ' still ' + wo.op + (wo.value == null || wo.value === '' ? '' : ' "' + wo.value + '"');
    }
    if (s.type === 'suite') {
      // A row is far more readable as `zcite.item.add` than as the raw JSON body.
      var so; try { so = JSON.parse(String(s.value || '').replace(/\{q\}/g, '')); } catch (e) { return s.value; }
      return so && so.app ? so.app + '.' + (so.verb || '?') : s.value;
    }
    return s.value;
  }

  function getEditorMode() { try { return localStorage.getItem(MODE_KEY) || 'default'; } catch (e) { return 'default'; } }
  function storeEditorMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }

  // Each wizard instance owns its own LSP connection + live-editor/pill/mode-select
  // registries so two wizards on one page (there is only ever one today) stay isolated.
  function create(hostEl) {
    injectCss();
    var steps = [];
    var stepCtls = [];
    var stepsHost = hostEl || el('div', 'zb-cmd-steps');
    stepsHost.classList.add('zb-cmd-steps');

    var _lspStarted = false, _lspPort = null, _strykeSeq = 0;
    var _lspState = 'off', _lspPills = [], _strykeEditors = [], _modeSels = [];

    function applyModeAll(m) {
      _strykeEditors.forEach(function (h) { if (h && h.setMode) { try { h.setMode(m); } catch (e) {} } });
      _modeSels.forEach(function (s) { if (s && s.get && s.get() !== m && s.set) { try { s.set(m); } catch (e) {} } });
    }
    var LSP_TEXT = { off: '○ LSP off', connecting: '○ connecting…', ready: '● stryke LSP', error: '○ LSP unavailable' };
    function paintPill(pill, state) {
      if (!pill) return;
      pill.textContent = LSP_TEXT[state] || LSP_TEXT.off;
      pill.className = 'zb-lsp' + (state === 'ready' ? ' ok' : state === 'error' ? ' bad' : '');
    }
    function setLspStatus(state) { _lspState = state; _lspPills.forEach(function (p) { paintPill(p, state); }); }
    // Start the stryke language server once and wire it to the shared Monaco
    // HooksEditor LSP client so stryke step editors get completion/hover/diagnostics.
    // Mirrors pages/hooks.js: one connectNative owns one `stryke --lsp`.
    function ensureLsp() {
      if (_lspStarted || !window.HooksEditor) return;
      setLspStatus('connecting');
      try {
        _lspPort = chrome.runtime.connectNative(HOST);
        _lspPort.onMessage.addListener(function (m) {
          if (!m) return;
          if (m.ev === 'stryke-lsp-rx' && typeof m.message === 'string') {
            try { window.HooksEditor.receive(m.message); } catch (e) {}
          } else if (m.ev === 'stryke-lsp-exit') { setLspStatus('error'); }
        });
        _lspPort.onDisconnect.addListener(function () { _lspStarted = false; _lspPort = null; setLspStatus('error'); });
        _lspPort.postMessage({ id: 'lsp', cmd: 'stryke_lsp_start' });
        window.HooksEditor.initClient(function (message) {
          try { if (_lspPort) _lspPort.postMessage({ cmd: 'stryke_lsp_send', message: message }); } catch (e) {}
        });
        _lspStarted = true;
        if (typeof window.HooksEditor.whenReady === 'function') {
          window.HooksEditor.whenReady().then(function (ok) { setLspStatus(ok ? 'ready' : 'error'); });
        } else { setLspStatus('ready'); }
      } catch (e) { setLspStatus('error'); /* LSP is optional — the editor still works without it */ }
    }

    // A stryke/JS/shell/applescript/batch step's value control is the shared Monaco
    // editor with the Hooks-tab toolbar (Mode select + vim/emacs status); stryke adds
    // the LSP pill + a ▶ Run and ≡ Actions button. Degrades to a textarea when the
    // editor bundle (or, for non-stryke, createPlain) is absent.
    function makeMonacoControl(kind, val) {
      var isStryke = kind === 'stryke';
      var isOsa = kind === 'applescript';
      var isBat = kind === 'batch';
      var isSh = kind === 'shell';
      var LANG = { js: 'javascript', applescript: 'plaintext', batch: 'bat', shell: 'shell' };
      var EXT = { js: '.js', applescript: '.applescript', batch: '.bat', shell: '.sh' };
      var placeholder = isStryke ? 'p "hello {q}"   # stryke — print with p, {q} = arg'
        : isOsa ? 'tell application "Music" to playpause   -- {q} = arg'
        : isBat ? 'echo hi {q} & start "" .   :: {q} = arg'
        : isSh ? 'git status   # {q} = arg; runs in the OS shell via zwire-host'
        : "alert('hi ' + q + '!')";
      var canEdit = window.HooksEditor && typeof window.HooksEditor.create === 'function' &&
        (isStryke || typeof window.HooksEditor.createPlain === 'function');
      if (!canEdit) return Z.textarea({ placeholder: placeholder, rows: 4, value: val || '' });
      if (isStryke) ensureLsp();
      var wrap = el('div', 'zb-chain-ed');
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
        // ▶ Run — execute THIS editor's stryke buffer now via the host runner.
        var runBtn = Z.button({ label: '▶ Run', variant: 'primary', onClick: function () {
          var code = handle.getValue() || '';
          if (!code.trim()) { toast('nothing to run', 'error'); return; }
          runBtn.disabled = true;
          chrome.runtime.sendNativeMessage(HOST, { cmd: 'stryke_run', code: code }, function (reply) {
            runBtn.disabled = false;
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
        // ≡ Actions — the zwire automation surface (App::open("zwire")->verbs()), searchable.
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
      function showActions(verbs) {
        var old = wrap.querySelector('.zb-actpop'); if (old) old.remove();
        var pop = el('div', 'zb-actpop');
        pop.style.cssText = 'position:absolute;top:34px;right:6px;z-index:1000;background:#0a0e16;border:1px solid #22384d;border-radius:6px;padding:6px;max-height:300px;overflow:auto;width:340px;box-shadow:0 10px 30px rgba(0,0,0,.6);';
        var search = el('input');
        search.placeholder = 'Filter ' + verbs.length + ' actions…'; search.spellcheck = false;
        search.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:6px;background:#050810;border:1px solid #22384d;color:#9fe;padding:5px 8px;border-radius:4px;font:12px ui-monospace,monospace;';
        var list = el('div');
        // Fuzzy, with the matched characters highlighted — the SHARED zgui-core matcher every other
        // filter in zwire uses (R7). This was a plain `indexOf` substring test, which is the one
        // filter in the app that disagreed with the palette about what "matches": typing `iadd`
        // found `item.add` everywhere else and nothing here.
        var FZ = (window.ZGui && window.ZGui.fzf) || null;
        function rank(q) {
          if (!q) return verbs.map(function (v) { return { v: v }; });
          // fzfMatch(needle, haystack) -> {score, indices} | null.
          if (!FZ) return verbs.filter(function (v) { return String(v.id).toLowerCase().indexOf(q) >= 0; })
            .map(function (v) { return { v: v }; });
          return verbs.map(function (v) { var m = FZ.fzfMatch(q, String(v.id)); return m ? { v: v, s: m.score } : null; })
            .filter(Boolean).sort(function (a, b) { return b.s - a.s; });
        }
        function draw(q) {
          list.innerHTML = '';
          rank(q).slice(0, 300).forEach(function (hit) {
            var v = hit.v;
            // highlightMatch(text, query) escapes the text and wraps hits in <mark class="fzf-hl">,
            // the same highlight the palette and every list filter paint.
            var rw = el('div', null, (q && FZ) ? FZ.highlightMatch(String(v.id), q) : esc(String(v.id)));
            rw.style.cssText = 'padding:4px 8px;cursor:pointer;color:#7fe6c0;font:12px ui-monospace,monospace;border-radius:4px;';
            rw.addEventListener('mouseenter', function () { rw.style.background = '#12233a'; });
            rw.addEventListener('mouseleave', function () { rw.style.background = 'transparent'; });
            rw.addEventListener('click', function () {
              var cur = handle.getValue() || '';
              var needsUse = !/^\s*use\s+App\b/m.test(cur);
              var snippet = (needsUse ? 'use App\n' : '') + 'App::open("zwire")->call("' + v.id + '", {})\n';
              if (typeof handle.setValue === 'function') {
                handle.setValue(cur + (cur && cur.charAt(cur.length - 1) !== '\n' ? '\n' : '') + snippet);
              }
              pop.remove();
            });
            list.appendChild(rw);
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
      var uri = 'file:///zwire/steps/step-' + (++_strykeSeq) + (isStryke ? '.stryke' : (EXT[kind] || '.js'));
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

    function makeValueControl(type, val) {
      if (type === 'action') return Z.select({ options: opt(ACTIONS), value: val || 'newTab' });
      if (type === 'scheme') return Z.select({ options: opt(SCHEMES), value: val || 'cyberpunk' });
      if (type === 'js') return makeMonacoControl('js', val);
      if (type === 'stryke') return makeMonacoControl('stryke', val);
      if (type === 'applescript') return makeMonacoControl('applescript', val);
      if (type === 'batch') return makeMonacoControl('batch', val);
      if (type === 'shell') return makeMonacoControl('shell', val);
      if (type === 'host') return Z.textarea({ placeholder: '{"cmd":"notify","title":"hi {q}"}', rows: 3, value: val || '' });
      if (type === 'suite') return Z.textarea({ placeholder: '{"app":"zcite","verb":"item.add","args":{"doi":"{q}"}}', rows: 3, value: val || '' });
      if (type === 'assert') return Z.textarea({ placeholder: '{"state":"page.text","op":"contains","value":"Order confirmed"}', rows: 3, value: val || '' });
      if (type === 'witness') return Z.textarea({ placeholder: '{"state":"page.tables"}  ·  {"state":"page.links","op":"count_at_least","value":"1"}', rows: 3, value: val || '' });
      return Z.textfield({ placeholder: 'https://example.com   ({q} optional)', value: val || '' });
    }
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
    var addBtn = Z.button({ label: '＋ ADD STEP', variant: 'mini', onClick: function () { addStep(); } });
    addBtn.classList.add('zb-chain-add');

    // Sync the live rows, drop empty steps (action/scheme carry a select value so are
    // always valid), and validate every host step's JSON. Returns {ok, steps} or {ok:false, error}.
    function collect() {
      syncSteps();
      var clean = steps.map(function (s) { return { type: s.type, value: String(s.value == null ? '' : s.value) }; })
        .filter(function (s) { return s.value.trim() !== '' || s.type === 'action' || s.type === 'scheme'; });
      if (!clean.length) return { ok: false, error: 'Add at least one step' };
      for (var h = 0; h < clean.length; h++) {
        if (clean[h].type === 'host') { try { JSON.parse(String(clean[h].value).replace(/\{q\}/g, '')); } catch (e) { return { ok: false, error: 'Step ' + (h + 1) + ': host value must be valid JSON' }; } }
        if (clean[h].type === 'suite') {
          var so;
          try { so = JSON.parse(String(clean[h].value).replace(/\{q\}/g, '')); }
          catch (e2) { return { ok: false, error: 'Step ' + (h + 1) + ': app value must be valid JSON' }; }
          // A missing app or verb is the failure mode worth catching here: the host would answer
          // "no app named" at run time, unattended, from a trigger nobody is watching.
          if (!so || !so.app) return { ok: false, error: 'Step ' + (h + 1) + ': app step needs an "app" (the bus name)' };
          if (!so.verb) return { ok: false, error: 'Step ' + (h + 1) + ': app step needs a "verb"' };
        }
        if (clean[h].type === 'assert') {
          var ao2;
          try { ao2 = JSON.parse(String(clean[h].value).replace(/\{q\}/g, '')); }
          catch (e3) { return { ok: false, error: 'Step ' + (h + 1) + ': assert value must be valid JSON' }; }
          // An unknown op would be refused by the host at run time, unattended, from a trigger
          // nobody is watching — and the chain would revert for the wrong reason.
          if (!ao2 || !ao2.op) return { ok: false, error: 'Step ' + (h + 1) + ': assert step needs an "op" (' + ASSERT_OPS.join(', ') + ')' };
          if (ASSERT_OPS.indexOf(String(ao2.op)) < 0) return { ok: false, error: 'Step ' + (h + 1) + ': unknown assert op "' + ao2.op + '" (' + ASSERT_OPS.join(', ') + ')' };
        }
        if (clean[h].type === 'witness') {
          var wo2;
          try { wo2 = JSON.parse(String(clean[h].value).replace(/\{q\}/g, '')); }
          catch (e4) { return { ok: false, error: 'Step ' + (h + 1) + ': premise value must be valid JSON' }; }
          // An op is OPTIONAL here — no op is the content form, "this projection must not change" —
          // but an op the host does not know is refused at commit, which would revert a chain for a
          // typo instead of for a page that moved.
          if (!wo2 || !wo2.state) return { ok: false, error: 'Step ' + (h + 1) + ': premise step needs a "state" (the projection it pins)' };
          if (wo2.op != null && ASSERT_OPS.indexOf(String(wo2.op)) < 0) return { ok: false, error: 'Step ' + (h + 1) + ': unknown premise op "' + wo2.op + '" (' + ASSERT_OPS.join(', ') + ')' };
        }
      }
      return { ok: true, steps: clean };
    }

    return {
      host: stepsHost,
      addBtn: addBtn,
      // Load a chain for editing (normalises legacy {type,value}); empty → one default step.
      set: function (chainOrSteps) {
        var s = Array.isArray(chainOrSteps) ? chainOrSteps : entrySteps(chainOrSteps);
        steps = s.length ? s.map(function (x) { return { type: x.type, value: x.value }; }) : [{ type: 'url', value: '' }];
        drawSteps();
      },
      reset: function () { steps = [{ type: 'url', value: '' }]; drawSteps(); },
      addStep: addStep,
      collect: collect,
      destroy: function () { disposeStepEditors(); }
    };
  }

  /* ---- reversibility, at AUTHORING time --------------------------------------------------
   * A self-reverting chain can only revert what zwire-host journaled, and the host decides that
   * from its REV table (zbus.rs). `stepVerb` says which bus verb a step becomes; `revProblems`
   * answers WHICH steps a given rev table refuses.
   *
   * `revMap` is served by the host (`{cmd:'verbs'}` → `[{id, rev}]`) and is never mirrored here.
   * A JS copy of the table would drift the moment a verb is added on the Rust side, and a drifted
   * copy fails in the worst direction: it tells the author the chain is revertible and the host
   * refuses it later, unattended, at 3am. Checking here means an un-undoable trigger is rejected
   * while the author is still looking at it.
   *
   * That applies to WHICH IDS ARE VERBS as much as to their class. `revMap` carries the host's whole
   * surface, so membership in it — not a list here — decides whether an `action` step has a verb at
   * all. The list below is a SEED for the window before the host answers (and for a host that is
   * absent): the eleven ids it was hand-maintained at. It drifted exactly as predicted — the host
   * serves several times as many `browser.*` verbs as this named, so the wizard refused to save
   * `goBack`, `zoomIn`, `moveTabLeft`, `closeRight`, `unpinTab` and every other verb that
   * zpalette.js's runner executes and the host undoes perfectly; and it names `reopenTab`, which the
   * host classes irreversible. Wrong in both directions, and in the opposite direction to the
   * runner — authoring and execution have to derive the set from the same answer or one of them is
   * lying to the author. (No count is written down here: it moves whenever a verb is classified.)
   *
   * The seed can only ever NAME a verb for a rejection message, never win an acceptance: acceptance
   * needs `revMap[verb]` to read "inverse" or "pure", and a verb the host does not serve is absent
   * from `revMap` and therefore irreversible.
   *
   * The step types with no verb at all (shell / stryke / applescript / batch / js / scheme) are
   * not a mirror of REV — they run a program or arbitrary code, so there is no verb for the host
   * to class. That is a property of the executor, and zpalette.js's runStep refuses the same set. */
  var BUS_ACTIONS = {
    newTab: 1, newWindow: 1, duplicateTab: 1, reopenTab: 1, closeTab: 1, closeOthers: 1,
    nextTab: 1, prevTab: 1, pinTab: 1, muteTab: 1, reload: 1
  };
  var NO_VERB = { shell: 1, stryke: 1, applescript: 1, batch: 1, js: 1, scheme: 1 };
  // The bus verb a step becomes inside a transaction, or null when it has none. `revMap` is the
  // host's surface as loadRevMap reduces it ({ verb: revClass }); pass it and the host decides.
  function stepVerb(s, revMap) {
    var t = (s && s.type) || 'url';
    if (NO_VERB[t]) return null;
    if (t === 'action') {
      var verb = 'browser.' + s.value;
      if (revMap && revMap[verb]) return verb;             // the host serves it — authoritative
      return BUS_ACTIONS[s.value] ? verb : null;           // seed: no answer yet, or not a verb
    }
    if (t === 'host') {
      var o; try { o = JSON.parse(String(s.value || '').replace(/\{q\}/g, '')); } catch (e) { return null; }
      return (o && o.cmd) || null;
    }
    // An app step is always the SAME host verb (`suite_call`) whatever peer verb it names, because
    // the reversibility question is about zwire's journal, not the peer's: this host cannot
    // compensate a write that happened in another process. `suite_call` is classed irreversible in
    // the host's REV table, so revProblems refuses the step in a self-reverting chain from the
    // host's own answer rather than from a rule mirrored here.
    if (t === 'suite') return 'suite_call';
    // A postcondition READS the page and changes nothing, so the host classes `page.assert` `pure`
    // and a self-reverting chain may contain it. That is the whole design: the step that decides
    // whether to commit must itself be safe to run inside the transaction it is deciding about.
    if (t === 'assert') return 'page.assert';
    // A premise reads the page and ledgers a fact about it; it changes nothing in the browser, so
    // the host classes `page.witness` `pure` too. It has to be: the step that decides whether the
    // commit may stand must itself be legal inside the transaction it is deciding about.
    if (t === 'witness') return 'page.witness';
    return 'browser.openTab';   // url
  }
  // Steps a self-reverting chain cannot contain, given the host's rev table.
  // -> [{ index, type, verb, rev, reason }]. Empty means every step is revertible.
  function revProblems(steps, revMap) {
    var out = [];
    (steps || []).forEach(function (s, i) {
      var verb = stepVerb(s, revMap);
      if (!verb) {
        out.push({ index: i, type: s.type, verb: null, rev: 'irreversible',
          reason: 'a ' + ((TYPE_LABEL[s.type] || s.type)) + ' step is not a bus verb, so the host cannot undo it' });
        return;
      }
      // Absent from the table means irreversible — the host's own default for an unknown verb.
      var cls = (revMap && revMap[verb]) || 'irreversible';
      if (cls === 'inverse' || cls === 'pure') return;
      out.push({ index: i, type: s.type, verb: verb, rev: cls,
        reason: verb + ' has no compensation, so the host refuses it inside a transaction' });
    });
    return out;
  }
  /* Premise steps that have nothing to gate. -> [{ index, reason }]; empty means fine.
   *
   * `page.witness` files a fact against the chain's TRANSACTION, and only a self-reverting chain
   * opens one. In a plain chain the host refuses the step outright ("needs an open transaction"),
   * which is the correct answer but arrives at fire time, unattended, from a trigger nobody is
   * watching — the same argument that puts `revProblems` at save time. So the editor asks the
   * question here instead, where there is someone to tell.
   *
   * The reverse is deliberately NOT an error: a self-reverting chain with no premises is the
   * ordinary case, gated on its postconditions alone. */
  function premiseProblems(steps, selfReverting) {
    if (selfReverting) return [];
    var out = [];
    (steps || []).forEach(function (s, i) {
      if (s && s.type === 'witness') {
        out.push({ index: i, reason: 'a premise needs a transaction to gate — turn on self-reverting, or use an assert step' });
      }
    });
    return out;
  }
  // Ask the host for its surface and reduce it to { verb: revClass }. `cb(map|null)`.
  function loadRevMap(cb) {
    try {
      chrome.runtime.sendMessage({ type: 'zb-host', req: { cmd: 'verbs' } }, function (res) {
        void chrome.runtime.lastError;
        var verbs = res && res.ok && res.reply && res.reply.verbs;
        if (!Array.isArray(verbs)) { cb(null); return; }
        var m = {};
        verbs.forEach(function (v) { if (v && v.id) m[v.id] = v.rev || 'irreversible'; });
        cb(m);
      });
    } catch (e) { cb(null); }
  }

  window.ZwireStepWizard = {
    create: create,
    TYPES: TYPES, TYPE_LABEL: TYPE_LABEL, ACTIONS: ACTIONS, SCHEMES: SCHEMES, HINTS: HINTS,
    entrySteps: entrySteps, stepsSummary: stepsSummary, stepPreview: stepPreview,
    BUS_ACTIONS: BUS_ACTIONS, ASSERT_OPS: ASSERT_OPS, stepVerb: stepVerb, revProblems: revProblems,
    premiseProblems: premiseProblems, loadRevMap: loadRevMap
  };
})();
