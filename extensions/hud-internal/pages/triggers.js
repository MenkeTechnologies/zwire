/* zwire HUD — Output Triggers. Full CRUD for regex-on-page-output triggers (the
 * browser analog of zterminal's terminal triggers). A trigger matches a regex against
 * page text as it renders/streams and, on a match, runs a CHAIN of typed steps — the
 * identical step set a ⌘K command runs (shell / stryke / js / applescript / batch /
 * action / scheme / host / url), via the shared ZwireStepWizard editor. The matched
 * line is the argument, so {q} in any step expands to it.
 *
 * Stored in chrome.storage.local 'zb_triggers' (array). The content-script engine
 * ztriggers.js reads this key on every web page, compiles the enabled triggers, and
 * fires their step chain through window.ZWIRE_CMD_EXEC (exported by zpalette.js).
 * Every control is a ZGui.* widget per the zgui-core-only rule. */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };
  var W = window.ZwireStepWizard;
  var KEY = 'zb_triggers';
  var trigs = [];
  var editingId = null;
  var matchFn = function () { return true; };

  var entrySteps = W.entrySteps, stepsSummary = W.stepsSummary, stepPreview = W.stepPreview;

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function toast(m, type) { try { if (Z.toast && Z.toast.show) Z.toast.show(m, 2600, type || ''); } catch (e) {} }
  function persist(cb) {
    try { var o = {}; o[KEY] = trigs; chrome.storage.local.set(o, function () { void chrome.runtime.lastError; if (cb) cb(); }); }
    catch (e) { if (cb) cb(); }
  }

  injectCss();
  var shell = window.ZBHUD.mount({
    title: 'TRIGGERS', current: 'triggers.html', filterPlaceholder: '>_ filter triggers…',
    onFilter: function (v, rx) { matchFn = window.ZBHUD.matcher(v, rx); drawTable(); }
  });
  var body = shell.body;

  /* ---- form ---- */
  var nameF = Z.textfield({ placeholder: 'Build failed' });
  var patternF = Z.textfield({ placeholder: '(?i)\\b(error|fail(ed|ure)?)\\b' });
  var flagsF = Z.textfield({ placeholder: 'i' });
  var urlsF = Z.textfield({ placeholder: 'optional — only fire on URLs matching this regex' });
  var cooldownF = Z.textfield({ placeholder: '1500' });
  var enabledToggle = Z.toggle({ checked: true });
  var saveBtn = Z.button({ label: 'ADD TRIGGER', variant: 'primary', onClick: submit });
  var cancelBtn = Z.button({ label: 'CANCEL', variant: 'mini', onClick: resetForm });
  cancelBtn.style.display = 'none';

  // The step chain editor — a chain of typed steps run on match (shared wizard).
  var wizard = W.create();
  var stepsHost = wizard.host;

  function field(label, ctlEl, req) { return Z.field({ label: label, control: ctlEl, required: !!req }).el; }
  function row(cells) { var r = el('div', 'zb-cmd-row'); cells.forEach(function (c) { r.appendChild(c); }); return r; }

  function buildForm() {
    wizard.reset();
    var grid = el('div', 'zb-cmd-form');
    var nameWrap = field('Name', nameF.el, true); nameWrap.className += ' zb-cmd-grow';
    var enWrap = field('Enabled', enabledToggle.el); enWrap.className += ' zb-trg-enfield';
    grid.appendChild(row([nameWrap, enWrap]));
    // Pattern (grows) + Flags (narrow).
    var patWrap = field('Pattern (regex)', patternF.el, true); patWrap.className += ' zb-cmd-grow';
    var flagWrap = field('Flags', flagsF.el); flagWrap.className += ' zb-trg-flagfield';
    grid.appendChild(row([patWrap, flagWrap]));
    grid.appendChild(el('div', 'zb-cmd-hint', 'The pattern is tested against each line of page text as it renders. Flags default to "i" (case-insensitive); g/y are ignored. The matched line becomes {q} in every step.'));
    // URL filter (grows) + Cooldown (narrow).
    var urlWrap = field('URL filter (regex)', urlsF.el); urlWrap.className += ' zb-cmd-grow';
    var cdWrap = field('Cooldown (ms)', cooldownF.el); cdWrap.className += ' zb-trg-cdfield';
    grid.appendChild(row([urlWrap, cdWrap]));
    grid.appendChild(el('div', 'zb-cmd-hint', 'URL filter (optional): only run on pages whose URL matches this regex. Cooldown: the trigger won\'t refire within this many ms — prevents a process storm on bursty output (default 1500).'));
    // Steps wizard.
    var stepsWrap = el('div');
    stepsWrap.appendChild(Z.field({ label: 'Steps (run on match)', control: stepsHost, required: true }).el);
    stepsWrap.appendChild(wizard.addBtn);
    grid.appendChild(stepsWrap);
    var bar = el('div', 'zb-cmd-actions');
    bar.appendChild(saveBtn); bar.appendChild(cancelBtn);
    var wrap = el('div');
    wrap.appendChild(el('div', 'set-h', '// NEW TRIGGER'));
    wrap.appendChild(grid); wrap.appendChild(bar);
    return Z.card({ body: wrap }).el;
  }

  function submit() {
    var name = (nameF.get() || '').trim();
    if (!name) { toast('Name is required', 'error'); return; }
    var pattern = (patternF.get() || '').trim();
    if (!pattern) { toast('Pattern is required', 'error'); return; }
    var flags = (flagsF.get() || '').trim();
    try { new RegExp(pattern, flags.replace(/[gy]/g, '') || 'i'); } catch (e) { toast('Invalid pattern: ' + e.message, 'error'); return; }
    var urls = (urlsF.get() || '').trim();
    if (urls) { try { new RegExp(urls, 'i'); } catch (e) { toast('Invalid URL filter: ' + e.message, 'error'); return; } }
    var cdRaw = (cooldownF.get() || '').trim();
    var cooldownMs = cdRaw === '' ? 1500 : parseInt(cdRaw, 10);
    if (!isFinite(cooldownMs) || cooldownMs < 0) { toast('Cooldown must be a non-negative number', 'error'); return; }
    var res = wizard.collect();
    if (!res.ok) { toast(res.error, 'error'); return; }
    // No two triggers may share a name — keeps the list unambiguous.
    var lname = name.toLowerCase();
    for (var d = 0; d < trigs.length; d++) {
      if (trigs[d].id !== editingId && (trigs[d].name || '').trim().toLowerCase() === lname) { toast('A trigger named "' + name + '" already exists', 'error'); return; }
    }
    var wasEdit = !!editingId;
    var entry = {
      id: editingId || uid(),
      name: name,
      pattern: pattern,
      flags: flags,
      urls: urls,
      cooldownMs: cooldownMs,
      enabled: !!enabledToggle.get(),
      steps: res.steps
    };
    if (wasEdit) { for (var i = 0; i < trigs.length; i++) { if (trigs[i].id === editingId) { trigs[i] = entry; break; } } }
    else trigs.push(entry);
    persist(); resetForm(); drawTable(); toast(wasEdit ? 'Updated' : 'Added', 'success');
  }

  function startEdit(t) {
    editingId = t.id;
    nameF.set(t.name || ''); patternF.set(t.pattern || ''); flagsF.set(t.flags || '');
    urlsF.set(t.urls || ''); cooldownF.set(t.cooldownMs != null ? String(t.cooldownMs) : '');
    enabledToggle.set(t.enabled !== false);
    wizard.set(entrySteps(t));
    saveBtn.textContent = 'UPDATE'; cancelBtn.style.display = '';
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function resetForm() {
    editingId = null;
    nameF.set(''); patternF.set(''); flagsF.set(''); urlsF.set(''); cooldownF.set('');
    enabledToggle.set(true);
    wizard.reset();
    saveBtn.textContent = 'ADD TRIGGER'; cancelBtn.style.display = 'none';
  }
  function removeEntry(t) {
    trigs = trigs.filter(function (x) { return x.id !== t.id; });
    if (editingId === t.id) resetForm();
    persist(); drawTable(); toast('Deleted', 'success');
  }
  // Toggle enabled straight from the table without opening the editor.
  function setEnabled(t, on) {
    for (var i = 0; i < trigs.length; i++) { if (trigs[i].id === t.id) { trigs[i].enabled = !!on; break; } }
    persist();
  }

  /* ---- table ---- */
  var dt = null, tableHost = null, tableCard = null;
  function valuePreview(t) {
    var st = entrySteps(t);
    if (st.length > 1) return st.length + ' steps: ' + st.map(stepPreview).join('  ▸  ');
    var s = st[0] || { type: 'url', value: '' };
    return stepPreview(s);
  }
  function columns() {
    return [
      { key: 'enabled', label: 'On', width: '48px', render: function (t) {
        var tg = Z.toggle({ checked: t.enabled !== false, onChange: function () { setEnabled(t, tg.get()); } });
        return tg.el;
      } },
      { key: 'name', label: 'Name', sortable: true, render: function (t) { return esc(t.name); } },
      { key: 'pattern', label: 'Pattern', render: function (t) { var p = String(t.pattern || ''); return '<code class="zb-trg-pat" title="' + esc(p) + '">' + esc(p.slice(0, 60)) + (p.length > 60 ? '…' : '') + '</code>'; } },
      { key: 'type', label: 'Steps', sortable: true, render: function (t) { return esc(stepsSummary(t)); } },
      { key: 'value', label: 'Value', render: function (t) { var v = String(valuePreview(t)); return '<span class="zb-cmd-val" title="' + esc(v) + '">' + esc(v.slice(0, 80)) + (v.length > 80 ? '…' : '') + '</span>'; } },
      { key: 'urls', label: 'URL filter', render: function (t) { return t.urls ? '<code>' + esc(String(t.urls).slice(0, 30)) + '</code>' : '<span class="sub">any</span>'; } },
      { key: '_act', label: '', render: function (t) {
        var wrap = el('span', 'zb-cmd-rowact');
        wrap.appendChild(Z.button({ label: 'edit', variant: 'mini', onClick: function () { startEdit(t); } }));
        wrap.appendChild(Z.button({ label: 'delete', variant: 'danger', onClick: function () { removeEntry(t); } }));
        return wrap;
      } }
    ];
  }
  function rowsFiltered() {
    return trigs.filter(function (t) {
      var hay = (t.name || '') + ' ' + (t.pattern || '') + ' ' + stepsSummary(t) + ' ' + entrySteps(t).map(function (s) { return s.value; }).join(' ') + ' ' + (t.urls || '');
      return matchFn(hay);
    });
  }
  function drawTable() {
    var rows = rowsFiltered();
    if (!dt) {
      var inner = el('div');
      inner.appendChild(el('div', 'set-h', '// YOUR TRIGGERS'));
      tableHost = el('div');
      inner.appendChild(tableHost);
      var empty = el('div', 'zb-cmd-empty ci-hint', 'No triggers yet. Add one above — it watches page text on every site and runs its steps when the pattern matches.');
      inner.appendChild(empty);
      tableCard = Z.card({ body: inner }).el;
      tableCard._empty = empty;
      body.appendChild(tableCard);
      dt = Z.dataTable(tableHost, { id: 'zb-trigs-table', columns: columns(), rows: rows, rowKey: function (t) { return t.id; }, sortScope: 'zb-trigs' });
    } else {
      dt.setRows(rows);
    }
    if (tableCard && tableCard._empty) tableCard._empty.style.display = rows.length ? 'none' : '';
    tableHost.style.display = rows.length ? '' : 'none';
  }

  function injectCss() {
    if (document.getElementById('zb-trg-css')) return;
    var s = el('style'); s.id = 'zb-trg-css';
    s.textContent = [
      '.zb-cmd-form{display:flex;flex-direction:column;gap:14px;margin:8px 0 14px;}',
      '.zb-cmd-row{display:flex;gap:18px;align-items:flex-start;}',
      '.zb-cmd-grow{flex:1 1 0;min-width:0;}',
      '.zb-trg-enfield{flex:0 0 120px;}',
      '.zb-trg-flagfield{flex:0 0 110px;}',
      '.zb-trg-cdfield{flex:0 0 150px;}',
      '.zb-cmd-form input,.zb-cmd-form select,.zb-cmd-form textarea{width:100%;box-sizing:border-box;}',
      '.zb-cmd-actions{display:flex;gap:10px;}',
      '.zb-cmd-rowact{display:inline-flex;gap:6px;}',
      '.zb-cmd-val{font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;color:var(--text);}',
      '.zb-trg-pat{font-family:"Share Tech Mono",Monaco,monospace;font-size:12px;color:var(--cyan,#05d9e8);}',
      '.zb-cmd-empty{padding:14px 4px;}',
      '@media(max-width:640px){.zb-cmd-row{flex-direction:column;}.zb-trg-enfield,.zb-trg-flagfield,.zb-trg-cdfield{flex-basis:auto;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- init ---- */
  body.appendChild(buildForm());
  try { chrome.storage.local.get(KEY, function (o) { void chrome.runtime.lastError; trigs = (o && o[KEY]) || []; drawTable(); }); } catch (e) { drawTable(); }
  // live-refresh when the registry changes (an edit lands from another tab).
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch[KEY] && !editingId) { trigs = ch[KEY].newValue || []; drawTable(); } }); } catch (e) {}
})();
