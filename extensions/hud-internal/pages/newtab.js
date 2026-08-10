/* zwire HUD — New Tab layouts. The library side of the Vivaldi Start Page port:
 * every custom new-tab layout in one place, with a live preview of its widget grid,
 * full CRUD, per-layout appearance settings, group/widget/dial editing, and
 * import/export so a layout can move between profiles.
 *
 * The layouts live in the NEW TAB extension's storage — the page that renders them
 * needs them on first paint and an extension cannot read a sibling's storage — so
 * this page reads and writes them over the external-message bridge (zbNtpGet /
 * zbNtpSet, answered by newtab/background.js). Every write is re-normalized on the
 * other side by the same zntp-core this page edits with, so nothing this page can
 * do produces a layout the new tab would refuse to draw.
 *
 * The model is entirely zntp-core (../zntp-core.js): this file only builds controls
 * and calls ops. All UI is ZGui.* + the shared HUD shell, per the zgui-core rule. */
(function () {
  'use strict';
  var Z = window.ZGui || {};
  var N = window.ZWIRE_NTP;
  var NEWTAB_ID = 'gpoepnekoiplhkegjpocnpeijiefgieb';          // zwire New Tab

  var cfg = null;
  var selectedId = null;
  var groupId = null;
  var matchFn = function () { return true; };

  var shell = window.ZBHUD.mount({
    title: 'NEW TAB', current: 'newtab.html', filterPlaceholder: '>_ filter layouts…',
    onFilter: function (v, rx) { matchFn = window.ZBHUD.matcher(v, rx); render(); }
  });
  var body = shell.body;

  /* -------------------------------------------------------------- helpers */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function toast(msg, type) { try { if (Z.toast && Z.toast.show) Z.toast.show(msg, 2400, type || ''); } catch (e) {} }
  function askText(title, message, value) {
    if (Z.modal && Z.modal.prompt) return Z.modal.prompt({ title: title, message: message, value: value || '' });
    return Promise.resolve(window.prompt(message || title, value || ''));
  }
  function askConfirm(title, message) {
    if (Z.modal && Z.modal.confirm) return Z.modal.confirm({ title: title, message: message });
    return Promise.resolve(window.confirm(message || title));
  }
  function button(label, cls, onClick) {
    var b = el('button', 'znt-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /* ------------------------------------------------------------ the bridge */
  function pull(cb) {
    try {
      chrome.runtime.sendMessage(NEWTAB_ID, { type: 'zbNtpGet' }, function (res) {
        void chrome.runtime.lastError;
        if (!res || !res.ok || !res.config) { cb(null); return; }
        cb(N.normalize(res.config));
      });
    } catch (e) { cb(null); }
  }
  function push(next) {
    try {
      chrome.runtime.sendMessage(NEWTAB_ID, { type: 'zbNtpSet', config: next }, function (res) {
        void chrome.runtime.lastError;
        if (!res || !res.ok) toast((res && res.err) || 'could not reach the new-tab extension', 'error');
      });
    } catch (e) { toast('could not reach the new-tab extension', 'error'); }
  }
  function commit(next) {
    if (!next) return;
    cfg = next;
    push(cfg);
    render();
  }

  function selected() { return N.layoutById(cfg, selectedId) || N.activeLayout(cfg); }
  function group() {
    var l = selected();
    return N.pageById(l, groupId) || N.activePage(l);
  }

  /* ------------------------------------------------------------- preview */
  /* The same placement the page's CSS grid performs (zntp-core.gridPlace), drawn as
   * blocks — so what the preview shows is what the new tab lays out, not a guess. */
  function previewSvg(layout) {
    // The card previews the group the layout OPENS on, not whichever group has the
    // most in it — switching to this layout is what the picture promises. That group
    // can legitimately be empty, so the preview names it either way rather than
    // leaving a blank box next to a card that counts widgets across every group.
    var page = N.activePage(layout);
    var cells = N.gridPlace(page.widgets, N.MAX_SPAN);
    var rows = Math.max(1, N.gridRows(cells));
    var W = 220, H = 132, gap = 3;
    var cw = W / N.MAX_SPAN, ch = H / rows;
    var out = ['<svg class="znt-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">'];
    if (!cells.length) {
      out.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" rx="2" class="znt-svg-empty"/>');
      out.push('<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" dominant-baseline="central" class="znt-svg-none">empty group</text>');
    }
    cells.forEach(function (c) {
      var spec = N.WIDGET_BY_TYPE[c.type] || { glyph: '▫' };
      var x = c.x * cw + gap / 2, y = c.y * ch + gap / 2;
      var w = Math.max(2, c.w * cw - gap), h = Math.max(2, c.h * ch - gap);
      out.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" class="znt-svg-w"/>');
      out.push('<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y + h / 2).toFixed(1) + '" text-anchor="middle" dominant-baseline="central" class="znt-svg-g">' + spec.glyph + '</text>');
    });
    out.push('</svg>');
    var wrap = el('div', 'znt-svgwrap');
    wrap.innerHTML = out.join('');                              // built here from enum-checked model data only
    wrap.appendChild(el('div', 'znt-svg-cap', 'group: ' + page.name));   // textContent — the name is user input
    return wrap;
  }

  /* ------------------------------------------------------- library actions */
  function newLayout() {
    askText('New layout', 'Layout name', 'Layout').then(function (name) {
      if (name == null) return;
      var next = N.createLayout(cfg, name.trim());
      selectedId = next.activeId;
      groupId = null;
      commit(next);
      toast('layout created');
    });
  }
  function renameLayout(l) {
    askText('Rename layout', 'New name', l.name).then(function (name) {
      if (name == null) return;
      commit(N.renameLayout(cfg, l.id, name.trim() || l.name));
    });
  }
  function deleteLayout(l) {
    if (cfg.layouts.length <= 1) { toast('the last layout cannot be deleted', 'error'); return; }
    askConfirm('Delete layout', 'Delete "' + l.name + '"? This cannot be undone.').then(function (ok) {
      if (!ok) return;
      if (selectedId === l.id) selectedId = null;
      commit(N.removeLayout(cfg, l.id));
      toast('layout deleted');
    });
  }
  function exportLayout(l) {
    var one = { v: N.SCHEMA, activeId: l.id, layouts: [l] };
    download((l.name || 'layout').replace(/[^\w.-]+/g, '-').toLowerCase() + '.zwire-layout.json', N.exportJSON(one));
  }
  function exportAll() { download('zwire-layouts.json', N.exportJSON(cfg)); }
  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = el('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    toast('exported ' + name);
  }
  function importLayouts() {
    var input = el('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      f.text().then(function (text) {
        try {
          var next = N.mergeImport(cfg, text);
          commit(next);
          toast('imported ' + (next.layouts.length - cfg.layouts.length + 1) + ' layout(s)');
        } catch (e) { toast('import failed: ' + e.message, 'error'); }
      });
    });
    input.click();
  }

  /* ----------------------------------------------------------- prefs block */
  function prefRow(label, control) {
    var row = el('label', 'znt-pref');
    row.appendChild(el('span', 'znt-pref-label', label));
    row.appendChild(control);
    return row;
  }
  function select(options, value, onChange) {
    var s = el('select', 'znt-input');
    options.forEach(function (o) {
      var op = el('option', null, o[1]);
      op.value = o[0];
      if (String(o[0]) === String(value)) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }
  function range(min, max, value, onChange) {
    var wrap = el('span', 'znt-range');
    var r = el('input', 'znt-input');
    r.type = 'range';
    r.min = String(min);
    r.max = String(max);
    r.step = '1';
    r.value = String(value);
    var out = el('span', 'znt-range-out', String(value));
    r.addEventListener('input', function () { out.textContent = r.value; });
    r.addEventListener('change', function () { onChange(parseInt(r.value, 10)); });
    wrap.appendChild(r);
    wrap.appendChild(out);
    return wrap;
  }
  function check(value, onChange) {
    var c = el('input');
    c.type = 'checkbox';
    c.checked = !!value;
    c.addEventListener('change', function () { onChange(c.checked); });
    return c;
  }
  function text(value, placeholder, onChange) {
    var t = el('input', 'znt-input');
    t.type = 'text';
    t.value = value == null ? '' : String(value);
    if (placeholder) t.placeholder = placeholder;
    t.addEventListener('change', function () { onChange(t.value); });
    return t;
  }

  function renderPrefs(host, l) {
    var box = el('div', 'znt-prefs');
    var prefs = function (patch) { commit(N.setLayoutPrefs(cfg, l.id, patch)); };
    box.appendChild(prefRow('Navigation position', select(
      N.NAV_POS.map(function (p) { return [p, p.charAt(0).toUpperCase() + p.slice(1)]; }), l.nav.pos,
      function (v) { prefs({ nav: { pos: v } }); })));
    box.appendChild(prefRow('Show navigation', select(
      [['always', 'Always'], ['start', 'On start pages'], ['hidden', 'Hide']], l.nav.show,
      function (v) { prefs({ nav: { show: v } }); })));
    box.appendChild(prefRow('Maximum columns', range(0, N.MAX_COLUMNS, l.dial.columns,
      function (v) { prefs({ dial: { columns: v } }); })));
    box.appendChild(prefRow('Thumbnail size', range(1, N.MAX_THUMB, l.dial.thumb,
      function (v) { prefs({ dial: { thumb: v } }); })));
    box.appendChild(prefRow('Speed Dial titles', select(
      [['always', 'Always show'], ['auto', 'When needed'], ['never', 'Never show']], l.dial.titles,
      function (v) { prefs({ dial: { titles: v } }); })));
    box.appendChild(prefRow('Show the Add button', check(l.dial.showAdd, function (v) { prefs({ dial: { showAdd: v } }); })));
    box.appendChild(prefRow('Reorder by drag and drop', check(l.dial.dragReorder, function (v) { prefs({ dial: { dragReorder: v } }); })));
    box.appendChild(prefRow('Background', select(
      N.BG_KINDS.map(function (k) { return [k, k.charAt(0).toUpperCase() + k.slice(1)]; }), l.bg.kind,
      function (v) { prefs({ bg: { kind: v } }); })));
    if (l.bg.kind === 'color' || l.bg.kind === 'gradient') {
      box.appendChild(prefRow(l.bg.kind === 'color' ? 'Color' : 'CSS gradient',
        text(l.bg.value, l.bg.kind === 'color' ? '#05050a' : 'linear-gradient(…)',
          function (v) { prefs({ bg: { kind: l.bg.kind, value: v } }); })));
    }
    if (l.bg.kind === 'image') {
      box.appendChild(prefRow('Image', el('span', 'znt-note',
        l.bg.value ? 'set — change it from the new tab\'s Customize dialog' : 'upload one from the new tab\'s Customize dialog')));
    }
    host.appendChild(box);
  }

  /* --------------------------------------------------- groups / widgets / dials */
  function renderGroups(host, l) {
    var row = el('div', 'znt-tabs');
    l.pages.forEach(function (p) {
      var b = button(p.name + ' (' + p.dials.length + ')', p.id === group().id ? 'is-on' : '', function () { groupId = p.id; render(); });
      row.appendChild(b);
    });
    row.appendChild(button('+ Group', 'is-ghost', function () {
      askText('New group', 'Group name', 'Group').then(function (name) {
        if (name == null) return;
        var next = N.addPage(cfg, l.id, name.trim());
        groupId = N.layoutById(next, l.id).activePageId;       // addPage activates the new group
        commit(next);
      });
    }));
    host.appendChild(row);
  }

  function renderWidgets(host, l, page) {
    var sec = el('section', 'znt-sec');
    var head = el('div', 'znt-sec-head');
    head.appendChild(el('h3', 'znt-sec-title', 'Widgets'));
    var picker = select([['', '+ add widget']].concat(N.WIDGETS.map(function (s) { return [s.type, s.label]; })), '', function (v) {
      if (!v) return;
      commit(N.addWidget(cfg, l.id, page.id, v, {}));
    });
    head.appendChild(picker);
    sec.appendChild(head);

    if (!page.widgets.length) sec.appendChild(el('div', 'znt-empty', 'No widgets in this group.'));
    page.widgets.forEach(function (w, i) {
      var spec = N.WIDGET_BY_TYPE[w.type];
      var row = el('div', 'znt-row');
      row.appendChild(el('span', 'znt-row-glyph', spec.glyph));
      row.appendChild(el('span', 'znt-row-name', spec.label));
      if (spec.sizes) {
        row.appendChild(select(N.SIZES.map(function (s) { return [s, s === 'tall' ? 'Tall' : 'Regular']; }), w.size,
          function (v) { commit(N.updateWidget(cfg, l.id, page.id, w.id, { size: v })); }));
      }
      row.appendChild(select([1, 2, 3, 4].map(function (n) { return [n, n + ' col']; }), w.span,
        function (v) { commit(N.updateWidget(cfg, l.id, page.id, w.id, { span: parseInt(v, 10) })); }));
      if (spec.cfg.indexOf('count') >= 0) {
        row.appendChild(select([5, 8, 10, 15, 20].map(function (n) { return [n, n + ' rows']; }), (w.cfg && w.cfg.count) || 8,
          function (v) { commit(N.updateWidget(cfg, l.id, page.id, w.id, { cfg: withKey(w.cfg, 'count', parseInt(v, 10)) })); }));
      }
      if (w.type === 'webpage') {
        row.appendChild(text((w.cfg && w.cfg.url) || '', 'https://example.com',
          function (v) { commit(N.updateWidget(cfg, l.id, page.id, w.id, { cfg: withKey(w.cfg, 'url', v) })); }));
      }
      if (w.type === 'feeds') {
        row.appendChild(text((w.cfg && w.cfg.feedUrl) || '', 'blank = every subscribed feed',
          function (v) { commit(N.updateWidget(cfg, l.id, page.id, w.id, { cfg: withKey(w.cfg, 'feedUrl', v) })); }));
      }
      if (w.type === 'bookmarks') {
        row.appendChild(text((w.cfg && w.cfg.folderId) || '1', 'folder id',
          function (v) { commit(N.updateWidget(cfg, l.id, page.id, w.id, { cfg: withKey(w.cfg, 'folderId', v) })); }));
      }
      var tools = el('span', 'znt-row-tools');
      if (i > 0) tools.appendChild(button('↑', 'is-mini', function () { commit(N.moveWidget(cfg, l.id, page.id, i, i - 1)); }));
      if (i < page.widgets.length - 1) tools.appendChild(button('↓', 'is-mini', function () { commit(N.moveWidget(cfg, l.id, page.id, i, i + 1)); }));
      tools.appendChild(button('✕', 'is-mini is-danger', function () { commit(N.removeWidget(cfg, l.id, page.id, w.id)); }));
      row.appendChild(tools);
      sec.appendChild(row);
    });
    host.appendChild(sec);
  }
  function withKey(o, k, v) {
    var out = {};
    for (var x in (o || {})) { out[x] = o[x]; }
    out[k] = v;
    return out;
  }

  function renderDials(host, l, page) {
    var sec = el('section', 'znt-sec');
    var head = el('div', 'znt-sec-head');
    head.appendChild(el('h3', 'znt-sec-title', 'Speed Dials'));
    head.appendChild(button('+ Dial', 'is-ghost', function () {
      askText('Add Speed Dial', 'Address', '').then(function (url) {
        if (url == null || !url.trim()) return;
        if (!N.safeUrl(url)) { toast('that address cannot be opened', 'error'); return; }
        commit(N.addDial(cfg, l.id, page.id, { url: url.trim() }));
      });
    }));
    sec.appendChild(head);

    if (!page.dials.length) sec.appendChild(el('div', 'znt-empty', 'No dials in this group.'));
    page.dials.forEach(function (d, i) {
      var row = el('div', 'znt-row');
      row.appendChild(text(d.label, 'title', function (v) { commit(N.updateDial(cfg, l.id, page.id, d.id, { label: v })); }));
      row.appendChild(text(d.url, 'https://example.com', function (v) {
        if (!N.safeUrl(v)) { toast('that address cannot be opened', 'error'); render(); return; }
        commit(N.updateDial(cfg, l.id, page.id, d.id, { url: v }));
      }));
      var tools = el('span', 'znt-row-tools');
      if (l.pages.length > 1) {
        tools.appendChild(select([['', 'move to…']].concat(l.pages.filter(function (p) { return p.id !== page.id; })
          .map(function (p) { return [p.id, p.name]; })), '', function (v) {
          if (v) commit(N.moveDialToPage(cfg, l.id, page.id, d.id, v));
        }));
      }
      if (i > 0) tools.appendChild(button('↑', 'is-mini', function () { commit(N.moveDial(cfg, l.id, page.id, i, i - 1)); }));
      if (i < page.dials.length - 1) tools.appendChild(button('↓', 'is-mini', function () { commit(N.moveDial(cfg, l.id, page.id, i, i + 1)); }));
      tools.appendChild(button('✕', 'is-mini is-danger', function () { commit(N.removeDial(cfg, l.id, page.id, d.id)); }));
      row.appendChild(tools);
      sec.appendChild(row);
    });
    host.appendChild(sec);
  }

  /* --------------------------------------------------------------- render */
  function counts(l) {
    var w = 0, d = 0;
    l.pages.forEach(function (p) { w += p.widgets.length; d += p.dials.length; });
    return l.pages.length + (l.pages.length === 1 ? ' group · ' : ' groups · ') + w + ' widgets · ' + d + ' dials';
  }

  function renderLibrary(host) {
    var grid = el('div', 'znt-grid');
    var shown = cfg.layouts.filter(function (l) { return matchFn(l.name); });
    if (!shown.length) grid.appendChild(el('div', 'znt-empty', 'No layout matches that filter.'));
    shown.forEach(function (l) {
      var card = el('article', 'znt-card' + (l.id === selected().id ? ' is-sel' : '') + (l.id === cfg.activeId ? ' is-active' : ''));
      var top = el('div', 'znt-card-top');
      top.appendChild(el('h2', 'znt-card-name', l.name));
      if (l.id === cfg.activeId) top.appendChild(el('span', 'znt-badge', 'ACTIVE'));
      card.appendChild(top);
      card.appendChild(previewSvg(l));
      card.appendChild(el('div', 'znt-card-sub', counts(l)));
      var acts = el('div', 'znt-card-acts');
      if (l.id !== cfg.activeId) acts.appendChild(button('Use', 'is-primary', function () { commit(N.setActiveLayout(cfg, l.id)); toast('active layout: ' + l.name); }));
      acts.appendChild(button('Edit', '', function () { selectedId = l.id; groupId = null; render(); }));
      acts.appendChild(button('Duplicate', '', function () { commit(N.duplicateLayout(cfg, l.id)); toast('layout duplicated'); }));
      acts.appendChild(button('Rename', '', function () { renameLayout(l); }));
      acts.appendChild(button('Export', '', function () { exportLayout(l); }));
      acts.appendChild(button('Delete', 'is-danger', function () { deleteLayout(l); }));
      card.appendChild(acts);
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function render() {
    body.innerHTML = '';
    if (!cfg) {
      body.appendChild(el('div', 'znt-empty', 'The new-tab extension is not answering — is it loaded?'));
      return;
    }
    var bar = el('div', 'znt-bar');
    bar.appendChild(button('+ New layout', 'is-primary', newLayout));
    bar.appendChild(button('Import…', '', importLayouts));
    bar.appendChild(button('Export all', '', exportAll));
    bar.appendChild(el('span', 'znt-bar-note', 'Layouts render on chrome://newtab; edits apply to open new tabs immediately.'));
    body.appendChild(bar);

    renderLibrary(body);

    var l = selected();
    var page = group();
    var detail = el('section', 'znt-detail');
    detail.appendChild(el('h2', 'znt-detail-title', 'Editing: ' + l.name));
    renderPrefs(detail, l);
    renderGroups(detail, l);
    var groupBar = el('div', 'znt-groupbar');
    groupBar.appendChild(el('span', 'znt-group-name', page.name));
    groupBar.appendChild(button('Rename group', 'is-ghost', function () {
      askText('Rename group', 'Group name', page.name).then(function (name) {
        if (name == null) return;
        commit(N.renamePage(cfg, l.id, page.id, name.trim() || page.name));
      });
    }));
    if (l.pages.length > 1) {
      groupBar.appendChild(button('Delete group', 'is-ghost is-danger', function () {
        askConfirm('Delete group', 'Delete "' + page.name + '" and its dials?').then(function (ok) {
          if (!ok) return;
          groupId = null;
          commit(N.removePage(cfg, l.id, page.id));
        });
      }));
    }
    detail.appendChild(groupBar);
    renderWidgets(detail, l, page);
    renderDials(detail, l, page);
    body.appendChild(detail);
  }

  pull(function (loaded) {
    cfg = loaded;
    render();
  });
})();
