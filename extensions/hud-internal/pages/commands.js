/* zwire HUD — Custom Commands. Full CRUD for user-defined ⌘K palette entries.
 * Stored in chrome.storage.local 'zb_custom_cmds' (array). The global palette
 * (zpalette.js, on every web page) and the internal-page palette (zg-boot.js)
 * both read this key and register each entry — static items plus, in the global
 * palette, a keyword provider (`kw arg` → {q} in the value = the typed arg).
 * The step chain editor is the shared ZwireStepWizard (pages/step-wizard.js), so
 * Commands and Triggers render the identical wizard. Every control is a ZGui.*
 * widget per the zgui-core-only rule. */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };
  var W = window.ZwireStepWizard;
  var KEY = 'zb_custom_cmds';
  var cmds = [];
  var editingId = null;
  var filter = '', matchFn = function () { return true; };

  var entrySteps = W.entrySteps, stepsSummary = W.stepsSummary, stepPreview = W.stepPreview;

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  // ZGui.toast is an object ({show,history,…}) — NOT callable. Route through
  // .show(msg, dur, type) so error/success toasts actually render.
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

  // The step chain editor — a chain of typed steps run top-to-bottom (shared wizard).
  var wizard = W.create();
  var stepsHost = wizard.host;

  function field(label, ctlEl, req) { return Z.field({ label: label, control: ctlEl, required: !!req }).el; }

  // Icon field = the text input plus a "pick" button that opens zgui-core's
  // emoji icon library (ZGui.iconPicker). Typing a glyph directly still works.
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
    wizard.reset();
    var grid = el('div', 'zb-cmd-form');
    var labelWrap = field('Label', labelF.el, true); labelWrap.className += ' zb-cmd-grow';
    var iconWrap = field('Icon', iconControl()); iconWrap.className += ' zb-cmd-iconfield';
    grid.appendChild(row([labelWrap, iconWrap]));
    var kwWrap = field('Keyword', keywordF.el, true); kwWrap.className += ' zb-cmd-grow';
    var detWrap = field('Detail', detailF.el); detWrap.className += ' zb-cmd-grow';
    grid.appendChild(row([kwWrap, detWrap]));
    var stepsWrap = el('div');
    stepsWrap.appendChild(Z.field({ label: 'Steps', control: stepsHost, required: true }).el);
    stepsWrap.appendChild(wizard.addBtn);
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
    var res = wizard.collect();
    if (!res.ok) { toast(res.error, 'error'); return; }
    var wasEdit = !!editingId;
    var entry = {
      id: editingId || uid(),
      icon: (iconF.get() || '').trim().slice(0, 3),
      label: label,
      detail: (detailF.get() || '').trim(),
      keyword: keyword,
      steps: res.steps
    };
    // No two commands may share a keyword — a duplicate would make `kw` in ⌘K ambiguous.
    if (entry.keyword) {
      var dup = null;
      for (var d = 0; d < cmds.length; d++) {
        if (cmds[d].id !== entry.id && (cmds[d].keyword || '').toLowerCase() === entry.keyword) { dup = cmds[d]; break; }
      }
      if (dup) { toast('Keyword "' + entry.keyword + '" is already used by "' + dup.label + '"', 'error'); return; }
    }
    // No two commands may share a label either — duplicates make the ⌘K list ambiguous.
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
    wizard.set(entrySteps(row));
    saveBtn.textContent = 'UPDATE'; cancelBtn.style.display = '';
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function resetForm() {
    editingId = null;
    labelF.set(''); iconF.set(''); detailF.set(''); keywordF.set('');
    wizard.reset();
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
      '.zb-cmd-iconwrap{display:flex;gap:6px;align-items:stretch;}',
      '.zb-cmd-iconwrap>*:first-child{flex:1 1 auto;min-width:0;text-align:center;}',
      '.zb-cmd-iconpick{flex:0 0 36px;width:36px;padding:0;cursor:pointer;text-align:center;}',
      '.zb-cmd-actions{display:flex;gap:10px;}',
      '.zb-cmd-rowact{display:inline-flex;gap:6px;}',
      '.zb-cmd-val{font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;color:var(--text);}',
      '.zb-cmd-empty{padding:14px 4px;}',
      // The step-wizard rows/Monaco/LSP styles are injected by step-wizard.js (shared).
      '@media(max-width:640px){.zb-cmd-row{flex-direction:column;}.zb-cmd-iconfield{flex-basis:auto;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- init ---- */
  body.appendChild(buildForm());
  // Seed the default registry once (page context — reliable storage write), then draw.
  if (window.zwireSeedCmds) { window.zwireSeedCmds(function (list) { cmds = list || []; drawTable(); }); }
  else { try { chrome.storage.local.get(KEY, function (o) { void chrome.runtime.lastError; cmds = (o && o[KEY]) || []; drawTable(); }); } catch (e) { drawTable(); } }
  // live-refresh when the registry changes (background seeds defaults, or an edit from another tab).
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch[KEY] && !editingId) { cmds = ch[KEY].newValue || []; drawTable(); } }); } catch (e) {}
})();
