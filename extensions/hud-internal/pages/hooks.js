/* zwire HUD Hooks page — manage stryke scripts bound to browser lifecycle events.
 * Backend: native host zwire-host (commands hooks_* + stryke_runner.rs), reached
 * over the native-messaging bridge; results arrive on the host pub/sub bus.
 *
 * Ported from the Audio-Haxor engine (frontend/js/hooks.js). The list/select/
 * edit/save/test/delete flow and the Monaco `window.HooksEditor` wiring are
 * carried over; the two host seams are re-hosted for zwire: Tauri `invoke` ->
 * `chrome.runtime.sendNativeMessage`, and Tauri `event.listen` -> a `connectNative`
 * subscription to the host `hook-result` bus topic. Actions dispatch host-side
 * (notify/open/exec/pub), so the app-specific hook-notify/hook-rescan relays drop
 * out. The stryke-LSP transport is a follow-up; the editor mounts without it. */
(function () {
  'use strict';
  var Z = window.ZGui || {};
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };
  var HOST = (window.ZBHUD && window.ZBHUD.HOST) || 'com.zwire.hud';
  function toast(m, ty) { try { if (Z.toast && Z.toast.show) Z.toast.show(m, 2600, ty || ''); } catch (e) {} }

  var shell = window.ZBHUD.mount({ title: 'HOOKS', current: 'hooks.html' });
  var body = shell.body;

  /* ---- native host bridge (replaces Tauri invoke) ---- */
  function nativeCall(req) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendNativeMessage(HOST, req, function (reply) {
          var err = chrome.runtime.lastError;
          if (err) { reject(new Error(err.message || 'native host error')); return; }
          if (reply && reply.ok === false) { reject(new Error(reply.err || 'command failed')); return; }
          resolve(reply || {});
        });
      } catch (e) { reject(e); }
    });
  }

  /* ---- styles (arrangement only; colors from the active HUD scheme) ---- */
  var css = [
    '.hk-wrap{display:grid;grid-template-columns:240px minmax(0,1fr);gap:14px;align-items:start;}',
    '@media(max-width:820px){.hk-wrap{grid-template-columns:1fr;}}',
    '.hk-side{border:1px solid var(--border,#1a1a3e);border-radius:2px;background:var(--bg-card,#0d0d1a);}',
    '.hk-side-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border,#1a1a3e);}',
    '.hk-side-head .hk-t{font:11px/1 var(--mono,monospace);letter-spacing:1px;text-transform:uppercase;color:var(--cyan,#05d9e8);}',
    '.hk-list{max-height:60vh;overflow-y:auto;}',
    '.hk-item{padding:8px 10px;border-bottom:1px solid var(--border,#1a1a3e);cursor:pointer;display:flex;flex-direction:column;gap:2px;}',
    '.hk-item:hover{background:var(--bg-hover,#12122a);}',
    '.hk-item.active{background:var(--bg-hover,#12122a);border-left:2px solid var(--cyan,#05d9e8);}',
    '.hk-item.off{opacity:.55;}',
    '.hk-item .hk-name{font:12px/1.2 var(--mono,monospace);color:var(--text,#cfe);}',
    '.hk-item .hk-ev{font:10px/1.2 var(--mono,monospace);color:var(--text-dim,#8aa);}',
    '.hk-empty{padding:14px;font:12px/1.5 var(--mono,monospace);color:var(--text-dim,#8aa);}',
    '.hk-form-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;}',
    '.hk-in,.hk-sel{font:12px/1.4 var(--mono,monospace);background:var(--bg-primary,#05050a);color:var(--text,#cfe);border:1px solid var(--border,#1a1a3e);border-radius:2px;padding:4px 6px;}',
    '.hk-in{flex:1 1 160px;}',
    '.hk-tog{font:11px/1 var(--mono,monospace);color:var(--text-dim,#8aa);display:flex;align-items:center;gap:5px;}',
    '.hk-mode-row{display:flex;gap:8px;align-items:center;margin-bottom:6px;}',
    '.hk-mode-row .hk-lbl{font:10px/1 var(--mono,monospace);color:var(--text-dim,#8aa);text-transform:uppercase;letter-spacing:1px;}',
    '.hk-lsp{font:10px/1 var(--mono,monospace);color:var(--text-muted,#3d4f6a);}',
    '.hk-lsp.ok{color:var(--green,#39ff14);}.hk-lsp.bad{color:var(--accent,#ff2a6d);}',
    '.hk-editor{height:320px;border:1px solid var(--border,#1a1a3e);border-radius:2px;overflow:hidden;}',
    '.hk-vim{font:10px/1.4 var(--mono,monospace);color:var(--text-dim,#8aa);min-height:14px;}',
    '.hk-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;}',
    '.hk-help{font:10px/1.4 var(--mono,monospace);color:var(--text-muted,#3d4f6a);}',
    '.hk-btn{font:11px/1 var(--mono,monospace);background:var(--bg-primary,#05050a);color:var(--cyan,#05d9e8);border:1px solid var(--cyan,#05d9e8);border-radius:2px;padding:5px 10px;cursor:pointer;}',
    '.hk-btn:hover{background:var(--bg-hover,#12122a);}',
    '.hk-btn.danger{color:var(--accent,#ff2a6d);border-color:var(--accent,#ff2a6d);}',
    '.hk-out{font:11px/1.5 var(--mono,monospace);color:var(--text-dim,#8aa);background:var(--bg-primary,#05050a);border:1px solid var(--border,#1a1a3e);border-radius:2px;padding:8px;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;margin:0;}'
  ].join('');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---- layout (builds the element IDs the ported logic queries) ---- */
  function el(id) { return document.getElementById(id); }
  var wrap = document.createElement('div'); wrap.className = 'hk-wrap';
  wrap.innerHTML =
    '<div class="hk-side">' +
      '<div class="hk-side-head"><span class="hk-t">// Hooks</span>' +
        '<button type="button" class="hk-btn" data-hook-action="new" title="Create a new hook">+ New</button></div>' +
      '<div class="hk-list" id="hooksList"></div>' +
    '</div>' +
    '<div>' +
      '<div class="hk-empty" id="hooksEmpty">Select a hook, or create one with New. A hook runs a stryke script when a lifecycle event fires; the script reads the event JSON on stdin and prints an <code>{actions:[...]}</code> object to act on the host.</div>' +
      '<div class="hk-form" id="hooksForm" hidden>' +
        '<div class="hk-form-row">' +
          '<input type="text" class="hk-in" id="hookName" placeholder="Hook name" spellcheck="false">' +
          '<select class="hk-sel" id="hookEvent" title="Lifecycle event that triggers this hook"></select>' +
          '<label class="hk-tog"><input type="checkbox" id="hookEnabled"> Enabled</label>' +
        '</div>' +
        '<div class="hk-mode-row">' +
          '<span class="hk-lbl">Mode</span>' +
          '<select class="hk-sel" id="hookEditorMode" title="Editor keybindings">' +
            '<option value="default">Default</option><option value="vim">Vim</option><option value="emacs">Emacs</option>' +
          '</select>' +
          '<span class="hk-lsp" id="hookLspStatus" title="stryke language server"></span>' +
        '</div>' +
        '<div class="hk-editor" id="hookScriptEditor" title="stryke script: reads the event JSON on stdin, prints an actions object on stdout"></div>' +
        '<div class="hk-vim" id="hookVimStatus"></div>' +
        '<div class="hk-actions">' +
          '<button type="button" class="hk-btn" data-hook-action="save">Save</button>' +
          '<button type="button" class="hk-btn" data-hook-action="test">Test Run</button>' +
          '<button type="button" class="hk-btn danger" data-hook-action="delete">Delete</button>' +
          '<span class="hk-help">Actions: notify, open, exec, pub</span>' +
        '</div>' +
        '<pre class="hk-out" id="hookOutput"></pre>' +
      '</div>' +
    '</div>';
  body.appendChild(wrap);

  /* ---- state ---- */
  var _hooks = [];
  var _events = [];
  var _selectedId = null;
  var _editor = null;
  var _saveTimer = null;
  var _lspStarted = false;
  var _lspPort = null;
  var MODE_KEY = 'zw.hooks.editorMode';
  function getEditorMode() { try { return localStorage.getItem(MODE_KEY) || 'default'; } catch (e) { return 'default'; } }
  function storeEditorMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }

  function editorValue() { return _editor ? _editor.getValue() : ''; }
  function scheduleSave(text) {
    var id = _selectedId; if (!id) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () { nativeCall({ cmd: 'hooks_set_script', id: id, code: text }).catch(function () {}); }, 500);
  }

  /* ---- stryke-LSP status pill (○ connecting / ● ready / ○ unavailable). The
     server is `stryke --lsp` via the host stryke_lsp_* commands (see ensureLsp). ---- */
  function setLspStatus(state) {
    var elx = el('hookLspStatus'); if (!elx) return;
    var text = { off: '○ LSP off', connecting: '○ connecting…', ready: '● stryke LSP', error: '○ LSP unavailable' };
    elx.textContent = text[state] || '';
    elx.className = 'hk-lsp' + (state === 'ready' ? ' ok' : state === 'error' ? ' bad' : '');
  }
  /* Start the stryke language server (host cmd stryke_lsp_start) and wire it to
     the editor's LSP client over a dedicated persistent native port — one
     connectNative owns one `stryke --lsp` child. Framed messages arrive as
     {ev:'stryke-lsp-rx', message}; the client sends via stryke_lsp_send. */
  function ensureLsp() {
    if (_lspStarted || !window.HooksEditor) return Promise.resolve();
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
        try { _lspPort.postMessage({ cmd: 'stryke_lsp_send', message: message }); } catch (e) {}
      });
      _lspStarted = true;
      // Green only once stryke answers `initialize` (not just on spawn).
      if (typeof window.HooksEditor.whenReady === 'function') {
        window.HooksEditor.whenReady().then(function (ok) { setLspStatus(ok ? 'ready' : 'error'); });
      } else {
        setLspStatus('ready');
      }
    } catch (e) {
      setLspStatus('error');  // LSP is optional — the editor still works without it
    }
    return Promise.resolve();
  }

  /* ---- data ---- */
  function loadEvents() {
    return nativeCall({ cmd: 'hooks_events' }).then(function (cat) {
      _events = (cat && cat.events) || [];
    }).catch(function () { _events = []; }).then(function () {
      var sel = el('hookEvent');
      if (sel) sel.innerHTML = _events.map(function (ev) { return '<option value="' + esc(ev.name) + '">' + esc(ev.name) + '</option>'; }).join('');
    });
  }
  function loadHooks() {
    return nativeCall({ cmd: 'hooks_list' }).then(function (r) { _hooks = (r && r.hooks) || []; })
      .catch(function () { _hooks = []; }).then(renderList);
  }

  function renderList() {
    var list = el('hooksList'); if (!list) return;
    if (!_hooks.length) { list.innerHTML = '<div class="hk-empty">No hooks yet.</div>'; return; }
    list.innerHTML = _hooks.map(function (h) {
      var active = h.id === _selectedId ? ' active' : '';
      var off = h.enabled ? '' : ' off';
      return '<div class="hk-item' + active + off + '" data-hook-id="' + esc(h.id) + '">' +
        '<span class="hk-name">' + esc(h.name || h.id) + '</span>' +
        '<span class="hk-ev">' + esc(h.event) + (h.enabled ? '' : ' · disabled') + '</span></div>';
    }).join('');
  }

  function select(id) {
    _selectedId = id;
    var h = _hooks.find(function (x) { return x.id === id; });
    renderList();
    var form = el('hooksForm'), empty = el('hooksEmpty');
    if (_editor) { try { _editor.destroy(); } catch (e) {} _editor = null; }
    if (!h) { if (form) form.hidden = true; if (empty) empty.hidden = false; return Promise.resolve(); }
    if (empty) empty.hidden = true; if (form) form.hidden = false;
    el('hookName').value = h.name || '';
    el('hookEvent').value = h.event;
    el('hookEnabled').checked = !!h.enabled;
    el('hookOutput').textContent = '';

    var code = '', uri = '';
    return nativeCall({ cmd: 'hooks_get_script', id: id }).then(function (r) { code = (r && r.code) || ''; }, function () { code = ''; })
      .then(function () { return nativeCall({ cmd: 'hooks_script_path', id: id }); })
      .then(function (r) {
        var p = (r && r.path) || '';
        uri = p ? 'file://' + p.split('/').map(encodeURIComponent).join('/') : '';
      }, function () { uri = ''; })
      .then(ensureLsp)
      .then(function () {
        var mount = el('hookScriptEditor');
        if (mount && window.HooksEditor) {
          mount.replaceChildren();
          _editor = window.HooksEditor.create(mount, {
            uri: uri, doc: code, onChange: scheduleSave,
            mode: getEditorMode(), statusBar: el('hookVimStatus')
          });
        }
      });
  }

  function createNew() {
    var name = 'New hook';
    var event = (_events[0] && _events[0].name) || 'scheme-changed';
    return nativeCall({ cmd: 'hooks_save', hook: { id: '', name: name, event: event, enabled: false, timeout_ms: 10000 } })
      .then(function (r) { return loadHooks().then(function () { return select(r.hook.id); }); })
      .catch(function (e) { toast(String(e), 'error'); });
  }

  function saveCurrent() {
    if (!_selectedId) return;
    var hook = {
      id: _selectedId,
      name: el('hookName').value.trim() || 'hook',
      event: el('hookEvent').value,
      enabled: el('hookEnabled').checked,
      timeout_ms: 10000
    };
    return nativeCall({ cmd: 'hooks_save', hook: hook })
      .then(function () { return nativeCall({ cmd: 'hooks_set_script', id: _selectedId, code: editorValue() }); })
      .then(loadHooks).then(renderList)
      .then(function () { var out = el('hookOutput'); if (out) out.textContent = 'Saved.'; })
      .catch(function (e) { toast(String(e), 'error'); });
  }

  function testCurrent() {
    if (!_selectedId) return;
    var h = _hooks.find(function (x) { return x.id === _selectedId; });
    var evDef = _events.find(function (e) { return e.name === (h && h.event); });
    var sample = (evDef && evDef.sample) || {};
    var out = el('hookOutput'); if (out) out.textContent = 'Running…';
    return nativeCall({ cmd: 'hooks_set_script', id: _selectedId, code: editorValue() })
      .then(function () { return nativeCall({ cmd: 'hooks_test_run', id: _selectedId, sample: sample }); })
      .then(function (r) {
        var codeStr = r.code == null ? 'killed' : String(r.code);
        var lines = [];
        lines.push('exit ' + codeStr + (r.timedOut ? ' (timed out)' : ''));
        lines.push('actions: ' + JSON.stringify(r.actions || []));
        if (r.stderr && r.stderr.trim()) lines.push('stderr:\n' + r.stderr.trim());
        lines.push('stdout:\n' + (r.stdout || '').trim());
        if (out) out.textContent = lines.join('\n');
      })
      .catch(function (e) { if (out) out.textContent = String(e); });
  }

  function deleteCurrent() {
    if (!_selectedId) return;
    var h = _hooks.find(function (x) { return x.id === _selectedId; });
    var label = (h && h.name) || _selectedId;
    if (!confirm('Delete hook "' + label + '" and its script?')) return;
    return nativeCall({ cmd: 'hooks_delete', id: _selectedId })
      .then(function () {
        _selectedId = null;
        return loadHooks();
      })
      .then(function () {
        var form = el('hooksForm'), empty = el('hooksEmpty');
        if (form) form.hidden = true; if (empty) empty.hidden = false;
      })
      .catch(function (e) { toast(String(e), 'error'); });
  }

  /* ---- scoped click handling ---- */
  document.addEventListener('click', function (e) {
    var idEl = e.target.closest('[data-hook-id]');
    if (idEl) { void select(idEl.dataset.hookId); return; }
    var actEl = e.target.closest('[data-hook-action]');
    if (!actEl) return;
    switch (actEl.dataset.hookAction) {
      case 'new': void createNew(); break;
      case 'save': void saveCurrent(); break;
      case 'test': void testCurrent(); break;
      case 'delete': void deleteCurrent(); break;
    }
  });

  /* ---- hook-result feed: subscribe to the host bus over a persistent port
     (replaces Tauri event.listen). The backend publishes on `hook-result`. ---- */
  function wireBackendEvents() {
    if (!(chrome.runtime && chrome.runtime.connectNative)) return;
    var port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { return; }
    port.onMessage.addListener(function (msg) {
      if (!msg || msg.ev !== 'pub' || msg.topic !== 'hook-result') return;
      var r = msg.data || {};
      if (r.id !== _selectedId) return;
      var out = el('hookOutput'); if (!out) return;
      var line = 'fired ' + String(r.event) + ' · ' + String(r.actions || 0) + ' action(s)';
      if (r.timedOut) line += ' (timed out)';
      if (r.error) line += ' · error: ' + String(r.error);
      out.textContent = line + (out.textContent ? '\n' + out.textContent : '');
    });
    port.onDisconnect.addListener(function () { setTimeout(wireBackendEvents, 1500); });
    try { port.postMessage({ id: 'hooksub', cmd: 'sub', topic: 'hook-result' }); } catch (e) {}
  }

  function wireModeSelect() {
    var sel = el('hookEditorMode'); if (!sel) return;
    sel.value = getEditorMode();
    sel.addEventListener('change', function () {
      storeEditorMode(sel.value);
      if (_editor && _editor.setMode) _editor.setMode(sel.value);
    });
  }

  /* ---- Monaco worker resolution (extension-local classic worker) ---- */
  try {
    self.MonacoEnvironment = self.MonacoEnvironment || {
      getWorker: function () { return new Worker(chrome.runtime.getURL('lib/hooks-editor/hooks-editor.worker.js')); }
    };
  } catch (e) {}

  function init() {
    ensureLsp();                       // pre-start the stryke LSP so completion is ready
    loadEvents().then(loadHooks);
    wireBackendEvents();
    wireModeSelect();
  }
  init();
})();
