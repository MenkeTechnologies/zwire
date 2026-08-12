/* zwire HUD — drive the shared ZGui.tmux (zgui-core) with web-page iframe panes,
 * replacing ztmux.js's bespoke top-frame WM. Top frame only. The pane-side
 * forwarder (ztmux-pane.js, injected all_frames) posts the prefix + synced
 * keystrokes + yanks up here; we relay them into ZGui.tmux via its external-feed
 * API (prefix/key/relaySync/yank). Pane content is a sandboxed iframe (name
 * 'zbtmux') so the forwarder runs inside it and the extension's header stripper
 * lets any site frame. */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (window.__ztmuxCfgLoaded) return; window.__ztmuxCfgLoaded = true;

  // every fresh pane opens the zwire new-tab (same page chrome://newtab redirects to).
  var NEWTAB = 'chrome-extension://gpoepnekoiplhkegjpocnpeijiefgieb/newtab.html';
  function looksUrl(q) { return /^[a-z][a-z0-9+.\-]*:\/\//i.test(q) || (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) && q.indexOf(' ') < 0); }
  function normalizeUrl(v) {
    v = (v || '').trim(); if (!v || v === 'about:blank') return NEWTAB;
    if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(v)) return v;
    if (looksUrl(v)) return 'https://' + v;
    return 'https://www.google.com/search?q=' + encodeURIComponent(v);
  }
  function hostLabel(url) { try { return (url && url !== NEWTAB) ? new URL(normalizeUrl(url)).hostname.replace(/^www\./, '') : 'newtab'; } catch (e) { return 'newtab'; } }

  // Build a pane: an address bar + a framed web page, into the element ZGui.tmux hands us.
  function mountPane(bodyEl, ref) {
    bodyEl.textContent = '';
    var url = (ref && ref.url) || NEWTAB;
    var wrap = document.createElement('div'); wrap.className = 'ztx-pane';
    var addr = document.createElement('input'); addr.className = 'ztx-addr'; addr.spellcheck = false;
    addr.placeholder = 'url or search …'; addr.value = (url && url !== NEWTAB) ? url : '';
    var fr = document.createElement('iframe'); fr.className = 'ztx-fr'; fr.name = 'zbtmux';
    fr.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
    fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation allow-storage-access-by-user-activation allow-presentation');
    fr.src = normalizeUrl(url);
    function go(u) { u = normalizeUrl(u); ref.url = u; fr.src = u; try { fr.focus(); } catch (e) {} }
    addr.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') go(addr.value); });
    wrap.appendChild(addr); wrap.appendChild(fr); bodyEl.appendChild(wrap);
    bodyEl._ztxFrame = fr; bodyEl._ztxAddr = addr; bodyEl._ztxRef = ref;
    return ref;
  }
  function frameOf(bodyEl) { return bodyEl && bodyEl._ztxFrame; }
  function postToPane(bodyEl, msg) { var fr = frameOf(bodyEl); if (fr) try { fr.contentWindow.postMessage(Object.assign({ __zbtmux: 1 }, msg), '*'); } catch (e) {} }
  // find the pane body whose iframe sent a message (its parent is the ZGui.tmux pane body).
  function bodyOfSource(src) {
    var frs = document.querySelectorAll('#zg-tmux iframe.ztx-fr');
    for (var i = 0; i < frs.length; i++) if (frs[i].contentWindow === src) return frs[i].closest('.zt-pane-body') || frs[i].parentNode.parentNode;
    return null;
  }

  /* ---- prefs via chrome.storage (sessions live in zb_tmux_sessions) ---- */
  function prefsLoad() { return new Promise(function (res) { try { chrome.storage.local.get(['zb_tmux_prefix', 'zb_tmux_opts', 'zb_keys', 'zb_tmux_sessions'], function (o) { void chrome.runtime.lastError; res({ tmuxPrefix: o.zb_tmux_prefix, tmuxOpts: o.zb_tmux_opts, tmuxKeys: o.zb_keys, tmuxSessions: o.zb_tmux_sessions }); }); } catch (e) { res({}); } }); }
  function prefsSave(p) { try { chrome.storage.local.set({ zb_tmux_sessions: p.tmuxSessions || [] }); } catch (e) {} return Promise.resolve(); }

  function boot() {
    if (!window.ZGui || !ZGui.tmux) return;
    ZGui.tmux.init({
      prefs: { load: prefsLoad, save: prefsSave },
      // C-b is the tmux prefix GLOBALLY, even with focus in a page text field. Without this,
      // the detached branch (tmux.js: `!open && editable && !prefixInEditable`) passes C-b
      // through to the page as Bold, so `C-b :` dies whenever the cursor sits in a website
      // input — the whole browsing surface is our "terminal", like real tmux owns C-b.
      prefixInEditable: true,
      openEmptyPane: function (bodyEl) { var ref = { url: NEWTAB }; mountPane(bodyEl, ref); return Promise.resolve(ref); },
      renderPane: function (bodyEl, ref) { mountPane(bodyEl, ref); },
      paneLabel: function (ref) { return hostLabel(ref && ref.url); },
      // Saved-layouts editor "set…" button: prompt for the pane's web URL. Without this the editor
      // renders panes as read-only labels (tmux.js gates the button on pickPaneRef being present).
      pickPaneRef: function (curRef) {
        if (!window.ZGui || !ZGui.modal || !ZGui.modal.prompt) return Promise.resolve(undefined);
        return ZGui.modal.prompt({
          title: "Pane URL",
          message: "Web page URL for this pane (blank = empty pane).",
          value: (curRef && curRef.url) || "",
          placeholder: "https://…"
        }).then(function (v) {
          if (v == null) return undefined;           // cancelled → leave the pane unchanged
          v = v.trim();
          return v ? { url: v } : null;              // blank → empty pane
        });
      },
      // pane ops for the cross-origin iframe model — postMessage into the pane's forwarder.
      applyKey: function (bodyEl, key) { postToPane(bodyEl, { syncapply: key }); },
      setSync: function (bodyEl, on) { postToPane(bodyEl, { setSync: !!on }); },
      setStatus: function (on) { try { chrome.storage.local.set({ zb_status: !!on }); } catch (e) {} },
      copyMode: function (bodyEl) { postToPane(bodyEl, { copyMode: true }); },
      paste: function (bodyEl, text) { postToPane(bodyEl, { pasteText: text }); }
    });
  }

  /* ===================== TOP FRAME: pane-pipeline relay ===================== */
  // The reactive dataflow runtime (see zpipes-core.js). Panes (ztmux-pane.js) extract
  // and post {pipeEmit:{edgeId,lines}} up; here we run the FILTER, the per-edge GATE
  // (cooldown / once / dedupe) and route the resulting sink message DOWN to every pane
  // whose sink.urls matches — never a direct cross-origin DOM write. A corrupt registry
  // (a cycle already present) is refused wholesale; a global dispatch-rate cap is the
  // belt to the CRUD page's cycle-check suspenders against a livelock.
  var PIPES = window.ZWIRE_PIPES;
  var pipeEdges = [], pipeState = {};
  var pipeWindow = [];              // timestamps of recent sink dispatches (rate cap)
  function pipeRefresh() {
    if (!PIPES) return;
    try {
      chrome.storage.local.get('zb_pipes', function (o) {
        void chrome.runtime.lastError;
        var list = (o && o.zb_pipes) || [];
        // Refuse to arm a registry that already contains a cycle — it would livelock.
        if (PIPES.graphCycle(list)) { pipeEdges = []; return; }
        pipeEdges = list.filter(function (e) { return PIPES.normalizeEdge(e).enabled; });
      });
    } catch (e) {}
  }
  function edgeById(id) { for (var i = 0; i < pipeEdges.length; i++) if (pipeEdges[i].id === id) return pipeEdges[i]; return null; }
  // Every mounted pane body, with its live URL (from the ref the mountPane closure sets).
  function panesWithUrl() {
    var frs = document.querySelectorAll('#zg-tmux .zt-pane-body'), out = [];
    for (var i = 0; i < frs.length; i++) { var b = frs[i], ref = b._ztxRef; if (ref) out.push({ body: b, url: ref.url || '' }); }
    return out;
  }
  function rateOk() {
    var now = Date.now();
    pipeWindow = pipeWindow.filter(function (t) { return now - t < 250; });
    if (pipeWindow.length >= PIPES.HOP_BUDGET) return false;   // burst cap → drop to avoid livelock
    pipeWindow.push(now);
    return true;
  }
  function dispatchEmit(edgeId, lines) {
    if (!PIPES) return;
    var edge = edgeById(edgeId); if (!edge) return;
    var n = PIPES.normalizeEdge(edge);
    var filtered = PIPES.applyFilter(n.filter, lines);
    var msg = PIPES.buildSinkMessage(n.sink, filtered);
    if (!msg) return;
    var value = msg.act === 'batch' ? msg.urls.join('\n') : (msg.url || msg.text || '');
    var g = PIPES.gate(n, pipeState[edgeId], Date.now(), value);
    if (!g.fire) return;
    if (!rateOk()) return;
    pipeState[edgeId] = g.state;
    routeSink(n.sink, msg);
  }
  function routeSink(sink, msg) {
    // The one sink that leaves the browser: call a verb on ANOTHER running app's bus socket via
    // zwire-host (suite.rs). No pane is addressed, so the pane loop below is skipped entirely.
    if (msg.act === 'app') {
      try {
        chrome.runtime.sendMessage({ type: 'zb-host', req: { cmd: 'suite_call', app: msg.app, verb: msg.verb, args: msg.args } }, function (res) {
          void chrome.runtime.lastError;
          // A peer that is closed, or that refused the verb, is reported — a pipeline that
          // silently stops delivering into another app is indistinguishable from one that never
          // matched, and the two need different fixes.
          var r = res && res.reply;
          if (!res || !res.ok || (r && r.ok === false)) {
            var why = (res && res.err) || (r && r.err) || 'unreachable';
            try { window.ZGui.toast.show('pipe → ' + msg.app + '.' + msg.verb + ': ' + why, 3200, 'error'); } catch (e) {}
          }
        });
      } catch (e) {}
      return;
    }
    if (msg.act === 'batch') {
      msg.urls.forEach(function (u) { try { chrome.runtime.sendMessage({ type: 'zbNewTab', url: normalizeUrl(u) }, function () { void chrome.runtime.lastError; }); } catch (e) {} });
      return;
    }
    var panes = panesWithUrl();
    for (var i = 0; i < panes.length; i++) {
      if (!PIPES.matchUrl(sink.urls, panes[i].url)) continue;
      if (msg.act === 'navigate') { navigatePane(panes[i].body, msg.url); }
      else { postToPane(panes[i].body, { pipeSink: msg }); }   // fill / replace / append → in-pane
    }
  }
  // Navigate a sink pane by driving its address bar + iframe (the same path go() uses).
  function navigatePane(bodyEl, url) {
    try {
      var fr = frameOf(bodyEl); if (!fr) return;
      var u = normalizeUrl(url);
      if (bodyEl._ztxRef) bodyEl._ztxRef.url = u;
      if (bodyEl._ztxAddr) bodyEl._ztxAddr.value = (u && u !== NEWTAB) ? u : '';
      fr.src = u;
    } catch (e) {}
  }
  if (PIPES) {
    pipeRefresh();
    try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.zb_pipes) pipeRefresh(); }); } catch (e) {}
  }

  // C-b | handler: open the Pipes page, seeding the source URL-filter with the host of
  // the pane that started the edge (escaped for the regex the filter is). The page is
  // opened by the background worker (a content script can't create a tab itself).
  function startPipe(src) {
    var url = '';
    try { var bl = bodyOfSource(src); if (bl && bl._ztxRef) url = bl._ztxRef.url || ''; } catch (e) {}
    var seed = '';
    try { var h = url ? new URL(normalizeUrl(url)).hostname.replace(/^www\./, '') : ''; if (h) seed = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } catch (e) {}
    var page = chrome.runtime.getURL('pages/pipes.html') + (seed ? ('?src=' + encodeURIComponent(seed)) : '');
    // A NEW tab, never zbopen (which navigates THIS tab and would tear down the live
    // tmux session the edge is being wired from).
    try { chrome.runtime.sendMessage({ type: 'zbNewTab', url: page }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  }

  // Relay pane-forwarder messages into ZGui.tmux (the prefix is pressed INSIDE a pane).
  window.addEventListener('message', function (ev) {
    var d = ev.data; if (!d || !d.__zbtmux || !window.ZGui || !ZGui.tmux) return;
    if (d.prefix) ZGui.tmux.prefix();
    // C-b | — pane pipelines: start a dataflow edge FROM the pane that pressed it.
    // Panes forward cmdKey only post-prefix, so this is the tmux `|` binding. We open
    // the Pipes CRUD page seeded with this pane's host as the source URL-filter; the
    // page finishes the wiring (source kind, filter, sink). Consumed here, not fed to
    // ZGui.tmux (`|` is not one of its actions), so no layout op runs.
    else if (d.cmdKey === '|') { startPipe(ev.source); }
    else if (d.cmdKey) ZGui.tmux.key(d.cmdKey, { ctrl: d.ctrl, alt: d.alt });
    // pane pipelines: a source pane extracted lines — run filter + gate + route to sinks.
    else if (d.pipeEmit && d.pipeEmit.edgeId) { dispatchEmit(d.pipeEmit.edgeId, d.pipeEmit.lines || []); }
    else if (d.palette) { try { if (window.__zbPaletteOpen) window.__zbPaletteOpen(); } catch (e) {} }
    else if (d.loc) {   // a pane navigated — track its live URL on the ref so the address
      // bar reflects the current page and a saved/restored session reopens it there.
      var bl = bodyOfSource(ev.source);
      if (bl && bl._ztxRef) { bl._ztxRef.url = d.loc; if (bl._ztxAddr) bl._ztxAddr.value = (d.loc && d.loc !== NEWTAB) ? d.loc : ''; }
    }
    else if (d.synckey) { var b = bodyOfSource(ev.source); if (b) ZGui.tmux.relaySync(b, d.synckey); }
    else if (d.syncReq) { var bq = bodyOfSource(ev.source); if (bq && ZGui.tmux.syncOf) postToPane(bq, { setSync: ZGui.tmux.syncOf(bq) }); }
    else if (d.yank) ZGui.tmux.yank(d.yank, d.append);
  });

  // The HUD Sessions page loads a layout by asking the background to open a fresh tab
  // and poll this message to it (chrome.tabs.sendMessage) until we ack success. Each ping
  // is one attach attempt: init()'s prefs load is async, so SESSIONS may not be populated
  // yet (loadSession no-ops, overlay stays closed) — we ack ok:false and the background
  // re-pings 300ms later. Once SESSIONS is live the attach opens the overlay and we ack
  // ok:true, which stops the poll. No internal retry loop needed — the poll IS the retry.
  function tryAttach(id) {
    if (!window.ZGui || !ZGui.tmux || !ZGui.tmux.loadSession) return false;
    ZGui.tmux.loadSession(id);
    return !!(ZGui.tmux.isOpen && ZGui.tmux.isOpen());
  }
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === 'zbTmuxLoadSession' && msg.id) {
        var ok = false; try { ok = tryAttach(msg.id); } catch (e) {}
        try { sendResponse({ ok: ok }); } catch (e) {}
        return true;
      }
    });
  } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
