/* zwire HUD — Tmux Sessions manager. Durable, named tmux sessions: each session
 * holds windows, each window holds panes, each pane is a webview (URL + title).
 * Full CRUD from one page. Sessions live in chrome.storage.local 'zb_tmux_sessions'
 * (survives restart — inside the profile). "Load" asks the background to open a fresh
 * browsing tab at the layout's first web page; the tmux overlay content script there
 * attaches the whole session (background → tabs.sendMessage 'zbTmuxLoadSession').
 *
 * Schema:  [{ id, name, created, updated, windows:[{ name, panes:[{ url, title }], tree }] }]
 * where tree is the tiling shape ZGui.tmux stores + rebuilds: { t:'split', dir:'row'|'col',
 * ratio, a, b } over { t:'leaf' }, one leaf per panes[] entry in depth-first order. */
(function () {
  'use strict';
  var Z = window.ZGui || {};
  var SKEY = 'zb_tmux_sessions';
  // Built-in tmux keys (C-b <key>) from the shared keymap, so we can warn when a
  // layout hotkey shadows one (the layout wins, but you should know).
  var TMUX_KEYS = (function () {
    var m = {}, reg = window.ZWIRE_KEYMAP, cat = reg && (reg.categories || []).filter(function (c) { return c.id === 'tmux'; })[0];
    if (cat) cat.actions.forEach(function (a) { if (a.def) m[a.def] = a.label; });
    return m;
  })();
  var sessions = [];
  var matchFn = function () { return true; };
  var editingId = null;         // session currently expanded for window/pane editing

  var shell = window.ZBHUD.mount({
    title: 'SESSIONS', current: 'sessions.html', filterPlaceholder: '>_ filter sessions…',
    onFilter: function (v, rx) { matchFn = window.ZBHUD.matcher(v, rx); render(); }
  });
  var body = shell.body;

  /* -------------------------------- helpers ------------------------------- */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function uid() { return 's' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }
  function stamp() { return Date.now(); }
  function toast(msg) { try { if (Z.toast && Z.toast.show) Z.toast.show(msg); } catch (e) {} }
  function paneCount(s) { return (s.windows || []).reduce(function (n, w) { return n + ((w.panes || []).length || 0); }, 0); }
  function fmtWhen(t) { if (!t) return ''; try { return new Date(t).toLocaleString(); } catch (e) { return ''; } }

  /* Layout geometry + structural edits come from ZGui.tmux.layout — the SAME code the
   * overlay tiles with and its built-in layouts editor runs on. A window is panes[]
   * (flat, depth-first) plus tree (the tiling shape: split direction + ratio); this
   * page used to know only about panes[] and mirrored the even-horizontal rebuild by
   * hand, so a top/bottom split previewed — and reloaded — as side-by-side columns.
   * The fallbacks below keep the page usable if tmux.js ever fails to load. */
  function TL() { var t = (window.ZGui || {}).tmux; return (t && t.layout) || null; }
  function evenRects(n, x, y, w, h) {
    if (n <= 1) return [{ x: x, y: y, w: w, h: h }];
    var mid = Math.ceil(n / 2), wa = w * (mid / n);
    return evenRects(mid, x, y, wa, h).concat(evenRects(n - mid, x + wa, y, w - wa, h));
  }
  function paneRects(panes, tree, W, H) {
    var tl = TL();
    return tl ? tl.rects(panes, tree, W, H) : evenRects(Math.max(1, (panes || []).length), 0, 0, W, H);
  }
  function paneDirs(w) { var tl = TL(); return tl ? tl.dirs(w) : (w.panes || []).map(function () { return 'row'; }); }
  function dirGlyph(d) { return d === 'col' ? '↓' : (d === 'row' ? '→' : '·'); }
  function layoutSvg(panes, tree, W, H) {
    var pad = 3;
    var out = ['<svg class="zsm-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">'];
    paneRects(panes, tree, W, H).forEach(function (r, i) {
      var x = r.x + pad / 2, y = r.y + pad / 2, w = Math.max(1, r.w - pad), hh = Math.max(1, r.h - pad);
      out.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="2" class="zsm-svg-pane"/>');
      out.push('<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y + hh / 2).toFixed(1) + '" text-anchor="middle" dominant-baseline="central" class="zsm-svg-num">' + i + '</text>');
    });
    out.push('</svg>');
    return out.join('');
  }
  function svgEl(html) { var d = el('div', 'zsm-svgwrap'); d.innerHTML = html; return d; }

  function load(cb) {
    try {
      chrome.storage.local.get(SKEY, function (o) {
        void chrome.runtime.lastError;
        sessions = (o && Array.isArray(o[SKEY])) ? o[SKEY] : [];
        if (cb) cb();
      });
    } catch (e) { sessions = []; if (cb) cb(); }
  }
  function persist(cb) {
    try {
      chrome.storage.local.set({ zb_tmux_sessions: sessions }, function () {
        void chrome.runtime.lastError;
        // Fire the session-saved lifecycle hook (background relays to the host).
        try { chrome.runtime.sendMessage({ type: 'zbFireHook', event: 'session-saved', payload: { count: sessions.length } }, function () { void chrome.runtime.lastError; }); } catch (e) {}
        if (cb) cb();
      });
    }
    catch (e) { if (cb) cb(); }
  }
  function touch(s) { s.updated = stamp(); }

  // ZGui.modal.prompt/confirm are promise-based; fall back to native dialogs so the
  // page still works if modal.js ever fails to load.
  function askText(title, message, value) {
    if (Z.modal && Z.modal.prompt) return Z.modal.prompt({ title: title, message: message, value: value || '' });
    return Promise.resolve(window.prompt(message || title, value || ''));
  }
  function askConfirm(title, message) {
    if (Z.modal && Z.modal.confirm) return Z.modal.confirm({ title: title, message: message });
    return Promise.resolve(window.confirm(message || title));
  }

  /* ------------------------------ CRUD actions ---------------------------- */
  // Auto-suffix a name so sessions never collide: "tommy" → "tommy 2" → "tommy 3" … (case-insensitive).
  // `skip` is an optional session to ignore (its own name, e.g. on rename).
  function uniqueName(base, skip) {
    base = String(base == null ? '' : base).trim() || 'session';
    var taken = {};
    sessions.forEach(function (s) { if (s !== skip) taken[String(s.name || '').toLowerCase()] = true; });
    if (!taken[base.toLowerCase()]) return base;
    for (var n = 2; ; n++) { var cand = base + ' ' + n; if (!taken[cand.toLowerCase()]) return cand; }
  }
  function blankSession(name) {
    return { id: uid(), name: name || 'session', created: stamp(), updated: stamp(), windows: [blankWindow()] };
  }
  function newSession() {
    askText('New session', 'Session name', 'session').then(function (name) {
      if (name == null) return;
      var s = blankSession(uniqueName(name.trim() || 'session'));
      sessions.unshift(s); editingId = s.id; persist(render);
    });
  }
  function duplicateSession(s) {
    var copy = JSON.parse(JSON.stringify(s));
    copy.id = uid(); copy.name = uniqueName(s.name + ' copy'); copy.created = copy.updated = stamp();
    var i = sessions.indexOf(s); sessions.splice(i + 1, 0, copy); persist(render);
  }
  function renameSession(s) {
    askText('Rename session', 'New name', s.name).then(function (name) {
      if (name == null) return; s.name = uniqueName(name.trim() || s.name, s); touch(s); persist(render);
    });
  }
  function deleteSession(s) {
    askConfirm('Delete session', 'Delete "' + s.name + '"? This cannot be undone.').then(function (ok) {
      if (!ok) return; var i = sessions.indexOf(s); if (i >= 0) sessions.splice(i, 1);
      if (editingId === s.id) editingId = null; persist(render);
    });
  }
  // First pane URL that is a real web page — the carrier the overlay attaches onto (the
  // overlay is a content script, so it only lives on http/https/file pages, never a blank
  // pane whose ref points at the extension new-tab).
  function firstPaneUrl(s) {
    var wins = s.windows || [];
    for (var i = 0; i < wins.length; i++) {
      var ps = wins[i].panes || [];
      for (var j = 0; j < ps.length; j++) { var u = ((ps[j] && ps[j].url) || '').trim(); if (/^(https?|file):\/\//i.test(u)) return u; }
    }
    return null;
  }
  function loadSession(s) {
    var url = firstPaneUrl(s);
    if (url) {
      // Background opens a new tab at `url` and relays the attach to its overlay once loaded.
      try { chrome.runtime.sendMessage({ type: 'zbTmuxOpen', id: s.id, url: url }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    } else {
      // No web page to carry the overlay (an all-new-tab layout). Chrome won't inject the
      // overlay onto a chrome-extension:// page, so open the new-tab extension's own carrier
      // page (tmux.html) which ships the overlay and tiles the new-tab panes itself. The
      // session rides in the URL hash because chrome.storage is per-extension.
      try { chrome.runtime.sendMessage({ type: 'zbTmuxOpenCarrier', session: s }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    }
    toast('Opening "' + s.name + '" in a new tab…');
  }

  /* --------------------------- window / pane ops -------------------------- */
  function blankWindow() { return { name: '', panes: [{ url: '', title: '' }], tree: null }; }
  function addWindow(s) { s.windows.push(blankWindow()); touch(s); persist(render); }
  function delWindow(s, wi) { s.windows.splice(wi, 1); if (!s.windows.length) s.windows.push(blankWindow()); touch(s); persist(render); }
  // Structural edits go through ZGui.tmux.layout so the shape stays in step with
  // panes[]: splitting inserts a leaf beside the pane it split (a new empty pane at
  // the matching index), closing collapses the split and promotes the sibling.
  function splitPane(s, w, pi, dir) {
    var tl = TL();
    if (tl) tl.split(w, pi, dir); else w.panes.splice(pi + 1, 0, { url: '', title: '' });
    if (w.panes[pi + 1] == null) w.panes[pi + 1] = { url: '', title: '' };
    touch(s); persist(render);
  }
  function addPane(s, w) { splitPane(s, w, Math.max(0, (w.panes || []).length - 1), 'row'); }
  function delPane(s, w, pi) {
    var tl = TL();
    if (tl) { if (!tl.close(w, pi)) return; }
    else { if (w.panes.length <= 1) return; w.panes.splice(pi, 1); }
    touch(s); persist(render);
  }

  /* ------------------------------ import / export ------------------------- */
  function exportAll() {
    var blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
    var a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'zwire-tmux-sessions.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 4000);
  }
  function importFile() {
    var inp = el('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var arr = JSON.parse(r.result);
          if (!Array.isArray(arr)) throw new Error('not an array');
          var added = 0;
          arr.forEach(function (s) {
            if (!s || !Array.isArray(s.windows)) return;
            sessions.push({ id: uid(), name: uniqueName(String(s.name || 'imported')), created: stamp(), updated: stamp(),
              windows: s.windows.map(function (w) {
                var panes = ((w && w.panes) || []).map(function (p) {
                  return { url: String((p && p.url) || ''), title: String((p && p.title) || '') };
                });
                // The shape rides along when the file has one; ZGui.tmux ignores a tree
                // whose leaf count no longer matches panes[] and tiles evenly instead.
                var tree = (w && w.tree && typeof w.tree === 'object') ? w.tree : null;
                return { name: String((w && w.name) || ''), panes: panes, tree: tree };
              }) });
            added++;
          });
          persist(render); toast('Imported ' + added + ' session' + (added === 1 ? '' : 's'));
        } catch (e) { toast('Import failed: ' + e.message); }
      };
      r.readAsText(f);
    });
    inp.click();
  }

  /* -------------------------------- render -------------------------------- */
  function bindInput(input, onCommit) {
    input.addEventListener('change', function () { onCommit(input.value); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  }

  function renderEditor(s) {
    var box = el('div', 'zsm-editor');
    s.windows.forEach(function (w, wi) {
      var win = el('div', 'zsm-window');
      var whead = el('div', 'zsm-whead');
      var wname = el('input', 'zs-input zsm-wname'); wname.value = w.name || ''; wname.placeholder = 'window ' + wi + ' name';
      bindInput(wname, function (v) { w.name = v.trim(); touch(s); persist(); });
      whead.appendChild(el('span', 'zsm-wtag', 'WIN ' + wi));
      whead.appendChild(wname);
      whead.appendChild(Z.button({ label: '+ pane', variant: 'mini', onClick: function () { addPane(s, w); } }));
      whead.appendChild(Z.button({ label: 'remove window', variant: 'mini', onClick: function () { delWindow(s, wi); } }));
      win.appendChild(whead);
      win.appendChild(svgEl(layoutSvg(w.panes, w.tree, 168, 92)));   // live tiling preview for this window

      var dirs = paneDirs(w);
      w.panes.forEach(function (p, pi) {
        var row = el('div', 'zsm-pane');
        row.appendChild(el('span', 'zsm-ptag', String(pi)));
        row.appendChild(el('span', 'zsm-pdir', dirGlyph(dirs[pi])));
        // Panes can be null (an "empty" pane from a tmux snapshot). Materialise on first edit.
        var url = el('input', 'zs-input zsm-purl'); url.value = (p && p.url) || ''; url.placeholder = 'https://…  (webview URL)';
        bindInput(url, function (v) { if (w.panes[pi] == null) w.panes[pi] = {}; w.panes[pi].url = v.trim(); touch(s); persist(); });
        var ttl = el('input', 'zs-input zsm-ptitle'); ttl.value = (p && p.title) || ''; ttl.placeholder = 'title (optional)';
        bindInput(ttl, function (v) { if (w.panes[pi] == null) w.panes[pi] = {}; w.panes[pi].title = v.trim(); touch(s); persist(); });
        row.appendChild(url); row.appendChild(ttl);
        row.appendChild(Z.button({ label: 'split →', variant: 'mini', onClick: function () { splitPane(s, w, pi, 'row'); } }));
        row.appendChild(Z.button({ label: 'split ↓', variant: 'mini', onClick: function () { splitPane(s, w, pi, 'col'); } }));
        row.appendChild(Z.button({ label: '✕', variant: 'mini', onClick: function () { delPane(s, w, pi); }, disabled: w.panes.length < 2 }));
        win.appendChild(row);
      });
      box.appendChild(win);
    });
    var foot = el('div', 'zsm-efoot');
    foot.appendChild(Z.button({ label: '+ window', variant: 'mini', onClick: function () { addWindow(s); } }));
    box.appendChild(foot);
    return box;
  }

  function matches(s) {
    var hay = s.name + ' ' + (s.windows || []).map(function (w) {
      return ((w && w.name) || '') + ' ' + ((w && w.panes) || []).map(function (p) { return ((p && p.url) || '') + ' ' + ((p && p.title) || ''); }).join(' ');
    }).join(' ');
    return matchFn(hay);
  }

  function render() {
    body.innerHTML = '';

    var bar = el('div', 'zsm-toolbar');
    bar.appendChild(Z.button({ label: 'New session', variant: 'primary', onClick: newSession }));
    bar.appendChild(Z.button({ label: 'Import', variant: 'mini', onClick: importFile }));
    bar.appendChild(Z.button({ label: 'Export all', variant: 'mini', onClick: exportAll, disabled: !sessions.length }));
    body.appendChild(bar);

    var shown = sessions.filter(matches);
    if (!shown.length) {
      var empty = el('div', 'zsm-empty');
      empty.appendChild(el('p', null, sessions.length ? 'No sessions match the filter.' : 'No saved sessions yet.'));
      empty.appendChild(el('p', 'zsm-hint', sessions.length ? '' : 'Create one here, or press the tmux prefix then S in a browsing tab to save the current layout.'));
      body.appendChild(empty);
      return;
    }

    shown.forEach(function (s) {
      var card = el('div', 'zsm-card');
      var head = el('div', 'zsm-head');
      var title = el('div', 'zsm-title');
      title.appendChild(el('span', 'zsm-name', s.name));
      // Shortcut binding: type one key to load this layout via C-b <key>, no page.
      var hkWrap = el('label', 'zsm-hotkey'); hkWrap.appendChild(el('span', 'zsm-hotkey-lbl', 'C-b'));
      var hk = el('input', 'zs-input zsm-hotkey-in'); hk.value = s.hotkey || ''; hk.maxLength = 1;
      hk.placeholder = '·'; hk.title = 'Shortcut: press C-b then this key to load this layout (overrides any built-in on that key). Case-sensitive — P and p are distinct.';
      var hkWarn = el('span', 'zsm-hkwarn');
      function updHkWarn() { var b = s.hotkey && TMUX_KEYS[s.hotkey]; hkWarn.textContent = b ? ('↳ overrides ' + b) : ''; }
      hk.addEventListener('change', function () { s.hotkey = (hk.value || '').trim().slice(0, 1); touch(s); persist(); updHkWarn(); });
      hk.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); hk.blur(); } });
      updHkWarn();
      hkWrap.appendChild(hk); hkWrap.appendChild(hkWarn); title.appendChild(hkWrap);
      title.appendChild(el('span', 'zsm-meta', (s.windows || []).length + ' win · ' + paneCount(s) + ' pane' + (paneCount(s) === 1 ? '' : 's') + (s.updated ? ' · ' + fmtWhen(s.updated) : '')));
      head.appendChild(title);

      var acts = el('div', 'zsm-acts');
      acts.appendChild(Z.button({ label: 'Load', variant: 'primary', onClick: function () { loadSession(s); } }));
      acts.appendChild(Z.button({ label: editingId === s.id ? 'Done' : 'Edit', variant: 'mini', onClick: function () { editingId = editingId === s.id ? null : s.id; render(); } }));
      acts.appendChild(Z.button({ label: 'Rename', variant: 'mini', onClick: function () { renameSession(s); } }));
      acts.appendChild(Z.button({ label: 'Duplicate', variant: 'mini', onClick: function () { duplicateSession(s); } }));
      acts.appendChild(Z.button({ label: 'Delete', variant: 'danger', onClick: function () { deleteSession(s); } }));
      head.appendChild(acts);
      card.appendChild(head);

      var prev = el('div', 'zsm-preview');
      (s.windows || []).forEach(function (w, wi) {
        var cell = el('div', 'zsm-prevcell');
        cell.appendChild(svgEl(layoutSvg(w.panes, w.tree, 96, 58)));
        cell.appendChild(el('span', 'zsm-prevlabel', (w.name && w.name.trim()) ? w.name : ('win ' + wi)));
        prev.appendChild(cell);
      });
      card.appendChild(prev);

      if (editingId === s.id) card.appendChild(renderEditor(s));
      body.appendChild(card);
    });
  }

  /* --------------------------------- styles ------------------------------- */
  var css = [
    '.zsm-toolbar{display:flex;gap:8px;align-items:center;padding:10px 0 14px;flex-wrap:wrap;}',
    '.zsm-card{border:1px solid var(--border);background:var(--card);border-radius:6px;margin:0 0 12px;padding:10px 12px;}',
    '.zsm-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;}',
    '.zsm-title{display:flex;flex-direction:column;gap:2px;min-width:0;}',
    '.zsm-name{color:var(--text);font-weight:600;font-size:15px;}',
    '.zsm-hotkey{display:inline-flex;align-items:center;gap:5px;margin:2px 0;}',
    '.zsm-hotkey-lbl{color:var(--text-dim);font-size:11px;font-family:"Share Tech Mono",monospace;}',
    '.zsm-hotkey-in{width:2.4em;text-align:center;padding:2px 4px;font-family:"Share Tech Mono",monospace;text-transform:none;}',
    '.zsm-hkwarn{color:var(--magenta,#ff4da6);font-size:11px;margin-left:6px;}',
    '.zsm-meta{color:var(--text-dim);font-size:12px;}',
    '.zsm-acts{display:flex;gap:6px;flex-wrap:wrap;}',
    '.zsm-editor{margin-top:12px;border-top:1px solid var(--border);padding-top:10px;}',
    '.zsm-window{border:1px solid var(--border);border-radius:5px;padding:8px;margin:0 0 8px;}',
    '.zsm-whead{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;}',
    '.zsm-wtag,.zsm-ptag{color:var(--accent);font:11px monospace;flex:none;}',
    /* the split a pane sits in: -> left-right, v top-bottom, . lone pane */
    '.zsm-pdir{color:var(--cyan);font:12px monospace;flex:none;width:1.2em;text-align:center;}',
    '.zsm-wname{flex:1;min-width:120px;}',
    '.zsm-pane{display:flex;gap:6px;align-items:center;margin:4px 0;}',
    '.zsm-purl{flex:2;min-width:160px;}',
    '.zsm-ptitle{flex:1;min-width:100px;}',
    '.zsm-efoot{margin-top:4px;}',
    '.zsm-empty{color:var(--text-dim);text-align:center;padding:40px 0;}',
    '.zsm-hint{font-size:12px;opacity:.8;}',
    '.zsm-preview{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;}',
    '.zsm-prevcell{display:flex;flex-direction:column;align-items:center;gap:3px;}',
    '.zsm-prevlabel{color:var(--text-dim);font:11px monospace;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.zsm-svgwrap{line-height:0;}',
    '.zsm-window .zsm-svgwrap{margin:0 0 8px;}',
    '.zsm-svg{display:block;background:var(--card);border:1px solid var(--border);border-radius:3px;}',
    '.zsm-svg-pane{fill:var(--hover,#12122a);stroke:var(--accent,#ff2a6d);stroke-width:1;}',
    '.zsm-svg-num{fill:var(--text-dim,#7a8ba8);font:10px monospace;}'
  ].join('');
  var st = el('style'); st.textContent = css; document.head.appendChild(st);

  /* keep the list live if another tab / the overlay edits sessions */
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.zb_tmux_sessions) load(render); }); } catch (e) {}

  load(render);
})();
