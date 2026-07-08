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

  var TYPES = [
    { value: 'url', label: 'Open URL' },
    { value: 'shell', label: 'Run shell command' },
    { value: 'js', label: 'Run JavaScript' },
    { value: 'action', label: 'Browser action' },
    { value: 'scheme', label: 'Set color scheme' },
    { value: 'host', label: 'zwire-host (JSON)' }
  ];
  var TYPE_LABEL = { url: 'open url', shell: 'shell', js: 'javascript', action: 'action', scheme: 'scheme', host: 'host' };
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
    js: 'JavaScript run in the extension isolated world (has chrome.*). The variable `q` holds the typed argument.',
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

  // One value control for a step of a given type — a ZGui widget with .el + .get().
  function makeValueControl(type, val) {
    if (type === 'action') return Z.select({ options: opt(ACTIONS), value: val || 'newTab' });
    if (type === 'scheme') return Z.select({ options: opt(SCHEMES), value: val || 'cyberpunk' });
    if (type === 'js') return Z.textarea({ placeholder: "alert('hi ' + q + '!')", rows: 4, value: val || '' });
    if (type === 'host') return Z.textarea({ placeholder: '{"cmd":"notify","title":"hi {q}"}', rows: 3, value: val || '' });
    return Z.textfield({ placeholder: type === 'shell' ? 'git status   ({q} for args)' : 'https://example.com   ({q} optional)', value: val || '' });
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
  function drawSteps() {
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
