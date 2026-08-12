/* zwire HUD — Pane Pipelines. Full CRUD for reactive dataflow EDGES between tiled
 * webviews (the world-first pairing of a tiling WM with a piping primitive):
 *
 *     source pane  --[ extract ]-->  [ filter ]  -->  sink pane
 *
 * An edge extracts text from any pane whose live URL matches its source filter (a CSS
 * selector's text, a regex over rendered text, the current selection, or the URL),
 * transforms it (a stryke-style `|>` op chain, a JS expression, or passthrough), and
 * delivers the result to any pane whose URL matches its sink filter (navigate / fill a
 * field / replace or append a node / batch-open). Emission is reactive: the pane
 * forwarder (ztmux-pane.js) re-fires the edge when the source pane's content changes,
 * gated per-edge by cooldown / once / value-dedupe.
 *
 * Stored in chrome.storage.local 'zb_pipes' (array). The runtime lives in
 * ztmux-pane.js (source extraction + sink apply) and ztmux-config.js (the top-frame
 * relay + cycle guard), all decisions computed by the pure engine zpipes-core.js
 * (window.ZWIRE_PIPES). This page reuses that engine for validation and — critically —
 * refuses to save an edge that would close a cycle in the graph (an A→B→A loop would
 * livelock the observer). Every control is a ZGui.* widget per the zgui-core-only rule. */
(function () {
  'use strict';
  var Z = window.ZGui;
  var P = window.ZWIRE_PIPES;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };
  var KEY = 'zb_pipes';
  var pipes = [];
  var editingId = null;
  var matchFn = function () { return true; };

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function toast(m, type) { try { if (Z.toast && Z.toast.show) Z.toast.show(m, 2600, type || ''); } catch (e) {} }
  function persist(cb) {
    try { var o = {}; o[KEY] = pipes; chrome.storage.local.set(o, function () { void chrome.runtime.lastError; if (cb) cb(); }); }
    catch (e) { if (cb) cb(); }
  }

  injectCss();
  var shell = window.ZBHUD.mount({
    title: 'PIPELINES', current: 'pipes.html', filterPlaceholder: '>_ filter pipelines…',
    onFilter: function (v, rx) { matchFn = window.ZBHUD.matcher(v, rx); drawTable(); }
  });
  var body = shell.body;

  /* ---- form controls ---- */
  var nameF = Z.textfield({ placeholder: 'docs → playground' });
  var enabledToggle = Z.toggle({ checked: true });
  var onceToggle = Z.toggle({ checked: false });
  var dedupeToggle = Z.toggle({ checked: true });
  var cooldownF = Z.textfield({ placeholder: '1500' });

  var srcKindSel = Z.select({ value: 'selector', options: [
    { value: 'selector', label: 'CSS selector text' },
    { value: 'regex', label: 'Regex over page text' },
    { value: 'selection', label: 'Current selection' },
    { value: 'url', label: 'Live URL' }
  ], onChange: syncSrcFields });
  var srcUrlsF = Z.textfield({ placeholder: 'source pane URL filter (regex — blank = any pane)' });
  var srcSelectorF = Z.textfield({ placeholder: 'pre code' });
  var srcPatternF = Z.textfield({ placeholder: '(https?://\\S+)' });
  var srcFlagsF = Z.textfield({ placeholder: 'i' });

  var filterKindSel = Z.select({ value: 'none', options: [
    { value: 'none', label: 'None (passthrough)' },
    { value: 'ops', label: 'Op chain (|>)' },
    { value: 'js', label: 'JS expression' }
  ], onChange: syncFilterFields });
  var filterValueF = Z.textfield({ placeholder: 'trim |> uniq |> first' });

  var sinkKindSel = Z.select({ value: 'navigate', options: [
    { value: 'navigate', label: 'Navigate pane to URL' },
    { value: 'fill', label: 'Fill a field (selector)' },
    { value: 'replace', label: 'Replace node text (selector)' },
    { value: 'append', label: 'Append into node (selector)' },
    { value: 'batch', label: 'Batch-open all lines' },
    { value: 'app', label: 'Call a verb in another app (bus)' }
  ], onChange: syncSinkFields });
  var sinkUrlsF = Z.textfield({ placeholder: 'sink pane URL filter (regex — blank = any pane)' });
  var sinkSelectorF = Z.textfield({ placeholder: '#editor textarea' });
  var sinkSepF = Z.textfield({ placeholder: '\\n' });
  var sinkAppF = Z.textfield({ placeholder: 'zcite' });
  var sinkVerbF = Z.textfield({ placeholder: 'item.add' });
  var sinkArgsF = Z.textfield({ placeholder: '{"doi":"{q}"}   — blank sends {"q": text}' });

  var saveBtn = Z.button({ label: 'ADD PIPELINE', variant: 'primary', onClick: submit });
  var cancelBtn = Z.button({ label: 'CANCEL', variant: 'mini', onClick: resetForm });
  cancelBtn.style.display = 'none';

  function field(label, ctlEl, req) { return Z.field({ label: label, control: ctlEl, required: !!req }).el; }
  function row(cells) { var r = el('div', 'zb-cmd-row'); cells.forEach(function (c) { if (c) r.appendChild(c); }); return r; }

  // Source-kind determines which source fields are relevant.
  var srcSelectorWrap, srcPatternWrap, srcFlagsWrap;
  function syncSrcFields() {
    var k = srcKindSel.get();
    if (srcSelectorWrap) srcSelectorWrap.style.display = k === 'selector' ? '' : 'none';
    if (srcPatternWrap) srcPatternWrap.style.display = k === 'regex' ? '' : 'none';
    if (srcFlagsWrap) srcFlagsWrap.style.display = k === 'regex' ? '' : 'none';
  }
  var filterValueWrap;
  function syncFilterFields() {
    var k = filterKindSel.get();
    if (filterValueWrap) filterValueWrap.style.display = k === 'none' ? 'none' : '';
    filterValueF.el.placeholder = k === 'js' ? 'lines.map(x => x.trim())' : 'trim |> uniq |> first';
  }
  var sinkSelectorWrap, sinkSepWrap, sinkUrlsWrap, sinkAppWrap, sinkVerbWrap, sinkArgsWrap;
  function syncSinkFields() {
    var k = sinkKindSel.get();
    var needsSel = k === 'fill' || k === 'replace' || k === 'append';
    var isApp = k === 'app';
    if (sinkSelectorWrap) sinkSelectorWrap.style.display = needsSel ? '' : 'none';
    if (sinkSepWrap) sinkSepWrap.style.display = k === 'navigate' ? 'none' : '';
    // An `app` sink addresses a bus name, not a pane — the pane URL filter is meaningless there
    // and showing it invites an author to "scope" a delivery that has no pane to scope to.
    if (sinkUrlsWrap) sinkUrlsWrap.style.display = isApp ? 'none' : '';
    if (sinkAppWrap) sinkAppWrap.style.display = isApp ? '' : 'none';
    if (sinkVerbWrap) sinkVerbWrap.style.display = isApp ? '' : 'none';
    if (sinkArgsWrap) sinkArgsWrap.style.display = isApp ? '' : 'none';
  }

  function buildForm() {
    var grid = el('div', 'zb-cmd-form');

    var nameWrap = field('Name', nameF.el, true); nameWrap.className += ' zb-cmd-grow';
    var enWrap = field('Enabled', enabledToggle.el); enWrap.className += ' zb-pip-tgl';
    var onceWrap = field('Once / page', onceToggle.el); onceWrap.className += ' zb-pip-tgl';
    var dedupeWrap = field('Dedupe', dedupeToggle.el); dedupeWrap.className += ' zb-pip-tgl';
    grid.appendChild(row([nameWrap, enWrap, onceWrap, dedupeWrap]));

    // --- SOURCE ---
    grid.appendChild(el('div', 'zb-pip-sect', '// SOURCE — extract from any pane matching this URL filter'));
    var srcKindWrap = field('Kind', srcKindSel.el); srcKindWrap.className += ' zb-pip-kind';
    var srcUrlsWrap = field('Source pane URL filter', srcUrlsF.el); srcUrlsWrap.className += ' zb-cmd-grow';
    grid.appendChild(row([srcKindWrap, srcUrlsWrap]));
    srcSelectorWrap = field('CSS selector', srcSelectorF.el); srcSelectorWrap.className += ' zb-cmd-grow';
    srcPatternWrap = field('Pattern (regex)', srcPatternF.el); srcPatternWrap.className += ' zb-cmd-grow';
    srcFlagsWrap = field('Flags', srcFlagsF.el); srcFlagsWrap.className += ' zb-pip-flags';
    grid.appendChild(row([srcSelectorWrap, srcPatternWrap, srcFlagsWrap]));
    grid.appendChild(el('div', 'zb-cmd-hint', 'Selector: the element\'s text. Regex: each matching line (capture group 1 if present). Emission re-fires when the source pane\'s content changes.'));

    // --- FILTER ---
    grid.appendChild(el('div', 'zb-pip-sect', '// FILTER — transform the emitted lines (optional)'));
    var filterKindWrap = field('Kind', filterKindSel.el); filterKindWrap.className += ' zb-pip-kind';
    filterValueWrap = field('Expression', filterValueF.el); filterValueWrap.className += ' zb-cmd-grow';
    grid.appendChild(row([filterKindWrap, filterValueWrap]));
    grid.appendChild(el('div', 'zb-cmd-hint', 'Op chain: verbs joined by |> — trim, upper, lower, uniq, sort, reverse, nonempty, first, last, count, collapse, nth N, take N, drop N, join SEP, grep /re/, reject /re/, replace /re/repl/flags, prepend S, append S. JS: an expression with lines (array) and text (joined) in scope.'));

    // --- SINK ---
    grid.appendChild(el('div', 'zb-pip-sect', '// SINK — deliver to a matching pane, or to another app on the bus'));
    var sinkKindWrap = field('Kind', sinkKindSel.el); sinkKindWrap.className += ' zb-pip-kind';
    sinkUrlsWrap = field('Sink pane URL filter', sinkUrlsF.el); sinkUrlsWrap.className += ' zb-cmd-grow';
    grid.appendChild(row([sinkKindWrap, sinkUrlsWrap]));
    sinkSelectorWrap = field('Target selector', sinkSelectorF.el); sinkSelectorWrap.className += ' zb-cmd-grow';
    sinkSepWrap = field('Join separator', sinkSepF.el); sinkSepWrap.className += ' zb-pip-flags';
    grid.appendChild(row([sinkSelectorWrap, sinkSepWrap]));
    sinkAppWrap = field('App (bus name)', sinkAppF.el); sinkAppWrap.className += ' zb-pip-flags';
    sinkVerbWrap = field('Verb', sinkVerbF.el); sinkVerbWrap.className += ' zb-cmd-grow';
    grid.appendChild(row([sinkAppWrap, sinkVerbWrap]));
    sinkArgsWrap = field('Args (JSON, {q} = the text)', sinkArgsF.el); sinkArgsWrap.className += ' zb-cmd-grow';
    grid.appendChild(row([sinkArgsWrap]));
    grid.appendChild(el('div', 'zb-cmd-hint', 'A pane sink is posted to that pane\'s forwarder — never a direct cross-origin DOM write. An app sink calls a typed verb on another RUNNING MenkeTechnologies app over its bus socket (zwire-host), so page text can land in zcite / zreq / zpdf / … directly; {q} is spliced into the args JSON escaped, so quotes and newlines in page text stay valid. An edge that would close a cycle in the graph (A→B→A) is refused on save; an app sink cannot close one, because nothing it writes lands in a pane.'));

    var bar = el('div', 'zb-cmd-actions');
    bar.appendChild(saveBtn); bar.appendChild(cancelBtn);
    var wrap = el('div');
    wrap.appendChild(el('div', 'set-h', '// NEW PIPELINE'));
    wrap.appendChild(grid); wrap.appendChild(bar);
    syncSrcFields(); syncFilterFields(); syncSinkFields();
    return Z.card({ body: wrap }).el;
  }

  // Build the edge object from the form (unsaved shape).
  function collectEdge() {
    return {
      id: editingId || uid(),
      name: (nameF.get() || '').trim(),
      enabled: !!enabledToggle.get(),
      once: !!onceToggle.get(),
      dedupe: !!dedupeToggle.get(),
      cooldownMs: (cooldownF.get() || '').trim() === '' ? 1500 : parseInt((cooldownF.get() || '').trim(), 10),
      source: {
        kind: srcKindSel.get(),
        urls: (srcUrlsF.get() || '').trim(),
        selector: (srcSelectorF.get() || '').trim(),
        pattern: (srcPatternF.get() || '').trim(),
        flags: (srcFlagsF.get() || '').trim() || 'i'
      },
      filter: { kind: filterKindSel.get(), value: (filterValueF.get() || '').trim() },
      sink: {
        kind: sinkKindSel.get(),
        urls: (sinkUrlsF.get() || '').trim(),
        selector: (sinkSelectorF.get() || '').trim(),
        sep: (sinkSepF.get() || '') || '\n',
        app: (sinkAppF.get() || '').trim(),
        verb: (sinkVerbF.get() || '').trim(),
        args: (sinkArgsF.get() || '').trim()
      }
    };
  }

  function submit() {
    var entry = collectEdge();
    if (!isFinite(entry.cooldownMs) || entry.cooldownMs < 0) { toast('Cooldown must be a non-negative number', 'error'); return; }
    var v = P.validateEdge(entry);
    if (!v.ok) { toast(v.error, 'error'); return; }
    // No two pipelines may share a name.
    var lname = entry.name.toLowerCase();
    for (var d = 0; d < pipes.length; d++) {
      if (pipes[d].id !== editingId && (pipes[d].name || '').trim().toLowerCase() === lname) { toast('A pipeline named "' + entry.name + '" already exists', 'error'); return; }
    }
    // Cycle guard — the one thing that can make the feature unshippable. Reject an edge
    // that would close a loop among the OTHER enabled edges (self-loop included).
    if (entry.enabled) {
      var others = pipes.filter(function (x) { return x.id !== editingId; });
      // The sink's graph node, not its URL pattern: an `app` sink delivers outside the pane
      // graph entirely, so it carries a terminal node no source can name (see sinkNode).
      if (P.wouldCycle(others, entry.source.urls, P.sinkNode(entry.sink))) {
        toast('That edge would close a cycle in the pipeline graph (source pane ← sink pane). Refused.', 'error');
        return;
      }
    }
    var wasEdit = !!editingId;
    if (wasEdit) { for (var i = 0; i < pipes.length; i++) { if (pipes[i].id === editingId) { pipes[i] = entry; break; } } }
    else pipes.push(entry);
    persist(); resetForm(); drawTable(); toast(wasEdit ? 'Updated' : 'Added', 'success');
  }

  function startEdit(t) {
    editingId = t.id;
    var e = P.normalizeEdge(t);
    nameF.set(e.name); enabledToggle.set(e.enabled); onceToggle.set(e.once); dedupeToggle.set(e.dedupe);
    cooldownF.set(String(e.cooldownMs));
    srcKindSel.set(e.source.kind); srcUrlsF.set(e.source.urls); srcSelectorF.set(e.source.selector);
    srcPatternF.set(e.source.pattern); srcFlagsF.set(e.source.flags);
    filterKindSel.set(e.filter.kind); filterValueF.set(e.filter.value);
    sinkKindSel.set(e.sink.kind); sinkUrlsF.set(e.sink.urls); sinkSelectorF.set(e.sink.selector); sinkSepF.set(e.sink.sep);
    sinkAppF.set(e.sink.app); sinkVerbF.set(e.sink.verb); sinkArgsF.set(e.sink.args);
    syncSrcFields(); syncFilterFields(); syncSinkFields();
    saveBtn.textContent = 'UPDATE'; cancelBtn.style.display = '';
    try { window.scrollTo(0, 0); } catch (e2) {}
  }
  function resetForm() {
    editingId = null;
    nameF.set(''); enabledToggle.set(true); onceToggle.set(false); dedupeToggle.set(true); cooldownF.set('');
    srcKindSel.set('selector'); srcUrlsF.set(''); srcSelectorF.set(''); srcPatternF.set(''); srcFlagsF.set('i');
    filterKindSel.set('none'); filterValueF.set('');
    sinkKindSel.set('navigate'); sinkUrlsF.set(''); sinkSelectorF.set(''); sinkSepF.set('');
    sinkAppF.set(''); sinkVerbF.set(''); sinkArgsF.set('');
    syncSrcFields(); syncFilterFields(); syncSinkFields();
    saveBtn.textContent = 'ADD PIPELINE'; cancelBtn.style.display = 'none';
  }
  function removeEntry(t) {
    pipes = pipes.filter(function (x) { return x.id !== t.id; });
    if (editingId === t.id) resetForm();
    persist(); drawTable(); toast('Deleted', 'success');
  }
  function setEnabled(t, on) {
    for (var i = 0; i < pipes.length; i++) { if (pipes[i].id === t.id) { pipes[i].enabled = !!on; break; } }
    persist();
  }

  /* ---- table ---- */
  var dt = null, tableHost = null, tableCard = null;
  function srcLabel(e) {
    var s = P.normalizeEdge(e).source;
    if (s.kind === 'selector') return 'sel ' + (s.selector || '?');
    if (s.kind === 'regex') return '/' + (s.pattern || '?') + '/';
    return s.kind;
  }
  function sinkLabel(e) {
    var k = P.normalizeEdge(e).sink;
    if (k.kind === 'fill' || k.kind === 'replace' || k.kind === 'append') return k.kind + ' ' + (k.selector || '?');
    if (k.kind === 'app') return 'call';
    return k.kind;
  }
  function paneLabel(pat) { return pat ? pat : 'any'; }
  // What the sink DELIVERS to, for the table's target column: a pane pattern, or — for an app
  // sink — the bus address, so a row never reads "any pane" for an edge that touches no pane.
  function sinkTargetLabel(e) {
    var k = P.normalizeEdge(e).sink;
    return k.kind === 'app' ? (k.app || '?') + '.' + (k.verb || '?') : paneLabel(k.urls);
  }
  function columns() {
    return [
      { key: 'enabled', label: 'On', width: '48px', render: function (t) {
        var tg = Z.toggle({ checked: t.enabled !== false, onChange: function () { setEnabled(t, tg.get()); } });
        return tg.el;
      } },
      { key: 'name', label: 'Name', sortable: true, render: function (t) { return esc(t.name); } },
      { key: 'source', label: 'Source', render: function (t) { return '<code class="zb-pip-node" title="pane: ' + esc(paneLabel(P.normalizeEdge(t).source.urls)) + '">' + esc(paneLabel(P.normalizeEdge(t).source.urls)) + '</code> <span class="sub">' + esc(srcLabel(t)) + '</span>'; } },
      { key: 'filter', label: 'Filter', render: function (t) { var f = P.normalizeEdge(t).filter; return f.kind === 'none' ? '<span class="sub">—</span>' : '<code class="zb-pip-flt">' + esc(f.kind) + ': ' + esc(String(f.value).slice(0, 40)) + '</code>'; } },
      { key: 'sink', label: 'Sink', render: function (t) {
        var k = P.normalizeEdge(t).sink, tgt = sinkTargetLabel(t);
        return '<span class="sub">' + esc(sinkLabel(t)) + '</span> → <code class="zb-pip-node" title="' + esc(k.kind === 'app' ? 'app on the bus: ' + tgt : 'pane: ' + tgt) + '">' + esc(tgt) + '</code>';
      } },
      { key: '_act', label: '', render: function (t) {
        var wrap = el('span', 'zb-cmd-rowact');
        wrap.appendChild(Z.button({ label: 'edit', variant: 'mini', onClick: function () { startEdit(t); } }));
        wrap.appendChild(Z.button({ label: 'delete', variant: 'danger', onClick: function () { removeEntry(t); } }));
        return wrap;
      } }
    ];
  }
  function rowsFiltered() {
    return pipes.filter(function (t) {
      var e = P.normalizeEdge(t);
      var hay = [t.name, e.source.urls, e.source.selector, e.source.pattern, e.filter.value, e.sink.urls, e.sink.selector, e.source.kind, e.sink.kind, e.sink.app, e.sink.verb].join(' ');
      return matchFn(hay);
    });
  }
  function drawTable() {
    var rows = rowsFiltered();
    if (!dt) {
      var inner = el('div');
      inner.appendChild(el('div', 'set-h', '// YOUR PIPELINES'));
      tableHost = el('div');
      inner.appendChild(tableHost);
      var empty = el('div', 'zb-cmd-empty ci-hint', 'No pipelines yet. Add one above, or from the ztmux overlay press the tmux prefix then | to wire the active pane into a sink. Each edge reactively pipes text between tiled panes.');
      inner.appendChild(empty);
      tableCard = Z.card({ body: inner }).el;
      tableCard._empty = empty;
      body.appendChild(tableCard);
      dt = Z.dataTable(tableHost, { id: 'zb-pipes-table', columns: columns(), rows: rows, rowKey: function (t) { return t.id; }, sortScope: 'zb-pipes' });
    } else {
      dt.setRows(rows);
    }
    if (tableCard && tableCard._empty) tableCard._empty.style.display = rows.length ? 'none' : '';
    tableHost.style.display = rows.length ? '' : 'none';
  }

  function injectCss() {
    if (document.getElementById('zb-pip-css')) return;
    var s = el('style'); s.id = 'zb-pip-css';
    s.textContent = [
      '.zb-cmd-form{display:flex;flex-direction:column;gap:12px;margin:8px 0 14px;}',
      '.zb-cmd-row{display:flex;gap:18px;align-items:flex-start;}',
      '.zb-cmd-grow{flex:1 1 0;min-width:0;}',
      '.zb-pip-tgl{flex:0 0 108px;}',
      '.zb-pip-kind{flex:0 0 200px;}',
      '.zb-pip-flags{flex:0 0 130px;}',
      '.zb-pip-sect{color:var(--cyan,#05d9e8);font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;letter-spacing:.5px;margin:6px 0 -2px;opacity:.85;}',
      '.zb-cmd-form input,.zb-cmd-form select,.zb-cmd-form textarea{width:100%;box-sizing:border-box;}',
      '.zb-cmd-actions{display:flex;gap:10px;}',
      '.zb-cmd-rowact{display:inline-flex;gap:6px;}',
      '.zb-pip-node{font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;color:var(--cyan,#05d9e8);}',
      '.zb-pip-flt{font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;color:var(--text);}',
      '.zb-cmd-empty{padding:14px 4px;}',
      '@media(max-width:640px){.zb-cmd-row{flex-direction:column;}.zb-pip-tgl,.zb-pip-kind,.zb-pip-flags{flex-basis:auto;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- init ---- */
  body.appendChild(buildForm());
  // Ctrl-b | in the ztmux overlay opens this page with ?src=<escaped source-host regex>
  // so the SOURCE pane URL-filter is prefilled; the user finishes the wiring (kind,
  // filter, sink) and names it. A blank form otherwise.
  function seedFromQuery() {
    var src = '';
    try { src = new URLSearchParams(location.search).get('src') || ''; } catch (e) {}
    if (!src) return false;
    resetForm();
    srcUrlsF.set(src);
    toast('Source pane prefilled from the overlay — finish the wiring and add', 'success');
    try { window.scrollTo(0, 0); } catch (e) {}
    return true;
  }
  try {
    chrome.storage.local.get('zb_pipes', function (o) {
      void chrome.runtime.lastError;
      pipes = (o && o.zb_pipes) || [];
      drawTable();
      seedFromQuery();
    });
  } catch (e) { drawTable(); seedFromQuery(); }
  // live-refresh when the registry changes from another tab.
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch[KEY] && !editingId) { pipes = ch[KEY].newValue || []; drawTable(); } }); } catch (e) {}
})();
