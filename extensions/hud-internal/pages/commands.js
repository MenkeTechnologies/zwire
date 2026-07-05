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
  var filter = '';

  var TYPES = [
    { value: 'url', label: 'Open URL' },
    { value: 'shell', label: 'Run shell command' },
    { value: 'js', label: 'Run JavaScript' },
    { value: 'action', label: 'Browser action' },
    { value: 'scheme', label: 'Set color scheme' }
  ];
  var TYPE_LABEL = { url: 'open url', shell: 'shell', js: 'javascript', action: 'action', scheme: 'scheme' };
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
    shell: 'Runs in the popup terminal (zwire-host PTY). {q} = the typed argument; otherwise the argument is appended.',
    js: 'JavaScript run in the extension isolated world (has chrome.*). The variable `q` holds the typed argument.',
    action: 'Trigger a built-in browser action under your own name.',
    scheme: 'Switch the whole browser color scheme.'
  };

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function opt(pairs) { return pairs.map(function (p) { return { value: p[0], label: p[1] }; }); }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function toast(m) { try { if (Z.toast) Z.toast(m); } catch (e) {} }
  function persist(cb) {
    try { var o = {}; o[KEY] = cmds; chrome.storage.local.set(o, function () { void chrome.runtime.lastError; if (cb) cb(); }); }
    catch (e) { if (cb) cb(); }
  }

  injectCss();
  var shell = window.ZBHUD.mount({
    title: 'COMMANDS', current: 'commands.html', filterPlaceholder: '>_ filter commands…',
    onFilter: function (v) { filter = (v || '').toLowerCase(); drawTable(); }
  });
  var body = shell.body;

  /* ---- form ---- */
  var labelF = Z.textfield({ placeholder: 'Deploy prod' });
  var iconF = Z.textfield({ placeholder: '✦' });
  var detailF = Z.textfield({ placeholder: 'optional subtitle' });
  var keywordF = Z.textfield({ placeholder: 'deploy   (optional ⌘K alias)' });
  var typeSel = Z.select({ options: TYPES, value: 'url', onChange: function () { rebuildValue(''); } });
  var valueHost = el('div', 'zb-cmd-value');
  var valueHint = el('div', 'zb-cmd-hint');
  var valueCtl = null;
  var saveBtn = Z.button({ label: 'ADD COMMAND', variant: 'primary', onClick: submit });
  var cancelBtn = Z.button({ label: 'CANCEL', variant: 'mini', onClick: resetForm });
  cancelBtn.style.display = 'none';

  function rebuildValue(val) {
    var type = typeSel.get();
    valueHost.innerHTML = '';
    if (type === 'action') valueCtl = Z.select({ options: opt(ACTIONS), value: val || 'newTab' });
    else if (type === 'scheme') valueCtl = Z.select({ options: opt(SCHEMES), value: val || 'cyberpunk' });
    else if (type === 'js') valueCtl = Z.textarea({ placeholder: "alert('hi ' + q + '!')", rows: 4, value: val || '' });
    else valueCtl = Z.textfield({ placeholder: type === 'shell' ? 'git status   ({q} for args)' : 'https://example.com   ({q} optional)', value: val || '' });
    valueHost.appendChild(valueCtl.el);
    valueHint.textContent = HINTS[type] || '';
  }

  function field(label, ctlEl, req) { return Z.field({ label: label, control: ctlEl, required: !!req }).el; }

  function buildForm() {
    rebuildValue('');
    var grid = el('div', 'zb-cmd-form');
    grid.appendChild(field('Label', labelF.el, true));
    grid.appendChild(field('Icon', iconF.el));
    grid.appendChild(field('Type', typeSel.el, true));
    grid.appendChild(field('Keyword', keywordF.el));
    var valWrap = el('div', 'zb-cmd-full');
    valWrap.appendChild(Z.field({ label: 'Value', control: valueHost, required: true }).el);
    valWrap.appendChild(valueHint);
    grid.appendChild(valWrap);
    var detWrap = el('div', 'zb-cmd-full');
    detWrap.appendChild(field('Detail', detailF.el));
    grid.appendChild(detWrap);
    var bar = el('div', 'zb-cmd-actions');
    bar.appendChild(saveBtn); bar.appendChild(cancelBtn);
    var wrap = el('div');
    wrap.appendChild(el('div', 'set-h', '// NEW COMMAND'));
    wrap.appendChild(grid); wrap.appendChild(bar);
    return Z.card({ body: wrap }).el;
  }

  function submit() {
    var label = (labelF.get() || '').trim();
    if (!label) { toast('Label is required'); return; }
    var type = typeSel.get();
    var value = valueCtl && valueCtl.get ? valueCtl.get() : '';
    if ((type === 'url' || type === 'shell' || type === 'js') && !String(value).trim()) { toast('Value is required'); return; }
    var wasEdit = !!editingId;
    var entry = {
      id: editingId || uid(),
      icon: (iconF.get() || '').trim().slice(0, 3),
      label: label,
      detail: (detailF.get() || '').trim(),
      keyword: ((keywordF.get() || '').trim().toLowerCase().split(/\s+/)[0]) || '',
      type: type,
      value: String(value)
    };
    if (wasEdit) { for (var i = 0; i < cmds.length; i++) { if (cmds[i].id === editingId) { cmds[i] = entry; break; } } }
    else cmds.push(entry);
    persist(); resetForm(); drawTable(); toast(wasEdit ? 'Updated' : 'Added');
  }

  function startEdit(row) {
    editingId = row.id;
    labelF.set(row.label || ''); iconF.set(row.icon || ''); detailF.set(row.detail || '');
    keywordF.set(row.keyword || ''); typeSel.set(row.type || 'url'); rebuildValue(row.value || '');
    saveBtn.textContent = 'UPDATE'; cancelBtn.style.display = '';
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function resetForm() {
    editingId = null;
    labelF.set(''); iconF.set(''); detailF.set(''); keywordF.set(''); typeSel.set('url'); rebuildValue('');
    saveBtn.textContent = 'ADD COMMAND'; cancelBtn.style.display = 'none';
  }
  function removeEntry(row) {
    cmds = cmds.filter(function (c) { return c.id !== row.id; });
    if (editingId === row.id) resetForm();
    // A deleted DEFAULT is remembered so the seeder won't re-add it next load.
    if (String(row.id).indexOf('def-') === 0) {
      try { chrome.storage.local.get('zb_cmds_removed', function (o) { void chrome.runtime.lastError; var r = (o && o.zb_cmds_removed) || []; if (r.indexOf(row.id) < 0) r.push(row.id); chrome.storage.local.set({ zb_cmds_removed: r }); }); } catch (e) {}
    }
    persist(); drawTable(); toast('Deleted');
  }

  /* ---- table ---- */
  var dt = null, tableHost = null, tableCard = null;
  function valuePreview(row) {
    if (row.type === 'action') { var a = ACTIONS.filter(function (x) { return x[0] === row.value; })[0]; return a ? a[1] : row.value; }
    if (row.type === 'scheme') { var s = SCHEMES.filter(function (x) { return x[0] === row.value; })[0]; return s ? s[1] : row.value; }
    return row.value;
  }
  function columns() {
    return [
      { key: 'icon', label: '', width: '34px', render: function (r) { return esc(r.icon || '✦'); } },
      { key: 'label', label: 'Label', sortable: true, render: function (r) { return esc(r.label); } },
      { key: 'type', label: 'Type', sortable: true, render: function (r) { return esc(TYPE_LABEL[r.type] || r.type); } },
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
      return !filter || (c.label + ' ' + c.type + ' ' + c.value + ' ' + (c.keyword || '') + ' ' + (c.detail || '')).toLowerCase().indexOf(filter) >= 0;
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
      '.zb-cmd-form{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px;margin:8px 0 14px;}',
      '.zb-cmd-full{grid-column:1 / -1;}',
      '.zb-cmd-hint{font-size:11px;color:var(--text-muted,var(--text-dim));margin-top:6px;line-height:1.5;}',
      '.zb-cmd-actions{display:flex;gap:10px;}',
      '.zb-cmd-rowact{display:inline-flex;gap:6px;}',
      '.zb-cmd-val{font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;color:var(--text);}',
      '.zb-cmd-empty{padding:14px 4px;}',
      '@media(max-width:640px){.zb-cmd-form{grid-template-columns:1fr;}}'
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
