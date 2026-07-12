/* zwire HUD Notes (ports Vivaldi's Notes) — a folder tree of Markdown notes,
 * persisted in chrome.storage (zb_notes). Left: folders + notes with search;
 * right: a Markdown editor with live preview (ZGui.markdown), attach-current-page,
 * move-to-folder, delete. Autosaves as you type. All zgui-core widgets + the
 * shared HUD shell, themed by the active scheme.
 *
 * Pure store helpers are exposed on window.ZBNotes for headless tests. */
(function () {
  'use strict';

  // ---- pure store over an array of nodes {id,parentId,type,title,content,url,ts} ----
  function childrenOf(notes, parentId) {
    return (notes || []).filter(function (n) { return (n.parentId || null) === (parentId || null); });
  }
  function byId(notes, id) { return (notes || []).filter(function (n) { return n.id === id; })[0] || null; }
  function descendantIds(notes, id) {
    var out = [];
    (function rec(pid) { (notes || []).forEach(function (n) { if ((n.parentId || null) === pid) { out.push(n.id); rec(n.id); } }); })(id);
    return out;
  }
  function removeNode(notes, id) {
    var kill = {}; kill[id] = 1; descendantIds(notes, id).forEach(function (i) { kill[i] = 1; });
    return (notes || []).filter(function (n) { return !kill[n.id]; });
  }
  function firstLine(c) { return String(c || '').split('\n')[0].replace(/^#+\s*/, '').trim(); }
  function noteTitle(n) { return (n && (n.title || firstLine(n.content))) || 'Untitled'; }
  function matchNote(n, q) {
    if (!q) return true;
    return (((n.title || '') + ' ' + (n.content || '') + ' ' + (n.url || '')).toLowerCase()).indexOf(q.toLowerCase()) >= 0;
  }
  function folders(notes) { return (notes || []).filter(function (n) { return n.type === 'folder'; }); }

  var ZBNotes = { childrenOf: childrenOf, byId: byId, descendantIds: descendantIds, removeNode: removeNode, firstLine: firstLine, noteTitle: noteTitle, matchNote: matchNote, folders: folders };
  if (typeof window !== 'undefined') window.ZBNotes = ZBNotes;

  if (typeof window === 'undefined' || !window.ZBHUD || typeof chrome === 'undefined' || !chrome.storage) return;   // headless: helpers only

  // ---- UI -------------------------------------------------------------------
  var idc = 0;
  function newId() { return 'n' + Date.now().toString(36) + (idc++).toString(36); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function fmtDate(ts) { try { return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }); } catch (e) { return ''; } }

  var shell = window.ZBHUD.mount({ title: 'NOTES', current: 'notes.html', filterPlaceholder: 'search notes…',
    onFilter: function (q) { query = q || ''; renderTree(); } });
  var body = shell.body;
  var notes = [], selectedId = null, query = '', preview = false, saveTimer = 0;

  function save() { try { chrome.storage.local.set({ zb_notes: notes }); } catch (e) {} }
  function saveSoon() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(save, 350); }

  var treeCol, editCol;
  function build() {
    body.innerHTML = '';
    var wrap = el('div', 'zn-wrap');
    treeCol = el('div', 'zn-tree'); editCol = el('div', 'zn-edit');
    wrap.appendChild(treeCol); wrap.appendChild(editCol);
    body.appendChild(wrap);
    renderTree(); renderEditor();
  }

  function addNote(parentId) {
    var n = { id: newId(), parentId: parentId || null, type: 'note', title: '', content: '', url: '', ts: Date.now() };
    notes.unshift(n); selectedId = n.id; preview = false; save(); renderTree(); renderEditor();
  }
  function addFolder() {
    var f = { id: newId(), parentId: null, type: 'folder', title: 'New folder', content: '', url: '', ts: Date.now() };
    notes.push(f); selectedId = f.id; save(); renderTree(); renderEditor();
  }
  function del(id) { notes = removeNode(notes, id); if (selectedId === id) selectedId = null; save(); renderTree(); renderEditor(); }

  function noteRow(n) {
    var row = el('div', 'zn-row' + (n.id === selectedId ? ' zn-sel' : ''));
    row.appendChild(el('span', 'zn-row-ic', '▤'));
    row.appendChild(el('span', 'zn-row-t', noteTitle(n)));
    row.appendChild(el('span', 'zn-row-d', fmtDate(n.ts)));
    row.addEventListener('click', function () { selectedId = n.id; preview = false; renderTree(); renderEditor(); });
    return row;
  }
  function renderTree() {
    if (!treeCol) return;
    treeCol.innerHTML = '';
    var bar = el('div', 'zn-toolbar');
    var bN = el('button', 'zn-btn', '＋ Note'); bN.addEventListener('click', function () { addNote(currentFolderContext()); });
    var bF = el('button', 'zn-btn', '＋ Folder'); bF.addEventListener('click', addFolder);
    bar.appendChild(bN); bar.appendChild(bF); treeCol.appendChild(bar);

    var list = el('div', 'zn-list');
    var q = query.trim();
    // Root notes first.
    childrenOf(notes, null).filter(function (n) { return n.type === 'note'; }).forEach(function (n) { if (matchNote(n, q)) list.appendChild(noteRow(n)); });
    // Then each folder with its notes.
    folders(notes).forEach(function (f) {
      var kids = childrenOf(notes, f.id).filter(function (n) { return n.type === 'note'; });
      var shown = kids.filter(function (n) { return matchNote(n, q); });
      if (q && !shown.length && matchNote(f, q) === false) return;   // hide empty non-matching folders while searching
      var head = el('div', 'zn-folder' + (f.id === selectedId ? ' zn-sel' : ''));
      head.appendChild(el('span', 'zn-row-ic', '▸'));
      head.appendChild(el('span', 'zn-row-t', f.title || 'Folder'));
      head.appendChild(el('span', 'zn-row-d', String(kids.length)));
      head.addEventListener('click', function () { selectedId = f.id; renderTree(); renderEditor(); });
      list.appendChild(head);
      (q ? shown : kids).forEach(function (n) { var r = noteRow(n); r.classList.add('zn-child'); list.appendChild(r); });
    });
    if (!list.children.length) list.appendChild(el('div', 'zn-empty', q ? 'No matches.' : 'No notes yet — ＋ Note.'));
    treeCol.appendChild(list);
  }
  function currentFolderContext() {
    var sel = byId(notes, selectedId);
    if (sel && sel.type === 'folder') return sel.id;
    if (sel && sel.parentId) return sel.parentId;
    return null;
  }

  function renderEditor() {
    if (!editCol) return;
    editCol.innerHTML = '';
    var n = byId(notes, selectedId);
    if (!n) { editCol.appendChild(el('div', 'zn-empty', 'Select a note, or ＋ Note to start.')); return; }
    if (n.type === 'folder') {
      var fname = el('input', 'zn-title'); fname.value = n.title || ''; fname.placeholder = 'Folder name';
      fname.addEventListener('input', function () { n.title = fname.value; n.ts = Date.now(); saveSoon(); renderTree(); });
      editCol.appendChild(fname);
      var fdel = el('button', 'zn-btn zn-danger', 'Delete folder + notes'); fdel.addEventListener('click', function () { del(n.id); });
      editCol.appendChild(fdel);
      return;
    }
    // note editor: toolbar + title + body (edit/preview)
    var tb = el('div', 'zn-etools');
    var tgl = el('button', 'zn-btn', preview ? 'Edit' : 'Preview'); tgl.addEventListener('click', function () { preview = !preview; renderEditor(); });
    var att = el('button', 'zn-btn', '⧉ Attach page'); att.addEventListener('click', function () { attachTab(n); });
    var mv = el('select', 'zn-move');
    mv.appendChild(new Option('— No folder —', ''));
    folders(notes).forEach(function (f) { var o = new Option(f.title || 'Folder', f.id); if (f.id === n.parentId) o.selected = true; mv.appendChild(o); });
    mv.addEventListener('change', function () { n.parentId = mv.value || null; n.ts = Date.now(); save(); renderTree(); });
    var dl = el('button', 'zn-btn zn-danger', '✕ Delete'); dl.addEventListener('click', function () { del(n.id); });
    tb.appendChild(tgl); tb.appendChild(att); tb.appendChild(mv); tb.appendChild(dl);
    editCol.appendChild(tb);

    var title = el('input', 'zn-title'); title.value = n.title || ''; title.placeholder = 'Title (optional — first line is used)';
    title.addEventListener('input', function () { n.title = title.value; n.ts = Date.now(); saveSoon(); renderTree(); });
    editCol.appendChild(title);

    if (n.url) {
      var chip = el('a', 'zn-urlchip', n.url); chip.href = n.url; chip.title = n.url;
      chip.addEventListener('click', function (e) { e.preventDefault(); chrome.tabs.create({ url: n.url }); });
      editCol.appendChild(chip);
    }

    if (preview) {
      var pv = el('div', 'zn-preview');
      try { if (window.ZGui && ZGui.markdown) ZGui.markdown.mount(pv, n.content || '*empty*'); else pv.textContent = n.content || ''; } catch (e) { pv.textContent = n.content || ''; }
      editCol.appendChild(pv);
    } else {
      var ta = el('textarea', 'zn-body'); ta.value = n.content || ''; ta.placeholder = '# Markdown note…';
      ta.addEventListener('input', function () { n.content = ta.value; n.ts = Date.now(); saveSoon(); });
      editCol.appendChild(ta);
    }
  }

  function attachTab(n) {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
        void chrome.runtime.lastError;
        var t = (tabs || [])[0]; if (!t) return;
        n.url = t.url || ''; if (!n.title && !firstLine(n.content)) n.title = t.title || '';
        n.ts = Date.now(); save(); renderTree(); renderEditor();
      });
    } catch (e) {}
  }

  function reload() { try { chrome.storage.local.get('zb_notes', function (o) { void chrome.runtime.lastError; notes = (o && o.zb_notes) || []; build(); }); } catch (e) { notes = []; build(); } }
  reload();
})();
